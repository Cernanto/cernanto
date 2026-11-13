// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { freshUUID } from './entropy.js';
import { setTimeout as delay } from 'node:timers/promises';

import { CernantoError } from '../language/errors.js';
import { LIFETIME_CLOSE_MS } from './facts.js';
import { noteIdleChange } from './idle-signal.js';
import { kernelSay } from '../traces/observe.js';

const realDelay = delay;
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const realExit = process.exit.bind(process);
/** The longest delay Node's timer takes: past it a timer fires at once. */
const LONGEST_TIMER_MS = 2_147_483_647;
const owners = new Set<CallLifetime>();
let retiring = false;

/** Whether incomplete cleanup has made this process unsuitable for new calls. */
export function retirementPending(): boolean {
  return retiring;
}

/** What a retirement runs: the served process's own shutdown, set at
 * boot; a process that serves nothing (a test) keeps the signal. */
let retireHook: (() => void) | undefined;

/** Sets the shutdown a retirement runs. */
export function setRetireHook(hook: (() => void) | undefined): void {
  retireHook = hook;
}

/** What the runtime keeps for the life of the process and ends with
 * it, once its calls settled: a lane's server child. */
const processEndings = new Set<() => Promise<void>>();

/** Has the process's shutdown run `end` once its calls settled;
 * answers what takes it back. */
export function onProcessEnd(end: () => Promise<void>): () => void {
  processEndings.add(end);
  return () => {
    processEndings.delete(end);
  };
}

/** Runs every ending the process holds, one after another; a failed
 * one leaves the rest to run. */
export async function endWithProcess(): Promise<void> {
  for (const end of [...processEndings]) await end().catch(() => undefined);
}

/** Retires the process: the drain runs and the process exits 1, so
 * whoever runs it starts it again with a fresh heap. A service's
 * program asks it when its replay cannot go on in this process. */
export function retireProcess(why: string): void {
  retire(why);
}

function retire(why: string): void {
  if (retiring) return;
  retiring = true;
  // The process's last word to whoever reads it (the launcher's error
  // file, a host log): a retirement is silent otherwise, and a copy
  // that leaves this way every minute is unreadable without it.
  kernelSay(`retiring this process: ${why}; the drain runs and the process exits 1\n`);
  if (retireHook !== undefined) retireHook();
  else process.kill(process.pid, 'SIGTERM');
  realSetTimeout(() => {
    realExit(1);
  }, 1000).unref();
}

/** A live call's local work. Cleanup completes before its owner releases admission. */
export class CallLifetime {
  readonly id: string = freshUUID();
  /** A lifetime the drain ends: a worker's run, which keeps its own
   * time and resumes from its journal when its generation's process
   * comes back. Every other call finishes under the drain
   * (SIGTERM is a drain): a task's or a job's call is keyed by its
   * generation, and a generation gone mid-call leaves its calls to the
   * plane to hand on, with the journals it wrote. */
  abortOnDrain = false;
  readonly controller: AbortController = new AbortController();
  readonly signal: AbortSignal = this.controller.signal;
  private readonly cleanups = new Set<() => Promise<void>>();
  private closing: Promise<void> | undefined;
  private unlink: (() => void) | undefined;

  constructor(parent?: AbortSignal) {
    owners.add(this);
    if (parent !== undefined) {
      const abort = (): void => {
        this.abort();
      };
      if (parent.aborted) abort();
      else parent.addEventListener('abort', abort, { once: true });
      this.unlink = () => {
        parent.removeEventListener('abort', abort);
      };
    }
  }

  /** Refuses work after completion or abandonment: with the reason the
   * attempt ended for when it was given as the kernel's own error (a
   * cancel's terminal words, so a body that reads kinds stops), else
   * the plain end of the attempt. */
  assertActive(): void {
    if (!this.signal.aborted) return;
    const reason: unknown = this.signal.reason;
    if (reason instanceof CernantoError) throw reason;
    throw new CernantoError({
      kind: 'retryable',
      message: 'this call attempt has ended; no new work can start in it',
    });
  }

  /** Ends cooperative work immediately and begins cleaning owned resources. */
  abort(): void {
    if (this.signal.aborted) return;
    this.controller.abort(
      new CernantoError({
        kind: 'retryable',
        message: 'this call attempt has ended; its work is being stopped',
      }),
    );
    for (const cleanup of this.cleanups) void cleanup().catch(() => undefined);
    queueMicrotask(() => {
      void this.close().catch((error: unknown) => {
        retire(
          `a call's cleanup failed after its abort: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  }

  /** Ends the attempt with the reason given (a replay that diverged
   * from the history); the body is let go, as after every end. */
  abandon(reason?: Error): void {
    if (reason !== undefined && !this.signal.aborted) this.controller.abort(reason);
    this.abort();
  }

  /** Registers a resource cleanup, returning its release operation. */
  own(cleanup: () => Promise<void>): () => void {
    this.assertActive();
    let closing: Promise<void> | undefined;
    const once = (): Promise<void> => (closing ??= Promise.resolve().then(cleanup));
    this.cleanups.add(once);
    return () => this.cleanups.delete(once);
  }

  /** Stops the owned resources; a resource that will not stop retires
   * its process. The body itself is let go: a body asleep on a real
   * timer or busy in compute wakes into an ended attempt, where every
   * durable operation is refused. */
  close(): Promise<void> {
    this.closing ??= this.finish();
    return this.closing;
  }

  private async finish(): Promise<void> {
    this.abort();
    const timeout = new AbortController();
    const budget = LIFETIME_CLOSE_MS;
    try {
      await Promise.race([
        Promise.all([...this.cleanups].map((cleanup) => cleanup())),
        realDelay(budget, undefined, { signal: timeout.signal }).then(() => {
          retire(`a call did not stop within the drain deadline of ${String(budget)} ms`);
          throw new CernantoError({
            kind: 'retryable',
            message: 'a call did not stop within the drain deadline; retiring this process',
          });
        }),
      ]);
    } catch (error) {
      retire(`a call's cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      timeout.abort();
      this.unlink?.();
      owners.delete(this);
    }
  }
}

/** The reason a wait ends with when its signal ends it: the signal's
 * own, when it names an Error, else the attempt's end in words. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new CernantoError({
        kind: 'retryable',
        message: 'the call ended before this operation completed',
      });
}

/** Waits `ms` on the machine's own timer, until the signal ends it: the
 * one wait a cancel can end, the abort reason travelling. A wait
 * marked `unref` lets the process exit while it runs. */
/** One wait of the kernel until a wall moment: what fires it, what
 * arms the machine's timer for it, and what stops that timer. */
interface DueWait {
  due: number;
  fire: () => void;
  arm: () => void;
  disarm: () => void;
}

/** The kernel's waits until a wall moment, each armed again after a
 * pause of the process: one that goes on elsewhere, or long after,
 * keeps the moment and not the machine's timer. */
const dueWaits = new Set<DueWait>();

/** Waits until the wall moment `due`, or until the signal ends the
 * wait. The wait survives a pause: `rearmDueWaits` fires what is due
 * and arms the rest again from the moment. */
export function sleepUntil(due: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof realSetTimeout> | undefined;
    const wait: DueWait = {
      due,
      fire: () => {
        wait.disarm();
        dueWaits.delete(wait);
        signal?.removeEventListener('abort', ended);
        noteIdleChange();
        resolve();
      },
      arm: () => {
        // Node's timer takes at most 2^31 - 1 ms and fires at once past
        // it: a longer wait is armed in bounds, the moment checked at
        // each, so a wait of a month fires in a month.
        const remaining = Math.max(0, due - Date.now());
        timer = realSetTimeout(
          () => {
            if (Date.now() >= due) wait.fire();
            else wait.arm();
          },
          Math.min(remaining, LONGEST_TIMER_MS),
        );
      },
      disarm: () => {
        if (timer !== undefined) realClearTimeout(timer);
        timer = undefined;
      },
    };
    const ended = (): void => {
      wait.disarm();
      dueWaits.delete(wait);
      noteIdleChange();
      reject(abortReason(signal ?? new AbortController().signal));
    };
    if (signal?.aborted === true) {
      ended();
      return;
    }
    signal?.addEventListener('abort', ended, { once: true });
    dueWaits.add(wait);
    wait.arm();
    noteIdleChange();
  });
}

/** The wall moments the kernel's waits are due at. */
export function dueWaitMoments(): number[] {
  return [...dueWaits].map((wait) => wait.due);
}

/** Arms every due wait again from the wall clock: what is due fires
 * now, the rest wait their remainder. Called once a paused process
 * goes on, where the machine's own timers may be another machine's or
 * long past. Answers how many waits there were. */
export function rearmDueWaits(): number {
  const waits = [...dueWaits];
  for (const wait of waits) {
    wait.disarm();
    if (wait.due <= Date.now()) wait.fire();
    else wait.arm();
  }
  return waits.length;
}

/** How many times a resume-time ask is made, and the first pause
 * between two asks, which doubles: four pauses, fifteen seconds in all,
 * well within the minute the host job waits for a resume. */
const RESUME_ASKS = 5;
const RESUME_FIRST_PAUSE_MS = 1000;

/** Runs a resume-time ask until it settles or its asks run out: a
 * refusal the substrate may take back (a store out of reach for a
 * moment, a busy file, a timeout) is asked again after a pause that
 * doubles; a terminal error, a fence (a newer holder owns the
 * journal: this copy stops), and the last refusal are thrown. */
export async function askingAgain<T>(what: string, ask: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await ask();
    } catch (error) {
      if (attempt >= RESUME_ASKS || !askedAgain(error)) throw error;
      kernelSay(
        `${what}: ${error instanceof Error ? error.message : String(error)}; asking again\n`,
      );
      await sleepMs(RESUME_FIRST_PAUSE_MS * 2 ** (attempt - 1));
    }
  }
}

/** Whether an error is one the substrate may take back: not a terminal
 * refusal, and not a fence. */
function askedAgain(error: unknown): boolean {
  if (!(error instanceof CernantoError)) return true;
  if (error.kind === 'terminal') return false;
  return (error.details as { fenced?: unknown } | undefined)?.fenced !== true;
}

export async function sleepMs(
  ms: number,
  signal?: AbortSignal,
  options?: { unref?: boolean },
): Promise<void> {
  try {
    await realDelay(ms, undefined, {
      ref: options?.unref !== true,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw abortReason(signal);
    throw error;
  }
}

/** Stops waiting on a substrate promise when its local call ends. */
export async function untilAborted<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => undefined;
  const ended = new Promise<never>((_, reject) => {
    abort = () => {
      reject(abortReason(signal));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, ended]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/** Ends the owners the drain ends: a worker's run. */
export function abortInvocations(): void {
  for (const owner of owners) if (owner.abortOnDrain) owner.abort();
}
