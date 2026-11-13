// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// Admission and the drain: a process holds at most its slots of handler
// calls at work (none named = unbounded), and once it is
// draining it takes none new. A SLOT IS A CALL THAT WORKS: a call that
// only waits for another agent's answer gives its slot back for the
// wait and is still in flight, so the drain waits for it and the idle
// clock counts it. A copy that keeps every call that waits among its
// slots takes nothing once they are full, the answer its waiting calls
// wait for among what it does not take, and nothing ends by itself.
// SIGTERM is a drain: the intake stops,
// every call the process holds finishes under the code that started it
// and records, the trace sinks flush, then the process exits. The
// backend's grace is the one bound on that: a call that never finishes
// is ended by the backend's kill. A crash can catch an effect sent but
// not yet journaled and replay it twice; a drain leaves every effect
// journaled.

import { CernantoError } from '../language/errors.js';
import { CLOSE_MS, processFacts } from './facts.js';
import { noteIdleChange } from './idle-signal.js';
import { abortInvocations, retirementPending } from './lifetime.js';

function slotCap(): number {
  return processFacts().slots ?? 0;
}
let inFlightHandlers = 0;
/** The calls in flight that only wait for another agent's answer. */
let waitingHandlers = 0;
let drainHolds = 0;
let draining = false;
const drainWaiters: (() => void)[] = [];

/** Wakes the drain once nothing is in flight any more. */
function wakeDrainWhenEmpty(): void {
  if (inFlightHandlers === 0 && drainHolds === 0) {
    for (const wake of drainWaiters.splice(0)) wake();
  }
}
const slotWaiters: (() => void)[] = [];
/** Told whenever a slot comes back, a call's end or its wait. */
const roomListeners: (() => void)[] = [];

/** Hears every slot that comes back: the lanes that wait for room. */
export function onRoom(listener: () => void): void {
  roomListeners.push(listener);
}

/** A slot came back: whoever waits for one may look again. */
function roomMade(): void {
  for (const wake of slotWaiters.splice(0)) wake();
  for (const listener of roomListeners) listener();
}

/** The process's admission state, for tests and the shutdown: the
 * calls in flight, how many of them only wait, and the slots. */
export function admissionState(): {
  inFlight: number;
  waiting: number;
  draining: boolean;
  slots: number;
} {
  return { inFlight: inFlightHandlers, waiting: waitingHandlers, draining, slots: slotCap() };
}

/** The calls at work: the ones in flight that do not only wait. */
function atWork(): number {
  return inFlightHandlers - waitingHandlers;
}

/** One admitted call's place among the slots. `waits` says the call
 * waits for another agent's answer from now until the function it
 * answers is called: the slot is given back for as long as any wait of
 * the call is open, however many it opened at once, and the call works
 * again when the last one closes. `over` ends the place with the call,
 * whatever waits it left open. */
export interface CallSlot {
  waits(): () => void;
  over(): void;
}

/** The place of a call just admitted. */
export function callSlot(): CallSlot {
  let open = 0;
  let ended = false;
  return {
    waits: () => {
      if (ended) return () => undefined;
      open += 1;
      if (open === 1) {
        waitingHandlers += 1;
        roomMade();
      }
      let closed = false;
      return () => {
        if (closed || ended) return;
        closed = true;
        open -= 1;
        if (open === 0) waitingHandlers -= 1;
      };
    },
    over: () => {
      if (ended) return;
      ended = true;
      if (open > 0) waitingHandlers -= 1;
      open = 0;
    },
  };
}

/** Whether the process is draining: it takes no new call. */
export function isDraining(): boolean {
  return draining;
}

/** Admits one handler call or refuses it retryably; `release`
 * returns the slot. Exported for the admission tests. */
export function admit(handlerName: string): void {
  if (draining || retirementPending()) {
    throw new CernantoError({
      kind: 'retryable',
      message: `this process is draining and takes no new call to ${handlerName}; retry elsewhere`,
    });
  }
  const cap = slotCap();
  if (cap > 0 && atWork() >= cap) {
    throw new CernantoError({
      kind: 'retryable',
      message: `this process holds its ${String(cap)} slots (${String(atWork())} calls at work); ${handlerName} waits its turn`,
    });
  }
  inFlightHandlers += 1;
  noteIdleChange();
}

/** Waits for a free slot, then admits; a draining process refuses. */
export async function admitWhenFree(handlerName: string): Promise<void> {
  for (;;) {
    if (draining || retirementPending()) admit(handlerName);
    const cap = slotCap();
    if (cap === 0 || atWork() < cap) {
      admit(handlerName);
      return;
    }
    await new Promise<void>((wake) => {
      slotWaiters.push(wake);
    });
  }
}

export function release(): void {
  inFlightHandlers -= 1;
  if (inFlightHandlers < 0) inFlightHandlers = 0;
  roomMade();
  wakeDrainWhenEmpty();
  noteIdleChange();
}

/**
 * Holds the drain for work that is neither a handler nor a slot: a
 * request the gateway is answering (a document read, a call
 * proxied through it). A process that exits with such
 * a request in flight hands its caller a dead socket, and a fetch that
 * died without an answer is terminal for the caller's attempt.
 */
export function holdDrain(): () => void {
  drainHolds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    drainHolds -= 1;
    if (drainHolds < 0) drainHolds = 0;
    wakeDrainWhenEmpty();
  };
}

/**
 * Holds one in-flight call for the drain, outside admission's refusals
 * and the slot cap: the caller already owns the work (a program's call
 * is out of its mailbox before its body starts), but a draining
 * process must still wait for it to finish and to record.
 */
export function holdInFlight(): () => void {
  inFlightHandlers += 1;
  noteIdleChange();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

/** What a drain may be told beyond the runtime's own rules. */
interface DrainOptions {
  /** How the process leaves; the drain test hands its own. */
  exit?: (code: number) => void;
  /** The closers' budget. */
  closeMs?: number;
  /** The code a signal's drain leaves with: zero where every call
   * finishes, a worker's own where the drain cuts its run. */
  signalCode?: number;
}

/** Installs the SIGTERM and SIGINT drain: no new calls (the intake
 * stopped), every call in flight finishes and records, the closers run
 * (the trace sinks, the substrate connection), then the process exits
 * with the code given (zero for a drain; a finished worker's run hands
 * its own; a signal's drain, the code it was installed with). The
 * returned function is the drain itself, for a run that ends its
 * process. */
export function installGracefulShutdown(
  stopIntake: () => void,
  closers: readonly (() => Promise<void>)[],
  options: DrainOptions = {},
): (code?: number) => void {
  const exit =
    options.exit ??
    ((code: number): void => {
      process.exit(code);
    });
  const closeMs = options.closeMs ?? CLOSE_MS;
  const signalCode = options.signalCode ?? 0;
  const shutdown = (code = 0): void => {
    if (draining) return;
    draining = true;
    // A worker's run is the one call the drain ends: it keeps its
    // own time and resumes from its journal when its generation's
    // process comes back. Every other call runs to its end; the
    // backend's grace ends one that never does.
    abortInvocations();
    stopIntake();
    const settled = new Promise<void>((done) => {
      if (inFlightHandlers === 0 && drainHolds === 0) {
        done();
        return;
      }
      drainWaiters.push(done);
    });
    // The closers run one after another, in the order they were given:
    // the trace sinks ship what the drained calls recorded last, over a
    // substrate connection the last closer then drains. Run side by
    // side, the connection would drain under the sink's send and a
    // drained call's end would miss the store (the trace sink writes by
    // its tick, outside the handler's context). The closers get a
    // budget of their own: a program that outlives the drain (a
    // worker's run keeps its journal busy, so the connection never
    // drains) must not hold the process until the backend's kill;
    // SIGTERM is a drain, and the drain ends.
    void settled
      .then(async () => {
        const closing = (async () => {
          for (const close of closers) await close().catch(() => undefined);
        })();
        const closeDeadline = new Promise<void>((done) => {
          setTimeout(done, closeMs).unref();
        });
        await Promise.race([closing, closeDeadline]);
      })
      .finally(() => {
        exit(code);
      });
  };
  process.once('SIGTERM', () => {
    shutdown(signalCode);
  });
  process.once('SIGINT', () => {
    shutdown(signalCode);
  });
  return shutdown;
}
