// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { LifeOf, TotalsDelta, TraceRecord, TraceSink } from './trace.js';
import { callOfStory, compareRuns, requestOfStory } from './story.js';

import { encodeJson } from '../kernel/json.js';
import { sleepMs } from '../kernel/lifetime.js';
import type {
  FactRow,
  LifePart,
  PointerRow,
  SaveAnswer,
  SaveStep,
  TraceRow,
} from '../kernel/substrate.js';

// The trace sink: a process writes its own traces straight into the
// store, batched, off the handler's path. Each record is bounded, given
// its place (a count of the process that orders a run) and encoded once
// as it is taken, and those bytes are what every delivery, every resend
// and a live stream carry. Records, facts and links queue in memory; a
// timer drains them once a second, life by life: what the queue holds
// for one life is delivered by itself, the life's numbered save of the
// totals first and the rest behind it, so a life whose store does not
// answer holds no other life back, and a life that ended drops what it
// held. A full queue drops the oldest items, a waiting life's first,
// while counting what it dropped, because agent execution comes before
// observability. Nothing is read before a write and nothing is compared
// but the save's number.
//
// The sink is machine plumbing that can run inside an agent's own
// execution (a flush asked from a handler fires in the handler's
// context): it reaches the store by the substrate, outside the journal.

/** A record whose serialized size passes this many bytes loses its
 * heaviest values to omission notes: a few oversized records (a compile's
 * begin record carrying an uploaded workspace) would make one stored
 * row a burden to every reader of its story. */
export const RECORD_BYTES_CAP = 262_144;
/** A part closes once its serialized bytes pass this bound, whatever
 * its count: one write of the store carries it. */
export const BATCH_BYTES_CAP = 1_048_576;
/** The close's retry budget for a tail the store cannot take yet. */
const CLOSE_RETRY_MS = 10_000;
const HEAVY_FIELDS = ['input', 'output', 'args', 'result', 'payload'] as const;
/** A leaf lighter than this stays unless its whole field goes: a record
 * over the cap for its many small strings loses a whole field instead. */
const LEAF_BYTES_MIN = 4096;
/** How much of a text of its own a record over the cap keeps (a console
 * line, a failure's words, its stack): the beginning, which says what
 * it is, with a note of what was cut. The bytes are the wire's: a
 * character the wire spells in six bytes counts six. */
const TEXT_BYTES_KEPT = 32_768;
/** How much a field keeps when the record still passes the cap after
 * every other cut: enough to say what it was. */
const LAST_TEXT_BYTES_KEPT = 256;
/** The characters a text is measured by at a time. */
const TEXT_STRIDE = 1024;
/** How much of each of its texts a fact keeps (an end's failure, a
 * request's): a fact says what a request did, its records keep the
 * words at their own bound, and a fact is stored as one item, whole. */
const FACT_TEXT_BYTES_KEPT = 8192;
/** The fields that name a record: never cut. */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  'agentId',
  'callId',
  'attemptId',
  'at',
  'kind',
  'parentCallId',
  'callerAgentId',
  'callerModuleId',
]);

/** The serialized weight of a value, bytes as the wire spells them; a
 * value the wire spells as nothing (an undefined result or field) weighs
 * nothing. */
function weightOf(value: unknown): number {
  const text: unknown = encodeJson(value);
  return typeof text === 'string' ? Buffer.byteLength(text) : 0;
}

/** The bytes the wire spells a piece of text in, its quotes aside. */
function textWeight(text: string): number {
  return weightOf(text) - 2;
}

/** A text's beginning, as much of it as the wire spells within the
 * bytes kept, cut at a whole character, with a note naming the bytes
 * of the text it stands for. A text that fits is answered as it is. */
function cutText(text: string, kept: number = TEXT_BYTES_KEPT): string {
  if (textWeight(text) <= kept) return text;
  let end = 0;
  let weight = 0;
  // Whole strides while they fit, then single characters: the text is
  // measured once, whatever its length.
  for (const stride of [TEXT_STRIDE, 1]) {
    while (end < text.length) {
      let next = Math.min(end + stride, text.length);
      // The two halves of one character stay together.
      const code = text.charCodeAt(next - 1);
      if (code >= 0xd800 && code <= 0xdbff && next < text.length) next += 1;
      const bytes = textWeight(text.slice(end, next));
      if (weight + bytes > kept) break;
      weight += bytes;
      end = next;
    }
  }
  return `${text.slice(0, end)} [${String(Buffer.byteLength(text.slice(end), 'utf8'))} bytes omitted]`;
}

/** The last bound, for a record that still passes the cap once its
 * texts and its values were cut: what weighs most is replaced where it
 * stands, a text by its first words (cut from the text as the record
 * came with it, so the note names what it stands for) and a value by a
 * note, the fields that name the record last, until the record fits. */
function capped(
  copy: Record<string, unknown>,
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  for (const naming of [false, true]) {
    const fields = Object.keys(copy)
      .filter((field) => IDENTITY_FIELDS.has(field) === naming)
      .map((field) => ({ field, bytes: weightOf(copy[field]) }))
      .sort((a, b) => b.bytes - a.bytes);
    for (const { field, bytes } of fields) {
      if (weightOf(copy) <= RECORD_BYTES_CAP) return copy;
      const value = copy[field];
      const whole = record[field];
      if (typeof value === 'string') {
        copy[field] = cutText(typeof whole === 'string' ? whole : value, LAST_TEXT_BYTES_KEPT);
      } else if (typeof value === 'object' && value !== null) {
        copy[field] = { omitted: `${String(bytes)} bytes` };
      }
    }
  }
  return copy;
}

interface Leaf {
  path: readonly (string | number)[];
  bytes: number;
}

/** The text and byte leaves of a value worth omitting, with their
 * weights. */
function leavesOf(value: unknown, path: readonly (string | number)[], into: Leaf[]): void {
  if (typeof value === 'string' || value instanceof Uint8Array) {
    const bytes = weightOf(value);
    if (bytes >= LEAF_BYTES_MIN) into.push({ path, bytes });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      leavesOf(item, [...path, index], into);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) leavesOf(item, [...path, key], into);
  }
}

/** The value with the leaves at the given paths replaced by their
 * notes, rebuilt in one pass: the omitted ones and their ancestors
 * copied, everything else shared. */
function omitLeaves(
  value: unknown,
  path: readonly (string | number)[],
  notes: ReadonlyMap<string, string>,
): unknown {
  const note = notes.get(keyOf(path));
  if (note !== undefined) return note;
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item, index) => omitLeaves(item, [...path, index], notes));
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Uint8Array)) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value))
      copy[key] = omitLeaves(item, [...path, key], notes);
    return copy;
  }
  return value;
}

/** A path's key in the notes map (a key may hold any character, so
 * the parts are joined by a byte no key carries). */
function keyOf(path: readonly (string | number)[]): string {
  return path.map(String).join('\u0000');
}

/** The record with its heaviest values omitted until it fits the cap:
 * its own texts first (a console line, a failure's words, its stack
 * keep their beginning), then the heaviest text and byte leaves of its
 * values, largest first (a picture's bytes go, the prompt beside them
 * and every key stay), then whole fields when the leaves were not
 * enough, then whatever still weighs. A record that fits is answered
 * as it is, and no record is answered over the cap. An omission names
 * the bytes it stands for. */
export function boundedRecord(record: TraceRecord): TraceRecord {
  if (weightOf(record) <= RECORD_BYTES_CAP) return record;
  let copy: Record<string, unknown> = { ...record };
  for (const [field, value] of Object.entries(copy)) {
    if (typeof value === 'string' && !IDENTITY_FIELDS.has(field)) copy[field] = cutText(value);
  }
  const total = weightOf(copy);
  if (total <= RECORD_BYTES_CAP) return copy as unknown as TraceRecord;
  const leaves: Leaf[] = [];
  for (const field of HEAVY_FIELDS) {
    if (copy[field] !== undefined) leavesOf(copy[field], [field], leaves);
  }
  leaves.sort((a, b) => b.bytes - a.bytes);
  // The weight after an omission is arithmetic, the leaf's bytes traded
  // for its note's, so the leaves to omit are chosen without encoding
  // anything, and the record is rebuilt once and measured once
  // (re-encoding a large record after every omission would hold the
  // loop).
  const notes = new Map<string, string>();
  let weight = total;
  for (const leaf of leaves) {
    if (weight <= RECORD_BYTES_CAP) break;
    const note = `[${String(leaf.bytes)} bytes omitted]`;
    notes.set(keyOf(leaf.path), note);
    weight -= leaf.bytes - weightOf(note);
  }
  if (notes.size > 0) {
    copy = omitLeaves(copy, [], notes) as Record<string, unknown>;
    if (weightOf(copy) <= RECORD_BYTES_CAP) return copy as unknown as TraceRecord;
  }
  const heavy = HEAVY_FIELDS.filter((field) => copy[field] !== undefined)
    .map((field) => ({ field, bytes: weightOf(copy[field]) }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const { field, bytes } of heavy) {
    copy[field] = { omitted: `${String(bytes)} bytes` };
    if (weightOf(copy) <= RECORD_BYTES_CAP) break;
  }
  return capped(copy, record) as unknown as TraceRecord;
}

export interface TraceSinkOptions {
  /** The store's write of one life's part: the save first, the rest
   * behind it, answered `taken`, `ended` or `unknown`. */
  write: (part: LifePart) => Promise<SaveAnswer>;
  /** The process's own agent and life, once known: the records and the
   * process's own counts are kept under it. Nothing while unknown, and
   * what waits for it waits in the queue. */
  own: () => LifeOf | undefined;
  /** The copy that writes, as the totals name it, and the grant by
   * which it owns its own log now: a save is numbered by it. */
  writer: () => { writer: string; grant: number };
  /** How long a stored row stands, read at each part. */
  retentionMs: () => number;
  /** Drain cadence; the default stores a batch a second. */
  intervalMs?: number;
  /** Items per part, the queue's bound and the close's retry budget:
   * the proofs of the bounds set them; every process keeps the
   * defaults. */
  batchSize?: number;
  maxQueued?: number;
  closeRetryMs?: number;
  /** How often a begin fact kept under a life that holds none of its
   * run's records (a linked module's own listing) is written again while
   * the run records: a quarter of the retention, between a second and a
   * minute, when not given. */
  refreshMs?: number;
}

/** Items per part. */
const BATCH_SIZE = 500;
/** The queue's bound; beyond it the oldest items drop. */
const MAX_QUEUED = 5000;
/** How many requests' words that they are over the sink keeps once the
 * store took them, for a follow that arrives after; as many linked
 * calls' ends, kept apart so a request's many linked calls never push a
 * request's word out. */
const OVERS_KEPT = 1024;
/** How many runs' begin facts the sink keeps to write again while their
 * requests run. */
const BEGUN_KEPT = 4096;

/** The key of the process's own life in the sink's maps. */
const OWN = 'own';

/** The amounts a delta carries. */
const DELTA_FIELDS = [
  'callsIn',
  'callsOut',
  'tokensIn',
  'tokensOut',
  'costUsd',
  'unpriced',
] as const;

/** One item of the queue: a record, a fact or a link, its bytes fixed
 * when it was taken. */
interface Item {
  key: string;
  under: LifeOf | undefined;
  story: string;
  bytes: number;
  text: string;
  record?: TraceRow;
  fact?: FactRow;
  pointer?: PointerRow;
}

/** What a life counted and has not formed into a save. */
interface Pending {
  under: LifeOf | undefined;
  delta: TotalsDelta;
}

/** A stream that follows what this process makes. */
interface Follower {
  matches(item: Item): boolean;
  send(item: Item): void;
  /** Whether the word that its story is over was handed to it. */
  over: boolean;
  /** Told once its story is over and the store took all of it. */
  done: (() => void) | undefined;
}

/** Whether a story is a call a linked module ran inside a request. */
function isLinked(story: string): boolean {
  return requestOfStory(story) !== story;
}

interface TraceSinkHandle {
  sink: TraceSink;
  /** Stores everything queued now; resolves when the store answered. */
  flush(): Promise<void>;
  /** Final flush and timer teardown. */
  close(): Promise<void>;
  /** How many items the bound has discarded. */
  dropped(): number;
  /** Forms what is counted into numbered saves: the pause's step before
   * an image is taken, so a save the image holds keeps the number its
   * first life gave it and counts once whichever life sends it. */
  formSaves(): void;
  /** Follows the records of one story and the stories linked inside it
   * (every record, when none is named) and the word that a story is
   * over: first what the store has not taken, then what is made. Each
   * is handed as the text it was fixed as. The word that a request is
   * over is its `over` fact; a linked call keeps no such fact, and the
   * word that it is over is its run's `ended` fact, or the `over` fact
   * of the request it ran inside. A story's follow is told `done` once
   * the story is over and the store took all of it, the word that it is
   * over handed first, also when the store took that word before the
   * follow came. Answers the end of it. */
  follow(story: string | undefined, send: (text: string) => void, done?: () => void): () => void;
}

/** How many parts one drain sends for one life before it lets the next
 * life have its turn. */
const PARTS_PER_DRAIN = 20;

export function traceSink(options: TraceSinkOptions): TraceSinkHandle {
  const intervalMs = options.intervalMs ?? 1000;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxQueued = options.maxQueued ?? MAX_QUEUED;
  /** What waits to be stored, oldest first; the bound is on it. An item
   * stays here while its part is on its way, and leaves when the store
   * took it. */
  const queue: Item[] = [];
  /** What is counted and not yet formed into a save, by life. */
  const pending = new Map<string, Pending>();
  /** The save formed for a life and not yet taken: sent again, the same
   * number and the same amounts, until the store takes it. */
  const formed = new Map<string, SaveStep>();
  /** The lives the store said ended: nothing more is kept for them. */
  const ended = new Set<string>();
  /** The lives whose last part the store did not answer. */
  const waiting = new Set<string>();
  /** The streams that follow what this process makes. */
  const followers = new Set<Follower>();
  /** The words that a request is over, by its story, the latest kept. */
  const overs = new Map<string, string>();
  /** Each linked call's latest run, in the order of runs, by its story,
   * with that run's `ended` fact once it ended: the word that the call is
   * over. A later run's record or fact takes an earlier run's end off. */
  const ends = new Map<string, { run: string; ended?: string }>();
  /** The begin fact of each run whose request is not over, by its life's
   * key, its story, its attempt and its run: every part that carries the
   * run's records writes it again, so its expiry moves with the request
   * and a request listed is one that still records. */
  const begun = new Map<string, FactRow>();
  const begunKey = (key: string, story: string, attempt: string, run: string): string =>
    [key, story, attempt, run].join('\u0000');
  /** The latest begin fact of each request's attempt, whatever its run: a
   * body that goes on under a later run of its own (a restored life owns
   * the log by a newer grant) states no begin of its own, so the first
   * part carrying that run's records states it from this one, the run
   * named anew. */
  const requestBegun = new Map<string, FactRow>();
  const requestKey = (key: string, story: string, attempt: string): string =>
    [key, story, attempt].join('\u0000');
  const keepBounded = (map: Map<string, unknown>): void => {
    while (map.size > BEGUN_KEPT) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  };
  /** The lives each request's begin fact was stated under, by its story
   * and attempt: a linked module's call states it under its host's life,
   * which keeps the call's records, and under its own, for its listing. */
  const begunUnder = new Map<string, Set<string>>();
  const underKey = (story: string, attempt: string): string => [story, attempt].join('\u0000');
  /** The begin facts due to be written again under a life that keeps none
   * of their run's records, by that life's key, and when each was last
   * written there. */
  const refreshes = new Map<string, Map<string, FactRow>>();
  const refreshedAt = new Map<string, number>();
  const refreshEvery = (): number =>
    options.refreshMs ?? Math.min(60_000, Math.max(1000, options.retentionMs() / 4));
  /** The begin fact of a run, stated from its request's earlier run when
   * the run states none of its own. */
  const begunOf = (
    key: string,
    story: string,
    attempt: string,
    run: string,
  ): FactRow | undefined => {
    const at = begunKey(key, story, attempt, run);
    const stated = begun.get(at);
    if (stated !== undefined) return stated;
    const earlier = requestBegun.get(requestKey(key, story, attempt));
    if (earlier === undefined) return undefined;
    const said = JSON.parse(earlier.text) as Record<string, unknown>;
    const derived: FactRow = { ...earlier, run, text: encodeJson({ ...said, run }) };
    begun.set(at, derived);
    keepBounded(begun);
    requestBegun.set(requestKey(key, story, attempt), derived);
    return derived;
  };
  /** Asks, for a run whose records a life's part carries, that its begin
   * fact be written again under each other life it was stated under, at
   * most once a refresh, so those lives' listings keep it as long. */
  const askRefreshes = (key: string, story: string, attempt: string, run: string): void => {
    const keys = begunUnder.get(underKey(story, attempt));
    if (keys === undefined) return;
    const now = Date.now();
    for (const other of keys) {
      if (other === key) continue;
      const at = begunKey(other, story, attempt, run);
      if (now - (refreshedAt.get(at) ?? 0) < refreshEvery()) continue;
      const fact = begunOf(other, story, attempt, run);
      if (fact === undefined) continue;
      refreshedAt.set(at, now);
      keepBounded(refreshedAt);
      const due = refreshes.get(other) ?? new Map<string, FactRow>();
      due.set(at, fact);
      refreshes.set(other, due);
    }
  };
  let place = 0;
  let saves = 0;
  let droppedCount = 0;
  let inflight: Promise<void> | undefined;
  let closed = false;

  /** The life each key names, the process's own aside. */
  const unders = new Map<string, LifeOf>();

  /** The key of a life: the process's own, or the one named. A life is
   * one key however it is named, so its saves form one numbered
   * sequence: the process's own life named outright is the own key, or
   * a later save of one key could land before an earlier save of the
   * other and leave the earlier one below the store's last. */
  const keyOf = (under: LifeOf | undefined): string => {
    if (under === undefined) return OWN;
    const own = options.own();
    if (own !== undefined && own.service === under.service && own.life === under.life) return OWN;
    const key = `${under.service}\u0000${under.life}`;
    unders.set(key, under);
    return key;
  };

  /** The life a key names now; nothing while the process's own life is
   * not known yet. */
  const lifeOfKey = (key: string): LifeOf | undefined =>
    key === OWN ? options.own() : unders.get(key);

  /** Lets go each follow whose story is over and of which nothing waits
   * to be stored: what it was not handed, the store holds. */
  const settleFollowers = (): void => {
    for (const follower of followers) {
      if (!follower.over || follower.done === undefined) continue;
      if (queue.some((item) => follower.matches(item))) continue;
      followers.delete(follower);
      follower.done();
    }
  };

  /** Keeps the word that a story is over, the oldest let go past the
   * bound: a request's `over` fact; a linked call's latest run and that
   * run's `ended` fact once it ended. */
  const keepOver = (item: Item): void => {
    const fact = item.fact;
    if (fact?.fact === 'over') {
      overs.delete(fact.story);
      overs.set(fact.story, item.text);
      bounded(overs);
      return;
    }
    if (item.pointer !== undefined || !isLinked(item.story)) return;
    const run = item.record?.run ?? fact?.run;
    if (run === undefined) return;
    const known = ends.get(item.story);
    if (known === undefined || compareRuns(run, known.run) > 0) {
      ends.delete(item.story);
      ends.set(item.story, fact?.fact === 'ended' ? { run, ended: item.text } : { run });
      bounded(ends);
    } else if (fact?.fact === 'ended' && compareRuns(run, known.run) === 0) {
      known.ended = item.text;
    }
  };
  const bounded = (kept: Map<string, unknown>): void => {
    while (kept.size > OVERS_KEPT) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
  };

  /** Drops the oldest of what waits until the queue is within its
   * bound, counting each: a waiting life's first, since its store is
   * away, then the oldest of all. */
  const holdBound = (): void => {
    let dropped = false;
    while (queue.length > maxQueued) {
      let index = queue.findIndex((item) => waiting.has(item.key));
      if (index === -1) index = 0;
      queue.splice(index, 1);
      droppedCount += 1;
      dropped = true;
    }
    if (dropped) settleFollowers();
  };

  /** Forms what a life counted into a save, numbered by the writer's
   * grant now and the next count; a save formed and not taken is the
   * life's until it is. */
  const formSave = (key: string): SaveStep => {
    const standing = formed.get(key);
    if (standing !== undefined) return standing;
    const delta = pending.get(key)?.delta ?? {};
    pending.delete(key);
    const writer = options.writer();
    saves += 1;
    const save: SaveStep = {
      writer: writer.writer,
      grant: writer.grant,
      count: saves,
      callsIn: delta.callsIn ?? 0,
      callsOut: delta.callsOut ?? 0,
      tokensIn: delta.tokensIn ?? 0,
      tokensOut: delta.tokensOut ?? 0,
      costUsd: delta.costUsd ?? 0,
      unpriced: delta.unpriced ?? 0,
      at: Date.now(),
    };
    formed.set(key, save);
    return save;
  };

  /** Forgets everything held for a life the store said ended. */
  const forgetLife = (key: string): void => {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index]?.key === key) queue.splice(index, 1);
    }
    pending.delete(key);
    formed.delete(key);
    waiting.delete(key);
    refreshes.delete(key);
    settleFollowers();
  };

  /** One life's next part: the items it holds, oldest first, by count
   * and by bytes, at least one. */
  const partItems = (key: string): Item[] => {
    const taken: Item[] = [];
    let bytes = 0;
    for (const item of queue) {
      if (item.key !== key) continue;
      if (taken.length > 0 && (taken.length >= batchSize || bytes + item.bytes > BATCH_BYTES_CAP))
        break;
      taken.push(item);
      bytes += item.bytes;
    }
    return taken;
  };

  /** Delivers one life's parts until it holds nothing, the store does
   * not answer, or the life ended. */
  const deliverLife = async (key: string): Promise<void> => {
    for (let parts = 1; parts <= PARTS_PER_DRAIN; parts += 1) {
      const life = lifeOfKey(key);
      if (life === undefined) return;
      if (ended.has(`${life.service}\u0000${life.life}`)) {
        forgetLife(key);
        return;
      }
      const items = partItems(key);
      const due = refreshes.get(key);
      if (items.length === 0 && !pending.has(key) && !formed.has(key) && due === undefined) return;
      const save = formSave(key);
      const facts = items.flatMap((item) => (item.fact === undefined ? [] : [item.fact]));
      // The begin fact of every run the part carries records of rides
      // with it again, once, unless the part carries it already; the
      // same fact kept under another life is asked again there.
      const carried = new Set(
        facts.map((fact) => begunKey(key, fact.story, fact.attempt, fact.run) + fact.fact),
      );
      for (const item of items) {
        if (item.record === undefined) continue;
        const { story, attempt, run } = item.record;
        askRefreshes(key, story, attempt, run);
        const at = begunKey(key, story, attempt, run);
        if (carried.has(`${at}began`)) continue;
        const fact = begunOf(key, story, attempt, run);
        if (fact === undefined) continue;
        carried.add(`${at}began`);
        facts.push(fact);
      }
      // The begin facts asked again under this life, which keeps none of
      // their runs' records.
      const asked = [...(due?.entries() ?? [])];
      for (const [at, fact] of asked) {
        if (carried.has(`${at}began`)) continue;
        carried.add(`${at}began`);
        facts.push(fact);
      }
      const part: LifePart = {
        service: life.service,
        life: life.life,
        save,
        records: items.flatMap((item) => (item.record === undefined ? [] : [item.record])),
        facts,
        pointers: items.flatMap((item) => (item.pointer === undefined ? [] : [item.pointer])),
        expires: Date.now() + options.retentionMs(),
      };
      let answer: SaveAnswer;
      try {
        answer = await options.write(part);
      } catch {
        answer = 'unknown';
      }
      if (answer === 'unknown') {
        waiting.add(key);
        return;
      }
      waiting.delete(key);
      if (answer === 'ended') {
        ended.add(`${life.service}\u0000${life.life}`);
        forgetLife(key);
        return;
      }
      // Taken: the save is in the totals, once, and the items stored.
      formed.delete(key);
      for (const item of items) {
        const index = queue.indexOf(item);
        if (index !== -1) queue.splice(index, 1);
      }
      for (const [at] of asked) due?.delete(at);
      if (due?.size === 0) refreshes.delete(key);
      settleFollowers();
      if (!queue.some((item) => item.key === key) && !pending.has(key) && !refreshes.has(key))
        return;
    }
    // The rest waits for the next drain, after the other lives' turns.
  };

  /** One drain: every life with something to store, each by itself, in
   * the order its oldest item came. */
  const drainOnce = async (): Promise<void> => {
    const keys: string[] = [];
    for (const item of queue) if (!keys.includes(item.key)) keys.push(item.key);
    for (const key of [...pending.keys(), ...formed.keys(), ...refreshes.keys()])
      if (!keys.includes(key)) keys.push(key);
    for (const key of keys) await deliverLife(key);
    // The begin facts those parts asked again under other lives go in
    // the same drain.
    for (const key of [...refreshes.keys()]) await deliverLife(key);
  };

  // One drain at a time; a drain asked for while one runs shares it,
  // so a closer can wait on the part already on its way.
  const drain = (): Promise<void> => {
    inflight ??= drainOnce().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };

  // The timer is armed when something is queued or counted and idle
  // otherwise: a process with nothing to say does nothing, so an idle
  // agent sits swapped out on its node. A drain that leaves something
  // behind (a store away, a part to send again) arms the next one.
  let timer: NodeJS.Timeout | undefined;
  const holding = (): boolean =>
    queue.length > 0 || pending.size > 0 || formed.size > 0 || refreshes.size > 0;
  const arm = (): void => {
    if (timer !== undefined || closed) return;
    timer = setTimeout(() => {
      timer = undefined;
      void drain().finally(() => {
        if (holding()) arm();
      });
    }, intervalMs);
    timer.unref();
  };

  /** Queues an item and tells the followers it matches. */
  const take = (item: Item): void => {
    queue.push(item);
    keepOver(item);
    holdBound();
    for (const follower of followers) if (follower.matches(item)) follower.send(item);
    arm();
  };

  const sink: TraceSink = {
    record(record) {
      if (closed) return;
      place += 1;
      const bounded = { ...boundedRecord(record), place };
      const text = encodeJson(bounded);
      take({
        key: OWN,
        under: undefined,
        story: bounded.callId,
        bytes: Buffer.byteLength(text),
        text,
        record: {
          story: bounded.callId,
          call: callOfStory(bounded.callId),
          attempt: bounded.attemptId ?? '',
          seq: bounded.seq,
          kind: bounded.kind,
          run: bounded.run ?? '',
          place,
          at: bounded.at,
          text,
        },
      });
    },
    fact(fact, under) {
      if (closed) return;
      // Each text it says is bounded, so a failure's words of any length
      // leave the fact one item the store takes.
      const says = Object.fromEntries(
        Object.entries(fact.says).map(([field, value]) => [
          field,
          typeof value === 'string' ? cutText(value, FACT_TEXT_BYTES_KEPT) : value,
        ]),
      );
      // The request's id rides as `callId`, as a record carries it.
      const text = encodeJson({
        ...says,
        callId: fact.story,
        attempt: fact.attempt,
        run: fact.run,
        fact: fact.fact,
        agentId: fact.agentId,
        began: fact.began,
      });
      const key = keyOf(under);
      const row: FactRow = {
        story: fact.story,
        call: callOfStory(fact.story),
        attempt: fact.attempt,
        run: fact.run,
        fact: fact.fact,
        agent: fact.agentId,
        began: fact.began,
        text,
      };
      if (fact.fact === 'began') {
        const at = begunKey(key, fact.story, fact.attempt, fact.run);
        begun.set(at, row);
        keepBounded(begun);
        requestBegun.set(requestKey(key, fact.story, fact.attempt), row);
        keepBounded(requestBegun);
        // Written now under this life: its next writing here is a
        // refresh's away.
        refreshedAt.set(at, Date.now());
        keepBounded(refreshedAt);
        const under = underKey(fact.story, fact.attempt);
        begunUnder.set(under, (begunUnder.get(under) ?? new Set<string>()).add(key));
        keepBounded(begunUnder);
      } else if (fact.fact === 'ended') {
        const at = begunKey(key, fact.story, fact.attempt, fact.run);
        begun.delete(at);
        refreshedAt.delete(at);
        const due = refreshes.get(key);
        due?.delete(at);
        if (due?.size === 0) refreshes.delete(key);
        const request = requestKey(key, fact.story, fact.attempt);
        if (requestBegun.get(request)?.run === fact.run) requestBegun.delete(request);
        // The run ended under this life: its begin is refreshed here no
        // more, and an ended call keeps nothing, so the bound keeps the
        // calls that still run (a long request's linked calls end long
        // before the request is over).
        const under = underKey(fact.story, fact.attempt);
        const lives = begunUnder.get(under);
        lives?.delete(key);
        if (lives?.size === 0) begunUnder.delete(under);
      } else {
        // The request and the calls linked inside it are over, under
        // every life their begin facts were kept under.
        const own = `\u0000${fact.story}\u0000`;
        const linked = `\u0000${fact.story}~`;
        const named = (at: string): boolean => at.includes(own) || at.includes(linked);
        for (const map of [begun, requestBegun, refreshedAt, ...refreshes.values()])
          for (const at of [...map.keys()]) if (named(at)) map.delete(at);
        for (const at of [...begunUnder.keys()]) if (named(`\u0000${at}`)) begunUnder.delete(at);
        for (const [life, due] of [...refreshes]) if (due.size === 0) refreshes.delete(life);
      }
      take({
        key,
        under,
        story: fact.story,
        bytes: Buffer.byteLength(text),
        text,
        fact: row,
      });
    },
    pointer(pointer) {
      if (closed) return;
      const row: PointerRow = {
        parent: pointer.parent,
        child: pointer.child,
        agent: pointer.agentId,
        attempt: pointer.attempt,
        seq: pointer.seq,
        turn: pointer.turn,
      };
      const text = encodeJson(row);
      take({
        key: OWN,
        under: undefined,
        story: pointer.parent,
        bytes: Buffer.byteLength(text),
        text,
        pointer: row,
      });
    },
    count(delta, under) {
      if (closed) return;
      const key = keyOf(under);
      const held = pending.get(key) ?? { under, delta: {} };
      for (const field of DELTA_FIELDS) {
        const amount = delta[field];
        if (amount !== undefined && amount !== 0)
          held.delta[field] = (held.delta[field] ?? 0) + amount;
      }
      pending.set(key, held);
      arm();
    },
  };

  return {
    sink,
    flush: () => drain(),
    formSaves: () => {
      for (const key of [...pending.keys()]) if (!formed.has(key)) formSave(key);
    },
    follow: (story, send, done) => {
      // The word that the story followed is over: a request's `over`
      // fact. A linked call keeps none: it is over once its latest run
      // ended, or at the `over` fact of the request it ran inside, which
      // ends the calls linked inside it. Its latest run is the latest in
      // the order of runs among its own records and facts, so the end of
      // an earlier run, the queue's or a late one, ends no follow while a
      // later run goes on.
      const linked = story !== undefined && isLinked(story);
      const request = story === undefined ? undefined : requestOfStory(story);
      const requestOver = (item: Item): boolean =>
        item.fact?.fact === 'over' && (item.fact.story === story || item.fact.story === request);
      let latest: { run: string; ended: boolean } | undefined;
      let requestEnded = false;
      const learn = (item: Item): void => {
        if (!linked || item.story !== story || item.pointer !== undefined) return;
        const run = item.record?.run ?? item.fact?.run;
        if (run === undefined) return;
        if (latest === undefined || compareRuns(run, latest.run) > 0)
          latest = { run, ended: false };
        if (item.fact?.fact === 'ended' && compareRuns(run, latest.run) === 0) latest.ended = true;
      };
      const latestEnd = (item: Item): boolean =>
        linked &&
        item.story === story &&
        item.fact?.fact === 'ended' &&
        latest !== undefined &&
        compareRuns(item.fact.run, latest.run) === 0;
      const forward = (item: Item): void => {
        if (story === undefined) {
          if (item.record !== undefined || item.fact?.fact === 'over') send(item.text);
          return;
        }
        if (item.record !== undefined) send(item.text);
        else if (requestOver(item)) {
          send(item.text);
          requestEnded = true;
        } else if (latestEnd(item)) send(item.text);
        follower.over = requestEnded || (linked && latest?.ended === true);
      };
      const follower: Follower = {
        matches: (item) =>
          story === undefined ||
          item.story === story ||
          item.story.startsWith(`${story}~`) ||
          requestOver(item),
        send: (item) => {
          learn(item);
          forward(item);
        },
        over: false,
        done: story === undefined ? undefined : done,
      };
      // What the store has not taken yet comes first, the part on its
      // way included, its runs learned whole before anything is told;
      // then everything as it is made.
      const held = queue.filter((item) => follower.matches(item));
      for (const item of held) learn(item);
      for (const item of held) forward(item);
      // A story the store took whole before the follow came is told
      // that it is over, and let go.
      if (story !== undefined && !follower.over) {
        const known = linked ? ends.get(story) : undefined;
        const runsOn =
          latest !== undefined && (known === undefined || compareRuns(latest.run, known.run) > 0);
        const said = linked
          ? ((runsOn ? undefined : known?.ended) ?? overs.get(requestOfStory(story)))
          : overs.get(story);
        if (said !== undefined) {
          send(said);
          follower.over = true;
        }
      }
      followers.add(follower);
      settleFollowers();
      return () => {
        followers.delete(follower);
      };
    },
    close: async () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      // The queue stays open while this flush runs, and closes after
      // it: work that is still finishing writes its last records into
      // this flush (a drained program's end record lands a millisecond
      // after the reply), and a queue closed at the top would drop
      // exactly those. A store that stays away past the budget costs
      // the tail, and the process still exits.
      const budgetMs = options.closeRetryMs ?? CLOSE_RETRY_MS;
      const started = Date.now();
      let pause = 100;
      while (inflight !== undefined || holding()) {
        await drain();
        if (!holding()) break;
        if (Date.now() - started + pause > budgetMs) break;
        await sleepMs(pause);
        pause = Math.min(pause * 2, 2000);
      }
      closed = true;
      followers.clear();
    },
    dropped: () => droppedCount,
  };
}
