// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What the traces of a process are kept under: the life of the agent
// it serves, the lives of the modules it composes, the copy that
// writes and the grant its saves are numbered by, the release's own
// agents and the retention. The process's own life and its modules'
// are the launch's when it names them, and asked of the names' records
// at boot otherwise, so a copy started by a launch that names no life
// runs under the life its name stands under.

import { serviceNameOf } from '../language/naming.js';
import { processFacts, setProcessFacts } from './facts.js';
import { lifeOf } from './lives.js';
import type { LifeOf } from '../traces/trace.js';
import type { Substrate } from './substrate.js';

/** The retention when the plane's settings name none: a day. */
const DEFAULT_RETENTION_MINUTES = 1440;
/** The longest a trace may be kept: seven days. */
const MAX_RETENTION_MINUTES = 10_080;

/** The grant by which this process owns its own log now, read at each
 * save: a restored life owns it by a newer one. */
let grantOf: () => number = () => processFacts().launch ?? 0;

/** The log this copy owns, as the totals name its writer. */
let ownLog: string | undefined;

/** Hands the trace facts the copy's own log and how to read its grant. */
export function setOwnLog(log: string, grant: () => number): void {
  ownLog = log;
  grantOf = grant;
}

/** The process's own agent and life, once known. */
export function ownLife(): LifeOf | undefined {
  const { agentId, life } = processFacts();
  if (agentId === undefined || life === undefined) return undefined;
  return { service: serviceNameOf(agentId), life };
}

/** The copy that writes, as the totals name it (its own life and its
 * log), and the grant its saves are numbered by. */
export function writerNow(): { writer: string; grant: number } {
  const { life, agentId } = processFacts();
  const log = ownLog ?? serviceNameOf(agentId ?? 'process');
  return { writer: `${life ?? 'none'}:${log}`, grant: grantOf() };
}

/** The life an agent of this process is kept under: the process's own
 * agent's, or a composed module's; nothing for any other. */
export function lifeOfAgent(agentId: string): LifeOf | undefined {
  const facts = processFacts();
  const service = serviceNameOf(agentId);
  if (facts.agentId !== undefined && serviceNameOf(facts.agentId) === service) return ownLife();
  const life = facts.lives?.[agentId];
  return life === undefined ? undefined : { service, life };
}

/** Whether an agent is one of the release's own. */
export function isReleaseAgent(agentId: string): boolean {
  return processFacts().releaseAgents?.includes(agentId) === true;
}

/** An agent to charge and its life. */
export interface Charge {
  agentId: string;
  life: string;
}

/** The agent a call made from a context names to charge: the calling
 * agent itself when it is not one of the release's own; else the one it
 * was called to charge, itself when it was called with none. Nothing
 * when the calling agent's life is not known here. */
export function outgoingCharge(context: {
  agentId: string;
  charge?: Charge | undefined;
}): Charge | undefined {
  const own = lifeOfAgent(context.agentId);
  const self = own === undefined ? undefined : { agentId: context.agentId, life: own.life };
  if (!isReleaseAgent(context.agentId)) return self ?? context.charge;
  return context.charge ?? self;
}

/** The agent a model request reported in a context is charged to: the
 * last agent of the call's chain that is not one of the release's own,
 * the agent whose code runs when it is not; the one the running call
 * names when it is (a platform agent paying on its caller's behalf),
 * else the agent itself. */
export function chargedIn(
  context: { agentId: string; charge?: Charge | undefined } | undefined,
): LifeOf | undefined {
  if (context === undefined) return ownLife();
  const charge = outgoingCharge(context);
  if (charge !== undefined) return { service: serviceNameOf(charge.agentId), life: charge.life };
  return lifeOfAgent(context.agentId);
}

/** The context's field naming the agent to charge, when there is one. */
export function chargeField(charge: Charge | undefined): { charge?: Charge } {
  return charge === undefined ? {} : { charge };
}

/** How long a stored trace stands. */
export function retentionMs(): number {
  return processFacts().traceRetentionMs ?? DEFAULT_RETENTION_MINUTES * 60_000;
}

/** The trace agent's retention setting, as the config agent's record
 * of it holds it (`config/setting/cernanto/trace/retention-minutes`,
 * the runtime's seam the config spec states): the value's JSON text,
 * nothing when the record does not stand or does not read. */
async function retentionSetting(handles: Substrate): Promise<unknown> {
  const read = await handles.records.read('config/setting/cernanto/trace/retention-minutes');
  if (read.value === null) return undefined;
  try {
    return JSON.parse(read.value) as unknown;
  } catch {
    return undefined;
  }
}

/** The retention a setting names, in milliseconds: the default when it
 * names none or no number, the longest when it names more. */
function retentionOfSetting(minutes: unknown): number {
  const named =
    typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0
      ? minutes
      : DEFAULT_RETENTION_MINUTES;
  return Math.min(named, MAX_RETENTION_MINUTES) * 60_000;
}

/**
 * Resolves the lives this process's traces are kept under and reads
 * the setting they need, once, at boot: the agent's life (the launch's,
 * else the name's), each composed module's, and the retention. The
 * release's agents are the block's to hand at every launch.
 */
export async function resolveTraceFacts(handles: Substrate): Promise<void> {
  const facts = processFacts();
  const agentId = facts.agentId;
  if (agentId === undefined) return;
  const life = facts.life ?? (await lifeOf(handles, serviceNameOf(agentId)));
  const lives: Record<string, string> = { ...facts.lives };
  for (const moduleId of Object.keys(facts.composition ?? {})) {
    lives[moduleId] ??= await lifeOf(handles, serviceNameOf(moduleId));
  }
  const minutes = await retentionSetting(handles).catch((): unknown => undefined);
  setProcessFacts({
    ...processFacts(),
    life,
    lives,
    traceRetentionMs: retentionOfSetting(minutes),
  });
}
