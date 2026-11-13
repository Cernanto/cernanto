// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The record of a wire dependency's operation: an openapi operation or
// an mcp tool call, the two contracts the platform reads and speaks on
// the author's behalf, is recorded like a call's answer. Settled in the
// world the first time and answered from the journal on a replay; a
// crash between the send and the record repeats it, as a call's would.
// The operation leaves a step record in the trace, its label the
// operation. The generated lane modules are the only callers.

import { CernantoError, failureForRecord } from '../language/errors.js';
import { wallElapsedMs, wallNowIso } from '../kernel/clock.js';
import { RECORD_BYTES_CAP } from '../kernel/facts.js';
import { encodeJson } from '../kernel/json.js';
import { sleepMs } from '../kernel/lifetime.js';
import { nextTraceSequence, requireExecution } from '../kernel/execution.js';
import { emitTrace } from '../traces/trace.js';
import type { LocalMcpKeeper } from './mcp/local.js';

/** The most a recorded answer may weigh (the journal's record cap). */
const LANE_RECORD_BYTES_CAP = RECORD_BYTES_CAP;

/** Runs one operation of a lane under the running call and records its
 * answer; a replay answers the record in place of the action. The
 * action gets the attempt's signal, so a request in flight ends with
 * the attempt. */
export async function recordLane<T>(
  label: string,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const execution = requireExecution();
  const { backend, context, owner } = execution;
  const signal = owner?.signal ?? new AbortController().signal;
  const startedAt = wallElapsedMs();
  const seq = nextTraceSequence(execution.trace);
  // Trace records ride the original execution only: the begin is
  // emitted from inside the command's own run, which a replay skips,
  // and the end is gated on the run having happened.
  const ran = { now: false };
  const base = () => ({
    agentId: context.agentId,
    callId: context.callId,
    seq,
    at: wallNowIso(),
    kind: 'step' as const,
    label,
    durationMs: wallElapsedMs() - startedAt,
  });
  try {
    const result = await backend.lane(label, async () => {
      ran.now = true;
      emitTrace({
        agentId: context.agentId,
        callId: context.callId,
        seq,
        at: wallNowIso(),
        kind: 'begin',
        of: 'step',
        label,
      });
      const value = await action(signal);
      // JSON.stringify answers undefined for an undefined value, whatever
      // its declared type says.
      const encoded = encodeJson(value) as string | undefined;
      const weight = Buffer.byteLength(encoded ?? 'null');
      if (weight > LANE_RECORD_BYTES_CAP) {
        throw new CernantoError({
          kind: 'terminal',
          message:
            `the answer of ${label} weighs ${String(weight)} bytes, past the ` +
            `${String(LANE_RECORD_BYTES_CAP)} the journal records: page the read, or store ` +
            'the answer and hand back a reference',
        });
      }
      return value;
    });
    if (ran.now) emitTrace(base());
    return result;
  } catch (error) {
    if (ran.now) emitTrace({ ...base(), error: failureForRecord(error).error });
    throw error;
  }
}

/** What a lane's ladder takes from its caller beyond the grant: the
 * record a step runs under (the journaled lane by default), the fetch
 * (the global one), the clock (the agent's) and the keeper of the
 * local servers (the process's own), so a proof runs a ladder against
 * a scripted server with no plane. */
export interface LaneOptions {
  record?: <T>(label: string, action: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  fetch?: typeof fetch;
  now?: () => number;
  keeper?: LocalMcpKeeper;
}

/** A fetch whose every request ends with the signal given, the
 * request's own signal kept beside it: a lane module runs its
 * requests under the record's signal, so an ended attempt ends the
 * request in flight with the attempt's reason. */
export function fetchUnder(signal: AbortSignal, fetchFn: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const own = init?.signal;
    const signals = own === undefined || own === null ? [signal] : [signal, own];
    return fetchFn(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

/** The wait between a lane's attempts, ended by the signal with its
 * reason: a retry ends with the attempt that asked for it. */
export function sleepUnder(ms: number, signal: AbortSignal): Promise<void> {
  return sleepMs(ms, signal);
}
