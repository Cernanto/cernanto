// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The request road of a served task, job or worker. A request a post
// hands over is taken by its ack in the copy's log (the write-ahead
// record, before the post is answered); one the log holds already is
// answered from the log, with its response when one stands. A request
// for a gone sibling (the destination's slot removed) is taken under the
// sibling's dead log, owned by a grant of this process's own. The body
// runs under its ack with its effects recorded in its lane of the log (a
// job's live body records nothing), retries an attempt that failed
// retryably with backoff, and ends with the response record, posted to
// the caller and posted again by the resend until acked. A process that
// comes back meets every request its log took and never answered by its
// type: a task's and a worker's body runs again from its records, a
// job's ends in the dead-job words, a request whose history lay in an
// image that is gone in the lost-image words, and a service's, met at a
// takeover of a dead sibling's log alone, in the replaced words, since
// the memory it ran in is gone with the sibling. A pointer in a dead log
// (a request a live sibling took as its own, program.ts) is met by
// nobody: the taker's log holds its answer.

import { debuglog } from 'node:util';
import { admitWhenFree, callSlot, holdDrain, isDraining, release } from './admission.js';
import type { CallSlot } from './admission.js';
import {
  CernantoError,
  errorWords,
  failureForRecord,
  isSecretFailure,
  markSecretFailure,
} from '../language/errors.js';
import { countTotals } from '../traces/trace.js';
import { runUnrecorded, traceCounter } from './execution.js';
import { openHandlerRecords, runUnderExecution } from './handler-run.js';
import type { HandlerRecords } from './handler-run.js';
import { stateOver, storyOfRun } from './stories.js';
import { isSecretHandler } from '../language/core.js';
import { callHandle, repeatsAttempt } from './connection.js';
import { CallLifetime, retireProcess, sleepMs } from './lifetime.js';
import { wallElapsedMs, wallNowMs } from './clock.js';
import { durableBackend } from './durable-backend.js';
import { unconfirmedWrite } from './journal.js';
import type { Journal } from './journal.js';
import {
  callIdOfRequest,
  deadJobWords,
  logNameOf,
  lostImageWords,
  recoveryOf,
  replacedWords,
  storyOfLog,
} from './log.js';
import type { Outcome, RequestAck, ResponseSent, Taken } from './log.js';
import { considerResend, forwardRequest, postResponse } from './transport.js';
import { callerAgentOf, parentCallOf } from './envelope.js';
import type { CallEnvelope } from './envelope.js';
import { STEP_MAX_ATTEMPTS, processFacts } from './facts.js';
import { failureRecord, backoffMs, noteRoom, ServedUnit, callParentField } from './units.js';
import type { PostedCall } from './units.js';
import type { CallMessage, HandedMessage, PostAnswer } from './call-server.js';
import type { CallContext } from './execution.js';
import type { HandlerFn } from '../language/handler-types.js';
import type { Backend } from './durable-backend.js';
import { takeOverLog } from './resume.js';
import { kernelSay } from '../traces/observe.js';

/** The bounded-retry guard for a pathologically flaky side effect. */
const MAX_ATTEMPTS = STEP_MAX_ATTEMPTS;

const debug = debuglog('cernanto-serve');

/** The observation flag as the caller set it: the machine's own calls
 * carry it, and a callee under it keeps the call out of its records and
 * forwards it. */
function observationContext(ack: { observation?: true }): Pick<CallContext, 'observation'> {
  return { observation: ack.observation === true };
}

/** The words a call is refused in when it names what this agent does
 * not serve: a handler it has not, or an interface it is bound through
 * that the agent does not implement at the contract the caller binds;
 * nothing when it is served. */
export function refusalOf(
  agentId: string,
  handlers: Readonly<Record<string, unknown>>,
  request: Pick<CallEnvelope, 'handler' | 'bound'>,
): string | undefined {
  if (handlers[request.handler] === undefined)
    return `agent "${agentId}" has no handler "${request.handler}"`;
  const { bound } = request;
  const stamps = processFacts().implements;
  if (bound === undefined || stamps === undefined) return undefined;
  const stamp = stamps.find((entry) => entry.id === bound.interface);
  if (stamp === undefined)
    return `agent "${agentId}" does not implement ${bound.interface}: a binding through ${bound.interface} reaches its implementors alone`;
  if (bound.sha !== '' && stamp.contractSha !== bound.sha)
    return `agent "${agentId}" implements ${bound.interface} at its contract ${stamp.contractSha.slice(0, 12)}, not at ${bound.sha.slice(0, 12)}, the one its caller binds: a deploy recompiles the agent behind`;
  return undefined;
}

/** The ack a request is taken under: the request as it arrived, the
 * caller's inbox in `from`. */
export function ackOf(envelope: CallEnvelope): RequestAck {
  return {
    request: envelope.request,
    from: envelope.replyTo ?? '',
    handler: envelope.handler,
    args: envelope.args,
    ...(envelope.replyTo === undefined ? {} : { replyTo: envelope.replyTo }),
    ...(envelope.caller === undefined ? {} : { caller: envelope.caller }),
    ...(envelope.credentials === undefined ? {} : { credentials: envelope.credentials }),
    ...(envelope.bound === undefined ? {} : { bound: envelope.bound }),
    ...(envelope.observation === true ? { observation: true } : {}),
    at: wallNowMs(),
  };
}

/** The outcome a standing response answers a post with: the record's. */
export function wireOutcomeOf(response: ResponseSent): { outcome: unknown } {
  return { outcome: response.outcome };
}

/** A request a post handed to a task, a job or a worker: refused in
 * words when the agent does not serve it; answered from the log when
 * the log holds it; taken under a dead sibling's log when it names
 * one; else taken here and run. */
export async function serveRequest(
  unit: ServedUnit,
  posted: PostedCall,
  handed: HandedMessage,
  envelope: CallEnvelope,
): Promise<void> {
  const own = unit.journal;
  if (own === undefined) {
    posted.giveBack(1000);
    return;
  }
  const to = logNameOf(envelope.to);
  let journal: Journal;
  if (to === own.log) journal = own;
  else {
    const { id, kind, call, from, body } = handed;
    const taken = await takeOrForward(unit, posted, { id, kind, call, from, body }, to);
    if (taken === undefined) return;
    journal = taken;
  }
  const standing = journal.takenOf(envelope.request);
  if (standing !== undefined) {
    // Taken before: the post is acked from the log, with the response
    // when one stands. Nothing runs.
    debug('%s %s: taken before', unit.service, envelope.request);
    posted.confirm(standing.response === undefined ? undefined : wireOutcomeOf(standing.response));
    return;
  }
  // New work alone is held to the contract this generation serves: a
  // request a log knows is answered from it whatever the handler is
  // here now.
  const refused = refusalOf(unit.agentId, unit.handlers, envelope);
  if (refused !== undefined) {
    posted.refuse({ kind: 'contract-violation', message: refused });
    return;
  }
  if (isDraining()) {
    posted.giveBack(1000);
    return;
  }
  const ack = ackOf(envelope);
  unit.starting.add(ack.request);
  try {
    await journal.take(ack);
  } catch (error) {
    if (unconfirmedWrite(error)) {
      // The ack may be stored: the request stays held here, so its
      // sender is never declined and pins nowhere else, and the process
      // leaves for the log to be read again by the next life.
      kernelSay(
        `${unit.service}/${envelope.handler} ${envelope.callId}: ${failureForRecord(error).error}; the process leaves\n`,
      );
      posted.giveBack(1000);
      retireProcess(failureForRecord(error).error);
      return;
    }
    unit.starting.delete(ack.request);
    noteRoom();
    kernelSay(
      `${unit.service}/${envelope.handler} ${envelope.callId} was not taken: ${failureForRecord(error).error}\n`,
    );
    posted.giveBack(1000);
    return;
  }
  // The ack is durable: the post is answered, and the body runs. A call
  // in is counted the moment it is first taken, whatever its runs do
  // after.
  posted.confirm();
  if (ack.observation !== true) countTotals({ callsIn: 1 });
  drive(unit, journal, ack, envelope.args);
}

/** A dead sibling's log, for a request named to it: taken over by this
 * process (the journal answered), or, when a live sibling holds it
 * already, the request handed to that sibling and the post answered
 * with its answer (nothing answered); a takeover that fails gives the
 * post back. */
export async function takeOrForward(
  unit: ServedUnit,
  posted: PostedCall,
  message: CallMessage,
  log: string,
): Promise<Journal | undefined> {
  let taken: Journal | { forward: string };
  try {
    taken = await takeOverLog(unit, log);
  } catch (error) {
    kernelSay(
      `${unit.service}: the log ${log} could not be taken over: ${failureForRecord(error).error}\n`,
    );
    posted.giveBack(1000);
    return undefined;
  }
  if (!('forward' in taken)) return taken;
  const answer = await forwardRequest(taken.forward, message).catch((): PostAnswer => ({
    acked: false,
  }));
  if (answer.acked) posted.confirm(answer.response);
  else if (answer.refused !== undefined) posted.refuse(answer.refused);
  else posted.giveBack(answer.retryInMs ?? 1000);
  return undefined;
}

/** Meets a request the log took and never answered, at a boot or a
 * takeover: by its recovery and the agent's type. */
export function meetTaken(unit: ServedUnit, journal: Journal, taken: Taken): void {
  const ack = taken.ack;
  if (ack === undefined || taken.response !== undefined) return;
  // A pointer: the request is the taker's, answered in its log.
  if (ack.takenBy !== undefined) return;
  if (unit.bodies.has(ack.request)) return;
  if (unit.definition.kind === 'service') {
    // A service meets a taken request only in a dead sibling's log: the
    // memory the request ran in went with the sibling, and no body of
    // it runs here.
    void answerInPlace(unit, journal, ack, {
      error: { kind: 'retryable', message: replacedWords(unit.service, ack.request) },
    });
    return;
  }
  if (unit.definition.kind === 'job') {
    void answerInPlace(unit, journal, ack, {
      error: { kind: 'terminal', message: deadJobWords(unit.agentId, ack.handler, ack.request) },
    });
    return;
  }
  // A task's or a worker's request whose history lay in an image: the
  // record names the image no more (a log is taken over by nobody while
  // it does), so the history went with it.
  if (recoveryOf(taken, false) === 'lost') {
    void answerInPlace(unit, journal, ack, {
      error: { kind: 'terminal', message: lostImageWords(unit.service, ack.handler, ack.request) },
    });
    return;
  }
  drive(unit, journal, ack, ack.args);
}

/** The requests being answered in place now: a second answer asked
 * while the first's record is on its way is the first's. */
const answeringInPlace = new Set<string>();

/** Answers a request in place of its body, in words: once, however
 * often asked while its record is on its way or stands. */
export async function answerInPlace(
  unit: ServedUnit,
  journal: Journal,
  ack: RequestAck,
  outcome: Outcome,
): Promise<void> {
  if (answeringInPlace.has(ack.request) || journal.takenOf(ack.request)?.response !== undefined)
    return;
  answeringInPlace.add(ack.request);
  kernelSay(
    `${unit.service}/${ack.handler} ${callIdOfRequest(ack.request)}: ${'error' in outcome ? outcome.error.message : 'answered'}\n`,
  );
  try {
    await answer(unit, journal, ack, outcome);
  } catch (error) {
    kernelSay(
      `${unit.service}/${ack.handler} ${callIdOfRequest(ack.request)}: the answer could not be recorded: ${failureForRecord(error).error}\n`,
    );
  } finally {
    answeringInPlace.delete(ack.request);
  }
}

/** The body's answer: the response record first, then the post; the
 * resend posts again until the caller acks. A worker's run over ends
 * the process with the run's code. */
async function answer(
  unit: ServedUnit,
  journal: Journal,
  ack: RequestAck,
  outcome: Outcome,
): Promise<void> {
  // A response standing in the log already is the call's answer: the
  // first life wrote it after the freeze, or a taker did, and this
  // body's own is not recorded beside it; the resend posts the
  // standing one until the caller acks it.
  if (journal.takenOf(ack.request)?.response !== undefined) {
    considerResend();
    return;
  }
  const response: ResponseSent = {
    request: ack.request,
    outcome,
    ...(ack.replyTo === undefined ? {} : { replyTo: ack.replyTo }),
    at: wallNowMs(),
  };
  await journal.answer(response);
  stateOver(unit, journal.log, ack, outcome);
  if (ack.replyTo !== undefined) {
    const acked = await postResponse(response).catch(() => false);
    if (acked) journal.noteResponseAcked(ack.request);
    else considerResend();
  }
  if (unit.definition.kind === 'worker' && ack.request === unit.runRequest) {
    const code = unit.runEnded(
      ack.request,
      'error' in outcome ? { error: outcome.error } : { result: outcome.result },
    );
    unit.endProcess?.(code);
  }
}

/** Runs a body under its ack and answers it. */
function drive(unit: ServedUnit, journal: Journal, ack: RequestAck, args: unknown): void {
  const { request } = ack;
  if (unit.bodies.has(request)) return;
  const lifetime = new CallLifetime();
  lifetime.abortOnDrain = unit.definition.kind === 'worker';
  unit.bodies.set(request, {
    log: journal.log,
    end: () => {
      lifetime.abort();
    },
  });
  if (unit.definition.kind === 'worker') unit.runRequest ??= request;
  const drain = holdDrain();
  void (async () => {
    try {
      const fn = unit.handlers[ack.handler];
      let outcome: Outcome | 'cut';
      if (fn === undefined) {
        outcome = {
          error: {
            kind: 'contract-violation',
            message: `agent "${unit.agentId}" has no handler "${ack.handler}"`,
          },
        };
      } else {
        outcome = await runInvocation(unit, journal, fn, ack, args, lifetime);
      }
      if (outcome === 'cut') return;
      await answer(unit, journal, ack, outcome);
    } catch (error) {
      kernelSay(
        `${unit.service}/${ack.handler} ${callIdOfRequest(request)}: ${failureForRecord(error).stack ?? failureForRecord(error).error}\n`,
      );
    } finally {
      drain();
      if (unit.bodies.get(request)?.end !== undefined) unit.letGo(request);
      journal.dropScope(request);
    }
  })();
}

/** Runs the attempts of one body until it answers or fails terminally;
 * `cut` when the drain ended a worker's run, which the generation's
 * next process goes on with. */
async function runInvocation(
  unit: ServedUnit,
  journal: Journal,
  fn: HandlerFn,
  ack: RequestAck,
  args: unknown,
  lifetime: CallLifetime,
): Promise<Outcome | 'cut'> {
  const { request, handler } = ack;
  const scope = journal.scope(request, ack.at);
  // The story the request is in the traces: its call's handle at the
  // destination its caller chose, which the log it lies in names.
  const storyId = storyOfLog(journal.log, request);
  for (let attempt = 1; ; attempt += 1) {
    const owner = new CallLifetime(lifetime.signal);
    owner.abortOnDrain = lifetime.abortOnDrain;
    unit.owners.set(request, owner);
    await scope.nextAttempt(owner.signal, (error) => {
      owner.abandon(error);
    });
    await admitWhenFree(handler);
    // The attempt's place among the slots: its waits for another
    // agent's answer give the slot back for as long as they last.
    const slot = callSlot();
    unit.starting.delete(request);
    let outcome: Outcome | 'retry' | 'cut';
    let retryWords = '';
    // Each attempt is a run of its own.
    const runOf = journal.nextRun();
    try {
      const output = await runAttempt(unit, scope.lane(request), fn, ack, args, owner, {
        storyId,
        runOf,
        slot,
      });
      owner.assertActive();
      await owner.close();
      outcome = { result: output };
    } catch (error) {
      await owner.close().catch(() => undefined);
      const fenced = error instanceof CernantoError && error.details?.['fenced'] === true;
      if (scope.diverged !== undefined) {
        kernelSay(
          `${unit.service}/${handler} ${callIdOfRequest(request)}: ${scope.diverged.message}\n`,
        );
        outcome = { error: failureRecord(scope.diverged) };
      } else if (fenced) {
        kernelSay(`${unit.service}/${handler} ${callIdOfRequest(request)}: ${error.message}\n`);
        outcome = 'cut';
      } else if (unit.cancelled.has(request)) {
        unit.cancelled.delete(request);
        outcome = {
          error: {
            kind: 'terminal',
            message: `the call ${callIdOfRequest(request)} of ${unit.service}/${handler} was cancelled`,
            cancelled: true,
          },
        };
      } else if (owner.abortOnDrain && isDraining()) {
        outcome = 'cut';
      } else if (!repeatsAttempt(error)) {
        outcome = { error: failureRecord(error) };
      } else if (attempt >= MAX_ATTEMPTS) {
        outcome = {
          error: {
            kind: 'terminal',
            message: `${unit.service}/${handler} ${callIdOfRequest(request)} failed ${String(attempt)} attempts; the last: ${errorWords(error)}`,
            ...(isSecretFailure(error) ? { secret: true as const } : {}),
          },
        };
      } else if (isDraining()) {
        outcome = 'cut';
      } else {
        outcome = 'retry';
        retryWords = failureForRecord(error).error;
      }
    } finally {
      slot.over();
      release();
      if (unit.owners.get(request) === owner) unit.owners.delete(request);
      noteRoom();
    }
    if (outcome !== 'retry') return outcome;
    const wait = backoffMs(attempt);
    kernelSay(
      `${unit.service}/${handler} ${callIdOfRequest(request)} attempt ${String(attempt)} failed: ${retryWords}; retrying in ${String(wait)}ms\n`,
    );
    await sleepMs(wait);
  }
}

/** One attempt of a handler: the per-call wrapper's own sequence over
 * the body's lane. A task's or a worker's body is journaled command by
 * command; a job's whole live body runs outside the log. */
async function runAttempt(
  unit: ServedUnit,
  journal: ReturnType<ReturnType<Journal['scope']>['lane']>,
  fn: HandlerFn,
  ack: RequestAck,
  input: unknown,
  lifetime: CallLifetime,
  run: { storyId: string; runOf: () => string; slot: CallSlot },
): Promise<unknown> {
  const { handler } = ack;
  const callId = callHandle(unit.service, callIdOfRequest(ack.request), unit.generation);
  const secret = isSecretHandler(fn);
  const callerAgentId = callerAgentOf(ack);
  const parentCallId = parentCallOf(ack);
  const parentStoryId = ack.caller?.story;
  const context: CallContext = {
    agentId: unit.agentId,
    ...observationContext(ack),
    callId,
    handle: callId,
    ...(callerAgentId === undefined ? {} : { callerAgentId }),
    ...(ack.caller?.target === undefined ? {} : { callerTarget: ack.caller.target }),
    ...(parentCallId === undefined ? {} : { callerCallId: parentCallId }),
    ...callParentField(ack),
    storyId: run.storyId,
    ...(parentStoryId === undefined ? {} : { parentStoryId }),
    childParentStory: run.storyId,
    runOf: run.runOf,
    ...(ack.caller?.charge === undefined ? {} : { charge: ack.caller.charge }),
  };
  const recorded = !secret && context.observation !== true;
  const story = recorded ? storyOfRun(ack, run) : undefined;
  const lineage = {
    ...(parentCallId === undefined ? {} : { parentCallId }),
    ...(callerAgentId === undefined ? {} : { callerAgentId }),
  };
  const kind = unit.definition.kind;
  const wholeBody = kind === 'job';
  const attempt = async (
    owner: CallLifetime,
    ownContext: CallContext,
    backend: Backend,
  ): Promise<{ output: unknown; records: HandlerRecords; durationMs: number }> => {
    const trace = traceCounter();
    const records = openHandlerRecords(
      {
        agentId: unit.agentId,
        callId,
        attemptId: ownContext.attemptId,
        handler,
        input,
        credentials: ack.credentials,
        ...lineage,
        story,
      },
      trace,
      { begin: recorded && !journal.isReplaying() },
    );
    try {
      const output = await runUnderExecution(
        { backend, context: ownContext, kind, owner, trace },
        owner,
        () => fn(input),
      );
      return { output, records, durationMs: wallElapsedMs() - records.startedAt };
    } catch (error) {
      const failure = secret ? markSecretFailure(error) : error;
      if (recorded) records.failed(failure);
      throw failure;
    }
  };
  const ended = (done: { output: unknown; records: HandlerRecords; durationMs: number }): void => {
    if (recorded) done.records.ended(done.output, done.durationMs);
  };
  const body = async (): Promise<unknown> => {
    if (!wholeBody) {
      const backend = durableBackend({
        journal,
        context,
        signal: lifetime.signal,
        slot: run.slot,
      });
      const done = await attempt(lifetime, context, backend);
      ended(done);
      return done.output;
    }
    // A job's whole live body: nothing of it is recorded, and an
    // interruption answers the dead-job words at the next boot.
    const owner = new CallLifetime(lifetime.signal);
    const releaseOwner = lifetime.own(() => owner.close());
    const ownContext = { ...context, attemptId: owner.id };
    try {
      const done = await attempt(
        owner,
        ownContext,
        durableBackend({ context: ownContext, signal: owner.signal, slot: run.slot }),
      );
      owner.assertActive();
      await owner.close();
      lifetime.assertActive();
      ended(done);
      return done.output;
    } finally {
      await owner.close();
      releaseOwner();
    }
  };
  return recorded ? body() : runUnrecorded(body);
}
