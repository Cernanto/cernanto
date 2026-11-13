// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The logs on a laptop: each life's in the SQLite file of its own,
// `<root>/journals/<service>.<life>.sqlite`, the service being the
// log's first segment, opened in write-ahead mode with every commit
// synced, so an agent's appends wait on its own file alone. The file is
// made at the life's birth and removed at its end: a writer opens it
// and never makes it, so a write under a life that ended fails as the
// life's end, and a read of it finds nothing. The file holds one table
// `(log, seq, type, text)` with the primary key on the pair, the head
// at `seq` 0; an append is one transaction (the head's conditions
// checked, the head's `last` moved, the row inserted), a truncation one
// transaction (the floor moved, the rows deleted). The head row and the
// primary key are the whole of the concurrency control.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { LifeEnded, LogRefusal } from '../../substrate.js';
import type { CapturedHead, LogHead, LogRow, LogType, Logs } from '../../substrate.js';
import { JournalDatabase, NoSuchFile } from './database.js';

/** The ending of a life's journal file. */
const JOURNAL_FILE = '.sqlite';

/** An agent's name as a file's name spells it: each character beyond
 * letters, digits, `_` and `-` spelled by its bytes, so every name stays
 * inside the folder and reads back. */
function spelledService(service: string): string {
  return service.replaceAll(/[^A-Za-z0-9_-]/gu, (character) =>
    [...new TextEncoder().encode(character)]
      .map((byte) => `%${byte.toString(16).padStart(2, '0')}`)
      .join(''),
  );
}

/** The file name a life's logs (or its traces) lie in:
 * `<service>.<life>.sqlite`. */
export function lifeFileName(service: string, life: string): string {
  return `${spelledService(service)}.${life}${JOURNAL_FILE}`;
}

/** The service and the life a file's name spells, or nothing. */
function lifeOfFileName(name: string): { service: string; life: string } | undefined {
  if (!name.endsWith(JOURNAL_FILE)) return undefined;
  const stem = name.slice(0, -JOURNAL_FILE.length);
  const dot = stem.lastIndexOf('.');
  if (dot <= 0) return undefined;
  try {
    return { service: decodeURIComponent(stem.slice(0, dot)), life: stem.slice(dot + 1) };
  } catch {
    return undefined;
  }
}

/** A step of the database as a promise: what it throws (a refusal, the
 * database's own trouble) is a rejection, as the seam's callers await. */
function settled<T>(step: () => T): Promise<T> {
  try {
    return Promise.resolve(step());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** The agent a log is of: its first segment. */
function serviceOf(log: string): string {
  const slash = log.indexOf('/');
  const service = slash < 0 ? log : log.slice(0, slash);
  if (service === '') throw new Error(`the log ${log} names no agent`);
  return service;
}

export class SqliteLogs implements Logs {
  private readonly folder: string;
  private readonly life: string;
  private readonly files = new Map<string, JournalDatabase>();

  /** The logs of one life under a folder, each agent's file of that life
   * in it, one connection per file per process. */
  constructor(folder: string, life: string) {
    this.folder = folder;
    this.life = life;
  }

  private pathOf(service: string): string {
    return join(this.folder, lifeFileName(service, this.life));
  }

  /** The file of an agent's life, opened at its first use and never
   * made: a life whose file is not there has ended. A file removed while
   * this process holds it open takes what is written into nothing; the
   * removal comes after the life's generations are gone. */
  private fileFor(service: string): JournalDatabase {
    let file = this.files.get(service);
    if (file === undefined) {
      try {
        file = new JournalDatabase(this.pathOf(service));
      } catch (error) {
        if (error instanceof NoSuchFile) throw new LifeEnded(service, this.life);
        throw error;
      }
      this.files.set(service, file);
    }
    return file;
  }

  /** The file of an agent's life when it is there: a read of a life that
   * ended finds nothing. */
  private existingFileFor(service: string): JournalDatabase | undefined {
    if (!existsSync(this.pathOf(service))) return undefined;
    try {
      return this.fileFor(service);
    } catch (error) {
      if (error instanceof LifeEnded) return undefined;
      throw error;
    }
  }

  /** Every agent of this life that has a journal file in the folder. */
  private serviceNames(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.folder);
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      const spelled = lifeOfFileName(name);
      return spelled !== undefined && spelled.life === this.life ? [spelled.service] : [];
    });
  }

  private fileOf(log: string): JournalDatabase {
    return this.fileFor(serviceOf(log));
  }

  private existingFileOf(log: string): JournalDatabase | undefined {
    return this.existingFileFor(serviceOf(log));
  }

  close(): Promise<void> {
    for (const file of this.files.values()) file.close();
    this.files.clear();
    return Promise.resolve();
  }

  issue(log: string): Promise<number> {
    return settled(() => this.fileOf(log).walIssue(log));
  }

  own(log: string, attempt: string, launch: number): Promise<LogHead> {
    return settled(() => {
      const owned = this.fileOf(log).walOwn(log, attempt, launch);
      if ('head' in owned) return owned.head;
      throw new LogRefusal(
        'grant',
        owned.refused === undefined
          ? `the log ${log} issued no grant: nothing owns it`
          : `the grant ${String(launch)} cannot take the log ${log}: its owner holds ${String(owned.refused.launch)} and ${String(owned.refused.issued)} were issued`,
        owned.refused,
      );
    });
  }

  append(log: string, attempt: string, seq: number, type: LogType, text: string): Promise<void> {
    return settled(() => {
      const refused = this.fileOf(log).walAppend(log, attempt, seq, type, text);
      if (refused === undefined) return;
      if (refused.refused === 'owner')
        throw new LogRefusal(
          'owner',
          `the log ${log} is owned by ${refused.head?.owner ?? 'nobody'}, not by ${attempt}`,
          refused.head,
        );
      throw new LogRefusal(
        'moved',
        `the log ${log} stands at ${String(refused.head?.last ?? 0)} (floor ${String(refused.head?.floor ?? 0)}), not at ${String(seq - 1)}`,
        refused.head,
      );
    });
  }

  read(log: string, from: number): Promise<{ head: LogHead | undefined; rows: LogRow[] }> {
    return settled(
      () => this.existingFileOf(log)?.walRead(log, from) ?? { head: undefined, rows: [] },
    );
  }

  truncate(log: string, attempt: string, below: number): Promise<void> {
    return settled(() => {
      const refused = this.fileOf(log).walTruncate(log, attempt, below);
      if (refused === undefined) return;
      throw new LogRefusal(
        'owner',
        `the log ${log} is owned by ${refused.head?.owner ?? 'nobody'}, not by ${attempt}`,
        refused.head,
      );
    });
  }

  retire(log: string, captured: CapturedHead): Promise<boolean> {
    return settled(() => this.existingFileOf(log)?.walRetire(log, captured) ?? false);
  }

  /** The logs under a prefix: a prefix that names its agent reads that
   * agent's file of this life alone, a shorter one every file of this
   * life of an agent whose name it begins. */
  list(prefix: string): Promise<{ log: string; head: LogHead }[]> {
    return settled(() => {
      if (prefix.includes('/')) return this.existingFileOf(prefix)?.walList(prefix) ?? [];
      return this.serviceNames()
        .filter((service) => service.startsWith(prefix))
        .flatMap((service) => this.existingFileFor(service)?.walList(prefix) ?? []);
    });
  }

  count(log: string, from: number): Promise<number> {
    return settled(() => this.existingFileOf(log)?.walCount(log, from) ?? 0);
  }
}
