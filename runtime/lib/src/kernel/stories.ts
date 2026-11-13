// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The stories of a served agent, as every road states them: the
// story a run of a request is kept under, and the fact that a
// request is over, stated when its answer is recorded and for no
// other reason.

import { emitFact } from '../traces/trace.js';
import { isSecretHandler } from '../language/core.js';
import { processFacts } from './facts.js';
import { storyOfLog } from './log.js';
import type { Outcome, RequestAck } from './log.js';
import type { RunStory } from './handler-run.js';
import type { ServedUnit } from './units.js';

/** The story a run of a request is kept under: its id and its parent's,
 * the run, the moment its request was accepted (the same in every run),
 * the copy that runs it and the linked module whose code made the call,
 * when one did. */
export function storyOfRun(
  ack: RequestAck,
  run: { storyId: string; runOf: () => string },
): RunStory {
  const facts = processFacts();
  const caller = ack.caller;
  const callerModuleId =
    caller?.hostAgentId !== undefined && caller.agentId !== caller.hostAgentId
      ? caller.agentId
      : undefined;
  return {
    id: run.storyId,
    ...(caller?.story === undefined ? {} : { parentId: caller.story }),
    runOf: run.runOf,
    began: new Date(ack.at).toISOString(),
    ...(facts.generationPort === undefined || facts.copy === undefined
      ? {}
      : { copy: { generation: facts.generationPort, copy: facts.copy } }),
    ...(callerModuleId === undefined ? {} : { callerModuleId }),
  };
}

/** States that a request is over, once its answer is recorded: the
 * request's own end, never an attempt's. A call kept out of the records
 * (an observation, a secret's) states nothing. */
export function stateOver(unit: ServedUnit, log: string, ack: RequestAck, outcome: Outcome): void {
  if (ack.observation === true) return;
  const fn = unit.handlers[ack.handler];
  if (fn !== undefined && isSecretHandler(fn)) return;
  emitFact({
    story: storyOfLog(log, ack.request),
    attempt: '',
    run: '',
    fact: 'over',
    agentId: unit.agentId,
    began: new Date(ack.at).toISOString(),
    says: 'error' in outcome ? { status: 'error', error: outcome.error.message } : { status: 'ok' },
  });
}
