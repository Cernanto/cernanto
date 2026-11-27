// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { LsRow } from '../gateway/types.gen.js';

/** The folder the platform's own agents live under. */
const PLATFORM_FOLDER = 'cernanto/';

/** How many tones a picture takes its colour from: as many as the
 * stylesheet declares (`--ui-tone-0` and on, `styles/tokens.css`). The
 * two change together. */
export const TONES = 12;

/** Whether an agent is one of the platform's own. */
export function isPlatform(agentId: string): boolean {
  return agentId.startsWith(PLATFORM_FOLDER);
}

/**
 * An id's two parts as the list shows them: its folder, with the slash
 * that ends it, and its last part.
 *
 * @example
 * idParts('notifications/telegram-send'); // { folder: 'notifications/', name: 'telegram-send' }
 */
export function idParts(agentId: string): { folder: string; name: string } {
  const cut = agentId.lastIndexOf('/');
  return cut < 0
    ? { folder: '', name: agentId }
    : { folder: agentId.slice(0, cut + 1), name: agentId.slice(cut + 1) };
}

/**
 * The two letters of an agent's picture, read from its id's last part:
 * the first letters of its first two words, and for one word its first
 * two letters.
 *
 * @example
 * initials('notifications/telegram-send'); // 'TS'
 * initials('connectors/slack'); // 'SL'
 */
export function initials(agentId: string): string {
  const { name } = idParts(agentId);
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '');
  const first = words[0] ?? '';
  const second = words[1];
  const letters = second === undefined ? first.slice(0, 2) : `${first[0] ?? ''}${second[0] ?? ''}`;
  return letters === '' ? '?' : letters.toUpperCase();
}

/**
 * The tone of an agent's picture: one of the quiet tones, taken from
 * its id by a hash, so an agent keeps its colour for good.
 */
export function toneOf(agentId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < agentId.length; index += 1) {
    hash ^= agentId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // The hash's low bits follow the low bits of the letters alone, so its
  // high bits are folded in before the few tones are taken from it.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % TONES;
}

/** How the dot of an agent's state is drawn. */
export type Dot =
  'ready' | 'busy' | 'degraded' | 'starting' | 'failed' | 'parked' | 'unknown' | 'none';

/**
 * The dot of an agent's state, by the plane's own word for it: a ring
 * while it is up and at rest, full while it holds a call now, half
 * while some of its copies are ready, turning while it starts, red
 * when it failed, grey while it holds no copy. A module and an
 * interface run inside others and carry none.
 */
export function dotOf(row: Pick<LsRow, 'type' | 'status' | 'incomingActive'>): Dot {
  if (row.type === 'module' || row.type === 'interface') return 'none';
  switch (row.status) {
    case 'Ready':
      return (row.incomingActive ?? 0) > 0 ? 'busy' : 'ready';
    case 'Running':
      return 'busy';
    case 'Degraded':
      return 'degraded';
    case 'Starting':
      return 'starting';
    case 'Failed':
      return 'failed';
    case 'Parked':
    case 'Waiting':
    case 'Finished':
      return 'parked';
    default:
      return 'unknown';
  }
}

/** Whether a status is one the reader should look at: the plane's
 * words for an agent that does not stand as it should. */
export function notReady(status: string): boolean {
  return (
    status === 'Starting' || status === 'Degraded' || status === 'Failed' || status === 'Unknown'
  );
}

/** An agent's kind with its article, as a sentence names it: `a task`,
 * `an interface`. */
export function aKind(type: string): string {
  return `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`;
}

/** Whether an agent can be called through the gateway: a module runs
 * inside the agents that use it, and a worker is run by the plane. */
export function callable(type: LsRow['type']): boolean {
  return type !== 'module' && type !== 'worker';
}

/**
 * The module and the function a linked function's name stands for: the
 * name an agent answers a module's function under is `<module
 * id>.<function>@<the mark of the module's package>`. Nothing for an
 * agent's own function: an exported name has neither a dot nor an `@`,
 * so one that carries a dot is a module's, and what follows its last
 * `@` is the mark.
 */
export function linkedFunctionOf(handler: string): { module: string; fn: string } | undefined {
  const dot = handler.lastIndexOf('.');
  if (dot <= 0 || dot >= handler.length - 1) return undefined;
  const named = handler.slice(dot + 1);
  const mark = named.lastIndexOf('@');
  return { module: handler.slice(0, dot), fn: mark > 0 ? named.slice(0, mark) : named };
}

/** A function's name as a chat speaks it: `checkFact` reads `Check
 * fact`, and a name that opens with `ai` before a capital drops it. A
 * linked function, the name an agent answers a module's function under
 * (`<module id>.<function>@<the mark of the module's package>`), reads
 * as the function of the module, the module's id as it is: `Quote of
 * billing/price-book`. The mark says which package of the module the
 * agent links, for the plane's own routing, and is no word of the
 * function's. */
export function spoken(handler: string): string {
  const linked = linkedFunctionOf(handler);
  if (linked !== undefined) return `${spoken(linked.fn)} of ${linked.module}`;
  const bare = /^ai[A-Z]/.test(handler) ? handler.slice(2) : handler;
  const words = bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  return words === '' ? handler : `${words[0]?.toUpperCase() ?? ''}${words.slice(1)}`;
}
