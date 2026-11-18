// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { resolveAgentSelector } from './deploy/landing.js';
import { fail } from './output.js';
import { ServerClient } from './server-client.js';

/** What `delete` answers words beyond the one id: a first word `agent`
 * before an id is answered with the command as it reads. */
export function oneAgentWords(given: string[]): string {
  const [first, second] = given;
  return first === 'agent' && second !== undefined
    ? `delete takes the agent's id alone: cernanto delete ${second}`
    : `delete takes one agent id, and ${String(given.length)} words were given: cernanto delete <agent-id>`;
}

// What the operator does to an agent: `delete` removes it from the plane,
// dependents blocking it unless forced. A worker runs again by its
// deploy.

export function registerAgent(program: Command): void {
  program
    .command('delete')
    .argument('<agent-id>', 'the agent to delete')
    .option('--force', 'remove it even while deployed agents depend on it')
    .description('delete an agent from the plane; what depends on it blocks it unless forced')
    .allowExcessArguments()
    .action(async (agentId: string, options: { force?: boolean }, command: Command) => {
      try {
        const given = command.args;
        if (given.length > 1) throw new Error(oneAgentWords(given));
        agentId = resolveAgentSelector(agentId);
        const outcome = await new ServerClient().agentDelete(agentId, options.force === true);
        process.stdout.write(`removed ${outcome.removed}\n`);
        if (outcome.dependents.length > 0) {
          process.stdout.write(
            `deployed agents still depend on it: ${outcome.dependents.join(', ')}\n`,
          );
        }
      } catch (error) {
        fail(error);
      }
    });
}
