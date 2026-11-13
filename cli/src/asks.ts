// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { CernantoError } from '@cernanto/package-format';

import { accepted, gatewayClients, unwrap } from './gateway-client.js';
import type { Plane } from './gateway-client.js';
import * as gateway from './gateway/sdk.gen.js';
import type { AgentAsk } from './gateway/types.gen.js';
import type { ConnectIo } from './terminal.js';

// The asks agents are parked on, and the one way they are answered: in
// whatever terminal is attached to the run (`deploy`, `invoke`, `trace
// -f`), or by `auth login` when none is. An ask is an agent's own,
// keyed by the agent and the account's name; the words the cli takes
// and prints are `<agent> <name>`. The agent authored the ask (the
// fields, the instructions, the url to open), so the screen is the same
// for every provider.

/** The account an ask names, as the operator types it after
 * `auth login`: the agent, a space, the name. */
export function askWords(ask: { agent: string; name: string }): string {
  return `${ask.agent} ${ask.name}`;
}

/** The agent and the name out of the words, when a caller hands the
 * words back (the deploy's log names an ask by them). */
export function accountOfWords(words: string): { agent: string; name?: string } {
  const [agent = '', name] = words.trim().split(/\s+/);
  return name === undefined || name === '' ? { agent } : { agent, name };
}

/** The asks agents are parked on, oldest first; an agent keeps its
 * own alone. */
export async function pendingAsks(plane: Plane, agent?: string): Promise<AgentAsk[]> {
  return unwrap(
    await gateway.authList({
      client: gatewayClients(plane).client,
      ...(agent === undefined ? {} : { query: { agent } }),
    }),
    '/v1/auth/accounts',
  ).asks;
}

/** Whether an ask left the pending list: answered, or gone. */
export async function askIsDone(plane: Plane, ask: AgentAsk): Promise<boolean> {
  const result = await gateway.authList({
    client: gatewayClients(plane).client,
    query: { agent: ask.agent },
  });
  if (!accepted(result) || result.data === undefined) return false;
  return !result.data.asks.some((candidate) => candidate.id === ask.id);
}

/** Answers a fields ask: the filled fields become the agent's account
 * and every call parked on it resumes. */
export async function answerAsk(
  plane: Plane,
  ask: AgentAsk,
  fields: Record<string, string>,
): Promise<void> {
  unwrap(
    await gateway.authLogin({
      client: gatewayClients(plane).client,
      path: { id: ask.id },
      body: { fields },
    }),
    `/v1/auth/asks/${ask.id}`,
  );
}

/** A pairing payload prefixed `qr:` prints as its text under a note to
 * render it with a qr tool; any other content prints as it is. */
export function renderDisplayContent(content: string): string {
  if (content.startsWith('qr:')) {
    return `qr payload (render with any qr tool):\n${content.slice('qr:'.length)}`;
  }
  return content;
}

/** The words that open every ask's screen. */
function askHeader(ask: AgentAsk): string {
  return `${ask.agent} needs its account "${ask.name}" (${ask.provider})`;
}

async function answerFieldsAsk(
  plane: Plane,
  io: ConnectIo,
  ask: AgentAsk,
  given: Record<string, string> | undefined,
): Promise<void> {
  io.write(`${askHeader(ask)}\n`);
  if (ask.refused !== undefined && ask.refused !== '') {
    io.write(`the provider refused the last one: ${ask.refused}\n`);
  }
  // The page first, then the steps: the steps say "the page above".
  if (ask.helpUrl !== undefined) {
    io.write(`help: ${ask.helpUrl}\n`);
  }
  if (ask.instructions !== undefined && ask.instructions !== '') {
    io.write(`${ask.instructions}\n`);
  }
  const filled: Record<string, string> = {};
  for (const field of ask.fields ?? []) {
    const value = given?.[field.name];
    if (value !== undefined) {
      filled[field.name] = value;
      continue;
    }
    if (given !== undefined) {
      throw new CernantoError({
        kind: 'terminal',
        message: `the file answers no "${field.name}" for ${askWords(ask)}; its fields are: ${(ask.fields ?? []).map((row) => row.name).join(', ')}`,
      });
    }
    filled[field.name] = await askField(io, field.label, field.secret === true);
  }
  await answerAsk(plane, ask, filled);
  io.write(`sent; ${ask.agent} is resuming\n`);
}

/** One field's answer. An empty one is asked for once more: Enter
 * pressed over an empty prompt would store an account that reads as
 * logged in and works for nothing, with no ask left to answer. The
 * second empty answer stands, for the field a provider takes empty. */
async function askField(io: ConnectIo, label: string, secret: boolean): Promise<string> {
  const answer = await io.ask(label, secret);
  if (answer !== '') return answer;
  io.write(`${label} is empty: type it, or press Enter again to leave it empty\n`);
  return io.ask(label, secret);
}

async function waitForAgentSide(
  plane: Plane,
  io: ConnectIo,
  ask: AgentAsk,
  waitingLine: string,
): Promise<void> {
  io.write(waitingLine);
  for (;;) {
    if (await askIsDone(plane, ask)) {
      io.write(' done\n');
      return;
    }
    await io.sleep(1000);
  }
}

/** One ask answered on its own screen, by its kind: the fields the
 * agent authored, an authorization the browser completes, a pairing
 * the operator reads. */
export async function answerOnScreen(
  plane: Plane,
  io: ConnectIo,
  ask: AgentAsk,
  given?: Record<string, string>,
): Promise<void> {
  if (ask.kind === 'fields') {
    await answerFieldsAsk(plane, io, ask, given);
    return;
  }
  if (ask.kind === 'oauth') {
    if (ask.authorizationUrl !== undefined) io.open?.(ask.authorizationUrl);
    io.write(
      `${askHeader(ask)}: your browser opens the sign-in page (if it did not, open this url yourself)\n\n  ${ask.authorizationUrl ?? ''}\n\n`,
    );
    await waitForAgentSide(plane, io, ask, 'approve access in the browser. waiting...');
    return;
  }
  io.write(`${askHeader(ask)}\n`);
  if (ask.instructions !== undefined) io.write(`${ask.instructions}\n`);
  io.write(`${renderDisplayContent(ask.message ?? '')}\n`);
  await waitForAgentSide(plane, io, ask, 'waiting for the pairing...');
}

/** What `auth login` names: nothing (the one waiting ask), an agent
 * (its one waiting ask, or the named account's). */
export interface LoginTarget {
  agent?: string;
  name?: string;
}

export interface LoginOptions {
  /** How many quiet polls end the loop once something was answered. */
  quietPolls?: number;
  /** How long a caller expecting an ask waits for it to land. */
  waitFirstMs?: number;
  /** Walk every waiting ask, whoever's. */
  all?: boolean;
  /** A fields ask's answers, by field name, for a terminal that cannot prompt. */
  given?: Record<string, string>;
}

/** The lines of a listing of several waiting asks. */
export function waitingLines(asks: AgentAsk[]): string[] {
  const need = (ask: AgentAsk): string =>
    ask.kind === 'fields' ? 'credentials' : ask.kind === 'oauth' ? 'authorization' : 'a pairing';
  return asks.map((ask, index) => `  ${String(index + 1)}. ${askWords(ask)}  ${need(ask)}`);
}

/**
 * Answers the asks the target names, one after another, each on its
 * own screen. Nothing named: one waiting ask is answered, several are
 * listed and one picked on a terminal (or named on a pipe), unless
 * `all` walks them. Answers how many it handled.
 */
export async function loginCommand(
  plane: Plane,
  target: LoginTarget,
  io: ConnectIo,
  options: LoginOptions = {},
): Promise<number> {
  let handled = 0;
  let quiet = 0;
  let waitedMs = 0;
  let chosen: string | undefined;
  const quietLimit = options.quietPolls ?? 8;
  const waitFirstMs = options.waitFirstMs ?? 0;
  for (;;) {
    const waiting = (await pendingAsks(plane, target.agent)).filter(
      (ask) =>
        (target.name === undefined || ask.name === target.name) &&
        (chosen === undefined || ask.id === chosen || askWords(ask) === chosen),
    );
    let ask = waiting[0];
    if (ask === undefined) {
      if (handled === 0 && quiet === 0) {
        // A caller expecting an ask (a deploy that just parked an
        // agent) waits for the ask to land instead of racing it.
        if (waitedMs < waitFirstMs) {
          waitedMs += 500;
          await io.sleep(500);
          continue;
        }
        io.write('nothing is waiting to log in\n');
        return 0;
      }
      quiet += 1;
      if (quiet >= quietLimit) return handled;
      await io.sleep(500);
      continue;
    }
    if (
      handled === 0 &&
      waiting.length > 1 &&
      target.agent === undefined &&
      options.all !== true &&
      chosen === undefined
    ) {
      io.write(
        `${String(waiting.length)} accounts are waiting:\n${waitingLines(waiting).join('\n')}\n`,
      );
      if (io.pick === undefined) {
        throw new CernantoError({
          kind: 'terminal',
          message: `name one: cernanto auth login ${askWords(waiting[0] as AgentAsk)}`,
        });
      }
      const index = await io.pick('which one', waiting.length);
      const picked = waiting[index];
      if (picked === undefined) continue;
      ask = picked;
      chosen = askWords(ask);
    }
    quiet = 0;
    handled += 1;
    await answerOnScreen(plane, io, ask, options.given);
    if (chosen !== undefined) chosen = askWords(ask);
  }
}

/** A watch on the plane's waiting asks for a session that follows a
 * run: every ask the session accepts is answered in its terminal, one
 * after another; `stop` ends the watch, and `settled` resolves once
 * the answer in flight is done. After `stop` no answer begins: the
 * poll under way surfaces nothing when the plane answers it, and an
 * answer waiting its turn never takes the terminal. */
export function watchAsks(options: {
  plane: Plane;
  accepts: (ask: AgentAsk) => boolean;
  answer: (ask: AgentAsk) => Promise<void>;
  pollMs?: number;
}): { stop: () => void; settled: () => Promise<void> } {
  const seen = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let busy = false;
  let stopped = false;
  // Read through a call: the watch may stop while a poll waits on the
  // plane or an answer waits its turn.
  const over = (): boolean => stopped;
  const poll = async (): Promise<void> => {
    if (busy || over()) return;
    busy = true;
    try {
      const waiting = await pendingAsks(options.plane);
      if (over()) return;
      for (const ask of waiting) {
        if (seen.has(ask.id) || !options.accepts(ask)) continue;
        seen.add(ask.id);
        chain = chain.then(() => (over() ? undefined : options.answer(ask))).catch(() => undefined);
      }
    } catch {
      // The plane hiccuped; the next poll tries again.
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => {
    void poll();
  }, options.pollMs ?? 2000);
  timer.unref();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    settled: () => chain,
  };
}
