// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The words the plane says to a copy, taken at its call server: `stop`
// (the copy finishes the calls it holds and exits), `park` (it exits
// with its journal kept, started again when a call comes) and
// `draining` (a newer generation serves: no new call lands, the calls
// held finish, then the exit). Each is a drain of the process with its
// own words for why. Nothing here watches the plane: a word reaches
// the copy as a post from the host job, and the copy reads its record
// once, at its boot, for a word said before it could be posted and for
// a place that is no longer its own, which fences it: the listeners
// closed at once, the calls in flight finished within a lease, the
// exit.

import { LEASE_MS, processFacts } from './facts.js';
import type { HolderFacts } from './facts.js';
import { closeListeners } from './listeners.js';
import { hostOf, processOf, readRecord } from './plane.js';
import { ownEntryKey } from './copy-entry.js';
import { kernelSay } from '../traces/observe.js';

/** A word the plane said to the copy. */
export type Word = 'stop' | 'park' | 'draining';

/** What a reading of the record found: confirmed, a word, or fenced. */
export type Reading = 'confirmed' | { word: Word; why: string } | { fenced: string };

/** What a reading is made against. */
export interface Watched {
  holder: HolderFacts | undefined;
  /** The attempt this copy was launched under, when it was. */
  attempt: string | undefined;
  /** The record the words are read on: the copy's own. */
  key: string | undefined;
}

/** One reading of the record and the words on it. A record the plane
 * removed is a fence for a placed copy: its place on the plane is gone
 * (its generation retired, its count lowered), and a copy that served
 * on would take calls it cannot finish. */
export async function readWords(watched: Watched): Promise<Reading> {
  const { holder } = watched;
  if (watched.key === undefined) return 'confirmed';
  const record = await readRecord(watched.key);
  if (record === undefined) {
    return holder === undefined
      ? 'confirmed'
      : { fenced: `the record ${watched.key} was removed: this copy's place on the plane is gone` };
  }
  const held = hostOf(record);
  if (holder !== undefined && held !== undefined && held !== holder.host)
    return { fenced: `the record ${watched.key} is held by ${held}, not by ${holder.host}` };
  const epoch = record['epoch'];
  if (holder !== undefined && typeof epoch === 'number' && epoch > holder.epoch)
    return {
      fenced: `the record ${watched.key} is held at epoch ${String(epoch)}, past this copy's ${String(holder.epoch)}`,
    };
  const launched = processOf(record);
  if (
    watched.attempt !== undefined &&
    launched?.attempt !== undefined &&
    launched.attempt !== watched.attempt &&
    launched.restores !== watched.attempt
  )
    return {
      fenced: `the record ${watched.key} runs the attempt ${launched.attempt} now, not this copy's ${watched.attempt}`,
    };
  const stop = record['stop'];
  if (stop !== undefined && stop !== false && stop !== null) {
    const word =
      typeof stop === 'object' && !Array.isArray(stop)
        ? (stop as { attempt?: unknown; at?: unknown })
        : {};
    const named = word.attempt;
    // A stop word naming no attempt is for the copies running when it
    // was said: one said before this copy's own launch was superseded
    // by the launch, as the host job's words have it, and stops nobody now.
    const launchedAt = (record['process'] as { at?: unknown } | undefined)?.at;
    const stale =
      named === undefined &&
      typeof word.at === 'number' &&
      typeof launchedAt === 'number' &&
      word.at < launchedAt;
    if (!stale && (named === undefined || named === watched.attempt))
      return { word: 'stop', why: `the record ${watched.key} says stop` };
  }
  if (record['park'] === true) return { word: 'park', why: `the record ${watched.key} says park` };
  if (record['draining'] === true)
    return { word: 'draining', why: `the record ${watched.key} says draining` };
  return 'confirmed';
}

let onWord: ((word: Word, why: string) => void) | undefined;
let onDrain: ((why: string, code: number) => void) | undefined;
const said = new Set<Word>();

/** Installs what the words do in this process; answers what uninstalls
 * them. `drain` is the process's own drain (the intake stopped, the
 * calls in flight finished, the process gone with the code), asked on a
 * fence with the code 2; `word` is asked once per word the plane says. */
export function installWords(options: {
  drain: (why: string, code: number) => void;
  word: (word: Word, why: string) => void;
}): () => void {
  onWord = options.word;
  onDrain = options.drain;
  said.clear();
  return () => {
    onWord = undefined;
    onDrain = undefined;
  };
}

/** Takes a word the plane posted to this copy: said once, and the
 * process drains on it. Answers whether the process takes words (one
 * the plane does not run takes none). */
export function takeWord(word: Word, why: string): boolean {
  const handler = onWord;
  if (handler === undefined) return false;
  if (said.has(word)) return true;
  said.add(word);
  kernelSay(`${word}: ${why}\n`);
  handler(word, why);
  return true;
}

/** Fences the copy: the listeners closed first, the reason said, and
 * the drain given a lease before the process exits regardless, so a
 * fenced copy takes nothing more and whoever runs it has every fact it
 * needs. */
export function fence(why: string): void {
  const drain = onDrain;
  closeListeners();
  if (drain === undefined) {
    kernelSay(`fenced: ${why}; the listeners are closed and the process exits\n`);
    process.exit(2);
  }
  kernelSay(
    `fenced: ${why}; the listeners are closed, the calls in flight finish within a lease and the process exits\n`,
  );
  drain(why, 2);
  const leaseMs = processFacts().holder?.leaseMs ?? LEASE_MS;
  setTimeout(() => {
    kernelSay(`fenced: a lease passed with calls still in flight; the process exits\n`);
    process.exit(2);
  }, leaseMs).unref();
}

/** Reads the copy's own record once, at its boot, and acts on what it
 * says: a word said before the copy could be posted it is taken, and a
 * place that is no longer the copy's own fences it. A record that
 * cannot be read this moment decides nothing. */
export async function readWordsAtBoot(): Promise<void> {
  const facts = processFacts();
  const key = ownEntryKey();
  if (key === undefined) return;
  let found: Reading;
  try {
    found = await readWords({ holder: facts.holder, attempt: facts.attempt, key });
  } catch {
    return;
  }
  if (typeof found === 'object' && 'fenced' in found) {
    fence(found.fenced);
    return;
  }
  if (typeof found === 'object' && 'word' in found) takeWord(found.word, found.why);
}
