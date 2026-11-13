// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The pause of a served process: two signals in, two words out in the
// process's control folder, and nothing of what pauses it. Asked to
// prepare, the process stops taking calls, lets every append settle,
// ships its traces, lets go of its substrate and of its watches, then
// writes the mark with the open state into its log and says what it
// holds (the mark's position, its idle verdict); asked to prepare
// again while prepared, it says the same again. Asked to resume, on
// this machine or on another it was brought to, it opens its substrate
// anew, reads its record and takes the identity it now runs under (the
// holder, the epoch, the attempt, the grant) with every reach still
// held, drains the randomness an image would repeat, owns its log anew
// under the grant when the life changed, takes in what the log gained,
// and only then releases the reaches, arms its due waits again from
// their moments, writes the done behind the image its record names,
// announces its listeners there, and takes calls again. A resume with
// nothing prepared is nothing. A process prepared and then neither
// imaged nor resumed within five minutes exits with its journal: the
// asker died, and the next start of the copy restores or replays. What
// happens to the process between the two words (an image, a restore
// elsewhere) is the business of whoever sends the signals; the kernel
// knows a pause.

import { freshBytes, refreshEntropy } from './entropy.js';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { processFacts, setProcessFacts } from './facts.js';
import { reseedLibraryRandom } from './globals.js';
import { idleReport } from './idle.js';
import type { IdleReport } from './idle.js';
import { askingAgain } from './lifetime.js';
import { closeListeners } from './listeners.js';
import type { Served } from './served.js';
import { cutFromRecord, resetImageAsking } from './image.js';
import { kernelSay } from '../traces/observe.js';

/** The signal that asks the process to prepare for a pause. */
const PREPARE_SIGNAL = 'SIGUSR2';
/** The signal that tells the process its pause is over: it goes on
 * where it was, or where it was brought. */
const RESUME_SIGNAL = 'SIGCONT';
/** The file the process writes once it is prepared: the journals it
 * holds, the position each stands at and its idle verdict. */
const PREPARED_FILE = 'prepared';
/** The word the block writes when it prepares a restore on a host: the
 * address this host's copies bind, which a tree restored from an image
 * taken elsewhere takes at its resume, before its call server opens
 * anew. */
export const ADDRESS_FILE = 'address';
/** The file the process writes once it resumed. */
const RESUMED_FILE = 'resumed';
/** The file a resuming process keeps its current step in. */
const RESUMING_FILE = 'resuming';
/** The word a checkpointer writes in the control folder to resume the
 * process: the road a checkpointer outside a sandbox takes, where a
 * signal rides a control socket that may not answer; the resume
 * signal stays the laptop's road. */
const RESUME_FILE = 'resume';
/** How often a prepared process looks for the resume word. */
const RESUME_LOOK_MS = 250;
/** The file the process writes when a prepare or a resume failed, with
 * the failure's words: the asker reads them instead of waiting. */
const FAILED_FILE = 'failed';
/** How long a prepared process waits for its image or its resume before
 * it exits with its journal. */
const PREPARED_PATIENCE_MS = 300_000;

/** What a prepared process says of itself. */
interface Prepared {
  at: number;
  journals: { subject: string; position: number }[];
  /** The verdict at the barrier: the intake closed, the acceptances in
   * flight settled. */
  idle: IdleReport;
}

/** What a resume found: the records the journals gained past the
 * pause, the due waits armed again, and how far each stood from its
 * moment in ms, past when negative. */
interface Resumed {
  records: number;
  waits: number;
  dueIn: number[];
}

/** What the runtime keeps beside the journal and lets go of for a
 * pause: a lane's server child, ended once the journals settled and
 * started again by the first call after the resume. */
interface PauseHooks {
  prepare(): Promise<void>;
  /** Takes back what the prepare let go of; the resume waits for it
   * before the process says it serves again. */
  resume(): Promise<void> | void;
}

const pauseHooks = new Set<PauseHooks>();

/** Has a prepare end what the hooks keep, and a resume let it start
 * again; answers what takes the hooks back. */
export function onPause(hooks: PauseHooks): () => void {
  pauseHooks.add(hooks);
  return () => {
    pauseHooks.delete(hooks);
  };
}

let underWay: Promise<unknown> = Promise.resolve();
/** The served process the pause is installed on. */
let installed: Served | undefined;
/** What the resume word runs, set by the pause's installer. */
let resumeOnWord: (() => void) | undefined;
/** Whether a prepare began and no resume ended it yet. */
let prepared = false;
/** What the standing prepare answered: a second prepare while prepared
 * says the same again and prepares nothing twice. */
let lastPrepared: Prepared | undefined;
/** Whether the kernel's watches were let go by a prepare and not yet
 * taken back. */
let watchesReleased = false;

/** What keeps the process alive while it is prepared: with its
 * substrate let go and its lanes stopped, nothing else holds Node's
 * loop, and a process whose loop empties exits, paused or not. The
 * timer that holds it is the patience too, counted in ticks of running
 * time rather than one span: a process restored from its image hours
 * after its prepare finds its clocks moved past any span, and the
 * patience it has left is what the image holds of the count. */
let holding: ReturnType<typeof setInterval> | undefined;
/** The look for the resume word while the process is prepared. */
let resumeLook: ReturnType<typeof setInterval> | undefined;

function watchResumeWord(served: Served, onWord: () => void): void {
  const path = wordFile(served, RESUME_FILE);
  if (path === undefined || resumeLook !== undefined) return;
  resumeLook = setInterval(() => {
    if (!existsSync(path)) return;
    forget(path);
    onWord();
  }, RESUME_LOOK_MS);
  resumeLook.unref();
}

function endResumeWatch(): void {
  if (resumeLook !== undefined) clearInterval(resumeLook);
  resumeLook = undefined;
}

/** One tick of the prepared patience. */
const PATIENCE_TICK_MS = 10_000;
let patienceTicks = 0;

function holdLoop(patienceMs: number): void {
  if (holding !== undefined) return;
  patienceTicks = 0;
  holding = setInterval(() => {
    patienceTicks += 1;
    if (patienceTicks * PATIENCE_TICK_MS < patienceMs) return;
    kernelSay(
      `prepared for ${String(Math.round(patienceMs / 60_000))} minutes with no image and no resume; the process exits with its journal\n`,
    );
    process.exit(3);
  }, PATIENCE_TICK_MS);
}

function releaseLoop(): void {
  if (holding !== undefined) clearInterval(holding);
  holding = undefined;
  endResumeWatch();
}

/** Runs one step after the one before it: a prepare and a resume that
 * cross never interleave. */
function next<T>(step: () => Promise<T>): Promise<T> {
  const run = underWay.then(step, step);
  underWay = run.catch(() => undefined);
  return run;
}

/** The file of one of the copy's words: the copies of a generation
 * share the generation's control folder, so a copy numbered above
 * zero suffixes its words with its number (`prepared-c1`), as its
 * error stream is named, and no copy reads another's. */
function wordFile(served: Served, name: string): string | undefined {
  if (served.controlDir === undefined) return undefined;
  const copy = processFacts().copy ?? 0;
  return join(served.controlDir, copy > 0 ? `${name}-c${String(copy)}` : name);
}

function forget(path: string | undefined): void {
  if (path !== undefined) rmSync(path, { force: true });
}

/** Writes a word whole: the file appears with its text, never empty
 * under a reader's eyes. */
function sayWord(path: string | undefined, text: string): void {
  if (path === undefined) return;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

/** Takes randomness of its own for a new life of the process: an
 * image carries OpenSSL's generator state whole, so node:crypto would
 * draw for two lives alike; the kernel's keyed draws take a fresh key
 * from the system's entropy device, and the library road of the
 * wrapped `Math.random` is seeded from it. The agent's own draws are
 * journaled and replay by design. */
export function drainRandomness(): void {
  refreshEntropy();
  reseedLibraryRandom(freshBytes(16));
}

/** Prepares the process for a pause and answers what it holds. A
 * process already prepared answers the same again, its word said anew,
 * and lets go of nothing twice: a second signal while the first
 * prepare's appends still wait behind the held substrate would
 * otherwise hold the resume for good. The verdict it carries is read at
 * the barrier: the intake closed, every append settled, so an idle
 * report here counts no acceptance in flight. */
export function prepare(
  served: Served,
  patienceMs: number = PREPARED_PATIENCE_MS,
): Promise<Prepared> {
  return next(async () => {
    if (prepared && lastPrepared !== undefined) {
      sayWord(wordFile(served, PREPARED_FILE), `${JSON.stringify(lastPrepared)}\n`);
      return lastPrepared;
    }
    prepared = true;
    // The loop is held from the first step: a process whose intake and
    // reply server are closed has nothing else to keep it alive, and
    // would exit before its word is written.
    holdLoop(patienceMs);
    served.unit.setServing(false);
    // The program need not go quiet: a run that draws and waits every
    // few milliseconds on a store that lands an append in as many never
    // does. Its next appends wait behind each journal's gate from here,
    // and the ones at the store land, so the positions said below are
    // exact and nothing is in flight when the substrate is let go; the
    // resume opens the gates.
    const journals = served.unit.openJournals();
    for (const journal of journals) journal.holdWrites();
    await Promise.all(journals.map((journal) => journal.quiet()));
    // The mark: the open state of the copy's own log at this settled
    // moment, written through the gate before the substrate is let go.
    const own = served.unit.journal;
    const mark = own === undefined ? undefined : await own.mark();
    // The traces leave while their answers can still arrive: what the
    // runtime keeps beside the journal (the reply server among it, a
    // child's sockets to the world, which would not come back) ends
    // after them, before the image is taken.
    await served.flushTraces().catch(() => undefined);
    for (const hooks of pauseHooks) await hooks.prepare().catch(() => undefined);
    const idle = idleReport(served.unit);
    await served.suspendSubstrate();
    served.releaseWatches();
    watchesReleased = true;
    const answer: Prepared = {
      at: Date.now(),
      journals:
        own === undefined || mark === undefined ? [] : [{ subject: own.log, position: mark }],
      idle,
    };
    forget(wordFile(served, RESUMED_FILE));
    forget(wordFile(served, RESUME_FILE));
    lastPrepared = answer;
    sayWord(wordFile(served, PREPARED_FILE), `${JSON.stringify(answer)}\n`);
    if (resumeOnWord !== undefined) watchResumeWord(served, resumeOnWord);
    return answer;
  });
}

/** The identity a resumed process takes from its record: its own
 * attempt when the record still carries it (the original process after
 * an image that left it running), the reserved one when the record's
 * `restores` names its own (the handover to a restored tree), and
 * nothing else: a record that moved on fences the process. */
function resumedAttempt(
  own: string | undefined,
  record:
    | { attempt?: string | undefined; restores?: string | undefined; launch?: number | undefined }
    | undefined,
): { attempt: string | undefined; launch?: number | undefined } | { fenced: string } {
  if (own === undefined || record?.attempt === undefined || record.attempt === own)
    return { attempt: own, ...(record?.launch === undefined ? {} : { launch: record.launch }) };
  if (record.restores === own) return { attempt: record.attempt, launch: record.launch };
  return {
    fenced: `the record runs the attempt ${record.attempt} now, not this copy's ${own}`,
  };
}

/** Reads the holding and installs the identity it names, every reach
 * still held; a record that moved on ends the process. */
async function takeIdentity(served: Served): Promise<void> {
  const holding = await askingAgain(`the holding of ${served.unit.service}`, () =>
    served.holding(),
  );
  const taken = resumedAttempt(processFacts().attempt, holding?.process);
  if ('fenced' in taken) {
    closeListeners();
    kernelSay(`fenced: ${taken.fenced}; the process exits\n`);
    process.exit(2);
  }
  served.identityChanged(holding?.holder, taken.attempt, taken.launch ?? processFacts().launch);
}

/** Takes the address the block said for this host, when it said one:
 * the facts name it before the call server opens anew, and the word
 * leaves, read once. */
function takeAddress(served: Served): void {
  const path = wordFile(served, ADDRESS_FILE);
  if (path === undefined || !existsSync(path)) return;
  const address = readFileSync(path, 'utf8').trim();
  forget(path);
  if (address !== '') setProcessFacts({ ...processFacts(), callAddress: address });
}

/** Resumes the process after a pause, or after a prepare that failed
 * partway: whatever the prepare let go of is taken back, and the
 * process serves again. With nothing prepared, nothing is done and no
 * word is written. */
export function resume(served: Served): Promise<Resumed> {
  return next(async () => {
    const nothing: Resumed = { records: 0, waits: 0, dueIn: [] };
    if (!prepared) return nothing;
    forget(wordFile(served, PREPARED_FILE));
    // A resume is rare and its steps reach the world: each is said as
    // it starts, in the control folder (the process's own stderr is
    // the trace capture's), so a resume that stalls says where.
    const began = Date.now();
    const step = (what: string): void => {
      sayWord(wordFile(served, RESUMING_FILE), `${what} (${String(Date.now() - began)} ms)\n`);
    };
    let records = 0;
    let waits = 0;
    let dueIn: number[] = [];
    // Two lives of one image would draw the same randomness: what the
    // image holds of it is dropped before anything draws.
    drainRandomness();
    const attemptBefore = processFacts().attempt;
    if (served.substrateSuspended()) {
      step('the substrate reopened and the identity taken');
      // The kernel reads where and as whom the process came back before
      // anything of the process writes again: the holder facts are the
      // record's now, and the attempt its record names. A refusal the
      // substrate may take back is asked again.
      const handles = await served.reopenSubstrate();
      await takeIdentity(served);
      takeAddress(served);
      // A life restored from an image inherits an ask the first life
      // made and heard the answer to, which is nobody's here, and the
      // first life's opening of each journal, which the attempt in the
      // writer's mark already tells from this life's; both are made anew
      // before any write. The same life resuming after its own dump
      // keeps its ask, still on its way to the host job, and makes nothing
      // anew.
      const attemptChanged = processFacts().attempt !== attemptBefore;
      if (attemptChanged) resetImageAsking();
      step('the log owned anew and its tail taken in');
      // Behind the barrier: the own log owned under the new grant when
      // the life changed, the rows gained past the freeze taken in,
      // before any reach is released.
      records = await askingAgain(`the resuming of ${served.unit.service}`, () =>
        served.resumeJournals(handles, attemptChanged),
      );
      served.releaseSubstrate();
    } else {
      step('the identity taken');
      await takeIdentity(served);
      takeAddress(served);
    }
    // The gates the prepare raised open: the appends that waited land
    // now, in their order.
    for (const journal of served.unit.openJournals()) journal.releaseWrites();
    // The done is written behind the image the record names: a copy
    // that never heard its host job's answer writes it here, and one that
    // did writes nothing more.
    step('the done written behind the image');
    await cutFromRecord(served.unit).catch((error: unknown) => {
      kernelSay(
        `the journals were not cut behind the image: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
    const now = Date.now();
    dueIn = served.dueWaitMoments().map((due) => due - now);
    waits = served.rearmDueWaits();
    // The requests the log took and never answered are met again: a
    // service's program takes its own back from its log's tail.
    step('the waits armed and the unfinished requests met');
    if (served.unit.program === undefined) await served.resumeUnfinished().catch(() => undefined);
    step('the listeners announced');
    await askingAgain(`the listeners of ${served.unit.service}`, () => served.announceListeners());
    releaseLoop();
    // What the prepare let go of comes back before the copy says it
    // serves: the call server among it, bound anew at this host's
    // address, so a ready copy is one a call reaches.
    for (const hooks of pauseHooks) await hooks.resume();
    served.unit.setServing(true);
    if (watchesReleased) {
      served.reopenWatches();
      watchesReleased = false;
    }
    step('the watches reopened and the copy ready');
    served.markReady();
    prepared = false;
    const answer: Resumed = { records, waits, dueIn };
    forget(wordFile(served, RESUMING_FILE));
    sayWord(wordFile(served, RESUMED_FILE), `${JSON.stringify(answer)}\n`);
    return answer;
  });
}

/** Listens for the two words as signals; answers what stops listening. */
export function installPause(served: Served): () => void {
  installed = served;
  // A failure is said in the control folder: the process's own stderr
  // is the trace capture's, which a prepared process cannot ship.
  const failed = (step: string, error: unknown): void => {
    const words = `${step}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    kernelSay(`${words}\n`);
    try {
      sayWord(wordFile(served, FAILED_FILE), `${words}\n`);
    } catch {
      // The folder is gone with the process.
    }
  };
  const onPrepare = (): void => {
    forget(wordFile(served, FAILED_FILE));
    void prepare(served).catch((error: unknown) => {
      failed(`preparing a pause of ${served.unit.service}`, error);
    });
  };
  const onResume = (): void => {
    forget(wordFile(served, FAILED_FILE));
    void resume(served).catch((error: unknown) => {
      failed(`resuming ${served.unit.service} after a pause`, error);
    });
  };
  process.on(PREPARE_SIGNAL, onPrepare);
  process.on(RESUME_SIGNAL, onResume);
  resumeOnWord = onResume;
  return () => {
    process.off(PREPARE_SIGNAL, onPrepare);
    process.off(RESUME_SIGNAL, onResume);
    endResumeWatch();
    if (resumeOnWord === onResume) resumeOnWord = undefined;
    if (installed === served) installed = undefined;
  };
}
