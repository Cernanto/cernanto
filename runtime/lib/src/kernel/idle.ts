// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The idle report: what the kernel's books say of the copy, for the
// host job that parks it. Every call a copy serves is a handler the
// kernel started and has not seen return, and a handler is in one of
// two states the kernel tells apart: running (computing, or waiting on
// the agent's own memory, or on a lane operation to the world), or
// parked on a journaled wait (the response of a request to another
// agent, a timer with its due moment in the log). Idle is: every
// handler in flight is parked on a journaled wait, no lane operation is
// open, and no wait is due within the hold. The report is written into
// the copy's idle file, `work/agent/idle.json` under the generation's
// folder, where the host job reads it (`idle-c<n>.json` for the copy
// numbered n above zero), on every change of the books, coalesced to a
// few writes a second; beside it the log's count of records since the
// last mark and of bytes since, the bound's two units.
//
// The report also tells what the copy uses, as its own process counts
// it with Node's own counters, the same on every system: its memory,
// the processor time it used so far, and the rate it used it at over
// its last look. Nobody reads these off the machine's process table: a
// copy measures itself, and what it started (a command, a server of
// its own) is in no count. A copy at work looks at its counters again
// every ten seconds and writes the report; once a look finds it used
// no processor time the copy is at rest, and writes nothing until its
// books change.

import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { admissionState } from './admission.js';
import { wallElapsedMs } from './clock.js';
import { libraryTimersDue } from './globals.js';
import { onIdleChange } from './idle-signal.js';
import { journalAppendBytes, journalAppends } from './journal.js';
import { dueWaitMoments } from './lifetime.js';
import type { ServedUnit } from './units.js';
import {
  JOURNAL_IMAGE_AFTER_ENTRIES,
  JOURNAL_IMAGE_FORCED_AT_ENTRIES,
  processFacts,
} from './facts.js';

/** The copy's idle report. */
export interface IdleReport {
  /** Whether the copy may be parked now. */
  idle: boolean;
  /** The handlers running, the lane operations open and the library
   * timers due within the hold: what keeps the copy up. */
  pendingWork: number;
  /** The journaled waits the handlers in flight are parked on. */
  journaledWaits: number;
  /** The earliest wall moment a journaled wait is due at, or null. */
  nextDue: number | null;
  /** The process's own counters: the processor time it used so far,
   * the rate it used it at over its last look, in thousandths of one
   * processor (zero before the first look and at rest), and its
   * memory in mebibytes. */
  cpu: { userMs: number; systemMs: number };
  cpuMillicores: number;
  rssMi: number;
  /** The handlers in flight. */
  inFlight: number;
  /** The records since the last mark. */
  journalSince: number;
  /** The bytes appended since the last mark. */
  journalBytesSince: number;
  /** Whether the log passed the bound since the last mark: the copy
   * asks for its image once it is idle. */
  imageDue: boolean;
  /** Whether the log passed the upper bound: the copy asks for its
   * image whatever it is doing. */
  imageForced: boolean;
  at: number;
}

/** The file the report is written to, under the working folder. */
export const IDLE_FILE = 'idle.json';

/** The idle file's name for a copy: the first copy's is `idle.json`,
 * the copy numbered n above zero writes `idle-c<n>.json`. */
export function idleFileName(copy: number | undefined): string {
  return copy === undefined || copy === 0 ? IDLE_FILE : `idle-c${String(copy)}.json`;
}

/** A wait nearer than this keeps the copy up rather than park it and
 * wake it: the park's hold. */
const HOLD_FOR_DUE_MS = 5_000;

/** How long the writer waits after a change before it writes, so a
 * burst of changes is one write. */
const WRITE_COALESCE_MS = 100;

/** How long a copy at work waits between two looks at its own
 * processor time. */
export const LOOK_AFTER_MS = 10_000;

/** The rate this process used its processor time at over its last
 * look, in thousandths of one processor. */
let cpuMillicores = 0;

/** The processor time this process used so far, in milliseconds. */
function ownCpuMs(): number {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

/** The appends and the bytes at the last mark: what the counts without
 * a unit read from. */
let appendsAtMark = 0;
let appendsBytesAtMark = 0;

/** Notes a mark taken: the counts start anew. */
export function noteMarkTaken(): void {
  appendsAtMark = journalAppends();
  appendsBytesAtMark = journalAppendBytes();
}

/** The records since the last mark of the copy's own log, or the live
 * appends alone without the unit. */
export function journalSince(unit?: ServedUnit): number {
  if (unit === undefined) return Math.max(0, journalAppends() - appendsAtMark);
  return unit.journal?.sinceMark() ?? 0;
}

/** The largest single log's records since its mark: the own log's, or
 * a taken one's. */
export function largestJournalSince(unit: ServedUnit): number {
  let largest = 0;
  for (const journal of unit.openJournals()) largest = Math.max(largest, journal.sinceMark());
  return largest;
}

/** The bytes past the last mark: the live appends alone. */
export function journalBytesSince(): number {
  return Math.max(0, journalAppendBytes() - appendsBytesAtMark);
}

/** The report, from the unit's books. */
export function idleReport(unit: ServedUnit): IdleReport {
  const now = Date.now();
  const { inFlight } = admissionState();
  let pendingWork = 0;
  let journaledWaits = 0;
  let parked = 0;
  for (const journal of unit.openJournals()) {
    for (const lane of journal.pendingByLane().values()) {
      journaledWaits += lane.waits;
      pendingWork += lane.work;
      if (lane.waits > 0 && lane.work === 0) parked += 1;
    }
  }
  pendingWork += Math.max(0, inFlight - parked);
  const dues = dueWaitMoments();
  const nextDue = dues.length === 0 ? null : Math.min(...dues);
  // A library timer is due by this process's own count of time that
  // passed; a journaled wait at the wall clock's moment its log keeps.
  const passed = wallElapsedMs();
  pendingWork += libraryTimersDue().filter((due) => due - passed <= HOLD_FOR_DUE_MS).length;
  const dueSoon = nextDue !== null && nextDue - now <= HOLD_FOR_DUE_MS;
  const usage = process.cpuUsage();
  const since = journalSince(unit);
  return {
    idle: pendingWork === 0 && !dueSoon,
    pendingWork,
    journaledWaits,
    nextDue,
    cpu: { userMs: Math.round(usage.user / 1000), systemMs: Math.round(usage.system / 1000) },
    cpuMillicores,
    rssMi: Math.round(process.memoryUsage.rss() / (1024 * 1024)),
    inFlight,
    journalSince: since,
    journalBytesSince: journalBytesSince(),
    imageDue: since >= JOURNAL_IMAGE_AFTER_ENTRIES,
    imageForced: largestJournalSince(unit) >= JOURNAL_IMAGE_FORCED_AT_ENTRIES,
    at: now,
  };
}

/** Writes the report into the generation's agent folder (`work/agent`
 * under the working folder) on every change of the books, coalesced,
 * and at every look of a copy at work; answers what ends the writing.
 * The folder is the materialize's and is never made here. A process
 * without a working folder writes none. The time between two looks is
 * read off the monotonic clock (`elapsed`, the runtime's own when none
 * is handed), never off the wall clock, which a correction moves: a
 * rate is processor time over time that passed. */
export function installIdleFile(
  unit: ServedUnit,
  workingDir: string | undefined,
  elapsed: () => number = wallElapsedMs,
): () => void {
  if (workingDir === undefined) return () => undefined;
  const file = join(workingDir, 'work', 'agent', idleFileName(processFacts().copy));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let look: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  const write = (): void => {
    if (ended) return;
    try {
      const staged = `${file}.tmp`;
      writeFileSync(staged, `${JSON.stringify(idleReport(unit))}\n`);
      renameSync(staged, file);
    } catch {
      // The folder is gone with the generation.
    }
  };
  // A change of the books starts the looks; each look tells the rate
  // since the one before, and the looks go on while the process uses
  // processor time. A look that finds none is the last: its report
  // says zero, and the copy sets no timer while it rests.
  const watch = (): void => {
    if (look !== undefined || ended) return;
    const from = { cpuMs: ownCpuMs(), at: elapsed() };
    look = setTimeout(() => {
      look = undefined;
      if (ended) return;
      // A process brought back from an image counts its processor time
      // from zero again, and a stretch in which no time passed is none
      // to divide by: neither is a rate.
      const elapsedMs = elapsed() - from.at;
      const usedMs = ownCpuMs() - from.cpuMs;
      cpuMillicores = elapsedMs <= 0 || usedMs <= 0 ? 0 : Math.round((usedMs / elapsedMs) * 1000);
      write();
      if (cpuMillicores > 0) watch();
    }, LOOK_AFTER_MS);
    look.unref();
  };
  const changed = (): void => {
    if (ended) return;
    watch();
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      write();
    }, WRITE_COALESCE_MS);
    timer.unref();
  };
  const end = onIdleChange(changed);
  changed();
  return () => {
    ended = true;
    end();
    if (timer !== undefined) clearTimeout(timer);
    if (look !== undefined) clearTimeout(look);
  };
}
