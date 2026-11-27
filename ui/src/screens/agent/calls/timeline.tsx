// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { cx, Quiet } from '../../../components/ui.js';
import { partyWord } from '../../../components/party.js';
import type { Conversation, Message } from '../../../model/conversation.js';
import { spoken } from '../../../model/agent.js';
import { humanMs } from '../../../model/figures.js';
import { timeOfDay } from '../../../model/time.js';
import { useClock } from '../../../state/prefs.js';

/** One bar of a timeline: a thing that took time. */
interface Bar {
  key: string;
  label: string;
  /** Milliseconds from the call's start. */
  from: number;
  length: number;
  /** A wait is drawn hollow: a sleep, a call that has no reply yet. */
  hollow: boolean;
  failed: boolean;
  at: string;
}

/** A call's bars, from its own records: the call, each call it made,
 * each step and each wait, a bar as long as the thing took. */
function barsOf(
  conversation: Conversation,
  callId: string,
  now: number,
): { bars: Bar[]; span: number } {
  const call = conversation.calls.get(callId);
  const messages = conversation.messages.filter((message) => message.callId === callId);
  if (call === undefined) return { bars: [], span: 0 };
  const start = Date.parse(call.at);
  const end =
    call.status === 'running'
      ? Math.max(now, Date.parse(call.lastAt))
      : start + (call.durationMs ?? 0);
  const bars: Bar[] = [
    {
      key: 'call',
      label: `${partyWord(call.agentId)} · ${spoken(call.handler)}`,
      from: 0,
      length: Math.max(0, end - start),
      hollow: false,
      failed: call.status === 'error',
      at: call.at,
    },
  ];
  const replies = new Map<string, Message>();
  for (const message of messages) {
    if (message.kind === 'reply' && message.quote !== undefined)
      replies.set(message.quote.key, message);
  }
  for (const message of messages) {
    if (message.kind === 'ask') {
      const reply = replies.get(message.key);
      const from = Date.parse(message.at) - start;
      const length =
        reply?.durationMs ??
        Math.max(0, (reply === undefined ? end : Date.parse(reply.at)) - Date.parse(message.at));
      bars.push({
        key: message.key,
        label: `${partyWord(message.to ?? '')} · ${message.fn ?? ''}`,
        from,
        length,
        hollow: reply === undefined,
        failed: reply?.error !== undefined,
        at: message.at,
      });
    } else if (message.kind === 'reply' && message.quote?.key === '') {
      // A reply whose request was told before this reading began.
      const length = message.durationMs ?? 0;
      bars.push({
        key: message.key,
        label: `${partyWord(message.author)} · ${message.quote.fn}`,
        from: Date.parse(message.at) - length - start,
        length,
        hollow: false,
        failed: message.error !== undefined,
        at: message.at,
      });
    } else if (message.kind === 'step' || message.kind === 'sleep') {
      const length = message.durationMs ?? 0;
      bars.push({
        key: message.key,
        label: message.kind === 'sleep' ? 'slept' : (message.label ?? 'step'),
        from: Date.parse(message.at) - length - start,
        length,
        hollow: message.kind === 'sleep',
        failed: message.error !== undefined,
        at: message.at,
      });
    }
  }
  return { bars, span: Math.max(1, end - start) };
}

/**
 * One call as a timeline: its calls, steps and waits drawn as bars over
 * time, the ones that ran side by side one under the other. A
 * conversation is in the order of what was said; this shows where the
 * time went.
 */
export function Timeline({
  conversation,
  version,
  callId,
}: {
  conversation: Conversation;
  version: number;
  callId: string;
}): ReactNode {
  const [clock] = useClock();
  const { bars, span } = useMemo(
    () => barsOf(conversation, callId, Date.now()),
    // The conversation is one object that grows; its version says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation, version, callId],
  );
  if (bars.length === 0) return <Quiet>Nothing of this call is recorded to draw.</Quiet>;
  const marks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="w-full">
        <div className="relative mb-1 ml-[280px] h-5 text-[11px] text-ink-muted">
          {marks.map((mark) => (
            <span
              key={mark}
              className={cx(
                'figures absolute top-0',
                mark === 1 ? '-translate-x-full' : mark === 0 ? '' : '-translate-x-1/2',
              )}
              style={{ left: `${String(mark * 100)}%` }}
            >
              {humanMs(span * mark)}
            </span>
          ))}
        </div>
        <ul className="flex flex-col">
          {bars.map((bar, index) => {
            const left = Math.min(100, Math.max(0, (bar.from / span) * 100));
            const width = Math.max(0.4, Math.min(100 - left, (bar.length / span) * 100));
            // The figure stands after its bar, before it where no room is
            // left after, and inside a bar that fills the line.
            const place = left + width <= 88 ? 'after' : left >= 12 ? 'before' : 'inside';
            return (
              <li
                key={bar.key}
                className={cx(
                  'flex h-8 items-center gap-3 text-[13px]',
                  index === 0 && 'font-medium',
                )}
                title={`${bar.label} · began ${timeOfDay(bar.at, clock, true)} · ${humanMs(bar.length)}`}
              >
                <span className="w-[268px] shrink-0 truncate text-ink-secondary">{bar.label}</span>
                <span className="relative h-full min-w-0 flex-1 border-l border-line">
                  {marks.slice(1).map((mark) => (
                    <span
                      key={mark}
                      className="absolute top-0 h-full w-px bg-line"
                      style={{ left: `${String(mark * 100)}%` }}
                    />
                  ))}
                  <span
                    className={cx(
                      'absolute top-2 h-4 rounded-sm',
                      bar.hollow
                        ? 'border border-dashed border-ink-muted'
                        : bar.failed
                          ? 'bg-bad'
                          : index === 0
                            ? 'bg-ink-muted/50'
                            : 'bg-ink-secondary',
                    )}
                    style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
                  />
                  <span
                    className={cx(
                      'figures absolute top-1.5 px-1.5 text-[11px] whitespace-nowrap',
                      place !== 'inside' || bar.hollow
                        ? 'text-ink-muted'
                        : index === 0 && !bar.failed
                          ? 'text-ink'
                          : 'text-ground',
                    )}
                    style={
                      place === 'after'
                        ? { left: `${String(left + width)}%` }
                        : place === 'before'
                          ? { right: `${String(100 - left)}%` }
                          : { right: `${String(100 - left - width)}%` }
                    }
                  >
                    {humanMs(bar.length)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-ink-muted">
          Drawn from this call's own records. A wait, a sleep or a call with no reply yet, is drawn
          hollow.
        </p>
      </div>
    </div>
  );
}
