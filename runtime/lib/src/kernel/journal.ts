// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A copy's journal: its log as the process holds it, and the replay
// engine over it. The log is one table the copy owns by a grant
// (log.ts, substrate.ts): every record this process writes is
// appended under the head, serialized, write-ahead, and refused for
// good once another process owns the log. The journal keeps the state
// the records make (the requests taken and answered here, the
// requests sent and answered to here, the newest mark), the two sets
// the resend and the dedup read off it, and the open state a mark
// carries.
//
// The code's durable operations are commands, numbered in the order the
// code creates them inside one body (the lane named by the request the
// body runs under; the program's own takes in the root lane). A command
// that must be durable before it acts (a call, a timer) writes its
// creation record (`request sent`, `observed armed`) and every command
// writes a completion (`response ack`, `observed`, `request ack` for a
// take, `response sent` for a body's answer) when it settles. Replay
// drives the same code over the recorded history inside a scope: a
// service's program replays every body in the one order the records
// have, since its bodies share its memory; a task's or a worker's body
// replays alone from its own records. A command the code creates is
// matched to its ordinal's records, completions are released in the
// recorded order and one per macrotask so races settle as they did
// live, and a command the history never completed becomes live again
// only once every recorded completion has been released: the wait for
// a request's response (which the resend keeps posting), the re-arming
// of a timer from its due moment. A request whose response said
// "again" is a closed pair: the next attempt creates the command anew,
// under a new request.

import { debuglog } from 'node:util';
import { setImmediate as nextTurn } from 'node:timers/promises';

import {
  CernantoError,
  errorWords,
  isSecretFailure,
  markSecretFailure,
} from '../language/errors.js';
import { wallNowMs } from './clock.js';
import { repeatsAttempt, substrate, substrateTrouble } from './connection.js';
import { crashAt } from './faults.js';
import type { FaultPoint } from './faults.js';
import { LEASE_MS, processFacts } from './facts.js';
import { noteIdleChange } from './idle-signal.js';
import { sleepMs } from './lifetime.js';
import {
  applyEntry,
  commandKey,
  entryOf,
  openOf,
  owedResponses,
  rowOf,
  saysAgain,
  stateOf,
  unackedRequests,
} from './log.js';
import type {
  CheckpointStarted,
  Destination,
  Entry,
  LogRecord,
  LogState,
  RecordedError,
  RequestAck,
  RequestSent,
  ResponseAck,
  ResponseSent,
  Sent,
  Taken,
} from './log.js';
import { logRefused } from './substrate.js';
import type { LogHead, Logs, Substrate } from './substrate.js';
import { kernelSay } from '../traces/observe.js';

export type { RecordedError } from './log.js';

const debug = debuglog('cernanto-journal');

/** A thrown value as a record carries it. */
export function recordedError(error: unknown): RecordedError {
  const kind =
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { kind?: unknown }).kind === 'string'
      ? (error as { kind: string }).kind
      : 'terminal';
  const message = errorWords(error);
  const status = (error as { status?: unknown } | null)?.status;
  const body = (error as { body?: unknown } | null)?.body;
  return {
    kind,
    message,
    ...(typeof status === 'number' ? { status } : {}),
    ...(body === undefined ? {} : { body }),
    ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    ...(isSecretFailure(error) ? { secret: true as const } : {}),
  };
}

/** A recorded failure back as an error the code can catch, with its
 * kind and its declared answer on it. */
export function errorFromRecord(recorded: RecordedError): Error {
  const kinds = new Set([
    'terminal',
    'retryable',
    'judgment-inconclusive',
    'contract-violation',
    'target-unavailable',
  ]);
  const error = new CernantoError({
    kind: (kinds.has(recorded.kind) ? recorded.kind : 'terminal') as CernantoError['kind'],
    message: recorded.message,
    ...(recorded.status === undefined
      ? {}
      : {
          details: {
            status: recorded.status,
            ...(recorded.body === undefined ? {} : { body: recorded.body }),
          },
        }),
  });
  if (recorded.status !== undefined) {
    Object.assign(error, {
      status: recorded.status,
      ...(recorded.body === undefined ? {} : { body: recorded.body }),
    });
  }
  if (recorded.secret === true) markSecretFailure(error);
  return error;
}

/** How long a write is asked again through the store's own trouble
 * before it is one of unknown outcome: three leases of the copy's
 * holding (the plane's lease where no holding names one). */
const UNCONFIRMED_PATIENCE_LEASES = 3;

function unconfirmedPatienceMs(): number {
  return UNCONFIRMED_PATIENCE_LEASES * (processFacts().holder?.leaseMs ?? LEASE_MS);
}

/** How many records every journal of this process appended so far,
 * and their bytes: the bound's units. */
let appendsCount = 0;
let appendsBytes = 0;

export function journalAppendBytes(): number {
  return appendsBytes;
}
export function journalAppends(): number {
  return appendsCount;
}

/** What an append to a journal that ended fails with: the log is no
 * longer this process's to write (another process owns it, or this
 * process let it go), so the body it belongs to is cut, never retried
 * here. */
function journalEnded(log: string, words: string): CernantoError {
  return new CernantoError({
    kind: 'retryable',
    message: `the log ${log} is no longer this process's to write: ${words}`,
    details: { fenced: true },
  });
}

/** The error that ends a process whose log another process owns. */
function fencedByOwner(log: string, words: string): CernantoError {
  return new CernantoError({
    kind: 'retryable',
    message: `another process owns the log ${log}; this one stops: ${words}`,
    details: { fenced: true, newerHolder: true },
  });
}

/** Whether an error says another process owns the log it was writing:
 * a refusal that stands, never asked again. */
export function newerHolderOwns(error: unknown): boolean {
  return error instanceof CernantoError && error.details?.['newerHolder'] === true;
}

/** What an operation of an attempt that has ended fails with. */
function attemptEnded(): CernantoError {
  return new CernantoError({
    kind: 'retryable',
    message: 'this call attempt has ended; its work is being stopped',
  });
}

/** What a logical mark fails with when a body is active in the chain's
 * turn: a take that landed since the look would stand below the mark
 * with no image to continue it. */
function markDeclined(active: number): CernantoError {
  return new CernantoError({
    kind: 'retryable',
    message: `the mark is declined: ${String(active)} ${active === 1 ? 'body is' : 'bodies are'} active`,
  });
}

/** What a response ack's creator throws when a delivery that landed
 * meanwhile acked the response: nothing is written. */
function ackedMeanwhile(): CernantoError {
  return new CernantoError({
    kind: 'retryable',
    message: 'the response was acked meanwhile',
    details: { ackedMeanwhile: true },
  });
}

function isAckedMeanwhile(error: unknown): boolean {
  return error instanceof CernantoError && error.details?.['ackedMeanwhile'] === true;
}

/** What a served process does with a write of unknown outcome: the
 * kernel retires the process, so the next life reads the log as it
 * stands (a response that landed is posted again, a take that never
 * landed is met anew) where this one can neither read nor write it. */
let unsureHandler: ((log: string, cause: string) => void) | undefined;

export function onUnsureWrite(handler: ((log: string, cause: string) => void) | undefined): void {
  unsureHandler = handler;
}

/** What a command of a body ended by its recorded answer fails with:
 * the body's code runs no further, since the life that answered never
 * reached this command and the memory is rebuilt as that life left it. */
function endedByHistory(): CernantoError {
  return new CernantoError({
    kind: 'retryable',
    message: 'this call ended in the life that answered it: the record is its answer',
    details: { endedByHistory: true },
  });
}

/** Whether a failure is a body's end by its recorded answer. */
export function endedByRecordedAnswer(error: unknown): boolean {
  return error instanceof CernantoError && error.details?.['endedByHistory'] === true;
}

/** A settled command: its answer, whether it came from the journal (a
 * replay) or from the world, and the ordinal it ran under. */
export interface Settled<Done> {
  done: Done;
  replayed: boolean;
  ordinal: number;
}

/** What a command declares. */
export interface CommandSpec<Done> {
  /** The kind names the records: a `call` (request sent, response ack),
   * a `lane` operation, a `timer` (armed, then fired or cleared), a
   * `cancel`, a program's `take` (request ack) and a body's `answered`
   * (response sent). */
  kind: 'call' | 'lane' | 'timer' | 'cancel' | 'take' | 'answered';
  /** The words compared on replay beside the kind (a call's target, a
   * lane's label). */
  label?: string;
  /** A timer's code site: its records in a lane of their own under the
   * body's, matched by their order at that site alone. */
  site?: string;
  /** Mints the creation record the first time the command runs, from
   * the ordinal (a call chooses its destination first); a replay hands
   * the recorded one back instead. */
  creation?: (ordinal: number) => LogRecord | Promise<LogRecord>;
  /** Settles the command in the world; the signal ends it when the
   * body's attempt does. A retryable failure stays out of the journal:
   * it unwinds the attempt, and the next attempt creates the command
   * again. */
  run: (creation: Entry | undefined, signal: AbortSignal) => Promise<Done>;
  /** The record of a terminal failure of the run (a lane operation the
   * world refused for good), when the kind keeps one: a replay then
   * fails the command from the record instead of running it again. A
   * retryable failure and an attempt's end record nothing. */
  failure?: (error: unknown, ordinal: number) => LogRecord | undefined;
  /** The completion as the journal keeps it; nothing when the answer
   * is recorded by another road already (a call's response ack, which
   * the desk records as it takes the response) or records nothing (a
   * take at a drain). */
  completion: (done: Done, ordinal: number) => LogRecord | undefined;
  /** The answer from a recorded completion on replay; throws for a
   * recorded failure. */
  settle: (entry: Entry) => Done;
  /** Called once the completion is in the journal, with it. */
  recorded?: (entry: Entry) => void;
}

/** What the facade's backend needs of a journal: one lane of it. */
export interface CommandJournal {
  readonly log: string;
  readonly lane: string;
  command<Done>(spec: CommandSpec<Done>): Promise<Settled<Done>>;
  /** The call id of the lane's command at an ordinal: the body's own
   * call id and the ordinal, replay-stable. */
  callIdFor(ordinal: number): string;
  isReplaying(): boolean;
  /** One synchronous observation (a random draw of the agent's own
   * code): recorded as its value in a soft lane named by the draw's
   * code site, answered from the record on replay. */
  observe<T extends string | number>(live: () => T, site?: string): T;
  /** Resolves once the log holds every draw made live so far, and
   * rejects when one of them did not land: what a linked module's call
   * waits on before the module runs, so a draw it is handed stands in
   * the log before the module acts on it. */
  drawsLanded(): Promise<void>;
  /** The moment the code's clock reads while this lane's history
   * replays; undefined once the lane's code is live. */
  replayMoment(): number | undefined;
  /** The destination a request sent from this log was pinned to, when
   * the log holds the request. */
  destinationOf(request: string): Destination | undefined;
}

interface Pending {
  lane: string;
  created: number;
  ordinal: number;
  spec: CommandSpec<unknown>;
  creation: Entry | undefined;
  resolve: (settled: Settled<unknown>) => void;
  reject: (error: unknown) => void;
  activated: boolean;
  attempt: number;
  signal: AbortSignal;
  /** The run's own end: a completion of the command that landed from
   * elsewhere (another life's record, taken in at a resume), after
   * which the run has nothing left to do and the command settles from
   * the record. */
  own: AbortController;
  letGo?: boolean;
}

/** What an append's creator throws when the record it would write
 * stands already (another attempt's, or another life's taken in at a
 * resume): the command goes on from the standing record. */
class RecordStands extends Error {
  readonly entry: Entry;

  constructor(entry: Entry) {
    super('the record stands already');
    this.name = 'RecordStands';
    this.entry = entry;
  }
}

interface Slot {
  creation?: Entry | undefined;
  completion?: Entry | undefined;
  /** The request the slot's pair is of, for a call. */
  request?: string | undefined;
}

/** One record's place in the engine: its key (the lane and the ordinal
 * there), whether it is a creation, and the request it is of. */
interface Placed {
  key: string;
  lane: string;
  ordinal: number;
  creation: boolean;
  request?: string;
}

/** The lane of a soft record: the body's lane and the site. */
function softLane(mainLane: string, kind: 't' | 'd', site: string): string {
  return `${mainLane}|${kind}:${site}`;
}

function isSoftLane(lane: string): boolean {
  return lane.includes('|t:') || lane.includes('|d:');
}

/** The main lane a soft lane belongs to (itself for a main lane). */
function mainLaneOf(lane: string): string {
  const at = lane.indexOf('|');
  return at === -1 ? lane : lane.slice(0, at);
}

function laneKey(lane: string, ordinal: number): string {
  return `${lane}#${String(ordinal)}`;
}

/** The root lane: the program's own takes. */
export const ROOT_LANE = '';

/** The key of a body's answer in its lane. */
function answeredKey(request: string): string {
  return `${request}#answered`;
}

/** The scope of a replay: the lanes replayed together under one
 * attempt, with one pump releasing their records in the recorded
 * order. A service's program is one scope over every lane; a task's or
 * a worker's body is a scope of its own. */
class Scope {
  readonly journal: Journal;
  readonly name: string;
  /** The scope starts live, past the records that stand: a program
   * whose memory was in an image that is gone begins anew, and
   * replays nothing of the history the lost memory continued. */
  liveFromStart = false;
  /** Whether an entry belongs to this scope. */
  private readonly owns: (entry: Entry) => boolean;
  private attempt = 0;
  private attemptSignal: AbortSignal = new AbortController().signal;
  private onDiverge: ((error: Error) => void) | undefined;
  diverged: Error | undefined;
  private readonly counters = new Map<string, number>();
  private created = 0;
  private readonly pending = new Map<string, Pending>();
  private byOrdinal = new Map<string, Slot>();
  private releases: Entry[] = [];
  private releaseIndex = 0;
  private mainReleasesLeft = 0;
  private readonly consumed = new Set<string>();
  private openCreations = new Map<string, Entry>();
  private readonly mainLive = new Set<string>();
  private readonly deferred: Pending[] = [];
  private pumping = false;
  private releasedAtWall = 0;
  private clockBase: number | undefined;
  private lastResumeAt: number | undefined;
  private takes = 0;
  /** The appends of the draws this attempt made live, one after the
   * other: settled once the log holds every one of them. */
  private drawn: Promise<void> = Promise.resolve();
  /** The moment the scope's history begins: the replay clock's base. */
  private readonly startedAt: number | undefined;

  constructor(
    journal: Journal,
    name: string,
    owns: (entry: Entry) => boolean,
    startedAt: number | undefined,
  ) {
    this.journal = journal;
    this.name = name;
    this.owns = owns;
    this.startedAt = startedAt;
  }

  get attemptUnderWay(): number {
    return this.attempt;
  }

  /** The place of an entry in this scope's engine; nothing for a record
   * of the log's own (a mark). The takes are numbered as they are met,
   * in order. */
  private place(entry: Entry, count: { takes: number }): Placed | undefined {
    switch (entry.type) {
      case 'request sent':
        return {
          key: commandKey(entry.data.parent, entry.data.ordinal),
          lane: entry.data.parent,
          ordinal: entry.data.ordinal,
          creation: true,
          request: entry.data.request,
        };
      case 'response ack':
        return {
          key: commandKey(entry.data.parent, entry.data.ordinal),
          lane: entry.data.parent,
          ordinal: entry.data.ordinal,
          creation: false,
          request: entry.data.request,
        };
      case 'observed': {
        const lane =
          entry.data.site === undefined
            ? entry.data.parent
            : softLane(
                entry.data.parent,
                entry.data.kind === 'random' ? 'd' : 't',
                entry.data.site,
              );
        return {
          key: laneKey(lane, entry.data.ordinal),
          lane,
          ordinal: entry.data.ordinal,
          creation: entry.data.phase === 'armed',
        };
      }
      case 'request ack': {
        // The take is the program's command: a body's scope reads its
        // own ack as nothing to release. A pointer (the request taken as
        // its own by a sibling while this slot was gone, program.ts) is
        // no take of this program's: nothing of it runs here.
        if (this.name !== ROOT_LANE || entry.data.takenBy !== undefined) return undefined;
        count.takes += 1;
        noteTakeOrdinal(entry, count.takes);
        return {
          key: laneKey(ROOT_LANE, count.takes),
          lane: ROOT_LANE,
          ordinal: count.takes,
          creation: false,
        };
      }
      case 'response sent':
        // The answer is the program's command in the body's lane; a
        // body's own scope (a task's, a worker's) answers outside the
        // engine, and reads the record as nothing to release.
        if (this.name !== ROOT_LANE) return undefined;
        return {
          key: answeredKey(entry.data.request),
          lane: entry.data.request,
          ordinal: 0,
          creation: false,
          request: entry.data.request,
        };
      case 'checkpoint started':
      case 'checkpoint done':
        return undefined;
    }
  }

  /** Starts the next attempt once everything the attempts before it
   * handed to the log has settled there. */
  async nextAttempt(
    signal: AbortSignal,
    onDiverge?: (error: Error) => void,
    options: { pipelined?: boolean } = {},
  ): Promise<void> {
    if (options.pipelined !== true) await this.journal.settled();
    this.reset(signal, onDiverge);
  }

  /** Starts an attempt over the recorded history: counters back to
   * the first ordinal, every recorded completion pending release. */
  reset(signal: AbortSignal, onDiverge?: (error: Error) => void): void {
    this.attempt += 1;
    this.attemptSignal = signal;
    this.onDiverge = onDiverge;
    this.diverged = undefined;
    this.counters.clear();
    this.created = 0;
    this.pending.clear();
    this.deferred.length = 0;
    this.releaseIndex = 0;
    this.consumed.clear();
    this.byOrdinal = new Map();
    this.releases = [];
    this.openCreations = new Map();
    this.releasedAtWall = wallNowMs();
    this.lastResumeAt = undefined;
    this.takes = 0;
    this.drawn = Promise.resolve();
    const first = this.journal.entries.find((entry) => this.owns(entry));
    this.clockBase = this.startedAt ?? (first === undefined ? undefined : momentOf(first));
    this.mainLive.clear();
    const count = { takes: 0 };
    for (const entry of this.journal.entries) {
      if (this.liveFromStart) break;
      if (!this.owns(entry)) continue;
      const placed = this.place(entry, count);
      if (placed === undefined) continue;
      this.note(placed, entry, true);
    }
    this.takes = count.takes;
    this.mainReleasesLeft = this.releases.filter(
      (entry) => !isSoftLane(laneOfRelease(entry)),
    ).length;
    for (const [key, slot] of this.byOrdinal) {
      if (slot.creation !== undefined && slot.completion === undefined)
        this.openCreations.set(key, slot.creation);
    }
  }

  /** Notes one placed record in the slots: a creation opens its slot
   * (a newer creation of the same command supersedes the earlier pair),
   * a completion closes it (one that says "again" clears the slot, so the next creation starts anew, and is released to
   * nobody). Answers whether the record is a completion of the current
   * slot, released in its turn. */
  private note(placed: Placed, entry: Entry, atReset: boolean): boolean {
    const slot = this.byOrdinal.get(placed.key);
    if (placed.creation) {
      if (slot !== undefined && slot.request !== undefined && slot.request !== placed.request) {
        // A newer request of the same command: the earlier pair stands
        // superseded, and this slot begins anew.
        this.byOrdinal.set(placed.key, { creation: entry, request: placed.request });
      } else if (slot === undefined) {
        this.byOrdinal.set(placed.key, { creation: entry, request: placed.request });
      } else {
        slot.creation = entry;
        slot.request = placed.request;
      }
      return false;
    }
    // A completion of another request than the slot's (a stale
    // attempt's response, acked for the record) belongs to no command.
    if (
      slot !== undefined &&
      placed.request !== undefined &&
      slot.request !== undefined &&
      slot.request !== placed.request
    )
      return false;
    if (entry.type === 'response ack' && saysAgain(entry.data.outcome)) {
      this.byOrdinal.delete(placed.key);
      return false;
    }
    if (slot === undefined)
      this.byOrdinal.set(placed.key, { completion: entry, request: placed.request });
    else slot.completion = entry;
    if (atReset) this.releases.push(entry);
    return true;
  }

  /** A record landed in the journal while this scope runs: one of this
   * process's own writes (noted, nothing to release: the command that
   * wrote it settles from it), or the desk's record of a response (the
   * completion of a call in flight here, or of a command the code has
   * not created yet on this attempt: released in order). */
  noticed(entry: Entry, imported = false): void {
    if (!this.owns(entry)) return;
    const count = { takes: this.takes };
    const placed = this.place(entry, count);
    this.takes = count.takes;
    if (placed === undefined) return;
    const waiting = this.pending.get(placed.key);
    const completion = this.note(placed, entry, false);
    if (!completion) {
      if (placed.creation && !this.pending.has(placed.key))
        this.openCreations.set(placed.key, entry);
      // An answer taken in at a resume that says again, for a command
      // whose run waits here on an answer nobody will hand it: the
      // command hears the recorded failure in its turn of the releases
      // and its attempt asks anew, the pair closed.
      if (
        imported &&
        waiting?.activated === true &&
        entry.type === 'response ack' &&
        saysAgain(entry.data.outcome)
      ) {
        waiting.own.abort();
        this.release(placed, entry);
      }
      return;
    }
    this.openCreations.delete(placed.key);
    const pending = this.pending.get(placed.key);
    if (pending?.activated === true) {
      // The command's own run settles from it: nothing to release. A
      // record taken in at a resume is another life's (its answer, its
      // take), which the run, waiting for an answer that life took, may
      // never hear: the command is settled from the record in its turn
      // of the releases, like every recorded completion, and the run,
      // obsolete, is ended where it listens.
      if (!imported) return;
      pending.own.abort();
    }
    this.release(placed, entry);
  }

  /** Queues a recorded completion for the pump, which hands it to its
   * command in the recorded order. */
  private release(placed: Placed, entry: Entry): void {
    this.releases.push(entry);
    if (!isSoftLane(placed.lane)) this.mainReleasesLeft += 1;
    this.pump();
  }

  isReplaying(): boolean {
    return this.mainReleasesLeft > 0;
  }

  private historyAhead(lane: string): boolean {
    if (this.mainReleasesLeft > 0) return true;
    for (const [, record] of this.openCreations) {
      if (mainLaneOf(laneOfRelease(record)) === lane && !this.movedPast(record)) return true;
    }
    return false;
  }

  replayMoment(lane: string): number | undefined {
    if (!this.historyAhead(lane) || this.clockBase === undefined) return undefined;
    return this.clockBase + (wallNowMs() - this.releasedAtWall);
  }

  private resumeAt(entry: Entry): void {
    const index = this.journal.entries.indexOf(entry);
    const next = index === -1 ? undefined : this.journal.entries[index + 1];
    const resumed = next === undefined ? undefined : resumedOf(next);
    this.clockBase = resumed ?? momentOf(entry) ?? this.clockBase;
    this.releasedAtWall = wallNowMs();
  }

  lane(name: string): CommandJournal {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const scope = this;
    return {
      log: scope.journal.log,
      lane: name,
      command: (spec) => scope.command(spec, name),
      callIdFor: (ordinal) => scope.journal.callIdFor(name, ordinal),
      isReplaying: () => scope.isReplaying(),
      observe: (live, site) => scope.observe(live, name, site),
      drawsLanded: () => scope.drawsLanded(),
      replayMoment: () => scope.replayMoment(name),
      destinationOf: (request) => scope.journal.state.sent.get(request)?.sent.to,
    };
  }

  /** Whether the history holds the completion of a lane's answer. */
  answeredInHistory(request: string): boolean {
    return this.byOrdinal.get(answeredKey(request))?.completion !== undefined;
  }

  /** How many durable operations one lane has outstanding. */
  outstanding(lane: string): number {
    let count = 0;
    for (const pending of this.pending.values())
      if (mainLaneOf(pending.lane) === lane && pending.spec.kind !== 'take') count += 1;
    return count;
  }

  /** What each main lane has pending, for the idle report: the
   * journaled waits (a call's response awaited, a timer armed) and the
   * work (a lane operation to the world, an answer on its way out); the
   * kernel's own commands count as neither. */
  pendingByLane(): Map<string, { waits: number; work: number }> {
    const lanes = new Map<string, { waits: number; work: number }>();
    for (const pending of this.pending.values()) {
      const main = mainLaneOf(pending.lane);
      const kind = pending.spec.kind;
      if (kind === 'take' || kind === 'cancel' || kind === 'answered') continue;
      const lane = lanes.get(main) ?? { waits: 0, work: 0 };
      if (kind === 'call' || kind === 'timer' || !pending.activated) lane.waits += 1;
      else lane.work += 1;
      lanes.set(main, lane);
    }
    return lanes;
  }

  /** Lets a lane of one attempt go: every command of it that has not
   * settled is told that its attempt ended, and writes nothing more. */
  letGo(lane: string, attempt: number, forGood = false): void {
    for (const [key, pending] of [...this.pending]) {
      if (pending.attempt !== attempt || mainLaneOf(pending.lane) !== lane) continue;
      pending.letGo = true;
      this.pending.delete(key);
      const waiting = this.deferred.indexOf(pending);
      if (waiting !== -1) this.deferred.splice(waiting, 1);
      pending.reject(attemptEnded());
    }
    if (!forGood || attempt !== this.attempt) return;
    this.mainLive.delete(lane);
    for (const counted of [...this.counters.keys()]) {
      if (mainLaneOf(counted) === lane) this.counters.delete(counted);
    }
  }

  /** One synchronous observation: the next ordinal of its site's soft
   * lane, its recorded value on replay, the value drawn live and
   * appended otherwise. */
  observe<T extends string | number>(live: () => T, mainLane: string, site: string | undefined): T {
    const lane = softLane(mainLane, 'd', site ?? 'draw');
    const ordinal = (this.counters.get(lane) ?? 0) + 1;
    this.counters.set(lane, ordinal);
    this.created += 1;
    const key = laneKey(lane, ordinal);
    const slot = this.byOrdinal.get(key);
    const completion = slot?.completion;
    if (completion !== undefined && completion.type === 'observed') {
      this.consumed.add(key);
      this.resumeAt(completion);
      this.pump();
      return completion.data.answer as T;
    }
    const value = live();
    const attempt = this.attempt;
    const landed = this.journal
      .append({
        type: 'observed',
        data: {
          parent: mainLane,
          ordinal,
          kind: 'random',
          site: site ?? 'draw',
          answer: value,
          at: wallNowMs(),
        },
      })
      .then(() => undefined);
    landed.catch((error: unknown) => {
      if (attempt !== this.attempt) return;
      const failure = error instanceof Error ? error : new Error(String(error));
      this.diverged = failure;
      this.onDiverge?.(failure);
    });
    // The draw is answered at once and its record follows. Whoever must
    // not act before the record stands waits on the chain of them.
    const after = this.drawn.then(() => landed);
    after.catch(() => undefined);
    this.drawn = after;
    return value;
  }

  /** Resolves once the log holds every draw this attempt made live. */
  drawsLanded(): Promise<void> {
    return this.drawn;
  }

  /** Runs one command: matched against the history when the history
   * holds it, settled in the world otherwise. */
  command<Done>(spec: CommandSpec<Done>, mainLane: string): Promise<Settled<Done>> {
    const lane = spec.site === undefined ? mainLane : softLane(mainLane, 't', spec.site);
    const ordinal = spec.kind === 'answered' ? 0 : (this.counters.get(lane) ?? 0) + 1;
    if (spec.kind !== 'answered') this.counters.set(lane, ordinal);
    this.created += 1;
    const created = this.created;
    const key = spec.kind === 'answered' ? answeredKey(mainLane) : laneKey(lane, ordinal);
    const slot = this.byOrdinal.get(key);
    if (slot !== undefined) {
      this.openCreations.delete(key);
      try {
        this.assertMatches(ordinal, slot, spec as unknown as CommandSpec<unknown>);
      } catch (error) {
        if (error instanceof Error) {
          this.diverged = error;
          this.onDiverge?.(error);
        }
        throw error;
      }
    }
    return new Promise<Settled<Done>>((resolve, reject) => {
      const pending: Pending = {
        lane,
        created,
        ordinal,
        spec: spec as unknown as CommandSpec<unknown>,
        creation: slot?.creation,
        resolve: resolve as (settled: Settled<unknown>) => void,
        reject,
        activated: false,
        attempt: this.attempt,
        signal: this.attemptSignal,
        own: new AbortController(),
      };
      this.pending.set(key, pending);
      if (slot === undefined && spec.site === undefined) this.mainLive.add(mainLane);
      if (spec.site !== undefined && slot?.completion !== undefined) {
        // A soft record is its site's own, answered when the code asks
        // for it whatever the stream's order.
        const completion = slot.completion;
        this.consumed.add(key);
        this.pending.delete(key);
        this.resumeAt(completion);
        try {
          resolve({ done: spec.settle(completion), replayed: true, ordinal });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
        this.pump();
        return;
      }
      if (slot?.completion !== undefined) {
        this.pump();
        return;
      }
      if (this.isReplaying() && spec.site === undefined) {
        this.deferred.push(pending);
        this.pump();
        return;
      }
      if (spec.site !== undefined && slot === undefined) this.pump();
      void this.activate(pending, key);
    });
  }

  private assertMatches(ordinal: number, slot: Slot, spec: CommandSpec<unknown>): void {
    const recorded = slot.creation ?? slot.completion;
    if (recorded === undefined) return;
    const kind = kindOfEntry(recorded);
    const label = labelOfEntry(recorded);
    if (
      kind !== spec.kind ||
      (label !== undefined && spec.label !== undefined && label !== spec.label)
    ) {
      throw new CernantoError({
        kind: 'terminal',
        message:
          `journal mismatch on replay: the code's operation ${String(ordinal)} is ${spec.kind}` +
          `${spec.label === undefined ? '' : ` "${spec.label}"`} but the journal recorded ${kind}` +
          `${label === undefined ? '' : ` "${label}"`}. The code took a different path on replay than it took live; ` +
          'the usual causes: unseeded randomness, machine-varying reads inside a granted package, ' +
          'nondeterministic command output, or live values crossing awaits',
      });
    }
  }

  /** Releases the next recorded completion once its command exists,
   * one per turn of the event loop, and activates what waited for the
   * history to end. */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void (async () => {
      try {
        for (;;) {
          const next = this.releases[this.releaseIndex];
          if (next === undefined) break;
          const key = keyOfRelease(next);
          if (this.consumed.has(key) || isSoftLane(laneOfRelease(next))) {
            this.releaseIndex += 1;
            continue;
          }
          const pending = this.pending.get(key);
          if (pending === undefined) {
            // A body's answer the history holds, whose body still runs
            // on this attempt (it was cut short live, by a cancel or a
            // death, at this very record): the body is ended here as it
            // was then, and its record stands as its answer.
            if (
              next.type === 'response sent' &&
              this.journal.onAnsweredInHistory?.(next, this.name) === true
            ) {
              this.releaseIndex += 1;
              this.resumeAt(next);
              this.mainReleasesLeft -= 1;
              await nextTurn();
              continue;
            }
            debug('%s: waiting for the command of %s (%s)', this.journal.log, key, next.type);
            break;
          }
          debug('%s: releasing %s (%s)', this.journal.log, key, next.type);
          this.releaseIndex += 1;
          this.resumeAt(next);
          this.mainReleasesLeft -= 1;
          this.pending.delete(key);
          pending.letGo = true;
          try {
            pending.resolve({
              done: pending.spec.settle(next),
              replayed: true,
              ordinal: pending.ordinal,
            });
          } catch (error) {
            pending.reject(error);
          }
          await nextTurn();
        }
        if (!this.isReplaying()) {
          const waiting = this.deferred.splice(0).sort((a, b) => a.created - b.created);
          for (const pending of waiting)
            void this.activate(pending, laneKey(pending.lane, pending.ordinal));
        }
      } finally {
        this.pumping = false;
      }
      const waitingFor = this.releases[this.releaseIndex];
      if (waitingFor !== undefined && this.pending.has(keyOfRelease(waitingFor))) this.pump();
    })();
  }

  private movedPast(record: Entry): boolean {
    const main = mainLaneOf(laneOfRelease(record));
    if (this.mainLive.has(main)) return true;
    for (const pending of this.pending.values()) {
      if (mainLaneOf(pending.lane) !== main) continue;
      const slot = this.byOrdinal.get(laneKey(pending.lane, pending.ordinal));
      const own = slot?.completion ?? slot?.creation;
      if (own === undefined) {
        if (!isSoftLane(pending.lane)) return true;
        continue;
      }
      if (own.seq > record.seq) return true;
    }
    return false;
  }

  /** Settles a command in the world and records its completion. */
  private async activate(pending: Pending, key: string): Promise<void> {
    if (pending.activated) return;
    pending.activated = true;
    const { spec, ordinal } = pending;
    const ended = (): boolean =>
      pending.letGo === true || pending.attempt !== this.attempt || pending.signal.aborted;
    const settle = (): void => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    };
    try {
      if (ended()) {
        settle();
        pending.reject(attemptEnded());
        return;
      }
      let creation = pending.creation;
      const recordedMeanwhile = (): Entry | undefined => this.byOrdinal.get(key)?.completion;
      // A command past the body's own recorded answer: one the history
      // holds open (its creation there, no completion), or one the
      // history knows nothing of (the life that answered never reached
      // it, or another copy answered in the body's place). The body was
      // cut off here in the life that answered, and is ended with that
      // answer rather than run on into the world; nothing of the command
      // is written.
      const lane = mainLaneOf(pending.lane);
      if (lane !== ROOT_LANE && spec.kind !== 'answered' && spec.kind !== 'take') {
        const answer = this.byOrdinal.get(answeredKey(lane))?.completion;
        if (
          answer !== undefined &&
          recordedMeanwhile() === undefined &&
          this.journal.onOpenCommandPastAnswer?.(answer, this.name) === true
        ) {
          settle();
          pending.reject(endedByHistory());
          return;
        }
      }
      if (creation === undefined && spec.creation !== undefined) {
        const record = await spec.creation(ordinal);
        // The attempt may have ended while its record was made (the
        // destination chosen): read again before the append and in the
        // chain's own turn, so an abandoned attempt writes no request
        // beside its retry's, which the resend would post as a second
        // ask of the same call.
        if (ended()) {
          settle();
          pending.reject(attemptEnded());
          return;
        }
        try {
          creation = await this.journal.append(() => {
            if (ended()) throw attemptEnded();
            // A creation standing for the ordinal (the retry's, or the
            // first life's taken in at a resume while this one waited
            // behind the gate): the command goes on from it.
            const standing = this.byOrdinal.get(key)?.creation;
            if (standing !== undefined) throw new RecordStands(standing);
            return record;
          });
        } catch (error) {
          if (!(error instanceof RecordStands)) throw error;
          creation = error.entry;
        }
        if (ended()) {
          settle();
          pending.reject(attemptEnded());
          return;
        }
      }
      let done: unknown;
      try {
        done = await spec.run(creation, AbortSignal.any([pending.signal, pending.own.signal]));
      } catch (error) {
        const stood = recordedMeanwhile();
        if (stood !== undefined) {
          settle();
          this.lastResumeAt = wallNowMs();
          try {
            const settled = spec.settle(stood);
            spec.recorded?.(stood);
            pending.resolve({ done: settled, replayed: false, ordinal });
          } catch (settled) {
            pending.reject(settled instanceof Error ? settled : new Error(String(settled)));
          }
          return;
        }
        // A terminal failure of the run is the command's completion: the
        // body may catch it and go on, and a replay must meet the same
        // failure where it stood, not run the operation again.
        if (
          spec.failure !== undefined &&
          !ended() &&
          !repeatsAttempt(error) &&
          !(error instanceof CernantoError && error.details?.['fenced'] === true)
        ) {
          const record = spec.failure(error, ordinal);
          if (record !== undefined) {
            try {
              const completion = await this.journal.append(() => {
                const stood = recordedMeanwhile();
                if (stood !== undefined) throw new RecordStands(stood);
                return record;
              });
              spec.recorded?.(completion);
            } catch (recording) {
              // A completion landed meanwhile (another life's, taken in
              // at a resume while this append waited behind the gate):
              // the command settles from it, the failure recorded by
              // nobody.
              if (recording instanceof RecordStands) {
                settle();
                this.lastResumeAt = wallNowMs();
                try {
                  const settled = spec.settle(recording.entry);
                  spec.recorded?.(recording.entry);
                  pending.resolve({ done: settled, replayed: false, ordinal });
                } catch (settled) {
                  pending.reject(settled instanceof Error ? settled : new Error(String(settled)));
                }
                return;
              }
              settle();
              pending.reject(recording);
              return;
            }
          }
        }
        settle();
        pending.reject(error);
        return;
      }
      if (ended()) {
        settle();
        pending.reject(attemptEnded());
        return;
      }
      let completion = recordedMeanwhile();
      if (completion === undefined) {
        const record = spec.completion(done, ordinal);
        if (record !== undefined) {
          try {
            // Read again in the chain's own turn, past the gate a pause
            // held this append behind: the first life's completion,
            // taken in at the resume, stands in its place.
            completion = await this.journal.append(() => {
              const stood = recordedMeanwhile();
              if (stood !== undefined) throw new RecordStands(stood);
              return record;
            });
          } catch (error) {
            if (!(error instanceof RecordStands)) throw error;
            completion = error.entry;
          }
        }
      }
      if (completion !== undefined) spec.recorded?.(completion);
      settle();
      this.lastResumeAt = wallNowMs();
      pending.resolve({ done, replayed: false, ordinal });
    } catch (error) {
      settle();
      pending.reject(error);
    }
  }

  /** The moment the code resumed after the last command settled live,
   * stamped on the next record appended and taken once. */
  takeResumeMoment(): number | undefined {
    const moment = this.lastResumeAt;
    this.lastResumeAt = undefined;
    return moment;
  }
}

/** The lane of a release record. */
function laneOfRelease(entry: Entry): string {
  switch (entry.type) {
    case 'request sent':
    case 'response ack':
      return entry.data.parent;
    case 'observed':
      return entry.data.site === undefined
        ? entry.data.parent
        : softLane(entry.data.parent, entry.data.kind === 'random' ? 'd' : 't', entry.data.site);
    case 'request ack':
      return ROOT_LANE;
    case 'response sent':
      return entry.data.request;
    default:
      return ROOT_LANE;
  }
}

/** The key of a release record: the takes are keyed by their order,
 * which the engine notes on the entry as it places it. */
const takeOrdinals = new WeakMap<Entry, number>();

function keyOfRelease(entry: Entry): string {
  switch (entry.type) {
    case 'request sent':
    case 'response ack':
      return commandKey(entry.data.parent, entry.data.ordinal);
    case 'observed':
      return laneKey(laneOfRelease(entry), entry.data.ordinal);
    case 'request ack':
      return laneKey(ROOT_LANE, takeOrdinals.get(entry) ?? 0);
    case 'response sent':
      return answeredKey(entry.data.request);
    default:
      return '';
  }
}

function kindOfEntry(entry: Entry): string {
  switch (entry.type) {
    case 'request sent':
    case 'response ack':
      return 'call';
    case 'observed':
      return entry.data.kind;
    case 'request ack':
      return 'take';
    case 'response sent':
      return 'answered';
    default:
      return entry.type;
  }
}

function labelOfEntry(entry: Entry): string | undefined {
  if (entry.type === 'request sent') return `${entry.data.to.service}/${entry.data.handler}`;
  if (entry.type === 'observed' && entry.data.kind === 'lane')
    return typeof entry.data.ask === 'string' ? entry.data.ask : undefined;
  return undefined;
}

function momentOf(entry: Entry): number | undefined {
  const at = (entry.data as { at?: unknown }).at;
  return typeof at === 'number' ? at : undefined;
}

function resumedOf(entry: Entry): number | undefined {
  const r = (entry.data as { r?: unknown }).r;
  return typeof r === 'number' ? r : undefined;
}

/** What the journal is told of a body's answer met in the history
 * while the body still runs on this attempt: whether it ended the body
 * (a cancel's record), so the pump moves on. */
type AnsweredInHistory = (entry: Entry, scope: string) => boolean;

export class Journal {
  readonly log: string;
  /** The attempt this process owns the log under. */
  readonly attempt: string;
  /** The life the log is kept under: its agent's life, whose logs a new
   * life never reads. */
  readonly life: string;
  /** The grant the ownership holds. */
  launch: number;
  /** How many runs of a body this journal started: a run's id is the
   * grant and this count. */
  private runs = 0;
  /** The entries, in order, from the floor. */
  readonly entries: Entry[] = [];
  /** The state the entries make. */
  state: LogState;
  /** The responses whose caller's ack was heard, in memory. */
  readonly acked = new Set<string>();
  /** The head as last read. */
  head: LogHead;
  private last: number;
  private readonly scopes = new Map<string, Scope>();
  private chain: Promise<void> = Promise.resolve();
  private gate: Promise<void> | undefined;
  private openGate: (() => void) | undefined;
  private writing = 0;
  private quietWaiters: (() => void)[] = [];
  private unsure: string | undefined;
  private ended = false;
  /** Why the journal ended, for every append after. */
  private endedBy: string | undefined;
  /** The response acks on their way, by request: two deliveries of one
   * response await one write, so the log holds one completion of the
   * command, which a replay then meets once. */
  private readonly acking = new Map<string, Promise<Entry | undefined>>();
  /** The token the call ids of the root lane's commands begin with. */
  private readonly mint: string;
  /** The substrate the journal writes through: the process's own, or
   * one handed for a resume with every other reach held. */
  private handles: Substrate | undefined;
  /** Who hears a body's answer met in the history while the body runs. */
  onAnsweredInHistory: AnsweredInHistory | undefined;
  /** Asked when a replayed body reaches a command the log holds open
   * while the body's answer stands in the log past it: answers whether
   * the body was ended with the record, in which case the command
   * never runs. */
  onOpenCommandPastAnswer: AnsweredInHistory | undefined;
  /** What ends with this journal (its registration at the desk). */
  onEnd: (() => void) | undefined;
  /** Who hears every entry appended, for the sets outside the journal. */
  private readonly listeners = new Set<(entry: Entry) => void>();

  private constructor(
    log: string,
    attempt: string,
    life: string,
    launch: number,
    head: LogHead,
    mint: string,
  ) {
    this.log = log;
    this.attempt = attempt;
    this.life = life;
    this.launch = launch;
    this.head = head;
    this.last = head.last;
    this.state = stateOf([]);
    this.mint = mint;
  }

  /** Opens a log for this process: the head taken by the grant (issued
   * here when none was handed), the rows read from the floor. Refused
   * in words, fenced, when the grant cannot take the head. */
  static async open(
    log: string,
    options: {
      attempt: string;
      /** The life the log is kept under: its agent's. */
      life: string;
      launch?: number | undefined;
      handles?: Substrate | undefined;
      mint?: string | undefined;
    },
  ): Promise<Journal> {
    const handles = options.handles ?? (await substrate());
    const logs = handles.logsOf(options.life);
    const launch = options.launch ?? (await logs.issue(log));
    let head: LogHead;
    try {
      head = await logs.own(log, options.attempt, launch);
    } catch (error) {
      if (logRefused(error, 'grant')) throw fencedByOwner(log, error.message);
      throw error;
    }
    const journal = new Journal(
      log,
      options.attempt,
      options.life,
      launch,
      head,
      options.mint ?? log,
    );
    journal.handles = options.handles;
    await journal.load(handles);
    return journal;
  }

  /** A run's id for the next body this journal runs: the grant by which
   * this process owns the log, read at each record (a restored life owns
   * it by a newer one, and the body goes on as a later run), and the
   * run's count. */
  nextRun(): () => string {
    this.runs += 1;
    const count = this.runs;
    return () => `${String(this.launch)}.${String(count)}`;
  }

  private async load(handles: Substrate): Promise<void> {
    const read = await handles.logsOf(this.life).read(this.log, 0);
    if (read.head !== undefined) this.head = read.head;
    this.entries.length = 0;
    for (const row of read.rows) this.entries.push(entryOf(row));
    this.state = stateOf(this.entries);
    this.last = this.head.last;
  }

  /** Reads the log again from the store: a resume's road, the rows
   * gained past what this process knows taken in (a restored life
   * reads what the first life wrote after the freeze). Answers how
   * many came in. */
  async takeInTail(handles: Substrate): Promise<number> {
    const read = await handles.logsOf(this.life).read(this.log, this.last + 1);
    if (read.head !== undefined) this.head = read.head;
    let taken = 0;
    for (const row of read.rows) {
      if (row.seq <= this.last) continue;
      const entry = entryOf(row);
      this.entries.push(entry);
      this.last = row.seq;
      applyEntry(this.state, entry);
      taken += 1;
      for (const scope of this.scopes.values()) scope.noticed(entry, true);
      for (const listener of this.listeners) listener(entry);
    }
    return taken;
  }

  /** Takes the head anew under a new grant: a restored life's own.
   * Refused, fenced, when the grant cannot take it. */
  async reown(handles: Substrate, attempt: string, launch: number): Promise<void> {
    try {
      this.head = await handles.logsOf(this.life).own(this.log, attempt, launch);
    } catch (error) {
      if (logRefused(error, 'grant')) throw fencedByOwner(this.log, error.message);
      throw error;
    }
    (this as { attempt: string }).attempt = attempt;
    this.launch = launch;
  }

  /** Hears every entry appended or taken in. */
  onEntry(listener: (entry: Entry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The scope of a replay: the program's one (`''`) over every lane,
   * or a body's own over its lane. Made at its first ask, from the
   * history as it stands. */
  scope(name: string, startedAt?: number): Scope {
    let scope = this.scopes.get(name);
    if (scope === undefined) {
      const owns =
        name === ROOT_LANE
          ? (): boolean => true
          : (entry: Entry): boolean => laneOfBody(entry) === name;
      scope = new Scope(this, name, owns, startedAt);
      this.scopes.set(name, scope);
    }
    return scope;
  }

  /** Forgets a body's scope once the body is over. */
  dropScope(name: string): void {
    this.scopes.delete(name);
  }

  /** Every scope's pending commands by lane, for the idle report. */
  pendingByLane(): Map<string, { waits: number; work: number }> {
    const lanes = new Map<string, { waits: number; work: number }>();
    for (const scope of this.scopes.values()) {
      for (const [lane, counts] of scope.pendingByLane()) {
        const known = lanes.get(lane) ?? { waits: 0, work: 0 };
        known.waits += counts.waits;
        known.work += counts.work;
        lanes.set(lane, known);
      }
    }
    return lanes;
  }

  /** A call id minted for a lane's command: the lane's own call and
   * the ordinal, replay-stable. The root lane's begin with the journal's
   * mint. */
  callIdFor(lane: string, ordinal: number): string {
    const base = lane === ROOT_LANE ? this.mint : callIdOfLane(lane);
    return `${base}-${String(ordinal)}`;
  }

  // --- The sets ------------------------------------------------------

  takenOf(request: string): Taken | undefined {
    return this.state.taken.get(request);
  }

  sentOf(request: string): Sent | undefined {
    return this.state.sent.get(request);
  }

  /** THE UNACKED: what the resend posts now. */
  unacked(now = wallNowMs()): { requests: RequestSent[]; responses: ResponseSent[] } {
    return {
      requests: unackedRequests(this.state),
      responses: owedResponses(this.state, this.acked, now),
    };
  }

  /** The caller's ack of a response was heard: resent no more. */
  noteResponseAcked(request: string): void {
    this.acked.add(request);
  }

  // --- The records -----------------------------------------------------

  /** A request taken: its ack, written before the post is answered. */
  take(ack: RequestAck): Promise<Entry> {
    return this.append({ type: 'request ack', data: ack });
  }

  /** A body's answer: written before it is posted. */
  answer(response: ResponseSent): Promise<Entry> {
    return this.append({ type: 'response sent', data: response });
  }

  /** The response of a request sent from here, acked: written before
   * the post is answered; nothing when the request is unknown here or
   * acked already. */
  async ackResponse(request: string, outcome: ResponseAck['outcome']): Promise<Entry | undefined> {
    const sent = this.state.sent.get(request);
    if (sent === undefined || sent.ack !== undefined) return undefined;
    const pending = this.acking.get(request);
    if (pending !== undefined) return pending;
    const write = this.append(() => {
      // Read again in the chain's turn: a delivery that landed meanwhile
      // acked it, and a second completion of the command would hold a
      // replay waiting for a command that never comes again.
      const standing = this.state.sent.get(request);
      if (standing === undefined || standing.ack !== undefined) throw ackedMeanwhile();
      return {
        type: 'response ack',
        data: {
          request,
          parent: sent.sent.parent,
          ordinal: sent.sent.ordinal,
          outcome,
          at: wallNowMs(),
        },
      };
    })
      .then(
        (entry): Entry | undefined => entry,
        (error: unknown): Entry | undefined => {
          if (isAckedMeanwhile(error)) return undefined;
          throw error;
        },
      )
      .finally(() => {
        this.acking.delete(request);
      });
    this.acking.set(request, write);
    return write;
  }

  // --- The marks -------------------------------------------------------

  /** The newest mark's position, when one stands. */
  markSeq(): number | undefined {
    return this.state.mark?.seq;
  }

  /** The records since the newest mark: the bound's unit. */
  sinceMark(): number {
    const mark = this.state.mark;
    if (mark === undefined) return this.entries.length;
    let since = 0;
    for (const entry of this.entries) if (entry.seq > mark.seq) since += 1;
    return since;
  }

  /** Whether a body is active: a request taken and not answered. */
  bodiesActive(): number {
    let active = 0;
    for (const taken of this.state.taken.values())
      if (taken.ack !== undefined && taken.response === undefined) active += 1;
    return active;
  }

  /** The mark: the open state written at the quiet moment, through
   * the gate a pause holds. Answers the mark's position. A task's
   * logical mark is declined, in the chain's own turn, while a body is
   * active: a take that landed since the look would stand below the
   * mark with no image to continue it, and the next life would read
   * its history as lost. */
  async mark(options: { unlessBodiesActive?: boolean } = {}): Promise<number> {
    const entry = await this.append(
      () => {
        if (options.unlessBodiesActive === true && this.bodiesActive() > 0)
          throw markDeclined(this.bodiesActive());
        const open = openOf(this.state, this.acked);
        const started: CheckpointStarted = { at: wallNowMs(), open };
        return { type: 'checkpoint started', data: started };
      },
      { through: true },
    );
    return entry.seq;
  }

  /** The done: the image named (none for a logical mark), and the log
   * truncated below the mark. A done already written for the mark is
   * written no second time. */
  async done(markSeq: number, image: string | undefined): Promise<void> {
    // The mark must be one the log holds; a mark this done or a newer
    // one completed already is completed no second time.
    if (!this.state.marks.has(markSeq)) return;
    const completedAlready =
      this.state.boundary !== undefined && this.state.boundary.seq >= markSeq;
    if (!completedAlready) {
      // The done names its mark: a newer mark landing while this one
      // waits its turn in the chain is completed by nothing here, and
      // this one is completed whether or not it is the newest.
      await this.append(
        {
          type: 'checkpoint done',
          data: { at: wallNowMs(), mark: markSeq, ...(image === undefined ? {} : { image }) },
        },
        { through: true },
      );
    }
    // The truncation follows the boundary: the rows below the mark the
    // done completed leave, and only when the recovery reads that mark's
    // open state in their place.
    if (this.state.boundary?.seq !== markSeq) return;
    const handles = this.handles ?? (await substrate());
    await handles.logsOf(this.life).truncate(this.log, this.attempt, markSeq);
    this.head.floor = markSeq;
    // The rows below the mark leave the store, and the memory keeps of
    // them what a body still active needs: its ack and its records, so
    // a later attempt of that body replays its commands from the
    // records and runs none of them again.
    const active = (entry: Entry): boolean => {
      const parent =
        entry.type === 'request ack'
          ? entry.data.request
          : entry.type === 'request sent' ||
              entry.type === 'response ack' ||
              entry.type === 'observed'
            ? entry.data.parent
            : undefined;
      if (parent === undefined) return false;
      const taken = this.state.taken.get(parent);
      return taken !== undefined && taken.response === undefined;
    };
    const kept = this.entries.filter((entry) => entry.seq >= markSeq || active(entry));
    this.entries.splice(0, this.entries.length, ...kept);
    noteIdleChange();
  }

  // --- The gate --------------------------------------------------------

  /** Holds every append not yet handed to the store behind the gate: a
   * pause raises it before it lets the substrate go. */
  holdWrites(): void {
    if (this.gate !== undefined) return;
    this.gate = new Promise<void>((resolve) => {
      this.openGate = resolve;
    });
  }

  /** Opens the gate: the appends that waited go on, in their order. */
  releaseWrites(): void {
    const open = this.openGate;
    this.gate = undefined;
    this.openGate = undefined;
    open?.();
  }

  /** Resolves once no append of this journal is at the store. */
  quiet(): Promise<void> {
    if (this.writing === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.quietWaiters.push(resolve);
    });
  }

  /** Resolves once everything handed to the chain so far has settled. */
  async settled(): Promise<void> {
    for (;;) {
      const settling = this.chain;
      await settling;
      if (settling === this.chain) break;
    }
  }

  /** Ends this journal for good: nothing queued lands after, and the
   * bodies of its log are cut here, never retried. */
  end(): void {
    this.ended = true;
    this.endedBy ??=
      'this process let the log go (another process holds it, or this life resumed anew)';
  }

  /** Writes through the handles given from here (a resume's), or the
   * process's own when none. */
  useHandles(handles: Substrate | undefined): void {
    this.handles = handles;
  }

  // --- The append ------------------------------------------------------

  /** Appends one record under the head: serialized, write-ahead, the
   * fault seam met before and after. A record `through` the gate is the
   * pause's own mark. Answers the entry as the log holds it. */
  append(
    record: LogRecord | (() => LogRecord),
    options: { through?: boolean } = {},
  ): Promise<Entry> {
    // The gate holds an append before it joins the chain, so a record
    // through the gate (the pause's mark) never queues behind one that
    // waits for the resume; the appends released go on in their order.
    const chained = async (): Promise<Entry> => {
      while (options.through !== true && this.gate !== undefined) await this.gate;
      const run = this.chain.then(() => this.publish(record));
      this.chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
    return chained();
  }

  private async publish(given: LogRecord | (() => LogRecord)): Promise<Entry> {
    // A record made in its turn reads the state as every append before
    // it left it: the mark's open state counts every record that landed.
    const record = typeof given === 'function' ? given() : given;
    if (this.unsure !== undefined) throw unconfirmed(this.log, this.unsure);
    if (this.ended)
      throw journalEnded(this.log, this.endedBy ?? 'the journal ended before this append');
    this.writing += 1;
    try {
      const handles = this.handles ?? (await substrate());
      return await this.write(handles.logsOf(this.life), record);
    } finally {
      this.writing -= 1;
      if (this.writing === 0) {
        const waiters = this.quietWaiters;
        this.quietWaiters = [];
        for (const wake of waiters) wake();
      }
    }
  }

  private async write(logs: Logs, record: LogRecord): Promise<Entry> {
    const seq = this.last + 1;
    // A body's record carries the moment the code resumed after the
    // command before it settled live, for a replay's clock.
    const stamped = this.stamped(record);
    const row = rowOf(stamped);
    const before = `${record.type}:before` as FaultPoint;
    const after = `${record.type}:after` as FaultPoint;
    crashAt(before);
    const asked = wallNowMs();
    for (let tries = 1; ; tries += 1) {
      try {
        await logs.append(this.log, this.attempt, seq, row.type, row.text);
        break;
      } catch (error) {
        if (logRefused(error, 'owner')) {
          this.ended = true;
          this.endedBy = `another process owns it: ${error.message}`;
          throw fencedByOwner(this.log, error.message);
        }
        if (logRefused(error, 'moved')) {
          // Only the owner writes this log: a position taken is this
          // process's own earlier write whose answer was lost. The row
          // there says so, and the write goes on from it.
          // A read-back that fails is asked again within the patience;
          // past it the write's outcome is unknown, as the write's own
          // failure would be.
          let found: { seq: number; type: string; text: string } | undefined;
          for (;;) {
            try {
              const read = await logs.read(this.log, seq);
              found = read.rows.find((held) => held.seq === seq);
              break;
            } catch (reading) {
              if (wallNowMs() - asked >= unconfirmedPatienceMs())
                throw this.noteUnsure(
                  `${error.message}; the position could not be read back: ${reading instanceof Error ? reading.message : String(reading)}`,
                );
              await sleepMs(Math.min(200 * tries, 2000));
            }
          }
          if (found !== undefined && found.type === row.type && found.text === row.text) break;
          throw this.noteUnsure(error.message);
        }
        if (!substrateTrouble(error) || wallNowMs() - asked >= unconfirmedPatienceMs()) {
          throw this.noteUnsure(error instanceof Error ? error.message : String(error));
        }
        await sleepMs(Math.min(200 * tries, 2000));
      }
    }
    const entry: Entry = { seq, ...stamped };
    this.entries.push(entry);
    this.last = seq;
    this.head.last = seq;
    applyEntry(this.state, entry);
    appendsCount += 1;
    appendsBytes += Buffer.byteLength(row.text);
    noteIdleChange();
    for (const scope of this.scopes.values()) scope.noticed(entry);
    for (const listener of this.listeners) listener(entry);
    crashAt(after);
    return entry;
  }

  /** A write of unknown outcome: the log is neither read nor written
   * by this process from here (every append fails with the cause), and
   * the served process is told once, to leave for a life that reads
   * the log as it stands. */
  private noteUnsure(cause: string): CernantoError {
    if (this.unsure === undefined) {
      this.unsure = cause;
      unsureHandler?.(this.log, cause);
    }
    return unconfirmed(this.log, this.unsure);
  }

  /** The record with the replay clock's moment on it: a body record
   * carries the moment the code resumed after the last command settled
   * live, taken from the body's scope. */
  private stamped(record: LogRecord): LogRecord {
    if (
      record.type !== 'request sent' &&
      record.type !== 'response ack' &&
      record.type !== 'observed'
    )
      return record;
    const lane = record.data.parent;
    const scope = this.scopes.get(lane) ?? this.scopes.get(ROOT_LANE);
    const resumed = scope?.takeResumeMoment();
    if (resumed === undefined) return record;
    return { type: record.type, data: { ...record.data, r: resumed } } as LogRecord;
  }
}

/** The lane an entry belongs to as a body's: the parent of a body
 * record, the request of an answer, the take's own request. */
function laneOfBody(entry: Entry): string | undefined {
  switch (entry.type) {
    case 'request sent':
    case 'response ack':
    case 'observed':
      return entry.data.parent;
    case 'response sent':
      return entry.data.request;
    case 'request ack':
      return entry.data.request;
    default:
      return undefined;
  }
}

/** The call id a lane's commands begin with: the lane is a request id,
 * `<call id>:<16 hex>`, and the children are named by the call. */
function callIdOfLane(lane: string): string {
  const at = lane.lastIndexOf(':');
  return at === -1 ? lane : lane.slice(0, at);
}

/** A write of unknown outcome: the substrate never said whether it took
 * the record. The journal that asked stops, and the log is read again
 * by whoever holds it next. */
/** Whether a failure is a write the log did not confirm: the record
 * may be stored, and the process leaves for the log to be read again. */
export function unconfirmedWrite(error: unknown): boolean {
  return error instanceof CernantoError && error.details?.['unconfirmed'] === true;
}

function unconfirmed(log: string, cause: string): CernantoError {
  return new CernantoError({
    kind: 'retryable',
    message: `the log ${log} did not confirm a write, which may be stored (${cause}); the log is read again`,
    details: { fenced: true, unconfirmed: true },
  });
}

/** Places the take ordinals on the entries as a scope meets them: the
 * engine keys a take by its order among the takes. */
function noteTakeOrdinal(entry: Entry, ordinal: number): void {
  takeOrdinals.set(entry, ordinal);
}

export { kernelSay };
