// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  LayoutGrid,
  Moon,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sun,
  User,
  Users,
} from 'lucide-react';
import { Popover, Tooltip } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import { PLANE_ADDRESS, PLANE_ORIGIN, PlaneError, unansweredWords, wordsOf } from '../api/plane.js';
import { useAskAgain, useAuth, useLs, usePlaneReach } from '../api/queries.js';
import { Mark } from '../components/mark.js';
import { PlaneKinds, PlaneNameField, WhatAKindDecides } from '../components/plane.js';
import {
  Button,
  Count,
  cx,
  IconButton,
  Menu,
  MenuItem,
  MenuLabel,
  MenuLine,
  Moment,
  Tag,
  Tip,
} from '../components/ui.js';
import { isPlatform } from '../model/agent.js';
import { BESIDE } from '../model/layout.js';
import { ownMachine, planeLabel } from '../model/plane.js';
import { useMedia } from '../state/media.js';
import { usePlane } from '../state/plane.js';
import { useClock, usePref } from '../state/prefs.js';
import { useLook } from '../state/theme.js';
import { SearchField } from './search-field.js';

/** What the reader says of this plane, under the bar: its kind, one of
 * four with what they decide, and a name of their own for it. Each is
 * kept as it is chosen or typed, so the bar above shows it at once. */
function ThisPlane({ asking, onDone }: { asking: boolean; onDone: () => void }): ReactNode {
  const [plane, say] = usePlane();
  return (
    <div className="flex w-[380px] max-w-[calc(100vw-24px)] flex-col gap-4 p-4">
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="shrink-0 text-[14px] font-semibold text-ink">
            {asking ? 'What kind of plane is this?' : 'This plane'}
          </h2>
          <span className="mono min-w-0 truncate text-xs text-ink-muted">{PLANE_ADDRESS}</span>
        </div>
        <p className="mt-1 text-xs leading-snug text-ink-muted">
          Its kind and its name stand at the top of every screen, so a call or a delete is never
          made on the wrong plane.
        </p>
        {!plane.chosen && (
          <p className="mt-1.5 text-xs leading-snug text-ink-secondary">
            {ownMachine(PLANE_ADDRESS)
              ? "It was reached at this machine's own address, so it starts as LOCAL."
              : 'It was reached at another address, so it is handled as PRODUCTION until you choose.'}
          </p>
        )}
      </div>
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-ink">Kind</h3>
        <PlaneKinds />
        <div className="mt-3">
          <WhatAKindDecides />
        </div>
      </section>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink">
          Name <span className="font-normal text-ink-muted">· optional</span>
        </span>
        <PlaneNameField />
        <span className="text-xs leading-snug text-ink-muted">
          A word of your own, shown at the top in place of the address.
        </span>
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">Kept in this browser.</span>
        <Button
          look="main"
          onClick={() => {
            // Asked what the plane is, the reader who leaves the kind as it stands has answered.
            if (asking) say({ kind: plane.kind });
            onDone();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

/** Where the reader is, always in sight: the plane's kind beside its
 * name, or beside its address while the reader gave it no name. A plane
 * reached at another address than this machine's is asked about once. */
function WhereTheReaderIs(): ReactNode {
  const [plane] = usePlane();
  const [asked, setAsked] = usePref<boolean>('plane.asked', false);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const unasked = !plane.chosen && !asked && !ownMachine(PLANE_ADDRESS);
  useEffect(() => {
    if (!unasked) return;
    setAsking(true);
    setOpen(true);
  }, [unasked]);
  const close = (): void => {
    setOpen(false);
    setAsked(true);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setAsking(false);
          setOpen(true);
        } else close();
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-hover data-[state=open]:bg-hover"
          aria-label={`This plane, ${planeLabel(plane, PLANE_ADDRESS)}, ${plane.kind}. Choose its kind or name it`}
          title="This plane's kind and name"
        >
          <span
            className={cx(
              'truncate text-[13px] text-ink',
              plane.name === '' ? 'mono' : 'font-semibold',
            )}
          >
            {planeLabel(plane, PLANE_ADDRESS)}
          </span>
          <Tag filled={plane.kind === 'PRODUCTION'}>{plane.kind}</Tag>
          <ChevronDown size={13} className="shrink-0 text-ink-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={8} className="sheet z-[60]">
          <ThisPlane asking={asking} onDone={close} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Whether the screen is fresh, and whether the plane is reached: when
 * the plane last answered the list of agents, with the button that
 * asks again. It says so in red from the first request of the page's
 * that got no answer until the next that gets one, and where the plane
 * answered but its list could not be read; the moment of the last list
 * that was read stays beside it, and the reason is under the pointer.
 */
function Freshness(): ReactNode {
  const ls = useLs();
  const reach = usePlaneReach();
  const askAgain = useAskAgain();
  // The plane answering again, after a request it did not answer, is
  // the moment to ask it for what the screens show: once, and by no clock.
  const wasLost = useRef(false);
  useEffect(() => {
    if (!reach.answered) {
      wasLost.current = true;
      return;
    }
    if (wasLost.current) {
      wasLost.current = false;
      askAgain();
    }
  }, [reach.answered, askAgain]);
  if (!reach.answered || ls.isError) {
    const why = reach.answered ? wordsOf(ls.error) : unansweredWords(reach.cause ?? '');
    return (
      // The plane's own words may end with no stop of their own.
      <Tip label={`${/[.!?]$/.test(why) ? why : `${why}.`} Press to ask again.`}>
        <button
          type="button"
          onClick={askAgain}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-bad hover:bg-hover"
        >
          <RefreshCw size={13} className={cx('shrink-0', ls.isFetching && 'animate-spin')} />
          <span className="whitespace-nowrap">
            {reach.answered ? 'Not updated' : 'Not connected'}
          </span>
          {ls.data !== undefined && (
            <span className="whitespace-nowrap text-ink-muted max-md:hidden">
              {/* The blank before the point is for a reader who hears the line. */}
              {' · updated '}
              <Moment at={ls.data.sampledAt} />
            </span>
          )}
        </button>
      </Tip>
    );
  }
  return (
    <Tip label="Ask the plane again">
      <button
        type="button"
        onClick={askAgain}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted hover:bg-hover hover:text-ink"
      >
        <RefreshCw size={13} className={cx(ls.isFetching && 'animate-spin')} />
        {ls.data === undefined ? (
          'Loading'
        ) : (
          <span>
            Updated <Moment at={ls.data.sampledAt} />
          </span>
        )}
      </button>
    </Tip>
  );
}

/** The reader's menu: the clock, the look, and Settings. */
function ReaderMenu(): ReactNode {
  const [clock, setClock] = useClock();
  const [look, turnLook] = useLook();
  const navigate = useNavigate();
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label="Your menu"
          className="flex size-8 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-secondary hover:text-ink"
        >
          <User size={16} />
        </button>
      }
    >
      <MenuLabel>Signed in</MenuLabel>
      <div className="px-2 pb-1 text-[13px] text-ink-secondary">
        The operator of this machine, <span className="mono text-xs">local</span>
      </div>
      <MenuLine />
      <MenuLabel>Clock</MenuLabel>
      <MenuItem
        icon={clock === 'local' ? <Check size={14} /> : undefined}
        onSelect={() => {
          setClock('local');
        }}
      >
        Local time
      </MenuItem>
      <MenuItem
        icon={clock === 'utc' ? <Check size={14} /> : undefined}
        onSelect={() => {
          setClock('utc');
        }}
      >
        UTC
      </MenuItem>
      <MenuLine />
      <MenuItem icon={look === 'dark' ? <Sun size={14} /> : <Moon size={14} />} onSelect={turnLook}>
        {look === 'dark' ? 'Light look' : 'Dark look'}
      </MenuItem>
      <MenuItem
        icon={<SettingsIcon size={14} />}
        onSelect={() => {
          void navigate({ to: '/settings' });
        }}
      >
        Settings
      </MenuItem>
    </Menu>
  );
}

/** Whether an agent stands open beside the list. A way to the Agents
 * screen then leads nowhere new, and is held from opening the agent
 * afresh: its tab and its place in the conversation stay. */
function useAgentOpen(): boolean {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const beside = useMedia(BESIDE);
  return beside && path.startsWith('/agents/') && path.length > '/agents/'.length;
}

/** What holds a link where the reader already is: a press of it goes nowhere. */
const STAY = {
  onClick: (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
  },
};

/** The bar across the top. */
function TopBar(): ReactNode {
  const [plane] = usePlane();
  const [clock] = useClock();
  const [searching, setSearching] = useState(false);
  const agentOpen = useAgentOpen();
  return (
    <header
      className={cx(
        'relative flex h-12 shrink-0 items-center gap-2 border-b bg-sunken px-3',
        plane.kind === 'PRODUCTION' && 'border-b-2 border-b-ink',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Tip label="Agents">
          <Link
            to="/agents"
            className="flex h-8 shrink-0 items-center gap-2 rounded-md px-1.5 hover:bg-hover"
            aria-label="Cernanto, to the agents"
            {...(agentOpen ? STAY : {})}
          >
            <Mark />
            <span className="hidden text-[15px] font-semibold tracking-tight text-ink lg:inline">
              Cernanto
            </span>
          </Link>
        </Tip>
        <span className="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <WhereTheReaderIs />
      </div>
      <SearchField open={searching} onOpenChange={setSearching} />
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {/* Where the bar has no room for the field, this button lays it across the bar. */}
        <IconButton
          label="Go to an agent or a function"
          className="md:hidden"
          onClick={() => {
            setSearching(true);
          }}
        >
          <Search size={16} />
        </IconButton>
        {clock === 'utc' && <Tag title="Every time on the screen is in UTC">UTC</Tag>}
        <Freshness />
        <ReaderMenu />
      </div>
    </header>
  );
}

/** One button of the rail: an icon with its word under it. */
function RailButton({
  to,
  label,
  active,
  stay = false,
  count,
  countLabel,
  children,
}: {
  to: '/agents' | '/overview' | '/settings';
  label: string;
  active: boolean;
  /** The reader stands where the button leads: a press of it goes nowhere. */
  stay?: boolean;
  count?: number;
  countLabel?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Link
      to={to}
      {...(stay ? STAY : {})}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-[52px] w-full flex-col items-center justify-center gap-0.5 text-[10px] leading-none transition-colors duration-150',
        active ? 'text-ink' : 'text-ink-muted hover:text-ink',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-sm bg-accent" />}
      <span className="relative">
        {children}
        {count !== undefined && count > 0 && (
          <span className="absolute -top-1.5 -right-2.5">
            <Count value={count} {...(countLabel === undefined ? {} : { label: countLabel })} />
          </span>
        )}
      </span>
      <span className={cx(active && 'font-semibold')}>{label}</span>
    </Link>
  );
}

/** The rail at the far left: the agents first, where the work is, then
 * the whole plane on one screen, with the count of what needs a person. */
function Rail(): ReactNode {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const agentOpen = useAgentOpen();
  const auth = useAuth();
  const ls = useLs();
  const waiting = auth.data?.asks.length ?? 0;
  const failed =
    ls.data?.agents.filter((row) => row.status === 'Failed' && !isPlatform(row.agentId)).length ??
    0;
  return (
    <nav
      aria-label="Screens"
      className="flex w-14 shrink-0 flex-col items-center border-r bg-sunken pt-1 pb-2"
    >
      <RailButton to="/agents" label="Agents" active={path.startsWith('/agents')} stay={agentOpen}>
        <Users size={20} strokeWidth={1.75} />
      </RailButton>
      <RailButton
        to="/overview"
        label="Overview"
        active={path.startsWith('/overview')}
        count={waiting + failed}
        countLabel="Needs a person"
      >
        <LayoutGrid size={20} strokeWidth={1.75} />
      </RailButton>
      <span className="flex-1" />
      <RailButton to="/settings" label="Settings" active={path.startsWith('/settings')}>
        <SettingsIcon size={20} strokeWidth={1.75} />
      </RailButton>
    </nav>
  );
}

/**
 * What the window shows where the plane refuses a reader that carries
 * no token. The gateway takes such a request from its own machine
 * alone, and this UI asks for no token, so it serves that machine: from
 * another one it says so, with the two ways on.
 */
function Refused(): ReactNode {
  const port = PLANE_ADDRESS.split(':').at(-1) ?? '';
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="max-w-[540px] text-[13px] text-ink-secondary">
        <h1 className="text-lg font-semibold text-ink">
          This screen serves the machine the plane runs on
        </h1>
        <p className="mt-3">
          The plane at <span className="mono text-ink">{PLANE_ADDRESS}</span> answers a request that
          carries no token from its own machine alone, and this browser reached it from another.
        </p>
        <p className="mt-2">
          On the plane's machine, open{' '}
          <span className="mono text-ink">http://127.0.0.1:{port}/</span>.
        </p>
        <p className="mt-2">
          From this machine the cli reaches the plane with an operator's token, made on the plane's
          machine by <span className="mono text-ink">cernanto token create</span>:
        </p>
        <pre className="mono mt-2 overflow-x-auto rounded-md bg-sunken px-3 py-2 text-xs text-ink">
          cernanto login {PLANE_ORIGIN} --token &lt;token&gt;
        </pre>
      </div>
    </div>
  );
}

/** The window: the bar across the top, the rail, and the screen. */
export function Shell(): ReactNode {
  const ls = useLs();
  const refused =
    ls.data === undefined && ls.error instanceof PlaneError && ls.error.status === 401;
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={200}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <Rail />
          <main className="flex min-w-0 flex-1">{refused ? <Refused /> : <Outlet />}</main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
