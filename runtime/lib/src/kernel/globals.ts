// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The transparent globals: the agent's own timers, clock reads and
// random draws are journaled, so a replay waits a timer's remainder,
// reads the moment it read live and draws the value it drew, and the
// coder writes the TypeScript it knows. Everything else is real: a
// library's timers and draws (the world's, told apart by the caller's
// file), intervals, request deadlines, durations, and every call
// outside an execution or inside a job's live body or a lane's action.
// The network is left as it is.

import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { debuglog } from 'node:util';

import { CernantoError } from '../language/errors.js';
import { freshBytes, freshUUID } from './entropy.js';
import { endedByRecordedAnswer } from './journal.js';
import { wallNowIso } from './clock.js';
import type { Execution } from './execution.js';
import { currentExecution, liveActive, nextTraceSequence } from './execution.js';
import { RECORD_BYTES_CAP } from './facts.js';
import { noteIdleChange } from './idle-signal.js';
import { emitTrace } from '../traces/trace.js';

/** The runtime's own tree: a call from a file under it is the
 * machine's, wherever the runtime is linked. */
const OWN_ROOT = posixPath(dirname(dirname(fileURLToPath(import.meta.url))));

/** A path with forward slashes whatever the system's separator: the
 * tests below read segments, and Windows spells them with `\\`. */
function posixPath(path: string): string {
  return path.replaceAll('\\', '/');
}
/** Where a module composed into its carrier lives: the agent's own
 * code, although under node_modules. */
const COMPOSED_MODULE_MARK = '/node_modules/cernanto-agent-';

type CallSite = NodeJS.CallSite;

const debug = debuglog('cernanto-globals');

/**
 * Whether the call under way came from the agent's own code, read off
 * the first call site outside the patched function: the world's
 * frames are node's builtins, anything under node_modules but a
 * composed module, and the runtime's own tree. A driver's keep-alive,
 * a client's backoff and the runtime's own bookkeeping keep real time
 * and real randomness; the agent's waits and draws are journaled.
 */
function askedByTheAgent(skip: (...args: never[]) => unknown): string | undefined {
  const first = firstCallSite(skip);
  if (first === undefined) return undefined;
  const { site, file, path } = first;
  const own = ownCodeFile(file);
  debug('%s asked by %s: %s', skip.name, own ? 'the agent' : 'the world', path);
  if (!own) return undefined;
  // The code site names the soft lane of its timers and draws.
  return createHash('sha256')
    .update(`${path}:${String(site.getLineNumber() ?? 0)}:${String(site.getColumnNumber() ?? 0)}`)
    .digest('hex')
    .slice(0, 10);
}

/**
 * Whether the call under way came from the runtime's own tree: the
 * kernel's and the trace sink's bookkeeping (the sink's drain, the
 * kernel's own timers) keeps real time and is no
 * work of the copy's, so its timers are neither journaled nor counted
 * among a library's pending ones.
 */
function askedByTheRuntime(skip: (...args: never[]) => unknown): boolean {
  const first = firstCallSite(skip);
  return first !== undefined && first.path.startsWith(OWN_ROOT);
}

/** The first call site with a file outside the patched function, its
 * file as the site spells it and its path with forward slashes. */
function firstCallSite(
  skip: (...args: never[]) => unknown,
): { site: CallSite; file: string; path: string } | undefined {
  // The hook is read to be restored, never called as a method.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const previous = Error.prepareStackTrace;
  const limit = Error.stackTraceLimit;
  Error.prepareStackTrace = (_error, sites) => sites;
  Error.stackTraceLimit = 6;
  const holder: { stack?: CallSite[] } = {};
  Error.captureStackTrace(holder, skip);
  const sites = holder.stack;
  Error.prepareStackTrace = previous;
  Error.stackTraceLimit = limit;
  if (!Array.isArray(sites)) return undefined;
  for (const site of sites) {
    const file = site.getFileName() ?? site.getScriptNameOrSourceURL();
    if (typeof file !== 'string' || file === '') continue;
    const path = posixPath(file.startsWith('file://') ? fileURLToPath(file) : file);
    return { site, file, path };
  }
  return undefined;
}

/**
 * Whether a call site's file is the agent's own code: not a builtin,
 * not the runtime's own tree, and not under node_modules unless the
 * last node_modules segment is a composed module's (a dependency
 * nested under it is the world's). The file is read by its segments
 * whatever the system's separator: on Windows a call site spells
 * `C:\\...\\node_modules\\...`, and a test on `/node_modules/` alone
 * would read every library there as the agent's.
 */
export function ownCodeFile(file: string): boolean {
  if (file.startsWith('node:')) return false;
  const path = posixPath(file.startsWith('file://') ? fileURLToPath(file) : file);
  if (path.startsWith(OWN_ROOT)) return false;
  const last = path.lastIndexOf('/node_modules/');
  return last === -1 || path.startsWith(COMPOSED_MODULE_MARK, last);
}

/** A journaled operation's execution and the code site that asked for it. */
interface Asked {
  execution: Execution;
  site: string;
}

/** The execution a journaled operation belongs to: the current one,
 * outside a live body or a lane's action, asked for by the agent's
 * own code. */
function journaling(skip: (...args: never[]) => unknown): Asked | undefined {
  const execution = currentExecution();
  if (execution === undefined || liveActive()) return undefined;
  const site = askedByTheAgent(skip);
  return site === undefined ? undefined : { execution, site };
}

// --- The clock -----------------------------------------------------

const RealDate = Date;
const realNow = Date.now.bind(Date);

/** The moment the agent's clock reads: the machine's on the original
 * run, the journal's replay moment on a replay. */
function moment(skip: (...args: never[]) => unknown): number {
  const execution = currentExecution();
  if (execution === undefined || liveActive()) return realNow();
  const replay = execution.backend.replayMoment();
  if (replay === undefined) return realNow();
  return askedByTheAgent(skip) === undefined ? realNow() : replay;
}

function patchedNow(): number {
  return moment(patchedNow);
}

// The traps are the frames the whose-call check skips, so they are
// named functions and not arrows inside the handler.
function dateConstruct(target: DateConstructor, args: unknown[], newTarget: unknown): object {
  const fill = args.length === 0 ? [moment(dateConstruct)] : args;
  return Reflect.construct(target, fill, newTarget as new (...a: unknown[]) => object) as object;
}

function dateApply(target: DateConstructor, thisArg: unknown, args: unknown[]): unknown {
  const execution = currentExecution();
  if (execution === undefined || liveActive() || execution.backend.replayMoment() === undefined) {
    return Reflect.apply(target, thisArg, args);
  }
  return new RealDate(moment(dateApply)).toString();
}

function dateGet(target: DateConstructor, property: string | symbol, receiver: unknown): unknown {
  return property === 'now' ? patchedNow : Reflect.get(target, property, receiver);
}

function installClock(): void {
  const patched = new Proxy(RealDate, {
    construct: dateConstruct,
    apply: dateApply,
    get: dateGet,
  });
  globalThis.Date = patched;
}

// --- The timers ----------------------------------------------------

const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);

/** The library timers in flight, each with its due moment: the idle
 * report reads them, since a library's timer due within the hold is
 * waited for and one due beyond it is promised nothing across a park. */
const libraryTimers = new Map<object, number>();

/** The due moments of the library timers in flight. */
export function libraryTimersDue(): number[] {
  return [...libraryTimers.values()];
}

/** A timer handle shaped enough for library code that calls unref and
 * friends on what setTimeout answered. */
interface TimerHandle {
  cleared: boolean;
  clear: () => void;
  ref: () => TimerHandle;
  unref: () => TimerHandle;
  hasRef: () => boolean;
  refresh: () => TimerHandle;
  [Symbol.toPrimitive]: () => number;
}

function timerHandle(): TimerHandle {
  const handle: TimerHandle = {
    cleared: false,
    clear: () => undefined,
    ref: () => handle,
    unref: () => handle,
    hasRef: () => false,
    refresh: () => handle,
    [Symbol.toPrimitive]: () => 0,
  };
  return handle;
}

function isTimerHandle(value: unknown): value is TimerHandle {
  return typeof value === 'object' && value !== null && 'cleared' in value && 'clear' in value;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A timer's wait, as the journal records it: the command with its
 * remainder on a replay. A timer that ran its time was a sleep, and
 * the trace is told of it at the moment it ends; one cleared before
 * that was a bound on something else and leaves the trace nothing.
 * Answers how the wait ended. */
async function journaledWait(
  asked: Asked,
  ms: number,
  cleared: Promise<void>,
): Promise<'fired' | 'cleared'> {
  const { execution, site } = asked;
  const outcome = await execution.backend.sleep(ms, cleared, site);
  if (outcome === 'fired') {
    emitTrace({
      agentId: execution.context.agentId,
      callId: execution.context.callId,
      seq: nextTraceSequence(execution.trace),
      at: wallNowIso(),
      kind: 'sleep',
      durationMs: ms,
    });
  }
  return outcome;
}

function patchedSetTimeout(
  callback: (...args: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
): unknown {
  const delayMs = ms ?? 0;
  // A zero-delay timer is a yield, not a wait.
  const asked = Number.isFinite(delayMs) && delayMs > 0 ? journaling(patchedSetTimeout) : undefined;
  if (asked === undefined) {
    if (!(Number.isFinite(delayMs) && delayMs > 0)) return realSetTimeout(callback, ms, ...args);
    // The runtime's own timer keeps real time and counts for nothing,
    // and so does a library's timer set outside any call (a client's
    // keepalive under a stream, armed at the copy's boot): the copy's
    // work is what runs inside its calls.
    if (currentExecution() === undefined || askedByTheRuntime(patchedSetTimeout))
      return realSetTimeout(callback, ms, ...args);
    // A library's timer set inside a call (an SDK's backoff under a
    // handler): noted with its due moment for the idle report, forgotten
    // when it fires or is cleared; the report is told, so the idle file
    // says what the books say now and not at the last call.
    const timer: object = realSetTimeout(
      (...fired: unknown[]) => {
        libraryTimers.delete(timer);
        noteIdleChange();
        callback(...fired);
      },
      ms,
      ...args,
    );
    libraryTimers.set(timer, realNow() + delayMs);
    noteIdleChange();
    return timer;
  }
  const { execution } = asked;
  const handle = timerHandle();
  const ended = deferred();
  handle.clear = () => {
    handle.cleared = true;
    ended.resolve();
  };
  // A timer asked for by an ended attempt waits its delay on the
  // machine's own clock and then fires, so the body settles into the
  // ended attempt at its own pace, every durable operation refused
  // there. The delay is kept: fired at once, a body that retries its
  // refusals would spin in a tight loop of refused calls.
  if (execution.owner?.signal.aborted === true) {
    realSetTimeout(() => {
      if (!handle.cleared) callback(...args);
    }, delayMs);
    return handle;
  }
  debug('timer %d ms of %s begins', delayMs, execution.context.callId);
  void journaledWait(asked, delayMs, ended.promise).then(
    (outcome) => {
      debug('timer of %s ended: %s', execution.context.callId, outcome);
      if (outcome === 'fired' && !handle.cleared) callback(...args);
    },
    (error: unknown) => {
      debug('timer of %s failed: %s', execution.context.callId, String(error));
      // A body ended by its recorded answer (a replay reaching a timer
      // the life that answered never fired) runs no further: its
      // callback never fires, so the memory stands as that life left
      // it, and the attempt's end has let its invoker go already.
      if (endedByRecordedAnswer(error)) return;
      // The wait failed: the attempt ended (a cancel, a drain, a
      // divergence), or its record could not be written (another
      // process fenced the journal, the substrate away). A failure the
      // callback form cannot surface ends the attempt with it, as a
      // call's would; the callback then runs so the body settles into
      // the ended attempt, as above.
      const owner = execution.owner;
      if (owner !== undefined && !owner.signal.aborted) {
        owner.abandon(error instanceof Error ? error : new Error(String(error)));
      }
      if (!handle.cleared) callback(...args);
    },
  );
  return handle;
}

function patchedClearTimeout(handle: unknown): void {
  if (isTimerHandle(handle)) {
    handle.clear();
    return;
  }
  if (typeof handle === 'object' && handle !== null && libraryTimers.delete(handle))
    noteIdleChange();
  realClearTimeout(handle as Parameters<typeof realClearTimeout>[0]);
}

// The coder's world offers the global setTimeout and no timers
// module (the doctrine): the two globals are the patch, and a library's
// timers are the world's by the frames rule.
function installTimers(): void {
  globalThis.setTimeout = patchedSetTimeout as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout = patchedClearTimeout;
}

// --- The randomness ------------------------------------------------

// The coder's world draws on the global crypto and Math.random (the
// doctrine; node:crypto is its deterministic subset there), and a
// library's draws are the world's by the frames rule: three patches.
// What a draw takes live comes from the kernel's keyed generator
// (entropy.ts), fresh in every life of an image, never from OpenSSL's
// state alone, which an image carries: a library's request tokens (the
// store's idempotency tokens among them) would repeat across two
// lives and be refused as tokens used before.
const realGetRandomValues = crypto.getRandomValues.bind(crypto);

/** Fills a typed array as the global crypto would, the values mixed
 * with the kernel's keyed bytes so no two lives of an image share
 * them. */
function freshValues<T extends ArrayBufferView>(array: T): T {
  realGetRandomValues(array as never);
  const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  const keyed = freshBytes(view.length);
  for (let i = 0; i < view.length; i += 1) view[i] = (view[i] ?? 0) ^ (keyed[i] ?? 0);
  return array;
}

// The library road of Math.random is a generator of the kernel's own
// (xoshiro128**), seeded from the system's bytes at every boot and
// every resume: V8's own generator keeps its state in process memory,
// which an image carries, so two lives of one image would draw alike.
// The agent's own draws are journaled and replay by design.
const seed = new Uint32Array(4);
let seeded = false;

/** Seeds the library road from sixteen bytes of the system's own. */
export function reseedLibraryRandom(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 4; i += 1)
    seed[i] = view.getUint32((i * 4) % Math.max(4, bytes.byteLength - 3), true);
  if (seed.every((word) => word === 0)) seed[0] = 1;
  seeded = true;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** The next draw of the library road, a double in [0, 1). */
function libraryRandom(): number {
  if (!seeded) reseedLibraryRandom(freshBytes(16));
  const s0 = seed[0] ?? 0;
  const s1 = seed[1] ?? 0;
  const s2 = seed[2] ?? 0;
  const s3 = seed[3] ?? 0;
  const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  seed[2] = (s2 ^ s0) >>> 0;
  seed[3] = (s3 ^ s1) >>> 0;
  seed[1] = (s1 ^ seed[2]) >>> 0;
  seed[0] = (s0 ^ seed[3]) >>> 0;
  seed[2] = (seed[2] ^ t) >>> 0;
  seed[3] = rotl(seed[3], 11);
  return result / 4294967296;
}

/** One draw, recorded as its json value: a number, a uuid, or bytes
 * as base64. */
function draw<T extends string | number>(skip: (...args: never[]) => unknown, live: () => T): T {
  const asked = journaling(skip);
  if (asked === undefined) return live();
  return asked.execution.backend.draw(live, asked.site);
}

function drawBytes(skip: (...args: never[]) => unknown, size: number): Buffer {
  if (size > RECORD_BYTES_CAP) {
    throw new CernantoError({
      kind: 'terminal',
      message: `a draw of ${String(size)} random bytes is past the ${String(RECORD_BYTES_CAP)} the journal records`,
    });
  }
  const encoded = draw(skip, () =>
    Buffer.from(freshValues(new Uint8Array(size))).toString('base64'),
  );
  return Buffer.from(encoded, 'base64');
}

function patchedMathRandom(): number {
  return draw(patchedMathRandom, libraryRandom);
}

function patchedRandomUUID(): string {
  return draw(patchedRandomUUID, freshUUID);
}

function patchedGetRandomValues<T extends ArrayBufferView | null>(array: T): T {
  if (array === null) return realGetRandomValues(array as never);
  const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  if (journaling(patchedGetRandomValues) === undefined) return freshValues(array);
  view.set(drawBytes(patchedGetRandomValues, view.length));
  return array;
}

function installRandomness(): void {
  Math.random = patchedMathRandom;
  crypto.randomUUID = patchedRandomUUID as typeof crypto.randomUUID;
  crypto.getRandomValues = patchedGetRandomValues;
}

let installed = false;

/** Installs the transparent globals once; every patched function
 * answers the real one outside a journaling execution. */
// --- The request body -----------------------------------------------

const realFetch = globalThis.fetch.bind(globalThis);

/** A request whose body is the empty string goes out with no body: the
 * two mean the same on the wire (a content length of zero), but some
 * providers' edges leave the first form from Node's fetch unanswered
 * while answering the second at once. The difference is invisible to
 * the agent's code and its libraries. */
type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = NonNullable<Parameters<typeof globalThis.fetch>[1]>;

/** The request as it goes out: the same, except that an empty-string
 * body is no body. */
export function requestAsSent(init: FetchInit | undefined): FetchInit | undefined {
  if (init === undefined || init.body !== '') return init;
  const rest: FetchInit = { ...init };
  delete rest.body;
  return rest;
}

function patchedFetch(input: FetchInput, init?: FetchInit): ReturnType<typeof globalThis.fetch> {
  return realFetch(input, requestAsSent(init));
}

function installFetch(): void {
  globalThis.fetch = patchedFetch;
}

export function installTransparentGlobals(): void {
  if (installed) return;
  installed = true;
  installClock();
  installTimers();
  installRandomness();
  installFetch();
}
