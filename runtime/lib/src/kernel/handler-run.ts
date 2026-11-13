// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// One handler's run, the mechanics the three roads share: a task's, a
// job's or a worker's attempt, a service's call and a linked module's
// turn all open a begin record, run the body under its execution and
// close with the end record, an output or a failure. What differs stays
// where it is: the service's replay, the task's retries, the job's
// whole-body lifetime and the linked module's ownership by its host.

import { failureForRecord } from '../language/errors.js';
import { wallElapsedMs, wallNowIso } from './clock.js';
import type { Execution, TraceCounter } from './execution.js';
import { nextTraceSequence, runWithExecution } from './execution.js';
import type { CallLifetime } from './lifetime.js';
import { untilAborted } from './lifetime.js';
import { emitFact, emitTrace } from '../traces/trace.js';
import type { LifeOf } from '../traces/trace.js';

/** The story a run's records are kept under: its id, its parent's, the
 * run, the moment the story began (its request's acceptance, the same
 * in every run), the copy that runs it and, for a linked call, the
 * module's life its facts are kept under too. */
export interface RunStory {
  id: string;
  parentId?: string | undefined;
  runOf: () => string;
  began: string;
  copy?: { generation: number; copy: number } | undefined;
  callerModuleId?: string | undefined;
  alsoUnder?: LifeOf | undefined;
}

/** Who ran what: the records' identity and lineage. */
interface HandlerRun {
  agentId: string;
  callId: string;
  attemptId?: string | undefined;
  handler: string;
  /** The handler's input; left out for a secret's, whose records carry
   * neither input nor output. */
  input?: unknown;
  /** The paths of the input that are credentials: the records carry
   * the path with `[withheld]` in place of the value. */
  credentials?: string[] | undefined;
  parentCallId?: string | undefined;
  callerAgentId?: string | undefined;
  /** The story the records are kept under; the call's id alone where
   * none is named (a proof's own road). */
  story?: RunStory | undefined;
}

/** What the records say a credential was. */
export const WITHHELD = '[withheld]';

/** The input as the records carry it: a copy with the value at every
 * credential's path replaced, the input itself when no path is named.
 * A path names a part of the input and a key in it, joined by the
 * first dot (`header.authorization`, `query.api-key`); a path the
 * input does not reach is passed over. */
export function recordedInput(input: unknown, credentials: string[] | undefined): unknown {
  if (credentials === undefined || credentials.length === 0) return input;
  if (typeof input !== 'object' || input === null) return input;
  const copy = structuredClone(input) as Record<string, unknown>;
  for (const path of credentials) {
    const dot = path.indexOf('.');
    if (dot <= 0) continue;
    const part = copy[path.slice(0, dot)];
    const key = path.slice(dot + 1);
    if (typeof part === 'object' && part !== null && Object.hasOwn(part, key))
      (part as Record<string, unknown>)[key] = WITHHELD;
  }
  return copy;
}

/** The run's records: the begin as the records open (when asked), the
 * end by whichever closer the road calls. */
export interface HandlerRecords {
  /** The begin's sequence, shared by the end. */
  seq: number;
  /** The moment the run began, on the monotonic clock. */
  startedAt: number;
  /** The end record with the output; the duration given, else measured now. */
  ended(output: unknown, durationMs?: number): void;
  /** The end record with the failure's words and stack, or its kind
   * alone when it came out of a secret call. */
  failed(error: unknown): void;
}

/** Opens a handler's records under its trace counter: the begin record
 * now when `begin` says so (a replayed take emits none; a secret's or
 * an observation's road emits nothing at all and calls no closer). A
 * run with a story states that the run began, and that it ended when it
 * ends, whatever the records do: every run of a story writes its own
 * facts, so a listing knows the state of its last run. */
export function openHandlerRecords(
  run: HandlerRun,
  trace: TraceCounter,
  options: { begin: boolean },
): HandlerRecords {
  const seq = nextTraceSequence(trace);
  const startedAt = wallElapsedMs();
  const story = run.story;
  const identity = {
    agentId: run.agentId,
    callId: story?.id ?? run.callId,
    ...(run.attemptId === undefined ? {} : { attemptId: run.attemptId }),
    seq,
    handler: run.handler,
    ...('input' in run ? { input: recordedInput(run.input, run.credentials) } : {}),
    ...(story?.parentId === undefined
      ? run.parentCallId === undefined
        ? {}
        : { parentCallId: run.parentCallId }
      : { parentCallId: story.parentId }),
    ...(run.callerAgentId === undefined ? {} : { callerAgentId: run.callerAgentId }),
  };
  const stamped = (): { run?: string } => (story === undefined ? {} : { run: story.runOf() });
  const state = (fact: 'began' | 'ended', says: Record<string, unknown>): void => {
    if (story === undefined) return;
    const stated = {
      story: story.id,
      attempt: run.attemptId ?? '',
      run: story.runOf(),
      fact,
      agentId: run.agentId,
      began: story.began,
      says,
    };
    emitFact(stated);
    if (story.alsoUnder !== undefined) emitFact(stated, story.alsoUnder);
  };
  if (options.begin)
    emitTrace({ ...identity, ...stamped(), at: wallNowIso(), kind: 'begin', of: 'handler' });
  state('began', {
    handler: run.handler,
    at: story?.began,
    ...(story?.parentId === undefined ? {} : { parentCallId: story.parentId }),
    ...(run.callerAgentId === undefined ? {} : { callerAgentId: run.callerAgentId }),
    ...(story?.callerModuleId === undefined ? {} : { callerModuleId: story.callerModuleId }),
    ...(story?.copy === undefined ? {} : { copy: story.copy }),
  });
  return {
    seq,
    startedAt,
    ended(output, durationMs) {
      const spent = durationMs ?? wallElapsedMs() - startedAt;
      emitTrace({
        ...identity,
        ...stamped(),
        at: wallNowIso(),
        kind: 'handler',
        durationMs: spent,
        ...(output === undefined ? {} : { output }),
      });
      state('ended', { status: 'ok', durationMs: Math.round(spent) });
    },
    failed(error) {
      const spent = wallElapsedMs() - startedAt;
      const failure = failureForRecord(error);
      emitTrace({
        ...identity,
        ...stamped(),
        at: wallNowIso(),
        kind: 'handler',
        durationMs: spent,
        ...failure,
      });
      state('ended', { status: 'error', durationMs: Math.round(spent), error: failure.error });
    },
  };
}

/** Runs a body under its execution. With an owner, the owner's end
 * ends the run whatever the body awaits (a body stuck on a timer the
 * end of the attempt refused would otherwise hold the invoker for
 * good), and a body that starts in an ended attempt is refused before
 * it runs; a linked module's turn runs under its host's owner and
 * needs neither. */
export function runUnderExecution<T>(
  execution: Execution,
  owner: CallLifetime | undefined,
  body: () => Promise<T>,
): Promise<T> {
  if (owner === undefined) return runWithExecution(execution, body);
  return untilAborted(
    runWithExecution(execution, () =>
      Promise.resolve().then(() => {
        owner.assertActive();
        return body();
      }),
    ),
    owner.signal,
  );
}
