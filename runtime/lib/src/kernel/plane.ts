// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The plane's records as every process knows them: the families the
// host job, the controller and the block write, by the one name each
// has on every plane, as prefixes of the records. A copy of a
// generation has one record, `copies/<agent>/<n>`: the host job writes
// it when it starts the copy (the holder, the epoch of its tenure, the
// launch facts, the process the launcher started for it and the words
// to it) and the copy's own kernel writes its entry on the same record;
// the host job says its host's stop under `control/stop/<host>`. The
// block reads its record before it serves, the fence reads the record
// and the words as it serves, and nothing of any of it is copied into
// a file.

import { fileURLToPath } from 'node:url';

import { cloudPlaceOf, reopenedSubstrate, substrate, substrateNamed } from './connection.js';
import { LEASE_MS } from './facts.js';
import type { HolderFacts } from './facts.js';
import { lifeOf } from './lives.js';
import { copyKey } from './substrate.js';
import type { Records, Substrate } from './substrate.js';
import { openDynamoSubstrate } from './substrate/dynamodb/index.js';
import { openFilesSubstrate } from './substrate/files/index.js';

/** The family of the plane's control words: the hosts' stops among them. */
const CONTROL_FAMILY = 'control';

/** A copy's name in words: `<generation>/<copy>`. */
function slotOf(generation: number, copy: number): string {
  return `${String(generation)}/${String(copy)}`;
}

/** The host a record names, which the controller's placement and the
 * launcher write; nothing when it names none. */
export function hostOf(record: Record<string, unknown>): string | undefined {
  const host = record['host'];
  return typeof host === 'string' && host !== '' ? host : undefined;
}

/** The host's stop word's key within the control family. */
export function hostStopKey(host: string): string {
  return `stop/${host}`;
}

/** A record's whole key: its family and its key within it. */
function keyOf(bucket: string, key: string): string {
  return `${bucket}/${key}`;
}

function parsed(value: string | null): Record<string, unknown> | undefined {
  if (value === null) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(value);
  } catch {
    return undefined;
  }
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;
}

/** The value under a whole key, over the process's own substrate;
 * nothing when the key is not there. */
export async function readRecord(key: string): Promise<Record<string, unknown> | undefined> {
  const { records } = await substrate();
  return parsed((await records.read(key)).value);
}

/** Creates a record under a whole key when none stands, over the
 * process's own substrate: a setting the plane lacks, written as its
 * JSON text. Answers whether this write made it; a record standing
 * already, or written by another meanwhile, is left as it is. */
export async function createRecord(key: string, value: string): Promise<boolean> {
  const { records } = await substrate();
  const read = await records.read(key);
  if (read.value !== null) return false;
  return (await records.write(key, value, null)).ok;
}

/** An object of the plane's by its name, over the process's own
 * substrate: a generation's tar as the landing recorded it or the
 * materialize answered. Nothing when no object stands under the name. */
export async function readObject(name: string): Promise<Uint8Array | undefined> {
  const { objects } = await substrate();
  return objects.get(name);
}

/** Removes an object of the plane's; nothing when it is not there. */
export async function deleteObject(name: string): Promise<void> {
  const { objects } = await substrate();
  await objects.delete(name);
}

/** The value under a family's key, over the process's own substrate. */
export async function readFamilyRecord(
  bucket: string,
  key: string,
): Promise<Record<string, unknown> | undefined> {
  return readRecord(keyOf(bucket, key));
}

/** The process a holding record names: what the launcher wrote before
 * it started the copy (the attempt, a fresh nonce per launch, and for a
 * restore the attempt of the life the image holds) and after (the pid
 * it started, with the start and boot identities the process table gave
 * it, so a recycled pid or a later boot never passes for it). */
export interface ProcessRecord {
  attempt?: string | undefined;
  restores?: string | undefined;
  /** The grant the launcher issued from the copy's log for this
   * launch. */
  launch?: number | undefined;
  at?: number | undefined;
  pid?: number | undefined;
  started?: string | undefined;
  boot?: string | undefined;
}

/** The process field of a record, when it carries one that reads. */
export function processOf(record: Record<string, unknown> | undefined): ProcessRecord | undefined {
  const value = record?.['process'];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const text = (name: string): string | undefined =>
    typeof fields[name] === 'string' && fields[name] !== '' ? fields[name] : undefined;
  const number = (name: string): number | undefined =>
    typeof fields[name] === 'number' ? fields[name] : undefined;
  return {
    ...(text('attempt') === undefined ? {} : { attempt: text('attempt') }),
    ...(text('restores') === undefined ? {} : { restores: text('restores') }),
    ...(number('launch') === undefined ? {} : { launch: number('launch') }),
    ...(number('at') === undefined ? {} : { at: number('at') }),
    ...(number('pid') === undefined ? {} : { pid: number('pid') }),
    ...(text('started') === undefined ? {} : { started: text('started') }),
    ...(text('boot') === undefined ? {} : { boot: text('boot') }),
  };
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
  const { epoch } = record;
  const host = hostOf(record);
  if (host === undefined || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1)
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
    process: processOf(record),
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
  const record = parsed((await records.read(key)).value);
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
    const standing = parsed(read.value);
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

/** Writes a control word over a substrate of the write's own: the host
 * job's stop of its host, `stop/<host>` with the moment, which every
 * copy of the host reads as a stop of its own (fence.ts). */
export function writeControlWord(
  place: string,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  return withPlane(place, async ({ records }) => {
    const whole = keyOf(CONTROL_FAMILY, key);
    for (let ask = 1; ; ask += 1) {
      const read = await records.read(whole);
      const written = await records.write(whole, JSON.stringify(value), read.value);
      if (written.ok) return;
      if (ask >= UPDATE_ASKS) throw new Error(`the word ${whole} could not be written`);
    }
  });
}
