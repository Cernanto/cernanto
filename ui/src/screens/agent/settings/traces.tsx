// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../../../api/plane.js';
import { useAskAgain } from '../../../api/queries.js';
import { AgentName, cx, ErrorLine, Tip } from '../../../components/ui.js';
import * as gateway from '../../../gateway/sdk.gen.js';
import type { Traces } from '../../../gateway/types.gen.js';
import type { FleetAgent } from '../../../model/fleet.js';
import { TRACES_MEANS, TRACES_WORDS, tracesChoices, tracesSaid } from '../../../model/traces.js';
import type { TracesSaid } from '../../../model/traces.js';

// TRACES: what an agent's traces stand at, the cli's `cernanto traces
// <agent>`. One choice of three, two for a module, the one that stands
// marked. A press writes it at once, as the cli's word does, and the
// plane's answer is said under it: the agent starts again as a new
// version, and a module's change starts the agents that link it.

/**
 * An agent's Traces: the choice that stands, the others a press away,
 * and what the plane answered the last write.
 */
export function TracesPart({ agent }: { agent: FleetAgent }): ReactNode {
  const askAgain = useAskAgain();
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const [said, setSaid] = useState<TracesSaid | undefined>(undefined);
  const stands = agent.ls.traces;

  const choose = (traces: Traces): void => {
    setBusy(true);
    setTrouble(undefined);
    setSaid(undefined);
    void (async () => {
      const set = unwrap(
        await gateway.agentTraces({ client: plane, path: { agentId: agent.id }, body: { traces } }),
        'the traces',
      );
      setSaid(tracesSaid(agent.id, set));
      // The listing is read again, so the mark follows what stands now.
      askAgain();
    })()
      .catch((error: unknown) => {
        setTrouble(wordsOf(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div
        role="radiogroup"
        aria-label="Traces"
        className="flex h-7 w-fit items-stretch rounded-md border border-line-strong"
      >
        {tracesChoices(agent.ls.type).map((choice) => (
          <Tip key={choice} label={TRACES_MEANS[choice]}>
            <button
              type="button"
              role="radio"
              aria-checked={stands === choice}
              disabled={busy}
              onClick={() => {
                if (stands !== choice) choose(choice);
              }}
              className={cx(
                'px-3 text-xs first:rounded-l-[3px] last:rounded-r-[3px] disabled:opacity-60',
                stands === choice ? 'bg-ink text-ground' : 'text-ink-secondary hover:bg-hover',
              )}
            >
              {TRACES_WORDS[choice]}
            </button>
          </Tip>
        ))}
      </div>
      {trouble !== undefined && <ErrorLine>{trouble}</ErrorLine>}
      {said !== undefined && (
        <div role="status" className="text-ink-secondary">
          <p>{said.words}</p>
          {said.agents.length > 0 && (
            <ul className="mt-1 flex flex-col">
              {said.agents.map((id) => (
                <li key={id}>
                  <Link
                    to="/agents/$"
                    params={{ _splat: id }}
                    className="flex h-8 items-center rounded-md px-1 hover:bg-hover"
                  >
                    <AgentName agentId={id} className="text-left" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The line an empty Trace or Calls tab says of an agent whose traces
 * are off, with the way to where they are set.
 */
export function TracesOffLine({ agentId }: { agentId: string }): ReactNode {
  return (
    <>
      Its traces are off, so nothing of its calls is stored.{' '}
      <Link
        to="/agents/$"
        params={{ _splat: agentId }}
        search={{ tab: 'settings' }}
        hash="traces"
        className="text-accent-text underline underline-offset-2"
      >
        Turn them on in Settings
      </Link>
      .
    </>
  );
}
