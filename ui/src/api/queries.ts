// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import * as gateway from '../gateway/sdk.gen.js';
import type {
  AgentsResult,
  AuthListResult,
  CallResponse,
  CallSummary,
  HarnessView,
  HistoryEntry,
  LsResult,
  TokenSummary,
} from '../gateway/types.gen.js';
import { readCallStory, tellsInput } from '../model/call-story.js';
import type { CallStoryRead, StoryPage } from '../model/call-story.js';
import { onPlaneReach, plane, planeReach, unwrap } from './plane.js';
import type { PlaneReach } from './plane.js';
import type { ViewOptions } from './streams.js';

// What the screens ask of the plane. Nothing here asks on a clock: an
// answer is as fresh as its last asking, which is when a screen opens,
// when the window is returned to, after an action of the reader's own
// and at the reader's word.

/** Whether the plane answered the last thing this page asked of it,
 * heard as it changes. */
export function usePlaneReach(): PlaneReach {
  return useSyncExternalStore(onPlaneReach, planeReach);
}

/** The one keeper of what was asked. */
export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

export const keys = {
  ls: ['ls'] as const,
  lsOf: (agentId: string) => ['ls', agentId] as const,
  agents: ['agents'] as const,
  auth: ['auth'] as const,
  history: (agentId?: string) => ['history', agentId ?? ''] as const,
  calls: (agentId: string | undefined, limit: number) => ['calls', agentId ?? '', limit] as const,
  call: (callId: string, details: boolean, utc: boolean) => ['call', callId, details, utc] as const,
  callStory: (callId: string, status: string) => ['call-story', callId, status] as const,
  harness: ['harness'] as const,
  tokens: ['tokens'] as const,
  packageFile: (digest: string, name: string) => ['package-file', digest, name] as const,
  config: (place: string) => ['config', place] as const,
};

/** Every agent of the fleet, as `cernanto ls` lists it. */
export function useLs(): UseQueryResult<LsResult> {
  return useQuery({
    queryKey: keys.ls,
    queryFn: async () => unwrap(await gateway.ls({ client: plane }), 'the list of agents'),
  });
}

/** One agent's line with its functions. */
export function useLsOf(agentId: string): UseQueryResult<LsResult> {
  return useQuery({
    queryKey: keys.lsOf(agentId),
    queryFn: async () =>
      unwrap(
        await gateway.ls({ client: plane, query: { agent: agentId } }),
        `the line of ${agentId}`,
      ),
  });
}

/** The fleet's agents as shipped, its generations and its judgments. */
export function useAgents(): UseQueryResult<AgentsResult> {
  return useQuery({
    queryKey: keys.agents,
    queryFn: async () => unwrap(await gateway.agents({ client: plane }), 'the agents'),
    staleTime: 15_000,
  });
}

/** Every agent's accounts and the asks that wait for a person. */
export function useAuth(): UseQueryResult<AuthListResult> {
  return useQuery({
    queryKey: keys.auth,
    queryFn: async () => unwrap(await gateway.authList({ client: plane }), 'the accounts'),
    staleTime: 10_000,
  });
}

/** Which package ran when, newest first: the fleet's, or one agent's. */
export function useHistory(agentId?: string): UseQueryResult<HistoryEntry[]> {
  return useQuery({
    queryKey: keys.history(agentId),
    queryFn: async () =>
      unwrap(
        await gateway.history_({
          client: plane,
          query: { ...(agentId === undefined ? {} : { agent: agentId }) },
        }),
        'the history',
      ).entries,
    staleTime: 15_000,
  });
}

/** Recent calls, newest first: the plane's, or one agent's. */
export function useCalls(
  agentId: string | undefined,
  limit: number,
  enabled = true,
): UseQueryResult<CallSummary[]> {
  return useQuery({
    queryKey: keys.calls(agentId, limit),
    queryFn: async () =>
      unwrap(
        await gateway.calls({
          client: plane,
          query: { ...(agentId === undefined ? {} : { agent: agentId }), limit },
        }),
        'the calls',
      ).calls,
    enabled,
  });
}

/** How many calls' stories are read at once. A list in sight holds
 * dozens of calls, and one call's records may weigh megabytes. */
const STORIES_AT_ONCE = 4;
let storiesBeingRead = 0;
const storiesWaiting: (() => void)[] = [];

/** Waits for a turn to read a story, and leaves the line when the asking is given up. */
function storyTurn(signal: AbortSignal): Promise<void> {
  if (storiesBeingRead < STORIES_AT_ONCE) {
    storiesBeingRead += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const leave = (): void => {
      const at = storiesWaiting.indexOf(go);
      if (at >= 0) storiesWaiting.splice(at, 1);
      reject(new DOMException('The asking was given up.', 'AbortError'));
    };
    const go = (): void => {
      signal.removeEventListener('abort', leave);
      storiesBeingRead += 1;
      resolve();
    };
    storiesWaiting.push(go);
    signal.addEventListener('abort', leave, { once: true });
  });
}

export type { CallStoryRead };

/** The reader of a call's records a page after the other, for its story:
 * the one reading of a call's pages that every part of the screen that
 * says what a call was asked or answered goes by. */
function storyPages(
  callId: string,
  signal?: AbortSignal,
): (after: number | undefined) => Promise<StoryPage> {
  return async (after) =>
    unwrap(
      await gateway.call({
        client: plane,
        path: { callId },
        ...(after === undefined ? {} : { query: { after } }),
        ...(signal === undefined ? {} : { signal }),
      }),
      'this call',
    );
}

/**
 * What a call was asked, read as the list of calls reads it: from the
 * call's own records, on to the page that says it, so what a list shows
 * of a call and what is loaded of it are one reading.
 */
export async function readCallInput(callId: string): Promise<unknown> {
  return (await readCallStory(storyPages(callId), tellsInput)).input;
}

/**
 * What one call of a list was asked and what it answered, read from the
 * call's own records, which the list of calls does not hold. It is
 * asked once for a call as it stands, and again when the call ends; a
 * list asks it for the lines a reader reaches.
 */
export function useCallStory(call: CallSummary, enabled: boolean): UseQueryResult<CallStoryRead> {
  return useQuery({
    queryKey: keys.callStory(call.callId, call.status),
    queryFn: async ({ signal }) => {
      await storyTurn(signal);
      try {
        return await readCallStory(storyPages(call.callId, signal));
      } finally {
        storiesBeingRead -= 1;
        storiesWaiting.shift()?.();
      }
    },
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

/** One call whole, its records read a page after the other, each with
 * the lines the trace view reads it as. The reading is the one the
 * screen it is read for shows: its clock and its debug lines are said
 * by every caller. */
export async function readCall(
  callId: string,
  options: ViewOptions,
): Promise<CallResponse & { lines: string[][] }> {
  let zone: string | undefined;
  try {
    zone = options.utc ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    zone = undefined;
  }
  const records: CallResponse['records'] = [];
  const lines: string[][] = [];
  let after: number | undefined;
  for (;;) {
    const page = unwrap(
      await gateway.call({
        client: plane,
        path: { callId },
        query: {
          view: 'live',
          ...(after === undefined ? {} : { after }),
          ...(options.details === true ? { details: 'true' as const } : {}),
          ...(options.debug ? { debug: 'true' as const } : {}),
          ...(zone === undefined ? {} : { zone }),
        },
      }),
      'this call',
    );
    records.push(...page.records);
    lines.push(...(page.lines ?? page.records.map(() => [])));
    if (page.next === undefined || page.records.length === 0) {
      return { call: page.call, children: page.children, records, lines };
    }
    after = page.next;
  }
}

/** The plane's coding assistant, or none connected. */
export function useHarness(): UseQueryResult<HarnessView | null> {
  return useQuery({
    queryKey: keys.harness,
    queryFn: async () =>
      unwrap(await gateway.harnessView({ client: plane }), 'the coding assistant').harness,
    staleTime: 60_000,
  });
}

/** The plane's operator tokens, never a value. */
export function useTokens(enabled = true): UseQueryResult<TokenSummary[]> {
  return useQuery({
    queryKey: keys.tokens,
    queryFn: async () => unwrap(await gateway.tokenList({ client: plane }), 'the tokens').tokens,
    enabled,
  });
}

/** One file of a package the plane holds, as text. */
export async function readPackageFile(digest: string, name: string): Promise<string> {
  const result = await gateway.packageFile({
    client: plane,
    path: { digest },
    query: { name },
    parseAs: 'text',
  });
  return unwrap(result, name) as unknown as string;
}

/** One file of a package the plane holds, as its bytes: a file a source
 * names may be no text. */
export async function readPackageBytes(digest: string, name: string): Promise<Blob> {
  const result = await gateway.packageFile({
    client: plane,
    path: { digest },
    query: { name },
    parseAs: 'blob',
  });
  return unwrap(result, name);
}

/** One file of a package, kept for as long as the package is: a
 * package's bytes never change under its digest. */
export function usePackageFile(
  digest: string | undefined,
  name: string | undefined,
): UseQueryResult<string> {
  return useQuery({
    queryKey: keys.packageFile(digest ?? '', name ?? ''),
    queryFn: () => readPackageFile(digest ?? '', name ?? ''),
    enabled: digest !== undefined && name !== undefined,
    staleTime: Infinity,
    retry: false,
  });
}

/** Asks the plane for the listing again: when a conversation that is
 * followed shows that a call began or ended, so the list is as fresh as
 * the last thing the reader saw happen, and never on a clock. */
export function useAskListing(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.ls });
    void client.invalidateQueries({ queryKey: keys.auth });
  }, [client]);
}

/** Asks again for what a call changes, after the reader sent or
 * cancelled one: the listing, the calls and what waits for a person.
 * The fleet as shipped stays as it was read: the one call that ships
 * something, a module's first call by itself, asks the fleet again on
 * its own (`useAskAgain`), where it is sent. */
export function useAskAfterCall(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.ls });
    void client.invalidateQueries({ queryKey: keys.auth });
    void client.invalidateQueries({ queryKey: ['calls'] });
  }, [client]);
}

/** Asks the plane again for what the screens show of the fleet: after
 * an action of the reader's own, and at the reader's word. */
export function useAskAgain(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: keys.ls });
    void client.invalidateQueries({ queryKey: keys.agents });
    void client.invalidateQueries({ queryKey: keys.auth });
    void client.invalidateQueries({ queryKey: ['history'] });
    void client.invalidateQueries({ queryKey: ['calls'] });
  }, [client]);
}
