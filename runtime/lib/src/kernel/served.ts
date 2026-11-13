// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What a served process is to its pause (pause.ts): the unit it
// serves, and the few things only the kernel can do to let go of the
// world and take it back; and what it says of itself to the host job
// that parks it: the idle report and the journal's count since the
// last image (idle.ts), written into its idle file.

import type { HolderFacts } from './facts.js';
import type { Holding } from './plane.js';
import type { Substrate } from './substrate.js';
import type { ServedUnit } from './units.js';

export {
  idleReport,
  idleFileName,
  installIdleFile,
  journalBytesSince,
  journalSince,
  IDLE_FILE,
} from './idle.js';
export type { IdleReport } from './idle.js';

/** The served process, as its pause sees it. */
export interface Served {
  /** The unit this process serves: its inbox, and the journals in flight. */
  unit: ServedUnit;
  /** The folder the process boots from; none for a process without one. */
  workingDir?: string;
  /** The folder under it where the pause's words go. */
  controlDir?: string;
  /** Which copy of its generation this process runs as; none for the
   * first or only copy. */
  copy?: number;
  /** The copy's holding now: its record with the holder facts and the
   * process it names, read anew after a pause, since the process may
   * have come back under another attempt; none on a plane that placed
   * it nowhere. */
  holding(): Promise<Holding | undefined>;
  /** Ships the traces queued so far. */
  flushTraces(): Promise<void>;
  /** Lets go of the kernel's watches: a paused process holds no watch. */
  releaseWatches(): void;
  /** Takes the watches back once the process goes on. */
  reopenWatches(): void;
  /** Brings back the calls this copy took and did not finish, on the
   * task road; a service's program takes its own back from its journal. */
  resumeUnfinished(): Promise<void>;
  /** Lets go of the substrate, what was handed to it flushed first;
   * every reach of the substrate waits until it is back. */
  suspendSubstrate(): Promise<void>;
  /** Opens the substrate anew and hands it to the resume alone; every
   * other reach stays held until `releaseSubstrate`, so nothing of the
   * process writes against what it does not know, or under an identity
   * it no longer has. */
  reopenSubstrate(): Promise<Substrate>;
  /** The journals of a resume, run with every reach held and the
   * identity installed: the own log owned anew under the new grant
   * when the life changed, its tail taken in; a taken log let go
   * under a new life. Answers how many records came in. */
  resumeJournals(handles: Substrate, attemptChanged: boolean): Promise<number>;
  /** Lets every held reach go on, the substrate open and the identity
   * installed. */
  releaseSubstrate(): void;
  /** Says the process serves again where whoever runs it reads it. */
  markReady(): void;
  /** Whether the process holds its reaches. */
  substrateSuspended(): boolean;
  /** The wall moments the kernel's waits are due at. */
  dueWaitMoments(): number[];
  /** Arms every wait again from the wall clock: what is due fires now,
   * the rest wait their remainder. Answers how many waits there were. */
  rearmDueWaits(): number;
  /** Announces the process's listeners again where it now runs: a
   * restored process runs no `listen` again, so the listeners are said
   * anew. */
  announceListeners(): Promise<void>;
  /** Installs the identity the process now runs under: the holder facts
   * of its record, at its epoch, the attempt its record names and the
   * grant issued for it, so every record from here is this holder's and
   * no other's. Called with every reach still held. */
  identityChanged(
    holder: HolderFacts | undefined,
    attempt: string | undefined,
    launch: number | undefined,
  ): void;
}
