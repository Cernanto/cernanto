// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The boot call. A generation's process is a call of its own in the
// traces, named `boot`: what the runtime says outside any call (a
// journal found damaged at the boot's walk, a program that stopped, a
// resume that failed) is a record of that call, so a process's start
// and its failures stand in `cernanto trace` beside the agents' own
// story, read by its id; it rides no request and is its own story, and
// no listing names it. The call begins when the process serves and ends
// when it leaves by its own shutdown; a process killed outright leaves
// its boot in flight, as a dead call is. The agent's debug lines outside
// a call are dropped.

import { freshUUID } from '../kernel/entropy.js';

import { wallElapsedMs, wallNowIso } from '../kernel/clock.js';
import { processFacts } from '../kernel/facts.js';
import { serviceNameOf } from '../language/naming.js';
import { runId } from './story.js';
import { emitTrace } from './trace.js';

interface BootCall {
  agentId: string;
  callId: string;
  seq: number;
  startedAt: number;
  input: { generation: string; pid: number };
}

let boot: BootCall | undefined;

/** Opens the boot call of this process, once it serves.
 * @param agentId - The agent the process serves.
 * @param agentType - Its type, as the call's start record names it.
 * @param generation - The generation's identity, its port as text.
 * @example openBootCall('cernanto/packages', 'task', '19990');
 */
export function openBootCall(
  agentId: string,
  agentType: 'task' | 'job' | 'service' | 'worker' | 'module',
  generation: string,
): void {
  if (boot !== undefined) return;
  // The boot call's id is a handle like a wire call's, its service
  // first, so the traces are kept, and found, where its id leads.
  const callId = `${serviceNameOf(agentId)}:${generation}:c-${freshUUID()}`;
  const input = { generation, pid: process.pid, type: agentType };
  boot = { agentId, callId, seq: 1, startedAt: wallElapsedMs(), input };
  const at = wallNowIso();
  emitTrace({
    kind: 'begin',
    of: 'handler',
    agentId,
    callId,
    seq: 0,
    at,
    handler: 'boot',
    input,
    run: bootRun(),
  });
}

/** The run of the boot call: this process's own launch, the count 0,
 * since the boot call is no request's run. */
function bootRun(): string {
  return runId(processFacts().launch ?? 0, 0);
}

/** Whether a boot call is open: a line outside any call has a home. */
export function bootCallOpen(): boolean {
  return boot !== undefined;
}

/** Records one line said outside any call as the boot call's.
 * @param level - The line's level.
 * @param message - The line, without its line break.
 * @example bootLine('error', 'the journal of cernanto/packages c-1 is damaged and the call is lost');
 */
export function bootLine(level: 'info' | 'warn' | 'error', message: string): void {
  if (boot === undefined) return;
  boot.seq += 1;
  emitTrace({
    kind: 'log',
    agentId: boot.agentId,
    callId: boot.callId,
    seq: boot.seq,
    at: wallNowIso(),
    level,
    message,
    run: bootRun(),
  });
}

/** Ends the boot call with the way the process leaves.
 * @param reason - Why the process ends: `stop asked`, `retired`, a signal's name.
 * @example closeBootCall('stop asked');
 */
export function closeBootCall(reason: string): void {
  if (boot === undefined) return;
  const ended = boot;
  boot = undefined;
  emitTrace({
    kind: 'handler',
    agentId: ended.agentId,
    callId: ended.callId,
    seq: 0,
    at: wallNowIso(),
    run: bootRun(),
    handler: 'boot',
    input: ended.input,
    output: { ended: reason },
    durationMs: wallElapsedMs() - ended.startedAt,
  });
}
