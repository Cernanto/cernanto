// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A copy's place on the plane, for the block and the launcher: the
// holding its record reads as, and the writes a launcher makes on the
// record, each over a substrate of the ask's own. A copy of a
// generation has one record, `copies/<generation>/<n>`, whose fields
// `copy-record.ts` reads; the block reads its holding before it serves,
// and nothing of it is copied into a file.

import { fileURLToPath } from 'node:url';

import { cloudPlaceOf, reopenedSubstrate, substrate, substrateNamed } from './connection.js';
import { copyRecordOf, readCopyRecord, recordFieldsOf } from './copy-record.js';
import type { CopyRead, ProcessRecord } from './copy-record.js';
import { LEASE_MS } from './facts.js';
import type { HolderFacts } from './facts.js';
import { lifeOf } from './lives.js';
import { COPIES_PREFIX, copyKey } from './substrate.js';
import type { Records, Substrate } from './substrate.js';
import { openDynamoSubstrate } from './substrate/dynamodb/index.js';
import { openFilesSubstrate } from './substrate/files/index.js';

/** A copy's name in words: `<generation>/<copy>`. */
function slotOf(generation: number, copy: number): string {
  return `${String(generation)}/${String(copy)}`;
}

/** A copy's place on the plane: its record and its key, the holder
 * facts read off it, and the process the record names. */
export interface Holding {
  /** The record's key, `copies/<agent>/<n>`. */
  key: string;
  record: Record<string, unknown>;
  holder: HolderFacts;
  process: ProcessRecord | undefined;
}

/** The substrate of a plane named by its place, opened for one ask. */
type PlaneHandles = Substrate;

/** The substrate a plane's place names, opened for one ask: the files
 * under a `file:` url's root, or the cloud stores a `dynamodb:` url
 * names. Anything else is no place this release knows. */
function openPlaceSubstrate(place: string): Substrate {
  const cloud = cloudPlaceOf(place);
  if (cloud !== undefined) return openDynamoSubstrate(cloud);
  if (place.startsWith('file:')) return openFilesSubstrate({ root: fileURLToPath(new URL(place)) });
  throw new Error(
    `no substrate at ${place}: a plane's place is a file: url to the root of its files or a dynamodb: url naming its table and bucket`,
  );
}

/** Runs one ask over a substrate of the ask's own, closed after: the
 * block reads its record before the process has its facts (its own
 * substrate opens in its agent's name once it has them), the launcher
 * writes a record from a process that serves nothing, the host job says
 * its one word. */
export async function withPlane<T>(
  place: string,
  ask: (handles: PlaneHandles) => Promise<T>,
  reading = false,
): Promise<T> {
  // A process whose facts name a cloud store asks its own substrate (one
  // connection per process); before the facts, or on a laptop, the ask
  // opens the place's own for itself. A read made while the process resumes (its holding, before
  // its identity is taken) rides the handles the resume reopened: the
  // accessor holds every reach until the resume lets them go, and the
  // resume's own read would wait on itself.
  const named = substrateNamed();
  if (named !== undefined && named.name !== 'files-sqlite')
    return ask((reading ? reopenedSubstrate() : undefined) ?? (await substrate()));
  const handles = openPlaceSubstrate(place);
  try {
    return await ask(handles);
  } finally {
    await handles.close().catch(() => undefined);
  }
}

/** The holding a record reads as; a record that names no host or no
 * epoch (one the host job has not placed, or let go) is refused in
 * words. */
function holdingOf(key: string, slot: string, record: Record<string, unknown>): Holding {
  const { host, epoch, process } = copyRecordOf(record);
  if (host === undefined || epoch === undefined || !Number.isSafeInteger(epoch) || epoch < 1)
    throw new Error(`the record ${key} names no host or no epoch`);
  return {
    key,
    record,
    holder: {
      host,
      epoch,
      slot,
      leaseMs: LEASE_MS,
    },
    process,
  };
}

/** The record of a generation's copy under `copies/`, by the port the
 * generation serves on and the copy's number, as the block is handed
 * them: its key is spelled from them. Nothing when none stands. */
async function findCopyRecord(
  records: Records,
  generation: number,
  copy: number,
): Promise<{ key: string; record: Record<string, unknown> } | undefined> {
  const key = copyKey(generation, copy);
  const record = recordFieldsOf((await records.read(key)).value);
  return record === undefined ? undefined : { key, record };
}

/** Reads a copy's holding over a substrate of the read's own, by its
 * generation's port and its number: the block reads it before the
 * process has its facts, and again after a pause. Nothing when no
 * record stands: the copy has no place on the plane. */
export function readHolding(
  place: string,
  generation: number,
  copy: number,
): Promise<Holding | undefined> {
  return withPlane(
    place,
    async ({ records }) => {
      const found = await findCopyRecord(records, generation, copy);
      return found === undefined
        ? undefined
        : holdingOf(found.key, slotOf(generation, copy), found.record);
    },
    true,
  );
}

/** How many times a compare-and-set is asked again when the record
 * moved under it. */
const UPDATE_ASKS = 5;

/** Changes a record under its whole key by compare-and-set, over the
 * handles given: `update` is handed what stands (nothing when no record
 * does) and answers the record to write, or nothing to leave things as
 * they are. Answers what was written. A record that moved under the
 * write is read again, five times at most. */
async function updateRecordWith(
  handles: PlaneHandles,
  key: string,
  update: (current: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  for (let ask = 1; ; ask += 1) {
    const read = await handles.records.read(key);
    const standing = recordFieldsOf(read.value);
    const next = update(standing);
    if (next === undefined) return undefined;
    const written = await handles.records.write(key, JSON.stringify(next), read.value);
    if (written.ok) return next;
    if (ask >= UPDATE_ASKS) throw new Error(`the record ${key} moved under ${String(ask)} writes`);
  }
}

/** Issues the next grant of a copy's log: the launcher's ask before a
 * spawn or a restore, handed to the copy with its attempt, so the copy
 * owns its log by it. The log is kept under the life the copy
 * runs under. */
export function issueLaunch(place: string, log: string, life: string): Promise<number> {
  return withPlane(place, (handles) => handles.logsOf(life).issue(log));
}

/** The life an agent's name stands under, made when none stands: the
 * launcher's ask for a launch that names no life. */
export function lifeOnPlane(place: string, service: string): Promise<string> {
  return withPlane(place, (handles) => lifeOf(handles, service));
}

export function updateRecord(
  place: string,
  key: string,
  update: (current: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  return withPlane(place, (handles) => updateRecordWith(handles, key, update));
}

/** The copies' records that name a host, each with its key: what the
 * block stops a host by once its host job is gone. */
export function copiesOnHost(
  place: string,
  host: string,
): Promise<{ key: string; record: CopyRead }[]> {
  return withPlane(place, async ({ records }) => {
    const { entries } = await records.list(COPIES_PREFIX);
    return entries.flatMap(({ key, value }) => {
      const record = readCopyRecord(value);
      return record?.host === host ? [{ key, record }] : [];
    });
  });
}
