// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { CernantoError } from '@cernanto/package-format';
import type { Command } from 'commander';

import { resolveAgentSelector } from './deploy/landing.js';
import { fail, outputOf, render } from './output.js';
import type { OutputOptions } from './output.js';
import { ServerClient } from './server-client.js';

// `cernanto traces`: what each agent's traces stand at, and the write
// that sets one. `on` stores each call with its details and the
// console's lines, `debug` the same with the agent's debug lines, `off`
// nothing; the call totals and the active calls of `cernanto ls` are
// counted under every value. A change starts the agent again as a new
// version, since a process reads its debug section when it starts, and
// a module's change starts the agents that link it. The plane judges
// every write, and its refusal is printed as it is.

/** What an agent's traces stand at. */
export type Traces = 'on' | 'debug' | 'off';

const VALUES: readonly Traces[] = ['on', 'debug', 'off'];

/** One agent of the plane's listing, as this verb reads it. */
export interface TracesRow {
  agentId: string;
  type: string;
  /** What the agent's traces stand at; an interface has none. */
  traces?: Traces | undefined;
}

/** What the plane answers a write. */
export interface TracesSet {
  agentId: string;
  traces: Traces;
  /** Whether what the agent stands at moved. */
  changed: boolean;
  /** The agents that start again for it. */
  starts: { agentId: string; type: string }[];
}

/** What the verb asks of the plane. */
export interface TracesClient {
  ls(agent?: string): Promise<{ agents: TracesRow[] }>;
  agentTraces(agentId: string, traces: Traces): Promise<TracesSet>;
}

/** The word a person typed, as one of the three values; refused in the
 * plane's own words otherwise.
 * @param word - The word after the agent.
 * @returns The value.
 * @example tracesValue('debug');
 */
export function tracesValue(word: string): Traces {
  const value = VALUES.find((one) => one === word);
  if (value === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: `traces are set to on, debug or off, not "${word}"`,
    });
  }
  return value;
}

/** Every agent and what its traces stand at.
 * @param client - The plane's listing.
 * @param options - Table or json.
 * @returns The table, or the rows as json.
 * @example await tracesList(client, {});
 */
export async function tracesList(client: TracesClient, options: OutputOptions): Promise<string> {
  const { agents } = await client.ls();
  // The rows read by agent id, as `cernanto ls` reads them: the wire
  // carries the plane's own order.
  const rows = agents
    .map(({ agentId, type, traces }) => ({
      agentId,
      type,
      ...(traces === undefined ? {} : { traces }),
    }))
    .sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
  return render(
    rows,
    {
      headers: ['AGENT', 'TYPE', 'TRACES'],
      rows: rows.map((row) => [row.agentId, row.type, row.traces ?? '-']),
    },
    options,
  );
}

/** One agent of the listing; a plain error when the listing does not
 * carry it. */
async function rowOf(client: TracesClient, agentId: string): Promise<TracesRow> {
  const { agents } = await client.ls(agentId);
  const row = agents.find((one) => one.agentId === agentId);
  if (row === undefined) {
    throw new CernantoError({ kind: 'terminal', message: `no agent "${agentId}"` });
  }
  return row;
}

/** What one agent's traces stand at.
 * @param client - The plane's listing.
 * @param agentId - The agent.
 * @param options - A line or json.
 * @returns The line, ended, or the row as json.
 * @example await tracesOfAgent(client, 'examples/basics/counter', {});
 */
export async function tracesOfAgent(
  client: TracesClient,
  agentId: string,
  options: OutputOptions,
): Promise<string> {
  const row = await rowOf(client, agentId);
  if (options.output === 'json') {
    return `${JSON.stringify(
      { agentId, type: row.type, ...(row.traces === undefined ? {} : { traces: row.traces }) },
      null,
      2,
    )}\n`;
  }
  // A plane older than the setting names none for any agent: a missing
  // value on an agent that runs is never read as a setting.
  if (row.traces === undefined) {
    return row.type === 'interface'
      ? `${agentId} is an interface: it runs no code and keeps no traces\n`
      : `${agentId}: this plane does not say what its traces stand at\n`;
  }
  return `${agentId}: traces ${row.traces}\n`;
}

/** The lines a write prints: what stands now and what starts again for
 * it, in the words of the kind that starts.
 * @param agentId - The agent the write named.
 * @param set - What the plane answered.
 * @returns The lines, ended.
 * @example setWords('ops/web', { agentId: 'ops/web', traces: 'debug', changed: true, starts: [{ agentId: 'ops/web', type: 'service' }] });
 */
export function setWords(agentId: string, set: TracesSet): string {
  if (!set.changed) return `${agentId}: traces are ${set.traces} already\n`;
  const head = `${agentId}: traces ${set.traces}.`;
  const own = set.starts.find((one) => one.agentId === agentId);
  if (own !== undefined) {
    const more =
      own.type === 'service'
        ? ' Its memory starts over.'
        : own.type === 'worker'
          ? ' Its program runs again.'
          : '';
    return `${head} It starts again as a new version.${more}\n`;
  }
  // The answer names what starts again for the write, which says
  // nothing of the versions that serve now: no word is said of them.
  if (set.starts.length === 0) return `${head} No agent starts again for it.\n`;
  if (set.starts.length === 1) {
    return `${head} The agent that links it starts again as a new version: ${set.starts[0]?.agentId ?? ''}\n`;
  }
  return [
    `${head} The ${String(set.starts.length)} agents that link it start again as new versions, a few at a time:`,
    ...set.starts.map((one) => `  ${one.agentId}`),
    '',
  ].join('\n');
}

/** What a read of an agent whose traces are off is told: why it brings
 * nothing, and the command that turns them on.
 * @param agentId - The agent.
 * @returns The sentence, not ended.
 * @example offWords('examples/basics/counter');
 */
export function offWords(agentId: string): string {
  return `the traces of ${agentId} are off, so nothing of its calls is stored; turn them on with: cernanto traces ${agentId} on`;
}

/** What a read of an agent whose traces are off is told when it still
 * brought calls: they were stored before, and the calls since are not.
 * @param agentId - The agent.
 * @returns The sentence, not ended.
 * @example offSinceWords('examples/basics/counter');
 */
export function offSinceWords(agentId: string): string {
  return `the traces of ${agentId} are off: what is shown was stored before, and nothing of its calls since is; turn them on with: cernanto traces ${agentId} on`;
}

/** Whether an agent's traces stand at off; no when the plane does not
 * list the agent or cannot say.
 * @param client - The plane's listing.
 * @param agentId - The agent.
 * @returns Whether they are off.
 * @example await tracesOff(client, 'examples/basics/counter');
 */
export async function tracesOff(
  client: Pick<TracesClient, 'ls'>,
  agentId: string,
): Promise<boolean> {
  try {
    const { agents } = await client.ls(agentId);
    return agents.find((one) => one.agentId === agentId)?.traces === 'off';
  } catch {
    return false;
  }
}

/** The line that says an agent's traces are off, with the command that
 * turns them on; nothing when they are not off, or when the plane
 * cannot say.
 * @param client - The plane's listing.
 * @param agentId - The agent whose read brought nothing.
 * @returns The line, ended, or nothing.
 * @example await offLine(client, 'examples/basics/counter');
 */
export async function offLine(
  client: Pick<TracesClient, 'ls'>,
  agentId: string,
): Promise<string | undefined> {
  return (await tracesOff(client, agentId)) ? `${offWords(agentId)}\n` : undefined;
}

/** The verb whole: what the words ask for, asked of the plane.
 * @param client - The plane.
 * @param agent - The agent named, when one was.
 * @param value - The word after it, when one was.
 * @param options - Table or json.
 * @returns What the verb prints.
 * @example await traces(client, 'ops/web', 'debug', {});
 */
export async function traces(
  client: TracesClient,
  agent: string | undefined,
  value: string | undefined,
  options: OutputOptions,
): Promise<string> {
  if (agent === undefined) return tracesList(client, options);
  if (value === undefined) return tracesOfAgent(client, agent, options);
  const set = await client.agentTraces(agent, tracesValue(value));
  return options.output === 'json' ? `${JSON.stringify(set, null, 2)}\n` : setWords(agent, set);
}

export function registerTraces(program: Command): void {
  program
    .command('traces')
    .argument('[agent-id]', "an agent: what its traces stand at; none: every agent's")
    .argument('[setting]', 'on, debug or off: sets it, and the agent starts again as a new version')
    .option('-o, --output <format>', 'table or json')
    .option('--no-headers', 'omit the header row')
    .description(
      "what an agent's traces stand at, and the write that sets it: on stores its calls, debug adds its debug lines, off stores nothing",
    )
    .action(
      async (
        agentId: string | undefined,
        setting: string | undefined,
        options: { output?: string; headers?: boolean },
      ) => {
        try {
          process.stdout.write(
            await traces(
              new ServerClient(),
              agentId === undefined ? undefined : resolveAgentSelector(agentId),
              setting,
              outputOf(options),
            ),
          );
        } catch (error) {
          fail(error);
        }
      },
    );
}
