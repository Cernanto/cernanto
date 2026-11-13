// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { AsyncLocalStorage } from 'node:async_hooks';

import { freshUUID } from '../kernel/entropy.js';

import { processFacts } from '../kernel/facts.js';
import { callHandle, subjectToken } from '../kernel/connection.js';
import { unwrapReply, wireRequest, wireStart } from '../kernel/transport.js';
import type { AcceptedCall } from '../kernel/transport.js';
import { serviceNameOf } from './naming.js';

// The outbound road for code running outside any call (a standing
// socket loop, an inbound server an agent runs itself, a module-scope
// call at load): a granted call there is one plain wire call whose
// callee journals itself. Agents own their sockets with plain Node.

/** The linked module whose code runs at the moment outside any
 * call (a linked call made where no execution stands: a loop the
 * agent keeps, a module's own road), so its wire calls name the module
 * and never its host. */
const linkedOutsideInvocations = new AsyncLocalStorage<string>();

/** Runs a linked module's function outside any call under the
 * module's own identity: every wire call made inside names the module
 * as its caller, with the process's agent beside it, as a call made
 * inside a call does. A link inside a link names the inner
 * module. */
export function runAsLinkedModule<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  return linkedOutsideInvocations.run(agentId, fn);
}

/** The calling agent's identity for caller headers on wire calls
 * made outside any call: the linked module whose code runs at
 * the moment, else the process's own one agent, from the facts it was
 * handed. */
export function servingIdentity(): string {
  const linked = linkedOutsideInvocations.getStore();
  if (linked !== undefined) return linked;
  const agentId = processFacts().agentId;
  return agentId === undefined || agentId === '' ? 'unknown' : agentId;
}

/** The identity of a plain wire call: the serving identity, and the
 * process's own agent beside a linked module's. */
function plainIdentity(callId: string): { agentId: string; callId: string; hostAgentId?: string } {
  const agentId = servingIdentity();
  const own = processFacts().agentId;
  return {
    agentId,
    callId: `plain-${callId}`,
    ...(own === undefined || own === '' || own === agentId ? {} : { hostAgentId: own }),
  };
}

/** One plain wire call from outside any call with no calling
 * agent: the machine's own ask (the materialize step reading a package
 * from the store before any agent runs), which the callee sees as the
 * operator's. The callee journals itself; a transient failure (the
 * target not served yet) is thrown for the caller to try again. */
export async function machineCall(
  agentId: string,
  handler: string,
  args: unknown,
): Promise<unknown> {
  const callId = `c-${freshUUID()}`;
  const reply = await wireRequest({ agentId, handler, args, callId });
  return unwrapReply(reply);
}

/** One plain wire call from outside any call to the copy of an
 * agent on one host (the block's ring of the host job's `serve`, its stop
 * of the host): the callee journals itself; a copy there that does not
 * take the call is thrown for the caller as the target unavailable. */
export async function hostCall(
  agentId: string,
  handler: string,
  args: unknown,
  host: string,
): Promise<unknown> {
  const callId = `c-${freshUUID()}`;
  const reply = await wireRequest({ agentId, handler, args, callId, host });
  return unwrapReply(reply);
}

/** One plain wire call from outside any call: the callee journals
 * itself. */
export async function regionWireCall(
  agentId: string,
  handler: string,
  args: unknown,
  options?: {
    /** The calling execution's identity, when the call is made from
     * inside one: the callee's records parent to the caller's call,
     * as a journaled call's would. */
    identity?:
      | {
          agentId: string;
          callId: string;
          observation?: boolean;
          hostAgentId?: string;
          hostCallId?: string;
        }
      | undefined;
    /** The interface the call is bound through, which the callee checks
     * it implements. */
    bound?: { interface: string; sha: string } | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<unknown> {
  const callId = `c-${freshUUID()}`;
  const identity = options?.identity ?? plainIdentity(callId);
  const reply = await wireRequest({
    agentId,
    handler,
    args,
    callId,
    identity: options?.bound === undefined ? identity : { ...identity, bound: options.bound },
    signal: options?.signal,
  });
  return unwrapReply(reply);
}

/** One call from outside any call for a caller that asks for the
 * call itself: its id, and its result when the caller waited. A caller
 * that does not wait is answered once the callee has accepted the call,
 * durably, with an id that names no version yet, and nobody is sent the
 * call's answer. An idempotency key names the call. */
export async function regionInvoke(
  agentId: string,
  handler: string,
  args: unknown,
  options: {
    idempotencyKey?: string | undefined;
    wait: boolean;
    /** The calling execution's identity, as for `regionWireCall`. */
    identity?: { agentId: string; callId: string } | undefined;
    /** The host the call goes to: the agent's copy on that host takes it. */
    host?: string | undefined;
    /** The paths of the arguments that are credentials: the callee's
     * records name them without their values. */
    credentials?: string[] | undefined;
    /** Told the moment the call is accepted. */
    accepted?: ((call: AcceptedCall) => void) | undefined;
  },
): Promise<{ callId: string; requestId?: string; result?: unknown }> {
  const service = serviceNameOf(agentId);
  const callId =
    options.idempotencyKey === undefined
      ? `c-${freshUUID()}`
      : `k-${subjectToken(options.idempotencyKey)}`;
  const identity = {
    ...(options.identity ?? plainIdentity(callId)),
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
  };
  const addressed = options.host === undefined ? {} : { host: options.host };
  if (!options.wait) {
    await wireStart({ agentId, handler, args, callId, identity, ...addressed });
    return { callId: callHandle(service, callId) };
  }
  const reply = await wireRequest({
    agentId,
    handler,
    args,
    callId,
    identity,
    ...addressed,
    ...(options.accepted === undefined ? {} : { accepted: options.accepted }),
  });
  const result = unwrapReply(reply);
  return {
    callId: callHandle(service, callId, reply.generation),
    ...(reply.story === undefined ? {} : { requestId: reply.story }),
    result,
  };
}
