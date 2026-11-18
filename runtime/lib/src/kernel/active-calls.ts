// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The calls a process holds in memory alone, by the agent whose code
// holds them: a linked call in flight, which is a call in of the module
// that runs and a call out of the code that called it, and a call a
// body without a journal (a job's) waits on. No log holds either to be
// counted from; the calls a log holds are counted from its state
// (workload.ts). A call counts under the agent whose code made it, as
// the totals count it.

const incoming = new Map<string, number>();
const outgoing = new Map<string, number>();

/** Counts one more for an agent; answers what takes it off again, once. */
function hold(counts: Map<string, number>, agentId: string): () => void {
  counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (counts.get(agentId) ?? 1) - 1;
    if (left > 0) counts.set(agentId, left);
    else counts.delete(agentId);
  };
}

/** Holds one call a body without a journal waits on, as a call out of
 * the agent whose code made it; answers what lets it go. */
export function holdCallOut(agentId: string): () => void {
  return hold(outgoing, agentId);
}

/** Holds one linked call in flight: a call in of the module that runs,
 * a call out of the agent whose code called it; answers what lets it
 * go. */
export function holdLinkedCall(moduleId: string, callerId: string): () => void {
  const into = hold(incoming, moduleId);
  const outOf = hold(outgoing, callerId);
  return () => {
    into();
    outOf();
  };
}

/** The calls held in memory now, by agent. */
export function heldCalls(): {
  incoming: ReadonlyMap<string, number>;
  outgoing: ReadonlyMap<string, number>;
} {
  return { incoming, outgoing };
}
