// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Link } from '@tanstack/react-router';
import { Reply } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useAskAfterCall } from '../../../api/queries.js';
import { sendCall } from '../../../api/streams.js';
import { PartyName, PartyPicture } from '../../../components/party.js';
import { cx, Moment } from '../../../components/ui.js';
import type { TraceRecord } from '../../../gateway/types.gen.js';
import { previewLines } from '../../../model/contract.js';
import type { FunctionCard } from '../../../model/contract.js';
import {
  GATEWAY,
  answerWords,
  moduleCallOf,
  sendStanding,
  valueLines,
} from '../../../model/conversation.js';
import type {
  CallState,
  Conversation,
  Heard,
  HeardEnd,
  SendStanding,
} from '../../../model/conversation.js';
import { humanMs } from '../../../model/figures.js';
import { BY_ITSELF } from '../../../model/fleet.js';
import { Body } from './body.js';
import type { Extra } from './conversation.js';
import { Running } from './message.js';

/** A call the reader sent from this tab, and what the tab saw of it. */
export interface Send {
  id: string;
  card: FunctionCard;
  args: unknown;
  at: string;
  /** What the tab saw, never what is likely. */
  state: 'sending' | 'accepted' | 'completed' | 'failed' | 'refused' | 'unknown';
  /** For a module's function: the agent the call was sent to run inside. */
  inside?: string;
  /** For an interface's function: the implementor the call went
   * through, who answers it. */
  answeredBy?: string;
  callId?: string;
  result?: unknown;
  error?: string;
  endedAt?: string;
}

/** A key from the randomness every page is given, a secure page or not. */
function drawKey(): string {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The state of a sent call, in a word. */
function StateWord({ send }: { send: Send }): ReactNode {
  switch (send.state) {
    case 'sending':
      return (
        <span>
          Sending <span className="ring" />
        </span>
      );
    case 'accepted':
      return (
        <span>
          Accepted · Running <Running since={send.at} />
        </span>
      );
    case 'completed':
      return (
        <span>
          Completed
          {send.endedAt !== undefined &&
            ` in ${humanMs(Date.parse(send.endedAt) - Date.parse(send.at))}`}
        </span>
      );
    case 'failed':
      return <span className="font-semibold text-bad">Failed</span>;
    case 'refused':
      return <span className="font-semibold text-bad">Refused</span>;
    case 'unknown':
      return <span className="font-semibold text-ink">Unknown: this call may have run</span>;
  }
}

/** The request of a sent call as it stands before the plane's own
 * records of it arrive: on the right, where whoever talks with the agent
 * stands, as an operator's request is drawn and named "You", its state
 * in a word. A request the plane refused, or whose call failed before
 * any record of it, carries those words. */
function RequestBubble({ send }: { send: Send }): ReactNode {
  const [whole, setWhole] = useState(false);
  return (
    <div className="arrive flex flex-row-reverse gap-3 pt-2.5 pb-1 pl-16">
      <div className="w-7 shrink-0">
        <PartyPicture id={GATEWAY} ground="var(--ground)" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-end">
        <div className="mb-1 flex flex-row-reverse items-center gap-x-2 text-xs text-ink-muted">
          <PartyName id={GATEWAY} own />
        </div>
        <div
          className={cx(
            'max-w-[min(100%,960px)] min-w-0 rounded-lg bg-message px-3 py-2 text-[14px] leading-[1.45]',
            (send.state === 'failed' || send.state === 'refused') && 'ring-1 ring-bad/60',
          )}
        >
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink">{send.card.spoken}</div>
              <Body lines={previewLines(send.args)} whole={whole} onWhole={setWhole} />
              {send.error !== undefined && (
                <div className="mt-1 break-words whitespace-pre-wrap text-bad">{send.error}</div>
              )}
            </div>
            <Moment
              at={send.at}
              seconds
              className="shrink-0 text-[11px] leading-[1.6] text-ink-muted"
            />
          </div>
        </div>
        <div className="mt-0.5 text-xs text-ink-muted">
          <StateWord send={send} />
        </div>
      </div>
    </div>
  );
}

/** What a sent call answered, heard on the reader's own request before
 * any record of the call's end: a message of its own on the left, where
 * the agent's answers stand, drawn as a recorded answer is, with how
 * long the call took. The agent whose screen this is carries no picture
 * and no name on it, as on its recorded messages; an interface's answer
 * is its implementor's, under that agent's picture and name, which lead
 * to it. A failure heard the same way stands in the same place. */
function AnswerBubble({ send, open }: { send: Send; open: string }): ReactNode {
  const [whole, setWhole] = useState(false);
  const failed = send.state === 'failed';
  const author = send.answeredBy ?? open;
  const named = author !== open;
  const said = answerWords({
    kind: 'answer',
    ...(send.endedAt === undefined
      ? {}
      : { durationMs: Math.max(0, Date.parse(send.endedAt) - Date.parse(send.at)) }),
    ...(failed ? { error: send.error ?? '' } : {}),
  });
  return (
    <div className="arrive flex gap-3 pt-1 pr-16 pb-1">
      {named && (
        <div className="w-7 shrink-0">
          <Link to="/agents/$" params={{ _splat: author }} title={`Open ${author}`}>
            <PartyPicture id={author} ground="var(--ground)" />
          </Link>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <div className="mb-1 flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
          {named && (
            <Link to="/agents/$" params={{ _splat: author }} className="hover:underline">
              <PartyName id={author} />
            </Link>
          )}
          <span className={cx('inline-flex items-center gap-1', failed && 'text-bad')}>
            <Reply size={12} className="shrink-0" aria-hidden="true" />
            <span className="figures">{said}</span>
          </span>
        </div>
        <div
          className={cx(
            'max-w-[min(100%,960px)] min-w-0 rounded-lg border-l-2 border-ink-muted bg-message-own/55 px-3 py-2 text-[14px] leading-[1.45]',
            failed && 'ring-1 ring-bad/60',
          )}
        >
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              {failed ? (
                <div className="break-words whitespace-pre-wrap text-bad">
                  <span className="font-semibold">Failed: </span>
                  {send.error ?? ''}
                </div>
              ) : (
                <Body lines={valueLines(send.result)} whole={whole} onWhole={setWhole} />
              )}
            </div>
            <Moment
              at={send.endedAt ?? send.at}
              seconds
              className="shrink-0 text-[11px] leading-[1.6] text-ink-muted"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A sent call as it stands for what the conversation does not say of
 * it. Before any record of the call, that is its request and, once the
 * request heard it, its answer. Where the conversation already shows
 * the call's request, it is the call's end alone, which the conversation
 * has not read yet. */
function SendMessages({
  send,
  open,
  shown = false,
}: {
  send: Send;
  open: string;
  shown?: boolean;
}): ReactNode {
  // A failure before any record of the call is the request's own to
  // say; one whose request the conversation shows stands where the
  // call's answer would.
  const answered = send.state === 'completed' || (shown && send.state === 'failed');
  return (
    <>
      {!shown && <RequestBubble send={send} />}
      {answered && <AnswerBubble send={send} open={open} />}
    </>
  );
}

/** What the request of a send has heard of its call. */
function heardOf(send: Send): Heard {
  if (send.state === 'completed') return 'ok';
  if (send.state === 'failed') return 'error';
  if (send.state === 'refused') return 'refused';
  if (send.state === 'unknown') return 'lost';
  return 'open';
}

/**
 * The calls sent from this tab. A press makes one request; the button
 * is free again at once, and the call's own records arrive in the
 * conversation, on the request itself and on the agent's stream alike.
 */
export function useSends(
  agentId: string,
  options: {
    utc: boolean;
    /** Whether the agent's debug lines are read: a call's own request
     * and the agent's stream tell one conversation, which keeps the
     * first telling of a record, so both ask the same reading of it. */
    debug: boolean;
    conversation: Conversation;
    /** Reads a record the call told on its own request into the conversation. */
    feed: (record: TraceRecord, lines: string[]) => void;
    /** Remembers a call as the reader's own. */
    own: (callId: string) => void;
    /** For a module: the agent a call of it runs inside, as chosen now. */
    inside?: string | undefined;
    /** For a module called by itself: whether the fleet, as it was read,
     * shows no standalone agent of it, so that the call is the one that
     * starts it. */
    startsAlone?: boolean | undefined;
    /** For an interface: the implementor the plane binds to it, who
     * answers a call of it. */
    answeredBy?: string | undefined;
    /** Asks the plane for the fleet again: after a send the plane
     * refused, what the box is laid out from may be what was; and after
     * a call that started a module by itself, which put an agent on the
     * fleet. */
    askFleet: () => void;
  },
): {
  /** Sends a call. It names the contract its arguments were typed
   * against, by the sha256 hex of its text, as the box kept it with
   * them: the plane refuses arguments typed against a contract the
   * agent has no more. */
  send: (card: FunctionCard, args: unknown, contractSha: string | undefined) => void;
  extras: Extra[];
  /** The ends the reader's own requests heard and the conversation's
   * records do not say, by call. */
  heard: ReadonlyMap<string, HeardEnd>;
} {
  const [sends, setSends] = useState<Send[]>([]);
  const askAgain = useAskAfterCall();
  const latest = useRef(options);
  latest.current = options;

  const send = useCallback(
    (card: FunctionCard, args: unknown, contractSha: string | undefined) => {
      const id = drawKey();
      const change = (patch: Partial<Send>): void => {
        setSends((previous) =>
          previous.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
        );
      };
      // A module's function runs inside another agent: the request and
      // its records are that agent's, and this conversation is told the
      // module's own call by the module's own stream.
      const inside = latest.current.inside;
      const answeredBy = latest.current.answeredBy;
      // A CALL BY ITSELF MAY PUT AN AGENT ON THE FLEET: the plane starts
      // the module by itself at the call when it is not started. The
      // fleet is asked again the moment the call says so, at its
      // acceptance, and, where the fleet showed no standalone agent of
      // the module when the call was sent, once more at the call's end,
      // however it ended: the plane starts the module before the call
      // runs, so a call that failed or was refused after it may have
      // started it without a word.
      const startsAlone = inside === BY_ITSELF && latest.current.startsAlone === true;
      setSends((previous) => [
        ...previous,
        {
          id,
          card,
          args,
          at: new Date().toISOString(),
          state: 'sending',
          ...(inside === undefined ? {} : { inside }),
          ...(answeredBy === undefined ? {} : { answeredBy }),
        },
      ]);
      void sendCall(agentId, card.name, args, {
        utc: latest.current.utc,
        debug: latest.current.debug,
        // By itself is said by naming no agent: the plane runs the
        // module in its standalone agent, and starts that at this call
        // when the module is not started.
        in: inside === BY_ITSELF ? undefined : inside,
        // The contract the arguments were typed against.
        contractSha,
        onAccepted: (callId) => {
          if (inside === undefined) latest.current.own(callId);
          change({ state: 'accepted', callId });
        },
        onStarted: () => {
          latest.current.askFleet();
        },
        onRecord: (record, lines) => {
          if (inside === undefined) latest.current.feed(record, lines);
        },
      }).then((outcome) => {
        const endedAt = new Date().toISOString();
        if (startsAlone && outcome.state !== 'refused') latest.current.askFleet();
        if (outcome.state === 'completed') {
          change({ state: 'completed', result: outcome.result, endedAt });
        } else if (outcome.state === 'failed') {
          change({ state: 'failed', error: outcome.error.message, endedAt });
        } else if (outcome.state === 'refused') {
          change({ state: 'refused', error: outcome.error.message, endedAt });
          // The plane refused before any copy took the call: the agent
          // may be another than this page read (deployed again under
          // another contract, deleted, another kind). The fleet is asked
          // again, and the box follows what comes back.
          latest.current.askFleet();
        } else {
          change({
            state: 'unknown',
            error:
              'The connection was lost before the answer. The call may have run, or may still; its records show in this conversation if it did.',
            endedAt,
          });
        }
        // An action of the reader's own: the list is asked again.
        askAgain();
      });
    },
    [agentId, askAgain],
  );

  // A send stands for what the conversation does not say of its call,
  // by one rule (`sendStanding`). Before any record of the call, that is
  // the request itself. Once the conversation shows the call, it is the
  // call's end alone, where the reader's own request heard an end the
  // records do not say: the answer is shown, and the call's lines say
  // how it ended by that word. A send is let go for good once the
  // records say what its request heard, and never while its request is
  // still open: a conversation lets its oldest calls go, and a send must
  // not stand again where its call once was.
  const conversation = options.conversation;
  // The call of a send as this conversation holds it. A module's function
  // is called inside another agent: the request is that agent's call, and
  // this conversation holds the module's own call inside it, the newest
  // where the request ran again. Which of the two a send is goes by the
  // send itself, whatever agent the box stands on since.
  const readOf = (entry: Send, callId: string): CallState | undefined =>
    entry.inside === undefined
      ? conversation.calls.get(callId)
      : moduleCallOf(conversation.calls.values(), callId);
  const standing = (entry: Send): SendStanding =>
    sendStanding(
      heardOf(entry),
      entry.callId === undefined ? undefined : readOf(entry, entry.callId),
      entry.error,
    );
  const overIds = sends
    .filter((entry) => standing(entry) === 'over')
    .map((entry) => entry.id)
    .join('|');
  useEffect(() => {
    if (overIds === '') return;
    const gone = new Set(overIds.split('|'));
    setSends((previous) => previous.filter((entry) => !gone.has(entry.id)));
  }, [overIds]);
  const extras: Extra[] = [];
  const heard = new Map<string, HeardEnd>();
  for (const entry of sends) {
    const stands = standing(entry);
    if (stands === 'over' || stands === 'nothing') continue;
    extras.push({
      key: `send:${entry.id}`,
      render: () => <SendMessages send={entry} open={agentId} shown={stands === 'end'} />,
    });
    if (stands !== 'end' || entry.callId === undefined || entry.endedAt === undefined) continue;
    heard.set(readOf(entry, entry.callId)?.callId ?? entry.callId, {
      status: entry.state === 'completed' ? 'ok' : 'error',
      durationMs: Math.max(0, Date.parse(entry.endedAt) - Date.parse(entry.at)),
      ...(entry.error === undefined ? {} : { error: entry.error }),
    });
  }
  return { send, extras, heard };
}
