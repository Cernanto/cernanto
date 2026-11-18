// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { currentPlane } from './gateway-client.js';
import { fail, outputOf, render } from './output.js';
import { ServerClient } from './server-client.js';

// `cernanto token create|list|revoke`: named operator tokens, the way
// `npm token` mints them: another laptop or a pipeline logs in with
// one, and it is revoked by name. `create` prints the plain login
// command to paste.

/** The login command a minted token prints: paste it on the other
 * laptop or keep it as the pipeline's secret. */
export function loginCommandFor(input: { url: string; token: string }): string {
  return ['cernanto login', input.url, '--token', input.token].join(' ');
}

/** The tokens table rows, in the operator's words. */
export function tokenRows(
  tokens: { name: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }[],
): string[][] {
  return tokens.map((row) => [
    row.name,
    row.revokedAt === undefined ? 'live' : `revoked ${row.revokedAt}`,
    row.createdAt,
    row.lastUsedAt ?? 'never',
  ]);
}

export function registerToken(program: Command): void {
  const token = program
    .command('token')
    .description('operator tokens: another laptop or a pipeline logs in with one');
  token
    .command('create')
    .argument('<name>', 'the operator, laptop or pipeline this token belongs to')
    .description('mint a token and print the login command to paste (shown once)')
    .action(async (name: string) => {
      try {
        const minted = await new ServerClient().tokenCreate(name);
        process.stdout.write(
          `operator token ${minted.name} created; paste on the other laptop (shown once):\n`,
        );
        process.stdout.write(
          `  ${loginCommandFor({ url: currentPlane().baseUrl, token: minted.token })}\n`,
        );
      } catch (error) {
        fail(error);
      }
    });
  token
    .command('list')
    .option('-o, --output <format>', 'table or json')
    .option('--no-headers', 'omit the header row')
    .description('every operator token: name, state, created, last used (never the token itself)')
    .action(async (options: { output?: string; headers?: boolean }) => {
      try {
        const listed = await new ServerClient().tokenList();
        process.stdout.write(
          render(
            listed.tokens,
            { headers: ['NAME', 'STATE', 'CREATED', 'LAST USED'], rows: tokenRows(listed.tokens) },
            outputOf(options),
          ),
        );
      } catch (error) {
        fail(error);
      }
    });
  token
    .command('revoke')
    .argument('<name>')
    .description('end a token: its next request is refused by name')
    .action(async (name: string) => {
      try {
        const revoked = await new ServerClient().tokenRevoke(name);
        process.stdout.write(`operator token ${revoked.revoked} revoked at ${revoked.revokedAt}\n`);
      } catch (error) {
        fail(error);
      }
    });
}
