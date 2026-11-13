// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The process's call server, the one road in. Every process that calls
// or is called opens one HTTP server, bound to the plane's address for
// copies (the loopback on a laptop, the host's private address on a
// server) on the lowest free port of the plane's own range. A copy
// writes the address into its record, where a caller reads it; a
// process without a copy spells it into the inbox its asks name. A post
// to `/call` carries a call for one of the copy's lanes (the agent's
// calls, or those named to the copy's host): the lane takes it when it
// has room, and the copy answers the post once it holds the call
// (taken) or let it go (not taken, with the pause it asks for before
// the next ask); a copy with no room says it is busy, at once to a
// sender that may ask another copy, and to a sender that waits here
// (its post says for how long) only once that time passed with no slot
// come back: the post is kept meanwhile and taken the moment one does.
// A post to
// `/reply` carries an answer or a word for the process's own inbox,
// handed to its desk. A post to `/stop`, `/park` or `/drain` is the
// plane's word to the copy, the host job's, and the copy leaves on it.
// A post to `/stream` follows the copy's own traces of one request (its
// id the records' `callId`; everything the copy runs when the body names
// none): a response kept open, one line per record, first those the
// store has not taken yet, then each as it is made, and the fact that a
// request is over; a follower that falls behind is let go, and joins
// again from its cursor.
// A post to `/workload` asks the copy what it carries now, and the copy
// answers for itself from memory: the calls it holds, in and out.
// Every post to a copy names it by its record's key and epoch, and a
// copy that is not that one refuses it, so a stale address, a replaced
// copy or a port another copy took reaches nothing, and the caller
// reads the directory again. The server is the process's, not its
// image's: closed before a pause, opened anew at the resume on
// whatever port is free.

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import { isDraining } from './admission.js';
import { ownInbox } from './connection.js';
import { ownEntryKey, sayEntry } from './copy-entry.js';
import type { CallAddress } from './copy-entry.js';
import { processFacts } from './facts.js';
import { takeWord } from './fence.js';
import type { Word } from './fence.js';
import { ownedByKernel } from './listeners.js';
import { onPause } from './pause.js';
import type { RecordedError } from './log.js';
import { deliverToDesk } from './transport.js';
import type { CallLane, Handing } from './units.js';
import { kernelSay } from '../traces/observe.js';

/** The roads a word to the copy comes by, each its word. */
const WORD_ROADS: Record<string, Word> = { '/stop': 'stop', '/park': 'park', '/drain': 'draining' };

/** The road a follower of the copy's traces comes by. */
const STREAM_ROAD = '/stream';

/** How much a follower may fall behind, in bytes waiting to be sent,
 * before it is let go: a watcher never slows a copy. */
const STREAM_BEHIND_BYTES = 8 * 1024 * 1024;

/** What follows this process's own traces, set at its boot when it
 * keeps them on the plane: a story (every one when none), where each
 * line goes and what is told once the story is over and stored whole;
 * answers the end of the follow. */
type TraceFollow = (
  story: string | undefined,
  send: (text: string) => void,
  done: () => void,
) => (() => void) | undefined;

let traceFollow: TraceFollow | undefined;

/** Hands the server what follows this process's traces. */
export function setTraceFollow(follow: TraceFollow | undefined): void {
  traceFollow = follow;
}

/** The road a copy is asked its own workload by. */
const WORKLOAD_ROAD = '/workload';

/** What answers this process's workload, set at its boot when it serves
 * an agent. */
let workloadNow: (() => unknown) | undefined;

/** Hands the server what answers this process's workload. */
export function setWorkload(workload: (() => unknown) | undefined): void {
  workloadNow = workload;
}

/** The plane's range of call ports when the facts name none. */
export const DEFAULT_CALL_PORTS = { from: 20000, to: 20999 };

/** The address a copy binds when the facts name none: the loopback. */
export const DEFAULT_CALL_ADDRESS = '127.0.0.1';

/** The longest body a post may carry: a call and its answer ride the
 * wire whole, whatever their size, and a body past this is no call. */
const BODY_LIMIT_BYTES = 256 * 1024 * 1024;

/** What one message is: a call, the answer of a call, or a word to a
 * copy (a cancel). */
type MessageKind = 'call' | 'answer' | 'word';

/** One message as the road carries it. */
export interface CallMessage {
  /** The message's own id: a post of the same id again is the same ask. */
  id: string;
  kind: MessageKind;
  /** The call the message is about. */
  call: string;
  /** The inbox the sender takes its own messages at, for an answer;
   * empty for a call nobody waits for. */
  from: string;
  body: unknown;
}

/** What a post answers: acked (the request is taken, its ack durable,
 * with the response beside it when one stands; a response is recorded
 * by the caller), refused in words (the callee serves no such handler:
 * the request's outcome), or not acked (busy, draining, stale, no lane),
 * with the pause the sender is asked to wait. A busy copy that kept the
 * post for room, for as long as its sender said it waits, says so
 * (`held`). */
export type PostAnswer =
  | { acked: true; response?: { outcome: unknown } | undefined }
  | {
      acked: false;
      retryInMs?: number | undefined;
      busy?: true;
      held?: true;
      stopped?: true;
      draining?: true;
      stale?: true;
      refused?: RecordedError | undefined;
      error?: string;
    };

/** A message as the server hands it over: taken (the process holds
 * what it carries, with the response when one stands), refused in
 * words, or released (not taken here: its sender posts again after the
 * pause). */
export interface HandedMessage extends CallMessage {
  release(delayMs?: number): void;
  taken(response?: { outcome: unknown }): void;
  refuse(error: RecordedError): void;
}

/** What the server hands calls to: the lanes of the copy, read at each
 * post, since a lane is added once the copy serves. */
interface CallServerOptions {
  lanes: () => CallLane[];
}

let server: Server | undefined;
let bound: CallAddress | undefined;
let hooked = false;
let opening: Promise<CallAddress | undefined> | undefined;
let lanesOf: () => CallLane[] = () => [];
/** Whether the copy's record says the server's address: from the moment
 * the copy hands the server its lanes. */
let saysAddress = false;
/** How many calls of this process wait for an answer at the server. */
let holders = 0;

/** Where this process's server listens, when it does. */
export function callServerAddress(): CallAddress | undefined {
  return bound;
}

/** The connections the server took, held as the server is: a post that
 * lingers on a kept-alive connection (another process's resend to an
 * address this port once was) keeps no plain process alive. */
const connections = new Set<Socket>();

/** Whether the server keeps the process alive: a copy's always, since
 * the copy serves at it; a plain process's (a tool, a proof) only while
 * a call of its waits for an answer there, so the process ends when
 * its work does. */
function keeping(): boolean {
  return saysAddress || holders > 0;
}

function keepAlive(): void {
  if (server === undefined) return;
  const keep = keeping();
  if (keep) server.ref();
  else server.unref();
  for (const socket of connections) {
    if (keep) socket.ref();
    else socket.unref();
  }
}

/** Holds the server open for a call that waits for its answer; answers
 * what lets it go, once. */
export function holdCallServer(): () => void {
  holders += 1;
  keepAlive();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    keepAlive();
  };
}

const MESSAGE_KINDS: readonly MessageKind[] = ['call', 'answer', 'word'];

/** The message a post's body carries, when it is one. */
function messageOf(body: unknown): CallMessage | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const { id, kind, call, from } = body as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') return undefined;
  if (typeof kind !== 'string' || !MESSAGE_KINDS.includes(kind as MessageKind)) return undefined;
  if (typeof call !== 'string' || typeof from !== 'string') return undefined;
  return {
    id,
    kind: kind as MessageKind,
    call,
    from,
    body: (body as { body?: unknown }).body,
  };
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value[0] : undefined;
}

function answer(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

/** Reads a request's body as JSON, up to the bound. */
function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > BODY_LIMIT_BYTES) {
        reject(new Error(`the body is longer than ${String(BODY_LIMIT_BYTES)} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    request.on('error', reject);
  });
}

/** The longest a copy keeps a post for room, whatever its sender says:
 * under the patience a sender has for one post, so the copy's word
 * reaches it. */
const HOLD_MAX_MS = 4000;

/** How long a post's sender waits here for room, when the post says so:
 * a time in milliseconds, no longer than the bound. */
function holdOf(said: unknown): number | undefined {
  if (typeof said !== 'number' || !Number.isFinite(said) || said <= 0) return undefined;
  return Math.min(said, HOLD_MAX_MS);
}

/** A post's message as the lanes and the desk take it, and the answer
 * they come to: the first word counts. */
function handedOf(message: CallMessage): { handed: HandedMessage; decided: Promise<PostAnswer> } {
  let settle: (decision: PostAnswer) => void = () => undefined;
  const decided = new Promise<PostAnswer>((resolve) => {
    settle = resolve;
  });
  let open = true;
  const once = (decision: PostAnswer): void => {
    if (!open) return;
    open = false;
    settle(decision);
  };
  return {
    handed: {
      ...message,
      release: (delayMs = 0) => {
        once({ acked: false, retryInMs: delayMs });
      },
      taken: (response) => {
        once({ acked: true, ...(response === undefined ? {} : { response }) });
      },
      refuse: (error) => {
        once({ acked: false, refused: error });
      },
    },
    decided,
  };
}

/** A follow of the copy's own traces: the response kept open, a line per
 * record and per word that a story is over, until the follower goes or
 * falls behind, the process closes its server, or the story followed
 * is over and this copy holds nothing of it the store has not taken. */
function followTraces(response: ServerResponse, story: string | undefined): void {
  if (traceFollow === undefined) {
    answer(response, 404, { error: 'this process keeps no traces to follow' });
    return;
  }
  response.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-cache',
  });
  const watch: { open: boolean; end: (() => void) | undefined } = { open: true, end: undefined };
  const close = (): void => {
    if (!watch.open) return;
    watch.open = false;
    watch.end?.();
    response.end();
  };
  response.on('close', close);
  // The first line says the stream is open: a follower holds what comes
  // after it and reads the store once it has it.
  response.write(`${JSON.stringify({ open: true, callId: story ?? null })}\n`);
  watch.end = traceFollow(
    story,
    (text) => {
      if (!watch.open) return;
      response.write(`${text}\n`);
      if (response.writableLength > STREAM_BEHIND_BYTES) close();
    },
    close,
  );
  // A watcher dropped while the follow told what it held is let go
  // here, its follow made after the close that dropped it.
  if (!watch.open) watch.end?.();
}

/** One post: refused when it is not for this process, else handed over
 * and answered with what the process came to. */
async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const road = request.url ?? '';
    const word = WORD_ROADS[road];
    if (
      request.method !== 'POST' ||
      (road !== '/call' &&
        road !== '/reply' &&
        road !== STREAM_ROAD &&
        road !== WORKLOAD_ROAD &&
        word === undefined)
    ) {
      answer(response, 404, { error: 'no such road' });
      return;
    }
    const facts = processFacts();
    if (facts.callToken !== undefined && header(request, 'x-cernanto-token') !== facts.callToken) {
      answer(response, 401, { acked: false, error: "the token is not the plane's" });
      return;
    }
    // A post to a copy names the copy's record and its epoch, or it is
    // not for this copy: one that names none is refused as a stale one
    // is.
    const own = ownEntryKey();
    const askedKey = header(request, 'x-cernanto-key');
    if (own !== undefined && askedKey !== own) {
      answer(response, 410, {
        acked: false,
        stale: true,
        error: `this copy is ${own}, not ${askedKey ?? 'the copy the post names (none)'}`,
      });
      return;
    }
    const epoch = facts.holder?.epoch;
    const askedEpoch = header(request, 'x-cernanto-epoch');
    if (epoch !== undefined && (askedEpoch === undefined || Number(askedEpoch) !== epoch)) {
      answer(response, 410, {
        acked: false,
        stale: true,
        error: `this copy holds its record at epoch ${String(epoch)}, not ${askedEpoch ?? 'the epoch the post names (none)'}`,
      });
      return;
    }
    if (road === STREAM_ROAD) {
      // The request followed, by the id its records carry as `callId`;
      // everything the copy runs when the body names none.
      const asked = (await readJson(request)) as { callId?: unknown };
      followTraces(response, typeof asked.callId === 'string' ? asked.callId : undefined);
      return;
    }
    if (road === WORKLOAD_ROAD) {
      // Answered from memory, whatever the body says.
      request.resume();
      if (workloadNow === undefined) {
        answer(response, 404, { error: 'this process serves no agent' });
        return;
      }
      answer(response, 200, workloadNow());
      return;
    }
    if (word !== undefined) {
      const said = (await readJson(request)) as { why?: unknown };
      const why =
        typeof said.why === 'string' && said.why !== '' ? said.why : `the plane says ${word}`;
      if (!takeWord(word, why)) {
        answer(response, 404, { acked: false, error: 'this process takes no words of the plane' });
        return;
      }
      answer(response, 200, { acked: true });
      return;
    }
    const body = (await readJson(request)) as {
      inbox?: unknown;
      message?: unknown;
      hold?: unknown;
    };
    const message = messageOf(body.message);
    if (message === undefined || typeof body.inbox !== 'string' || body.inbox === '') {
      answer(response, 400, { acked: false, error: 'the body is no message' });
      return;
    }
    if (road === '/call') {
      // A draining copy declines what it does not hold, in the lane: a
      // request it holds already is handed over and answered from the
      // log, so a decline proves the request was never accepted here.
      const lane = lanesOf().find((candidate) => candidate.inbox === body.inbox);
      if (lane === undefined) {
        answer(response, 404, { acked: false, error: `this copy takes no calls of ${body.inbox}` });
        return;
      }
      const { handed, decided } = handedOf(message);
      // A post that says how long its sender waits for room is kept by
      // a lane that has none, and handed over the moment a slot comes
      // back; a sender that goes meanwhile is answered nothing, and
      // nothing of its request was taken.
      const hold = holdOf(body.hold);
      let handing: Handing | 'left';
      let kept = false;
      if (hold === undefined) handing = lane.handDirect(handed);
      else {
        const post = lane.keepForRoom(handed, hold);
        kept = post.kept;
        response.once('close', () => {
          post.leave();
        });
        handing = await post.handing;
      }
      if (handing === 'left') return;
      if (handing !== 'handed') {
        const decision = await decided;
        answer(response, 503, {
          acked: false,
          retryInMs: (decision.acked ? undefined : decision.retryInMs) ?? 0,
          ...(handing === 'busy'
            ? { busy: true, ...(kept ? { held: true } : {}) }
            : isDraining()
              ? { draining: true }
              : { stopped: true }),
        });
        return;
      }
      // The post is acked only once the request's ack is durable,
      // however long that takes; a sender whose patience ends first
      // posts again, and the post is the same request.
      answer(response, 200, await decided);
      return;
    }
    if (body.inbox !== ownInbox()) {
      answer(response, 404, { acked: false, error: `this process's inbox is not ${body.inbox}` });
      return;
    }
    const { handed, decided } = handedOf(message);
    deliverToDesk(handed);
    answer(response, 200, await decided);
  } catch (error) {
    answer(response, 500, {
      acked: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Tries one port; answers the bound server, or nothing when the port
 * is taken. Any other failure of the bind is thrown. */
function tryPort(host: string, port: number): Promise<Server | undefined> {
  return new Promise((resolve, reject) => {
    const created = createServer((request, response) => {
      void handle(request, response);
    });
    // The kernel's own server: no listener of the agent's, so the
    // observer neither claims it nor ends the copy when a port of the
    // range is another copy's.
    ownedByKernel(created);
    created.keepAliveTimeout = 60_000;
    created.on('connection', (socket: Socket) => {
      connections.add(socket);
      socket.once('close', () => connections.delete(socket));
      if (!keeping()) socket.unref();
    });
    created.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(undefined);
        return;
      }
      reject(error);
    });
    created.listen({ host, port, exclusive: true }, () => {
      resolve(created);
    });
  });
}

/** Opens the process's server on the lowest free port of the plane's
 * range, at the plane's address for copies; `options` names the lanes
 * it hands calls to, and from then on the copy's record says the
 * address. Answers the address, or nothing when no port of the range is
 * free (no call reaches the process then, and it says so). Opened once;
 * a pause closes it and a resume opens it anew. */
export function openCallServer(options?: CallServerOptions): Promise<CallAddress | undefined> {
  if (options !== undefined) {
    lanesOf = options.lanes;
    saysAddress = true;
    keepAlive();
  }
  if (opening !== undefined) return opening;
  if (server !== undefined) {
    // A server opened before this process knew its address (a call made
    // while its package was materialized, its facts not given yet)
    // moves to the address its facts name now, so its record names a
    // server every caller reaches.
    const host = processFacts().callAddress ?? DEFAULT_CALL_ADDRESS;
    if (bound !== undefined && bound.host !== host)
      return closeCallServer().then(() => openCallServer(options));
    if (options !== undefined) sayEntry({ address: bound });
    return Promise.resolve(bound);
  }
  opening = (async () => {
    const facts = processFacts();
    const host = facts.callAddress ?? DEFAULT_CALL_ADDRESS;
    const range = facts.callPorts ?? DEFAULT_CALL_PORTS;
    for (let port = range.from; port <= range.to; port += 1) {
      const listening = await tryPort(host, port);
      if (listening === undefined) continue;
      server = listening;
      bound = { host, port };
      keepAlive();
      if (saysAddress) sayEntry({ address: bound });
      if (!hooked) {
        hooked = true;
        onPause({
          prepare: () => closeCallServer(),
          resume: async () => {
            // A copy no call can reach is not serving: it exits as a
            // fenced one does, and the plane starts it anew.
            if ((await openCallServer()) === undefined) {
              kernelSay('no call server could open after the resume; the process exits\n');
              process.exit(2);
            }
          },
        });
      }
      return bound;
    }
    kernelSay(
      `no call port is free between ${String(range.from)} and ${String(range.to)} on ${host}; no call reaches this process\n`,
    );
    return undefined;
  })().finally(() => {
    opening = undefined;
  });
  return opening;
}

/** The process's server, opened when it is not yet: where the answers
 * to its calls land. */
export function ensureCallServer(): Promise<CallAddress | undefined> {
  if (server !== undefined) return Promise.resolve(bound);
  return openCallServer();
}

/** Closes the process's server: no post reaches it any more, and the
 * copy's record says it has no call server until one opens anew. */
export async function closeCallServer(): Promise<void> {
  const closing = server;
  server = undefined;
  if (bound !== undefined) {
    bound = undefined;
    if (saysAddress) sayEntry({ address: undefined });
  }
  if (closing === undefined) return;
  await new Promise<void>((resolve) => {
    closing.close(() => {
      resolve();
    });
    closing.closeAllConnections();
  });
}
