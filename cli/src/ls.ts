// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { currentContextName } from './context.js';
import { fail, outputOf, render, timeOfDay } from './output.js';
import type { OutputOptions } from './output.js';
import { resolveAgentSelector } from './deploy/landing.js';
import { ServerClient } from './server-client.js';

// `cernanto ls`: every agent of the fleet, testers, modules and
// interfaces included, one row each, by agent id: its status, its
// resources, the image the plane holds of it and the journal since,
// its call totals with the calls its copies hold now, and its ai
// usage. A focus lists one agent's functions.

/** A journal's size as the operator reads it: whole bytes and
 * kibibytes, one decimal from mebibytes on until the number has two
 * digits (`884B`, `67Ki`, `2.1Mi`, `12Mi`, `1.3Gi`); `-o json` keeps
 * the exact count. */
export function bytesWord(bytes: number): string {
  const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits =
    unit < 2 || value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${digits}${units[unit] ?? ''}`;
}

/** The plane surface ls reads; the gateway client satisfies it. */
export interface LsPlane {
  ls: ServerClient['ls'];
  /** The agents parked on an ask, for the status column; absent in the proofs. */
  waitingAgents?: () => Promise<string[]>;
}

/** Renders one workload snapshot, or the selected agent's row with its
 * functions. A module's STATUS is `linked` (it
 * runs inside the agents that use it) and an interface's `contract`,
 * with the plane's note when an implementor is stale; where a row came
 * from is `contract`'s. A focus lists the agents a module runs inside
 * or an interface's implementors after the focused row. */
export async function getLs(
  client: LsPlane,
  options: OutputOptions,
  focus?: { agentId?: string; context?: string },
): Promise<string> {
  const answer = await client.ls(focus?.agentId);
  // The rows read by agent id, the table and the json alike; on a focus
  // the focused row stays first. The wire carries the fleet's order.
  const byAgentId = (a: { agentId: string }, b: { agentId: string }): number =>
    a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
  const body = {
    ...answer,
    agents:
      focus?.agentId === undefined
        ? [...answer.agents].sort(byAgentId)
        : [...answer.agents.slice(0, 1), ...answer.agents.slice(1).sort(byAgentId)],
  };
  if (options.output === 'json') return `${JSON.stringify(body, null, 2)}\n`;
  const count = (value: number): string => String(value);
  // The calls: the total observed since the totals began.
  const calls = (total: number | undefined): string => (total === undefined ? '-' : count(total));
  // The calls active now, as the copies answered for themselves (an
  // agent's own copies, the copies a module is linked into, an
  // interface's implementors'): their sum; the sum with a `+` when a
  // copy did not answer; `?` when none of the copies asked did; `-` on
  // a row the plane sent no such figure for.
  const active = (
    row: { copiesAsked?: number; copiesAnswered?: number },
    sum: number | undefined,
  ): string => {
    if (sum === undefined) return '-';
    const asked = row.copiesAsked ?? 0;
    const answered = row.copiesAnswered ?? asked;
    if (asked > 0 && answered === 0) return '?';
    return answered < asked ? `${count(sum)}+` : count(sum);
  };
  const ram = (mi: number | undefined): string =>
    mi === undefined ? '-' : `${String(Math.round(mi))}Mi`;
  // SNAPSHOT and JOURNAL in the size word: what a restart loads and
  // what it replays.
  const size = (mi: number | undefined): string =>
    mi === undefined ? '-' : bytesWord(mi * 1048576);
  // An agent parked on an ask says so in its status: the asks come off
  // the plane's listing, best effort.
  const waiting = new Set<string>(
    await Promise.resolve()
      .then(() => client.waitingAgents?.() ?? [])
      .catch((): string[] => []),
  );
  // The statuses read in one case, lower, whatever the plane's words.
  const status = (row: (typeof body.agents)[number]): string => {
    if (waiting.has(row.agentId)) return 'waiting for login';
    if (row.type === 'module') return 'linked';
    if (row.type === 'interface') {
      const stale = /(\d+) stale/.exec(row.status);
      return stale === null ? 'contract' : `contract, ${stale[1] ?? ''} stale`;
    }
    return row.status.charAt(0).toLowerCase() + row.status.slice(1);
  };
  const table = render(
    body.agents,
    {
      headers: [
        'AGENT',
        'TYPE',
        'STATUS',
        'CPU',
        'RAM',
        'SNAPSHOT',
        'JOURNAL',
        'CALLS IN',
        'ACTIVE IN',
        'CALLS OUT',
        'ACTIVE OUT',
        'AI TOKENS',
        'AI COST',
      ],
      rows: body.agents.map((row) => [
        row.agentId,
        row.type,
        status(row),
        row.cpuMillicores === undefined ? '-' : `${String(Math.round(row.cpuMillicores))}m`,
        ram(row.memoryMi),
        size(row.snapshotMi),
        size(row.journalMi),
        calls(row.incomingTotal),
        active(row, row.incomingActive),
        calls(row.outgoingTotal),
        active(row, row.outgoingActive),
        row.inputTokens === undefined || row.outputTokens === undefined
          ? '-'
          : count(row.inputTokens + row.outputTokens),
        row.costUsd === undefined
          ? '-'
          : row.costUsd > 0 && row.costUsd < 0.0001
            ? '<$0.0001'
            : `$${row.costUsd.toFixed(4)}`,
      ]),
    },
    options,
  );
  if (options.noHeaders === true) return table;
  // One line above the table: which plane, how many agents, when.
  const lines = [
    `${focus?.context ?? 'default'} plane   ${String(body.agents.length)} agent${body.agents.length === 1 ? '' : 's'}   ${timeOfDay(body.sampledAt)}`,
    '',
    table.trimEnd(),
  ];
  for (const notice of body.notices) lines.push(notice);
  if (focus?.agentId !== undefined) {
    const row = body.agents[0];
    const others = body.agents.slice(1).map((one) => one.agentId);
    if (row?.type === 'module' && others.length > 0)
      lines.push(`Runs inside: ${others.join(', ')}`);
    if (row?.type === 'interface' && others.length > 0)
      lines.push(`Implemented by: ${others.join(', ')}`);
    if (row?.totalsSince !== undefined)
      lines.push(`Call totals for ${row.agentId} since ${row.totalsSince}.`);
    if (row?.functions !== undefined && row.functions.length > 0)
      lines.push(
        '',
        render(
          row.functions,
          {
            headers: ['FUNCTION'],
            rows: row.functions.map((fn) => [fn.name]),
          },
          {},
        ).trimEnd(),
      );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * `-w`: renders again every interval and prints the rendering when it
 * changed, appending (plain lines, the same on a
 * pipe). Ends when `until` answers true or the process is stopped.
 */
export async function watchRendering(
  renderOnce: () => Promise<string>,
  io: { write: (text: string) => void; intervalMs?: number; until?: () => boolean },
): Promise<void> {
  let last = '';
  for (;;) {
    const text = await renderOnce().catch(
      (error: unknown) => `error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (text !== last) {
      io.write(text);
      last = text;
    }
    if (io.until?.() === true) return;
    await new Promise((resolve) => setTimeout(resolve, io.intervalMs ?? 2000));
  }
}

export function registerLs(program: Command): void {
  program
    .command('ls')
    .argument('[agent-id]', 'an agent, for its functions')
    .option('-o, --output <format>', 'table or json')
    .option('--no-headers', 'omit the header row')
    .option('-w, --watch', 'print again whenever it changes')
    .description(
      'every agent on the plane: status, cpu, ram, snapshot, journal, calls, active calls, ai usage',
    )
    .action(
      async (
        what: string | undefined,
        options: { output?: string; headers?: boolean; watch?: boolean },
      ) => {
        try {
          const client = new ServerClient();
          const renderOnce = (): Promise<string> =>
            getLs(
              client,
              options.output === 'wide'
                ? { ...outputOf(options), output: 'table' }
                : outputOf(options),
              {
                ...(what === undefined ? {} : { agentId: resolveAgentSelector(what) }),
                context: currentContextName() ?? 'default',
              },
            );
          if (options.watch === true) {
            await watchRendering(renderOnce, {
              write: (text) => {
                process.stdout.write(text);
              },
            });
          } else {
            process.stdout.write(await renderOnce());
          }
        } catch (error) {
          fail(error);
        }
      },
    );
}
