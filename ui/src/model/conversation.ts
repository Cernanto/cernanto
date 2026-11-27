// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { CallSummary, TraceRecord } from '../gateway/types.gen.js';
import { spoken } from './agent.js';
import { humanMs } from './figures.js';

// A call's records read as the conversation it was. WHO speaks, to
// whom, when and for how long is read from each record; WHAT is said is
// the trace view's own reading of the record, the lines the gateway
// answers beside it, so the screen and `cernanto trace` say one thing
// one way.

/** The gateway's own id: the caller of a call an operator sent. */
export const GATEWAY = 'cernanto/gateway';

/** Who a call that names no caller is from: the plane itself, which
 * starts a worker's program and asks its own agents what it needs. The
 * word is no agent's id, since an id holds no such mark. */
export const PLANE = '#plane';

/** What a record becomes in a conversation. */
export type MessageKind = 'arrival' | 'ask' | 'reply' | 'answer' | 'step' | 'sleep' | 'log';

/** The request a reply or an answer quotes. */
export interface Quote {
  /** The key of the message that asked. */
  key: string;
  /** The function, as spoken. */
  fn: string;
  /** The first lines of what was asked. */
  lines: string[];
}

/** One message of a conversation. */
export interface Message {
  /** The key two tellings of one record share. */
  key: string;
  kind: MessageKind;
  record: TraceRecord;
  /** The request the message belongs to. */
  callId: string;
  at: string;
  /** Who speaks: an agent's id, or the id of a party that is no agent. */
  author: string;
  /** Whom it asks or answers. */
  to?: string;
  /** The function, as spoken, on an arrival and an ask. */
  fn?: string;
  /** What is said, as the trace view reads it. */
  body: string[];
  quote?: Quote;
  durationMs?: number;
  error?: string;
  /** A test's mock answered in the target's place. */
  mocked?: boolean;
  /** An ask with no reply yet, or an arrival with no answer yet. */
  open: boolean;
  /** A log line's level, a step's label. */
  level?: 'debug' | 'info' | 'warn' | 'error';
  label?: string;
}

/** How a call of the open agent stands. */
export interface CallState {
  callId: string;
  agentId: string;
  handler: string;
  at: string;
  /** The agent that called it; the gateway for a call an operator sent; none for the plane's own. */
  caller?: string;
  /** The caller's own request, which leads to its side of the call. */
  parentCallId?: string;
  status: 'running' | 'ok' | 'error';
  durationMs?: number;
  error?: string;
  /** The moment of its last record. */
  lastAt: string;
}

/**
 * The key a record is shown once by: its request, its attempt, its
 * sequence and its kind, and for a call's end its run as well, so a
 * request that ran again and ended again shows each end.
 */
export function recordKey(record: TraceRecord): string {
  return [
    record.callId,
    record.attemptId ?? '',
    String(record.seq),
    record.kind,
    record.kind === 'handler' ? (record.run ?? '') : '',
  ].join('|');
}

/** The key a begin and the end that closes it share. */
function pairKey(record: TraceRecord): string {
  return `${record.callId}|${record.attemptId ?? ''}|${String(record.seq)}`;
}

/**
 * A short mark of a call, to tell two calls of one function apart: the
 * first letters of its request's own part. A worker's program has none:
 * the plane names its run by the function itself, and one runs at a time.
 *
 * @example
 * callMark('examples_basics_welcome:20078:c-1866e383:baa10b8454e24304'); // 'baa1'
 * callMark('examples_basics_clock:20079:k-worker=003aclock:run'); // ''
 */
export function callMark(callId: string): string {
  const head = callId.split('~')[0] ?? callId;
  const parts = head.split(':');
  const last = parts.length >= 4 ? (parts[3] ?? '') : (parts.at(-1) ?? '');
  const own = last.replace(/^[ck]-/, '');
  return /^[0-9a-f]{8,}$/.test(own) ? own.slice(0, 4) : '';
}

/** The generation a call ran in, read from its id; undefined when the id names none. */
export function generationOf(callId: string): number | undefined {
  const generation = Number(callId.split(':')[1]);
  return Number.isInteger(generation) && generation > 0 ? generation : undefined;
}

/** The view writes what is said under a head line, twelve spaces in. */
const INDENT = /^ {12}/;

/** What the view says under a record's head line, without the head, the
 * indent, and the line that quotes a request (the screen shows a
 * request itself, where an answer does not stand right under it). */
function bodyOf(lines: string[]): string[] {
  return lines
    .slice(1)
    .filter((line) => !/^ {12}│ /.test(line))
    .map((line) => line.replace(INDENT, ''));
}

/** A body without its first line when that line is the function's own name. */
function withoutFunction(body: string[], fn: string): string[] {
  return body[0]?.trim() === fn ? body.slice(1) : body;
}

/** How many lines of a request a quote shows. */
const QUOTE_LINES = 3;

/**
 * A call's summary as the call's own end leaves it. A summary is asked
 * once, while the call may still run or run again, and the conversation
 * reads the call's last record when it comes: from there the summary
 * says how the call ended and how long it took. A success that was told
 * stands, as does a call whose end was not read; a failure that was
 * told gives way to a success read after it, since a call that failed
 * and ran again ends as its last run did.
 */
export function withItsEnd(told: CallSummary, read: CallState | undefined): CallSummary {
  if (read === undefined || read.status === 'running' || told.status === 'ok') return told;
  if (told.status === 'error' && read.status !== 'ok') return told;
  const ended: CallSummary = {
    ...told,
    status: read.status,
    durationMs: read.durationMs ?? told.durationMs,
  };
  // The words of a failure that was told do not stand on a success.
  if (read.error === undefined) delete ended.error;
  else ended.error = read.error;
  return ended;
}

/** What the request that made a call has heard of it: nothing final
 * yet, its answer, its failure, the plane's refusal of it before any
 * copy took it, or nothing more to come, the connection lost. */
export type Heard = 'open' | 'ok' | 'error' | 'refused' | 'lost';

/**
 * What a call the reader sent still has to say beside the conversation:
 * `whole`, the request itself, where the conversation shows nothing of
 * the call; `end`, how the call ended, where the reader's own request
 * heard an end the conversation does not say; `nothing`, where the
 * request is still open and the conversation shows the call; `over`,
 * where the conversation says all the request heard, or the request
 * will hear no more, and the send is let go for good.
 */
export type SendStanding = 'whole' | 'end' | 'nothing' | 'over';

/**
 * Whether two tellings of a failure tell the same failure: the same
 * words, the blanks around them aside. A call's failure reads the same
 * on the request that made the call and in the call's own record, so
 * words that differ at all are two failures, an earlier run's and the
 * one the call ended with; words of one that stand within the other's
 * are still two (`refused by node-1`, `refused by node-10`). A telling
 * with no words has nothing another could differ from.
 */
export function sameFailure(one: string | undefined, other: string | undefined): boolean {
  const left = (one ?? '').trim();
  const right = (other ?? '').trim();
  return left === '' || right === '' || left === right;
}

/**
 * How a sent call stands beside the conversation, by what its own
 * request heard and what the conversation read of the call. A request
 * that is still open is never let go: a call that failed may run again,
 * and the answer of that run comes on the request. And the records say
 * what the request heard only where they say that end: a success, or
 * the same failure. A failure that was read while the request heard
 * another is an earlier run's, and the one the call ended with is still
 * the request's to tell.
 *
 * @param read - What the conversation's records say of the call; undefined where it holds none of the call.
 * @param heardError - The words of the failure the request heard, where it heard one.
 */
export function sendStanding(
  heard: Heard,
  read: Pick<CallState, 'status' | 'error'> | undefined,
  heardError?: string,
): SendStanding {
  if (read === undefined) return 'whole';
  if (heard === 'open') return 'nothing';
  if (heard === 'refused' || heard === 'lost') return 'over';
  if (heard === 'ok') return read.status === 'ok' ? 'over' : 'end';
  return read.status === 'error' && sameFailure(read.error, heardError) ? 'over' : 'end';
}

/**
 * The module's own call that a request made, among the calls a module's
 * conversation holds. A module's function runs inside another agent: the
 * request is that agent's call, and the module's call is the one whose
 * caller's request it is (its id is the request's with the link's mark
 * after it). A call that names its caller's request is told by that
 * name alone, so a call made deeper inside the request, whose id opens
 * the same way and which names another caller, is none of them; one
 * that names no caller is told by its id, the request's with one mark
 * after it. A request that ran again made one such call at each
 * attempt, and the newest is the one its answer came from.
 *
 * @param calls - The calls the module's conversation holds.
 * @param requestId - The request the reader sent, as the plane named it.
 */
export function moduleCallOf(calls: Iterable<CallState>, requestId: string): CallState | undefined {
  const mark = `${requestId}~`;
  let newest: CallState | undefined;
  for (const call of calls) {
    const made =
      call.parentCallId === undefined
        ? call.callId.startsWith(mark) && !call.callId.slice(mark.length).includes('~')
        : call.parentCallId === requestId;
    if (!made) continue;
    if (newest === undefined || call.at >= newest.at) newest = call;
  }
  return newest;
}

/** A call's end as the reader's own request heard it, whichever records of the call arrived. */
export interface HeardEnd {
  status: 'ok' | 'error';
  durationMs: number;
  error?: string;
}

/**
 * How a call stands with what the reader's own request heard of its end
 * laid over what the conversation read of it. A success that was read
 * stands. Otherwise the request's word stands where the records do not
 * say it: over a call that reads as running, the record of its end not
 * arrived, and over a failure that was read where the request heard
 * another end, a success or another failure, the call having run again.
 */
export function withHeardEnd(call: CallState, heard: HeardEnd | undefined): CallState {
  if (heard === undefined || call.status === 'ok') return call;
  if (call.status === 'error' && heard.status === 'error' && sameFailure(call.error, heard.error)) {
    return call;
  }
  const ended: CallState = { ...call, status: heard.status, durationMs: heard.durationMs };
  if (heard.error === undefined) delete ended.error;
  else ended.error = heard.error;
  return ended;
}

/**
 * A conversation as it is read: the messages in the order their records
 * came, and how each call stands. It takes one record at a time, each
 * once, so a stream's records and a page's are read the same way.
 *
 * What it holds has a bound, by `trim`: its newest messages, the calls
 * those belong to and the calls that still run, and the keys of its
 * newest records. A record is told a second time close to its first
 * telling, by a stream taken up again from the newest moment it told
 * and by a call's own request beside its agent's stream, so the newest
 * keys are the ones a second telling is known by.
 *
 * A conversation made with a bound holds itself to it as it reads, a
 * quarter of the bound at a time, whoever does or does not ask it to:
 * a followed conversation is read while its window is out of sight,
 * where nothing is drawn and nothing else would trim it.
 */
export class Conversation {
  readonly messages: Message[] = [];
  readonly calls = new Map<string, CallState>();
  private readonly seen = new Set<string>();
  private readonly asks = new Map<string, Message>();
  private readonly arrivals = new Map<string, Message>();
  private readonly most: number | undefined;
  private count = 0;
  private sinceTrim = 0;

  /** How many messages were let go from its far end so far. */
  dropped = 0;

  /**
   * How many messages it took in so far: the ones it holds and the ones
   * it let go. It only grows, so what came since a moment is counted by
   * it; the messages it holds are held to a bound, and their number
   * says nothing of what came.
   */
  get arrived(): number {
    return this.messages.length + this.dropped;
  }

  /**
   * @param most - How many messages it holds itself to as it reads;
   *   none for a conversation read whole once, as a call's export is.
   */
  constructor(most?: number) {
    this.most = most;
  }

  /** How many records were read. */
  get size(): number {
    return this.count;
  }

  /** The moment of the newest record read. */
  lastAt: string | undefined;

  /**
   * Reads one record with the view's lines for it. Answers the message
   * it became; undefined for a record told before, and for one the
   * conversation does not show (a step's begin, a copy's own start and
   * clean end).
   */
  add(record: TraceRecord, lines: string[]): Message | undefined {
    const key = recordKey(record);
    if (this.seen.has(key)) return undefined;
    this.seen.add(key);
    this.count += 1;
    if (this.lastAt === undefined || record.at > this.lastAt) this.lastAt = record.at;
    this.note(record);
    const message = lines.length === 0 ? undefined : this.read(record, lines, key);
    if (message !== undefined) this.messages.push(message);
    this.sinceTrim += 1;
    if (this.most !== undefined && this.sinceTrim * 4 >= this.most) this.trim(this.most);
    return message;
  }

  /** Keeps how the call a record belongs to stands. */
  private note(record: TraceRecord): void {
    const held = this.calls.get(record.callId);
    if (held !== undefined && record.at > held.lastAt) held.lastAt = record.at;
    if (record.kind === 'begin' && record.of === 'handler') {
      if (held === undefined) {
        this.calls.set(record.callId, {
          callId: record.callId,
          agentId: record.agentId,
          handler: record.handler ?? '',
          at: record.at,
          ...(record.callerAgentId === undefined ? {} : { caller: record.callerAgentId }),
          ...(record.parentCallId === undefined ? {} : { parentCallId: record.parentCallId }),
          status: 'running',
          lastAt: record.at,
        });
      }
      return;
    }
    if (record.kind === 'handler') {
      const at =
        held?.at ?? new Date(Date.parse(record.at) - Math.round(record.durationMs)).toISOString();
      // A call that ended well stays so, whatever an older attempt says later.
      if (held?.status === 'ok') return;
      this.calls.set(record.callId, {
        callId: record.callId,
        agentId: record.agentId,
        handler: record.handler,
        at,
        ...(record.callerAgentId === undefined
          ? held?.caller === undefined
            ? {}
            : { caller: held.caller }
          : { caller: record.callerAgentId }),
        ...(record.parentCallId === undefined
          ? held?.parentCallId === undefined
            ? {}
            : { parentCallId: held.parentCallId }
          : { parentCallId: record.parentCallId }),
        status: record.error === undefined ? 'ok' : 'error',
        durationMs: record.durationMs,
        ...(record.error === undefined ? {} : { error: record.error }),
        lastAt: record.at,
      });
    }
  }

  private read(record: TraceRecord, lines: string[], key: string): Message | undefined {
    const base = { key, record, callId: record.callId, at: record.at };
    switch (record.kind) {
      case 'begin': {
        if (record.of === 'handler') {
          const fn = spoken(record.handler ?? '');
          const message: Message = {
            ...base,
            kind: 'arrival',
            author: record.callerAgentId ?? PLANE,
            to: record.agentId,
            fn,
            body: withoutFunction(bodyOf(lines), fn),
            open: this.calls.get(record.callId)?.status === 'running',
          };
          this.arrivals.set(record.callId, message);
          return message;
        }
        if (record.of === 'call') {
          const fn = spoken(record.handler ?? '');
          const message: Message = {
            ...base,
            kind: 'ask',
            author: record.agentId,
            to: record.target ?? '',
            fn,
            body: withoutFunction(bodyOf(lines), fn),
            open: true,
          };
          this.asks.set(pairKey(record), message);
          return message;
        }
        return undefined;
      }
      case 'agent-call': {
        const ask = this.asks.get(pairKey(record));
        if (ask !== undefined) {
          ask.open = false;
          this.asks.delete(pairKey(record));
        }
        const fn = spoken(record.handler);
        return {
          ...base,
          kind: 'reply',
          author: record.target,
          to: record.agentId,
          body: record.error === undefined ? bodyOf(lines) : [],
          quote: {
            key: ask?.key ?? '',
            fn,
            lines: (ask?.body ?? []).slice(0, QUOTE_LINES),
          },
          durationMs: record.durationMs,
          ...(record.error === undefined ? {} : { error: record.error }),
          ...(record.mocked === true ? { mocked: true } : {}),
          open: false,
        };
      }
      case 'handler': {
        const arrival = this.arrivals.get(record.callId);
        if (arrival !== undefined) arrival.open = false;
        const call = this.calls.get(record.callId);
        const to = record.callerAgentId ?? call?.caller ?? PLANE;
        return {
          ...base,
          kind: 'answer',
          author: record.agentId,
          to,
          body: record.error === undefined ? bodyOf(lines) : [],
          quote: {
            key: arrival?.key ?? '',
            fn: spoken(record.handler),
            lines: (arrival?.body ?? []).slice(0, QUOTE_LINES),
          },
          durationMs: record.durationMs,
          ...(record.error === undefined ? {} : { error: record.error }),
          open: false,
        };
      }
      case 'step':
        return {
          ...base,
          kind: 'step',
          author: record.agentId,
          body: [],
          label: record.label,
          durationMs: record.durationMs,
          ...(record.error === undefined ? {} : { error: record.error }),
          open: false,
        };
      case 'sleep':
        return {
          ...base,
          kind: 'sleep',
          author: record.agentId,
          body: [],
          durationMs: record.durationMs,
          open: false,
        };
      case 'log':
        return {
          ...base,
          kind: 'log',
          author: record.agentId,
          body: record.message.split('\n'),
          level: record.level,
          open: false,
        };
      default:
        return undefined;
    }
  }

  /**
   * Lets the oldest go, so a tab left open for a week holds what it held
   * in its first minute: the messages past the bound, with them what was
   * kept of each call that ended and has no message left, and the keys
   * of the records past twice the bound. A call that still runs is kept
   * whatever its age, since its end is still to be read. Answers how
   * many messages it let go.
   */
  trim(most: number): number {
    this.sinceTrim = 0;
    const over = Math.max(this.messages.length - most, 0);
    this.dropped += over;
    if (over > 0) {
      for (const gone of this.messages.splice(0, over)) {
        // A request nobody answered leaves with its message.
        if (gone.kind !== 'ask') continue;
        const pair = pairKey(gone.record);
        if (this.asks.get(pair) === gone) this.asks.delete(pair);
      }
    }
    if (over > 0 || this.calls.size > most) {
      const held = new Set(this.messages.map((message) => message.callId));
      for (const [callId, call] of this.calls) {
        if (call.status === 'running' || held.has(callId)) continue;
        this.calls.delete(callId);
        this.arrivals.delete(callId);
      }
    }
    // A set keeps the order its keys came in: the first are the oldest.
    let extra = this.seen.size - most * 2;
    for (const key of this.seen) {
      if (extra <= 0) break;
      this.seen.delete(key);
      extra -= 1;
    }
    return over;
  }
}

/**
 * The call a request of a conversation caused, among the calls the
 * plane lists under the request's own call. No record names the call a
 * request caused, so it is found by its place: the request's place
 * among the requests the same call made of the same function of the
 * same agent, and the call at that place among the plane's calls of
 * that agent and function, which it lists in the order they began.
 *
 * The place is taken only where the two are of one length, each request
 * with its call. Where the plane lists fewer or more, a call is not
 * listed yet or the conversation does not hold every request, and the
 * place would name another request's call: the answer is then none,
 * and never a neighbour.
 *
 * @param message - The request, or the reply to it.
 * @param children - The calls the plane lists under the request's own call.
 */
export function childAsked(
  conversation: Pick<Conversation, 'messages'>,
  message: Message,
  children: readonly CallSummary[],
): CallSummary | undefined {
  const asked =
    message.kind === 'ask'
      ? message.key
      : message.kind === 'reply'
        ? message.quote?.key
        : undefined;
  const target = message.kind === 'ask' ? message.to : message.author;
  const handler = 'handler' in message.record ? message.record.handler : undefined;
  if (asked === undefined || asked === '' || target === undefined || handler === undefined) {
    return undefined;
  }
  const alike = conversation.messages.filter(
    (entry) =>
      entry.callId === message.callId &&
      entry.kind === 'ask' &&
      entry.to === target &&
      'handler' in entry.record &&
      entry.record.handler === handler,
  );
  const listed = children.filter((child) => child.agentId === target && child.handler === handler);
  const place = alike.findIndex((entry) => entry.key === asked);
  if (place < 0 || listed.length !== alike.length) return undefined;
  return listed[place];
}

/** What a conversation's column lays out: a day's line, a call's head
 * line, or a message. */
export type Item =
  | { type: 'day'; key: string; at: string }
  | { type: 'call'; key: string; call: CallState }
  | {
      type: 'message';
      key: string;
      message: Message;
      /** The first of a run of one sender's messages: it carries the picture and the small line. */
      head: boolean;
      /** The call's name and mark, repeated small where a message follows another call's. */
      tag: boolean;
      /** The request it answers is shown on it: it does not stand right under that request. */
      quoted: boolean;
    };

/** A line in the middle of the column, not a message of anyone's. */
function thin(kind: MessageKind): boolean {
  return kind === 'step' || kind === 'sleep' || kind === 'log';
}

/**
 * What marks a message as an answer, in words: that it answers, and how
 * long the answer took, or that it failed and after how long. A request
 * has none: it is known by its function's name. So a reader tells the
 * two apart where an answer stands right under its request and repeats
 * nothing of it.
 *
 * @example
 * answerWords({ kind: 'answer', durationMs: 1300 }); // 'Answered in 1.3s'
 * answerWords({ kind: 'reply', durationMs: 1, error: 'no such key' }); // 'Failed after 1ms'
 * answerWords({ kind: 'ask' }); // undefined
 */
export function answerWords(message: {
  kind: MessageKind;
  durationMs?: number | undefined;
  error?: string | undefined;
}): string | undefined {
  if (message.kind !== 'answer' && message.kind !== 'reply') return undefined;
  const took = message.durationMs === undefined ? undefined : humanMs(message.durationMs);
  if (message.error !== undefined) return took === undefined ? 'Failed' : `Failed after ${took}`;
  return took === undefined ? 'Answered' : `Answered in ${took}`;
}

/** A name as the plane's trace view writes a label: `inputTokens`
 * reads `Input Tokens`. */
function viewLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A value as the lines a message says it in, written as the plane's
 * trace view writes the value of a recorded message: a label and its
 * value, a record's fields and a text of several lines under their
 * label, an item of a list under a dash. An answer this page heard on
 * its own request is drawn from these lines, so it reads as the
 * recorded answer of any call does.
 *
 * @example
 * valueLines({ text: 'blue', usage: { units: 3 } });
 * // ['Text: blue', 'Usage:', '  Units: 3']
 */
export function valueLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return ['[]'];
    return value.flatMap((item) =>
      valueLines(item).map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`)),
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return ['{}'];
    return entries.flatMap(([key, item]) => {
      const label = viewLabel(key);
      const lines = valueLines(item);
      const first = lines[0] ?? '';
      const compound = Array.isArray(item) || isRecord(item);
      if (lines.length === 1 && (!compound || first === '[]' || first === '{}')) {
        return [`${label}: ${first}`];
      }
      return [compound ? `${label}:` : `${label}: |`, ...lines.map((line) => `  ${line}`)];
    });
  }
  if (value === undefined) return ['Done'];
  if (value === null) return ['null'];
  if (typeof value === 'string') return value.split('\n');
  return [typeof value === 'number' || typeof value === 'boolean' ? String(value) : typeof value];
}

/** Where a message stands in an agent's conversation. */
export type Side = 'left' | 'right' | 'line';

/**
 * The side a message stands on, by who speaks: THE AGENT WHOSE
 * CONVERSATION IT IS ON THE LEFT, what it asks of another and what it
 * answers; WHOEVER TALKS WITH IT ON THE RIGHT, the request that arrives
 * from an operator, from another agent or from the plane, and another
 * agent's reply to what it asked. A step, a wait and a log line are the
 * agent's own thin lines, under its side.
 *
 * It goes by what a message is and not by who is named in it, so an
 * agent that calls itself keeps its two sides.
 */
export function sideOf(kind: MessageKind): Side {
  if (kind === 'arrival' || kind === 'reply') return 'right';
  if (kind === 'ask' || kind === 'answer') return 'left';
  return 'line';
}

/**
 * The items of a conversation's column: a line between the days, a head
 * line where a call of the open agent begins, and each message with
 * whether it opens a run of its sender's, whether it follows another
 * call's, and whether it shows the request it answers.
 *
 * AN ANSWER SHOWS ITS REQUEST ONLY WHERE IT DOES NOT STAND RIGHT UNDER
 * IT, as a chat's reply does. One call, its request and then its answer,
 * repeats nothing. Calls that run at once fall between each other, and
 * an agent that asks another before it answers has that exchange above
 * its own answer: there the answer says what it answers. A call's own
 * thin lines between a request and its answer are not between them, and
 * a line between two days is not either.
 *
 * @param dayOf - The day a moment falls on in the reader's clock.
 * @param debug - Whether the agent's own debug lines are shown.
 */
export function itemsOf(
  conversation: Conversation,
  dayOf: (at: string) => string,
  debug = false,
): Item[] {
  const items: Item[] = [];
  let day = '';
  let previous: Message | undefined;
  // The request or the answer a message laid now would stand right under:
  // the last one laid, for as long as only its own call's thin lines followed it.
  let above: Message | undefined;
  for (const message of conversation.messages) {
    if (message.kind === 'log' && message.level === 'debug' && !debug) continue;
    const messageDay = dayOf(message.at);
    if (messageDay !== day) {
      day = messageDay;
      items.push({ type: 'day', key: `day:${messageDay}:${message.key}`, at: message.at });
      previous = undefined;
    }
    if (message.kind === 'arrival') {
      const call = conversation.calls.get(message.callId);
      if (call !== undefined) items.push({ type: 'call', key: `call:${message.key}`, call });
    }
    const sameCall = previous?.callId === message.callId;
    const head =
      previous === undefined ||
      thin(message.kind) !== thin(previous.kind) ||
      previous.author !== message.author ||
      previous.to !== message.to ||
      !sameCall ||
      message.kind === 'arrival' ||
      previous.kind === 'arrival';
    items.push({
      type: 'message',
      key: message.key,
      message,
      head,
      tag: previous !== undefined && !sameCall && message.kind !== 'arrival',
      quoted: message.quote !== undefined && above?.key !== message.quote.key,
    });
    previous = message;
    if (!thin(message.kind)) above = message;
    else if (above !== undefined && above.callId !== message.callId) above = undefined;
  }
  return items;
}

/** A text as a search reads it: without the spaces around it, whatever
 * the case of its letters. */
export function needleOf(text: string): string {
  return text.trim().toLowerCase();
}

/** The lines of a message a search reads: its function, what it says,
 * its error and a step's label. The request a reply quotes is the
 * request's own message, and is read there. */
export function searchedLines(message: Message): string[] {
  return [
    ...(message.fn === undefined ? [] : [message.fn]),
    ...message.body,
    ...(message.error === undefined ? [] : message.error.split('\n')),
    ...(message.label === undefined ? [] : [message.label]),
  ];
}

/**
 * The messages of a conversation that hold a text, by their keys, in
 * the order they were said. A text is found within one line, a letter
 * whatever its case, and an empty text finds none. It reads what the
 * conversation holds and nothing more: the calls the browser did not
 * load are the plane's to search.
 *
 * @param debug - Whether the agent's own debug lines are among them.
 */
export function findIn(conversation: Conversation, text: string, debug = false): string[] {
  const needle = needleOf(text);
  if (needle === '') return [];
  const found: string[] = [];
  for (const message of conversation.messages) {
    if (message.kind === 'log' && message.level === 'debug' && !debug) continue;
    if (searchedLines(message).some((line) => line.toLowerCase().includes(needle)))
      found.push(message.key);
  }
  return found;
}

/** A call's export as it reads: a Markdown text, each message with who
 * said it to whom and when. */
export function conversationMarkdown(
  title: string,
  conversation: Conversation,
  timeOf: (at: string) => string,
  nameOf: (id: string) => string,
): string {
  const out: string[] = [`# ${title}`, ''];
  for (const message of conversation.messages) {
    const when = timeOf(message.at);
    if (message.kind === 'step') {
      out.push(
        `- ${when} · ${message.label ?? ''}${message.error === undefined ? '' : ` (error: ${message.error})`}`,
        '',
      );
      continue;
    }
    if (message.kind === 'sleep') {
      out.push(`- ${when} · slept ${String(Math.round((message.durationMs ?? 0) / 1000))}s`, '');
      continue;
    }
    if (message.kind === 'log') {
      out.push(
        `- ${when} ${message.level === 'info' ? '' : `${message.level ?? ''} `}${message.body.join(' ')}`,
        '',
      );
      continue;
    }
    const to = message.to === undefined ? '' : ` → ${nameOf(message.to)}`;
    out.push(`**${nameOf(message.author)}**${to} · ${when}`, '');
    if (message.fn !== undefined) out.push(message.fn, '');
    if (message.error !== undefined) out.push(`Error: ${message.error}`, '');
    if (message.body.length > 0) out.push('```', ...message.body, '```', '');
  }
  return `${out.join('\n')}\n`;
}
