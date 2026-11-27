// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { wordsOf } from '../api/plane.js';
import { followAgent, followCall } from '../api/streams.js';
import type { StreamHandle } from '../api/streams.js';
import type { CallSummary, TraceRecord } from '../gateway/types.gen.js';
import { Conversation } from '../model/conversation.js';

// A conversation as it is followed: the newest records the plane holds
// of an agent, then each record as it is made. The stream is taken up
// again by itself, from the last record it told, when it breaks, when
// the window is returned to and when the list shows that the agent's
// copies changed, since a stream follows the copies that served when
// it opened.

/** How many records a conversation opens with. */
const BACKLOG = 200;
/** How many messages one conversation holds; the oldest are let go past it. */
const MOST = 2000;
/** The longest wait before a stream is asked for again. */
const LONGEST_WAIT_MS = 30_000;

/** Where a followed conversation stands. */
export type Following = 'connecting' | 'live' | 'reconnecting' | 'ended' | 'failed';

/** What the screen reads of a followed conversation. */
export interface Followed {
  conversation: Conversation;
  /** Changes whenever the conversation gained something. */
  version: number;
  state: Following;
  /** The words of what broke the stream, while it is taken up again. */
  error: string | undefined;
  /** How many messages were let go from its far end. */
  dropped: number;
}

type Source = { kind: 'agent'; agentId: string } | { kind: 'call'; callId: string };

/** One followed conversation: it reads a stream into a conversation and
 * tells its readers at most once a frame. */
class Follower {
  private conversation = new Conversation(MOST);
  private readonly listeners = new Set<() => void>();
  private handle: StreamHandle | undefined;
  private timer: number | undefined;
  private frame: number | undefined;
  private waited = 0;
  private stopped = false;
  private snapshot: Followed;
  /** The call a call's stream entered, told once it opens. */
  call: CallSummary | undefined;
  private readonly source: Source;
  private readonly utc: boolean;
  private readonly debug: boolean;

  constructor(source: Source, utc: boolean, debug: boolean) {
    this.source = source;
    this.utc = utc;
    this.debug = debug;
    this.snapshot = {
      conversation: this.conversation,
      version: 0,
      state: 'connecting',
      error: undefined,
      dropped: 0,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  read = (): Followed => this.snapshot;

  private tell(change: Partial<Followed> = {}): void {
    this.snapshot = { ...this.snapshot, ...change, version: this.snapshot.version + 1 };
    for (const listener of this.listeners) listener();
  }

  /** What arrives is told in batches, at most once a frame. The
   * conversation holds itself to its bound as it reads, a frame or
   * none: a window out of sight draws no frame and goes on reading. */
  private soon(): void {
    if (this.frame !== undefined) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = undefined;
      this.conversation.trim(MOST);
      const dropped = this.conversation.dropped;
      this.tell(dropped === this.snapshot.dropped ? {} : { dropped });
    });
  }

  /** Reads one record into the conversation: the stream's own, or one a
   * call the reader sent told on its own request. */
  take = (record: TraceRecord, lines: string[]): void => {
    this.conversation.add(record, lines);
    this.soon();
  };

  start(): void {
    this.stopped = false;
    this.open(this.conversation.size === 0);
    window.addEventListener('online', this.again);
    document.addEventListener('visibilitychange', this.returned);
  }

  private returned = (): void => {
    if (document.visibilityState === 'visible' && this.snapshot.state === 'reconnecting') {
      this.again();
    }
  };

  /** Takes the stream up again at once, from the last record told. */
  again = (): void => {
    if (this.stopped || this.snapshot.state === 'ended') return;
    window.clearTimeout(this.timer);
    this.open(false);
  };

  private open(first: boolean): void {
    this.handle?.stop();
    const onOpen = (): void => {
      this.waited = 0;
      this.tell({ state: 'live', error: undefined });
    };
    const onEnd = (error?: unknown): void => {
      if (this.stopped) return;
      if (this.source.kind === 'call' && error === undefined) {
        this.tell({ state: 'ended', error: undefined });
        return;
      }
      if (this.source.kind === 'call' && this.conversation.size === 0) {
        this.tell({ state: 'failed', error: wordsOf(error) });
        return;
      }
      // After a second, then two, then four, to half a minute at the most.
      this.waited = Math.min(this.waited === 0 ? 1000 : this.waited * 2, LONGEST_WAIT_MS);
      this.tell({ state: 'reconnecting', error: error === undefined ? undefined : wordsOf(error) });
      this.timer = window.setTimeout(() => {
        this.open(false);
      }, this.waited);
    };
    if (this.source.kind === 'agent') {
      const since = first ? undefined : this.conversation.lastAt;
      this.handle = followAgent(
        this.source.agentId,
        {
          ...(since === undefined ? { backlog: BACKLOG } : { since }),
          utc: this.utc,
          debug: this.debug,
          onOpen,
          onEnd,
        },
        this.take,
      );
      return;
    }
    this.handle = followCall(
      this.source.callId,
      { view: 'live', utc: this.utc, debug: this.debug, onOpen, onEnd },
      (event) => {
        if (event.call !== undefined) {
          this.call = event.call;
          this.soon();
        }
        if (event.record !== undefined) this.take(event.record, event.lines ?? []);
        if (event.error !== undefined && event.record === undefined) {
          this.tell({ error: event.error });
        }
      },
    );
  }

  stop(): void {
    this.stopped = true;
    this.handle?.stop();
    window.clearTimeout(this.timer);
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    window.removeEventListener('online', this.again);
    document.removeEventListener('visibilitychange', this.returned);
  }
}

/**
 * An agent's conversation, followed live.
 *
 * @param copies - What the listing says of the agent's copies. When it
 *   changes, the stream is taken up again from the last record told.
 */
export function useAgentConversation(
  agentId: string,
  options: { utc: boolean; debug: boolean; copies: string },
): Followed & { again: () => void; feed: (record: TraceRecord, lines: string[]) => void } {
  const follower = useMemo(
    () => new Follower({ kind: 'agent', agentId }, options.utc, options.debug),
    [agentId, options.utc, options.debug],
  );
  useEffect(() => {
    follower.start();
    return () => {
      follower.stop();
    };
  }, [follower]);
  const copies = options.copies;
  useEffect(() => {
    // The first value is the stream's own opening; a later one is a change.
    if (follower.read().state !== 'connecting') follower.again();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copies]);
  const followed = useSyncExternalStore(follower.subscribe, follower.read);
  return { ...followed, again: follower.again, feed: follower.take };
}

/** One call's conversation, read whole and followed until the call is told. */
export function useCallConversation(
  callId: string,
  options: { utc: boolean; debug: boolean },
): Followed & { call: CallSummary | undefined } {
  const follower = useMemo(
    () => new Follower({ kind: 'call', callId }, options.utc, options.debug),
    [callId, options.utc, options.debug],
  );
  useEffect(() => {
    follower.start();
    return () => {
      follower.stop();
    };
  }, [follower]);
  const followed = useSyncExternalStore(follower.subscribe, follower.read);
  return { ...followed, call: follower.call };
}
