// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { durableBackend } from '../kernel/durable-backend.js';
import { CernantoError, failureForRecord, markSecretFailure } from './errors.js';
import { substrateConfigured } from '../kernel/connection.js';
import { agentServed } from '../kernel/transport.js';
import { countTotals, emitPointer, emitTrace } from '../traces/trace.js';
import { linkedStoryOf } from '../traces/story.js';
import { chargeField, chargedIn, lifeOfAgent, outgoingCharge } from '../kernel/trace-facts.js';
import { holdLinkedCall } from '../kernel/active-calls.js';
import {
  currentExecution,
  getCallContext,
  nextTraceSequence,
  peekTraceSequence,
  requireExecution,
  runInBoundary,
  runUnrecorded,
  traceCounter,
} from '../kernel/execution.js';
import type { AgentStub, InterfaceBinding } from './handler-types.js';
import type { CallContext, TraceCounter } from '../kernel/execution.js';

import { processFacts } from '../kernel/facts.js';
import { planeBinding } from '../kernel/fit.js';
import { regionInvoke, regionWireCall, runAsLinkedModule, servingIdentity } from './serving.js';
import { wallElapsedMs, wallNowIso } from '../kernel/clock.js';
import { openHandlerRecords, recordedInput, runUnderExecution } from '../kernel/handler-run.js';

/** A defined agent: its kind and its handlers, ready to serve or to run
 * under the test harness. The agent id comes from the spec path at
 * registration. */
export interface Definition {
  kind: 'service' | 'task' | 'job' | 'worker' | 'module';
  /** The exported functions, each typed as the coder wrote it: the
   * entry the compiler emits and the glue the runtime writes name
   * them as they are, and the runtime hands each one the call's json
   * (`HandlerFn`) at serve time. */
  handlers: Record<string, AgentFunction>;
}

/**
 * An exported agent function as the coder wrote it: its own declared
 * parameters and one promised answer. The wire hands a handler one
 * argument, the call's json, which the function parses (exports are
 * the API); a module's helpers take their parameters in process from
 * the code that links them. `never` in the parameter positions accepts
 * every declared parameter list, so a function typed with its input
 * interface, or with three parameters of its own, wires without a
 * cast.
 */
export type AgentFunction = (...args: never[]) => Promise<unknown>;

/** The sequence of the records this process writes outside any
 * call: a suite child's, filed by its parent under the run. */
const plainTrace = traceCounter();

/**
 * Calls a dependency agent through its typed stub as a durable
 * request: the call survives crashes on durable backends and the
 * result is journaled.
 *
 * @example
 * const sent = await call(stub('notifications/telegram-send', 'send'), { chatId, text });
 */

export async function call<TArgs, TResult>(
  stub: AgentStub<TArgs, TResult>,
  args: TArgs,
): Promise<TResult> {
  // Outside any call the code is in the real world, whether the
  // serving region has opened or not: a module-scope reach (a standing
  // channel resolving its configuration and bearer at load, before
  // anything serves) and a region handler take the same road, one plain
  // wire call whose callee journals itself.
  if (currentExecution() === undefined) {
    // Outside the serving region too (module load), but only in a
    // process the plane actually runs: the substrate address must be
    // explicit there, or importing an agent's module in a test or a
    // tool would silently dial whatever listens on the default port.
    // The region itself is entered only in a served process and keeps
    // its default.
    if (!substrateConfigured()) {
      throw new CernantoError({
        kind: 'terminal',
        message:
          `${stub.agentId}.${stub.handler} was called outside any call in a process the plane does not ` +
          'run (no substrate): module-scope calls serve only on the plane; in tests, ' +
          'register the agent in a world and call through it',
      });
    }
    // A process that belongs to a run (a tester's suite child) speaks
    // as that run: the callee's records name it as their parent, and
    // the call's boundary is recorded under it like a journaled call's,
    // in this process's own sequence (the parent files the records the
    // child hands up under the run's). Any other process's call from
    // here goes unrecorded, under a caller id of its own.
    const run = processFacts().callId;
    const bound = stub.bound === undefined ? {} : { bound: stub.bound };
    if (run === undefined) {
      return (await regionWireCall(stub.agentId, stub.handler, args, bound)) as TResult;
    }
    const identity = { agentId: servingIdentity(), callId: run };
    const secret = stub.secret === true;
    return recordedBoundary(
      { context: identity, trace: plainTrace },
      { target: stub.agentId, handler: stub.handler, args, secret },
      () =>
        regionWireCall(stub.agentId, stub.handler, args, {
          identity,
          ...bound,
        }) as Promise<TResult>,
    );
  }
  const execution = requireExecution();
  const { backend, context } = execution;
  const { agentId, handler } = stub;
  // A secret's call (the contract's mark): the caller's boundary omits
  // the arguments and the result, and the call rides like any other.
  const secret = stub.secret === true;
  return recordedBoundary(execution, { target: agentId, handler, args, secret }, async () => {
    const result = (await backend.callAgent(agentId, handler, args, context.callId, {
      ...(stub.bound === undefined ? {} : { bound: stub.bound }),
    })) as TResult;
    return result;
  });
}

/** What `invoke` takes beside the call, from a caller that asks for the
 * call itself. */
interface InvokeOptions {
  /** Names the call: the same key is the same call while it runs and
   * until its answer is delivered. */
  idempotencyKey?: string;
  /** `false` starts the call and answers once the callee has accepted
   * it, durably: nobody is sent the call's answer. */
  wait?: boolean;
  /** The host the call goes to: it is delivered to the copy of the
   * agent on that server, which takes the lane of its host beside the
   * agent's shared lane (a job's copies do), for an act that is one
   * server's own; absent, whichever copy takes the call serves it. */
  host?: string;
  /** Told the moment the call is accepted, before its answer: its id,
   * the id of the request its records are kept under and the copy that
   * took it, which a follower of the call reaches it by. The answer
   * still comes when it comes. */
  accepted?: (call: Accepted) => void;
}

/** A call as `invoke` tells it at its acceptance. */
export interface Accepted {
  callId: string;
  requestId: string;
  copy: { key: string; epoch?: number; address: { host: string; port: number } };
}

/** A call as `invoke` answers it to a caller that asked for the call
 * itself: its id, which `cancel` takes, and its result when the caller
 * waited. The id of a call that was waited for names the version that
 * ran it, and is the id its records are filed under; the id of a call
 * nobody waited for names no version yet. */
export interface Invoked {
  callId: string;
  /** The id of the request the call's records are kept under: the
   * call's id with its request in it; absent for a call nobody
   * waited for. */
  requestId?: string;
  result?: unknown;
}

/**
 * Calls an agent named at run time: the same journaled call a
 * generated dependency module makes, for a target the code learns
 * only when it runs (a tester by its id, a consumer a delivery names).
 * The handler's answer comes back as the call's result; a refused or
 * failed call throws in the callee's words.
 *
 * With options the call itself comes back, its id beside its result.
 * `wait: false` starts the call and answers once the callee has
 * accepted it, durably, over HTTP: the callee runs it, nobody is sent
 * its answer, and nothing of it is kept for a later question. Started
 * from a journal, such a call is started at least once: a caller that
 * dies between the post and its own record of it posts again, which the
 * callee takes as the call it already holds while that call's journal
 * stands, and which runs the call again once the call has ended and its
 * journal is gone.
 */
export async function invoke(agentId: string, handler: string, args: unknown): Promise<unknown>;
export async function invoke(
  agentId: string,
  handler: string,
  args: unknown,
  options: InvokeOptions,
): Promise<Invoked>;
export async function invoke(
  agentId: string,
  handler: string,
  args: unknown,
  options?: InvokeOptions,
): Promise<unknown> {
  if (options === undefined) return call(stub<unknown, unknown>(agentId, handler), args);
  const asked = {
    idempotencyKey: options.idempotencyKey,
    wait: options.wait !== false,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.accepted === undefined ? {} : { accepted: options.accepted }),
  };
  // The caller's record of a call nobody waits for holds the call's id
  // in place of an answer.
  const recorded = (invoked: Invoked): unknown =>
    asked.wait ? invoked.result : { callId: invoked.callId };
  if (currentExecution() === undefined) {
    requirePlaneIngress(agentId);
    const run = processFacts().callId;
    if (run === undefined) return regionInvoke(agentId, handler, args, asked);
    const identity = { agentId: servingIdentity(), callId: run };
    return recordedBoundary(
      { context: identity, trace: plainTrace },
      { target: agentId, handler, args },
      () => regionInvoke(agentId, handler, args, { ...asked, identity }),
      recorded,
    );
  }
  const execution = requireExecution();
  const { backend, context } = execution;
  return recordedBoundary(
    execution,
    { target: agentId, handler, args },
    () => backend.invokeAgent(agentId, handler, args, asked, context.callId),
    recorded,
  );
}

/**
 * A call of an operation of an implemented document, made by its server
 * from outside any call: `invoke` waited for, whose arguments at the
 * `credentials` paths are credentials the call's records name without
 * their values. Inside a call it is `invoke` itself.
 */
export async function invokeOperation(
  agentId: string,
  handler: string,
  args: unknown,
  credentials: string[],
): Promise<Invoked> {
  if (currentExecution() !== undefined) return invoke(agentId, handler, args, {});
  requirePlaneIngress(agentId);
  const asked = { wait: true, ...(credentials.length === 0 ? {} : { credentials }) };
  const run = processFacts().callId;
  if (run === undefined) return regionInvoke(agentId, handler, args, asked);
  const identity = { agentId: servingIdentity(), callId: run };
  return recordedBoundary(
    { context: identity, trace: plainTrace },
    { target: agentId, handler, args: recordedInput(args, credentials) },
    () => regionInvoke(agentId, handler, args, { ...asked, identity }),
    (invoked: Invoked) => invoked.result,
  );
}

/**
 * Asks for a call to end, by its id: the process that holds the call
 * ends its attempt, and the call answers whoever waits for it that it
 * was cancelled. The runtime ends the call with every command it
 * started and refuses every durable operation its body asks for
 * afterwards. A body waiting on the agent's own memory is let go where
 * it stands: it runs on in memory when what it waits for wakes it, and
 * what it answers then goes nowhere. A call that still waits in the
 * stream, taken by no process and waited for by nobody, is removed and
 * never starts. Answers whether the call was reached; a call that
 * already ended, or that nobody runs, answers false. Inside a durable
 * handler the ask is journaled (a replay answers what the first attempt
 * saw).
 */
export async function cancel(callId: string): Promise<boolean> {
  if (currentExecution() === undefined) {
    requirePlaneIngress(callId);
    return durableBackend({ context: machineContext() }).cancelCall(callId);
  }
  return requireExecution().backend.cancelCall(callId);
}

/** The context of an ask made outside any call: the process's
 * own identity under the run it belongs to (a suite child's), else a
 * call id nobody has; its journal none. */
function machineContext(): CallContext {
  return {
    agentId: servingIdentity(),
    callId: processFacts().callId ?? `plain-${crypto.randomUUID()}`,
  };
}

/** The plain wire is only for a process the plane runs. */
function requirePlaneIngress(subject: string): void {
  if (!substrateConfigured()) {
    throw new CernantoError({
      kind: 'terminal',
      message:
        `${subject} was reached outside any call in a process the plane does not ` +
        'run (no substrate): module-scope calls serve only on the plane',
    });
  }
}

/** Who called this handler, as the transport stamped it: the calling
 * agent's id and its call id, absent for plain and
 * root calls, and, when the caller is a verification form, the
 * agent it stands for (`target`): a caller whose id is the target is
 * the agent's test form, any other caller with a target is its tester.
 * Platform agents key attribution on it (per-agent defaults, seat
 * labels, a place per agent), which keeps identity out of the payload. */
export function caller(): { agentId?: string; callId?: string; target?: string } {
  const context = getCallContext();
  return {
    ...(context?.callerAgentId === undefined ? {} : { agentId: context.callerAgentId }),
    ...(context?.callerCallId === undefined ? {} : { callId: context.callerCallId }),
    ...(context?.callerTarget === undefined ? {} : { target: context.callerTarget }),
  };
}

/**
 * This agent's own id: the name it is deployed under on this plane,
 * for a value the platform must recognize as this agent (a webhook
 * source, the target of a call to itself, a configuration key of its
 * own). Read it here rather than from a literal: while an agent is
 * verified it runs under another name, and a literal names the live
 * agent instead.
 */
export function agentId(): string {
  const id = processFacts().agentId;
  if (id === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: 'agentId() was asked outside a served agent: no generation names this process',
    });
  }
  return id;
}

/**
 * This process's own package digest, `sha256:<hex>`, as the fleet
 * names the generation's artifact: what a process stamps when it says
 * which bytes it is, the way the compiler stamps its own identity on
 * a compile. A fact of the process.
 */
export function artifact(): string {
  const digest = processFacts().artifact;
  if (digest === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: 'artifact() was asked outside a served agent: no generation names this process',
    });
  }
  return digest;
}

/**
 * The modules this process composes: each linked module's id to the
 * package digest it runs, empty when it composes none. A fact of the
 * process, the generation's composition as the fleet planned it.
 */
export function composition(): Record<string, string> {
  return { ...(processFacts().composition ?? {}) };
}

/**
 * The plane's place this process was booted with, a `file:` url on a
 * laptop: a fact of the process, read without a call or a journal
 * record. An agent opens nothing of its own on it, since the platform's
 * agents reach the plane's stores through the interfaces that stand for
 * them; the os module the compile renders keeps the name and its
 * answer.
 */
export function substrateUrl(): string {
  const url = processFacts().substrateUrl;
  if (url === undefined || url === '') {
    throw new CernantoError({
      kind: 'terminal',
      message:
        'substrateUrl() was asked outside a served agent: this process was booted without a substrate',
    });
  }
  return url;
}

/** What one request to a model cost, as the code that made it reports
 * it: its tokens and its price, when the provider gives one. */
interface UsageReport {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * Reports what a request to a model cost, right after the model
 * answered: the amount is added to the totals of the agent the running
 * call names to charge (the last agent of the chain that is not one of
 * the release's own), and of the agent whose code runs when no call
 * names one. Never journaled and never skipped: one execution is one
 * real request, so a request a replay makes again is reported again,
 * as it is paid again.
 */
export function usage(report: UsageReport): void {
  const under = chargedIn(getCallContext());
  if (under === undefined) return;
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  const cost = report.costUsd;
  const priced = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0;
  countTotals(
    {
      tokensIn: count(report.inputTokens),
      tokensOut: count(report.outputTokens),
      ...(priced ? { costUsd: cost } : { unpriced: 1 }),
    },
    under,
  );
}

/** The current call's stable identity, also inside a linked module. */
export function callId(): string {
  const { context } = requireExecution();
  return context.handle ?? context.callId;
}

/** The local body's attempt identity, for scratch and observation only. */
export function attemptId(): string {
  const owner = requireExecution().owner;
  if (owner === undefined)
    throw new CernantoError({
      kind: 'terminal',
      message: 'this execution has no call lifetime',
    });
  return owner.id;
}

/** The current body's lifetime, for code written against this library
 * itself (the kernel's own roads, a hand-written process). An agent's
 * generated code has its os module, which carries no signal, and its
 * cancellation needs none: the runtime ends a cancelled call with
 * every command it started. The signal ends when the body returns,
 * when its attempt ends, and when the call is cancelled by its handle,
 * whose words it then carries as its reason. A linked module shares
 * the host's signal. An end is an ask, as with every AbortSignal: a
 * wait or an operation that takes the signal ends with it, and code
 * waiting on anything else is let go where it stands and runs on when
 * that wakes it, inside a call whose durable operations are refused.
 * @returns The signal of the body that asks.
 * @example await once(arrivals, 'posted', { signal: callSignal() });
 */
export function callSignal(): AbortSignal {
  const owner = requireExecution().owner;
  if (owner === undefined)
    throw new CernantoError({
      kind: 'terminal',
      message: 'this execution has no call lifetime',
    });
  return owner.signal;
}

/**
 * Records one in-process call the way a wire call is recorded on the
 * caller's side: an `agent-call` record marked linked, with the
 * arguments and the answer, under the caller's own identity. The
 * function runs as the caller: this is the shape for the openapi lane,
 * where the generated operation is the caller's own step against a
 * document.
 */
/**
 * The one boundary of a call as its caller records it: the begin
 * record when the call goes out and the end record with its duration
 * and its result or its error, both under one sequence number of the
 * caller's trace. A secret's boundary (the contract's mark) carries
 * neither the arguments nor the result, and of a failure its kind
 * alone: the one place the rule is applied on the caller's side. The
 * failure leaves the boundary marked, so the records written of it
 * further up carry its kind alone too. A linked call's boundary says
 * so, and a mock's.
 */
async function recordedBoundary<T>(
  caller: { context: Pick<CallContext, 'agentId' | 'callId' | 'attemptId'>; trace: TraceCounter },
  boundary: {
    target: string;
    handler: string;
    args: unknown;
    secret?: boolean | undefined;
    linked?: boolean | undefined;
    mocked?: boolean | undefined;
  },
  run: () => Promise<T>,
  resultOf: (result: T) => unknown = (result) => result,
): Promise<T> {
  const { context } = caller;
  const { target, handler, args } = boundary;
  const secret = boundary.secret === true;
  const linked = boundary.linked === true ? { linked: true as const } : {};
  const startedAt = wallElapsedMs();
  const seq = nextTraceSequence(caller.trace);
  emitTrace({
    agentId: context.agentId,
    callId: context.callId,
    seq,
    at: wallNowIso(),
    kind: 'begin',
    of: 'call',
    target,
    handler,
    ...(secret ? {} : { args }),
    ...linked,
  });
  const end = () => ({
    agentId: context.agentId,
    callId: context.callId,
    seq,
    at: wallNowIso(),
    kind: 'agent-call' as const,
    target,
    handler,
    ...(secret ? {} : { args }),
    ...linked,
    ...(boundary.mocked === true ? { mocked: true } : {}),
    durationMs: wallElapsedMs() - startedAt,
  });
  try {
    // The requests the call makes are linked to this record: its
    // attempt, its sequence and their turns under it.
    const result = await runInBoundary({ attempt: context.attemptId ?? '', seq, turns: 0 }, run);
    emitTrace({ ...end(), ...(secret ? {} : { result: resultOf(result) }) });
    return result;
  } catch (error) {
    const failure = secret ? markSecretFailure(error) : error;
    emitTrace({ ...end(), ...failureForRecord(failure) });
    throw failure;
  }
}

/**
 * Runs one linked module function in-process and records the call the
 * way a wire call is recorded, on both sides. The function executes
 * inside the caller's call, as the module. A module is an agent,
 * so the call into it is a call node of its own (a handler record
 * under the module's id and a call id derived from the host's,
 * parented to the host), and everything the module does while running,
 * its judgments, its wire calls, its steps, its console lines, its
 * asks, is attributed to the module and nested under that node. The
 * caller keeps its own record of the link, so both conversations show
 * the exchange. Outside a handler the function just runs.
 */
export async function linkedCall<TArgs, TResult>(
  agentId: string,
  handler: string,
  args: TArgs,
  fn: (args: TArgs) => Promise<TResult>,
  options?: {
    /** The linked code is a mock the tests wrote in place of the agent
     * (a tester's shadow of the agent under test links one per listed
     * id): the caller's record says so, and the trace reads `(mock)`. */
    mocked?: boolean;
    /** The function's arguments or answer are secrets (the contract's
     * mark): both stay out of the traces. */
    secret?: boolean;
  },
): Promise<TResult> {
  const execution = currentExecution();
  if (execution === undefined) return runAsLinkedModule(agentId, () => fn(args));
  const { context } = execution;
  const secret = options?.secret === true;
  // The link's ordinal in the host call is deterministic across
  // replays (the sequence resets when the handler starts), so the
  // module's call id is the same each time the journal replays. The
  // ordinal is the link's own begin/end sequence, taken by the
  // recorded call below, so it is read here without consuming.
  const ordinal = peekTraceSequence(execution.trace);
  // The module's story: its host's with the link's mark, as its call id
  // is its host's with that mark.
  const hostStory = context.storyId ?? context.callId;
  const storyId = linkedStoryOf(hostStory, context.attemptId, ordinal);
  const moduleLife = lifeOfAgent(agentId);
  // The host is the module's caller for the trace.
  const moduleContext: CallContext = {
    agentId,
    hostAgentId: context.hostAgentId ?? context.agentId,
    callId: `${context.callId}~${context.attemptId === undefined ? '' : `${context.attemptId}:`}${String(ordinal)}`,
    handle: context.handle ?? context.callId,
    ...(context.observation === undefined ? {} : { observation: context.observation }),
    ...(context.attemptId === undefined ? {} : { attemptId: context.attemptId }),
    callerAgentId: context.agentId,
    callerCallId: context.callId,
    storyId,
    parentStoryId: hostStory,
    ...(context.runOf === undefined ? {} : { runOf: context.runOf }),
    ...chargeField(outgoingCharge(context)),
  };
  const moduleTrace = traceCounter();
  // The link in flight is a call the process holds: a call in of the
  // module that runs, a call out of the code that called it, the
  // machine's own traffic left out.
  const letGo =
    moduleContext.observation === true ? undefined : holdLinkedCall(agentId, context.agentId);
  const linked = recordedBoundary(
    execution,
    { target: agentId, handler, args, secret, linked: true, mocked: options?.mocked === true },
    async () => {
      // The link is a call into the module, counted as a call over the
      // wire is: in under the module's own life, out under its caller's,
      // once (a replay that runs the link again counts nothing while it
      // replays); the machine's own traffic is left out.
      if (moduleContext.observation !== true && execution.backend.replayMoment() === undefined) {
        if (moduleLife !== undefined) countTotals({ callsIn: 1 }, moduleLife);
        const callerLife = lifeOfAgent(context.agentId);
        if (callerLife !== undefined) countTotals({ callsOut: 1 }, callerLife);
      }
      if (!secret)
        emitPointer({
          parent: hostStory,
          child: storyId,
          agentId,
          attempt: context.attemptId ?? '',
          seq: ordinal,
          turn: 1,
        });
      // A secret's input stays out of every record, the module's own
      // included.
      const records = openHandlerRecords(
        {
          agentId,
          callId: moduleContext.callId,
          handler,
          ...(secret ? {} : { input: args }),
          parentCallId: context.callId,
          callerAgentId: context.agentId,
          ...(secret || moduleContext.observation === true
            ? {}
            : {
                story: {
                  id: storyId,
                  parentId: hostStory,
                  runOf: context.runOf ?? (() => ''),
                  began: wallNowIso(),
                  ...(moduleLife === undefined ? {} : { alsoUnder: moduleLife }),
                },
              }),
        },
        moduleTrace,
        { begin: true },
      );
      try {
        // The module runs with the host's backend as itself: the whole
        // host execution carries over, the context and the trace
        // counter swapped; the host's owner ends it. It runs once the
        // log holds the draws made so far: its code is not journaled
        // and runs again on a replay, so a draw it is handed must
        // replay as it was after the module acted on it.
        const run = (): Promise<TResult> =>
          runUnderExecution(
            { ...execution, context: moduleContext, trace: moduleTrace },
            undefined,
            async () => {
              await execution.backend.drawsLanded();
              return fn(args);
            },
          );
        // A secret's run is dark: what the module records inside stays
        // out of the sink, and its wire calls carry the flag.
        const result = secret ? await runUnrecorded(run) : await run();
        records.ended(secret ? undefined : result);
        return result;
      } catch (error) {
        // A secret's failure is marked before the module's own record
        // of it is written.
        const failure = secret ? markSecretFailure(error) : error;
        records.failed(failure);
        throw failure;
      }
    },
  );
  try {
    return await linked;
  } finally {
    letGo?.();
  }
}

/** Makes a typed stub for a dependency handler. Generated code gets
 * these from the compiler; hand-written agents make them directly. */
export function stub<TArgs, TResult>(
  agentId: string,
  handler: string,
  options?: { secret?: boolean; bound?: InterfaceBinding },
): AgentStub<TArgs, TResult> {
  return {
    agentId,
    handler,
    ...(options?.secret === true ? { secret: true } : {}),
    ...(options?.bound === undefined ? {} : { bound: options.bound }),
  };
}

const SECRET_HANDLER = Symbol.for('cernanto.secret-handler');

/**
 * Marks a served function whose arguments or answer are secrets (the
 * contract's `Secret<T>` mark): its call runs unrecorded, the
 * flag forwarded to every call it makes, so the value stays out of
 * every trace.
 */
export function secretHandler<T extends (...args: never[]) => unknown>(fn: T): T {
  Object.defineProperty(fn, SECRET_HANDLER, { value: true, enumerable: false });
  return fn;
}

/** Whether a served function carries the secret mark. */
export function isSecretHandler(fn: unknown): boolean {
  return (
    typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[SECRET_HANDLER] === true
  );
}

/**
 * The implementor the plane binds for an interface, for a bind that
 * names none. An interface the plane itself decides (the machine's, by
 * the system; the store's, by the plane's place) is bound to what is
 * installed, the implementor linked into this process, the one that
 * fits where several are, and nobody is asked: the config agent stands
 * on the store, so a bind of the store never reaches it. A lone
 * implementor installed for another system or another place is refused
 * in words. Any other interface is an operator's choice: its default,
 * the one setting `<id>/default`, read through the config agent's
 * `defaultOf`, the one reader of the plane's settings; else the
 * fallback the caller gave; else a terminal failure that names the key
 * to set.
 */
export async function boundImplementor(
  interfaceId: string,
  fallback?: string,
  linked?: readonly string[],
): Promise<string> {
  const decided = planeBinding(interfaceId, linked);
  if (decided !== undefined) {
    if (decided.misinstalled !== undefined) {
      throw new CernantoError({
        kind: 'terminal',
        message: `${interfaceId} on this plane is ${decided.implementor}, and the one implementor installed here is ${decided.misinstalled}: the release was installed for another machine or another place; install it on this machine again`,
      });
    }
    return decided.implementor;
  }
  const key = `${interfaceId}/default`;
  // The configuration is secret: the read rides marked, so no trace
  // carries the interface or the default it answered.
  const answer = (await call(
    stub<string, { value?: unknown }>('cernanto/config', 'defaultOf', { secret: true }),
    interfaceId,
  )) as { value?: unknown } | undefined;
  const value = answer?.value;
  if (typeof value === 'string' && value !== '') return value;
  // A default that is set but is not an agent id is a fault to say, not
  // an absence to fall back from.
  if (value !== undefined && value !== null) {
    throw new CernantoError({
      kind: 'terminal',
      message: `the default ${key} is not an agent id: ${JSON.stringify(value)}`,
    });
  }
  if (fallback !== undefined) return fallback;
  throw new CernantoError({
    kind: 'terminal',
    message: `no implementor is bound for ${interfaceId}`,
  });
}

/**
 * The generated bind module's accessor calls this with the interface
 * id and contract sha baked at its consumer's compile, plus the
 * implementor agent id the caller named at run time. The call itself
 * is the judge of the implementor (a mismatched one fails at its first
 * call); what is refused here is binding yourself: the static rule
 * against granting yourself cannot see a runtime string, and a
 * decorator implementing and consuming one interface would otherwise
 * recurse forever.
 */
export async function boundInterface(binding: {
  interface: string;
  sha: string;
  agent: string;
}): Promise<void> {
  const execution = currentExecution();
  // Outside any call (module scope, the serving region's edge)
  // the wire call that follows carries its own failure words.
  if (execution === undefined) return;
  if (execution.context.agentId === binding.agent) {
    throw new CernantoError({
      kind: 'terminal',
      message: `${binding.agent} may not bind itself through the ${binding.interface} interface`,
    });
  }
  // A bind names its implementor. An id nothing on the plane ever
  // served is refused here, in words, where a call to it would wait for
  // an agent that may never come (a call waits for a deployed agent's
  // generation); a parked implementor has served once and passes. A
  // replay skips the question: the bind held when the call first ran.
  if (execution.backend.replayMoment() !== undefined) return;
  // A process with no substrate (a proof's, a foreign one) skips the
  // question: the call that follows says so in its own words.
  if (!substrateConfigured()) return;
  if (!(await agentServed(binding.agent))) {
    throw new CernantoError({
      kind: 'terminal',
      message: `no agent "${binding.agent}" is deployed to bind through the ${binding.interface} interface`,
    });
  }
}
