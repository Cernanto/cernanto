// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The lives: an agent's life is one span of its deployment, from its
// first run to its delete, and everything the plane keeps for the agent
// (its journal, its traces, its totals) is kept under it, so a name used
// again after a delete is a new life and reads nothing of the old one.
// One record of the plane per name, `lives/<service>`, names the life
// that stands. Whoever needs the life of a name asks for it here and is
// answered the life the record names, or a new one made by an exclusive
// create of the record, the life's files made first (on a laptop), so of
// two that ask at once one makes it and the other is answered the same
// life. At a life's end the record stops naming it before anything else
// of it goes.

import { setTimeout as sleep } from 'node:timers/promises';

import { freshUUID } from './entropy.js';
import { isLifeId, lifeKey, lifeOfRecord } from './substrate.js';
import type { Substrate } from './substrate.js';

/** How many times a life's record is read again when another writer
 * moved it under this one. */
const LIFE_ASKS = 20;

/** A fresh life's id: sixteen hex digits of the kernel's own
 * randomness, a word every store spells as it is. */
function freshLife(): string {
  return freshUUID().replaceAll('-', '').slice(0, 16);
}

/** The life a name's record names now, or nothing. */
export async function standingLife(
  handles: Substrate,
  service: string,
): Promise<string | undefined> {
  return lifeOfRecord((await handles.records.read(lifeKey(service))).value);
}

/**
 * Answers the life the name's record names, making one when none
 * stands. With `ending`, a record that names one of those lives is
 * ended first, so the answer is never one of them: the install's ask
 * for an agent whose old lives wait on the list of lives to end.
 */
export async function lifeOf(
  handles: Substrate,
  service: string,
  ending?: string | readonly string[],
): Promise<string> {
  const key = lifeKey(service);
  const ended = new Set(ending === undefined ? [] : typeof ending === 'string' ? [ending] : ending);
  for (let ask = 1; ask <= LIFE_ASKS; ask += 1) {
    const read = await handles.records.read(key);
    const standing = lifeOfRecord(read.value);
    if (standing !== undefined && !ended.has(standing)) return standing;
    if (standing !== undefined) {
      await handles.records.write(key, null, read.value);
      continue;
    }
    const life = freshLife();
    // The life's files stand before its name's record names it: a
    // writer opens them and never makes them.
    await handles.beginLife(service, life);
    const wrote = await handles.records.write(
      key,
      JSON.stringify({ life, born: Date.now() }),
      read.value,
    );
    if (wrote.ok) return life;
    // Another asker made the record first: its life is the answer, and
    // the files made for this one go.
    await handles.removeLife(service, life).catch(() => false);
  }
  throw new Error(
    `the life of ${service} could not be read or made: its record moved ${String(LIFE_ASKS)} times under the ask`,
  );
}

/** The name's record stops naming a life: removed when it names that
 * one, left as it stands otherwise. */
async function unnameLife(handles: Substrate, service: string, life: string): Promise<void> {
  const key = lifeKey(service);
  for (let ask = 1; ask <= LIFE_ASKS; ask += 1) {
    const read = await handles.records.read(key);
    if (lifeOfRecord(read.value) !== life) return;
    const wrote = await handles.records.write(key, null, read.value);
    if (wrote.ok) return;
  }
  throw new Error(`the record of ${service} could not be ended: it moved under the ask`);
}

/**
 * Ends a life: the name's record stops naming it, then everything kept
 * under it is removed, the writers' gates first. Answers whether nothing
 * is left; false asks again later (the removal goes on in pages from
 * where the last ask stopped, and on the servers the traces wait, once
 * their writers' gates are gone, for the longest a part can take).
 */
export async function endLife(handles: Substrate, service: string, life: string): Promise<boolean> {
  if (!isLifeId(life)) throw new Error(`"${String(life)}" names no life`);
  await unnameLife(handles, service, life);
  return handles.removeLife(service, life);
}

/** Ends a life and waits for its removal to be whole, asking again at
 * the pace given: a proof's road and a tool's. */
export async function endLifeWhole(
  handles: Substrate,
  service: string,
  life: string,
  pauseMs = 1000,
): Promise<void> {
  while (!(await endLife(handles, service, life))) await sleep(pauseMs);
}
