// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { z } from 'zod';

// One call envelope: the request as the wire carries it, decoded
// and validated at the boundary. The message that carries it names the
// request (its id), the call and the inbox its caller waits in; the
// body names the logical destination the caller chose before its first
// send and keeps through every resend.

/** The caller of a call: the agent and the call the calling
 * code ran in and, when that code is a linked module, the host whose
 * journal it wrote. A call from outside any call names its
 * sender's mark in place of a call id (`plain-`). */
const callerSchema = z.object({
  agentId: z.string().min(1),
  callId: z.string().min(1),
  hostAgentId: z.string().min(1).optional(),
  hostCallId: z.string().min(1).optional(),
  /** The agent a verification form stands for, stated by the two forms
   * alone: a callee keeping a place per agent reads the target's for a
   * caller whose id is the target (the test form) and `<target>/tests`
   * for any other (the tester). */
  target: z.string().min(1).optional(),
  /** The story the call is a child of in the traces: the calling call's,
   * or its host's when the caller is a linked module. */
  story: z.string().min(1).optional(),
  /** The agent a model request made under the call is charged to, and
   * its life. */
  charge: z.object({ agentId: z.string().min(1), life: z.string().min(1) }).optional(),
});

/** The logical destination of a request: one copy of the callee, and
 * the life it runs under, when the caller read one: a copy takes a
 * request for its own life alone. */
const destinationSchema = z.object({
  service: z.string().min(1),
  generation: z.string().min(1),
  copy: z.number().int().nonnegative(),
  life: z.string().min(1).optional(),
});

const callEnvelopeSchema = z.object({
  v: z.literal(1),
  /** The request's own id: the call and sixteen hex digits, minted
   * once by the caller. */
  request: z.string().min(1),
  callId: z.string().min(1),
  handler: z.string().min(1),
  /** The handler's one argument; absent when the caller passed nothing
   * (JSON carries no undefined). */
  args: z.unknown().optional(),
  /** The copy the request is for: the one chosen before the first send. */
  to: destinationSchema,
  caller: callerSchema.optional(),
  /** An observation: the callee keeps it out of its records and
   * forwards the flag. */
  observation: z.literal(true).optional(),
  /** The paths, in the arguments, of the values that are credentials
   * (`header.authorization`): the callee's records name the path and
   * never the value. */
  credentials: z.array(z.string().min(1)).optional(),
  /** The interface the caller binds the callee through, by its id and
   * its contract's hash: the callee answers only when it implements it
   * there. */
  bound: z.object({ interface: z.string().min(1), sha: z.string() }).optional(),
  /** Where the caller waits for the response; absent for a call nobody
   * waits for. */
  replyTo: z.string().min(1).optional(),
});

export type CallEnvelope = z.infer<typeof callEnvelopeSchema>;

/** The envelope a value carries, or nothing when it is not one. */
export function callEnvelopeOf(value: unknown): CallEnvelope | undefined {
  const parsed = callEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Whether a caller's call id names a journal: a call made from outside
 * any call names none (its sender's mark stands in place of a
 * call). */
function journaledCaller(toCallId: string): boolean {
  return toCallId !== '_' && !toCallId.startsWith('plain-');
}

/** The calling agent, when one spoke. */
export function callerAgentOf(envelope: { caller?: CallEnvelope['caller'] }): string | undefined {
  return envelope.caller?.agentId;
}

/** The calling call's id, when the caller has a journal: a call
 * from outside any call is the child of no call. */
export function parentCallOf(envelope: { caller?: CallEnvelope['caller'] }): string | undefined {
  const callId = envelope.caller?.callId;
  return callId !== undefined && journaledCaller(callId) ? callId : undefined;
}

/** The request alone, of a value that carries it with more beside it. */
export function requestOf(carried: CallEnvelope): CallEnvelope {
  return {
    v: 1,
    request: carried.request,
    callId: carried.callId,
    handler: carried.handler,
    args: carried.args,
    to: carried.to,
    ...(carried.caller === undefined ? {} : { caller: carried.caller }),
    ...(carried.observation === undefined ? {} : { observation: carried.observation }),
    ...(carried.credentials === undefined ? {} : { credentials: carried.credentials }),
    ...(carried.bound === undefined ? {} : { bound: carried.bound }),
    ...(carried.replyTo === undefined ? {} : { replyTo: carried.replyTo }),
  };
}

/** The call a called one is a child of in the trace tree: the caller's
 * host call when the caller is a linked module, else the caller's own. */
export function callParentOf(envelope: { caller?: CallEnvelope['caller'] }): string | undefined {
  const caller = envelope.caller;
  if (caller === undefined) return undefined;
  const callId = caller.hostCallId ?? caller.callId;
  return journaledCaller(callId) ? callId : undefined;
}
