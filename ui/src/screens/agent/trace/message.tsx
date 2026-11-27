// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Link } from '@tanstack/react-router';
import { CornerDownRight, Info, Reply } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useAgents } from '../../../api/queries.js';
import { PartyName, PartyPicture, partyKind, partyWord } from '../../../components/party.js';
import { cx, Moment, Tip } from '../../../components/ui.js';
import { PLANE, answerWords, callMark, sideOf } from '../../../model/conversation.js';
import type { CallState, Message } from '../../../model/conversation.js';
import { spoken } from '../../../model/agent.js';
import { humanMs, runningClock } from '../../../model/figures.js';
import { usePackage } from '../../../model/package.js';
import { frameAddress, ownFrame } from '../../../model/stack.js';
import type { OwnFrame } from '../../../model/stack.js';
import { dayLabel } from '../../../model/time.js';
import { useClock } from '../../../state/prefs.js';
import { Body, CodeBlock, CopyButton, Lines, Marked } from './body.js';

/** How deep a message is read: as it stands, or opened, with the view's
 * detailed reading of it and the record as the plane keeps it. */
export type Depth = 'plain' | 'details';

/** A clock that runs while something runs. */
export function Running({ since }: { since: string }): ReactNode {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return <span className="figures">{runningClock(now - Date.parse(since))}</span>;
}

/** The line between the calls of different days. */
export function DayLine({ at }: { at: string }): ReactNode {
  const [clock] = useClock();
  return (
    <div className="flex items-center gap-3 py-3 text-xs text-ink-muted" role="separator">
      <span className="h-px flex-1 bg-line" />
      <Moment at={at}>{dayLabel(at, clock)}</Moment>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** How a call stands, in a word. */
export function CallStatus({ call }: { call: CallState }): ReactNode {
  if (call.status === 'running') {
    return (
      <span className="text-ink">
        Running <Running since={call.at} />
      </span>
    );
  }
  if (call.status === 'error') return <span className="font-semibold text-bad">Failed</span>;
  return <span>Completed</span>;
}

/** Under a message the reader sent, its state in a word: what the tab
 * saw of the call, never what is likely. */
export function OwnState({ call }: { call: CallState }): ReactNode {
  if (call.status === 'running') {
    return (
      <span>
        Accepted · Running <Running since={call.at} />
      </span>
    );
  }
  if (call.status === 'error') return <span className="font-semibold text-bad">Failed</span>;
  return <span>Completed{call.durationMs !== undefined && ` in ${humanMs(call.durationMs)}`}</span>;
}

/**
 * A call's head line: one hair line across the column where a call of
 * the open agent begins, with what the request under it does not say,
 * a short mark of the call's id, how it stands and how long it took.
 * The function, who called and when are the request's own to say, right
 * under it; they are said here under the pointer. What follows the
 * line, to the next such line, is that call.
 */
export function CallHead({
  call,
  own,
  dimmed,
  actions,
  onChoose,
}: {
  call: CallState;
  own: boolean;
  dimmed: boolean;
  actions?: ReactNode;
  onChoose?: () => void;
}): ReactNode {
  const mark = callMark(call.callId);
  return (
    <div
      className={cx(
        'group/head flex items-center gap-2 pt-5 pb-1.5 text-xs text-ink-muted transition-opacity',
        dimmed && 'opacity-40',
      )}
    >
      <button
        type="button"
        onClick={onChoose}
        className="flex min-w-0 shrink-0 items-center gap-2 rounded-sm text-left hover:text-ink"
        title={`${spoken(call.handler)}, from ${partyWord(call.caller ?? PLANE, own)} · ${call.callId}`}
      >
        {mark !== '' && (
          <>
            <span className="mono text-[11px] text-ink-secondary">{mark}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <CallStatus call={call} />
        {call.durationMs !== undefined && (
          <>
            <span aria-hidden="true">·</span>
            <span className="figures">{humanMs(call.durationMs)}</span>
          </>
        )}
      </button>
      <span className="h-px min-w-4 flex-1 bg-line" />
      {actions}
    </div>
  );
}

/** A thin line under the messages' own column: a step, a wait, a log
 * line, each with its moment first, as `cernanto trace` writes them. */
function ThinLine({
  message,
  dimmed,
  found,
}: {
  message: Message;
  dimmed: boolean;
  found: boolean;
}): ReactNode {
  const failed = message.kind === 'log' ? message.level === 'error' : message.error !== undefined;
  return (
    <div
      className={cx(
        'flex gap-2 rounded-sm py-0.5 text-xs transition-opacity',
        found && 'found-here',
        failed
          ? 'text-bad'
          : message.kind === 'log' && message.level === 'warn'
            ? 'text-ink'
            : 'text-ink-muted',
        dimmed && 'opacity-40',
      )}
    >
      <Moment at={message.at} seconds className="shrink-0 text-ink-muted" />
      {message.kind === 'log' ? (
        <span className="min-w-0 break-words whitespace-pre-wrap">
          {message.level !== 'info' && <span className="font-semibold">{message.level} </span>}
          {message.body.map((line, index) => (
            <span key={index}>
              {index > 0 && '\n'}
              <Marked text={line} />
            </span>
          ))}
        </span>
      ) : message.kind === 'sleep' ? (
        <span>
          · slept <span className="figures">{humanMs(message.durationMs ?? 0)}</span>
        </span>
      ) : (
        <span className="min-w-0 break-words">
          · <Marked text={message.label ?? ''} />
          <span className="figures ml-2 text-ink-muted">{humanMs(message.durationMs ?? 0)}</span>
          {message.error !== undefined && (
            <>
              {'  error: '}
              <Marked text={message.error} />
            </>
          )}
        </span>
      )}
    </div>
  );
}

/** One line of a stack that lies in an agent's own code, as a way to
 * that line of the package's file, in the generation that ran it. The
 * address names that generation whether or not the agent runs it now:
 * the line is that generation's, and the address is opened again after
 * the agent has gone on to the next. */
function OwnLine({ line, frame }: { line: string; frame: OwnFrame }): ReactNode {
  const shipped = useAgents();
  const generation = shipped.data?.generations.find((entry) => entry.port === frame.port);
  const pack = usePackage(generation?.package);
  // The line stays text where the generation that ran it is no longer
  // listed, and where the file is the plane's own beside the package's.
  if (generation === undefined || pack.manifest?.record?.[frame.file] === undefined) return line;
  return (
    <Link
      to="/agents/$"
      params={{ _splat: generation.agentId }}
      search={frameAddress(frame, generation.gen)}
      className="text-accent-text underline decoration-1 underline-offset-2 hover:decoration-2"
      title={`Open ${frame.file} at line ${String(frame.line)}, in the generation that ran this call`}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {line}
    </Link>
  );
}

/** An error's stack, a line a row: the lines of the agent's own code
 * lead to the code, and the rest stay text. The error's own words stand
 * in the message above, so the stack begins at its first line of code. */
function Stack({ stack }: { stack: string }): ReactNode {
  const lines = stack.split('\n');
  const first = lines.findIndex((line) => /^\s+at /.test(line));
  return (
    <pre className="mono mt-1.5 overflow-x-auto text-xs whitespace-pre-wrap text-ink-muted">
      {(first < 0 ? lines : lines.slice(first)).map((line, index) => {
        const frame = ownFrame(line);
        return (
          <div key={index}>
            {frame === undefined ? line === '' ? ' ' : line : <OwnLine line={line} frame={frame} />}
          </div>
        );
      })}
    </pre>
  );
}

/**
 * Whom a message is written to, as the message's own first line: a chip
 * of the one written to, their picture at its start and their name on
 * one oval plate, as a chat names the one a message is for inside the
 * message. The picture and the name are the conversation's own for
 * them, so the eye finds the answer on the other side by its colour.
 * Another agent's chip leads to its screen.
 */
function ToWhom({ id, open }: { id: string; open: string }): ReactNode {
  const chip = (
    <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface pr-2.5 pl-0.5 text-xs">
      <PartyPicture id={id} size={20} ground="var(--surface)" />
      <span className="min-w-0 truncate">
        <PartyName id={id} />
      </span>
    </span>
  );
  if (partyKind(id) !== 'agent' || id === open) return chip;
  return (
    <Link
      to="/agents/$"
      params={{ _splat: id }}
      title={`Open ${id}`}
      className="inline-flex max-w-full rounded-full hover:underline"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {chip}
    </Link>
  );
}

/** How many lines of a request an answer shows of it; a request of more
 * ends in a mark that there is more. */
const QUOTED_LINES = 2;

/** The request a reply answers, quoted above it. An answer of the
 * agent's says whose request it is first, as a chat's reply is headed
 * by the one it answers. */
function QuoteBlock({
  message,
  from,
  own = false,
  onJump,
}: {
  message: Message;
  /** Whose request it is, on an answer of the agent's. */
  from?: string;
  /** The request is the reader's own, sent from this browser. */
  own?: boolean;
  onJump?: (key: string) => void;
}): ReactNode {
  const quote = message.quote;
  if (quote === undefined) return null;
  const inner = (
    <>
      {from !== undefined && (
        <span className="mb-0.5 inline-flex max-w-full items-center gap-1.5">
          <PartyPicture id={from} size={20} ground="var(--ground)" />
          <span className="min-w-0 truncate">
            <PartyName id={from} own={own} />
          </span>
        </span>
      )}
      <span className="font-medium text-ink-secondary">{quote.fn}</span>
      {quote.lines.length > 0 && (
        <span className="block w-full min-w-0 text-ink-muted">
          <Lines lines={quote.lines.slice(0, QUOTED_LINES)} muted clipped />
          {quote.lines.length > QUOTED_LINES && <span aria-hidden="true">…</span>}
        </span>
      )}
    </>
  );
  const className =
    'mb-1.5 flex w-full flex-col border-l-2 border-line-strong py-0.5 pl-2 text-left text-xs';
  if (quote.key === '' || onJump === undefined) return <div className={className}>{inner}</div>;
  return (
    <button
      type="button"
      className={cx(className, 'hover:border-ink-muted')}
      title="Go to the request"
      onClick={(event) => {
        event.stopPropagation();
        onJump(quote.key);
      }}
    >
      {inner}
    </button>
  );
}

/** What a message can be asked for, shown while the pointer is on it. */
export interface MessageActions {
  onDepth: (depth: Depth) => void;
  /** Leads to the other side of the message's call, when it has one. */
  otherSide?: () => void;
}

/**
 * One message of a conversation, drawn as a chat draws one, under its
 * speaker's picture and one small line, ON THE SIDE OF WHO SPEAKS: the
 * agent whose screen this is on the left, on its own tone with a thin
 * edge of the ink, and whoever talks with it on the right, an operator,
 * an agent that calls it and an agent that answers it. An operator is
 * drawn one way wherever the call was sent from, and is named "You"
 * where this browser sent it.
 */
export function MessageRow({
  message,
  head,
  tag,
  quoted,
  call,
  open,
  own,
  ownAnswer,
  depth,
  detail,
  whole,
  dimmed,
  lit,
  found = false,
  actions,
  onWhole,
  onChoose,
  onJump,
  footer,
}: {
  message: Message;
  head: boolean;
  tag: boolean;
  /** The request it answers is shown on it: it does not stand right under that request. */
  quoted: boolean;
  call: CallState | undefined;
  /** The agent whose screen this is. */
  open: string;
  /** The reader sent this call from this browser. */
  own: boolean;
  /** The message answers a call the reader sent. */
  ownAnswer: boolean;
  depth: Depth;
  /** The view's detailed reading of the same record, once it was read. */
  detail: Message | undefined;
  whole: boolean;
  dimmed: boolean;
  lit: boolean;
  /** The search stands on this message, of all that hold its text. */
  found?: boolean;
  actions: MessageActions;
  onWhole: (whole: boolean) => void;
  onChoose: () => void;
  onJump: (key: string) => void;
  footer?: ReactNode;
}): ReactNode {
  if (message.kind === 'step' || message.kind === 'sleep' || message.kind === 'log') {
    return <ThinLine message={message} dimmed={dimmed} found={found} />;
  }
  const right = sideOf(message.kind) === 'right';
  const shown = depth === 'details' && detail !== undefined ? detail : message;
  const failed = message.error !== undefined;

  const bubble = (
    <div
      className={cx(
        // A message is as wide as what it says, to a width a line of it can still be read at.
        'group/bubble relative max-w-[min(100%,960px)] min-w-0 rounded-lg px-3 py-2 text-[14px] leading-[1.45]',
        right ? 'bg-message' : 'border-l-2 border-ink-muted bg-message-own/55',
        failed && 'ring-1 ring-bad/60',
        lit && 'lit',
        found && 'found-here',
      )}
      onClick={onChoose}
    >
      {/* What is said, and its moment small in the bubble's own corner, as a chat sets it. */}
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          {message.kind === 'ask' && message.to !== undefined && message.to !== '' && (
            <div className="mb-1.5 flex max-w-full">
              <ToWhom id={message.to} open={open} />
            </div>
          )}
          {quoted && shown.quote !== undefined && (
            <QuoteBlock
              message={shown}
              onJump={onJump}
              {...(message.kind === 'answer' && message.to !== undefined
                ? { from: message.to, own: ownAnswer }
                : {})}
            />
          )}
          {message.fn !== undefined && (
            <div className="font-semibold text-ink">
              <Marked text={message.fn} />
            </div>
          )}
          {failed && (
            <div className="break-words whitespace-pre-wrap text-bad">
              <span className="font-semibold">Failed: </span>
              {(message.error ?? '').split('\n').map((line, index) => (
                <span key={index}>
                  {index > 0 && '\n'}
                  <Marked text={line} />
                </span>
              ))}
            </div>
          )}
          <Body lines={shown.body} whole={whole || depth === 'details'} onWhole={onWhole} />
          {depth === 'details' && failed && 'stack' in message.record && (
            <Stack stack={message.record.stack} />
          )}
          {/* Opened, a message always shows more: the plane's own record of it stands under what it says. */}
          {depth === 'details' && (
            <div className="mt-2 w-[min(640px,70vw)] max-w-full">
              <CodeBlock kind="Record" text={JSON.stringify(message.record, null, 2)} />
            </div>
          )}
          {message.kind === 'ask' && message.open && (
            <div className="mt-1 text-xs text-ink-muted">
              Running <Running since={message.at} />
            </div>
          )}
        </div>
        <Moment
          at={message.at}
          seconds
          className="shrink-0 text-[11px] leading-[1.6] text-ink-muted"
        />
      </div>
      <div
        className={cx(
          'absolute -top-3 hidden items-center rounded-md border bg-message shadow-sheet group-hover/bubble:flex',
          right ? 'left-2' : 'right-2',
        )}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <CopyButton
          text={() =>
            [message.fn, message.error, ...shown.body]
              .filter((line) => line !== undefined)
              .join('\n')
          }
          label="Copy the message"
        />
        <Tip label={depth === 'details' ? 'Close the details' : 'Details'}>
          <button
            type="button"
            aria-label="Details"
            aria-pressed={depth === 'details'}
            className={cx(
              'inline-flex size-6 items-center justify-center rounded-md hover:bg-hover hover:text-ink',
              depth === 'details' ? 'bg-chosen text-ink' : 'text-ink-muted',
            )}
            onClick={() => {
              actions.onDepth(depth === 'details' ? 'plain' : 'details');
            }}
          >
            <Info size={13} />
          </button>
        </Tip>
        {actions.otherSide !== undefined && (
          <Tip label="Go to the other side of this call">
            <button
              type="button"
              aria-label="Go to the other side of this call"
              className="inline-flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
              onClick={actions.otherSide}
            >
              <CornerDownRight size={13} />
            </button>
          </Tip>
        )}
      </div>
    </div>
  );

  // The agent whose screen this is carries no picture and no name on its
  // own messages: the screen's head says whose talk it is, as a chat's
  // head names the one contact of a talk of two.
  const named = message.author !== open;
  // Another agent's picture and name lead to its own screen.
  const leads = named && partyKind(message.author) === 'agent';
  const picture = <PartyPicture id={message.author} ground="var(--ground)" />;
  const name = <PartyName id={message.author} own={own && message.kind === 'arrival'} />;
  // The small line over a message holds what the message itself does
  // not: who speaks, at the head of a run of theirs; that it is an
  // answer, with how long it took; and its call's name where it follows
  // another call's. A request of the open agent's has no such line.
  const speaker = named && head;
  const answered = answerWords(message);
  const called = tag && call !== undefined ? call : undefined;
  const lined =
    speaker || message.mocked === true || answered !== undefined || called !== undefined;
  return (
    <div
      className={cx(
        'flex gap-3 transition-opacity',
        right ? 'flex-row-reverse pl-16' : 'pr-16',
        head ? 'pt-2.5' : 'pt-1',
        dimmed && 'opacity-40',
      )}
    >
      {named && (
        <div className="w-7 shrink-0">
          {head &&
            (leads ? (
              <Link
                to="/agents/$"
                params={{ _splat: message.author }}
                title={`Open ${message.author}`}
              >
                {picture}
              </Link>
            ) : (
              picture
            ))}
        </div>
      )}
      <div className={cx('flex min-w-0 flex-1 flex-col', right ? 'items-end' : 'items-start')}>
        {lined && (
          <div
            className={cx(
              'mb-1 flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted',
              right && 'flex-row-reverse',
            )}
          >
            {speaker &&
              (leads ? (
                <Link
                  to="/agents/$"
                  params={{ _splat: message.author }}
                  className="hover:underline"
                >
                  {name}
                </Link>
              ) : (
                name
              ))}
            {message.mocked === true && <span>(mock)</span>}
            {answered !== undefined && (
              <span className={cx('inline-flex items-center gap-1', failed && 'text-bad')}>
                <Reply size={12} className="shrink-0" aria-hidden="true" />
                <span className="figures">{answered}</span>
              </span>
            )}
            {called !== undefined && (
              <span
                className="rounded-sm bg-chosen px-1 text-[11px] text-ink-secondary"
                title={called.callId}
              >
                {spoken(called.handler)}{' '}
                <span className="mono text-[10px]">{callMark(called.callId)}</span>
              </span>
            )}
          </div>
        )}
        {bubble}
        {footer !== undefined && <div className="mt-0.5 text-xs text-ink-muted">{footer}</div>}
      </div>
    </div>
  );
}
