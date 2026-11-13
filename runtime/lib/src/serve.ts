// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The machine's gate: what boots and serves fleets, for the block, the
// fixtures, the emitted serve entry and the plane's agents.
export { serveAgent } from './kernel/boot.js';
export { DEFAULT_SEAM, LEASE_MS, processFacts, setProcessFacts } from './kernel/facts.js';
export { leftOutOn, planeFit, storeKindOfPlace } from './kernel/fit.js';
export {
  hostStopKey,
  issueLaunch,
  lifeOnPlane,
  deleteObject,
  readHolding,
  readRecord,
  readFamilyRecord,
  updateRecord,
  withPlane,
  writeControlWord,
} from './kernel/plane.js';
export type { Holding, ProcessRecord } from './kernel/plane.js';
export { ownEntry, ownEntryKey } from './kernel/copy-entry.js';
export { createRecord } from './kernel/plane.js';
export type { CopyEntry } from './kernel/copy-entry.js';
export { readWords } from './kernel/fence.js';
export type { Watched, Word } from './kernel/fence.js';
export type { ProcessFacts, SeamFacts } from './kernel/facts.js';
export { hostCall, machineCall } from './language/serving.js';
// The words a hand-written agent of the proofs reaches by this road
// and never by the map an agent sees: the attempt and the cancel
// signal the emitted os module does not render.
export { attemptId, callSignal } from './language/core.js';
export { closeSubstrate, openSubstrate, putDownSubstrate, substrate } from './kernel/connection.js';
export type { ServeOptions } from './kernel/boot.js';
export { prepare, resume } from './kernel/pause.js';
export type { Served } from './kernel/served.js';
export { journalSince } from './kernel/served.js';
export type { Journal } from './kernel/journal.js';
export type { ServedUnit } from './kernel/units.js';

export { traceRecordSchema } from './traces/trace.js';
export { installCommandOwnership } from './kernel/commands.js';
export { installTransparentGlobals } from './kernel/globals.js';
export type { TraceRecord } from './traces/trace.js';
export { installListenerObserver, listenersSeen } from './kernel/listeners.js';
export type { ListenerFact } from './kernel/listeners.js';
export type { Logs, Records, Substrate } from './kernel/substrate.js';
export { openFilesSubstrate } from './kernel/substrate/files/index.js';
export { copyKey } from './kernel/substrate.js';
export { logNameOf } from './kernel/log.js';
export { serviceNameOf } from './language/naming.js';
