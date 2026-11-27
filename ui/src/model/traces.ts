// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { AgentTracesResult, LsRow, Traces } from '../gateway/types.gen.js';

// What an agent's traces stand at, as the screens say it: the cli's
// `cernanto traces <agent>` and its three words. `on` stores each call
// with its details and the console's lines, `debug` the same with the
// agent's debug lines, `off` nothing. A change starts the agent again
// as a new version, and a module's change starts the agents that link
// it; the plane says which, and the screen repeats it.

/** The three words, as the cli spells them. */
export const TRACES_WORDS: Record<Traces, string> = { on: 'On', debug: 'Debug', off: 'Off' };

/** What each word stores, said under the pointer. */
export const TRACES_MEANS: Record<Traces, string> = {
  on: "Each call is stored with its details and the console's lines.",
  debug: "Each call is stored with its details, the console's lines and the agent's debug lines.",
  off: 'Nothing of its calls is stored. Its call totals and its active calls are still counted.',
};

/** The choices an agent of a kind has: a module's traces are on or off,
 * and its debug lines are kept where an agent that links it is set to
 * debug. */
export function tracesChoices(type: LsRow['type']): Traces[] {
  return type === 'module' ? ['on', 'off'] : ['on', 'debug', 'off'];
}

/** What the plane answered a write, as the screen says it: one line,
 * and the agents it names, a line each. */
export interface TracesSaid {
  words: string;
  /** The agents that link a module and start again for it. */
  agents: string[];
}

/** What a write of an agent's traces did, in the words the cli prints
 * it in: the agent starts again as a new version, a service's memory
 * starting over and a worker's program running again; a module's write
 * names the agents that link it. */
export function tracesSaid(agentId: string, set: AgentTracesResult): TracesSaid {
  if (!set.changed) return { words: `Its traces are ${set.traces} already.`, agents: [] };
  const own = set.starts.find((one) => one.agentId === agentId);
  if (own !== undefined) {
    const more =
      own.type === 'service'
        ? ' Its memory starts over.'
        : own.type === 'worker'
          ? ' Its program runs again.'
          : '';
    return { words: `It starts again as a new version.${more}`, agents: [] };
  }
  const agents = set.starts.map((one) => one.agentId);
  // What starts again for the write, which says nothing of the versions
  // that serve now.
  if (agents.length === 0) return { words: 'No agent starts again for it.', agents };
  return {
    words:
      agents.length === 1
        ? 'The agent that links it starts again as a new version:'
        : `The ${String(agents.length)} agents that link it start again as new versions, a few at a time:`,
    agents,
  };
}
