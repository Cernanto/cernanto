// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { plane, unwrap } from '../api/plane.js';
import { useAgents, useAuth, useLs } from '../api/queries.js';
import * as gateway from '../gateway/sdk.gen.js';
import type { AgentAsk, AgentRow, GenerationRow, LsRow } from '../gateway/types.gen.js';
import { isPlatform } from './agent.js';

/** One agent as the screens draw it: its line of the listing, its row
 * as shipped, and the asks that wait for a person on it. */
export interface FleetAgent {
  id: string;
  ls: LsRow;
  /** The row as shipped, once the fleet was read. */
  row: AgentRow | undefined;
  asks: AgentAsk[];
  platform: boolean;
  /** One of the pair a compile proves an agent with: its test form, or its tester. */
  pair: boolean;
  /** The module this agent is, started by itself: a service that links
   * the module and has no function of its own. */
  standaloneOf: string | undefined;
  /** The moment of its newest call, when the plane holds one. */
  lastCallAt: string | undefined;
}

/** How long after its last call an agent counts as active. */
const ACTIVE_MS = 60_000;

/** Whether an agent is active: it holds a call now, or the plane holds
 * a call of it made within the last minute before the listing. */
export function isActive(agent: FleetAgent, sampledAt: string): boolean {
  if ((agent.ls.incomingActive ?? 0) > 0 || (agent.ls.outgoingActive ?? 0) > 0) return true;
  if (agent.lastCallAt === undefined) return false;
  return Date.parse(sampledAt) - Date.parse(agent.lastCallAt) < ACTIVE_MS;
}

/**
 * The moment of each agent's newest call. The listing does not answer
 * it, so it is read from the agent's own calls, one small asking an
 * agent, made again only when the listing shows that the agent's calls
 * moved. The platform's own agents are not asked: they answer every
 * request the screen itself makes.
 */
function useLastCalls(rows: LsRow[]): { moments: Map<string, string>; read: boolean } {
  const asked = useMemo(
    () => rows.filter((row) => !isPlatform(row.agentId) && (row.incomingTotal ?? 0) > 0),
    [rows],
  );
  const results = useQueries({
    queries: asked.map((row) => ({
      queryKey: ['last-call', row.agentId, row.incomingTotal ?? 0] as const,
      queryFn: async (): Promise<string | null> => {
        const calls = unwrap(
          await gateway.calls({ client: plane, query: { agent: row.agentId, limit: 1 } }),
          `the calls of ${row.agentId}`,
        ).calls;
        return calls[0]?.at ?? null;
      },
      staleTime: Infinity,
      placeholderData: keepPreviousData,
      retry: false,
    })),
  });
  const stamp = results.map((result) => result.data ?? '').join('|');
  const read = results.every((result) => !result.isPending);
  return useMemo(() => {
    const moments = new Map<string, string>();
    asked.forEach((row, index) => {
      const at = results[index]?.data;
      if (typeof at === 'string') moments.set(row.agentId, at);
    });
    return { moments, read };
    // The results' own identity changes at every render; their moments say when to read them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, stamp, read]);
}

/** The fleet as the screens draw it, and when the plane was asked. */
export interface Fleet {
  agents: FleetAgent[];
  byId: Map<string, FleetAgent>;
  sampledAt: string | undefined;
  usageSince: string | undefined;
  notices: string[];
  loading: boolean;
  /** Whether the plane's listing was read. Where it was not, no agent is
   * listed, and that says nothing of which agents the plane holds. */
  read: boolean;
  /** Whether any reading of the plane this window holds names an agent
   * under an id: its listing, or its agents as shipped. The two are
   * asked apart, so one may name an agent the other, read before it or
   * not read again, does not. */
  occupied: (agentId: string) => boolean;
  /** Whether every agent's newest call was read, so that the order by
   * activity is the one that will stand. */
  callsRead: boolean;
  error: unknown;
}

/** The fleet: the listing, the rows as shipped and the asks, laid over each other by id. */
export function useFleet(): Fleet {
  const ls = useLs();
  const shipped = useAgents();
  const auth = useAuth();
  const rows = ls.data?.agents;
  const lastCalls = useLastCalls(rows ?? NO_ROWS);
  return useMemo(() => {
    const shippedById = new Map((shipped.data?.agents ?? []).map((row) => [row.agentId, row]));
    const asks = auth.data?.asks ?? [];
    const agents = (rows ?? []).map((row): FleetAgent => {
      const shippedRow = shippedById.get(row.agentId);
      return {
        id: row.agentId,
        ls: row,
        row: shippedRow,
        asks: asks.filter((ask) => ask.agent === row.agentId),
        platform: isPlatform(row.agentId),
        pair: shippedRow?.form === 'test' || shippedRow?.form === 'tester',
        standaloneOf: shippedRow?.form === 'standalone' ? shippedRow.target : undefined,
        lastCallAt: lastCalls.moments.get(row.agentId),
      };
    });
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    return {
      agents,
      byId,
      sampledAt: ls.data?.sampledAt,
      usageSince: ls.data?.usageSince,
      notices: ls.data?.notices ?? [],
      loading: ls.isPending,
      read: ls.data !== undefined,
      occupied: (agentId) => byId.has(agentId) || shippedById.has(agentId),
      callsRead: !ls.isPending && lastCalls.read,
      error: ls.data === undefined ? ls.error : null,
    };
  }, [rows, shipped.data, auth.data, lastCalls, ls.data, ls.isPending, ls.error]);
}

const NO_ROWS: LsRow[] = [];

/**
 * The agent the Agents screen opens where an address names none: the
 * one the reader had open last, while the plane still holds it, or else
 * the first of their own as the list stands by activity, the one called
 * most lately. None on a plane that holds no agent of the reader's.
 *
 * @param last - The id the browser kept of the agent open last; null where it kept none.
 */
export function agentToOpen(
  fleet: Pick<Fleet, 'agents' | 'byId'>,
  last: string | null | undefined,
): string | undefined {
  if (last !== null && last !== undefined && fleet.byId.has(last)) return last;
  const own = fleet.agents.filter((agent) => !agent.platform && !agent.pair);
  const [first] = own.sort((a, b) => {
    if (a.lastCallAt !== undefined && b.lastCallAt !== undefined) {
      return b.lastCallAt.localeCompare(a.lastCallAt) || a.id.localeCompare(b.id);
    }
    if (a.lastCallAt !== undefined) return -1;
    if (b.lastCallAt !== undefined) return 1;
    return a.id.localeCompare(b.id);
  });
  return first?.id;
}

/** The agents that use an agent: the fleet's "uses" turned round. */
export function usersOf(agentId: string, fleet: Fleet): string[] {
  return fleet.agents
    .filter((agent) => agent.row?.uses.includes(agentId) === true && !agent.pair)
    .map((agent) => agent.id);
}

/**
 * Where a module's call runs when it names no agent: by itself, in the
 * module's standalone agent, which the plane starts at that call when
 * the module is not started. It stands for the choice among the
 * agents' ids: an agent's id is a path and never reads so.
 */
export const BY_ITSELF = ':itself';

/**
 * The places a call of a module runs, as the plane judges one: by
 * itself, first, and then the agents the module runs inside, the
 * fleet's agents whose newest generation composes it and that take a
 * call. A compile's pair is the compile's own and is none of them,
 * told by its form and never by its name. The module's standalone agent
 * is none of them either: it is where the module runs by itself, which
 * the first of the places already says. A module that is itself a
 * compile's test form is never started by itself, the plane refusing
 * it, so by itself is no place of its: it runs inside its pair alone.
 *
 * @param moduleId - The module.
 * @param fleet - The fleet as the screens draw it.
 * @param generations - Every generation the plane lists, of every agent.
 * @returns By itself, where the module may run so, then the agents' ids, sorted.
 */
export function runsInside(
  moduleId: string,
  fleet: Pick<Fleet, 'agents' | 'byId'>,
  generations: readonly Pick<GenerationRow, 'agentId' | 'gen' | 'composition'>[],
): string[] {
  const newest = new Map<string, Pick<GenerationRow, 'agentId' | 'gen' | 'composition'>>();
  for (const generation of generations) {
    const held = newest.get(generation.agentId);
    if (held === undefined || generation.gen > held.gen) newest.set(generation.agentId, generation);
  }
  // An agent that left the fleet keeps a generation for the moments it
  // takes to drain, and takes no call.
  const composing = [...newest.values()]
    .filter((generation) => generation.composition?.[moduleId] !== undefined)
    .map((generation) => generation.agentId)
    .filter((id) => {
      const agent = fleet.byId.get(id);
      return agent !== undefined && agent.ls.type !== 'worker' && !agent.pair;
    })
    .sort((a, b) => a.localeCompare(b));
  const alone = standaloneOf(moduleId, fleet);
  const inside = composing.filter((id) => id !== alone);
  return fleet.byId.get(moduleId)?.pair === true ? inside : [BY_ITSELF, ...inside];
}

/**
 * The module a call of an agent runs, whose function is called where the
 * module runs: the agent itself when it is a module; for an interface,
 * the implementor the plane binds to it, its setting `default`, when
 * that implementor is a module on the fleet. None for any other agent:
 * its call is its own.
 *
 * @param agent - The agent the box calls.
 * @param bound - For an interface, the implementor its `default` names; none where none is set or it was not read yet.
 * @param fleet - The fleet as the screens draw it.
 * @returns The module's id, or nothing.
 */
export function moduleCalled(
  agent: Pick<FleetAgent, 'id' | 'ls'>,
  bound: string | undefined,
  fleet: Pick<Fleet, 'byId'>,
): string | undefined {
  if (agent.ls.type === 'module') return agent.id;
  if (agent.ls.type !== 'interface' || bound === undefined) return undefined;
  return fleet.byId.get(bound)?.ls.type === 'module' ? bound : undefined;
}

/** An agent's name as the plane writes it at the head of a call's id. */
function nameInAnId(agentId: string): string {
  return agentId.replaceAll(/[^A-Za-z0-9]/g, '_');
}

/**
 * The agent a call of a module ran inside, which the cli's `--in` names
 * to make the same call again. A module has no copy of its own: the
 * request of its call was held by the agent it ran inside, and a call's
 * id begins with that agent's name as the plane writes it there. None
 * for a call of an agent that is no module, and none where the id tells
 * no one agent of the fleet: of several whose names read alike in an
 * id, the one the module runs inside is taken, when it is one. None for
 * a call the module ran by itself, in its standalone agent: the same
 * call is made again by naming no agent, which runs it by itself.
 *
 * @param call - The call: its id and the agent it is a call of.
 * @param fleet - The fleet as the screens draw it.
 * @param generations - Every generation the plane lists, of every agent.
 * @returns The agent's id, or nothing.
 */
export function ranInside(
  call: { callId: string; agentId: string },
  fleet: Pick<Fleet, 'agents' | 'byId'>,
  generations: readonly Pick<GenerationRow, 'agentId' | 'gen' | 'composition'>[],
): string | undefined {
  if (fleet.byId.get(call.agentId)?.ls.type !== 'module') return undefined;
  const head = call.callId.slice(0, Math.max(0, call.callId.indexOf(':')));
  if (head === '') return undefined;
  const alone = standaloneOf(call.agentId, fleet);
  if (alone !== undefined && nameInAnId(alone) === head) return undefined;
  const named = fleet.agents
    .map((agent) => agent.id)
    .filter((id) => id !== call.agentId && nameInAnId(id) === head);
  if (named.length <= 1) return named[0];
  const hosts = new Set(runsInside(call.agentId, fleet, generations));
  const hosting = named.filter((id) => hosts.has(id));
  return hosting.length === 1 ? hosting[0] : undefined;
}

/**
 * The agent the cli's `--in` names for a call an agent answered under a
 * module's name, read on that agent's own page: the agent itself, where
 * it links the module as any agent does; and none where it is the
 * module's standalone agent, told by its row, since the call ran the
 * module by itself and is made again by naming no agent, whether the
 * standalone agent still stands by then or not.
 *
 * @param agentId - The agent whose page shows the call.
 * @param moduleId - The module whose function the agent answered.
 * @param fleet - The fleet as the screens draw it.
 * @returns The agent's id, or nothing for a call by itself.
 */
export function insideOfLinked(
  agentId: string,
  moduleId: string,
  fleet: Pick<Fleet, 'byId'>,
): string | undefined {
  return fleet.byId.get(agentId)?.standaloneOf === moduleId ? undefined : agentId;
}

/** A module's standalone agent, while the module is started by itself. */
export function standaloneOf(moduleId: string, fleet: Pick<Fleet, 'agents'>): string | undefined {
  return fleet.agents.find((agent) => agent.standaloneOf === moduleId)?.id;
}
