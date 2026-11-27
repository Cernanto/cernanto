// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What narrows a screen rides in its address, after the `#`: the
// list's filter and its text, the view and the order of the Overview's
// table, an agent's tab, the call that is open. A link pasted into a
// ticket opens the same screen for a colleague.

export const LIST_FILTERS = ['active', 'failed', 'waiting', 'drafts'] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export const TABLE_VIEWS = ['not-ready', 'not-verified', 'restarted', 'most-cost'] as const;
export type TableView = (typeof TABLE_VIEWS)[number];

// An agent's tabs in the order they stand: what it does, what a person
// gives it, what the compile made of it.
export const AGENT_TABS = ['trace', 'calls', 'source', 'settings', 'contract', 'code'] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

/** The folder of a package's tests, as an address names it to open its first file. */
export const TESTS_FOLDER = 'tests/';

/** What narrows the list of agents, and the table of them on the
 * Overview: the two read one shape, each the words that are its own. */
export interface AgentsSearch {
  filter?: ListFilter;
  q?: string;
  view?: TableView;
  sort?: string;
  status?: string;
}

/** What an agent's screen shows. */
export interface AgentSearch extends AgentsSearch {
  tab?: AgentTab;
  call?: string;
  calls?: 'running' | 'failed';
  /** The file shown in the Compiled tab, or a folder ending in `/` for its first file. */
  file?: string;
  /** A line of the file shown, brought to the middle. */
  line?: number;
  gen?: number;
  /** A text searched in the conversation that is open. */
  find?: string;
}

function oneOf<T extends string>(value: unknown, among: readonly T[]): T | undefined {
  return typeof value === 'string' && (among as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function put<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** Reads the list's part of an address, leaving out what it does not know. */
export function agentsSearch(search: Record<string, unknown>): AgentsSearch {
  return {
    ...put('filter', oneOf(search['filter'], LIST_FILTERS)),
    ...put('q', text(search['q'])),
    ...put('view', oneOf(search['view'], TABLE_VIEWS)),
    ...put('sort', text(search['sort'])),
    ...put('status', text(search['status'])),
  };
}

/**
 * Reads an agent's part of an address. An address made while the
 * contract and the tests were readings of the Compiled tab still leads to
 * them: `reading=functions` opens the Contract tab, and `reading=tests`
 * the first file of the tests.
 */
export function agentSearch(search: Record<string, unknown>): AgentSearch {
  const gen = Number(search['gen']);
  const line = Number(search['line']);
  const reading = oneOf(search['reading'], ['tests', 'functions'] as const);
  return {
    ...agentsSearch(search),
    ...put('tab', reading === 'functions' ? 'contract' : oneOf(search['tab'], AGENT_TABS)),
    ...put('call', text(search['call'])),
    ...put('calls', oneOf(search['calls'], ['running', 'failed'] as const)),
    ...put('file', text(search['file']) ?? (reading === 'tests' ? TESTS_FOLDER : undefined)),
    ...put('line', Number.isInteger(line) && line > 0 ? line : undefined),
    ...put('gen', Number.isInteger(gen) && gen > 0 ? gen : undefined),
    ...put('find', text(search['find'])),
  };
}

/** A change of an address: a key set to `undefined` leaves the address. */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/** What an address holds once a change is laid over it. */
export function patched<T extends object>(previous: T, patch: Patch<T>): T {
  return Object.fromEntries(
    Object.entries({ ...previous, ...patch }).filter(([, value]) => value !== undefined),
  ) as T;
}

/**
 * Whether the reader still stands at the address they stood at when
 * this was asked. What a press asks of the plane may be answered a
 * while later, a call's record read, an install, a removal; an answer
 * that then takes the reader somewhere, or fills what they see, does
 * so only while they stand where they pressed: once they went
 * elsewhere, they are where they chose to be.
 *
 * @param read - Reads the address as it is now; the window's own where none is given.
 */
export function standingHere(read: () => string = () => window.location.href): () => boolean {
  const asked = read();
  return () => read() === asked;
}
