// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { fail } from './output.js';
import { ServerClient, callOfRequest } from './server-client.js';

/** The compile a call id names when its key is a compile's (`k-compile-<id>`),
 * else undefined: a call id spells its handle, the service, the
 * generation and the key, colon separated, and a request's id the same
 * with the request's own part after it, cut off first. */
export function compileIdOf(callId: string): string | undefined {
  const key = callOfRequest(callId).split(':').at(-1) ?? '';
  return key.startsWith('k-compile-') ? key.slice(2) : undefined;
}

// `cernanto cancel <call-id>`: ends a call, a compile's included. A
// cancelled compile's document is ended, and the verify pairs it left are
// removed, by the next read of its progress, so the verb makes that one
// read itself.

/** The words that refuse a call id with nothing in it, else undefined:
 * commander requires the argument, and an empty string still passes. */
export function emptyCallIdWords(callId: string): string | undefined {
  return callId.trim() === '' ? 'a call id is needed: cernanto cancel <call-id>' : undefined;
}

export function registerCancel(program: Command): void {
  program
    .command('cancel')
    .argument('<call-id>')
    .description('end a call: the agent stops at its next step')
    .action(async (callId: string) => {
      try {
        const refused = emptyCallIdWords(callId);
        if (refused !== undefined) throw new Error(refused);
        const client = new ServerClient();
        await client.cancel(callId);
        process.stdout.write(`cancelled ${callId}\n`);
        const compileId = compileIdOf(callId);
        if (compileId !== undefined) {
          await client.compileProgress(compileId, { timeoutMs: 30_000 }).catch(() => undefined);
        }
      } catch (error) {
        fail(error);
      }
    });
}
