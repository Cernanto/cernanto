// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The laptop's SQLite files. The plane's file, `<root>/plane.sqlite`,
// shared by every process of the plane, holds the records
// (`documents`). Each life of an agent keeps two files of its own: its
// logs, `<root>/journals/<service>.<life>.sqlite`, shared by the
// agent's copies and generations of that life alone (one table
// `wal(log, seq, type, text)`, the head at `seq` 0), and its traces,
// `<root>/traces/<service>.<life>.sqlite` (the records, the facts, the
// links to the calls made and the totals). A life's files are made at
// its birth and removed at its end; a writer opens them and never makes
// them. One connection per file per process, in write-ahead mode, the
// busy timeout the lock between processes.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import type {
  CapturedHead,
  FactRow,
  LifePart,
  LogHead,
  LogRow,
  LogType,
  PointerRow,
  TraceRow,
} from '../../substrate.js';

/** How long a write waits for another process's lock. */
const BUSY_TIMEOUT_MS = 10_000;

/** How long a removed document's row stays before the sweep takes it. */
const EXPIRED_RETENTION_MS = 60_000;

const PLANE_SCHEMA = `
CREATE TABLE IF NOT EXISTS documents(
  key TEXT PRIMARY KEY,
  value TEXT,
  revision INTEGER NOT NULL,
  expires INTEGER
);
CREATE INDEX IF NOT EXISTS documents_expires ON documents(expires);
`;

const JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS wal(
  log TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (log, seq)
);
`;

/** A life's traces: the records under their key, the facts a listing
 * reads, the links from a story to the stories it made, and one row of
 * totals per copy that writes under the life. Every row but a total
 * carries the moment it expires; a later write never moves it back. */
const TRACES_SCHEMA = `
CREATE TABLE IF NOT EXISTS records(
  story TEXT NOT NULL,
  attempt TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  run TEXT NOT NULL,
  call TEXT NOT NULL,
  place INTEGER NOT NULL,
  at TEXT NOT NULL,
  expires INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (story, attempt, seq, kind, run)
);
CREATE INDEX IF NOT EXISTS records_expires ON records(expires);
CREATE TABLE IF NOT EXISTS facts(
  story TEXT NOT NULL,
  attempt TEXT NOT NULL,
  run TEXT NOT NULL,
  fact TEXT NOT NULL,
  call TEXT NOT NULL,
  agent TEXT NOT NULL,
  began TEXT NOT NULL,
  expires INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (story, attempt, run, fact)
);
CREATE INDEX IF NOT EXISTS facts_agent ON facts(agent, began);
CREATE INDEX IF NOT EXISTS facts_call ON facts(call);
CREATE INDEX IF NOT EXISTS facts_expires ON facts(expires);
CREATE TABLE IF NOT EXISTS children(
  parent TEXT NOT NULL,
  child TEXT NOT NULL,
  agent TEXT NOT NULL,
  attempt TEXT NOT NULL,
  seq INTEGER NOT NULL,
  turn INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY (parent, child)
);
CREATE INDEX IF NOT EXISTS children_expires ON children(expires);
CREATE TABLE IF NOT EXISTS totals(
  writer TEXT PRIMARY KEY,
  calls_in INTEGER NOT NULL,
  calls_out INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  unpriced INTEGER NOT NULL,
  since INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  save_grant INTEGER NOT NULL,
  save_count INTEGER NOT NULL
);
`;

/** How long after a process's trim of a life's traces its next may run. */
export const TRIM_EVERY_MS = 60_000;

/** The type the head row carries at `seq` 0, the implementor's own
 * word, never a record's. */
const HEAD_TYPE = 'head';

/** The error an opening of a file that is not there fails with: a
 * life's file is opened, never made, by a writer. */
export class NoSuchFile extends Error {
  readonly file: string;

  constructor(file: string) {
    super(`the file ${file} is not there`);
    this.name = 'NoSuchFile';
    this.file = file;
  }
}

/** A fresh head: nobody's, nothing issued, nothing written. */
function freshHead(): LogHead {
  return { owner: '', launch: 0, issued: 0, last: 0, floor: 0 };
}

/** A row of the documents table as read. */
interface DocumentRow {
  key: string;
  value: string | null;
  revision: number;
  expires: number | null;
}

/** The least text above every text that begins with a prefix, in the
 * order the tables keep their keys (their UTF-8 bytes, which is the
 * order of the characters): the prefix with its last character raised
 * by one, a last character that is the highest one dropped first.
 * Nothing when no text is above them all, as for an empty prefix. A key
 * is plain text, so the bound holds whatever characters follow the
 * prefix. */
function abovePrefix(prefix: string): string | undefined {
  const characters = Array.from(prefix);
  while (characters.length > 0) {
    const last = characters.pop()?.codePointAt(0) ?? 0x10ffff;
    if (last >= 0x10ffff) continue;
    // The surrogates are no characters of their own: after U+D7FF
    // comes U+E000.
    const next = last === 0xd7ff ? 0xe000 : last + 1;
    return characters.join('') + String.fromCodePoint(next);
  }
  return undefined;
}

/** Whether the database said it is busy or locked. */
function busy(error: unknown): boolean {
  const said = error as { errcode?: unknown; errstr?: unknown } | undefined;
  return (
    said?.errcode === 5 ||
    said?.errcode === 6 ||
    (typeof said?.errstr === 'string' && /locked|busy/i.test(said.errstr))
  );
}

/** Runs one step of the opening, asked again while the database is
 * busy, a little later each time, for a few seconds. */
function settled(step: () => void): void {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let tries = 1; ; tries += 1) {
    try {
      step();
      return;
    } catch (error) {
      if (!busy(error) || tries >= 100) throw error;
      Atomics.wait(pause, 0, 0, Math.min(20 * tries, 200));
    }
  }
}

/** One SQLite file while a process holds it open: its statements
 * prepared once, its writes in transactions. */
class SqliteFile {
  readonly file: string;
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  /** `synchronous` is how far a commit is written before it answers:
   * `FULL` syncs the log at every commit, so what answered survives the
   * machine's own failure; `NORMAL` survives the process's. A file that
   * is not to be made (`make` false) is opened read and write by its
   * url, which refuses a file that is not there. */
  constructor(file: string, schema: string, synchronous: 'FULL' | 'NORMAL', make = true) {
    this.file = file;
    if (make) {
      mkdirSync(dirname(file), { recursive: true });
      this.db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
    } else {
      const url = pathToFileURL(file);
      url.searchParams.set('mode', 'rw');
      try {
        this.db = new DatabaseSync(url, { timeout: BUSY_TIMEOUT_MS });
      } catch (error) {
        if (!existsSync(file)) throw new NoSuchFile(file);
        throw error;
      }
    }
    // Several processes open one fresh file at once (a plane's or an
    // agent's first copies): the mode change and the schema take the
    // file for a moment each, and whoever meets the other's moment
    // waits its turn, since the busy timeout covers neither.
    settled(() => {
      this.db.exec('PRAGMA journal_mode = WAL');
    });
    this.db.exec(`PRAGMA synchronous = ${synchronous}`);
    settled(() => {
      this.db.exec(schema);
    });
  }

  /** The names of the file's tables. */
  protected tableNames(): string[] {
    const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    return rows.map((row) => row.name);
  }

  /** A statement, prepared once. */
  statement(sql: string): StatementSync {
    let prepared = this.statements.get(sql);
    if (prepared === undefined) {
      prepared = this.db.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }

  /** Runs a body inside one write transaction: committed when it
   * answers, rolled back when it throws. */
  transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const answer = body();
      this.db.exec('COMMIT');
      return answer;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The transaction ended already.
      }
      throw error;
    }
  }

  /** The moment reads filter the expired by. */
  now(): number {
    return Date.now();
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Closed already.
    }
  }
}

/** The plane's file: the records. A file that keeps a table the schema
 * does not declare was made by another release and is not opened:
 * nothing of it is carried over, and the plane starts afresh by a
 * reset. SQLite's own tables (`sqlite_stat1` after an analyze) are the
 * file's. */
export class PlaneDatabase extends SqliteFile {
  constructor(file: string) {
    super(file, PLANE_SCHEMA, 'NORMAL');
    const declared = new Set(
      [...PLANE_SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1]),
    );
    const foreign = this.tableNames().filter(
      (name) => !declared.has(name) && !name.startsWith('sqlite_'),
    );
    if (foreign.length > 0) {
      this.close();
      throw new Error(
        `the plane at ${dirname(file)} was made by another release: its file keeps the table${foreign.length === 1 ? '' : 's'} ${foreign.join(', ')}, which this release does not read, so its records cannot be carried over; run \`cernanto dev reset\` to start the plane afresh`,
      );
    }
  }

  /** A document as it stands, a removed one absent: its row carries
   * `expires`, the mark of the removal. */
  document(key: string, now: number = this.now()): DocumentRow | undefined {
    const row = this.statement(
      'SELECT key, value, revision, expires FROM documents WHERE key = ?',
    ).get(key) as DocumentRow | undefined;
    if (row === undefined) return undefined;
    if (row.expires !== null && row.expires <= now) return undefined;
    return row;
  }

  /** The revision a document holds, present or removed, so a revision
   * never goes back. */
  private revisionOf(key: string): number {
    const row = this.statement('SELECT revision FROM documents WHERE key = ?').get(key) as
      { revision: number } | undefined;
    return row?.revision ?? 0;
  }

  /** Writes a document inside the current transaction; answers the new
   * revision. A null value removes it. */
  putDocument(key: string, value: string | null): number {
    const revision = this.revisionOf(key) + 1;
    if (value === null) {
      // The removal keeps the revision in a tombstone that reads as
      // absent, so a later write rests on a revision past it.
      this.statement(
        'INSERT INTO documents(key, value, revision, expires) VALUES (?, NULL, ?, 0) ON CONFLICT(key) DO UPDATE SET value = NULL, revision = excluded.revision, expires = 0',
      ).run(key, revision);
    } else {
      this.statement(
        'INSERT INTO documents(key, value, revision, expires) VALUES (?, ?, ?, NULL) ON CONFLICT(key) DO UPDATE SET value = excluded.value, revision = excluded.revision, expires = NULL',
      ).run(key, value, revision);
    }
    return revision;
  }

  /** Every document under a prefix, removed ones left out. */
  documents(prefix: string, now: number = this.now()): DocumentRow[] {
    const above = abovePrefix(prefix);
    const rows = (above === undefined
      ? this.statement(
          'SELECT key, value, revision, expires FROM documents WHERE key >= ? ORDER BY key',
        ).all(prefix)
      : this.statement(
          'SELECT key, value, revision, expires FROM documents WHERE key >= ? AND key < ? ORDER BY key',
        ).all(prefix, above)) as unknown as DocumentRow[];
    return rows.filter((row) => row.value !== null && (row.expires === null || row.expires > now));
  }

  /** Takes the rows of the documents removed for longer than the
   * retention. */
  sweep(now: number = this.now()): void {
    this.statement('DELETE FROM documents WHERE expires IS NOT NULL AND expires < ?').run(
      now - EXPIRED_RETENTION_MS,
    );
  }
}

/** A life's journal file: its logs, one table with the head at `seq`
 * 0, each commit synced before it answers, since a record answered is
 * one the world may already have seen the effect of. Made at the
 * life's birth alone (`make`), opened otherwise. */
export class JournalDatabase extends SqliteFile {
  constructor(file: string, make = false) {
    super(file, JOURNAL_SCHEMA, 'FULL', make);
  }

  // The logs: one table, the head at seq 0, every operation one
  // transaction.

  /** A log's head as it stands; nothing for a log never issued. */
  walHead(log: string): LogHead | undefined {
    const row = this.statement('SELECT text FROM wal WHERE log = ? AND seq = 0').get(log) as
      { text: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.text) as LogHead);
  }

  private walPutHead(log: string, head: LogHead): void {
    this.statement(
      'INSERT INTO wal(log, seq, type, text) VALUES (?, 0, ?, ?) ON CONFLICT(log, seq) DO UPDATE SET text = excluded.text',
    ).run(log, HEAD_TYPE, JSON.stringify(head));
  }

  /** Issues the next grant: the head made when the log is new. */
  walIssue(log: string): number {
    return this.transaction(() => {
      const head = this.walHead(log) ?? freshHead();
      head.issued += 1;
      this.walPutHead(log, head);
      return head.issued;
    });
  }

  /** Takes the head by a grant; refused with the head as it stands. */
  walOwn(
    log: string,
    attempt: string,
    launch: number,
  ): { head: LogHead } | { refused: LogHead | undefined } {
    return this.transaction(() => {
      const head = this.walHead(log);
      if (head === undefined) return { refused: undefined };
      if (head.owner === attempt && head.launch === launch) return { head };
      if (launch > head.launch && launch <= head.issued) {
        head.owner = attempt;
        head.launch = launch;
        this.walPutHead(log, head);
        return { head };
      }
      return { refused: head };
    });
  }

  /** Appends one row under the head's conditions, the head's last moved
   * with it; refused as `owner` or `moved` with the head. */
  walAppend(
    log: string,
    attempt: string,
    seq: number,
    type: LogType,
    text: string,
  ): undefined | { refused: 'owner' | 'moved'; head: LogHead | undefined } {
    return this.transaction(() => {
      const head = this.walHead(log);
      if (head === undefined || head.owner !== attempt) return { refused: 'owner', head };
      if (head.last !== seq - 1 || seq <= head.floor) return { refused: 'moved', head };
      this.statement('INSERT INTO wal(log, seq, type, text) VALUES (?, ?, ?, ?)').run(
        log,
        seq,
        type,
        text,
      );
      head.last = seq;
      this.walPutHead(log, head);
      return undefined;
    });
  }

  /** The head and the rows at and above a position and the floor. */
  walRead(log: string, from: number): { head: LogHead | undefined; rows: LogRow[] } {
    const head = this.walHead(log);
    if (head === undefined) return { head: undefined, rows: [] };
    const rows = this.statement(
      'SELECT seq, type, text FROM wal WHERE log = ? AND seq >= ? AND seq > 0 ORDER BY seq',
    ).all(log, Math.max(from, head.floor)) as unknown as LogRow[];
    // The database's rows carry no prototype: each is answered as a
    // plain object, as the seam's readers compare them.
    return { head, rows: rows.map((row) => ({ seq: row.seq, type: row.type, text: row.text })) };
  }

  /** Moves the floor and drops the rows beneath it, for the owner. */
  walTruncate(
    log: string,
    attempt: string,
    below: number,
  ): undefined | { refused: 'owner'; head: LogHead | undefined } {
    return this.transaction(() => {
      const head = this.walHead(log);
      if (head === undefined || head.owner !== attempt) return { refused: 'owner', head };
      if (below <= head.floor) return undefined;
      head.floor = below;
      this.walPutHead(log, head);
      this.statement('DELETE FROM wal WHERE log = ? AND seq > 0 AND seq < ?').run(log, below);
      return undefined;
    });
  }

  /** Retires the rows through the captured last, the head kept, when
   * the head still carries the captured launch and last. */
  walRetire(log: string, captured: CapturedHead): boolean {
    return this.transaction(() => {
      const head = this.walHead(log);
      if (head === undefined || head.launch !== captured.launch || head.last !== captured.last)
        return false;
      this.statement('DELETE FROM wal WHERE log = ? AND seq > 0 AND seq <= ?').run(
        log,
        captured.last,
      );
      head.floor = Math.max(head.floor, captured.last);
      this.walPutHead(log, head);
      return true;
    });
  }

  /** The logs under a prefix, each with its head. */
  walList(prefix: string): { log: string; head: LogHead }[] {
    const above = abovePrefix(prefix);
    const rows = (
      above === undefined
        ? this.statement('SELECT log, text FROM wal WHERE seq = 0 AND log >= ? ORDER BY log').all(
            prefix,
          )
        : this.statement(
            'SELECT log, text FROM wal WHERE seq = 0 AND log >= ? AND log < ? ORDER BY log',
          ).all(prefix, above)
    ) as { log: string; text: string }[];
    return rows.map((row) => ({ log: row.log, head: JSON.parse(row.text) as LogHead }));
  }

  /** How many rows stand at and above a position and the floor. */
  walCount(log: string, from: number): number {
    const head = this.walHead(log);
    if (head === undefined) return 0;
    const counted = this.statement(
      'SELECT COUNT(*) AS n FROM wal WHERE log = ? AND seq > 0 AND seq >= ?',
    ).get(log, Math.max(from, head.floor)) as { n: number } | undefined;
    return counted?.n ?? 0;
  }
}

/** What a life's totals row answers a save with: taken now, or taken
 * before (its number is at or below the row's). */
type SaveTaken = 'now' | 'before';

/** A life's traces file: the records, the facts, the links and the
 * totals, each commit written through the operating system before it
 * answers (a trace is a record of what happened, not a promise to the
 * world). Made at the life's birth alone (`make`), opened otherwise. */
export class TracesDatabase extends SqliteFile {
  constructor(file: string, make = false) {
    super(file, TRACES_SCHEMA, 'NORMAL', make);
  }

  /** Lays one life's part down in one transaction: the save first, its
   * amounts added once when its number is above the row's, then the
   * records, the facts and the links, each a plain write under its own
   * key whose expiry no later write moves back; with `trim`, the rows
   * past their expiry leave in the same write. */
  writePart(part: LifePart, trim: boolean): SaveTaken {
    return this.transaction(() => {
      const taken = this.save(part);
      for (const row of part.records) this.putRecord(row, part.expires);
      for (const row of part.facts) this.putFact(row, part.expires);
      for (const row of part.pointers) this.putPointer(row, part.expires);
      if (trim) this.trim();
      return taken;
    });
  }

  private save(part: LifePart): SaveTaken {
    const { save } = part;
    const row = this.statement(
      'SELECT save_grant AS grant, save_count AS count FROM totals WHERE writer = ?',
    ).get(save.writer) as { grant: number; count: number } | undefined;
    if (row === undefined) {
      this.statement(
        'INSERT INTO totals(writer, calls_in, calls_out, tokens_in, tokens_out, cost_usd, unpriced, since, last_at, save_grant, save_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        save.writer,
        save.callsIn,
        save.callsOut,
        save.tokensIn,
        save.tokensOut,
        save.costUsd,
        save.unpriced,
        save.at,
        save.at,
        save.grant,
        save.count,
      );
      return 'now';
    }
    const above = save.grant > row.grant || (save.grant === row.grant && save.count > row.count);
    if (!above) return 'before';
    this.statement(
      'UPDATE totals SET calls_in = calls_in + ?, calls_out = calls_out + ?, tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_usd = cost_usd + ?, unpriced = unpriced + ?, last_at = ?, save_grant = ?, save_count = ? WHERE writer = ?',
    ).run(
      save.callsIn,
      save.callsOut,
      save.tokensIn,
      save.tokensOut,
      save.costUsd,
      save.unpriced,
      save.at,
      save.grant,
      save.count,
      save.writer,
    );
    return 'now';
  }

  private putRecord(row: TraceRow, expires: number): void {
    this.statement(
      'INSERT INTO records(story, attempt, seq, kind, run, call, place, at, expires, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(story, attempt, seq, kind, run) DO UPDATE SET expires = max(expires, excluded.expires)',
    ).run(
      row.story,
      row.attempt,
      row.seq,
      row.kind,
      row.run,
      row.call,
      row.place,
      row.at,
      expires,
      row.text,
    );
  }

  private putFact(row: FactRow, expires: number): void {
    this.statement(
      'INSERT INTO facts(story, attempt, run, fact, call, agent, began, expires, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(story, attempt, run, fact) DO UPDATE SET expires = max(expires, excluded.expires)',
    ).run(
      row.story,
      row.attempt,
      row.run,
      row.fact,
      row.call,
      row.agent,
      row.began,
      expires,
      row.text,
    );
  }

  private putPointer(row: PointerRow, expires: number): void {
    this.statement(
      'INSERT INTO children(parent, child, agent, attempt, seq, turn, expires) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(parent, child) DO UPDATE SET expires = max(expires, excluded.expires)',
    ).run(row.parent, row.child, row.agent, row.attempt, row.seq, row.turn, expires);
  }

  /** Removes the rows past their expiry inside the write under way. The
   * totals never expire. */
  private trim(): void {
    const now = this.now();
    for (const table of ['records', 'facts', 'children'])
      this.statement(`DELETE FROM ${table} WHERE expires < ?`).run(now);
  }
}
