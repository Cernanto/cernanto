// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { isIP } from 'node:net';

import type { Command } from 'commander';

import { contextNameOf, saveContext } from './context.js';
import { fail } from './output.js';

// `cernanto login <url> --token <token>`: a plane the user did not
// start, a cluster in practice (`cernanto dev` saves the box's own
// context). The context is named after the plane's host unless `--name`
// says otherwise, so a second login keeps the first.

/** The plane's port when the url names none. */
export const PLANE_PORT = 7434;

/**
 * A plane's url as the operator writes it: a bare host or ip means
 * the plane's usual port; `host:port` keeps its port; an IPv6 address
 * rides in brackets when it carries a port; a scheme written
 * explicitly is honored. A plain address is http: a plane behind TLS
 * is written with its https url.
 */
export function planeUrlOf(address: string): string {
  const trimmed = address.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    if (!URL.canParse(trimmed)) {
      throw new Error(`"${trimmed}" does not read as a url; give the plane's address`);
    }
    return trimmed.replace(/\/$/, '');
  }
  if (trimmed.includes(',')) {
    throw new Error('login takes one url; a plane has one address');
  }
  const bare = isIP(trimmed) === 6 ? `[${trimmed}]` : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(`http://${bare}`);
  } catch {
    throw new Error(
      `"${trimmed}" does not read as a plane's address; give a host, host:port or a url`,
    );
  }
  if (
    parsed.hostname === '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.username !== ''
  ) {
    throw new Error(
      `"${trimmed}" does not read as a plane's address; give a host, host:port or a url`,
    );
  }
  // The port as written: the url parser drops one that is its scheme's
  // own default.
  const port = /:(\d+)$/.exec(bare)?.[1] ?? String(PLANE_PORT);
  return `http://${parsed.hostname}:${port}`;
}

/** How a login looks at a plane before it saves anything: one read of
 * its health on the url its requests will use, under this machine's
 * own trust for an https url. */
export interface LoginProbes {
  answers: (url: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** Why a read did not complete, in the system's own word for it when
 * it gave one (a refused connection, a certificate it does not trust). */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  if (typeof cause?.code === 'string') return cause.code;
  if (typeof cause?.message === 'string') return cause.message;
  return error.message;
}

const PROBES: LoginProbes = {
  answers: async (url) => {
    try {
      await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: reasonOf(error) };
    }
  },
};

/**
 * The plane a login saves: the url as written, once the plane answers
 * on it. An https url is held to this machine's own trust, as every
 * https address is; a plain address is http, and nothing is saved for
 * an address nothing answered on.
 *
 * @param address - The plane's address as the operator wrote it.
 * @param probes - The read of the plane's health; the real one by default.
 * @returns The url to save.
 * @example
 * const { url } = await loginTargetOf('https://plane.acme.com');
 */
export async function loginTargetOf(
  address: string,
  probes: LoginProbes = PROBES,
): Promise<{ url: string }> {
  const url = planeUrlOf(address);
  const target = new URL(url);
  const answer = await probes.answers(url);
  if (answer.ok) return { url };
  if (target.protocol === 'https:') {
    throw new Error(
      `the plane at ${target.host} did not answer over https (${answer.reason}); check the address, that the plane is up, and that its certificate is one this machine trusts`,
    );
  }
  throw new Error(
    `the plane at ${target.host} did not answer (${answer.reason}); check the address and the port, and that the plane is up; a plane behind TLS is written with its https url`,
  );
}

export function registerLogin(program: Command): void {
  program
    .command('login')
    .argument('<url>', "the plane's url (a bare host or ip means its usual port)")
    .requiredOption('--token <token>', 'the operator token, from: cernanto token create')
    .option('--name <name>', "the context's name (the plane's host unless given)")
    .description('a plane you did not start: save it and make it current')
    .action(async (address: string, options: { token: string; name?: string }) => {
      try {
        const { url } = await loginTargetOf(address);
        const name = options.name ?? contextNameOf(url);
        saveContext(name, { server: url, token: options.token });
        process.stdout.write(`context "${name}" -> ${url} (current)\n`);
      } catch (error) {
        fail(error);
      }
    });
}
