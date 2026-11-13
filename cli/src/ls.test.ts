// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bytesWord, getLs, watchRendering } from './ls.js';
import type { LsPlane } from './ls.js';

// Golden-output tests: the automation contract promises stable
// shapes, so every table and json form is pinned to the byte.

function fake(overrides: Partial<Record<keyof LsPlane, unknown>>): LsPlane {
  return { ...overrides } as unknown as LsPlane;
}

test('ls shows workload resources and keeps unavailable measurements absent', async () => {
  const body = {
    sampledAt: '2026-09-13T12:00:00Z',
    usageSince: '2026-09-13T11:55:00Z',
    callsComplete: false,
    notices: [],
    metrics: true,
    agents: [
      {
        agentId: 'finance/quotes',
        type: 'task',
        status: 'Ready',
        copies: 1,
        ready: '1/1',
        restarts: 3,
        cpuMillicores: 14,
        memoryMi: 45.4,
        journalEntries: 14336,
        snapshotMi: 5.2,
        journalMi: 0.0137,
        incomingTotal: 1234,
        outgoingTotal: 2468,
        incomingActive: 5,
        outgoingActive: 2,
        copiesAsked: 1,
        copiesAnswered: 1,
        totalsSince: '2026-09-01T00:00:00Z',
        inputTokens: 100,
        outputTokens: 20,
      },
      {
        agentId: 'cernanto/compile',
        type: 'job',
        status: 'Ready',
        copies: 1,
        ready: '1/1',
        restarts: 0,
        cpuMillicores: 22,
        memoryMi: 128,
      },
    ],
  };
  const client = fake({ ls: () => Promise.resolve(body) });
  const text = await getLs(client, {}, { context: 'lab' });
  assert.match(text, /^lab plane {3}\d+ agents {3}\d\d:\d\d:\d\d\n/);
  assert.match(
    text,
    /AGENT +TYPE +STATUS +CPU +RAM +SNAPSHOT +JOURNAL +CALLS IN +ACTIVE IN +CALLS OUT +ACTIVE OUT +AI TOKENS +AI COST/,
  );
  assert.match(
    text,
    /finance\/quotes +task +ready +14m +45Mi +5.2Mi +14Ki +1234 +5 +2468 +2 +120 +-\n/,
  );
  // A row the plane sent no active calls for reads as it reads a total
  // it was not sent.
  assert.match(text, /cernanto\/compile +job +ready +22m +128Mi +- +- +- +- +- +- +- +-\n/);
  assert.doesNotMatch(text, /RESTARTS|FAILED TOTAL|Running|~|caller telemetry|shared/);
  // The rows come back by agent id, the json too.
  assert.equal(
    await getLs(client, { output: 'json' }),
    `${JSON.stringify({ ...body, agents: [body.agents[1], body.agents[0]] }, null, 2)}\n`,
  );
  const bare = await getLs(client, { noHeaders: true });
  assert.doesNotMatch(bare, /plane {3}|AGENT|resources are included/);
});

test("a row's status is the plane's word in lower case", async () => {
  const body = {
    sampledAt: '2026-09-13T12:00:00Z',
    usageSince: '2026-09-13T11:55:00Z',
    callsComplete: true,
    notices: [],
    metrics: false,
    agents: [
      {
        agentId: 'ops/mailer',
        type: 'task',
        status: 'Ready',
        copies: 1,
        ready: '1/1',
        restarts: 0,
      },
    ],
  };
  const client = fake({ ls: () => Promise.resolve(body) });
  // The plane's status word, in lower case, is the row's.
  assert.match(await getLs(client, {}), /ops\/mailer +task +ready /);
});

test('the active calls read as the copies answered: a sum, a partial sum, or unknown', async () => {
  const row = (agentId: string, fields: Record<string, unknown>): Record<string, unknown> => ({
    agentId,
    type: 'task',
    status: 'Ready',
    copies: 1,
    ready: '1/1',
    restarts: 0,
    incomingTotal: 40,
    outgoingTotal: 12,
    ...fields,
  });
  const body = {
    sampledAt: '2026-11-09T12:00:00Z',
    usageSince: '2026-11-09T11:55:00Z',
    callsComplete: true,
    notices: ['ops/partial: 1 of 3 copies did not answer for their active calls'],
    metrics: false,
    agents: [
      // Every copy answered: the sums, a zero as a zero.
      row('ops/all', { incomingActive: 5, outgoingActive: 0, copiesAsked: 2, copiesAnswered: 2 }),
      // No copy runs, so none was asked: nothing is active.
      row('ops/none', { incomingActive: 0, outgoingActive: 0, copiesAsked: 0, copiesAnswered: 0 }),
      // One copy of three did not answer: the sums are at least these.
      row('ops/partial', {
        incomingActive: 5,
        outgoingActive: 1,
        copiesAsked: 3,
        copiesAnswered: 2,
      }),
      // No copy answered: unknown, never zero.
      row('ops/silent', {
        incomingActive: 0,
        outgoingActive: 0,
        copiesAsked: 1,
        copiesAnswered: 0,
      }),
    ],
  };
  const text = await getLs(fake({ ls: () => Promise.resolve(body) }), {});
  assert.match(text, /ops\/all +task +ready +- +- +- +- +40 +5 +12 +0 +- +-\n/);
  assert.match(text, /ops\/none +task +ready +- +- +- +- +40 +0 +12 +0 +- +-\n/);
  assert.match(text, /ops\/partial +task +ready +- +- +- +- +40 +5\+ +12 +1\+ +- +-\n/);
  assert.match(text, /ops\/silent +task +ready +- +- +- +- +40 +\? +12 +\? +- +-\n/);
  // The plane's own line says which agent had a copy that did not answer.
  assert.match(text, /\nops\/partial: 1 of 3 copies did not answer for their active calls\n$/);
});

test('ls lists modules and interfaces beside the running agents', async () => {
  const row = (fields: Record<string, unknown>): Record<string, unknown> => ({
    copies: 0,
    ready: '0/0',
    restarts: 0,
    ...fields,
  });
  const body = {
    sampledAt: '2026-09-16T12:00:00Z',
    usageSince: '2026-09-16T11:55:00Z',
    callsComplete: true,
    notices: [],
    metrics: true,
    agents: [
      row({
        agentId: 'finance/format',
        type: 'module',
        status: 'In 1 agent',
        incomingTotal: 1208,
        outgoingTotal: 310,
        incomingActive: 2,
        outgoingActive: 1,
        copiesAsked: 1,
        copiesAnswered: 1,
        totalsSince: '2026-09-01T00:00:00Z',
      }),
      row({
        agentId: 'finance/quotes',
        type: 'service',
        status: 'Ready',
        copies: 1,
        ready: '1/1',
        cpuMillicores: 14,
        memoryMi: 45,
        incomingTotal: 1208,
        outgoingTotal: 894,
        inputTokens: 2000,
        outputTokens: 400,
        costUsd: 0.012,
      }),
      row({
        agentId: 'finance/source',
        type: 'interface',
        status: '2 implementors, 1 stale',
        copies: 1,
        ready: '1/1',
        incomingTotal: 1658,
        outgoingTotal: 1344,
        incomingActive: 3,
        outgoingActive: 0,
        copiesAsked: 3,
        copiesAnswered: 2,
        inputTokens: 2000,
        outputTokens: 400,
      }),
      row({
        agentId: 'cernanto/compile',
        type: 'job',
        status: 'Ready',
        copies: 1,
        ready: '1/1',
        cpuMillicores: 22,
        memoryMi: 128,
      }),
      row({
        agentId: 'cernanto/compile/plan',
        type: 'module',
        status: 'In 1 agent',
        incomingTotal: 40,
        outgoingTotal: 12,
      }),
      row({
        agentId: 'cernanto/llm-prompt',
        type: 'interface',
        status: '2 implementors',
      }),
    ],
  };
  const client = fake({ ls: () => Promise.resolve(body) });
  const text = await getLs(client, {}, { context: 'local' });
  // A module's active calls are its own, summed over the copies it is
  // linked into; an interface's are its implementors', partial here
  // since one of their three copies did not answer.
  assert.match(text, /finance\/format +module +linked +- +- +- +- +1208 +2 +310 +1 +- +-\n/);
  assert.match(
    text,
    /finance\/source +interface +contract, 1 stale +- +- +- +- +1658 +3\+ +1344 +0\+ +2400 +-\n/,
  );
  assert.match(text, /finance\/quotes +service +ready +14m +45Mi/);
  assert.match(text, /cernanto\/compile +job +ready /);
  // The platform's own modules and interfaces are rows like any other,
  // listed with the rest; a row the plane sent no active calls for
  // reads `-`.
  assert.match(text, /cernanto\/compile\/plan +module +linked +- +- +- +- +40 +- +12 +-/);
  assert.match(text, /cernanto\/llm-prompt +interface +contract/);
  assert.doesNotMatch(text, /hidden|--all|Modules: calls also count/);
  const byAgentId = { ...body, agents: [3, 4, 5, 0, 1, 2].map((i) => body.agents[i]) };
  assert.equal(await getLs(client, { output: 'json' }), `${JSON.stringify(byAgentId, null, 2)}\n`);
});

test('ls focused on a module or an interface names the agents behind it', async () => {
  const focused = (agents: Record<string, unknown>[]) =>
    fake({
      ls: () =>
        Promise.resolve({
          agents,
          sampledAt: '2026-09-16T12:00:00Z',
          usageSince: '2026-09-16T11:55:00Z',
          notices: [],
          metrics: false,
          callsComplete: true,
        }),
    });
  const base = { copies: 0, ready: '0/0', restarts: 0 };
  const module = await getLs(
    focused([
      {
        ...base,
        agentId: 'finance/format',
        type: 'module',
        status: 'In 2 agents',
        incomingTotal: 7,
        outgoingTotal: 3,
        totalsSince: '2026-09-01T00:00:00Z',
      },
      { ...base, agentId: 'finance/quotes', type: 'service', status: 'Ready' },
      { ...base, agentId: 'finance/report', type: 'task', status: 'Parked' },
    ]),
    {},
    { agentId: 'finance/format' },
  );
  assert.match(module, /Runs inside: finance\/quotes, finance\/report\n/);
  assert.match(module, /Call totals for finance\/format since 2026-09-01T00:00:00Z\./);
  const iface = await getLs(
    focused([
      {
        ...base,
        agentId: 'finance/source',
        type: 'interface',
        status: '2 implementors, 1 stale',
        functions: [{ name: 'quote' }],
      },
      { ...base, agentId: 'finance/legacy', type: 'task', status: 'Starting' },
      { ...base, agentId: 'finance/quotes', type: 'service', status: 'Ready' },
    ]),
    {},
    { agentId: 'finance/source' },
  );
  assert.match(iface, /Implemented by: finance\/legacy, finance\/quotes\n/);
  assert.match(iface, /FUNCTION\nquote/);
  const internal = await getLs(
    focused([
      {
        ...base,
        agentId: 'cernanto/compile/plan',
        type: 'module',
        status: 'In 1 agent',
      },
      { ...base, agentId: 'cernanto/compile', type: 'job', status: 'Ready' },
    ]),
    {},
    { agentId: 'cernanto/compile/plan' },
  );
  assert.match(internal, /cernanto\/compile\/plan +module +linked/);
  assert.match(internal, /Runs inside: cernanto\/compile\n/);
});

test('ls focuses on an agent and keeps whole run ids for debugging', async () => {
  let requested: unknown[] = [];
  const client = fake({
    ls: (...args: unknown[]) => {
      requested = args;
      return Promise.resolve({
        agents: [
          {
            agentId: 'finance/quotes',
            type: 'task',
            status: 'Ready',
            copies: 1,
            ready: '1/1',
            restarts: 0,
            functions: [{ name: 'price' }],
          },
        ],
        sampledAt: '2026-09-13T12:00:00Z',
        usageSince: '2026-09-13T11:55:00Z',
        notices: [],
        metrics: false,
        callsComplete: false,
      });
    },
  });
  const text = await getLs(client, {}, { agentId: 'finance/quotes' });
  assert.deepEqual(requested, ['finance/quotes']);
  assert.match(text, /FUNCTION\nprice/);
  assert.doesNotMatch(text, /~|caller telemetry|shared|resources are included|run-id/);
});

test('a journal size reads in whole bytes and kibibytes, one decimal from mebibytes on', () => {
  assert.equal(bytesWord(0), '0B');
  assert.equal(bytesWord(884), '884B');
  assert.equal(bytesWord(68_944), '67Ki');
  assert.equal(bytesWord(2_223_631), '2.1Mi');
  assert.equal(bytesWord(12_100_358), '12Mi');
  assert.equal(bytesWord(1_395_864_371), '1.3Gi');
  assert.equal(bytesWord(10_737_418_240), '10Gi');
});

test('a watch prints the rendering only when it changes', async () => {
  let n = 0;
  const seen: string[] = [];
  await watchRendering(
    () => {
      n += 1;
      return Promise.resolve(n < 3 ? 'same\n' : 'changed\n');
    },
    { write: (text) => seen.push(text), intervalMs: 1, until: () => n >= 4 },
  );
  assert.deepEqual(seen, ['same\n', 'changed\n']);
});
