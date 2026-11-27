// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useQueries } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDown, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';

import { plane, unwrap, wordsOf } from '../../../api/plane.js';
import { standingHere } from '../../../app/search.js';
import { readCall } from '../../../api/queries.js';
import { cx, IconButton, Quiet } from '../../../components/ui.js';
import { partyKind } from '../../../components/party.js';
import * as gateway from '../../../gateway/sdk.gen.js';
import {
  childAsked,
  Conversation,
  findIn,
  itemsOf,
  needleOf,
  withHeardEnd,
} from '../../../model/conversation.js';
import type { CallState, HeardEnd, Item, Message } from '../../../model/conversation.js';
import { countWord } from '../../../model/figures.js';
import { composing } from '../../../model/keys.js';
import { dayKey } from '../../../model/time.js';
import type { Followed } from '../../../state/live.js';
import { useClock } from '../../../state/prefs.js';
import { Searched } from './body.js';
import { CallHead, DayLine, MessageRow, OwnState } from './message.js';
import type { Depth } from './message.js';

/**
 * The search of a conversation: a text, how many of the messages the
 * browser holds say it and which of them the search stands on, with the
 * one before and the one after. It says what it searched, since the
 * calls the browser did not load are not among them.
 */
function FindBar({
  text,
  count,
  place,
  held,
  onText,
  onStep,
  onClose,
}: {
  text: string;
  /** How many messages hold the text. */
  count: number;
  /** Which of them the search stands on, from the oldest; 0 for none. */
  place: number;
  /** How many messages the conversation holds. */
  held: number;
  onText: (text: string) => void;
  onStep: (by: number) => void;
  onClose: () => void;
}): ReactNode {
  const typed = needleOf(text) !== '';
  return (
    <div
      role="search"
      className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-surface px-4 py-1.5"
    >
      <label className="flex h-7 min-w-0 flex-1 basis-56 items-center gap-2 rounded-md border border-line-strong bg-ground px-2 focus-within:border-accent">
        <Search size={13} className="shrink-0 text-ink-muted" />
        <input
          autoFocus
          type="text"
          value={text}
          aria-label="Search this conversation"
          placeholder="Search this conversation"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
          onChange={(event) => {
            onText(event.target.value);
          }}
          onKeyDown={(event) => {
            // A key an input method takes while it composes is no step of the search.
            if (composing(event)) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              onStep(event.shiftKey ? 1 : -1);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
      </label>
      <span className="figures shrink-0 text-xs text-ink-secondary" aria-live="polite">
        {!typed ? '' : count === 0 ? 'No match' : `${String(place)} of ${String(count)}`}
      </span>
      <IconButton
        label="The match before it (Enter)"
        disabled={count === 0}
        onClick={() => {
          onStep(-1);
        }}
      >
        <ChevronUp size={15} />
      </IconButton>
      <IconButton
        label="The match after it (Shift+Enter)"
        disabled={count === 0}
        onClick={() => {
          onStep(1);
        }}
      >
        <ChevronDown size={15} />
      </IconButton>
      <span className="min-w-0 shrink text-xs text-ink-muted">
        Searched the {countWord(held)} {held === 1 ? 'message' : 'messages'} loaded here. Earlier
        calls are in the Calls tab.
      </span>
      <IconButton label="Close the search (Esc)" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </div>
  );
}

/** A row of the column that is no record's: something the tab itself
 * shows after the conversation, a call being sent among it. */
export interface Extra {
  key: string;
  render: () => ReactNode;
}

type Row = Item | { type: 'extra'; key: string; extra: Extra };

/**
 * A conversation's column: only what is in sight is in the document,
 * it stays at its foot as records arrive, and it holds still and
 * counts while the reader is elsewhere in it or holds something.
 */
export function ConversationView({
  open,
  followed,
  ownCalls,
  extras = NO_EXTRAS,
  heard,
  arriveAt,
  debug = false,
  empty,
  callActions,
  head,
  find,
  onFind,
  boxUntouched,
}: {
  /** The agent whose screen this is. */
  open: string;
  followed: Followed;
  /** The requests the reader sent from this browser. */
  ownCalls: ReadonlySet<string>;
  extras?: Extra[];
  /** The ends of calls the reader's own requests heard and the
   * conversation's records do not say, by call: each stands for how its
   * call ended, in its head line, under its request and in its actions,
   * until a record of the end is read. */
  heard?: ReadonlyMap<string, HeardEnd>;
  /** A call the reader was taken to: its first message is brought to the middle and lit. */
  arriveAt?: string | undefined;
  debug?: boolean;
  empty: ReactNode;
  /** The actions a call's head line carries. */
  callActions?: (call: CallState) => ReactNode;
  /** What stands above the first message. */
  head?: ReactNode;
  /** The text searched in what the conversation holds; undefined while no search is open. */
  find?: string | undefined;
  /** Takes the text as it is typed, and undefined when the search is closed. */
  onFind?: ((text: string | undefined) => void) | undefined;
  /** Where a send box stands under the conversation: marks a moment,
   * and answers later whether the reader left the box alone since. */
  boxUntouched?: (() => () => boolean) | undefined;
}): ReactNode {
  const [clock] = useClock();
  const navigate = useNavigate();
  const list = useRef<VirtuosoHandle>(null);
  const [atFoot, setAtFoot] = useState(true);
  const [held, setHeld] = useState(false);
  const [seen, setSeen] = useState(0);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [lit, setLit] = useState<string | undefined>(undefined);
  const [wholes, setWholes] = useState<ReadonlySet<string>>(new Set());
  const [depths, setDepths] = useState<ReadonlyMap<string, Depth>>(new Map());
  const [trouble, setTrouble] = useState<string | undefined>(undefined);

  const { conversation, version } = followed;
  const rows = useMemo<Row[]>(
    () => [
      ...itemsOf(conversation, (at) => dayKey(at, clock), debug),
      ...extras.map((extra): Row => ({ type: 'extra', key: extra.key, extra })),
    ],
    // The conversation is one object that grows; its version says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation, version, clock, debug, extras],
  );

  // What came since the reader last stood at the foot, counted by the
  // messages the conversation took in: the ones it holds are held to a
  // bound, so their number stands still once it is reached.
  const following = atFoot && !held && chosen === undefined;
  useEffect(() => {
    if (following) setSeen(conversation.arrived);
  }, [following, conversation, version]);
  const unseen = Math.max(0, conversation.arrived - seen);

  // The view's detailed reading, asked a call at a time when a message of it is opened.
  const detailCalls = useMemo(() => {
    const calls = new Set<string>();
    for (const [key, depth] of depths) {
      if (depth !== 'details') continue;
      const message = conversation.messages.find((entry) => entry.key === key);
      if (message !== undefined) calls.add(message.callId);
    }
    return [...calls];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depths, conversation, version]);
  const details = useQueries({
    queries: detailCalls.map((callId) => ({
      queryKey: ['call-details', callId, clock, debug] as const,
      queryFn: async (): Promise<Map<string, Message>> => {
        const answer = await readCall(callId, { details: true, utc: clock === 'utc', debug });
        const detailed = new Conversation();
        answer.records.forEach((record, index) => detailed.add(record, answer.lines[index] ?? []));
        return new Map(detailed.messages.map((message) => [message.key, message]));
      },
      staleTime: 60_000,
    })),
  });
  const detailOf = (message: Message): Message | undefined => {
    const index = detailCalls.indexOf(message.callId);
    return index < 0 ? undefined : details[index]?.data?.get(message.key);
  };

  const jumpTo = useCallback(
    (key: string): void => {
      const index = rows.findIndex((row) => row.key === key);
      if (index < 0) return;
      list.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
      setLit(key);
      window.setTimeout(() => {
        setLit((current) => (current === key ? undefined : current));
      }, 2000);
    },
    [rows],
  );

  // The search: the messages that hold the text, and the one it stands on.
  const needle = find === undefined ? '' : needleOf(find);
  const matches = useMemo(
    () => (needle === '' ? [] : findIn(conversation, needle, debug)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation, version, needle, debug],
  );
  const [found, setFound] = useState<string | undefined>(undefined);
  const showFound = useCallback(
    (key: string | undefined): void => {
      setFound(key);
      if (key === undefined) return;
      const index = rows.findIndex((row) => row.key === key);
      if (index >= 0) list.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
    },
    [rows],
  );
  // A text newly typed starts at its newest match, nearest where the
  // reader stands; what arrives after it moves the search nowhere.
  const searchedFor = useRef('');
  useEffect(() => {
    if (searchedFor.current === needle) return;
    searchedFor.current = needle;
    showFound(matches.at(-1));
  }, [needle, matches, showFound]);
  const place = found === undefined ? -1 : matches.indexOf(found);
  const stepFound = (by: number): void => {
    if (matches.length === 0) return;
    const from = place < 0 ? (by < 0 ? matches.length : -1) : place;
    showFound(matches[(from + by + matches.length) % matches.length]);
  };

  // Arriving at a call: its first message is brought to the middle and lit.
  const arrived = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (arriveAt === undefined || arrived.current === arriveAt) return;
    const target = conversation.messages.find((message) => message.callId === arriveAt);
    if (target === undefined) return;
    arrived.current = arriveAt;
    jumpTo(target.key);
  }, [arriveAt, conversation, version, jumpTo]);

  const toFoot = (): void => {
    setChosen(undefined);
    setHeld(false);
    list.current?.scrollToIndex({ index: rows.length - 1, align: 'end', behavior: 'auto' });
  };

  /** Leads to the other agent's side of a message's call. */
  const otherSide = (message: Message): (() => void) | undefined => {
    const record = message.record;
    if (message.kind === 'arrival') {
      const caller = message.author;
      if (record.kind !== 'begin' || record.parentCallId === undefined) return undefined;
      if (partyKind(caller) !== 'agent') return undefined;
      const parent = record.parentCallId;
      return () => {
        void navigate({
          to: '/agents/$',
          params: { _splat: caller },
          search: { tab: 'calls', call: parent },
        });
      };
    }
    if (message.kind !== 'ask' && message.kind !== 'reply') return undefined;
    const target = message.kind === 'ask' ? message.to : message.author;
    const handler = 'handler' in record ? record.handler : undefined;
    if (target === undefined || handler === undefined || partyKind(target) !== 'agent')
      return undefined;
    return () => {
      // The plane is asked first; a reader who went elsewhere before it
      // answered, or who turned to the send box under the conversation,
      // is taken nowhere, and told nothing of it: what they write there
      // is not left behind for a press they made before it.
      const here = standingHere();
      const untouched = boxUntouched?.();
      void (async () => {
        try {
          const answer = unwrap(
            await gateway.call({ client: plane, path: { callId: message.callId } }),
            'this call',
          );
          if (!here() || untouched?.() === false) return;
          // The call this request made, or none where it cannot be told:
          // never the call of another request like it.
          const child = childAsked(conversation, message, answer.children);
          if (child === undefined) {
            const listed = answer.children.some(
              (entry) => entry.agentId === target && entry.handler === handler,
            );
            setTrouble(
              listed
                ? `Which call this request made of ${target} cannot be told here: the plane lists the calls a call caused, and not which request made each. This call's own screen, under Calls, lists them.`
                : `The plane lists no call of ${target} under this one.`,
            );
            return;
          }
          void navigate({
            to: '/agents/$',
            params: { _splat: target },
            search: { tab: 'calls', call: child.callId },
          });
        } catch (error) {
          if (here()) setTrouble(wordsOf(error));
        }
      })();
    };
  };

  /** How a call stands: as its records say, with what the reader's own request heard of its end. */
  const standing = (call: CallState): CallState => withHeardEnd(call, heard?.get(call.callId));

  const renderRow = (_index: number, row: Row): ReactNode => {
    let inner: ReactNode;
    if (row.type === 'day') {
      inner = <DayLine at={row.at} />;
    } else if (row.type === 'call') {
      const call = standing(row.call);
      inner = (
        <CallHead
          call={call}
          own={ownCalls.has(call.callId)}
          dimmed={chosen !== undefined && chosen !== call.callId}
          actions={callActions?.(call)}
          onChoose={() => {
            setChosen(chosen === call.callId ? undefined : call.callId);
          }}
        />
      );
    } else if (row.type === 'extra') {
      inner = row.extra.render();
    } else {
      const message = row.message;
      const read = conversation.calls.get(message.callId);
      const call = read === undefined ? undefined : standing(read);
      const own = ownCalls.has(message.callId);
      const depth = depths.get(message.key) ?? 'plain';
      const other = otherSide(message);
      inner = (
        <MessageRow
          message={message}
          head={row.head}
          tag={row.tag}
          quoted={row.quoted}
          call={call}
          open={open}
          own={own}
          ownAnswer={own && message.kind === 'answer'}
          depth={depth}
          detail={detailOf(message)}
          whole={wholes.has(message.key) || found === message.key}
          dimmed={chosen !== undefined && chosen !== message.callId}
          lit={lit === message.key}
          found={found === message.key}
          actions={{
            onDepth: (next) => {
              setDepths((previous) => {
                const out = new Map(previous);
                if (next === 'plain') out.delete(message.key);
                else out.set(message.key, next);
                return out;
              });
              setHeld(next !== 'plain');
            },
            ...(other === undefined ? {} : { otherSide: other }),
          }}
          onWhole={(whole) => {
            setWholes((previous) => {
              const out = new Set(previous);
              if (whole) out.add(message.key);
              else out.delete(message.key);
              return out;
            });
          }}
          onChoose={() => {
            if ((window.getSelection()?.toString() ?? '') !== '') return;
            setChosen(chosen === message.callId ? undefined : message.callId);
          }}
          onJump={jumpTo}
          {...(own && message.kind === 'arrival' && call !== undefined
            ? { footer: <OwnState call={call} /> }
            : {})}
        />
      );
    }
    // A conversation takes its column whole, as a chat's does: the two sides stand at its two edges.
    return <div className="w-full px-6">{inner}</div>;
  };

  const findBar =
    find === undefined || onFind === undefined ? null : (
      <FindBar
        text={find}
        count={matches.length}
        place={place + 1}
        held={conversation.messages.length}
        onText={onFind}
        onStep={stepFound}
        onClose={() => {
          onFind(undefined);
        }}
      />
    );

  if (rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {head}
        {findBar}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {followed.state === 'connecting' ? <Quiet>Opening the conversation…</Quiet> : empty}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {head}
      {findBar}
      <Searched value={needle}>
        <Virtuoso
          ref={list}
          className="min-h-0 flex-1"
          data={rows}
          computeItemKey={(_index, row) => row.key}
          itemContent={renderRow}
          initialTopMostItemIndex={rows.length - 1}
          alignToBottom
          followOutput={() => (following ? 'auto' : false)}
          atBottomThreshold={48}
          atBottomStateChange={setAtFoot}
          increaseViewportBy={{ top: 600, bottom: 600 }}
          components={PARTS}
        />
      </Searched>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        {/* The way back to the newest, as a chat shows it: where the reader
            stands above the foot, or where something came that they have
            not seen, with its count. */}
        {(!atFoot || unseen > 0) && (
          <button
            type="button"
            onClick={toFoot}
            aria-label={
              unseen > 0
                ? `${String(unseen)} new, go to the newest message`
                : 'Go to the newest message'
            }
            title="Go to the newest message"
            className={cx(
              'sheet pointer-events-auto flex h-8 items-center justify-center gap-1.5 rounded-full! text-xs text-ink shadow-sheet hover:bg-hover',
              unseen > 0 ? 'px-3' : 'w-8',
            )}
          >
            {unseen > 0 && <span className="figures">{unseen} new</span>}
            <ArrowDown size={13} />
          </button>
        )}
      </div>
      {trouble !== undefined && (
        <div
          role="alert"
          className={cx(
            'sheet absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-3 px-3 py-2 text-xs text-ink',
          )}
        >
          {trouble}
          <button
            type="button"
            className="text-ink-muted hover:text-ink"
            onClick={() => {
              setTrouble(undefined);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

const NO_EXTRAS: Extra[] = [];

function Edge(): ReactNode {
  return <div className="h-4" />;
}

/** The column's own parts, the same at every drawing. */
const PARTS = { Header: Edge, Footer: Edge };
