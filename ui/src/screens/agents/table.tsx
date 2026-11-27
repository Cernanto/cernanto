// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { patched } from '../../app/search.js';
import type { AgentsSearch, Patch, TableView } from '../../app/search.js';
import { TypeWord } from '../../components/agent-type.js';
import { AgentName, Avatar, Button, Chip, cx, Moment, Quiet, Tip } from '../../components/ui.js';
import { dotOf, notReady } from '../../model/agent.js';
import { activeWord, costWord, countWord, cpuWord, mebibytesWord } from '../../model/figures.js';
import { isActive } from '../../model/fleet.js';
import type { Fleet, FleetAgent } from '../../model/fleet.js';
import { composing } from '../../model/keys.js';
import { tableMoment } from '../../model/time.js';
import { useClock, usePref } from '../../state/prefs.js';
import { saveFile } from '../../state/save.js';

const route = getRouteApi('/overview');

interface Column {
  key: string;
  head: string;
  hint: string;
  /** What the column sorts by; text sorts by the alphabet, a number the largest first. */
  value: (agent: FleetAgent) => string | number | undefined;
  cell: (agent: FleetAgent) => ReactNode;
  /** What the column writes into a saved file. */
  text: (agent: FleetAgent) => string;
  left?: boolean;
}

const dash = '-';

/** The cli's own columns, in its order. */
const COLUMNS: Column[] = [
  {
    key: 'type',
    head: 'TYPE',
    hint: 'The kind of agent',
    value: (agent) => agent.ls.type,
    cell: (agent) => <TypeWord type={agent.ls.type} />,
    text: (agent) => agent.ls.type,
    left: true,
  },
  {
    key: 'status',
    head: 'STATUS',
    hint: "How it stands, in the plane's own word",
    value: (agent) => agent.ls.status,
    cell: (agent) => (
      <span className={cx(agent.ls.status === 'Failed' && 'font-semibold text-bad')}>
        {agent.ls.status}
        {agent.ls.copies > 1 && <span className="ml-1.5 text-ink-muted">{agent.ls.ready}</span>}
      </span>
    ),
    text: (agent) => agent.ls.status,
    left: true,
  },
  {
    key: 'cpu',
    head: 'CPU',
    hint: "Its copies' own processor use, in thousandths of a core",
    value: (agent) => agent.ls.cpuMillicores,
    cell: (agent) =>
      agent.ls.cpuMillicores === undefined ? dash : cpuWord(agent.ls.cpuMillicores),
    text: (agent) => String(agent.ls.cpuMillicores ?? ''),
  },
  {
    key: 'ram',
    head: 'RAM',
    hint: "Its copies' own memory",
    value: (agent) => agent.ls.memoryMi,
    cell: (agent) => (agent.ls.memoryMi === undefined ? dash : mebibytesWord(agent.ls.memoryMi)),
    text: (agent) => String(agent.ls.memoryMi ?? ''),
  },
  {
    key: 'snapshot',
    head: 'SNAPSHOT',
    hint: 'The saved memory the plane holds of it, what a restart loads',
    value: (agent) => agent.ls.snapshotMi,
    cell: (agent) =>
      agent.ls.snapshotMi === undefined ? dash : mebibytesWord(agent.ls.snapshotMi),
    text: (agent) => String(agent.ls.snapshotMi ?? ''),
  },
  {
    key: 'journal',
    head: 'JOURNAL',
    hint: 'What the plane journaled since its snapshot, what a restart replays',
    value: (agent) => agent.ls.journalMi,
    cell: (agent) => (agent.ls.journalMi === undefined ? dash : mebibytesWord(agent.ls.journalMi)),
    text: (agent) => String(agent.ls.journalMi ?? ''),
  },
  {
    key: 'calls-in',
    head: 'CALLS IN',
    hint: 'The calls made of it since the counting began',
    value: (agent) => agent.ls.incomingTotal,
    cell: (agent) =>
      agent.ls.incomingTotal === undefined ? dash : countWord(agent.ls.incomingTotal),
    text: (agent) => String(agent.ls.incomingTotal ?? ''),
  },
  {
    key: 'active-in',
    head: 'ACTIVE IN',
    hint: 'The calls it holds now and has not answered',
    value: (agent) => agent.ls.incomingActive,
    cell: (agent) => activeWord(agent.ls, agent.ls.incomingActive),
    text: (agent) => String(agent.ls.incomingActive ?? ''),
  },
  {
    key: 'calls-out',
    head: 'CALLS OUT',
    hint: 'The calls it made since the counting began',
    value: (agent) => agent.ls.outgoingTotal,
    cell: (agent) =>
      agent.ls.outgoingTotal === undefined ? dash : countWord(agent.ls.outgoingTotal),
    text: (agent) => String(agent.ls.outgoingTotal ?? ''),
  },
  {
    key: 'active-out',
    head: 'ACTIVE OUT',
    hint: 'The calls it made and still waits on',
    value: (agent) => agent.ls.outgoingActive,
    cell: (agent) => activeWord(agent.ls, agent.ls.outgoingActive),
    text: (agent) => String(agent.ls.outgoingActive ?? ''),
  },
  {
    key: 'tokens',
    head: 'AI TOKENS',
    hint: 'The tokens its AI calls read and wrote',
    value: (agent) =>
      agent.ls.inputTokens === undefined && agent.ls.outputTokens === undefined
        ? undefined
        : (agent.ls.inputTokens ?? 0) + (agent.ls.outputTokens ?? 0),
    cell: (agent) =>
      agent.ls.inputTokens === undefined && agent.ls.outputTokens === undefined
        ? dash
        : `${countWord(agent.ls.inputTokens ?? 0)} / ${countWord(agent.ls.outputTokens ?? 0)}`,
    text: (agent) => `${String(agent.ls.inputTokens ?? '')}/${String(agent.ls.outputTokens ?? '')}`,
  },
  {
    key: 'cost',
    head: 'AI COST',
    hint: 'What its AI calls cost',
    value: (agent) => agent.ls.costUsd,
    cell: (agent) => (agent.ls.costUsd === undefined ? dash : costWord(agent.ls.costUsd)),
    text: (agent) => String(agent.ls.costUsd ?? ''),
  },
  {
    key: 'restarts',
    head: 'RESTARTS',
    hint: 'How many times its copies started again',
    value: (agent) => agent.ls.restarts,
    cell: (agent) => (agent.ls.restarts === 0 ? dash : String(agent.ls.restarts)),
    text: (agent) => String(agent.ls.restarts),
  },
];

const VIEWS: { key: TableView; title: string; hint: string }[] = [
  { key: 'not-ready', title: 'Not ready', hint: 'Starting, Degraded, Failed or Unknown' },
  { key: 'not-verified', title: 'Not verified', hint: 'A package its tests did not prove' },
  { key: 'restarted', title: 'Restarted', hint: 'By restarts, the most first' },
  { key: 'most-cost', title: 'Most cost', hint: 'By AI cost, the most first' },
];

function compare(a: string | number | undefined, b: string | number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return b - a;
  return String(a).localeCompare(String(b));
}

/** The agents as `cernanto ls` prints them, the body of the Overview: a
 * line an agent, a column a figure, sorted by the column chosen and
 * narrowed by a view or by a part of an id. */
export function AgentsTable({ fleet }: { fleet: Fleet }): ReactNode {
  const search = route.useSearch();
  const navigate = useNavigate();
  const [clock] = useClock();
  const [withPlatform, setWithPlatform] = usePref<boolean>('table.platform', false);
  const sampledAt = fleet.sampledAt ?? '';

  const setSearch = (next: Patch<AgentsSearch>): void => {
    void navigate({ to: '.', search: (previous) => patched(previous, next), replace: true });
  };

  const sortKey = search.sort?.replace(/^-/, '');
  const turned = search.sort?.startsWith('-') === true;

  const rows = useMemo(() => {
    const text = (search.q ?? '').toLowerCase();
    let shown = fleet.agents.filter((agent) => {
      if (!withPlatform && (agent.platform || agent.pair)) return false;
      if (text !== '' && !agent.id.toLowerCase().includes(text)) return false;
      if (search.filter === 'active' && !isActive(agent, sampledAt)) return false;
      if (search.filter === 'failed' && agent.ls.status !== 'Failed') return false;
      if (search.filter === 'waiting' && agent.asks.length === 0) return false;
      if (search.status !== undefined && agent.ls.status !== search.status) return false;
      if (search.view === 'not-ready' && !notReady(agent.ls.status)) return false;
      if (search.view === 'not-verified') {
        if (agent.row === undefined || agent.row.verified !== undefined) return false;
        if (agent.ls.type === 'interface' || agent.ls.type === 'worker') return false;
      }
      if (search.view === 'restarted' && agent.ls.restarts === 0) return false;
      if (search.view === 'most-cost' && (agent.ls.costUsd ?? 0) === 0) return false;
      return true;
    });
    const column = COLUMNS.find((entry) => entry.key === sortKey);
    if (sortKey === 'agent' || (column === undefined && search.view === undefined)) {
      shown = shown.sort((a, b) => a.id.localeCompare(b.id));
    } else if (column !== undefined) {
      shown = shown.sort(
        (a, b) => compare(column.value(a), column.value(b)) || a.id.localeCompare(b.id),
      );
    } else if (search.view === 'restarted') {
      shown = shown.sort((a, b) => b.ls.restarts - a.ls.restarts || a.id.localeCompare(b.id));
    } else if (search.view === 'most-cost') {
      shown = shown.sort(
        (a, b) => (b.ls.costUsd ?? 0) - (a.ls.costUsd ?? 0) || a.id.localeCompare(b.id),
      );
    } else {
      shown = shown.sort((a, b) => a.id.localeCompare(b.id));
    }
    return turned ? shown.reverse() : shown;
  }, [fleet.agents, search, sortKey, turned, withPlatform, sampledAt]);

  const platformCount = fleet.agents.filter((agent) => agent.platform || agent.pair).length;

  const save = (): void => {
    const head = ['AGENT', ...COLUMNS.map((column) => column.head)];
    const lines = rows.map((agent) => [agent.id, ...COLUMNS.map((column) => column.text(agent))]);
    const cell = (value: string): string =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    saveFile(
      'agents.csv',
      [head, ...lines].map((line) => line.map(cell).join(',')).join('\n') + '\n',
      'text/csv',
    );
  };

  const headButton = (key: string, head: string, hint: string, left: boolean): ReactNode => {
    const chosen = sortKey === key;
    return (
      <Tip label={hint} side="bottom">
        <button
          type="button"
          onClick={() => {
            setSearch({ sort: chosen ? (turned ? undefined : `-${key}`) : key });
          }}
          className={cx(
            'inline-flex h-9 w-full items-center gap-1 px-3 text-[11px] font-semibold tracking-wider whitespace-nowrap hover:text-ink',
            left ? 'justify-start' : 'justify-end',
            chosen ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {head}
          {chosen && (turned ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </button>
      </Tip>
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-5 py-2">
        {/* The table's title is its own count: the agents it shows, in the words the cli's `ls` lists them by. */}
        <h2 className="figures text-[15px] font-semibold text-ink">
          {rows.length} {rows.length === 1 ? 'agent' : 'agents'}
        </h2>
        {fleet.sampledAt !== undefined && (
          <span className="figures text-xs text-ink-muted">
            as of <Moment at={fleet.sampledAt}>{tableMoment(fleet.sampledAt, clock)}</Moment>
          </span>
        )}
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={search.q ?? ''}
            placeholder="Filter by id"
            aria-label="Filter the agents by id"
            spellCheck={false}
            className="mr-1 h-7 w-44 rounded-md border border-line-strong bg-sunken px-2.5 text-xs text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
            onChange={(event) => {
              setSearch({ q: event.target.value === '' ? undefined : event.target.value });
            }}
            onKeyDown={(event) => {
              // The Escape that leaves an input method's composition clears nothing.
              if (event.key === 'Escape' && !composing(event)) setSearch({ q: undefined });
            }}
          />
          {VIEWS.map((view) => (
            <Tip key={view.key} label={view.hint}>
              <span>
                <Chip
                  active={search.view === view.key}
                  onClick={() => {
                    setSearch({
                      view: search.view === view.key ? undefined : view.key,
                      sort: undefined,
                    });
                  }}
                >
                  {view.title}
                </Chip>
              </span>
            </Tip>
          ))}
          <span className="mx-1 h-4 w-px bg-line-strong" />
          <Chip
            active={withPlatform}
            count={platformCount}
            onClick={() => {
              setWithPlatform(!withPlatform);
            }}
          >
            Platform
          </Chip>
          <Tip label="Save what is shown as a file">
            <span>
              <Button look="quiet" small onClick={save} aria-label="Save what is shown as a file">
                <Download size={14} />
              </Button>
            </span>
          </Tip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <Quiet>{fleet.loading ? 'Asking the plane…' : 'No agent to show here.'}</Quiet>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 border-b bg-ground p-0 text-left">
                  {headButton('agent', 'AGENT', 'The agent, by its id', true)}
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className="sticky top-0 z-10 border-b bg-ground p-0">
                    {headButton(column.key, column.head, column.hint, column.left === true)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((agent) => (
                <tr
                  key={agent.id}
                  tabIndex={0}
                  className="group cursor-pointer hover:bg-hover focus-visible:bg-hover"
                  // A line opens its agent; the table's own view and order stay with the table.
                  onClick={() => {
                    void navigate({ to: '/agents/$', params: { _splat: agent.id } });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void navigate({ to: '/agents/$', params: { _splat: agent.id } });
                    }
                  }}
                >
                  <td className="sticky left-0 z-[5] h-9 max-w-[360px] border-b bg-ground px-3 group-hover:bg-hover group-focus-visible:bg-hover">
                    <span className="flex items-center gap-2.5">
                      <Avatar
                        agentId={agent.id}
                        size={22}
                        dot={dotOf(agent.ls)}
                        status={agent.ls.status}
                        ground="var(--ground)"
                      />
                      <AgentName agentId={agent.id} className="text-left" />
                    </span>
                  </td>
                  {COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className={cx(
                        'figures h-9 border-b px-3 whitespace-nowrap text-ink-secondary',
                        column.left === true ? 'text-left' : 'text-right',
                      )}
                    >
                      {column.cell(agent)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
