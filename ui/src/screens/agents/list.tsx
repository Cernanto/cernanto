// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  CornerUpLeft,
  Ellipsis,
  Search,
  Star,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { patched } from '../../app/search.js';
import type { AgentsSearch, ListFilter, Patch } from '../../app/search.js';
import { wordsOf } from '../../api/plane.js';
import { useAskAgain } from '../../api/queries.js';
import { TypeWord } from '../../components/agent-type.js';
import {
  AgentName,
  Avatar,
  Chip,
  Count,
  cx,
  IconButton,
  Menu,
  MenuItem,
  MenuLabel,
  Moment,
  Quiet,
  Tag,
  Tip,
} from '../../components/ui.js';
import { dotOf, idParts } from '../../model/agent.js';
import { activeWord, costWord } from '../../model/figures.js';
import { isActive } from '../../model/fleet.js';
import type { Fleet, FleetAgent } from '../../model/fleet.js';
import { composing } from '../../model/keys.js';
import { listMoment } from '../../model/time.js';
import { stepAt, stepRows, useCompiles } from '../../state/compiles.js';
import type { CompileRun } from '../../state/compiles.js';
import { useDrafts } from '../../state/drafts.js';
import type { Draft } from '../../state/drafts.js';
import { useClock, useFavorites, usePref } from '../../state/prefs.js';
import { AddMenu } from './add.js';
import { FirstSteps } from './first-steps.js';

const route = getRouteApi('/agents');

/** The list's two orders: what is going on, or where an agent lives. */
type Order = 'activity' | 'folder';

interface Part {
  key: string;
  title: string;
  hint?: string;
  agents: FleetAgent[];
  /** Folded until the reader opens it. */
  foldedAtFirst?: boolean;
}

/** What an entry's line says of a compile this browser started: the
 * step it is at while it runs, and that it failed when it did. The dot
 * stays the running agent's. */
function compileWords(run: CompileRun | undefined): ReactNode {
  if (run === undefined) return undefined;
  if (run.endedAt === undefined) {
    const step = stepAt(stepRows(run.steps));
    return (
      <span className="flex items-center gap-1 text-ink-secondary">
        <span className="ring text-[10px]" />
        {run.kind === 'plan' ? 'dry run' : 'compiling'}
        {step !== undefined && `: ${step}`}
      </span>
    );
  }
  // A compile this window stopped reading did not fail: its outcome shows on the agent.
  if (run.unread === true) return undefined;
  const failed =
    run.status === 'failed' || (run.answer !== undefined && run.answer.status !== 'ok');
  if (!failed) return undefined;
  return (
    <span className="font-semibold text-bad">
      {run.kind === 'plan' ? 'dry run failed' : 'deploy failed'}
    </span>
  );
}

/** The line under an agent's name, in the listing's own figures. */
function EntryLine({ agent, run }: { agent: FleetAgent; run: CompileRun | undefined }): ReactNode {
  const row = agent.ls;
  const parts: ReactNode[] = [<TypeWord key="type" type={row.type} />];
  const compile = compileWords(run);
  if (compile !== undefined) parts.push(<span key="compile">{compile}</span>);
  if (row.status !== 'Ready') {
    parts.push(
      <span key="status" className={cx(row.status === 'Failed' && 'font-semibold text-bad')}>
        {row.status}
      </span>,
    );
  }
  if (row.copies > 1) parts.push(`${String(row.copies)} copies`);
  const incoming = row.incomingActive ?? 0;
  const outgoing = row.outgoingActive ?? 0;
  if (incoming > 0 || outgoing > 0) {
    parts.push(
      <span key="active" className="figures flex items-center gap-2 text-ink-secondary">
        {incoming > 0 && (
          <span
            className="flex items-center gap-0.5"
            title="Calls in that it holds now and has not answered"
          >
            <CornerDownRight size={11} aria-label="Active in" /> {activeWord(row, incoming)}
          </span>
        )}
        {outgoing > 0 && (
          <span className="flex items-center gap-0.5" title="Calls it made and still waits on">
            <CornerUpLeft size={11} aria-label="Active out" /> {activeWord(row, outgoing)}
          </span>
        )}
      </span>,
    );
  }
  if ((row.costUsd ?? 0) > 0)
    parts.push(
      <span key="cost" className="figures">
        {costWord(row.costUsd ?? 0)}
      </span>,
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-muted">
      {parts.map((part, index) => (
        <span key={index} className="flex shrink-0 items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          {part}
        </span>
      ))}
    </span>
  );
}

/** One agent of the list: its picture with the dot of its state, its
 * id, the moment of its last call, a line of what is going on, and a
 * count of what waits for a person. */
function Entry({
  agent,
  chosen,
  search,
  mark,
  favorite,
  onFavorite,
  short,
  draft,
  run,
}: {
  agent: FleetAgent;
  chosen: boolean;
  search: AgentsSearch;
  /** The text the list is filtered by, marked where it matched. */
  mark: string;
  favorite: boolean;
  onFavorite: () => void;
  /** Under a folder's heading the entry is its last part alone. */
  short: boolean;
  /** This browser holds an edit of the agent that was not deployed. */
  draft: boolean;
  /** A compile of the agent this browser started. */
  run: CompileRun | undefined;
}): ReactNode {
  const [clock] = useClock();
  const ground = chosen ? 'var(--ui-chosen)' : 'var(--surface)';
  const waiting = agent.asks.length;
  const bold = waiting > 0 || agent.ls.status === 'Failed';
  return (
    <div
      className={cx(
        'group relative flex h-[60px] items-center',
        chosen ? 'bg-chosen' : 'hover:bg-hover',
      )}
      style={chosen ? undefined : ({ '--surface-entry': ground } as React.CSSProperties)}
    >
      <Link
        to="/agents/$"
        params={{ _splat: agent.id }}
        search={search}
        aria-current={chosen ? 'page' : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-3 pr-3 pl-4 focus-visible:outline-offset-[-2px]"
      >
        <Avatar
          agentId={agent.id}
          dot={dotOf(agent.ls)}
          status={agent.ls.status}
          ground={chosen ? 'var(--ui-chosen)' : 'var(--surface)'}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            {short ? (
              <span
                className={cx(
                  'min-w-0 flex-1 truncate text-ink',
                  bold ? 'font-bold' : 'font-medium',
                )}
                title={agent.id}
              >
                <Marked text={idParts(agent.id).name} mark={mark} />
              </span>
            ) : (
              <AgentName agentId={agent.id} bold={bold} className="flex-1 text-left" />
            )}
            {agent.lastCallAt !== undefined && (
              <Moment
                at={agent.lastCallAt}
                className="shrink-0 text-[11px] text-ink-muted group-hover:invisible"
              >
                {listMoment(agent.lastCallAt, clock)}
              </Moment>
            )}
          </span>
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <EntryLine agent={agent} run={run} />
            </span>
            {draft && <Tag title="An edit kept in this browser, not deployed">Draft</Tag>}
            <Count value={waiting} label={`${String(waiting)} waiting for a person`} />
          </span>
        </span>
      </Link>
      <Tip label={favorite ? 'Remove from Favorites' : 'Add to Favorites'}>
        <button
          type="button"
          aria-label={favorite ? 'Remove from Favorites' : 'Add to Favorites'}
          aria-pressed={favorite}
          onClick={onFavorite}
          className={cx(
            'absolute top-1.5 right-1.5 hidden size-6 items-center justify-center rounded-md bg-inherit text-ink-muted group-hover:flex hover:text-ink focus-visible:flex',
            chosen ? 'bg-chosen' : 'bg-hover',
          )}
        >
          <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </Tip>
    </div>
  );
}

/** A new agent that was never deployed: this browser's own, in a
 * lighter print. Nothing of it is on the plane, so it has no dot. */
function DraftEntry({
  draft,
  chosen,
  search,
  run,
  known,
}: {
  draft: Draft;
  chosen: boolean;
  search: AgentsSearch;
  run: CompileRun | undefined;
  /** Whether the plane's listing was read, so that "not deployed" is known. */
  known: boolean;
}): ReactNode {
  const compile = compileWords(run);
  return (
    <Link
      to="/agents/$"
      params={{ _splat: draft.id }}
      search={search}
      aria-current={chosen ? 'page' : undefined}
      className={cx(
        'flex h-[60px] items-center gap-3 pr-3 pl-4 focus-visible:outline-offset-[-2px]',
        chosen ? 'bg-chosen' : 'hover:bg-hover',
      )}
    >
      <Avatar agentId={draft.id} faded />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <AgentName agentId={draft.id} className="text-left opacity-75" />
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="min-w-0 flex-1 truncate">
            {compile ?? (known ? 'Not deployed' : '')}
          </span>
          <Tag title="Kept in this browser, not deployed">Draft</Tag>
        </span>
      </span>
    </Link>
  );
}

/** A text with the part that matched a filter marked. */
function Marked({ text, mark }: { text: string; mark: string }): ReactNode {
  if (mark === '') return text;
  const at = text.toLowerCase().indexOf(mark.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-accent/30 text-inherit">
        {text.slice(at, at + mark.length)}
      </mark>
      {text.slice(at + mark.length)}
    </>
  );
}

/** Holds a list's order while the reader is on it, so a click never
 * lands on the agent that just slid into the place: what left is let
 * go, what came stands at the end, and the rest keeps its place until
 * the reader leaves. */
function useHeldOrder(ids: string[], held: boolean): string[] {
  const ref = useRef(ids);
  if (!held) {
    ref.current = ids;
  } else {
    const now = new Set(ids);
    const kept = ref.current.filter((id) => now.has(id));
    const known = new Set(kept);
    ref.current = [...kept, ...ids.filter((id) => !known.has(id))];
  }
  return ref.current;
}

/** The parts of the list, in the order of what is going on. */
function partsByActivity(fleet: Fleet, favorites: string[]): Part[] {
  const sampledAt = fleet.sampledAt ?? new Date().toISOString();
  const pinned = new Set(favorites);
  const own = fleet.agents.filter(
    (agent) => !agent.platform && !agent.pair && !pinned.has(agent.id),
  );
  const byId = (a: FleetAgent, b: FleetAgent): number => a.id.localeCompare(b.id);
  const active = own.filter((agent) => isActive(agent, sampledAt)).sort(byId);
  const earlier = own
    .filter((agent) => !isActive(agent, sampledAt))
    .sort((a, b) => {
      if (a.lastCallAt !== undefined && b.lastCallAt !== undefined) {
        return b.lastCallAt.localeCompare(a.lastCallAt) || byId(a, b);
      }
      if (a.lastCallAt !== undefined) return -1;
      if (b.lastCallAt !== undefined) return 1;
      return byId(a, b);
    });
  return [
    {
      key: 'favorites',
      title: 'Favorites',
      agents: favorites
        .map((id) => fleet.byId.get(id))
        .filter((agent): agent is FleetAgent => agent !== undefined),
    },
    { key: 'active', title: 'Active', hint: 'A call in the last minute, by id', agents: active },
    {
      key: 'earlier',
      title: 'Earlier',
      hint: 'By the last call, the newest first',
      agents: earlier,
    },
    {
      key: 'platform',
      title: 'Platform',
      hint: "The platform's own agents",
      agents: fleet.agents.filter((agent) => agent.platform || agent.pair).sort(byId),
      foldedAtFirst: true,
    },
  ];
}

/** The parts of the list as the workspace's tree: a heading a folder. */
function partsByFolder(fleet: Fleet): Part[] {
  const folders = new Map<string, FleetAgent[]>();
  for (const agent of fleet.agents) {
    const folder = idParts(agent.id).folder.replace(/\/$/, '') || '(no folder)';
    const held = folders.get(folder) ?? [];
    held.push(agent);
    folders.set(folder, held);
  }
  return [...folders.entries()]
    .sort(([a], [b]) => {
      const platform = (folder: string): number =>
        folder === 'cernanto' || folder.startsWith('cernanto/') ? 1 : 0;
      return platform(a) - platform(b) || a.localeCompare(b);
    })
    .map(([folder, agents]) => ({
      key: `folder:${folder}`,
      title: folder,
      agents: agents.sort((a, b) => a.id.localeCompare(b.id)),
      foldedAtFirst: folder === 'cernanto' || folder.startsWith('cernanto/'),
    }));
}

const NO_FOLDS: Record<string, boolean> = {};

/** The agent list: the head with its buttons, the filters with their
 * counts, and the agents in parts that fold. */
export function AgentList({
  fleet,
  chosen,
}: {
  fleet: Fleet;
  chosen: string | undefined;
}): ReactNode {
  const search = route.useSearch();
  const navigate = useNavigate();
  const askAgain = useAskAgain();
  const [favorites, toggleFavorite] = useFavorites();
  const [order, setOrder] = usePref<Order>('list.order', 'activity');
  const [folds, setFolds] = usePref<Record<string, boolean>>('list.folds', NO_FOLDS);
  const [searching, setSearching] = useState(search.q !== undefined);
  const [held, setHeld] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const text = search.q ?? '';
  const sampledAt = fleet.sampledAt ?? '';

  const setSearch = (next: Patch<AgentsSearch>): void => {
    void navigate({ to: '.', search: (previous) => patched(previous, next), replace: true });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setSearching(true);
        window.setTimeout(() => fieldRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const { drafts } = useDrafts();
  const compiles = useCompiles();
  // The list is three things laid over each other by id: what the plane
  // says, the compiles this browser started, and this browser's drafts.
  const unborn = useMemo(
    () =>
      Object.values(drafts)
        .filter((draft) => !fleet.byId.has(draft.id))
        .sort((a, b) => a.id.localeCompare(b.id)),
    [drafts, fleet.byId],
  );
  const own = useMemo(
    () => fleet.agents.filter((agent) => !agent.platform && !agent.pair),
    [fleet.agents],
  );
  const counts: Record<ListFilter, number> = useMemo(
    () => ({
      active: own.filter((agent) => isActive(agent, sampledAt)).length,
      failed: own.filter((agent) => agent.ls.status === 'Failed').length,
      waiting: fleet.agents.filter((agent) => agent.asks.length > 0).length,
      drafts: Object.keys(drafts).length,
    }),
    [own, fleet.agents, sampledAt, drafts],
  );

  const keep = (agent: FleetAgent): boolean => {
    if (text !== '' && !agent.id.toLowerCase().includes(text.toLowerCase())) return false;
    if (search.filter === 'active') return isActive(agent, sampledAt);
    if (search.filter === 'failed') return agent.ls.status === 'Failed';
    if (search.filter === 'waiting') return agent.asks.length > 0;
    if (search.filter === 'drafts') return drafts[agent.id] !== undefined;
    return true;
  };
  const shownUnborn = unborn.filter(
    (draft) =>
      (text === '' || draft.id.toLowerCase().includes(text.toLowerCase())) &&
      (search.filter === undefined || search.filter === 'drafts'),
  );
  const narrowed = text !== '' || search.filter !== undefined;
  // A plane that holds nothing of the reader's, deployed or drafted, and no failed reading.
  const newcomer =
    !fleet.loading &&
    (fleet.error === null || fleet.error === undefined) &&
    own.length === 0 &&
    unborn.length === 0 &&
    !narrowed;
  const parts = (order === 'folder' ? partsByFolder(fleet) : partsByActivity(fleet, favorites))
    .map((part) => ({ ...part, agents: part.agents.filter(keep) }))
    .filter((part) => part.agents.length > 0);
  const flat = parts.flatMap((part) => part.agents.map((agent) => agent.id));
  const heldOrder = useHeldOrder(flat, held);
  const place = new Map(heldOrder.map((id, index) => [id, index]));
  const remaining = new Set(flat).size;

  const folded = (part: Part): boolean =>
    narrowed ? false : (folds[part.key] ?? part.foldedAtFirst === true);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-4">
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-tight text-ink">
          Agents
        </h1>
        <Menu
          align="start"
          trigger={
            <IconButton label="Options">
              <Ellipsis size={16} />
            </IconButton>
          }
        >
          <MenuLabel>Order</MenuLabel>
          <MenuItem
            icon={order === 'activity' ? <Check size={14} /> : undefined}
            hint="What is going on"
            onSelect={() => {
              setOrder('activity');
            }}
          >
            By activity
          </MenuItem>
          <MenuItem
            icon={order === 'folder' ? <Check size={14} /> : undefined}
            hint="Where an agent lives"
            onSelect={() => {
              setOrder('folder');
            }}
          >
            By folder
          </MenuItem>
        </Menu>
        <IconButton
          label="Filter by id"
          active={searching}
          onClick={() => {
            if (searching) setSearch({ q: undefined });
            setSearching(!searching);
            window.setTimeout(() => fieldRef.current?.focus(), 0);
          }}
        >
          <Search size={16} />
        </IconButton>
        <AddMenu fleet={fleet} />
      </div>

      {searching && (
        <div className="relative shrink-0 px-3 pb-2">
          <input
            ref={fieldRef}
            value={text}
            placeholder="Filter by id"
            aria-label="Filter the agents by id"
            className="h-8 w-full rounded-md border border-line-strong bg-sunken pr-20 pl-2.5 text-[13px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
            onChange={(event) => {
              setSearch({ q: event.target.value === '' ? undefined : event.target.value });
            }}
            onKeyDown={(event) => {
              // A key an input method takes while it composes is no word to this field.
              if (composing(event)) return;
              if (event.key === 'Escape') {
                setSearch({ q: undefined });
                setSearching(false);
              } else if (event.key === 'Enter' && flat[0] !== undefined) {
                void navigate({ to: '/agents/$', params: { _splat: flat[0] }, search });
              }
            }}
          />
          <span className="figures absolute top-1.5 right-11 text-xs text-ink-muted">
            {remaining} of {fleet.agents.length}
          </span>
          <button
            type="button"
            aria-label="Clear the filter"
            className="absolute top-1 right-4 flex size-6 items-center justify-center rounded-md text-ink-muted hover:text-ink"
            onClick={() => {
              setSearch({ q: undefined });
              setSearching(false);
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pb-2.5">
        {(['active', 'failed', 'waiting', 'drafts'] as const)
          .filter((filter) => filter !== 'drafts' || counts.drafts > 0)
          .map((filter) => (
            <Chip
              key={filter}
              active={search.filter === filter}
              count={counts[filter]}
              onClick={() => {
                setSearch({ filter: search.filter === filter ? undefined : filter });
              }}
            >
              {filter === 'active'
                ? 'Active'
                : filter === 'failed'
                  ? 'Failed'
                  : filter === 'waiting'
                    ? 'Waiting'
                    : 'Drafts'}
            </Chip>
          ))}
      </div>

      {fleet.error !== null && fleet.error !== undefined && (
        <div className="shrink-0 border-y bg-sunken px-4 py-2 text-xs text-bad">
          The plane does not answer ({wordsOf(fleet.error)}).{' '}
          <button type="button" className="underline" onClick={askAgain}>
            Ask again
          </button>
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto border-t pb-4"
        onMouseEnter={() => {
          setHeld(true);
        }}
        onMouseLeave={() => {
          setHeld(false);
        }}
      >
        {fleet.loading && <Quiet>Asking the plane…</Quiet>}
        {!fleet.loading && parts.length === 0 && shownUnborn.length === 0 && (
          <Quiet>{narrowed ? 'No agent matches.' : 'This plane holds no agent yet.'}</Quiet>
        )}
        {/* On a narrow window the list is the whole screen, so a newcomer's first steps stand
            in it; on a wide one they stand beside it, where an agent would. */}
        {newcomer && (
          <div className="p-3 md:hidden">
            <FirstSteps />
          </div>
        )}
        {shownUnborn.length > 0 && (
          <section aria-label={fleet.read ? 'Not deployed yet' : 'Drafts'}>
            <div className="flex h-8 items-center gap-1 pr-4 pl-3 text-xs font-semibold text-ink-muted">
              <ChevronDown size={14} />
              {/* Where the listing was not read, a draft is not known to be undeployed. */}
              <span className="min-w-0 flex-1 truncate">
                {fleet.read ? 'Not deployed yet' : 'Drafts'}
              </span>
              <span className="figures font-normal">{shownUnborn.length}</span>
            </div>
            {shownUnborn.map((draft) => (
              <DraftEntry
                key={draft.id}
                draft={draft}
                chosen={draft.id === chosen}
                search={search}
                run={compiles.get(draft.id)}
                known={fleet.read}
              />
            ))}
          </section>
        )}
        {parts.map((part) => {
          const isFolded = folded(part);
          const agents = [...part.agents].sort(
            (a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0),
          );
          return (
            <section key={part.key} aria-label={part.title}>
              <button
                type="button"
                aria-expanded={!isFolded}
                title={part.hint}
                onClick={() => {
                  setFolds({ ...folds, [part.key]: !isFolded });
                }}
                className="flex h-8 w-full items-center gap-1 pr-4 pl-3 text-left text-xs font-semibold text-ink-muted hover:text-ink"
              >
                {isFolded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span className="min-w-0 flex-1 truncate">{part.title}</span>
                <span className="figures font-normal">{part.agents.length}</span>
              </button>
              {!isFolded &&
                agents.map((agent) => (
                  <Entry
                    key={agent.id}
                    agent={agent}
                    chosen={agent.id === chosen}
                    search={search}
                    mark={text}
                    short={order === 'folder'}
                    draft={drafts[agent.id] !== undefined}
                    run={compiles.get(agent.id)}
                    favorite={favorites.includes(agent.id)}
                    onFavorite={() => {
                      toggleFavorite(agent.id);
                    }}
                  />
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
