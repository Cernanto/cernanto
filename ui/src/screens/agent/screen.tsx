// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { getRouteApi, Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, PanelRight, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { AGENT_TABS, agentsSearch, patched, standingHere } from '../../app/search.js';
import type { AgentTab } from '../../app/search.js';
import { useAgents } from '../../api/queries.js';
import { TypeWord } from '../../components/agent-type.js';
import { AgentName, Avatar, Count, cx, IconButton, Quiet } from '../../components/ui.js';
import { callable, dotOf } from '../../model/agent.js';
import { useFleet } from '../../model/fleet.js';
import type { FleetAgent } from '../../model/fleet.js';
import { SIDE_PANEL_FROM, sidePanelOpen } from '../../model/layout.js';
import { currentDraft, useDrafts, withFiles } from '../../state/drafts.js';
import { useMedia } from '../../state/media.js';
import { usePref } from '../../state/prefs.js';
import { CallsTab } from './calls/tab.js';
import { CodeTab } from './code/tab.js';
import { ContractTab } from './contract/tab.js';
import { AgentMenu } from './menu.js';
import { SidePanel } from './panel.js';
import { SettingsTab } from './settings/tab.js';
import { SourceEditor } from './source/editor.js';
import { SourceTab } from './source/tab.js';
import type { Loaded } from './trace/sendbox.js';
import { TraceTab } from './trace/tab.js';

const route = getRouteApi('/agents/$');

/** The reader has not pressed the side panel's button yet. */
const PANEL_NOT_CHOSEN: boolean | null = null;

const TAB_WORDS: Record<AgentTab, string> = {
  trace: 'Trace',
  calls: 'Calls',
  source: 'Source',
  settings: 'Settings',
  contract: 'Contract',
  // What the compile wrote from the source. Its address keeps the word
  // it had, `code`, so a link kept from before still opens it.
  code: 'Compiled',
};

/** What an agent is and how it stands, beside its id: its kind, its
 * status in the plane's own word, its copies ready of those wanted, and
 * the generation that serves. */
function Standing({
  agent,
  generation,
}: {
  agent: FleetAgent;
  generation: number | undefined;
}): ReactNode {
  const row = agent.ls;
  const parts: string[] = [row.status];
  if (row.type !== 'module' && row.type !== 'interface') {
    const [ready, wanted] = row.ready.split('/');
    if (wanted !== undefined && wanted !== '0') {
      parts.push(`${ready ?? '0'} of ${wanted} ${wanted === '1' ? 'copy' : 'copies'}`);
    }
    if (generation !== undefined) parts.push(`generation ${String(generation)}`);
  }
  return (
    <span
      className="flex min-w-0 items-center text-xs text-ink-muted"
      title={`${row.type} · ${parts.join(' · ')}`}
    >
      {/* The kind's point stands as the points between the words after it do. */}
      <span className="hidden shrink-0 items-center whitespace-pre sm:flex">
        <TypeWord type={row.type} />
        <span aria-hidden="true">{' · '}</span>
      </span>
      <span className={cx('min-w-0 truncate', row.status === 'Failed' && 'text-bad')}>
        {parts.join(' · ')}
      </span>
    </span>
  );
}

/** An agent's screen: its head in two lines, who it is and how it
 * stands and then its six tabs, the chosen tab's screen, and its side
 * panel. */
export function AgentScreen(): ReactNode {
  const { _splat: agentId = '' } = route.useParams();
  const search = route.useSearch();
  const fleet = useFleet();
  const shipped = useAgents();
  // The side panel stands as the reader last chose with its button; before
  // they chose, open on a wide window and closed on a narrow one.
  const [chosenPanel, setPanel] = usePref<boolean | null>('panel.shown', PANEL_NOT_CHOSEN);
  const wide = useMedia(`(min-width: ${String(SIDE_PANEL_FROM)}px)`);
  const panel = sidePanelOpen(chosenPanel, wide);
  const navigate = useNavigate();
  const { drafts, save, discard, rename } = useDrafts();
  const draft = drafts[agentId];
  const agent = fleet.byId.get(agentId);
  const tab: AgentTab = search.tab ?? 'trace';
  // What the reader asked the send box to hold: a function chosen in the
  // bar's field, or a call loaded from a conversation or from the Calls
  // tab with what it was asked. It is held for the agent it was asked
  // of, until the box took it; each asking is a new one, so the same
  // function asked twice fills the box twice.
  const [boxed, setBoxed] = useState<{ agent: string; loaded: Loaded } | undefined>(undefined);
  const loaded = boxed?.agent === agentId ? boxed.loaded : undefined;
  // A call is loaded with what it was asked, which is read from the plane
  // first, and that read may be answered a while later. The box takes
  // the newest thing that was asked of it and no older one: a loading
  // whose read comes back after another loading was asked, after a
  // function was chosen in the bar's field, after the reader pressed a
  // key or the pointer in the box, or after they went elsewhere, is let
  // go. Each of those counts one asking more, and a read is taken only
  // while its own count is still the last.
  const asking = useRef(0);
  const load = async (
    handler: string,
    read: () => Promise<unknown>,
    taken?: () => void,
  ): Promise<void> => {
    asking.current += 1;
    const mine = asking.current;
    const here = standingHere();
    const args = await read();
    if (asking.current !== mine || !here()) return;
    setBoxed({ agent: agentId, loaded: { handler, args, stamp: Date.now() } });
    taken?.();
  };
  // The same count answers for what leads the reader away from the
  // conversation a while after they asked: an answer that comes after
  // they turned to the box, to write in it or to load it, takes them
  // from nothing they are doing.
  const boxUntouched = (): (() => boolean) => {
    const mine = asking.current;
    return () => asking.current === mine;
  };
  // The bar's field leads to a function by a mark after the address. The
  // mark is said once: it is handed to the box and leaves the address,
  // so that choosing the same function again is a new mark.
  const hash = useRouterState({ select: (state) => state.location.hash });
  const enter = hash.startsWith('send:') ? hash.slice('send:'.length) : undefined;
  useEffect(() => {
    if (enter === undefined) return;
    asking.current += 1;
    setBoxed({ agent: agentId, loaded: { handler: enter, args: undefined, stamp: Date.now() } });
    void navigate({ to: '.', search: (previous) => previous, replace: true });
  }, [enter, agentId, navigate]);
  // The tab that is open stands in sight in a row that was moved sideways.
  const tabsRow = useRef<HTMLElement>(null);
  useEffect(() => {
    tabsRow.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab, agentId]);
  // An address made while the contract and the tests were readings of the
  // Compiled tab is written over by the one that says the same today, so its
  // old word rides on no link of the screen it opened.
  const older = useRouterState({
    select: (state) => (state.location.search as Record<string, unknown>)['reading'] !== undefined,
  });
  useEffect(() => {
    if (!older) return;
    // The router has already laid today's words over the address; the old one is taken out of it.
    void navigate({
      to: '.',
      search: (previous) => patched(previous as Record<string, unknown>, { reading: undefined }),
      replace: true,
    });
  }, [older, navigate]);
  // The search of the open conversation: the text as it is typed, held
  // for the agent it was typed on, and carried in the address once it
  // is a text, so a link opens the same search.
  const [finding, setFinding] = useState<{ agent: string; text: string } | undefined>(() =>
    search.find === undefined ? undefined : { agent: agentId, text: search.find },
  );
  const findText = finding?.agent === agentId ? finding.text : undefined;
  const onFind = (text: string | undefined): void => {
    setFinding(text === undefined ? undefined : { agent: agentId, text });
    void navigate({
      to: '.',
      search: (previous) =>
        patched(previous, { find: text === undefined || text.trim() === '' ? undefined : text }),
      replace: true,
    });
  };

  if (agent === undefined) {
    // A new agent that was never deployed stands in this browser alone.
    // A listing that was not read lists no agent, and says nothing of
    // whether one stands under the draft's id: the draft is written on,
    // and is neither said to be new nor deployed as new until a listing
    // was read.
    if (draft !== undefined && !fleet.loading) {
      return (
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <header className="flex h-[52px] shrink-0 items-center gap-3 border-b bg-ground pr-3 pl-5">
            <Link
              to="/agents"
              search={agentsSearch(search)}
              className="-ml-2 flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink md:hidden"
              aria-label="Back to the agents"
            >
              <ArrowLeft size={18} />
            </Link>
            <Avatar agentId={draft.id} faded ground="var(--ground)" />
            <AgentName agentId={draft.id} className="text-left text-[15px]" />
            <span className="text-xs text-ink-muted">
              {!fleet.read
                ? 'Not checked against the plane'
                : fleet.occupied(draft.id)
                  ? 'An agent stands under this id'
                  : 'Not deployed'}
            </span>
          </header>
          <SourceEditor
            key={draft.id}
            draft={draft}
            // A new agent is a draft from its first line on.
            held
            deployed={undefined}
            fleet={fleet}
            unchecked={!fleet.read}
            onChange={(text, files) => {
              // The draft as the browser holds it now: a file's bytes are
              // kept before the change that names it is made.
              const stands = currentDraft(draft.id) ?? draft;
              save(
                withFiles(
                  { ...stands, text, updatedAt: new Date().toISOString() },
                  files ?? stands.files ?? [],
                ),
              );
            }}
            onRename={async (to) => {
              // The move is answered a moment later: a reader who went
              // elsewhere meanwhile is not brought back to the draft.
              const here = standingHere();
              const moved = await rename(draft.id, to);
              // Moved, or kept under both ids where the browser offers no
              // lock: either way the reader goes on under the new one.
              if ((moved === 'moved' || moved === 'copied') && here()) {
                void navigate({ to: '/agents/$', params: { _splat: to }, replace: true });
              }
              return moved;
            }}
            onDiscard={() => {
              discard(draft.id);
              void navigate({ to: '/agents' });
            }}
            onRebase={() => undefined}
            // When the new agent ships, its screen stands on its Source
            // tab, where the compile's last word still shows.
            onBegin={() => {
              void navigate({
                to: '.',
                search: (previous) => patched(previous, { tab: 'source' }),
                replace: true,
              });
            }}
          />
        </div>
      );
    }
    return (
      <Quiet className="flex-1">
        {fleet.loading
          ? 'Asking the plane…'
          : !fleet.read
            ? "The plane's agents could not be read."
            : fleet.occupied(agentId)
              ? `The plane's listing does not show "${agentId}" yet.`
              : `This plane holds no agent "${agentId}".`}
      </Quiet>
    );
  }

  const generation = shipped.data?.generations.find(
    (entry) => entry.agentId === agentId && entry.status === 'active',
  )?.gen;
  const waiting = agent.asks.length;
  // A conversation stands on the Trace tab and on one call opened in Calls.
  const searchable =
    agent.ls.type !== 'interface' &&
    (tab === 'trace' || (tab === 'calls' && search.call !== undefined));
  const find = searchable ? findText : undefined;

  return (
    <div className="relative flex h-full min-w-0 flex-1">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b bg-ground">
          <div className="flex h-[52px] items-center gap-3 pr-3 pl-5">
            <Link
              to="/agents"
              search={agentsSearch(search)}
              className="-ml-2 flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink md:hidden"
              aria-label="Back to the agents"
            >
              <ArrowLeft size={18} />
            </Link>
            <Avatar
              agentId={agent.id}
              dot={dotOf(agent.ls)}
              status={agent.ls.status}
              ground="var(--ground)"
            />
            <button
              type="button"
              className="flex min-w-0 shrink items-baseline text-left text-[15px]"
              onClick={() => {
                setPanel(true);
              }}
              title="Open the side panel"
            >
              <AgentName agentId={agent.id} className="text-left" />
            </button>
            <Standing agent={agent} generation={generation} />
            <span className="flex-1" />
            {searchable && (
              <IconButton
                label={find === undefined ? 'Search this conversation' : 'Close the search'}
                active={find !== undefined}
                onClick={() => {
                  onFind(find === undefined ? '' : undefined);
                }}
              >
                <Search size={16} />
              </IconButton>
            )}
            <IconButton
              label={panel ? 'Close the side panel' : 'Open the side panel'}
              active={panel}
              onClick={() => {
                setPanel(!panel);
              }}
            >
              <PanelRight size={16} />
            </IconButton>
            {/* What a menu or a panel holds of one agent, a dialog that is open or a field
                half typed, is that agent's alone: each is made anew for another agent. */}
            <AgentMenu key={agent.id} agent={agent} fleet={fleet} />
          </div>
          {/* Where the window is too narrow for the six, the row is moved sideways. */}
          <nav
            ref={tabsRow}
            className="quiet-scroll flex h-9 items-stretch gap-5 overflow-x-auto px-5"
            aria-label="The agent's tabs"
          >
            {AGENT_TABS.map((name) => (
              <Link
                key={name}
                to="."
                search={(previous) =>
                  patched(previous, {
                    tab: name === 'trace' ? undefined : name,
                    call: undefined,
                    calls: undefined,
                  })
                }
                // The tab that is open is the one link named as current: the
                // first tab's address is the start of every other's.
                activeOptions={{ exact: true, includeSearch: true }}
                aria-current={tab === name ? 'page' : undefined}
                className={cx(
                  'relative flex shrink-0 items-center gap-1.5 text-[13px] whitespace-nowrap transition-colors duration-150',
                  tab === name ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {TAB_WORDS[name]}
                {/* A login that waits is answered in Settings alone: its word
                    says so from every tab. */}
                {name === 'settings' && (
                  <Count value={waiting} label={`${String(waiting)} waiting for a person`} />
                )}
                {tab === name && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
              </Link>
            ))}
          </nav>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'trace' && (
            <TraceTab
              key={agent.id}
              agent={agent}
              fleet={fleet}
              arriveAt={search.call}
              loaded={loaded}
              onLoad={load}
              onLoaded={() => {
                setBoxed(undefined);
              }}
              onTouched={() => {
                asking.current += 1;
              }}
              boxUntouched={boxUntouched}
              find={find}
              onFind={onFind}
            />
          )}
          {tab === 'calls' && (
            <CallsTab
              key={agent.id}
              agentId={agent.id}
              traces={agent.ls.traces}
              find={find}
              onFind={onFind}
              // A call is loaded into the box of the conversation, with what
              // it was asked; the reader is taken to the box once it was read.
              {...(callable(agent.ls.type)
                ? {
                    onLoad: (handler: string, read: () => Promise<unknown>) =>
                      load(handler, read, () => {
                        void navigate({
                          to: '.',
                          search: (previous) =>
                            patched(previous, { tab: undefined, call: undefined }),
                        });
                      }),
                  }
                : {})}
            />
          )}
          {tab === 'source' && <SourceTab key={agent.id} agent={agent} fleet={fleet} />}
          {tab === 'settings' && <SettingsTab key={agent.id} agent={agent} fleet={fleet} />}
          {tab === 'contract' && <ContractTab key={agent.id} agent={agent} />}
          {tab === 'code' && <CodeTab key={agent.id} agent={agent} />}
        </div>
      </div>
      {panel && (
        <SidePanel
          key={agent.id}
          agent={agent}
          fleet={fleet}
          onClose={() => {
            setPanel(false);
          }}
        />
      )}
    </div>
  );
}
