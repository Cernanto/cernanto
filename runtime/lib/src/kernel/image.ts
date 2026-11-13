// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The copy's own image: the log bounded by the copy that writes it. A
// copy with a log counts the records past its last mark, and at the
// bound asks the host job on its own host to take its image: once the
// records reach the bound and the copy is idle, or reach the upper
// bound whatever the copy is doing. The host job pauses the process (the
// prepare of pause.ts, which writes the mark with the open state at a
// settled moment), dumps its tree with the process going on, puts the
// archive, names it on the copy's record with the mark's position, and
// answers the copy, which writes the done and truncates the log below
// the mark. A copy that never hears the answer does the same at its
// next resume, from what its record names. A record that names an image
// is never started afresh. Where no image can be taken (no CRIU, a
// laptop, an every-host copy, a plane that runs no host job), a task takes
// a logical mark at the bound once no body is active, and a job
// whenever the bound is reached (its bodies are live: nothing below the
// mark but acks and responses, all in the mark's open state); a worker
// and a service keep their log.

import { isDraining } from './admission.js';
import { ownEntryKey } from './copy-entry.js';
import { substrate } from './connection.js';
import { copyKey } from './substrate.js';
import { freshUUID } from './entropy.js';
import {
  JOURNAL_IMAGE_AFTER_ENTRIES,
  JOURNAL_IMAGE_FORCED_AT_ENTRIES,
  processFacts,
} from './facts.js';
import { fence } from './fence.js';
import { noteIdleChange, onIdleChange } from './idle-signal.js';
import { idleReport, largestJournalSince, noteMarkTaken } from './idle.js';
import { HOST_AGENT, wireRequest } from './transport.js';
import type { ServedUnit } from './units.js';
import { kernelSay } from '../traces/observe.js';

/** What a record says of a copy's image: the archive's name and the
 * position each of the copy's logs stood at when it was taken: the
 * mark's. */
interface ImageWord {
  image: string;
  journals: { subject: string; position: number }[];
}

/** The image a value spells, when it spells one. */
function imageWordOf(value: unknown): ImageWord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { image, journals } = value as { image?: unknown; journals?: unknown };
  if (typeof image !== 'string' || image === '' || !Array.isArray(journals)) return undefined;
  const named: ImageWord['journals'] = [];
  for (const entry of journals) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { subject, position } = entry as { subject?: unknown; position?: unknown };
    if (typeof subject === 'string' && subject !== '' && typeof position === 'number')
      named.push({ subject, position });
  }
  return { image, journals: named };
}

/** How long after a change of the books the bound is read. */
const SETTLE_MS = 100;

/** How long the copy waits before it asks again after an ask that
 * failed for a reason that may pass. */
const ASK_AGAIN_MS = 60_000;

let asking: string | undefined;
/** The host job's refusal, once it refused for this life: logical marks
 * from here. */
let refused: string | undefined;
let askAgainAt = 0;
/** The life the asks belong to: a life restored from an image lets
 * the first life's ask go, since the image holds it in flight and its
 * outcome, the host job's answer or the silence of the host the image was
 * taken on, is nobody's here. */
let life = new AbortController();
/** Looks at the bound again after a while: installed by the bound. */
let lookAgain: ((ms: number) => void) | undefined;

/** Forgets an ask in flight, for a life restored from an image: the
 * first life's ask is let go, and the bound reads afresh. */
export function resetImageAsking(): void {
  life.abort();
  life = new AbortController();
  asking = undefined;
  refused = undefined;
  askAgainAt = 0;
}

/** Asks again after a while: the moment is kept, and the bound looks
 * at the log again when it comes, whatever the copy did meanwhile. */
function askLater(): void {
  askAgainAt = Date.now() + ASK_AGAIN_MS;
  lookAgain?.(ASK_AGAIN_MS);
}

/** Installs the bound on a copy's log: at every change of the books
 * the records since the last mark are read, and at the bound the copy
 * asks its host job for its image, or takes a logical mark where no image
 * can be taken. Answers what ends the watching. */
export function installImageBound(unit: ServedUnit): () => void {
  const facts = processFacts();
  const port = facts.generationPort;
  const copy = facts.copy;
  const placed = ownEntryKey() !== undefined;
  const consider = (): void => {
    if (asking !== undefined || isDraining() || Date.now() < askAgainAt) return;
    const journal = unit.journal;
    if (journal === undefined) return;
    const since = journal.sinceMark();
    if (since < JOURNAL_IMAGE_AFTER_ENTRIES) return;
    const report = idleReport(unit);
    const atRest = report.inFlight === 0 && report.pendingWork === 0;
    if (!atRest && largestJournalSince(unit) < JOURNAL_IMAGE_FORCED_AT_ENTRIES) return;
    const kind = unit.definition.kind;
    const host = processFacts().holder?.host;
    const own = freshUUID();
    asking = own;
    const ask =
      refused === undefined &&
      placed &&
      kind !== 'job' &&
      host !== undefined &&
      port !== undefined &&
      copy !== undefined
        ? askImage(unit, host, port, copy)
        : logicalMark(unit);
    void ask.finally(() => {
      if (asking === own) asking = undefined;
    });
  };
  let look: ReturnType<typeof setTimeout> | undefined;
  const changed = (): void => {
    if (look !== undefined) return;
    look = setTimeout(() => {
      look = undefined;
      consider();
    }, SETTLE_MS);
    look.unref();
  };
  const end = onIdleChange(changed);
  let again: ReturnType<typeof setTimeout> | undefined;
  lookAgain = (ms) => {
    if (again !== undefined) clearTimeout(again);
    again = setTimeout(() => {
      again = undefined;
      consider();
    }, ms);
    again.unref();
  };
  return () => {
    end();
    lookAgain = undefined;
    if (look !== undefined) clearTimeout(look);
    if (again !== undefined) clearTimeout(again);
  };
}

/** A logical mark: the mark with the open state, the done without an
 * image, the log truncated below the mark. A task's only when no body
 * is active, a job's whenever asked; a worker's and a service's never. */
async function logicalMark(unit: ServedUnit): Promise<void> {
  const journal = unit.journal;
  if (journal === undefined) return;
  const kind = unit.definition.kind;
  if (kind === 'worker' || kind === 'service') return;
  if (kind === 'task' && journal.bodiesActive() > 0) return;
  try {
    // A task's mark is declined in the chain's own turn when a take
    // landed since the look above.
    const seq = await journal.mark({ unlessBodiesActive: kind === 'task' });
    await journal.done(seq, undefined);
    noteMarkTaken();
  } catch (error) {
    askLater();
    kernelSay(
      `the mark of ${unit.service} was not taken: ${error instanceof Error ? error.message : String(error)}; again later\n`,
    );
  }
}

/** Asks the host job on this host for the copy's image and writes the done
 * behind what it answers. A host job that cannot take an image refuses for
 * this life, and the copy takes logical marks where its type allows;
 * one that cannot now is asked again later. */
async function askImage(unit: ServedUnit, host: string, port: number, copy: number): Promise<void> {
  const { signal } = life;
  let reply;
  try {
    reply = await wireRequest({
      agentId: HOST_AGENT,
      handler: 'dump',
      args: { port, copy },
      callId: `c-${freshUUID()}`,
      host,
      signal,
    });
  } catch (error) {
    // An ask of the life before this one, let go at the restore: the
    // host it named is the one the image was taken on, not this copy's.
    if (signal.aborted) return;
    // No host job takes the call on this host now: a plane that runs none,
    // or one whose host job is gone; the copy takes a logical mark where it
    // can, and asks again in a while.
    askLater();
    kernelSay(
      `the image of ${unit.service} was not taken on ${host}: ${error instanceof Error ? error.message : String(error)}; asked again later\n`,
    );
    await logicalMark(unit);
    return;
  }
  if (signal.aborted) return;
  if ('error' in reply) {
    const { kind, message } = reply.error;
    if (kind === 'contract-violation' || message.includes('cannot take an image')) {
      refused = message;
      kernelSay(`the image of ${unit.service} is refused for this life: ${message}\n`);
      await logicalMark(unit);
      return;
    }
    askLater();
    kernelSay(`the image of ${unit.service} was not taken: ${message}; asked again later\n`);
    return;
  }
  const word = imageWordOf(reply.result);
  if (word === undefined) {
    kernelSay(`the dump of ${unit.service} answered no image: ${JSON.stringify(reply.result)}\n`);
    return;
  }
  await cutBehind(unit, word);
}

/** Writes the done behind the mark an image names and truncates the
 * log below it: the own log's mark alone, at the position the image
 * holds it at. A done already written is written no second time, and a
 * mark that is not the newest (an orphan of a dump that failed) is let
 * be: the next mark's truncation takes it. */
async function cutBehind(unit: ServedUnit, word: ImageWord): Promise<void> {
  const journal = unit.journal;
  if (journal === undefined) return;
  for (const { subject, position } of word.journals) {
    if (subject !== journal.log) continue;
    try {
      await journal.done(position, word.image);
      noteMarkTaken();
    } catch (error) {
      kernelSay(
        `the log ${subject} could not be truncated below ${String(position)}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  noteIdleChange();
}

/** Whether a copy's slot record stands, is not stopped and names an
 * image: the host job owes the copy a restore wherever its process is gone
 * (a crash, a move, a wake), and its log is taken over by nobody
 * meanwhile, since a takeover would answer in words what the image
 * continues and fence the restore. A stopped record is a copy that
 * left cleanly, brought back by nothing. */
export async function restoreOwed(generation: string, copy: number): Promise<boolean> {
  const port = Number(generation);
  if (!Number.isInteger(port) || !Number.isInteger(copy)) return false;
  const { records } = await substrate();
  const read = await records.read(copyKey(port, copy));
  if (read.value === null) return false;
  try {
    const record = JSON.parse(read.value) as { image?: unknown; state?: unknown };
    return record.state !== 'stopped' && imageWordOf(record.image) !== undefined;
  } catch {
    return false;
  }
}

/** The image the copy's own record names, when it names one. */
export async function recordedImage(): Promise<ImageWord | undefined> {
  const key = ownEntryKey();
  if (key === undefined) return undefined;
  const { records } = await substrate();
  const read = await records.read(key);
  if (read.value === null) return undefined;
  try {
    return imageWordOf((JSON.parse(read.value) as { image?: unknown }).image);
  } catch {
    return undefined;
  }
}

/** Writes the done behind the image the record names: the road of a
 * resume, idempotent, for a copy that never heard its host job's answer. */
export async function cutFromRecord(unit: ServedUnit): Promise<void> {
  const word = await recordedImage();
  if (word !== undefined) await cutBehind(unit, word);
}

/** A copy whose record names an image is restored from it, never
 * started afresh over the log truncated behind it: a process booting
 * over such a record fences itself, in words. */
export async function refuseStartOverImage(): Promise<void> {
  let word: ImageWord | undefined;
  try {
    word = await recordedImage();
  } catch {
    return;
  }
  if (word === undefined) return;
  fence(
    `the record names the image ${word.image}: a copy with an image is restored from it, never started afresh`,
  );
}
