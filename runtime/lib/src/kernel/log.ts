// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The vocabulary of a copy's log and the rules that read it: the seven
// records as the text of a row spells them, the state a log holds (the
// requests taken and answered here, the requests sent and answered to
// here, the newest mark and what it carries), the two sets the resend
// and the dedup read off that state, the open state a mark carries, and
// the body a replay reads. Pure: no store, no transport, no process.
// The runtime's journal and the model of the proofs follow these rules
// alone, so what the model proves is what the runtime does.

import { freshUUID } from './entropy.js';
import { encodeJson } from './json.js';
import { storyOf } from '../traces/story.js';
import { isLogType } from './substrate.js';
import type { LogRow, LogType } from './substrate.js';

/** How often an unacked record is sent again while any stands. */
export const RESEND_EVERY_MS = 10_000;

/** How long a response is sent again after it was written: past it the
 * record stays and the caller's own resend fetches it. */
const RESPONSE_RESEND_FOR_MS = 300_000;

/** How long a dead log's rows are kept after its slot went, for a
 * caller away to come back and a sibling to answer from it. */
export const DEAD_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

/** The logical destination of a request: the one copy chosen before
 * the first send and kept by every resend. */
export interface Destination {
  service: string;
  generation: string;
  copy: number;
  /** The life the copy runs under, when its record names one: the copy
   * takes a request for its own life alone. */
  life?: string | undefined;
}

/** The name of a copy's log: its inbox name. */
export function logNameOf(destination: Destination): string {
  return `${destination.service}/${destination.generation}/${String(destination.copy)}`;
}

/** The copy a log's name spells, when it spells one. */
export function destinationOfLog(log: string): Destination | undefined {
  const parts = log.split('/');
  if (parts.length < 3) return undefined;
  const copy = Number(parts[parts.length - 1]);
  const generation = parts[parts.length - 2];
  const service = parts.slice(0, -2).join('/');
  if (
    !Number.isSafeInteger(copy) ||
    generation === undefined ||
    generation === '' ||
    service === ''
  )
    return undefined;
  return { service, generation, copy };
}

/** The logs of one generation's copies, by prefix. */
export function generationLogsPrefix(service: string, generation: string): string {
  return `${service}/${generation}/`;
}

/** The logs of every copy of a service, by prefix. */
export function serviceLogsPrefix(service: string): string {
  return `${service}/`;
}

/** A request id, minted once by the caller: the call id and sixteen
 * hex digits of the kernel's own randomness. */
export function requestIdFor(callId: string): string {
  return `${callId}:${freshUUID().replaceAll('-', '').slice(0, 16)}`;
}

/** The story a request a log holds is in the traces: its call's handle
 * at the copy the log is named by, the destination its caller chose,
 * and the request's own part. */
export function storyOfLog(log: string, request: string): string {
  const named = destinationOfLog(log);
  return named === undefined ? request : storyOf(named, request);
}

/** The call a request belongs to. */
export function callIdOfRequest(request: string): string {
  const at = request.lastIndexOf(':');
  return at === -1 ? request : request.slice(0, at);
}

/** A failure as a record carries it. */
export interface RecordedError {
  kind: string;
  message: string;
  status?: number;
  body?: unknown;
  stack?: string;
  /** The failure came out of a secret call: whoever reads it back keeps
   * its words out of the records. */
  secret?: true;
  /** The call was cancelled: a replay of a program ends the body at
   * this record, as it was ended live. */
  cancelled?: true;
}

/** What a call came to: its result, or the failure it ended in. */
export type Outcome = { result: unknown } | { error: RecordedError };

/** The outcome as a response record carries it. */
export type ResponseOutcome = Outcome;

/** The caller of a request, for attribution: the agent and the call
 * the calling code ran in and, for a linked module, the host whose
 * journal it wrote. */
interface CallerIdentity {
  agentId: string;
  callId: string;
  hostAgentId?: string | undefined;
  hostCallId?: string | undefined;
  /** The agent a verification form stands for, stated by the two forms
   * alone. */
  target?: string | undefined;
  /** The story the call is a child of in the traces. */
  story?: string | undefined;
  /** The agent a model request made under the call is charged to, and
   * its life. */
  charge?: { agentId: string; life: string } | undefined;
}

/** The interface a request is bound through. */
export interface Binding {
  interface: string;
  sha: string;
}

/** `request sent`, the caller's: the request as it leaves, written
 * before the post. A request nobody waits for carries no `replyTo`. */
export interface RequestSent {
  request: string;
  parent: string;
  ordinal: number;
  to: Destination;
  /** The host the call was named to, when it was: the copy of the
   * agent on that host alone takes it, so the resend and the sibling
   * road stay on that host and reach no other host's copy. */
  host?: string;
  handler: string;
  args?: unknown;
  replyTo?: string;
  caller?: CallerIdentity;
  credentials?: string[];
  bound?: Binding;
  observation?: true;
  at: number;
  /** The moment the code resumed after the command before this one
   * settled live: a replay's clock resumes there. */
  r?: number;
}

/** `request ack`, the callee's: the request as it arrived, the caller's
 * inbox in `from` (empty for one nobody waits for). It is the take: the
 * body runs under it, and a replay runs it again from here. */
export interface RequestAck {
  request: string;
  from: string;
  handler: string;
  args?: unknown;
  replyTo?: string;
  caller?: CallerIdentity;
  credentials?: string[];
  bound?: Binding;
  observation?: true;
  /** A pointer, not an acceptance: the log of the live sibling that
   * took the request as its own when it was named to this log and
   * never taken here (a service's road, program.ts), so the next
   * sibling to answer for this log finds the taker's log, where the
   * request's own ack and its answer stand. The newest pointer names
   * the taker. */
  takenBy?: string;
  at: number;
}

/** `response sent`, the callee's: the body's terminal record, with the
 * caller's inbox the response is posted to (absent for a request nobody
 * waits for, which is posted to nobody). */
export interface ResponseSent {
  request: string;
  outcome: ResponseOutcome;
  replyTo?: string;
  at: number;
}

/** `response ack`, the caller's: the completion of the recorded
 * command, `{accepted: true}` for a publish once the callee's ack came. */
export interface ResponseAck {
  request: string;
  parent: string;
  ordinal: number;
  outcome: ResponseOutcome | { accepted: true };
  at: number;
  r?: number;
}

/** What the copy observes of its own: a random draw (one record, the
 * value), a timer in two phases (armed with its due moment, then fired
 * or cleared), an operation of a wire dependency (`lane`: an openapi
 * operation, an mcp tool call, its answer or its failure), and the
 * cancellation it asked for (`cancel`). Never sent, never acked, never
 * resent. */
export interface Observed {
  parent: string;
  ordinal: number;
  kind: 'random' | 'timer' | 'lane' | 'cancel';
  /** The code site of a draw or a timer: matched by its order at that
   * site alone. */
  site?: string;
  phase?: 'armed' | 'fired' | 'cleared';
  ask?: unknown;
  answer?: unknown;
  error?: RecordedError;
  at: number;
  r?: number;
}

/** What a mark carries of everything still in flight: every request
 * acked and not yet answered, every response sent and not yet acked,
 * every request sent and not yet answered, each whole. */
interface OpenState {
  acked: RequestAck[];
  owed: ResponseSent[];
  sent: RequestSent[];
}

/** `checkpoint started`: the mark at the quiet moment. */
export interface CheckpointStarted {
  at: number;
  open: OpenState;
}

/** `checkpoint done`: the archive's name, absent for a logical mark. */
interface CheckpointDone {
  at: number;
  image?: string;
  /** The mark this done completes, by its position: a done written
   * after a newer mark landed names the older mark and completes
   * nothing newer. A done that names none completes the newest mark. */
  mark?: number;
}

/** The mark a done completes, among the marks a log holds: the one it
 * names, or the newest when it names none. Nothing when the named
 * mark is not held (truncated, or never this log's). */
function completed(
  done: CheckpointDone,
  marks: ReadonlyMap<number, CheckpointStarted>,
  newest: number | undefined,
): { seq: number; data: CheckpointStarted } | undefined {
  const seq = done.mark ?? newest;
  if (seq === undefined) return undefined;
  const data = marks.get(seq);
  return data === undefined ? undefined : { seq, data };
}

/** One record, by its type. */
export type LogRecord =
  | { type: 'request sent'; data: RequestSent }
  | { type: 'request ack'; data: RequestAck }
  | { type: 'response sent'; data: ResponseSent }
  | { type: 'response ack'; data: ResponseAck }
  | { type: 'observed'; data: Observed }
  | { type: 'checkpoint started'; data: CheckpointStarted }
  | { type: 'checkpoint done'; data: CheckpointDone };

/** One row of a log as the kernel keeps it: the record at its position. */
export type Entry = LogRecord & { seq: number };

/** The row of a record: its type and its text. */
export function rowOf(record: LogRecord): { type: LogType; text: string } {
  // The row's text is the wire's spelling: bytes as base64, so a value
  // read back from the log is the value a live reply would carry.
  return { type: record.type, text: encodeJson(record.data) };
}

/** A row as an entry; a row whose text is no record is refused. */
export function entryOf(row: LogRow): Entry {
  if (!isLogType(row.type)) throw new Error(`the row ${String(row.seq)} carries no type`);
  let data: unknown;
  try {
    data = JSON.parse(row.text);
  } catch {
    throw new Error(`the row ${String(row.seq)} of type ${row.type} carries no record`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new Error(`the row ${String(row.seq)} of type ${row.type} carries no record`);
  return { seq: row.seq, type: row.type, data } as Entry;
}

/** Whether an outcome only says "again": no result of the call, the
 * command's attempt unwinds and the next attempt asks anew. */
export function saysAgain(outcome: ResponseOutcome | { accepted: true }): boolean {
  // A result of nothing is spelled as no field: an outcome without an
  // error is a result.
  if (!('error' in outcome)) return false;
  return outcome.error.kind === 'retryable' || outcome.error.kind === 'target-unavailable';
}

/** The place of a body's command: its body and its ordinal there. */
export function commandKey(parent: string, ordinal: number): string {
  return `${parent}#${String(ordinal)}`;
}

/** A request this log took: its ack, and its response once answered.
 * One from a mark's open state carries the mark's position. */
export interface Taken {
  ack: RequestAck | undefined;
  ackSeq: number;
  response: ResponseSent | undefined;
  responseSeq: number | undefined;
  /** The ack came from the mark's open state: its history before the
   * mark is the image's. */
  fromMark: boolean;
}

/** A request this log sent: the record, and the caller's ack once the
 * response came. */
export interface Sent {
  sent: RequestSent;
  seq: number;
  ack: ResponseAck | undefined;
  ackSeq: number | undefined;
  /** A later request of the same command stands: this one is resent no
   * more, and its response, should it come, is acked and dropped. */
  superseded: boolean;
}

/** What a log holds, read from its rows at and above the floor. */
export interface LogState {
  /** The newest mark, when one stands: the one a done can follow. */
  mark: { seq: number; data: CheckpointStarted } | undefined;
  /** Whether the newest mark has its done. */
  done: boolean;
  /** The recovery boundary: the newest mark whose done stands, below
   * which the rows are gone or going. A mark without a done (a pause
   * whose image never came) is an orphan: the rows below it stand, and
   * they are read, so nothing of theirs is taken for lost. */
  boundary: { seq: number; data: CheckpointStarted } | undefined;
  /** Every mark the log holds, by its position, for the done that
   * names one. */
  marks: Map<number, CheckpointStarted>;
  /** The requests taken here, by request. */
  taken: Map<string, Taken>;
  /** The requests sent from here, by request. */
  sent: Map<string, Sent>;
  /** The newest request of each command, by its key. */
  current: Map<string, string>;
}

/** The state of a log from its entries, in order: the newest mark
 * seeds the sets with its open state, and the records after it move
 * them; without a mark every record counts from the start. */
export function stateOf(entries: readonly Entry[]): LogState {
  let mark: LogState['mark'];
  let boundary: LogState['boundary'];
  let done = false;
  const marks = new Map<number, CheckpointStarted>();
  for (const entry of entries) {
    if (entry.type === 'checkpoint started') {
      mark = { seq: entry.seq, data: entry.data };
      marks.set(entry.seq, entry.data);
      done = false;
    } else if (entry.type === 'checkpoint done') {
      // The done completes the mark it names (a done landing after a
      // newer mark completes its own, older one, which the boundary
      // moves to when it is past the boundary standing; the newer mark
      // stays an orphan until its own done), or the newest when it
      // names none.
      const of = completed(entry.data, marks, mark?.seq);
      if (of === undefined) continue;
      if (boundary === undefined || of.seq > boundary.seq) boundary = of;
      if (mark !== undefined && of.seq === mark.seq) done = true;
    }
  }
  const state: LogState = {
    mark,
    done,
    boundary,
    marks,
    taken: new Map(),
    sent: new Map(),
    current: new Map(),
  };
  if (boundary !== undefined) {
    for (const ack of boundary.data.open.acked)
      state.taken.set(ack.request, {
        ack,
        ackSeq: boundary.seq,
        response: undefined,
        responseSeq: undefined,
        fromMark: true,
      });
    for (const owed of boundary.data.open.owed)
      state.taken.set(owed.request, {
        ack: undefined,
        ackSeq: boundary.seq,
        response: owed,
        responseSeq: boundary.seq,
        fromMark: true,
      });
    for (const sent of boundary.data.open.sent) noteSent(state, sent, boundary.seq);
  }
  for (const entry of entries) {
    if (boundary !== undefined && entry.seq <= boundary.seq) continue;
    applyEntry(state, entry);
  }
  return state;
}

/** Moves a state by one entry: what `stateOf` does for each record in
 * order, and what a live journal does as it appends. */
export function applyEntry(state: LogState, entry: Entry): void {
  switch (entry.type) {
    case 'request ack': {
      const known = state.taken.get(entry.data.request);
      // A pointer is replaced by a newer pointer (the taker died between
      // its pointer and its own take, and another sibling took the
      // request) and by an acceptance (the slot came back and took the
      // request as its own); an acceptance is replaced by nothing.
      if (known === undefined || known.ack === undefined || known.ack.takenBy !== undefined)
        state.taken.set(entry.data.request, {
          ack: entry.data,
          ackSeq: entry.seq,
          response: known?.response,
          responseSeq: known?.responseSeq,
          fromMark: false,
        });
      return;
    }
    case 'response sent': {
      const known = state.taken.get(entry.data.request);
      if (known === undefined)
        state.taken.set(entry.data.request, {
          ack: undefined,
          ackSeq: entry.seq,
          response: entry.data,
          responseSeq: entry.seq,
          fromMark: false,
        });
      else if (known.response === undefined) {
        known.response = entry.data;
        known.responseSeq = entry.seq;
      }
      return;
    }
    case 'request sent':
      noteSent(state, entry.data, entry.seq);
      return;
    case 'response ack': {
      const known = state.sent.get(entry.data.request);
      if (known === undefined) return;
      if (known.ack === undefined) {
        known.ack = entry.data;
        known.ackSeq = entry.seq;
      }
      return;
    }
    case 'checkpoint started':
      state.mark = { seq: entry.seq, data: entry.data };
      state.marks.set(entry.seq, entry.data);
      state.done = false;
      return;
    case 'checkpoint done': {
      const of = completed(entry.data, state.marks, state.mark?.seq);
      if (of === undefined) return;
      if (state.boundary === undefined || of.seq > state.boundary.seq) state.boundary = of;
      if (state.mark !== undefined && of.seq === state.mark.seq) state.done = true;
      return;
    }
    case 'observed':
      return;
  }
}

function noteSent(state: LogState, sent: RequestSent, seq: number): void {
  const key = commandKey(sent.parent, sent.ordinal);
  const before = state.current.get(key);
  if (before !== undefined && before !== sent.request) {
    const earlier = state.sent.get(before);
    if (earlier !== undefined) earlier.superseded = true;
  }
  state.current.set(key, sent.request);
  const known = state.sent.get(sent.request);
  if (known === undefined)
    state.sent.set(sent.request, {
      sent,
      seq,
      ack: undefined,
      ackSeq: undefined,
      superseded: false,
    });
}

/** Whether a body has ended in this log: its response was sent. A body
 * the log never took (the plane's own, a worker's run under another
 * name, a program's) never ends. */
function bodyEnded(state: LogState, parent: string): boolean {
  return state.taken.get(parent)?.response !== undefined;
}

/** THE UNACKED, the requests' half: every request sent with no
 * response ack, the newest of its command, whose body has not ended
 * here. */
export function unackedRequests(state: LogState): RequestSent[] {
  const due: RequestSent[] = [];
  for (const entry of state.sent.values()) {
    if (entry.ack !== undefined || entry.superseded) continue;
    if (bodyEnded(state, entry.sent.parent)) continue;
    due.push(entry.sent);
  }
  return due;
}

/** THE UNACKED, the responses' half: every response sent whose caller's
 * ack was not heard (`acked` holds the ones heard, in memory), written
 * within the resend window. */
export function owedResponses(
  state: LogState,
  acked: ReadonlySet<string>,
  now: number,
  forMs: number = RESPONSE_RESEND_FOR_MS,
): ResponseSent[] {
  const owed: ResponseSent[] = [];
  for (const entry of state.taken.values()) {
    const response = entry.response;
    if (response === undefined || acked.has(response.request)) continue;
    if (response.replyTo === undefined) continue;
    if (now - response.at > forMs) continue;
    owed.push(response);
  }
  return owed;
}

/** The open state a mark carries: every request acked and not answered,
 * every response sent and not acked (whatever its age: a mark carries
 * what the resend would still send and what a sibling answers from),
 * every request sent and not answered, the newest of its command. */
export function openOf(state: LogState, acked: ReadonlySet<string>): OpenState {
  const open: OpenState = { acked: [], owed: [], sent: [] };
  for (const entry of state.taken.values()) {
    if (entry.response === undefined) {
      if (entry.ack !== undefined) open.acked.push(entry.ack);
      continue;
    }
    if (!acked.has(entry.response.request) && entry.response.replyTo !== undefined)
      open.owed.push(entry.response);
  }
  for (const entry of state.sent.values()) {
    if (entry.ack !== undefined || entry.superseded) continue;
    // A child of a body that ended here is sent no more (the rule of
    // the unacked), and the mark carries it no further.
    if (bodyEnded(state, entry.sent.parent)) continue;
    open.sent.push(entry.sent);
  }
  return open;
}

/** The records of one body, in order: what a replay of it reads. */
export function bodyOf(entries: readonly Entry[], parent: string): Entry[] {
  return entries.filter(
    (entry) =>
      ((entry.type === 'request sent' ||
        entry.type === 'response ack' ||
        entry.type === 'observed') &&
        entry.data.parent === parent) ||
      (entry.type === 'response sent' && entry.data.request === parent),
  );
}

/** How a fresh process meets each request its log took and never
 * answered: run again from its records (the ack and its pairs are in
 * the tail), continued by the image when the record names one, or lost
 * with the image when its history lay in the image alone. */
export type Recovery = 'run' | 'continued' | 'lost';

export function recoveryOf(taken: Taken, imageHeld: boolean): Recovery {
  if (taken.response !== undefined) return 'continued';
  if (!taken.fromMark) return 'run';
  return imageHeld ? 'continued' : 'lost';
}

/** The words a request gets when its history lay in an image that is
 * gone. */
export function lostImageWords(service: string, handler: string, request: string): string {
  return `the history of ${service}/${handler} ${callIdOfRequest(request)} is continued by an image that is gone: the call is lost`;
}

/** The words a job's call gets when the process running it died
 * mid-body. */
export function deadJobWords(agentId: string, handler: string, request: string): string {
  return `the process running "${handler}" of ${agentId} ended before it answered (call ${callIdOfRequest(request)}); a job's call is not run again`;
}

/** The words a call that waited on a replaced version's memory is
 * answered with: a service's request taken and never answered by a
 * copy that is gone, or by a version that drained. */
export function replacedWords(service: string, request: string): string {
  return `the version of ${service} that held the call ${callIdOfRequest(request)} is replaced: the caller asks the newer one`;
}

/** Whether a log holds work unfinished: a request taken and not
 * answered (a pointer to a taker's log is not work of this log's), or
 * a request sent and not acked by a body still running. */
export function unfinishedWork(state: LogState): boolean {
  for (const taken of state.taken.values())
    if (taken.ack !== undefined && taken.ack.takenBy === undefined && taken.response === undefined)
      return true;
  return unackedRequests(state).length > 0;
}
