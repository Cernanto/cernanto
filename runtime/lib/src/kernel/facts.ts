// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What a process knows about itself, and the rules it runs under. A
// process's facts are handed to it once, before any agent module loads,
// by whoever boots it (the block reads them off the copy's record on
// the plane; a proof hands the world it builds its own), and a rule is
// a constant here.

import { freshUUID } from './entropy.js';

import type { SubstrateName } from './substrate.js';

/**
 * The seam: the agents the runtime reaches by a standard contract call.
 * The plane's is `DEFAULT_SEAM`, the runtime's own constant; a proof
 * may hand another.
 */
export interface SeamFacts {
  /** The custody agent a lane module asks for its credentials. */
  custody: { agent: string };
}

/** The facts of the process this runtime runs in: its identity and
 * its reach, read wherever the runtime needs them. How a process
 * serves (its sinks, its working folder) is the serve call's
 * own options. */
export interface ProcessFacts {
  /** The substrate implementor this process speaks: the laptop's files
   * and SQLite, or the cloud's stores. Absent in a process the plane
   * does not run (a test, a tool), where a call outside any call
   * is refused in words. */
  substrate?: SubstrateName | undefined;
  /** The root of the plane's files, the files substrate's: the journals,
   * the objects and the database live under it. */
  root?: string | undefined;
  /** The plane around the process when it runs on the cloud's store:
   * the DynamoDB table, the S3 bucket and the region. */
  plane?:
    | {
        table?: string | undefined;
        bucket?: string | undefined;
        region?: string | undefined;
      }
    | undefined;
  /** The place of the plane as the block was handed it, until the block
   * hands the facts above: a `file:` url names the root of the files
   * substrate. */
  substrateUrl?: string | undefined;
  /** The one agent this process serves: the identity of a call made
   * outside any call. */
  agentId?: string | undefined;
  /** The call this process's whole life belongs to, when it has one: a
   * tester's suite runs in a child whose calls outside any call
   * carry the tester's run as their caller and record their boundary
   * under it. Absent in a served process. */
  callId?: string | undefined;
  /** The id this process calls out as when it is not its own: a test
   * form serves under a compile's own id and calls its dependencies as
   * the agent it is the form of, so a callee that judges by the
   * caller's id (the store's key families) serves it as it serves the
   * agent. */
  callsAs?: string | undefined;
  /** The form this process is materialized in, when it is one of the
   * two verification forms: `test`, the agent under test; `tester`,
   * its tests as a task. Absent in every other process. */
  form?: 'test' | 'tester' | undefined;
  /** The pair's other id, as the launch names it: a tester's the test
   * form it calls (a module's test form is linked into the tester
   * under this id), a test form's the agent it stands for. */
  testOf?: string | undefined;
  /** The agent a verification form stands for, by its canonical id: a
   * test form's own, a tester's target. Stated on every call the form
   * makes beside the caller's id, so a callee that keeps a place per
   * agent (the config agent) reads the target's place for the test
   * form and `<target>/tests` for the tester, with no rule over a
   * minted id's shape. Absent in every other process. */
  target?: string | undefined;
  /** The interfaces this agent implements, each by its id and the
   * contract hash its compile stamped: a call bound through an
   * interface is answered only when it is among them at the caller's
   * hash. Absent in a process the block did not start, which checks
   * nothing. */
  implements?: readonly { id: string; contractSha: string }[] | undefined;
  /** The generation's package digest, `sha256:<hex>`: the process's own
   * artifact as the fleet names it; absent in a process the plane does
   * not run. */
  artifact?: string | undefined;
  /** The modules this process composes, each id to the package digest
   * it links; absent when it composes none. */
  composition?: Record<string, string> | undefined;
  /** The generation's own identity: the plane-wide port every journal,
   * service program and worker run of it is keyed by. */
  generationPort?: number | undefined;
  /** The handler calls held in flight at once; absent or zero
   * is unbounded. */
  slots?: number | undefined;
  /** This process among the copies of its generation: the number the
   * plane gave it and gives it again when it comes back. A journal is
   * owned by the copy that accepted its call, and only that copy
   * resumes it. Absent in a process the plane does not run. */
  copy?: number | undefined;
  /** How long a lane's request to the outside world may take before it
   * is given up: the rule's two minutes, or a proof's own short one. */
  requestTimeoutMs?: number | undefined;
  /** Who holds this copy: the host its record names, the epoch of the
   * record, the record's key and the lease's length. Absent in a
   * process the plane does not run. */
  holder?: HolderFacts | undefined;
  /** The host this copy runs on, for its host's stop word: the holder's
   * host when a record stands, the machine's own name for a copy that
   * boots without one. */
  host?: string | undefined;
  /** The address the copy's call server binds, the direct road's entry:
   * the loopback on a laptop, the host's private address on a server.
   * The loopback when unnamed. */
  callAddress?: string | undefined;
  /** The plane's range of call ports (`hosts.callPorts`), the copy's
   * server bound to the lowest free one: 20000 to 20999 when unnamed. */
  callPorts?: { from: number; to: number } | undefined;
  /** The plane's token every direct request carries and every call
   * server asks for, when the plane has one. */
  callToken?: string | undefined;
  /** The attempt this copy was launched under: the nonce the launcher
   * wrote on the copy's record before it started the copy and handed
   * it on its command line. A copy whose record names another attempt
   * is not the record's copy any more and leaves. Absent in a copy the
   * plane placed nowhere (a package run on its own). */
  attempt?: string | undefined;
  /** The grant the launcher issued from the copy's log before it
   * started the copy: the ownership of the log is taken by it. Absent
   * in a process nobody issued one for, which issues its own at boot. */
  launch?: number | undefined;
  /** The life of the agent this process serves: its journal and its
   * traces are kept under it. Named by the generation's launch; a
   * process whose launch names none asks the name's record for it at
   * boot. */
  life?: string | undefined;
  /** The lives of the modules this process composes, each id to its
   * life: a linked call's totals and listing are kept under the
   * module's. Asked at boot for a module the launch names none for. */
  lives?: Record<string, string> | undefined;
  /** The release's own agents, the ids of the release's packages: a
   * call made by one of them passes on the agent it was called to
   * charge, and a linked call of one of them is left out of the traces.
   * Handed by the block at every launch. */
  releaseAgents?: readonly string[] | undefined;
  /** How long a stored trace stands (the trace agent's setting
   * `cernanto/trace/retention-minutes`), read once at boot. */
  traceRetentionMs?: number | undefined;
}

/** The holder of a copy, as its record says: every write of the copy
 * carries the epoch, and a write under an older epoch is refused. */
export interface HolderFacts {
  host: string;
  /** The epoch of the copy's record: one for a fresh record and one
   * more at every claim, so a record with a higher epoch is a newer
   * holder's. */
  epoch: number;
  /** The record's key: `<generation>/<copy>`. */
  slot: string;
  leaseMs: number;
  /** Whether this copy is the host job itself. */
  beats?: boolean | undefined;
}

/** The plane's seam: the agents the runtime reaches, the same on every
 * plane. */
export const DEFAULT_SEAM: SeamFacts = {
  custody: { agent: 'cernanto/auth' },
};

// The record is the process's, kept on the global object under a
// registered symbol rather than in this module's own scope: a process
// may load the library twice (a tester's fresh copy of its tests
// resolving the runtime through another path), and every instance
// must read the one record.
const SLOT = Symbol.for('cernanto.process-facts');
const slot = globalThis as { [SLOT]?: ProcessFacts };

/** Hands the process its facts, whole: the block before any agent
 * module loads, a proof before it serves. */
export function setProcessFacts(next: ProcessFacts): void {
  slot[SLOT] = { ...next };
  // The identity follows the facts: a process that spoke the plane
  // before it was handed its copy (the block's ask of the materialize)
  // took a random one, and the copy's own is what its claims are owned
  // by across its lives.
  processIdentityValue = undefined;
}

/** The facts as handed; empty in a process nobody handed any. */
export function processFacts(): Readonly<ProcessFacts> {
  return slot[SLOT] ?? {};
}

// The rules: the runtime's own constants.

/** The lease on a copy's record: the lapse past which a copy that
 * stopped renewing is taken for gone. */
export const LEASE_MS = 30_000;

/** How long the closers of a draining process get after the drain
 * budget (the trace sinks' last send, the substrate let go): a
 * program that outlives the drain must not hold the process open until
 * the plane kills it. */
export const CLOSE_MS = 5_000;

/** How long a control ask waits for its answer. */
export const CONTROL_WAIT_MS = 10_000;

/** The code a worker's process leaves with when a signal's drain cut
 * its run, the one a process ended by SIGTERM carries: the run is not
 * over, its journal waits for the generation's next process, and a
 * plane that reads the code starts that process. */
export const RUN_CUT_EXIT = 143;

/** How long a closing call waits for its body and its cleanups
 * before its process retires: an owner that cannot let go is a wedged
 * handler, and the retirement is the way out. */
export const LIFETIME_CLOSE_MS = 25_000;

/** How long a child process a call spawned may take to end
 * after SIGTERM before SIGKILL. */
export const CHILD_GRACE_MS = 5_000;

/** The most a recorded answer or draw may weigh: a value past this is
 * paged or stored elsewhere and referred to. */
export const RECORD_BYTES_CAP = 8 * 1024 * 1024;

/** How many attempts a call's retryable failures may burn
 * before the failure turns terminal: the bounded-retry guard for a
 * pathologically flaky side effect. */
export const STEP_MAX_ATTEMPTS = 50;

/** The journal bound: the entries since the last image past which the
 * copy takes its image once it is idle. */
export const JOURNAL_IMAGE_AFTER_ENTRIES = 100;

/** The journal's upper bound: the entries since the last image past
 * which the copy takes its image whatever it is doing, at the next
 * settled moment. */
export const JOURNAL_IMAGE_FORCED_AT_ENTRIES = 500;

/** This process among the copies of its generation: the copy number the
 * plane gave it and gives it again when it comes back (the facts'
 * `copy`), so a journal's owner is told by name and a copy resumes
 * only its own; a process the plane runs without a copy or a process
 * outside the plane takes a random identity and is its generation's
 * only process. Read when first needed: the facts are set after this
 * module loads. */
let processIdentityValue: string | undefined;
export function processIdentity(): string {
  if (processIdentityValue === undefined) {
    const copy = processFacts().copy;
    processIdentityValue =
      copy === undefined ? freshUUID().replaceAll('-', '') : `copy-${String(copy)}`;
  }
  return processIdentityValue;
}

/** The agent a verification form states beside its caller, on the
 * form's own calls alone: the served agent's (a test form makes them as
 * its target) and a module test form's, linked into its tester. A
 * linked module's call names the module and no target, so a module
 * reads its own place in every form, as it does in every consumer. */
export function formTarget(callerAgentId: string): string | undefined {
  const facts = processFacts();
  if (facts.target === undefined) return undefined;
  if (callerAgentId === facts.agentId) return facts.target;
  if (facts.form === 'tester' && facts.testOf !== undefined && callerAgentId === facts.testOf)
    return facts.target;
  return undefined;
}
