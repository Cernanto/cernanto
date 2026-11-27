// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { resolveAgentSelector } from './deploy/landing.js';
import { fail } from './output.js';
import { ServerClient } from './server-client.js';

// `cernanto restart <agent>`: a service's, a worker's or a job's
// program runs again from the top, as a new version of the same code,
// with an empty memory; what the old process held, a socket or a lock,
// goes with it. Nothing else of an agent is started or stopped by
// hand: a deploy runs it, a module by itself starts at its first call,
// and a delete removes it. The plane judges every start, and its
// refusal is printed as it is.

/** The line a restart prints: the agent and the run it asked for.
 * @param agentId - The agent the restart named.
 * @param started - What the plane answered.
 * @returns The line, ended.
 * @example restartedWords('ops/ticker', { run: 3 });
 */
export function restartedWords(agentId: string, started: { run?: number | undefined }): string {
  return `${agentId} runs again${started.run === undefined ? '' : ` (run ${String(started.run)})`}\n`;
}

export function registerRestart(program: Command): void {
  program
    .command('restart')
    .argument('<agent-id>', 'the service, the worker or the job to run again')
    .description(
      "run a service's, a worker's or a job's program again from the top, with an empty memory",
    )
    .action(async (agentId: string) => {
      try {
        agentId = resolveAgentSelector(agentId);
        const started = await new ServerClient().agentStart(agentId);
        process.stdout.write(restartedWords(agentId, started));
      } catch (error) {
        fail(error);
      }
    });
}
