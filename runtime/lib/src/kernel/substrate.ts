// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The kernel's substrate, in the kernel's own words: what the kernel
// keeps durable. Four seams, each implemented per surface (the
// laptop's files and SQLite under `substrate/files/`, DynamoDB and S3
// under `substrate/dynamodb/`): the logs (one per copy, a write-ahead
// log under a head the copy owns by a grant), the records (the plane's
// documents, compare-and-set), the objects (the plane's named objects)
// and the traces (the records of what each call did, the facts a
// listing needs, the links to the calls it made and the totals). The
// logs and the traces are kept under a life, the span of an agent's
// deployment from its first run to its delete: a name used again is a
// new life, and nothing of one life is read under another. A call and
// its answer travel between copies over HTTP alone, whole, whatever
// their size.

import { serviceNameOf } from '../language/naming.js';

// The logs: a copy's journal is a write-ahead log as a database keeps
// one. One table, four columns, the primary key on the first two:
// `log` (whose log it is, the copy's inbox name,
// `<service>/<generation>/<copy>`), `seq` (the record's position, from
// 1, growing by one per append), `type` (one of the seven) and `text`
// (the entry as JSON). The head, one control row per log at `seq` 0,
// holds the owner (the attempt of the process that owns the log), the
// owner's grant (`launch`), the highest grant ever issued (`issued`),
// the last position appended and the floor (the position of the newest
// mark, below which the rows are gone). The grants are issued by the
// head itself, so every grant ever handed out is accounted for in
// durable state that belongs to the log, and an older grant can never
// take the head back. The head is never deleted.

/** The seven types a log's rows carry. */
const LOG_TYPES = [
  'request sent',
  'request ack',
  'response sent',
  'response ack',
  'observed',
  'checkpoint started',
  'checkpoint done',
] as const;
export type LogType = (typeof LOG_TYPES)[number];

/** Whether a word is one of the seven. */
export function isLogType(word: unknown): word is LogType {
  return typeof word === 'string' && (LOG_TYPES as readonly string[]).includes(word);
}

/** The head of a log: its control row at `seq` 0. */
export interface LogHead {
  /** The attempt of the process that owns the log; empty while nobody
   * ever owned it. */
  owner: string;
  /** The grant the owner holds; 0 while nobody ever owned the log. */
  launch: number;
  /** The highest grant ever issued for this log. */
  issued: number;
  /** The last position appended; 0 for a log never written. */
  last: number;
  /** The position of the newest mark: the rows below it are gone, the
   * row at it stays (the mark, with the open state it carries); 0 when
   * no mark was ever taken. */
  floor: number;
}

/** One row of a log past its head. */
export interface LogRow {
  seq: number;
  type: LogType;
  text: string;
}

/** Why the store refused a write on a log: the head names another
 * owner (`owner`: the process exits as fenced), the position is not the
 * next one or lies below the floor (`moved`: the writer reads the row
 * at its position and goes on), or the grant cannot take the head
 * (`grant`: lower than the owner's, or never issued). */
type LogRefusalKind = 'owner' | 'moved' | 'grant';

/** A refusal of the log store, told apart from the store's own trouble
 * by its kind, the head as it stands beside it. */
export class LogRefusal extends Error {
  readonly why: LogRefusalKind;
  readonly head: LogHead | undefined;

  constructor(why: LogRefusalKind, message: string, head?: LogHead) {
    super(message);
    this.name = 'LogRefusal';
    this.why = why;
    this.head = head;
  }
}

/** Whether an error is the log store's refusal of the kind given (any
 * kind when none is named). */
export function logRefused(error: unknown, why?: LogRefusalKind): error is LogRefusal {
  return error instanceof LogRefusal && (why === undefined || error.why === why);
}

/** What a retirement is conditioned on: the head as the cleanup read
 * it. */
export interface CapturedHead {
  launch: number;
  last: number;
}

/** The logs: eight operations, each one write or one read on either
 * implementor. */
export interface Logs {
  /** Moves the head's `issued` up by one and answers it, creating the
   * head when the log is new: asked by the launcher before a spawn or
   * a restore and by a taker before a takeover. */
  issue(log: string): Promise<number>;
  /** Takes the head for a process: success when the head already names
   * this owner and launch (asked again after a lost answer), the head
   * moved to this process when `launch` is above the head's and no
   * higher than its `issued`, refused `grant` otherwise. Answers the
   * head as it stands after. */
  own(log: string, attempt: string, launch: number): Promise<LogHead>;
  /** Appends one row and moves the head's `last` to it in one atomic
   * write, conditioned on the head's owner being `attempt`, its `last`
   * being `seq - 1` and `seq` above its floor; refused `owner` or
   * `moved` otherwise, with the head. */
  append(log: string, attempt: string, seq: number, type: LogType, text: string): Promise<void>;
  /** The head and the rows at and above a position (and above the
   * floor), in order; no head for a log never issued. */
  read(log: string, from: number): Promise<{ head: LogHead | undefined; rows: LogRow[] }>;
  /** Moves the head's floor to `below` and drops the rows beneath it,
   * for the owner alone; a floor already past it moves nothing. */
  truncate(log: string, attempt: string, below: number): Promise<void>;
  /** The cleanup's deletion of a dead log's rows, conditioned on the
   * head still carrying the captured `launch` and `last`: the rows
   * through the captured `last` go and the head stays. Answers whether
   * it was done; refused in words (false) when the head moved. */
  retire(log: string, captured: CapturedHead): Promise<boolean>;
  /** The logs under a prefix, each with its head, in no order. */
  list(prefix: string): Promise<{ log: string; head: LogHead }[]>;
  /** How many rows stand at and above a position. */
  count(log: string, from: number): Promise<number>;
}

/** A record as the records answer it: its value (null when absent) and
 * its revision, which moves with every write. */
export interface RecordRead {
  value: string | null;
  revision: number;
}

/** The records: the plane's documents, each a string under a key. */
export interface Records {
  read(key: string): Promise<RecordRead>;
  /** Compare-and-set: landed when the key holds exactly `expected`
   * (absent for null), refused with what stands otherwise. */
  write(
    key: string,
    value: string | null,
    expected: string | null,
  ): Promise<{ ok: boolean; current: RecordRead }>;
  /** Every record under a prefix, as of the call. */
  list(prefix: string): Promise<{ entries: { key: string; value: string; revision: number }[] }>;
}

/** The plane's objects by name: what the objects implementors serve
 * the agents (`cernanto/objects/files` under `<root>/objects`,
 * `cernanto/objects/cloud-storage` in the plane's bucket), reached here
 * by the block before any agent serves: the release's packages and the
 * materialize's tar laid in at a plane's first boot, a generation's tar
 * read at a process's start. A name is the object's own
 * (`packages/<digest>`, `generations/<identity>.tar`): on files its
 * segments are the folders and the file, in the cloud the object's
 * name in the bucket, verbatim. */
export interface Objects {
  put(name: string, bytes: Uint8Array): Promise<void>;
  get(name: string): Promise<Uint8Array | undefined>;
  has(name: string): Promise<boolean>;
  /** Removes the object; nothing when it is not there. */
  delete(name: string): Promise<void>;
}

// The traces: what each call did, written once by the runtime of the
// process that ran it, under the life of the agent that process
// serves, and read by the trace agent alone. Every write is a plain
// one under a key no other write shares, so nothing is read before a
// write; the one conditioned write is the save of the totals, which is
// also the check of the life.

/** One trace record as stored: its key (`story`, `attempt`, `seq`,
 * `kind`, `run`), its place among the records its process made, its
 * moment and its text, fixed when the record was made. `call` is the
 * call's id the story rides, the request's digits cut off. */
export interface TraceRow {
  story: string;
  call: string;
  attempt: string;
  seq: number;
  kind: string;
  run: string;
  place: number;
  at: string;
  text: string;
}

/** The facts a story's listing needs, each written once under its own
 * key: a run began, the run ended, the request is over. */
export type FactKind = 'began' | 'ended' | 'over';

/** One fact as stored: its key (`story`, `attempt`, `run`, `fact`), the
 * agent and the moment the story began, which the listing reads by,
 * and its text. */
export interface FactRow {
  story: string;
  call: string;
  attempt: string;
  run: string;
  fact: FactKind;
  agent: string;
  began: string;
  text: string;
}

/** A link from a story to a story it made: the pair is its key, the
 * child's agent beside it, and the parent's record that made it, its
 * attempt and its sequence, with the child's turn among the requests
 * that record made. */
export interface PointerRow {
  parent: string;
  child: string;
  agent: string;
  attempt: string;
  seq: number;
  turn: number;
}

/** A save of the totals, formed once: the amounts added since the
 * writer's last save, numbered by the grant by which the writer owns its
 * own log and a count under it, the pair rising with every save. */
export interface SaveStep {
  /** The copy that writes: its own life and its log's name. */
  writer: string;
  grant: number;
  count: number;
  callsIn: number;
  callsOut: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Model requests reported with no price. */
  unpriced: number;
  /** The moment the save was formed. */
  at: number;
}

/** One life's part of a batch, delivered by itself: the save first,
 * then the records, the facts and the pointers, each expiring at
 * `expires` (a begin fact sent again with a later expiry moves its
 * story's place in the listing on; no write moves an expiry back where
 * the store can tell). */
export interface LifePart {
  service: string;
  life: string;
  save: SaveStep;
  records: TraceRow[];
  facts: FactRow[];
  pointers: PointerRow[];
  expires: number;
}

/** What the store answered a part: the save taken, now or before, and
 * the rest written (`taken`); the life ended, nothing written (`ended`);
 * nothing known, to be sent again whole (`unknown`). */
export type SaveAnswer = 'taken' | 'ended' | 'unknown';

/** The traces: one write, a life's part of a batch. */
export interface Traces {
  write(part: LifePart): Promise<SaveAnswer>;
}

/** The whole substrate a process speaks, opened once per process. */
export interface Substrate {
  /** The logs of one life. */
  logsOf(life: string): Logs;
  records: Records;
  objects: Objects;
  traces: Traces;
  /** Makes what a life keeps before its name's record names it: on a
   * laptop its two files, the journal's and the traces'; nothing on
   * the servers, where the record is the gate. */
  beginLife(service: string, life: string): Promise<void>;
  /** Removes everything kept under a life whose name no longer names
   * it: the writers' gates first, then the rest. Answers whether
   * nothing is left; a part removed, or a file some process still
   * holds open, answers false, and the removal is asked again. */
  removeLife(service: string, life: string): Promise<boolean>;
  /** Lets go of everything the implementor holds open. */
  close(): Promise<void>;
}

/** The record of a name: the one life of an agent id that stands,
 * `lives/<service>`, JSON `{life, born}`. */
export function lifeKey(service: string): string {
  return `lives/${service}`;
}

/** The life a name's record names, or nothing when the record is absent
 * or unreadable. */
export function lifeOfRecord(value: string | null): string | undefined {
  if (value === null) return undefined;
  try {
    const life = (JSON.parse(value) as { life?: unknown }).life;
    return typeof life === 'string' && life !== '' ? life : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a word can name a life: letters and digits alone, so it
 * spells a file's name and a key on every store. */
export function isLifeId(word: unknown): word is string {
  return typeof word === 'string' && /^[a-z0-9]{6,40}$/u.test(word);
}

/** The error a write under a life that ended fails with: the name's
 * record names it no more, and its files or its gates are gone. */
export class LifeEnded extends Error {
  readonly life: string;

  constructor(service: string, life: string) {
    super(`the life ${life} of ${service} has ended: nothing more is written under it`);
    this.name = 'LifeEnded';
    this.life = life;
  }
}

/** The names of the implementors the kernel knows. */
export type SubstrateName = 'files-sqlite' | 'dynamodb-s3';

// The keys the kernel spells on the records, in one place.

/** The directory entry of an agent: it is served, or was. The entry is
 * keyed by the agent's service name, which its id spells one way and
 * a caller that names the service alone (a proof's road, the
 * gateway's handle) spells the same. */
export function agentKey(agentId: string): string {
  return `agents/${serviceNameOf(agentId)}`;
}

/** The record of a copy of a generation, its slot:
 * `copies/<generation port>/<n>`. A task or a job rolls with overlap,
 * both generations serving with a copy 0 each, so the key names the
 * generation and never the agent alone. */
export function copyKey(generation: number, copy: number): string {
  return `copies/${String(generation)}/${String(copy)}`;
}

/** The records of every copy of a generation. */
export function copiesPrefix(generation: number): string {
  return `copies/${String(generation)}/`;
}

/** The records of every copy on the plane. */
export const COPIES_PREFIX = 'copies/';

/** The shape of what the plane keeps: the records' keys, the logs'
 * names and what each log holds, the traces' tables and the lives they
 * are kept under. A plane written by another shape is not read: it is
 * reset. Kept under `PLANE_FORMAT_KEY`, written at a plane's first
 * boot. */
export const PLANE_FORMAT = 5;
export const PLANE_FORMAT_KEY = 'plane/format';
