// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A copy's record, `copies/<generation>/<n>`, read: its fields typed
// once and parsed once, for every reader of the kernel. Three write the
// record: the platform's agents (the controller and the host job, whose
// fields the seam says), the block's launcher (the process it started
// for the copy) and the copy's own kernel (its entry). A field that
// does not read as its type reads as absent, so a reader asks for the
// field and never for its shape.

import { substrate } from './connection.js';
import type { CopyRecord, ImageNamed } from './seam.js';

/** The process a record names: what the launcher wrote before it
 * started the copy (the attempt, a fresh nonce per launch, and for a
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

/** A copy's record as the kernel reads it: the platform's fields, the
 * launcher's and the copy's own entry. */
export interface CopyRead extends CopyRecord {
  /** The process the launcher started for the copy. */
  process?: ProcessRecord;
  /** The agent the copy serves, as its own entry says it. */
  agentId?: string;
  /** The life the copy runs under, as its own entry says it. */
  life?: string;
  /** The attempt the copy was launched under, as its own entry says it. */
  attempt?: string;
  /** Where the copy's call server listens; absent while it has none. */
  address?: { host: string; port: number };
  /** Whether the copy says it serves. */
  ready: boolean;
  /** The copy's state, when one was said: `live`, `stopped`, `parked`. */
  state?: string;
}

type Fields = Record<string, unknown>;

function fieldsOf(value: unknown): Fields | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** A member a record carries only when it reads. */
function read<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { [K in Key]?: Value } {
  return (value === undefined ? {} : { [key]: value }) as { [K in Key]?: Value };
}

/** A stored value as a record's fields; nothing when it is no record. */
export function recordFieldsOf(value: string | null): Fields | undefined {
  if (value === null) return undefined;
  try {
    return fieldsOf(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** The image a value names, when it names one. */
export function imageNamedOf(value: unknown): ImageNamed | undefined {
  const fields = fieldsOf(value);
  const image = textOf(fields?.['image']);
  const journals = fields?.['journals'];
  if (image === undefined || !Array.isArray(journals)) return undefined;
  const named: ImageNamed['journals'] = [];
  for (const entry of journals as unknown[]) {
    const subject = textOf(fieldsOf(entry)?.['subject']);
    const position = numberOf(fieldsOf(entry)?.['position']);
    if (subject !== undefined && position !== undefined) named.push({ subject, position });
  }
  return { image, journals: named };
}

function processOf(value: unknown): ProcessRecord | undefined {
  const fields = fieldsOf(value);
  if (fields === undefined) return undefined;
  return {
    ...read('attempt', textOf(fields['attempt'])),
    ...read('restores', textOf(fields['restores'])),
    ...read('launch', numberOf(fields['launch'])),
    ...read('at', numberOf(fields['at'])),
    ...read('pid', numberOf(fields['pid'])),
    ...read('started', textOf(fields['started'])),
    ...read('boot', textOf(fields['boot'])),
  };
}

/** The stop word a record carries: anything but nothing and `false`
 * is a word, and one that is no record names no attempt and no
 * moment. */
function stopOf(value: unknown): CopyRecord['stop'] {
  if (value === undefined || value === false || value === null) return undefined;
  const fields = fieldsOf(value);
  return {
    ...read('attempt', textOf(fields?.['attempt'])),
    ...read('at', numberOf(fields?.['at'])),
  };
}

function addressOf(value: unknown): CopyRead['address'] {
  const fields = fieldsOf(value);
  const host = fields?.['host'];
  const port = numberOf(fields?.['port']);
  return typeof host === 'string' && port !== undefined && Number.isInteger(port)
    ? { host, port }
    : undefined;
}

/** A record's fields as a copy's record, each read by its type. */
export function copyRecordOf(fields: Fields): CopyRead {
  const launch = fieldsOf(fields['launch']);
  return {
    ...read('host', textOf(fields['host'])),
    ...read('epoch', numberOf(fields['epoch'])),
    ...read(
      'launch',
      launch === undefined
        ? undefined
        : {
            ...read('agentId', textOf(launch['agentId'])),
            ...read('life', textOf(launch['life'])),
          },
    ),
    ...(fields['draining'] === true ? { draining: true as const } : {}),
    ...(fields['park'] === true ? { park: true as const } : {}),
    ...read('hostGoneAt', numberOf(fields['hostGoneAt'])),
    ...read('stop', stopOf(fields['stop'])),
    ...read('image', imageNamedOf(fields['image'])),
    ...read('process', processOf(fields['process'])),
    ...read('agentId', textOf(fields['agentId'])),
    ...read('life', textOf(fields['life'])),
    ...read('attempt', textOf(fields['attempt'])),
    ...read('address', addressOf(fields['address'])),
    ready: fields['ready'] === true,
    ...read('state', textOf(fields['state'])),
  };
}

/** A stored value as a copy's record; nothing when it is no record. */
export function readCopyRecord(value: string | null): CopyRead | undefined {
  const fields = recordFieldsOf(value);
  return fields === undefined ? undefined : copyRecordOf(fields);
}

/** The copy's record under a key, over the process's own substrate;
 * nothing when no record stands there. */
export async function copyRecordAt(key: string): Promise<CopyRead | undefined> {
  const { records } = await substrate();
  return readCopyRecord((await records.read(key)).value);
}

/** Whether a record says its copy is live: not parked and not stopped
 * by its own word, with a process named on it (the launcher's) or its
 * own entry ready (a proof's copy, placed by nobody). */
export function saysLive(record: CopyRead): boolean {
  if (record.state === 'parked' || record.state === 'stopped' || record.park === true) return false;
  return record.process !== undefined || record.ready;
}

/** Whether a record says its copy serves now: ready, and live. */
export function saysServing(record: CopyRead): boolean {
  return record.ready && saysLive(record);
}

/** Whether a record's host was found gone by the plane: a word of the
 * controller's look on it, cleared once the host job there beats
 * again. */
export function hostFoundGone(record: CopyRead): boolean {
  return record.hostGoneAt !== undefined;
}

/** Whether a record's stop word stands for a copy running under an
 * attempt: a word that names an attempt stops that attempt alone, and
 * one that names none stops the copies running when it was said, so
 * one said before the record's own launch stops nobody. */
export function stopStandsFor(record: CopyRead, attempt: string | undefined): boolean {
  const { stop } = record;
  if (stop === undefined) return false;
  if (stop.attempt !== undefined) return stop.attempt === attempt;
  const launchedAt = record.process?.at;
  return !(stop.at !== undefined && launchedAt !== undefined && stop.at < launchedAt);
}

/** Whether a record tells its copy to leave: a drain, or a stop word
 * that stands for the attempt its process runs. Such a copy takes no
 * new call. */
export function saysLeave(record: CopyRead): boolean {
  return record.draining === true || stopStandsFor(record, record.process?.attempt);
}

/** The agent a record names: its entry's, else its launch's (a slot
 * before its copy's entry names the agent in its launch alone). */
export function agentOfCopy(record: CopyRead | undefined): string | undefined {
  return record?.agentId ?? record?.launch?.agentId;
}

/** The life a record names its copy under: its entry's, else its
 * launch's; nothing for a record that names none, which counts for the
 * life its agent's name stands under. */
export function lifeOfCopy(record: CopyRead): string | undefined {
  return record.life ?? record.launch?.life;
}
