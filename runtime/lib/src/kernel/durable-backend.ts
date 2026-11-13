// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The facade's backend on the log: every durable verb is a command of
// the body's lane (journal.ts), settled in the world the first time and
// answered from the record on replay. A call is a `request sent` the
// resend keeps posting until the response is acked by the desk, which
// records the `response ack`; a publish settles on the callee's ack; a
// timer is armed with its due moment and fired or cleared; a lane
// operation and a cancel are observed with their answers; a draw is
// observed with its value. The live variant, for a job's body, runs
// outside the log: every reach happens as it is asked.

import { CernantoError } from '../language/errors.js';
import type { CallContext } from './execution.js';
import { currentBoundary, getCallContext, runLive } from './execution.js';
import { wallNowMs } from './clock.js';
import { countTotals, emitPointer } from '../traces/trace.js';
import { storyOf } from '../traces/story.js';
import { formTarget, processFacts } from './facts.js';
import { chargeField, lifeOfAgent, outgoingCharge } from './trace-facts.js';
import { holdCallOut } from './active-calls.js';
import { sleepMs, sleepUntil } from './lifetime.js';
import { serviceNameOf } from '../language/naming.js';
import { callHandle, parseHandle, subjectToken } from './connection.js';
import { errorFromRecord, recordedError } from './journal.js';
import type { CommandJournal } from './journal.js';
import { RESEND_EVERY_MS, requestIdFor } from './log.js';
import type { RequestSent } from './log.js';
import type { AcceptedCall } from './transport.js';
import {
  tellAcceptance,
  awaitResponse,
  chooseDestination,
  control,
  leavingDecline,
  liveCopyInboxes,
  pauseAfter,
  postRequest,
  replyInbox,
  takeResponse,
  unwrapReply,
  wireRequest,
  wireStart,
} from './transport.js';
import type { ArrivedResponse, CallIdentity } from './transport.js';

/** How long a journaled request waits at its copy for room, in one
 * post: the request is pinned there, so the copy keeps the post and
 * takes it the moment one of its calls ends. */
const FULL_HOLD_MS = 2000;

/** The longest pause between two asks of a request its copy declined for
 * want of room without keeping the post (a copy of a release that keeps
 * none): asked again at a pace, it is taken at the first ask after one
 * of the copy's calls ended. */
const FULL_PAUSE_MAX_MS = 2000;

/** What the wire's identity headers say about the caller of the
 * moment: a linked module runs inside this call as itself. */
function callIdentityOf(
  context: CallContext,
  parentCallId?: string,
  observation?: boolean,
  bound?: { interface: string; sha: string },
): CallIdentity {
  const current = getCallContext() ?? context;
  const story = current.childParentStory ?? current.storyId;
  const target = formTarget(current.agentId);
  return {
    agentId: current.agentId,
    callId: parentCallId ?? current.callId,
    hostAgentId: context.agentId,
    hostCallId: context.callId,
    ...(target === undefined ? {} : { target }),
    observation: current.observation === true || observation === true,
    ...(bound === undefined ? {} : { bound }),
    ...(story === undefined ? {} : { story }),
    ...chargeField(outgoingCharge(current)),
  };
}

/** Links the story a call is made from to the story of the request it
 * made: the pair, the child's agent, and the caller's record of the call
 * with the request's turn under it. Stated whenever the request's record
 * is in hand, first made or read back by a replay: the same link. */
function linkRequest(agentId: string, sent: RequestSent): void {
  if (sent.observation === true) return;
  const current = getCallContext();
  const parent = current?.childParentStory ?? current?.storyId;
  if (parent === undefined) return;
  const boundary = currentBoundary();
  if (boundary !== undefined) boundary.turns += 1;
  emitPointer({
    parent,
    child: storyOf(sent.to, sent.request),
    agentId,
    attempt: boundary?.attempt ?? current?.attemptId ?? '',
    seq: boundary?.seq ?? -1,
    turn: boundary?.turns ?? 1,
  });
}

/** Counts a call out under the life of the agent whose code made it,
 * once, when its request is first recorded. */
function countCallOut(sent: RequestSent): void {
  if (sent.observation === true) return;
  const agentId = sent.caller?.agentId ?? processFacts().agentId;
  const life = agentId === undefined ? undefined : lifeOfAgent(agentId);
  if (life !== undefined) countTotals({ callsOut: 1 }, life);
}

/** A call made with no journal (a job's), once a copy took its request:
 * counted out and linked to the story it was made from, as a journaled
 * call is when its record is made, so a job's calls are its calls out
 * and its children. */
function takenOutside(agentId: string, sent: RequestSent): void {
  countCallOut(sent);
  linkRequest(agentId, sent);
}

/** A call made with no journal (a job's) that its body waits on: held
 * from the ask to its answer as a call out of the agent whose code made
 * it, the machine's own aside, since no log holds it to be counted
 * from. */
async function waitedOutside<T>(
  who: CallIdentity,
  ask: (who: CallIdentity) => Promise<T>,
): Promise<T> {
  const letGo = who.observation === true ? undefined : holdCallOut(who.agentId);
  try {
    return await ask(who);
  } finally {
    letGo?.();
  }
}

/** The call id a caller-supplied key names: the same key always names
 * the same call, as the call's name; the request it rides is minted
 * anew by every attempt, so the key coalesces nothing. */
export function callIdOfKey(key: string): string {
  return `k-${subjectToken(key)}`;
}

function abortedError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new CernantoError({
        kind: 'retryable',
        message: 'this call attempt has ended; its work is being stopped',
      });
}

/** What a caller that asks for the call itself asks of it. */
interface InvokeAsked {
  idempotencyKey?: string | undefined;
  wait: boolean;
  host?: string | undefined;
  /** Told the moment the call is accepted. */
  accepted?: ((call: AcceptedCall) => void) | undefined;
}

/**
 * The one backend, what an execution runs its durable operations on. A
 * proof that needs a stand-in builds one of this shape.
 */
export interface Backend {
  /** The whole live body of a job as its one operation: nothing of it
   * is recorded, and a replay never finds it. */
  wholeRun<T>(action: () => Promise<T>): Promise<T>;
  /** One operation of a wire dependency (an openapi operation, an mcp
   * tool call), observed with its answer under its label. */
  lane<T>(label: string, action: () => Promise<T>): Promise<T>;
  /** The agent's own timer (a setTimeout of its code), armed with its
   * due moment: a replay waits the remainder, and a completed one
   * answers at once in order. `cleared` ends it early (clearTimeout),
   * the signal too (the promise form's). */
  sleep(ms: number, cleared: Promise<void>, site?: string): Promise<'fired' | 'cleared'>;
  /** One random draw of the agent's own code, observed with its value:
   * a replay answers the value drawn live, synchronously. */
  draw<T extends string | number>(live: () => T, site?: string): T;
  /** Resolves once the log holds every draw made so far. A call into
   * a linked module waits on it before the module runs: the module's
   * code is not journaled and runs again on a replay, so a draw it is
   * handed must stand in the log before the module acts on it. */
  drawsLanded(): Promise<void>;
  /** The moment the agent's clock reads on a replay; undefined while
   * the execution is live. */
  replayMoment(): number | undefined;
  callAgent(
    agentId: string,
    handler: string,
    args: unknown,
    parentCallId: string,
    /** The call is an observation (the machine's own, kept out of the
     * records) and the interface it is bound through, which the callee
     * checks it implements. */
    options?: { observation?: boolean; bound?: { interface: string; sha: string } },
  ): Promise<unknown>;
  /** Calls an agent named at run time for a caller that asks for the
   * call itself: its id, and its result when the caller waited. A
   * caller that does not wait is answered once the callee acked the
   * request, and nobody is sent the call's answer. */
  invokeAgent(
    agentId: string,
    handler: string,
    args: unknown,
    options: InvokeAsked,
    parentCallId: string,
  ): Promise<{ callId: string; result?: unknown }>;
  /** Asks for a call to end, by its id: the process that holds it ends
   * it. Whether the call was reached. */
  cancelCall(callId: string): Promise<boolean>;
}

/** Binds the facade to one body's lane of the log, or to the live world
 * when `journal` is absent. */
export function durableBackend(options: {
  journal?: CommandJournal | undefined;
  context: CallContext;
  signal?: AbortSignal | undefined;
  /** The body's place among its process's slots, when it holds one: a
   * wait for another agent's answer gives the slot back for the wait. */
  slot?: { waits(): () => void } | undefined;
}): Backend {
  const { context, journal } = options;
  const signal = options.signal ?? new AbortController().signal;
  /** Waits for another agent's answer. The body only waits while it
   * does, so its slot goes back until the answer is here. */
  const waitingFor = async <T>(answer: Promise<T>): Promise<T> => {
    const answered = options.slot?.waits();
    try {
      return await answer;
    } finally {
      answered?.();
    }
  };
  const identity = (
    parentCallId?: string,
    observation?: boolean,
    bound?: { interface: string; sha: string },
  ): CallIdentity => callIdentityOf(context, parentCallId, observation, bound);
  const assertAttempt = (): void => {
    if (signal.aborted) throw abortedError(signal);
  };
  /** What ends a command's run: the scope's attempt, or the body's own
   * life (a cancel ends the body alone, and its waits with it). */
  const endedBy = (attemptSignal: AbortSignal): AbortSignal =>
    AbortSignal.any([attemptSignal, signal]);

  /** A lane operation: observed with its answer under its label. */
  const laneCommand = async <T>(label: string, action: () => Promise<T>): Promise<T> => {
    assertAttempt();
    if (journal === undefined) return runLive(action);
    const settled = await journal.command<{ value: T }>({
      kind: 'lane',
      label,
      run: async () => ({ value: await runLive(action) }),
      completion: (done, ordinal) => ({
        type: 'observed',
        data: {
          parent: journal.lane,
          ordinal,
          kind: 'lane',
          ask: label,
          answer: done.value,
          at: wallNowMs(),
        },
      }),
      failure: (error, ordinal) => ({
        type: 'observed',
        data: {
          parent: journal.lane,
          ordinal,
          kind: 'lane',
          ask: label,
          error: recordedError(error),
          at: wallNowMs(),
        },
      }),
      settle: (entry) => {
        if (entry.type !== 'observed') throw new Error('a lane record was expected');
        if (entry.data.error !== undefined) throw errorFromRecord(entry.data.error);
        return { value: entry.data.answer as T };
      },
    });
    return settled.done.value;
  };

  type Woke = { fired?: true; cleared?: true };

  /** The wait of a timer until its due moment on the machine's own
   * clock, ended early by a clear or by the attempt's end (which
   * rejects, so nothing is recorded). */
  const waitOut = (
    due: number,
    cleared: Promise<void>,
    attemptSignal: AbortSignal,
  ): Promise<Woke> => {
    const own = new AbortController();
    return Promise.race([
      sleepUntil(due, AbortSignal.any([attemptSignal, own.signal])).then(() => ({
        fired: true as const,
      })),
      cleared.then(() => ({ cleared: true as const })),
    ]).finally(() => {
      own.abort();
    });
  };

  /** The request record of a call: the destination chosen, the id
   * minted from the lane's call and the ordinal. */
  const requestOf = async (
    ordinal: number,
    agentId: string,
    handler: string,
    args: unknown,
    parentCallId: string,
    options: {
      host?: string | undefined;
      bound?: { interface: string; sha: string } | undefined;
      observation: boolean;
      waits: boolean;
      callId?: string | undefined;
    },
  ): Promise<RequestSent> => {
    if (journal === undefined) throw new Error('a wire command needs a journal');
    const to = await chooseDestination(agentId, { host: options.host, signal });
    const who = identity(parentCallId, options.observation, options.bound);
    return {
      request: requestIdFor(options.callId ?? journal.callIdFor(ordinal)),
      parent: journal.lane,
      ordinal,
      to,
      ...(options.host === undefined ? {} : { host: options.host }),
      handler,
      args,
      ...(options.waits ? { replyTo: replyInbox() } : {}),
      caller: {
        agentId: who.agentId,
        callId: who.callId,
        ...(who.hostAgentId === undefined ? {} : { hostAgentId: who.hostAgentId }),
        ...(who.hostCallId === undefined ? {} : { hostCallId: who.hostCallId }),
        ...(who.story === undefined ? {} : { story: who.story }),
        ...(who.charge === undefined ? {} : { charge: who.charge }),
      },
      ...(who.observation === true ? { observation: true } : {}),
      ...(who.bound === undefined ? {} : { bound: who.bound }),
      at: wallNowMs(),
    };
  };

  /** A request's record, first made: counted as a call out. */
  const madeRequest = async (made: Promise<RequestSent>): Promise<RequestSent> => {
    const sent = await made;
    countCallOut(sent);
    return sent;
  };

  /** One call over the wire as the log records it: `request sent`
   * before the first post, the response acked by the desk as it lands
   * (`response ack`), the resend posting meanwhile. */
  const callCommand = async (
    agentId: string,
    handler: string,
    args: unknown,
    parentCallId: string,
    options: {
      host?: string | undefined;
      bound?: { interface: string; sha: string } | undefined;
      observation: boolean;
      callId?: string | undefined;
      accepted?: ((call: AcceptedCall) => void) | undefined;
    },
  ): Promise<{
    callId: string;
    result: unknown;
    generation: string | undefined;
    story?: string;
  }> => {
    const service = serviceNameOf(agentId);
    if (journal === undefined) throw new Error('a wire command needs a journal');
    const settled = await journal.command<
      ArrivedResponse & { generation?: string; story?: string }
    >({
      kind: 'call',
      label: `${service}/${handler}`,
      creation: async (ordinal) => ({
        type: 'request sent',
        data: await madeRequest(
          requestOf(ordinal, agentId, handler, args, parentCallId, {
            host: options.host,
            bound: options.bound,
            observation: options.observation,
            callId: options.callId,
            waits: true,
          }),
        ),
      }),
      run: async (creation, attemptSignal) => {
        if (creation?.type !== 'request sent') throw new Error('a request record was expected');
        const sent = creation.data;
        linkRequest(agentId, sent);
        const ended = endedBy(attemptSignal);
        const waiting = awaitResponse(sent.request, ended);
        const hearing = tellAcceptance(sent, options.accepted);
        // Set once the call settled, read by the posts made after it, the
        // settling happening while a post is out.
        const call = { settled: false };
        const settled = (): boolean => call.settled;
        try {
          // The first post, now, and again after the pause the callee
          // asked for, each pause twice the last, until a copy takes the
          // request or answers it. THE REQUEST WAITS AT ITS COPY FOR
          // ROOM: it is pinned there, so each post says it waits, the
          // copy keeps a post it has no room for and takes it the moment
          // one of its calls ends, and a burst larger than the copy's
          // slots goes through at the pace of the calls. A post kept
          // its whole wait and declined is posted again at once, the
          // wait made at the copy. A copy that declines for room without
          // keeping the post is asked again at a pace of two seconds at
          // most; a copy not serving yet says when, and a pause that
          // reaches the period is the resend's, as a post nothing
          // answered is: the resend posts again every period until the
          // desk records the response.
          void (async () => {
            let pause = 0;
            while (!settled() && !ended.aborted) {
              const posted = await postRequest(sent, { holdMs: FULL_HOLD_MS }).catch(
                () => undefined,
              );
              if (posted === undefined || settled()) return;
              if (posted.acked) {
                if (posted.response !== undefined)
                  void takeResponse(sent.request, posted.response).catch(() => undefined);
                return;
              }
              const refused = posted.refused ?? leavingDecline(posted, sent);
              if (refused !== undefined) {
                void takeResponse(sent.request, { outcome: { error: refused } }).catch(
                  () => undefined,
                );
                return;
              }
              if (posted.retryInMs === undefined) return;
              const full = posted.declined === 'busy';
              if (posted.held === true) pause = 0;
              pause = Math.min(
                Math.max(pauseAfter(posted), pause * 2),
                full ? FULL_PAUSE_MAX_MS : RESEND_EVERY_MS,
              );
              if (!full && pause >= RESEND_EVERY_MS) return;
              await sleepMs(pause, ended).catch(() => undefined);
            }
          })();
          return {
            ...(await waitingFor(waiting.arrived)),
            generation: sent.to.generation,
            story: storyOf(sent.to, sent.request),
          };
        } finally {
          call.settled = true;
          hearing();
          waiting.leave();
        }
      },
      // The desk recorded the ack before it handed the response here.
      completion: () => undefined,
      settle: (entry) => {
        if (entry.type !== 'response ack') throw new Error('a response ack was expected');
        const outcome = entry.data.outcome;
        if ('accepted' in outcome)
          throw new CernantoError({ kind: 'retryable', message: 'the recorded answer says again' });
        const destination = journal.destinationOf(entry.data.request);
        return {
          outcome,
          ...(destination === undefined
            ? {}
            : {
                generation: destination.generation,
                story: storyOf(destination, entry.data.request),
              }),
        };
      },
    });
    const outcome = settled.done.outcome;
    const callId = options.callId ?? journal.callIdFor(settled.ordinal);
    return {
      callId,
      result: unwrapReply(outcome),
      generation: settled.done.generation,
      ...(settled.done.story === undefined ? {} : { story: settled.done.story }),
    };
  };

  /** One call nobody waits for, as the log records it: `request sent`
   * without `replyTo`, the completion the callee's ack. */
  const startCommand = async (
    agentId: string,
    handler: string,
    args: unknown,
    parentCallId: string,
    callId: string | undefined,
    host?: string,
  ): Promise<string> => {
    const addressed = host === undefined ? {} : { host };
    if (journal === undefined) {
      const named = callId ?? `c-${crypto.randomUUID()}`;
      await wireStart({
        agentId,
        handler,
        args,
        callId: named,
        identity: identity(parentCallId),
        ...addressed,
        taken: (sent) => {
          takenOutside(agentId, sent);
        },
      });
      return named;
    }
    const settled = await journal.command<{ accepted: true }>({
      kind: 'call',
      label: `${serviceNameOf(agentId)}/${handler}`,
      creation: async (ordinal) => ({
        type: 'request sent',
        data: await madeRequest(
          requestOf(ordinal, agentId, handler, args, parentCallId, {
            host,
            observation: false,
            waits: false,
            callId,
          }),
        ),
      }),
      run: async (creation, attemptSignal) => {
        if (creation?.type !== 'request sent') throw new Error('a request record was expected');
        const sent = creation.data;
        linkRequest(agentId, sent);
        const ended = endedBy(attemptSignal);
        // The request waits at its copy for room, as a call's does, and
        // a copy that declines it is asked again at a pace.
        for (let round = 1; ; round += 1) {
          if (ended.aborted) throw abortedError(ended);
          const posted = await postRequest(sent, { holdMs: FULL_HOLD_MS });
          if (posted.acked) return { accepted: true as const };
          const refused = posted.refused ?? leavingDecline(posted, sent);
          if (refused !== undefined) throw errorFromRecord(refused);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, Math.min(pauseAfter(posted), 5000));
          });
        }
      },
      completion: (done, ordinal) => ({
        type: 'response ack',
        data: {
          request: '',
          parent: journal.lane,
          ordinal,
          outcome: done,
          at: wallNowMs(),
        },
      }),
      settle: () => ({ accepted: true as const }),
    });
    return callId ?? journal.callIdFor(settled.ordinal);
  };

  const invokeCommand = async (
    agentId: string,
    handler: string,
    args: unknown,
    options: InvokeAsked,
    parentCallId: string,
  ): Promise<{ callId: string; requestId?: string; result?: unknown }> => {
    assertAttempt();
    const service = serviceNameOf(agentId);
    const named =
      options.idempotencyKey === undefined ? undefined : callIdOfKey(options.idempotencyKey);
    if (!options.wait) {
      const callId = await startCommand(agentId, handler, args, parentCallId, named, options.host);
      return { callId: callHandle(service, callId) };
    }
    if (journal === undefined) {
      const callId = named ?? `c-${crypto.randomUUID()}`;
      const reply = await waitingFor(
        waitedOutside(identity(parentCallId), (who) =>
          wireRequest({
            agentId,
            handler,
            args,
            callId,
            identity: who,
            signal,
            ...(options.host === undefined ? {} : { host: options.host }),
            ...(options.accepted === undefined ? {} : { accepted: options.accepted }),
            taken: (sent) => {
              takenOutside(agentId, sent);
            },
          }),
        ),
      );
      return {
        callId: callHandle(service, callId, reply.generation),
        ...(reply.story === undefined ? {} : { requestId: reply.story }),
        result: unwrapReply(reply),
      };
    }
    const answered = await callCommand(agentId, handler, args, parentCallId, {
      host: options.host,
      observation: false,
      callId: named,
      accepted: options.accepted,
    });
    return {
      callId: callHandle(service, answered.callId, answered.generation),
      ...(answered.story === undefined ? {} : { requestId: answered.story }),
      result: answered.result,
    };
  };

  return {
    wholeRun: (action) => runLive(action),
    lane: laneCommand,
    sleep: async (ms, cleared, site) => {
      assertAttempt();
      if (journal === undefined) {
        const woke = await waitOut(wallNowMs() + ms, cleared, signal);
        return woke.cleared === true ? 'cleared' : 'fired';
      }
      const settled = await journal.command<Woke>({
        kind: 'timer',
        site: site ?? 'timer',
        creation: (ordinal) => ({
          type: 'observed',
          data: {
            parent: journal.lane,
            ordinal,
            kind: 'timer',
            site: site ?? 'timer',
            phase: 'armed',
            ask: wallNowMs() + ms,
            at: wallNowMs(),
          },
        }),
        run: (creation, attemptSignal) => {
          const due =
            creation?.type === 'observed' && typeof creation.data.ask === 'number'
              ? creation.data.ask
              : wallNowMs() + ms;
          return waitOut(due, cleared, endedBy(attemptSignal));
        },
        completion: (done, ordinal) => ({
          type: 'observed',
          data: {
            parent: journal.lane,
            ordinal,
            kind: 'timer',
            site: site ?? 'timer',
            phase: done.cleared === true ? 'cleared' : 'fired',
            at: wallNowMs(),
          },
        }),
        settle: (entry) =>
          entry.type === 'observed' && entry.data.phase === 'cleared'
            ? { cleared: true as const }
            : { fired: true as const },
      });
      return settled.done.cleared === true ? 'cleared' : 'fired';
    },
    draw: (live, site) => {
      assertAttempt();
      return journal === undefined ? live() : journal.observe(live, site);
    },
    drawsLanded: () => journal?.drawsLanded() ?? Promise.resolve(),
    replayMoment: () => journal?.replayMoment(),
    callAgent: async (agentId, handler, args, parentCallId, options): Promise<unknown> => {
      assertAttempt();
      if (journal === undefined) {
        const reply = await waitedOutside(
          identity(parentCallId, options?.observation, options?.bound),
          (who) =>
            wireRequest({
              agentId,
              handler,
              args,
              callId: `c-${crypto.randomUUID()}`,
              identity: who,
              signal,
              taken: (sent) => {
                takenOutside(agentId, sent);
              },
            }),
        );
        return unwrapReply(reply);
      }
      return (
        await callCommand(agentId, handler, args, parentCallId, {
          bound: options?.bound,
          observation: options?.observation === true,
        })
      ).result;
    },
    invokeAgent: invokeCommand,
    cancelCall: async (callId: string): Promise<boolean> => {
      const parsed = parseHandle(callId);
      if (parsed === undefined) return false;
      const end = async (holder: { inbox: string }): Promise<boolean> => {
        const answered = await control(holder, { operation: 'cancel', callId: parsed.callId });
        return answered.done;
      };
      // The cancellation goes to the copies of the service: the one
      // whose log holds the call ends it, every other says no.
      const ask = async (): Promise<boolean> => {
        for (const inbox of await liveCopyInboxes(parsed.service)) {
          if (await end({ inbox }).catch(() => false)) return true;
        }
        return false;
      };
      if (journal === undefined) return runLive(ask);
      const settled = await journal.command<{ done: boolean }>({
        kind: 'cancel',
        label: callId,
        run: async () => ({ done: await runLive(ask) }),
        completion: (done, ordinal) => ({
          type: 'observed',
          data: {
            parent: journal.lane,
            ordinal,
            kind: 'cancel',
            ask: callId,
            answer: done.done,
            at: wallNowMs(),
          },
        }),
        settle: (entry) => ({ done: entry.type === 'observed' && entry.data.answer === true }),
      });
      return settled.done.done;
    },
  };
}
