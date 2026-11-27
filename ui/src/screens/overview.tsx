// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { wordsOf } from '../api/plane.js';
import { useAgents, useAuth } from '../api/queries.js';
import { AgentName, Avatar, cx, ErrorLine, Moment } from '../components/ui.js';
import { dotOf, notReady } from '../model/agent.js';
import { costWord } from '../model/figures.js';
import { useFleet } from '../model/fleet.js';
import type { Fleet } from '../model/fleet.js';
import { factMoment } from '../model/time.js';
import { useClock } from '../state/prefs.js';
import { AgentsTable } from './agents/table.js';

/** One thing on the plane that needs a person: whose it is, what it
 * is, and the way to it. */
interface Need {
  key: string;
  /** The agent it is of; none where it is the plane's own. */
  agentId: string | undefined;
  words: ReactNode;
  /** Something failed, where a login that waits has not. */
  bad: boolean;
  /** The agent the line leads to; `auth` leads to where its logins are answered. */
  open?: { agentId: string; auth?: boolean };
  action?: string;
}

/** What needs a person now, the logins that wait first, then what
 * failed, then what the plane says of itself. Each is told by its agent
 * too, in the list and on its screen; here they stand together. */
function useNeeds(fleet: Fleet): Need[] {
  const auth = useAuth();
  const shipped = useAgents();
  return useMemo(() => {
    const out: Need[] = [];
    for (const ask of auth.data?.asks ?? []) {
      out.push({
        key: `ask:${ask.id}`,
        agentId: ask.agent,
        words: (
          <>
            <span className="font-semibold text-ink">Action required:</span>{' '}
            {ask.kind === 'oauth' ? `${ask.provider} sign-in` : `${ask.name} login`}
          </>
        ),
        bad: false,
        open: { agentId: ask.agent, auth: true },
        action: 'Answer',
      });
    }
    for (const agent of fleet.agents) {
      if (agent.pair || agent.platform) continue;
      if (agent.ls.status !== 'Failed' && agent.ls.status !== 'Degraded') continue;
      out.push({
        key: `state:${agent.id}`,
        agentId: agent.id,
        words: (
          <>
            <span className="font-semibold">{agent.ls.status}</span>
            {agent.ls.restarts > 0 && ` · restarted ${String(agent.ls.restarts)} times`}
          </>
        ),
        bad: true,
        open: { agentId: agent.id },
        action: 'Open',
      });
    }
    const platform = fleet.agents.filter((agent) => agent.platform);
    const unready = platform.filter((agent) => notReady(agent.ls.status));
    if (unready.length > 0) {
      out.push({
        key: 'platform',
        agentId: undefined,
        words: `Of the platform's own ${String(platform.length)} agents, ${String(unready.length)} ${unready.length === 1 ? 'is' : 'are'} not ready: ${unready.map((agent) => `${agent.id} (${agent.ls.status})`).join(', ')}.`,
        bad: true,
      });
    }
    for (const condition of shipped.data?.conditions ?? []) {
      if (condition.status === 'True') continue;
      out.push({
        key: `condition:${condition.type}`,
        agentId: undefined,
        words: (
          <>
            <span className="font-semibold">{condition.reason}:</span> {condition.message}
          </>
        ),
        bad: true,
      });
    }
    return out;
  }, [auth.data, fleet, shipped.data]);
}

/** One line of what needs a person, a way to its agent where it has one. */
function NeedLine({ need, fleet }: { need: Need; fleet: Fleet }): ReactNode {
  const agent = need.agentId === undefined ? undefined : fleet.byId.get(need.agentId);
  const row = (
    <>
      <span
        aria-hidden="true"
        className={cx('size-1.5 shrink-0 rounded-full', need.bad ? 'bg-bad' : 'bg-accent')}
      />
      {need.agentId === undefined ? (
        <span className="shrink-0 text-ink-secondary">The plane</span>
      ) : (
        <>
          <Avatar
            agentId={need.agentId}
            size={22}
            dot={agent === undefined ? undefined : dotOf(agent.ls)}
            ground="var(--ground)"
          />
          <AgentName agentId={need.agentId} className="shrink-0 text-left" />
        </>
      )}
      <span className={cx('min-w-0 flex-1', need.bad ? 'text-bad' : 'text-ink-secondary')}>
        {need.words}
      </span>
      {need.action !== undefined && (
        <span className="shrink-0 text-xs font-medium text-accent-text">{need.action}</span>
      )}
    </>
  );
  const className = 'flex min-h-9 items-center gap-3 rounded-md px-2 py-1 text-[13px]';
  if (need.open === undefined) return <div className={className}>{row}</div>;
  return (
    <Link
      to="/agents/$"
      params={{ _splat: need.open.agentId }}
      // A login is answered in the agent's Settings tab, under Auth.
      {...(need.open.auth === true ? { search: { tab: 'settings' as const }, hash: 'auth' } : {})}
      className={cx(className, 'hover:bg-hover')}
    >
      {row}
    </Link>
  );
}

/**
 * The Overview: the whole plane on one screen. A line of what stands
 * nowhere else, the plane's AI cost and the calls active now; under it
 * what needs a person, said only where something does; and the agents
 * side by side as `cernanto ls` lists them, sorted by any column. It is
 * the screen of whoever runs many agents they did not write, and so the
 * second in the rail: the first is the agents themselves.
 */
export function Overview(): ReactNode {
  const fleet = useFleet();
  const [clock] = useClock();
  const needs = useNeeds(fleet);

  const own = fleet.agents.filter((agent) => !agent.platform && !agent.pair);
  const activeNow = own.reduce((sum, agent) => sum + (agent.ls.incomingActive ?? 0), 0);
  // An interface's line is its implementors' figures added up, so it is left out of the sum.
  const priced = fleet.agents.filter(
    (agent) => agent.ls.type !== 'interface' && agent.ls.costUsd !== undefined,
  );
  const cost = priced.reduce((sum, agent) => sum + (agent.ls.costUsd ?? 0), 0);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b bg-surface px-5 py-2.5">
        {fleet.error !== null && fleet.error !== undefined && (
          <ErrorLine className="mb-2">The plane does not answer: {wordsOf(fleet.error)}</ErrorLine>
        )}
        <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-1 text-[13px]">
          <div className="flex items-baseline gap-2">
            <dt className="text-ink-muted">AI cost</dt>
            <dd className="figures font-semibold text-ink">
              {priced.length === 0 ? '-' : costWord(cost)}
            </dd>
            {fleet.usageSince !== undefined && (
              <dd className="text-xs text-ink-muted">
                since <Moment at={fleet.usageSince}>{factMoment(fleet.usageSince, clock)}</Moment>
              </dd>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-ink-muted">Calls active now</dt>
            <dd className="figures font-semibold text-ink">{activeNow}</dd>
          </div>
        </dl>
        {needs.length > 0 && (
          <ul aria-label="What needs a person" className="mt-2 flex flex-col border-t pt-2">
            {needs.map((need) => (
              <li key={need.key}>
                <NeedLine need={need} fleet={fleet} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <AgentsTable fleet={fleet} />
    </div>
  );
}
