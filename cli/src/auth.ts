// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';

import type { Command } from 'commander';

import { CernantoError } from '@cernanto/package-format';

import { askWords, loginCommand } from './asks.js';
import { currentPlane, gatewayClients, unwrap } from './gateway-client.js';
import type { Plane } from './gateway-client.js';
import * as gateway from './gateway/sdk.gen.js';
import type { AgentAccount, AgentAsk } from './gateway/types.gen.js';
import { fail, interactive, outputOf, render } from './output.js';
import { pipeIo, terminalIo } from './terminal.js';

// `cernanto auth list|login|logout`: the agents' accounts. An account
// belongs to the agent whose code asked for it and has a name (the
// one its spec gave it, else the provider's word); the agent is the
// only one that starts a login, and these verbs show what is waiting
// and answer it. `cernanto login` is the operator's own sign-in to the
// plane; this group is the agents' sign-in to their providers.

/** The accounts and the asks, as the plane answers them. */
export async function authListCommand(
  plane: Plane,
  agent?: string,
): Promise<{ accounts: AgentAccount[]; asks: AgentAsk[] }> {
  return unwrap(
    await gateway.authList({
      client: gatewayClients(plane).client,
      ...(agent === undefined ? {} : { query: { agent } }),
    }),
    '/v1/auth/accounts',
  );
}

/** The listing's rows: the waiting asks first, then what is logged in. */
export function authRows(listing: { accounts: AgentAccount[]; asks: AgentAsk[] }): string[][] {
  const need = (ask: AgentAsk): string =>
    ask.kind === 'fields' ? 'credentials' : ask.kind === 'oauth' ? 'authorization' : 'a pairing';
  const waiting = listing.asks.map((ask) => [
    ask.agent,
    ask.name,
    ask.provider,
    `waiting for ${need(ask)} since ${ask.requestedAt}`,
  ]);
  const loggedIn = listing.accounts.map((account) => [
    account.agent,
    account.name,
    account.provider,
    `logged in${account.loggedInAt === undefined ? '' : ` ${account.loggedInAt}`}${account.loggedInBy === undefined ? '' : ` by ${account.loggedInBy}`}`,
  ]);
  return [...waiting, ...loggedIn];
}

/** Forgets an agent's account whole; the next call that needs it asks
 * again. An account that is not logged in has nothing to forget, and
 * the listing shows one that is still asked for in the same table as
 * the ones logged in: the refusal says which of the two it is, and for
 * an account an agent waits for, the login that answers it. */
export async function authLogoutCommand(plane: Plane, agent: string, name: string): Promise<void> {
  try {
    unwrap(
      await gateway.authLogout({
        client: gatewayClients(plane).client,
        query: { agent, name },
      }),
      '/v1/auth/accounts',
    );
  } catch (error) {
    const listing = await authListCommand(plane, agent).catch(() => undefined);
    const held = (row: { agent: string; name: string }): boolean =>
      row.agent === agent && row.name === name;
    if (listing === undefined || listing.accounts.some(held)) throw error;
    const nothing = `${agent} has no account "${name}" logged in, so there is nothing to log out`;
    throw new CernantoError({
      kind: 'terminal',
      message: listing.asks.some(held)
        ? `${nothing}: it is waiting for that login, and nothing is stored for it. Log it in with cernanto auth login ${agent} ${name}`
        : `${nothing}; cernanto auth list ${agent} shows its accounts`,
    });
  }
}

/** A fields ask's answers from a json file (`-` for stdin): an object
 * of the fields by name. */
export function answersFromFile(path: string): Record<string, string> {
  const text = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CernantoError({ kind: 'terminal', message: `${path} is not json` });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CernantoError({
      kind: 'terminal',
      message: `${path} must hold one json object: the fields by name`,
    });
  }
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new CernantoError({ kind: 'terminal', message: `${path}: "${key}" is not a string` });
    }
    answers[key] = value;
  }
  return answers;
}

export function registerAuth(program: Command): void {
  const auth = program
    .command('auth')
    .description("the agents' accounts: who is waiting to log in, log in, log out");
  auth
    .command('list')
    .argument('[agent]', "one agent's accounts and asks")
    .option('-o, --output <format>', 'table or json')
    .option('--no-headers', 'omit the header row')
    .description('the accounts the agents hold and the asks they are waiting on, never a value')
    .action(async (agent: string | undefined, options: { output?: string; headers?: boolean }) => {
      try {
        const listing = await authListCommand(currentPlane(), agent);
        process.stdout.write(
          render(
            listing,
            { headers: ['AGENT', 'NAME', 'PROVIDER', 'STATE'], rows: authRows(listing) },
            outputOf(options),
          ),
        );
      } catch (error) {
        fail(error);
      }
    });
  auth
    .command('login')
    .argument('[agent]', 'the agent whose ask to answer; alone, the one ask waiting')
    .argument('[name]', "the account's name, for one of several the agent is waiting on")
    .option('--all', 'walk every waiting ask, one after another')
    .option(
      '--from <file>',
      "a fields ask's answers as a json object of the fields by name; - for stdin",
    )
    .description(
      "log an agent's account in: answer the ask it is waiting on, in this terminal or from a file",
    )
    .action(
      async (
        agent: string | undefined,
        name: string | undefined,
        options: { all?: boolean; from?: string },
      ) => {
        try {
          const plane = currentPlane();
          const given = options.from === undefined ? undefined : answersFromFile(options.from);
          const handled = await loginCommand(
            plane,
            { ...(agent === undefined ? {} : { agent }), ...(name === undefined ? {} : { name }) },
            interactive() ? terminalIo() : pipeIo(),
            {
              ...(options.all === undefined ? {} : { all: options.all }),
              ...(given === undefined ? {} : { given }),
            },
          );
          if (handled > 0) process.stdout.write(`${String(handled)} logged in\n`);
        } catch (error) {
          fail(error);
        }
      },
    );
  auth
    .command('logout')
    .argument('<agent>', 'the agent that owns the account')
    .argument('<name>', "the account's name")
    .description("forget an agent's account whole; the next call that needs it asks again")
    .action(async (agent: string, name: string) => {
      try {
        await authLogoutCommand(currentPlane(), agent, name);
        process.stdout.write(
          `${askWords({ agent, name })} logged out on the plane (nothing is revoked at the provider)\n`,
        );
      } catch (error) {
        fail(error);
      }
    });
}
