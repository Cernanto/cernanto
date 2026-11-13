// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The copy's own record on the plane, `copies/<generation>/<n>`: what
// a process says of itself to whoever runs it. Whether it serves, its
// listeners, its call server's address, a worker's exit, when it
// resumed, and the attempt it was launched under, written when one of
// them changes and never on a clock. Written by compare-and-set over
// what stands (the host job's fields stay), asked again while the
// substrate refuses; a record whose epoch moved past this copy's is
// left alone. At the process's clean exit the record says the copy
// stopped.

import { processFacts } from './facts.js';
import type { ListenerFact } from './listeners.js';
import { substrate } from './connection.js';
import { copyKey } from './substrate.js';
import { isDraining } from './admission.js';
import { kernelSay } from '../traces/observe.js';

/** The entry as the record holds it, among the record's other fields. */
export interface CopyEntry {
  agentId: string;
  generation: number;
  copy: number;
  attempt?: string | undefined;
  /** The life the copy runs under: a request names it, and a copy takes
   * a request for its own life alone. */
  life?: string | undefined;
  ready: boolean;
  listens: ListenerFact[];
  /** Where the copy's call server listens; absent while the copy has
   * none (paused, or no port free). */
  address?: CallAddress | undefined;
  exitCode?: number | undefined;
  resumedAt?: number | undefined;
  at: number;
}

/** A call server's address: the host and the port it listens on. */
export interface CallAddress {
  host: string;
  port: number;
}

let ready = false;
let listens: ListenerFact[] = [];
let address: CallAddress | undefined;
let exitCode: number | undefined;
let resumedAt: number | undefined;
let writing: Promise<void> | undefined;
let again = false;
let forgotten = false;

/** The key this process's record lives under, when the process is a
 * copy of a generation; nothing in a process the plane does not run. */
export function ownEntryKey(): string | undefined {
  const { agentId, generationPort, copy } = processFacts();
  if (
    agentId === undefined ||
    generationPort === undefined ||
    generationPort === 0 ||
    copy === undefined
  )
    return undefined;
  return copyKey(generationPort, copy);
}

function entryNow(): CopyEntry | undefined {
  const { agentId, generationPort, copy, attempt, life } = processFacts();
  if (agentId === undefined || generationPort === undefined || copy === undefined) return undefined;
  return {
    agentId,
    generation: generationPort,
    copy,
    ...(attempt === undefined ? {} : { attempt }),
    ...(life === undefined ? {} : { life }),
    ready,
    listens: listens.map((fact) => ({ ...fact })),
    ...(address === undefined ? {} : { address: { ...address } }),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(resumedAt === undefined ? {} : { resumedAt }),
    at: Date.now(),
  };
}

/** How many times a write refused for a moved record is asked again. */
const WRITE_ROUNDS = 5;

/** Writes the entry over the record as it stands: the record's other
 * fields kept, the state live. A record held at a newer epoch is not
 * written, and neither is a record that is gone when the plane placed
 * this copy by it: the controller removed the copy's slot (a park, a
 * retirement), and the copy writes nothing back where the slot stood.
 * A copy no slot placed (a proof's own) writes its record itself. */
async function writeNow(): Promise<void> {
  const key = ownEntryKey();
  const entry = entryNow();
  if (key === undefined || entry === undefined || forgotten) return;
  const { records } = await substrate();
  const holder = processFacts().holder;
  const epoch = holder?.epoch;
  for (let round = 1; round <= WRITE_ROUNDS; round += 1) {
    const read = await records.read(key);
    if (read.value === null && holder !== undefined) return;
    let standing: Record<string, unknown> = {};
    if (read.value !== null) {
      try {
        const parsed: unknown = JSON.parse(read.value);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
          standing = parsed as Record<string, unknown>;
      } catch {
        standing = {};
      }
    }
    if (epoch !== undefined && typeof standing['epoch'] === 'number' && standing['epoch'] > epoch)
      return;
    const next = {
      ...standing,
      ...entry,
      state: 'live',
      ...(epoch === undefined ? {} : { epoch }),
    };
    const written = await records.write(key, JSON.stringify(next), read.value);
    if (written.ok) return;
  }
  throw new Error(`the record ${key} moved ${String(WRITE_ROUNDS)} times under the entry`);
}

/** Writes the entry once the write before it ended, asking again on a
 * failure with a pause that doubles to thirty seconds, until it lands
 * or the process drains. */
function schedule(): void {
  if (writing !== undefined) {
    again = true;
    return;
  }
  writing = (async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        again = false;
        await writeNow();
        break;
      } catch (error) {
        if (isDraining() && attempt > 1) break;
        kernelSay(
          `the copy's record could not be written: ${error instanceof Error ? error.message : String(error)}; asking again\n`,
        );
        await new Promise<void>((done) => {
          setTimeout(done, Math.min(1000 * 2 ** (attempt - 1), 30_000)).unref();
        });
      }
    }
  })().finally(() => {
    writing = undefined;
    if (again) schedule();
  });
}

/** Says a change of the copy's own facts: what is given replaces what
 * stood, the rest stays. A process the plane does not run says
 * nothing. */
export function sayEntry(
  patch: Partial<Pick<CopyEntry, 'ready' | 'listens' | 'address' | 'exitCode' | 'resumedAt'>>,
): void {
  if (ownEntryKey() === undefined) return;
  if (patch.ready !== undefined) ready = patch.ready;
  if (patch.listens !== undefined) listens = patch.listens;
  // The address is said as given, gone when given as none: a copy that
  // closed its server (a pause) has no call server until it opens one anew.
  if ('address' in patch) address = patch.address;
  if (patch.exitCode !== undefined) exitCode = patch.exitCode;
  if (patch.resumedAt !== undefined) resumedAt = patch.resumedAt;
  schedule();
}

/** Resolves once the writes asked so far have landed or were let go. */
export async function entrySaid(): Promise<void> {
  while (writing !== undefined) await writing;
}

/** Says the copy stopped at the process's clean end, when the record is
 * still this process's own (a replacement under another attempt writes
 * its own meanwhile, and that one stays). */
export async function forgetEntry(): Promise<void> {
  const key = ownEntryKey();
  if (key === undefined) return;
  await entrySaid();
  forgotten = true;
  try {
    const { records } = await substrate();
    const read = await records.read(key);
    if (read.value === null) return;
    const standing = JSON.parse(read.value) as Record<string, unknown>;
    const own = processFacts().attempt;
    const theirs = standing['attempt'];
    if (own !== undefined && theirs !== undefined && theirs !== own) return;
    await records.write(
      key,
      JSON.stringify({ ...standing, state: 'stopped', ready: false, at: Date.now() }),
      read.value,
    );
  } catch (error) {
    kernelSay(
      `the copy's record could not be written at its end: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/** The entry as this process would write it now; a proof's read. */
export function ownEntry(): CopyEntry | undefined {
  return entryNow();
}
