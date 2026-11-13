// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The copy's workload, as it answers for itself on its call server's
// `/workload` road: the calls it holds now, counted from memory at the
// moment of the ask, each under the agent whose code holds it, as the
// totals count a call: the copy's own agent, and each module linked
// into it.
//
// A call in of the copy's agent is a request taken in a log this
// process holds, its own or a dead sibling's it took over, and not
// answered there, and a request waiting in a service's mailbox for its
// program to take it. A call in of a module is a linked call into it in
// flight. A call out is a request sent from a body of those logs that
// somebody waits for and that is not answered, a call a body without a
// journal (a job's) waits on, and a linked call in flight, each the
// call of the agent whose code made it, the copy's own or a linked
// module's.
//
// Left out, as the totals leave them: the machine's own observation
// calls, a run the plane itself started for the life of its process (a
// worker's, the host job's `serve`), a pointer to the sibling that took a
// request, and a call nobody waits for.

import { heldCalls } from './active-calls.js';
import { unackedRequests } from './log.js';
import type { LogState, RequestAck } from './log.js';
import { HOST_AGENT } from './transport.js';
import type { ServedUnit } from './units.js';

/** The calls an agent holds now. */
interface ActiveCalls {
  /** The calls made of it that it has not answered. */
  incomingActive: number;
  /** The calls it made and still waits on. */
  outgoingActive: number;
}

/** What a copy answers of itself, grouped by subject, so a later group
 * breaks no reader of today's. */
export interface Workload {
  /** The calls of the copy's own agent. */
  calls: ActiveCalls;
  /** The calls of each module linked into the copy that holds one now,
   * by the module's id; a module it does not name holds none here. */
  modules: Record<string, ActiveCalls>;
}

/** The function the block rings on the host job for the life of the
 * host. */
const HOST_RUN = 'serve';

/** Whether a request is a run the plane itself started, which lasts as
 * long as its process and is no call anybody made of the agent: a
 * worker's own run (its id ends in `:run`, where a caller's request
 * ends in its own sixteen hex digits), and on the host job its
 * `serve`. */
function isOwnRun(ack: RequestAck, hostJob: boolean): boolean {
  return ack.request.endsWith(':run') || (hostJob && ack.handler === HOST_RUN);
}

/** The calls in a log holds: every request acked there and not
 * answered. A pointer names the sibling whose log holds the request,
 * and is none of this log's. `hostJob` says the log is the host
 * job's. */
export function incomingActiveOf(state: LogState, hostJob = false): number {
  let active = 0;
  for (const taken of state.taken.values()) {
    const ack = taken.ack;
    if (ack === undefined || ack.takenBy !== undefined || taken.response !== undefined) continue;
    if (ack.observation === true || isOwnRun(ack, hostJob)) continue;
    active += 1;
  }
  return active;
}

/** The calls out a log holds, by the agent whose code made each (`own`
 * for a request that names no caller): every request sent from a body
 * still running that somebody waits for and that is not answered, the
 * newest of its command. */
export function outgoingActiveOf(state: LogState, own: string): Map<string, number> {
  const active = new Map<string, number>();
  for (const sent of unackedRequests(state)) {
    if (sent.replyTo === undefined || sent.observation === true) continue;
    const agentId = sent.caller?.agentId ?? own;
    active.set(agentId, (active.get(agentId) ?? 0) + 1);
  }
  return active;
}

/** The workload of a served agent's process, now. */
export function workloadOf(unit: ServedUnit): Workload {
  const own = unit.agentId;
  const hostJob = own === HOST_AGENT;
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const add = (counts: Map<string, number>, agentId: string, more: number): void => {
    if (more !== 0) counts.set(agentId, (counts.get(agentId) ?? 0) + more);
  };
  add(incoming, own, unit.program?.queuedCalls() ?? 0);
  for (const journal of unit.openJournals()) {
    add(incoming, own, incomingActiveOf(journal.state, hostJob));
    for (const [agentId, count] of outgoingActiveOf(journal.state, own))
      add(outgoing, agentId, count);
  }
  const held = heldCalls();
  for (const [agentId, count] of held.incoming) add(incoming, agentId, count);
  for (const [agentId, count] of held.outgoing) add(outgoing, agentId, count);
  const callsOf = (agentId: string): ActiveCalls => ({
    incomingActive: incoming.get(agentId) ?? 0,
    outgoingActive: outgoing.get(agentId) ?? 0,
  });
  const modules: Record<string, ActiveCalls> = {};
  for (const agentId of new Set([...incoming.keys(), ...outgoing.keys()]))
    if (agentId !== own) modules[agentId] = callsOf(agentId);
  return { calls: callsOf(own), modules };
}
