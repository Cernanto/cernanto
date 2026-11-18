// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The words of a life: the plane decides when a life begins and
// ends, and a kernel acts, since the kernel owns the name's record,
// the life's files and its keys. A platform agent asks by the
// runtime's own functions, on the call road like any call, answered
// in the post's own answer and recorded nowhere:
// `#life {agentId, ending?}` answers the life the name stands under,
// made when none stands (with `ending`, a record naming that life is
// ended first); `#endLife {agentId, life}` ends it and removes what
// it kept, answering whether nothing is left.

import { failureForRecord } from '../language/errors.js';
import { serviceNameOf } from '../language/naming.js';
import { END_LIFE_HANDLER, LIFE_HANDLER } from '../language/program.js';
import { substrate } from './connection.js';
import type { CallEnvelope } from './envelope.js';
import { endLife, lifeOf } from './lives.js';
import { isLifeId } from './substrate.js';
import type { PostedCall } from './units.js';

/** Whether a request asks one of the life words. */
export function asksLifeWord(handler: string): boolean {
  return handler === LIFE_HANDLER || handler === END_LIFE_HANDLER;
}

/** Answers a life word in the post's own answer. */
export async function serveLifeWord(posted: PostedCall, envelope: CallEnvelope): Promise<void> {
  const args = envelope.args as { agentId?: unknown; life?: unknown; ending?: unknown } | undefined;
  const agentId = args?.agentId;
  if (typeof agentId !== 'string' || agentId === '') {
    posted.confirm({
      outcome: {
        error: {
          kind: 'contract-violation',
          message: `${envelope.handler} takes the agent as {agentId}`,
        },
      },
    });
    return;
  }
  const service = serviceNameOf(agentId);
  try {
    const handles = await substrate();
    if (envelope.handler === LIFE_HANDLER) {
      // The lives to end: one id, or a list of them.
      const asked = Array.isArray(args?.ending) ? (args.ending as unknown[]) : [args?.ending];
      const ending = asked.filter((life): life is string => isLifeId(life));
      posted.confirm({ outcome: { result: { life: await lifeOf(handles, service, ending) } } });
      return;
    }
    const life = args?.life;
    if (!isLifeId(life)) {
      posted.confirm({
        outcome: {
          error: {
            kind: 'contract-violation',
            message: `${END_LIFE_HANDLER} takes {agentId, life}`,
          },
        },
      });
      return;
    }
    posted.confirm({ outcome: { result: { done: await endLife(handles, service, life) } } });
  } catch (error) {
    posted.confirm({
      outcome: {
        error: {
          kind: 'retryable',
          message: `the life of ${agentId} could not be ${envelope.handler === LIFE_HANDLER ? 'read' : 'ended'}: ${failureForRecord(error).error}`,
        },
      },
    });
  }
}
