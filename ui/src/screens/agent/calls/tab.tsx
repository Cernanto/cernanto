// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ChevronDown, ChevronUp, GanttChart, MessagesSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { patched } from '../../../app/search.js';
import type { AgentSearch, Patch } from '../../../app/search.js';
import { plane, unwrap, wordsOf } from '../../../api/plane.js';
import { useCalls } from '../../../api/queries.js';
import { partyKind, PartyPicture, partyWord } from '../../../components/party.js';
import { Chip, cx, ErrorLine, IconButton, Moment, Quiet } from '../../../components/ui.js';
import * as gateway from '../../../gateway/sdk.gen.js';
import type { CallSummary, Traces } from '../../../gateway/types.gen.js';
import { spoken } from '../../../model/agent.js';
import { callMark, PLANE, withItsEnd } from '../../../model/conversation.js';
import { humanMs } from '../../../model/figures.js';
import { dayKey, dayLabel } from '../../../model/time.js';
import { useCallConversation } from '../../../state/live.js';
import { useClock } from '../../../state/prefs.js';
import { useOwnCalls } from '../../../state/sent.js';
import { TracesOffLine } from '../settings/traces.js';
import { CallMenu } from '../trace/callmenu.js';
import { ConversationView } from '../trace/conversation.js';
import { Running } from '../trace/message.js';
import { CallStoryCells } from './story.js';
import { Timeline } from './timeline.js';

const route = getRouteApi('/agents/$');

/** How many of an agent's newest calls the tab lists. */
const LISTED = 200;

/** How long after a call's stream closed the plane is asked again for the call. */
const ASK_AFTER_END_MS = 1500;

/** How a call stands, as the plane's facts of it say. */
function statusWord(call: CallSummary): ReactNode {
  if (call.status === 'running') {
    return (
      <span className="text-ink">
        Running <Running since={call.at} />
      </span>
    );
  }
  if (call.status === 'error') {
    return (
      <span className="text-bad">
        <span className="font-semibold">Failed</span>
        {call.error !== undefined && `: ${call.error}`}
      </span>
    );
  }
  return 'Completed';
}

/** The mark of how a call stands: a ring that turns while it runs, red when it failed. */
function StatusMark({ status }: { status: CallSummary['status'] }): ReactNode {
  if (status === 'running') return <span className="ring text-[11px]" aria-label="Running" />;
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-2 rounded-full',
        status === 'error' ? 'bg-bad' : 'border-2 border-good',
      )}
    />
  );
}

/** One call, opened over the list: its own conversation, with back and
 * with previous and next, so a reader walks the calls without returning
 * to the list. It is made anew for each call: a dialog that is open, a
 * message that is chosen and what was opened in one call are that
 * call's alone, and none of it is carried to the call the address turns
 * to. How a call is read, as a conversation or as a timeline, is the
 * tab's, and stays as the reader walks. */
function OpenCall({
  agentId,
  debug,
  callId,
  listed,
  onLoad,
  timeline,
  setTimeline,
  find,
  onFind,
}: {
  agentId: string;
  /** Whether the agent's debug lines are read and shown: its traces
   * stand at debug. */
  debug: boolean;
  callId: string;
  listed: CallSummary[];
  onLoad: ((handler: string, read: () => Promise<unknown>) => Promise<void>) | undefined;
  timeline: boolean;
  setTimeline: (timeline: boolean) => void;
  find: string | undefined;
  onFind: ((text: string | undefined) => void) | undefined;
}): ReactNode {
  const [clock] = useClock();
  const navigate = useNavigate();
  const [ownCalls] = useOwnCalls();
  const followed = useCallConversation(callId, { utc: clock === 'utc', debug });
  const tree = useQuery({
    queryKey: ['call-children', callId],
    queryFn: async () =>
      unwrap(await gateway.call({ client: plane, path: { callId } }), 'this call'),
    staleTime: 10_000,
    retry: false,
  });
  const at = listed.findIndex((entry) => entry.callId === callId);
  const newer = at > 0 ? listed[at - 1] : undefined;
  const older = at >= 0 ? listed[at + 1] : undefined;
  // How the call stands. While its stream tells it: as the stream said
  // when it opened, with the end its own last record brought, so a call
  // that ended under the reader's eyes is said to have ended and its
  // cancel leaves with its run. Once the stream closed, the plane's own
  // word of the call stands over what the stream opened with: it is
  // asked for again a moment after, when the plane has kept the end, and
  // with it come the calls this one caused.
  const closed = followed.state === 'ended';
  const told =
    (closed ? tree.data?.call : undefined) ??
    followed.call ??
    tree.data?.call ??
    (at >= 0 ? listed[at] : undefined);
  const call =
    told === undefined ? undefined : withItsEnd(told, followed.conversation.calls.get(told.callId));
  const { refetch } = tree;
  useEffect(() => {
    if (!closed) return undefined;
    const timer = window.setTimeout(() => void refetch(), ASK_AFTER_END_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [closed, refetch]);
  const go = (search: Patch<AgentSearch>): void => {
    void navigate({ to: '.', search: (previous) => patched(previous, search) });
  };

  if (followed.state === 'failed' && tree.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <IconButton
            label="Back to the calls"
            onClick={() => {
              go({ call: undefined });
            }}
          >
            <ArrowLeft size={16} />
          </IconButton>
        </div>
        <Quiet>
          No call found with this ID.
          <span className="mt-1 block">
            A call that ended is kept for a day unless this plane is set otherwise, and a link to it
            is good for that long.
          </span>
          <span className="mono mt-3 block text-xs break-all">{callId}</span>
        </Quiet>
      </div>
    );
  }

  const children = tree.data?.children ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="group/head flex h-11 shrink-0 items-center gap-1.5 border-b pr-3 pl-4 text-xs text-ink-muted">
        <IconButton
          label="Back to the calls"
          onClick={() => {
            go({ call: undefined });
          }}
        >
          <ArrowLeft size={16} />
        </IconButton>
        {call !== undefined && (
          <>
            <span className="truncate text-[13px] font-semibold text-ink">
              {spoken(call.handler)}
            </span>
            {callMark(call.callId) !== '' && (
              <span className="mono text-[11px]" title={call.callId}>
                {callMark(call.callId)}
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate">
              from{' '}
              {call.callerAgentId !== undefined &&
              partyKind(call.callerAgentId) === 'agent' &&
              call.parentCallId !== undefined ? (
                <Link
                  to="/agents/$"
                  params={{ _splat: call.callerAgentId }}
                  search={{ tab: 'calls', call: call.parentCallId }}
                  className="text-ink-secondary hover:underline"
                >
                  {call.callerAgentId}
                </Link>
              ) : (
                partyWord(call.callerAgentId ?? PLANE, ownCalls.has(call.callId))
              )}
            </span>
            <span aria-hidden="true">·</span>
            <Moment at={call.at} seconds />
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate">{statusWord(call)}</span>
            {call.status !== 'running' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="figures">{humanMs(call.durationMs)}</span>
              </>
            )}
          </>
        )}
        <span className="flex-1" />
        {call !== undefined && (
          <CallMenu
            call={call}
            debug={debug}
            standing
            {...(onLoad === undefined ? {} : { onLoad })}
          />
        )}
        <IconButton
          label={timeline ? 'As a conversation' : 'As a timeline: where the time went'}
          active={timeline}
          onClick={() => {
            setTimeline(!timeline);
          }}
        >
          {timeline ? <MessagesSquare size={15} /> : <GanttChart size={15} />}
        </IconButton>
        <IconButton
          label="The call after it"
          disabled={newer === undefined}
          onClick={() => {
            if (newer !== undefined) go({ call: newer.callId });
          }}
        >
          <ChevronUp size={16} />
        </IconButton>
        <IconButton
          label="The call before it"
          disabled={older === undefined}
          onClick={() => {
            if (older !== undefined) go({ call: older.callId });
          }}
        >
          <ChevronDown size={16} />
        </IconButton>
      </div>
      {timeline ? (
        <Timeline conversation={followed.conversation} version={followed.version} callId={callId} />
      ) : (
        <ConversationView
          open={agentId}
          followed={followed}
          ownCalls={ownCalls}
          debug={debug}
          find={find}
          onFind={onFind}
          empty={
            followed.state === 'failed' ? (
              <ErrorLine>{followed.error}</ErrorLine>
            ) : (
              <Quiet>
                {call?.status === 'running'
                  ? 'This call runs, and nothing more of it is recorded yet.'
                  : 'Nothing of this call is recorded: its function keeps no record, or its records are no longer kept.'}
              </Quiet>
            )
          }
        />
      )}
      {children.length > 0 && !timeline && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t bg-surface px-6 py-2">
          <div className="w-full">
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              The calls it caused
            </div>
            <ul className="flex flex-col">
              {children.map((child) => (
                <li key={child.callId}>
                  <Link
                    to="/agents/$"
                    params={{ _splat: child.agentId }}
                    search={{ tab: 'calls', call: child.callId }}
                    className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-hover"
                  >
                    <PartyPicture id={child.agentId} size={20} ground="var(--surface)" />
                    <span className="min-w-0 truncate text-ink">{child.agentId}</span>
                    <span className="text-ink-secondary">{spoken(child.handler)}</span>
                    <span className="flex-1" />
                    <span className="min-w-0 truncate text-xs text-ink-muted">
                      {statusWord(child)}
                    </span>
                    <span className="figures text-xs text-ink-muted">
                      {humanMs(child.durationMs)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** The Calls tab: a focused list of the agent's calls, newest first,
 * with what the plane keeps of a call without opening it. A call opens
 * to its own conversation. */
export function CallsTab({
  agentId,
  traces,
  onLoad,
  find,
  onFind,
}: {
  agentId: string;
  /** What the agent's traces stand at, as the listing says it. */
  traces?: Traces | undefined;
  /** Loads a call into the send box, its function and what it was asked;
   * absent for an agent nobody calls by hand. */
  onLoad?: (handler: string, read: () => Promise<unknown>) => Promise<void>;
  /** The text searched in an opened call's conversation, while its search is open. */
  find?: string | undefined;
  onFind?: (text: string | undefined) => void;
}): ReactNode {
  const search = route.useSearch();
  const navigate = useNavigate();
  const [clock] = useClock();
  const [ownCalls] = useOwnCalls();
  const calls = useCalls(agentId, LISTED);
  const [fn, setFn] = useState<string | undefined>(undefined);
  const [caller, setCaller] = useState<string | undefined>(undefined);
  const [timeline, setTimeline] = useState(false);
  const listed = useMemo(() => calls.data ?? [], [calls.data]);

  const shown = useMemo(
    () =>
      listed.filter((call) => {
        if (search.calls === 'running' && call.status !== 'running') return false;
        if (search.calls === 'failed' && call.status !== 'error') return false;
        if (fn !== undefined && call.handler !== fn) return false;
        if (caller !== undefined && (call.callerAgentId ?? PLANE) !== caller) return false;
        return true;
      }),
    [listed, search.calls, fn, caller],
  );
  const functions = useMemo(
    () => [...new Set(listed.map((call) => call.handler))].sort(),
    [listed],
  );
  const callers = useMemo(
    () => [...new Set(listed.map((call) => call.callerAgentId ?? PLANE))].sort(),
    [listed],
  );

  if (search.call !== undefined) {
    return (
      <OpenCall
        key={search.call}
        agentId={agentId}
        debug={traces === 'debug'}
        callId={search.call}
        listed={shown}
        onLoad={onLoad}
        timeline={timeline}
        setTimeline={setTimeline}
        find={find}
        onFind={onFind}
      />
    );
  }

  const setFilter = (next: AgentSearch['calls']): void => {
    void navigate({
      to: '.',
      search: (previous) => patched(previous, { calls: next }),
      replace: true,
    });
  };
  const count = (status: CallSummary['status']): number =>
    listed.filter((call) => call.status === status).length;

  let day = '';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-1.5 border-b px-5 py-2">
        <Chip
          active={search.calls === undefined}
          count={listed.length}
          onClick={() => {
            setFilter(undefined);
          }}
        >
          All
        </Chip>
        <Chip
          active={search.calls === 'running'}
          count={count('running')}
          onClick={() => {
            setFilter(search.calls === 'running' ? undefined : 'running');
          }}
        >
          Running
        </Chip>
        <Chip
          active={search.calls === 'failed'}
          count={count('error')}
          onClick={() => {
            setFilter(search.calls === 'failed' ? undefined : 'failed');
          }}
        >
          Failed
        </Chip>
        <span className="mx-1 h-4 w-px bg-line-strong" />
        <select
          aria-label="One function"
          value={fn ?? ''}
          onChange={(event) => {
            setFn(event.target.value === '' ? undefined : event.target.value);
          }}
          className="h-6 rounded-full border border-line-strong bg-transparent px-2 text-xs text-ink-secondary"
        >
          <option value="">Every function</option>
          {functions.map((name) => (
            <option key={name} value={name}>
              {spoken(name)}
            </option>
          ))}
        </select>
        <select
          aria-label="One caller"
          value={caller ?? ''}
          onChange={(event) => {
            setCaller(event.target.value === '' ? undefined : event.target.value);
          }}
          className="h-6 max-w-56 rounded-full border border-line-strong bg-transparent px-2 text-xs text-ink-secondary"
        >
          <option value="">Every caller</option>
          {callers.map((id) => (
            <option key={id} value={id}>
              {partyWord(id)}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {calls.isPending && <Quiet>Asking the plane…</Quiet>}
        {calls.isError && <Quiet>{wordsOf(calls.error)}</Quiet>}
        {calls.data !== undefined && shown.length === 0 && (
          <Quiet>
            {listed.length > 0 ? (
              'No call matches.'
            ) : traces === 'off' ? (
              <TracesOffLine agentId={agentId} />
            ) : (
              'No call of this agent is recorded.'
            )}
          </Quiet>
        )}
        {/* The list takes the column whole: what a call was sent and answered is as long as its room. */}
        <div className="w-full">
          {shown.map((call) => {
            const callDay = dayKey(call.at, clock);
            const head = callDay !== day;
            day = callDay;
            const from = call.callerAgentId ?? PLANE;
            return (
              <div key={call.callId}>
                {head && (
                  <div className="px-5 pt-3 pb-1 text-xs font-semibold text-ink-muted">
                    {dayLabel(call.at, clock)}
                  </div>
                )}
                {/* A call takes two lines, as a list of mail does: what was called and by
                    whom, with when and how long; under it, what was sent and what came back. */}
                <div className="group/head flex min-h-[52px] items-center hover:bg-hover">
                  <Link
                    to="."
                    search={(previous) => patched(previous, { call: call.callId })}
                    className="flex min-w-0 flex-1 items-start gap-3 py-2 pr-2 pl-5 text-[13px]"
                  >
                    <span className="mt-1.5 flex w-3 shrink-0 justify-center">
                      <StatusMark status={call.status} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 shrink-0 truncate font-medium text-ink">
                          {spoken(call.handler)}
                        </span>
                        <span className="min-w-0 truncate text-xs text-ink-muted">
                          from {partyWord(from, ownCalls.has(call.callId))}
                        </span>
                        <span className="flex-1" />
                        <Moment at={call.at} seconds className="shrink-0 text-xs text-ink-muted" />
                        <span className="figures w-14 shrink-0 text-right text-xs text-ink-muted">
                          {call.status === 'running' ? '' : humanMs(call.durationMs)}
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-3">
                        <CallStoryCells call={call} />
                      </span>
                    </span>
                  </Link>
                  <span className="flex w-9 shrink-0 justify-center">
                    <CallMenu call={call} debug={traces === 'debug'} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {listed.length >= LISTED && (
          <Quiet className="py-6">
            These are the {LISTED} newest calls. The plane answers no older page of an agent's calls
            yet.
          </Quiet>
        )}
      </div>
    </div>
  );
}
