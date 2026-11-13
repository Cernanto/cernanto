// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { getCallContext, unrecordedActive } from '../kernel/execution.js';
import type { FactKind } from '../kernel/substrate.js';

import { z } from 'zod';

// The trace seam: the runtime installs the sink, and both libraries
// emit through it, so every call, step, and evaluation of a running
// agent leaves a record. A record is keyed by its story (one call in
// one request, `callId` carrying the story's id), its attempt, a
// sequence number that restarts with the handler, its kind and its run
// (one execution of the body by one process), so no two emissions share
// a key and every run writes its own versions; the reader shows one.
// The sink gives each record its place, a count of its process that
// orders a run.

const traceBaseFields = {
  agentId: z.string().min(1),
  callId: z.string().min(1),
  attemptId: z.string().min(1).optional(),
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  /** The run the record was made in: the grant by which its process
   * owns the request's log and the run's count under it. */
  run: z.string().optional(),
  /** The record's place among the records its process made. */
  place: z.number().int().nonnegative().optional(),
};

/** One handler call: what came in, what went out. The parent
 * call id links the callee back to its caller, so projections render
 * the call tree the way the follow-agent jump needs it. */
const handlerTraceSchema = z.object({
  ...traceBaseFields,
  kind: z.literal('handler'),
  handler: z.string().min(1),
  // Optional deliberately (zod v4 requires the key for a bare unknown):
  // a no-input handler's record crosses JSON without the key. Same for
  // args and payload below.
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  stack: z.string().optional(),
  parentCallId: z.string().optional(),
  /** Who called: the caller's agent id as the transport carried it,
   * so a callee's conversation can name where it came from. */
  callerAgentId: z.string().optional(),
  durationMs: z.number().nonnegative(),
});

/** One cross-agent call through a generated module. A wire call is a
 * durable call of the target; a linked call ran the module's
 * code in-process and is recorded for the same visibility, marked so
 * views can tell the two apart. */
const agentCallTraceSchema = z.object({
  ...traceBaseFields,
  kind: z.literal('agent-call'),
  target: z.string().min(1),
  handler: z.string().min(1),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  stack: z.string().optional(),
  linked: z.boolean().optional(),
  /** A test run's mock answered the call in place of the target's
   * deployment. */
  mocked: z.boolean().optional(),
  durationMs: z.number().nonnegative(),
});

/** One effect or real command, observed independently of its durability. */
const stepTraceSchema = z.object({
  ...traceBaseFields,
  kind: z.literal('step'),
  label: z.string().min(1),
  exitCode: z.number().int().nullable().optional(),
  exitSignal: z.string().nullable().optional(),
  error: z.string().optional(),
  stack: z.string().optional(),
  durationMs: z.number().nonnegative(),
});

/** A sleep the call took on the agent's own timer, recorded when the
 * timer ran its time. A timer cleared before that is a bound on
 * something else and has no record. */
const sleepTraceSchema = z.object({
  ...traceBaseFields,
  kind: z.literal('sleep'),
  /** How long the timer ran: what the agent asked. */
  durationMs: z.number().nonnegative(),
});

/** The start of a handler, a call, or a step: written the moment it
 * begins, so the chat knows when a message was sent as well as when it
 * was answered, and a call parked in flight is visible. The end record
 * (`handler`, `agent-call`, `step`) reuses this record's sequence
 * number: the pair shares a key prefix, the first write keeps the true
 * start across replays, and concurrent completions in a replayed
 * attempt land on one end. */
const beginTraceSchema = z.object({
  ...traceBaseFields,
  kind: z.literal('begin'),
  of: z.enum(['handler', 'call', 'step']),
  /** The handler starting (of handler), or the callee's handler (of call). */
  handler: z.string().optional(),
  /** The callee agent id (of call). */
  target: z.string().optional(),
  linked: z.boolean().optional(),
  /** The step's label (of step). */
  label: z.string().optional(),
  /** What came in (of handler) or went out (of call). */
  input: z.unknown().optional(),
  args: z.unknown().optional(),
  parentCallId: z.string().optional(),
  callerAgentId: z.string().optional(),
});

/** One console line a handler printed while running. */
const logTraceSchema = z.object({
  ...traceBaseFields,
  kind: z.literal('log'),
  /** `debug` is what the agent's own debuglog('agent') lines record
   * as: full-data notes at every operation, hidden until asked for. */
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
});

export const traceRecordSchema = z.discriminatedUnion('kind', [
  handlerTraceSchema,
  agentCallTraceSchema,
  stepTraceSchema,
  sleepTraceSchema,
  beginTraceSchema,
  logTraceSchema,
]);
export type TraceRecord = z.infer<typeof traceRecordSchema>;

/** Where an item of the traces is kept: the agent and its life. */
export interface LifeOf {
  service: string;
  life: string;
}

/** A fact of a story as the runtime states it. */
interface TraceFact {
  story: string;
  attempt: string;
  run: string;
  fact: FactKind;
  agentId: string;
  /** The moment the story began, its request's acceptance, ISO. */
  began: string;
  /** What the fact says, as JSON. */
  says: Record<string, unknown>;
}

/** A link from a story to a story it made. */
interface TracePointer {
  parent: string;
  child: string;
  agentId: string;
  attempt: string;
  seq: number;
  turn: number;
}

/** What a process adds to an agent's totals. */
export interface TotalsDelta {
  callsIn?: number;
  callsOut?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  unpriced?: number;
}

/** Receives every record; the runtime installs one per process. A
 * sink that keeps the traces on the plane also takes the facts, the
 * links and the counts; a proof's file sink takes the records alone. */
export interface TraceSink {
  record(record: TraceRecord): void;
  /** A fact, kept under the life named (the process's own when none). */
  fact?(fact: TraceFact, under?: LifeOf): void;
  pointer?(pointer: TracePointer): void;
  /** An amount added to the totals of the life named (the process's
   * own when none). */
  count?(delta: TotalsDelta, under?: LifeOf): void;
}

let activeSink: TraceSink | undefined;
/** Installs the sink and returns a restore function. */
export function setTraceSink(sink: TraceSink | undefined): () => void {
  const previous = activeSink;
  activeSink = sink;
  return () => {
    activeSink = previous;
  };
}

/** Whether this process has a sink for its records: a process the
 * plane runs does, an uninstrumented one keeps its own streams. */
export function traceSinkInstalled(): boolean {
  return activeSink !== undefined;
}

/** Emits one record to the installed sink; a missing sink drops the
 * record so uninstrumented processes pay nothing, and an unrecorded
 * call's scope drops everything it tries to emit. A record made
 * inside a call under the call's own id is the call's story's: its id is
 * the story's, its parent the parent's story, its run the run's. */
export function emitTrace(record: TraceRecord): void {
  if (unrecordedActive()) return;
  const context = getCallContext();
  const own = context !== undefined && context.callId === record.callId;
  if (!own) {
    activeSink?.record(record);
    return;
  }
  // Every record of a call names the call's parent, so the reader files
  // it under the parent without remembering anything: the story's
  // parent when the call has a story, else the parent the record or the
  // context names.
  const named = 'parentCallId' in record ? record.parentCallId : undefined;
  const parentCallId = context.parentStoryId ?? named ?? context.callParentId;
  const run = record.run ?? context.runOf?.();
  activeSink?.record({
    ...record,
    ...(context.storyId === undefined ? {} : { callId: context.storyId }),
    ...(record.attemptId !== undefined || context.attemptId === undefined
      ? {}
      : { attemptId: context.attemptId }),
    ...(parentCallId === undefined ? {} : { parentCallId }),
    ...(run === undefined ? {} : { run }),
  });
}

/** States a fact of a story to the sink, kept under the life named (the
 * process's own when none). */
export function emitFact(fact: TraceFact, under?: LifeOf): void {
  if (unrecordedActive()) return;
  activeSink?.fact?.(fact, under);
}

/** States a link from a story to a story it made. */
export function emitPointer(pointer: TracePointer): void {
  if (unrecordedActive()) return;
  activeSink?.pointer?.(pointer);
}

/** Adds to the totals of a life (the process's own when none named).
 * Counted whatever the records do: an observation and a call left out of
 * the traces count all the same. */
export function countTotals(delta: TotalsDelta, under?: LifeOf): void {
  activeSink?.count?.(delta, under);
}
