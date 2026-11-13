// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Backend } from './durable-backend.js';
import { CernantoError } from '../language/errors.js';
import type { CallLifetime } from './lifetime.js';

// The one execution context of a process: what the running handler
// carries, identity, journal, lifetime, the recording flag and its own
// trace counter, in one async-local scope. The runtime's own work
// around a handler raises its flag on the same scope (an unrecorded
// run), and a linked module runs in a child context sharing the
// call's journal and lifetime with a counter of its own.

/** The identity of the running call, opened by the runtime's serve
 * wrapper and read by every library that attributes work. */
export interface CallContext {
  agentId: string;
  callId: string;
  /** The call's handle on the wire, its service-qualified id, kept
   * through a linked module's trace contexts. */
  handle?: string;
  /** The actual live body attempt, present on job traces. */
  attemptId?: string;
  /** The served agent that owns a linked module execution. */
  hostAgentId?: string;
  /** Suppresses accounting of the accounting transport's own work. */
  observation?: boolean;
  principal?: string;
  /** The agent that made this wire call, read from the call's
   * caller; absent for plain and root calls. Platform
   * agents key attribution on it (per-agent ai defaults, seat labels)
   * which keeps identity out of the payload. */
  callerAgentId?: string;
  /** The agent the calling verification form stands for, read from the
   * call's caller; absent for every other caller. */
  callerTarget?: string;
  /** The calling call's id, read from the call's caller.
   * Platform agents use it where per-call identity matters
   * (judgment accounting). */
  callerCallId?: string;
  /** The call this one is a child of in the trace tree: the caller's
   * host call when the caller is a linked module, else the caller's
   * own. Every record of the call is stamped with it. */
  callParentId?: string;
  /** The story this call is in the traces: the call's id with its
   * request in it, a linked call's its host's with the link's mark.
   * Every record of the call carries it as its `callId`. */
  storyId?: string;
  /** The story this one is a child of: the caller's, or its host's when
   * the caller is a linked module. */
  parentStoryId?: string;
  /** The story a call this code makes is a child of: this call's own,
   * or its host's in a linked module. */
  childParentStory?: string;
  /** The run the call's records are made in, read at each record: the
   * grant by which this process owns the request's log (a restored life
   * owns it by a newer one) and the run's count under it. */
  runOf?: () => string;
  /** The agent a model request made inside this call is charged to, and
   * its life: the last agent of the chain that is not one of the
   * release's own. */
  charge?: { agentId: string; life: string };
}

/** The record numbers of one call: from zero at handler entry, so a
 * replay reproduces identical numbers and each of its records is a
 * version of the first run's, under the same position. */
export interface TraceCounter {
  seq: number;
}

/** Everything a running handler carries. */
export interface Execution {
  backend: Backend;
  context: CallContext;
  kind?: 'task' | 'job' | 'service' | 'worker' | 'module';
  owner?: CallLifetime;
  trace: TraceCounter;
}

/** The scope of the process: the execution a handler runs in, when
 * one does, and the flag the runtime raises around it. */
interface Scope {
  execution?: Execution;
  /** An unrecorded run: everything inside stays out of the trace,
   * outgoing edges included, so an observation stays one through its
   * own dependency calls. */
  unrecorded?: true;
  /** A live run: a job's whole body or a lane's action, inside which
   * the transparent globals answer the machine's own time and
   * randomness: the body is one recorded operation, whole. */
  live?: true;
  /** The record of a call out under way: the request it makes links
   * the child's story to it. */
  boundary?: CallBoundary;
}

/** The caller's record of one call out: its attempt and sequence, and
 * how many requests it made so far (a call asked anew is the next). */
interface CallBoundary {
  attempt: string;
  seq: number;
  turns: number;
}

const scope = new AsyncLocalStorage<Scope>();
const NOWHERE: Scope = {};

function current(): Scope {
  return scope.getStore() ?? NOWHERE;
}

/** Runs a function with the execution active, the scope's flag kept:
 * the serve wrapper enters a handler's, a linked call its module's. */
export function runWithExecution<T>(execution: Execution, fn: () => T): T {
  return scope.run({ ...current(), execution }, fn);
}

/** The active execution when inside a handler, undefined outside. */
export function currentExecution(): Execution | undefined {
  return current().execution;
}

/** The active call context, or undefined outside a served call. */
export function getCallContext(): CallContext | undefined {
  return current().execution?.context;
}

/** The active execution. Calling a facade function outside a served
 * handler is a programming error and says so. */
export function requireExecution(): Execution {
  const execution = current().execution;
  if (execution === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: 'this function only works inside a running agent handler; it was called outside one',
    });
  }
  execution.owner?.assertActive();
  return execution;
}

/** Runs the machine's own work outside the execution: the work is the
 * kernel's, apart from any call's journal and identity. The kernel's
 * loops run this way between two calls, so each call the loop takes
 * starts clear of the last handler's context. */
export function outsideExecution<T>(fn: () => T): T {
  const { unrecorded } = current();
  return scope.run({ ...(unrecorded === undefined ? {} : { unrecorded }) }, fn);
}

/** Runs one unrecorded call's body (see the scope). */
export function runUnrecorded<T>(fn: () => T): T {
  return scope.run({ ...current(), unrecorded: true }, fn);
}

/** Whether the current async context is an unrecorded run's. */
export function unrecordedActive(): boolean {
  return current().unrecorded === true;
}

/** Runs a call out under its boundary: the requests it makes take their
 * turns under it. */
export function runInBoundary<T>(boundary: CallBoundary, fn: () => T): T {
  return scope.run({ ...current(), boundary }, fn);
}

/** The boundary of the call out under way, when one is. */
export function currentBoundary(): CallBoundary | undefined {
  return current().boundary;
}

/** Runs a job's live body or a lane's action (see the scope). */
export function runLive<T>(fn: () => T): T {
  return scope.run({ ...current(), live: true }, fn);
}

/** Whether the current async context is a live body's. */
export function liveActive(): boolean {
  return current().live === true;
}

/** A fresh counter: the serve wrapper makes one per attempt, a linked
 * call one per module context. */
export function traceCounter(): TraceCounter {
  return { seq: 0 };
}

/** The next record number of a call, taken. */
export function nextTraceSequence(counter: TraceCounter): number {
  const seq = counter.seq;
  counter.seq += 1;
  return seq;
}

/** The record number the call's next record will take, without taking
 * it: for deriving an identity (a linked module's call id) from the
 * record about to be written. */
export function peekTraceSequence(counter: TraceCounter): number {
  return counter.seq;
}
