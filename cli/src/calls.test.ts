// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getCalls, oneLine } from './calls.js';
import type { ServerClient } from './server-client.js';
// The tables render this machine's time; the proof reads them in utc.
process.env['TZ'] = 'UTC';

test('calls renders one row per call: the function as spoken, the input, the answer, what it spent', async () => {
  const summaries = [
    {
      callId: 'inv_2',
      agentId: 'payments/payment-retry',
      handler: 'onPaymentFailed',
      at: '2026-08-09T12:00:02Z',
      durationMs: 12,
      status: 'ok',
    },
    {
      callId: 'inv_1',
      agentId: 'payments/payment-retry',
      handler: 'onPaymentFailed',
      at: '2026-08-09T12:00:01Z',
      durationMs: 1900,
      status: 'error',
      error: 'card declined',
    },
    {
      callId: 'inv_0',
      agentId: 'payments/payment-retry',
      handler: 'onPaymentFailed',
      at: '2026-08-09T12:00:00Z',
      durationMs: 0,
      status: 'running',
    },
  ];
  const records: Record<string, unknown[]> = {
    inv_2: [
      {
        kind: 'begin',
        of: 'handler',
        handler: 'onPaymentFailed',
        input: { paymentId: 'p7', amount: 12.5 },
      },
      // Two calls out: a judgment and a call of another agent.
      { kind: 'begin', of: 'call', target: 'cernanto/decision' },
      { kind: 'agent-call', target: 'cernanto/decision', result: true },
      { kind: 'begin', of: 'call', target: 'billing/charge' },
      { kind: 'agent-call', target: 'billing/charge', result: { ok: true } },
      { kind: 'handler', handler: 'onPaymentFailed', output: { recovered: true } },
    ],
    inv_1: [
      { kind: 'begin', of: 'handler', handler: 'onPaymentFailed', input: { paymentId: 'p6' } },
      { kind: 'handler', handler: 'onPaymentFailed', error: 'card declined' },
    ],
    inv_0: [
      { kind: 'begin', of: 'handler', handler: 'onPaymentFailed', input: { paymentId: 'p5' } },
    ],
  };
  const client = {
    calls: () => Promise.resolve(summaries),
    call: (callId: string) => Promise.resolve({ records: records[callId] ?? [] }),
  } as unknown as Pick<ServerClient, 'calls' | 'call'>;
  const now = (): number => Date.parse('2026-08-09T12:00:42Z');
  const text = await getCalls(client, { agent: 'payments/payment-retry', limit: 20 }, {}, now);
  assert.equal(
    text,
    [
      'FUNCTION           INPUT                        ANSWER                AT                   TOOK        CALLS OUT  CALL',
      'On payment failed  paymentId: p7, amount: 12.5  recovered: true       2026-08-09 12:00:02  12ms        2          inv_2',
      'On payment failed  paymentId: p6                error: card declined  2026-08-09 12:00:01  2s          0          inv_1',
      'On payment failed  paymentId: p5                running               2026-08-09 12:00:00  42s so far  0          inv_0',
      '',
    ].join('\n'),
  );
  // The plane's listing names the agent too.
  const whole = await getCalls(client, { limit: 20 }, {}, now);
  assert.match(whole, /^FUNCTION +AGENT +INPUT +ANSWER +AT +TOOK +CALLS OUT +CALL\n/);
  assert.match(whole, /On payment failed +payments\/payment-retry +paymentId: p7/);
});

test("the calls of an agent whose traces are off: a line beside the table says why none is listed, or that the ones listed were stored before; an agent that is on, and the plane's listing, get no line", async () => {
  const summary = {
    callId: 'inv_1',
    agentId: 'ops/was-on',
    handler: 'next',
    at: '2026-08-09T12:00:00Z',
    durationMs: 3,
    status: 'ok',
  };
  const standing: Record<string, string> = {
    'ops/quiet': 'off',
    'ops/was-on': 'off',
    'ops/web': 'on',
  };
  const listings: string[] = [];
  const client = {
    calls: (filter: { agent?: string }) =>
      Promise.resolve(filter.agent === 'ops/quiet' ? [] : [summary]),
    call: () => Promise.resolve({ records: [] }),
    ls: (agent?: string) => {
      listings.push(agent ?? '');
      return Promise.resolve({
        agents: [{ agentId: agent ?? '', type: 'task', traces: standing[agent ?? ''] }],
      });
    },
  } as unknown as Parameters<typeof getCalls>[0];
  const told = async (agent?: string): Promise<{ text: string; notes: string[] }> => {
    const notes: string[] = [];
    const text = await getCalls(
      client,
      { ...(agent === undefined ? {} : { agent }), limit: 20 },
      {},
      () => 0,
      (line) => notes.push(line),
    );
    return { text, notes };
  };
  const quiet = await told('ops/quiet');
  assert.match(
    quiet.text,
    /^FUNCTION +INPUT +ANSWER +AT +TOOK +CALLS OUT +CALL\n$/,
    'the head alone',
  );
  assert.deepEqual(quiet.notes, [
    'the traces of ops/quiet are off, so nothing of its calls is stored; turn them on with: cernanto traces ops/quiet on\n',
  ]);
  const before = await told('ops/was-on');
  assert.match(before.text, /\nNext +/);
  assert.deepEqual(before.notes, [
    'the traces of ops/was-on are off: what is shown was stored before, and nothing of its calls since is; turn them on with: cernanto traces ops/was-on on\n',
  ]);
  assert.deepEqual((await told('ops/web')).notes, [], 'an agent that is on');
  listings.length = 0;
  assert.deepEqual((await told()).notes, [], "the plane's listing");
  assert.deepEqual(listings, [], 'no agent is named, so none is asked about');
});

test('a line of an input or an answer: bare strings, key: value pairs, compact json, cut to the width', () => {
  assert.equal(oneLine('ibm'), 'ibm');
  assert.equal(oneLine(221.29), '221.29');
  assert.equal(
    oneLine({ name: 'ibm', count: 2, nested: { a: 1 } }),
    'name: ibm, count: 2, nested: {"a":1}',
  );
  assert.equal(oneLine(['a', 'b']), '["a","b"]');
  assert.equal(oneLine('x'.repeat(80)).length, 60);
  assert.ok(oneLine('x'.repeat(80)).endsWith('\u2026'));
});
