// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { wordsOf } from '../../api/plane.js';
import { useHistory } from '../../api/queries.js';
import { TypeWord } from '../../components/agent-type.js';
import { AssistantWord } from '../../components/assistant.js';
import { partyKind, PartyPicture } from '../../components/party.js';
import { AgentName, Avatar, cx, IconButton, Moment } from '../../components/ui.js';
import { dotOf } from '../../model/agent.js';
import { activeWord, costWord, countWord, cpuWord, mebibytesWord } from '../../model/figures.js';
import { usersOf } from '../../model/fleet.js';
import type { Fleet, FleetAgent } from '../../model/fleet.js';
import { codeWord, MODIFIED_WORDS, useGenerations } from '../../model/package.js';
import { factMoment, tableMoment } from '../../model/time.js';
import { useClock, usePref } from '../../state/prefs.js';
import { CopyButton } from './trace/body.js';
import { Running } from './trace/message.js';

const NO_FOLDS: Record<string, boolean> = {};

/** A part of the panel under a small heading that folds and remembers. */
function Part({
  name,
  title,
  count,
  children,
}: {
  name: string;
  title: string;
  count?: number | undefined;
  children: ReactNode;
}): ReactNode {
  const [folds, setFolds] = usePref<Record<string, boolean>>('panel.folds', NO_FOLDS);
  const folded = folds[name] === true;
  return (
    <section className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={!folded}
        onClick={() => {
          setFolds({ ...folds, [name]: !folded });
        }}
        className="flex h-9 w-full items-center gap-1.5 px-4 text-left text-[11px] font-semibold tracking-wider text-ink-muted uppercase hover:text-ink"
      >
        {folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {count !== undefined && (
          <span className="figures font-normal tracking-normal">{count}</span>
        )}
      </button>
      {!folded && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

/** A name and its figure, a line each. */
function Facts({ rows }: { rows: [string, ReactNode][] }): ReactNode {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-ink-muted">{name}</dt>
          <dd className="figures min-w-0 text-right break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** How many colleagues a list shows before it is asked for the rest. */
const COLLEAGUES_SHOWN = 8;

/**
 * A list of colleagues under its word, each on a line of its own: its
 * picture with the dot of its state, its name, and how it stands. An
 * agent of the plane's is a way to that agent. A long list shows its
 * first ones and the way to the rest.
 */
function Colleagues({
  title,
  ids,
  fleet,
}: {
  title: string;
  ids: string[];
  fleet: Fleet;
}): ReactNode {
  const [whole, setWhole] = useState(false);
  if (ids.length === 0) return null;
  const shown = whole || ids.length <= COLLEAGUES_SHOWN + 1 ? ids : ids.slice(0, COLLEAGUES_SHOWN);
  return (
    <div className="py-1">
      <div className="mb-0.5 flex items-baseline gap-1.5 text-xs text-ink-muted">
        <span>{title}</span>
        {ids.length > 1 && <span className="figures">{ids.length}</span>}
      </div>
      <ul className="-mx-1.5 flex flex-col">
        {shown.map((id) => {
          const other = fleet.byId.get(id);
          const line = (
            <>
              {/* An agent of the plane's is drawn as itself here, the gateway among them:
                  in a conversation its id stands for an operator, and here it is the agent. */}
              {other === undefined ? (
                <PartyPicture id={id} size={24} ground="var(--surface)" />
              ) : (
                <Avatar
                  agentId={id}
                  size={24}
                  dot={dotOf(other.ls)}
                  status={other.ls.status}
                  ground="var(--surface)"
                />
              )}
              {other !== undefined || partyKind(id) === 'agent' ? (
                <AgentName agentId={id} className="flex-1 text-left text-[13px]" />
              ) : (
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={id}>
                  {id}
                </span>
              )}
              {other !== undefined && (
                <span className="shrink-0 text-xs text-ink-muted">{other.ls.status}</span>
              )}
            </>
          );
          const frame = 'flex h-8 items-center gap-2 rounded-md px-1.5';
          return (
            <li key={id}>
              {other === undefined ? (
                <div className={frame}>{line}</div>
              ) : (
                <Link
                  to="/agents/$"
                  params={{ _splat: id }}
                  title={`Open ${id}`}
                  className={cx(frame, 'hover:bg-hover')}
                >
                  {line}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {ids.length > shown.length && (
        <button
          type="button"
          className="mt-0.5 text-xs text-ink-muted hover:text-ink hover:underline"
          onClick={() => {
            setWhole(true);
          }}
        >
          and {ids.length - shown.length} more
        </button>
      )}
    </div>
  );
}

/**
 * The side panel: how the agent stands, beside the work. It is the
 * agent's, so it follows the agent chosen in the list, whichever tab is
 * open in the middle. What a person gives the agent, its settings, its
 * accounts and the logins that wait for them, needs the width and
 * stands in the Settings tab, whose word in the row of tabs counts what
 * waits.
 */
export function SidePanel({
  agent,
  fleet,
  onClose,
}: {
  agent: FleetAgent;
  fleet: Fleet;
  onClose: () => void;
}): ReactNode {
  const [clock] = useClock();
  const row = agent.ls;
  const shipped = agent.row;
  // Said only of code that was modified; code written whole is said nothing of.
  const modified = codeWord(shipped?.built?.amendDepth ?? 0);
  const generations = useGenerations(agent.id);
  const history = useHistory(agent.id);
  const active = generations.find((entry) => entry.status === 'active');
  const uses = (shipped?.uses ?? []).filter((id) => id !== agent.id);
  const usedBy = usersOf(agent.id, fleet);
  const implementors = fleet.agents
    .filter((other) => other.row?.implements?.some((entry) => entry.id === agent.id) === true)
    .map((other) => other.id);
  const runs = row.type !== 'module' && row.type !== 'interface';
  const [ready, wanted] = row.ready.split('/');
  const partial =
    (row.copiesAsked ?? 0) > 0 &&
    (row.copiesAnswered ?? row.copiesAsked ?? 0) < (row.copiesAsked ?? 0);

  return (
    <aside
      aria-label={`About ${agent.id}`}
      className="flex h-full w-[340px] max-w-full shrink-0 flex-col border-l bg-surface max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-sheet"
    >
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b pr-2 pl-4">
        <Avatar agentId={agent.id} size={32} dot={dotOf(row)} status={row.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="mono min-w-0 truncate text-xs text-ink" title={agent.id}>
              {agent.id}
            </span>
            <CopyButton text={agent.id} label="Copy the id" className="size-5" size={11} />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            <TypeWord type={row.type} />
            <span aria-hidden="true">·</span>
            <span className={cx(row.status === 'Failed' && 'text-bad')}>{row.status}</span>
          </div>
        </div>
        <IconButton label="Close the side panel" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Part name="now" title="Now">
          <Facts
            rows={[
              ['Status', row.status],
              ...(runs
                ? ([
                    ['Copies', `${ready ?? '0'} ready of ${wanted ?? '0'}`],
                    [
                      'Generation',
                      active === undefined ? (
                        'none active'
                      ) : (
                        <>
                          {active.gen}, active for <Running since={active.createdAt} />
                        </>
                      ),
                    ],
                    ['Restarts', String(row.restarts)],
                    ['CPU', row.cpuMillicores === undefined ? '-' : cpuWord(row.cpuMillicores)],
                    ['RAM', row.memoryMi === undefined ? '-' : mebibytesWord(row.memoryMi)],
                    [
                      'Snapshot',
                      row.snapshotMi === undefined ? '-' : mebibytesWord(row.snapshotMi),
                    ],
                    ['Journal', row.journalMi === undefined ? '-' : mebibytesWord(row.journalMi)],
                  ] satisfies [string, ReactNode][])
                : []),
            ]}
          />
        </Part>

        {(uses.length > 0 || usedBy.length > 0 || implementors.length > 0) && (
          <Part name="colleagues" title="Colleagues">
            <Colleagues title="Uses" ids={uses} fleet={fleet} />
            <Colleagues title="Used by" ids={usedBy} fleet={fleet} />
            <Colleagues title="Served by" ids={implementors} fleet={fleet} />
          </Part>
        )}

        <Part name="calls" title="Calls">
          <Facts
            rows={[
              ['Calls in', row.incomingTotal === undefined ? '-' : countWord(row.incomingTotal)],
              ['Active in', activeWord(row, row.incomingActive)],
              ['Calls out', row.outgoingTotal === undefined ? '-' : countWord(row.outgoingTotal)],
              ['Active out', activeWord(row, row.outgoingActive)],
            ]}
          />
          {row.totalsSince !== undefined && (
            <p className="mt-2 text-xs text-ink-muted">
              Counted since{' '}
              <Moment at={row.totalsSince}>{tableMoment(row.totalsSince, clock)}</Moment>.
            </p>
          )}
          {partial && (
            <p className="mt-1 text-xs text-ink-muted">
              {row.copiesAnswered ?? 0} of {row.copiesAsked ?? 0} copies answered for what they hold
              now, so the two active figures are partial.
            </p>
          )}
        </Part>

        {(row.inputTokens !== undefined || row.costUsd !== undefined) && (
          <Part name="ai" title="AI">
            <Facts
              rows={[
                ['Tokens in', row.inputTokens === undefined ? '-' : countWord(row.inputTokens)],
                ['Tokens out', row.outputTokens === undefined ? '-' : countWord(row.outputTokens)],
                ['Cost', row.costUsd === undefined ? '-' : costWord(row.costUsd)],
              ]}
            />
          </Part>
        )}

        {runs && (
          <Part name="generations" title="Generations" count={generations.length}>
            {generations.length === 0 ? (
              <div className="text-[13px] text-ink-muted">No generation runs.</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {generations.map((entry) => (
                  <li key={entry.gen} className="text-[13px]">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-ink">Generation {entry.gen}</span>
                      <span className="text-xs text-ink-muted">{entry.status}</span>
                      <span className="flex-1" />
                      <Link
                        to="."
                        search={(previous) => ({
                          ...previous,
                          tab: 'code' as const,
                          gen: entry.gen,
                        })}
                        className="text-xs text-accent-text hover:underline"
                      >
                        its compiled code
                      </Link>
                    </div>
                    <div className="mono truncate text-[11px] text-ink-muted" title={entry.package}>
                      {entry.package.replace('sha256:', '').slice(0, 16)}
                    </div>
                    <div className="text-xs text-ink-muted">
                      Planned{' '}
                      <Moment at={entry.createdAt}>{tableMoment(entry.createdAt, clock)}</Moment>
                    </div>
                    {entry.composition !== undefined && (
                      <div className="text-xs text-ink-muted">
                        Composed of {Object.keys(entry.composition).join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Part>
        )}

        <Part name="history" title="History" count={history.data?.length}>
          {history.data === undefined || history.data.length === 0 ? (
            <div className="text-[13px] text-ink-muted">
              {history.isError ? wordsOf(history.error) : 'No generation is recorded.'}
            </div>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {history.data.slice(0, 12).map((entry) => (
                <li key={`${String(entry.gen)}:${entry.at}`} className="flex items-baseline gap-2">
                  <span className="text-ink">Generation {entry.gen}</span>
                  {entry.version !== undefined && (
                    <span className="text-xs text-ink-muted">{entry.version}</span>
                  )}
                  <span className="text-xs text-ink-muted">{entry.status}</span>
                  <span className="flex-1" />
                  <Moment at={entry.at} className="text-xs text-ink-muted">
                    {factMoment(entry.at, clock)}
                  </Moment>
                </li>
              ))}
            </ul>
          )}
        </Part>

        <Part name="about" title="About">
          <Facts
            rows={[
              ['Type', <TypeWord key="type" type={row.type} />],
              [
                'Live tests',
                shipped?.verified === undefined ? (
                  'Not run on this package'
                ) : (
                  <span key="verified">
                    Passed{' '}
                    <Moment at={shipped.verified.at}>
                      {factMoment(shipped.verified.at, clock)}
                    </Moment>
                  </span>
                ),
              ],
              ...(shipped?.built?.harness === undefined
                ? []
                : ([
                    [
                      'Coding assistant',
                      <AssistantWord key="assistant" harness={shipped.built.harness.name} />,
                    ],
                    ...(shipped.built.harness.model === undefined
                      ? []
                      : ([['Model', shipped.built.harness.model]] satisfies [string, ReactNode][])),
                    ...(modified === undefined
                      ? []
                      : ([
                          [
                            'Compiled',
                            <span key="code" title={MODIFIED_WORDS} className="block text-balance">
                              {modified.replace(/^./, (first) => first.toUpperCase())}
                            </span>,
                          ],
                        ] satisfies [string, ReactNode][])),
                  ] satisfies [string, ReactNode][])),
              ...(shipped?.package === undefined
                ? []
                : ([
                    ['Installed', shipped.package.version ?? 'from a package'],
                    ...(shipped.package.publisher === undefined
                      ? []
                      : ([['Publisher', shipped.package.publisher]] satisfies [
                          string,
                          ReactNode,
                        ][])),
                  ] satisfies [string, ReactNode][])),
            ]}
          />
          {(shipped?.implements ?? []).length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Implements {(shipped?.implements ?? []).map((entry) => entry.id).join(', ')}
            </p>
          )}
        </Part>
      </div>
    </aside>
  );
}
