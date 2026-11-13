// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CernantoError } from '@cernanto/package-format';

import type { CallStreamEvent, TraceRecord } from './gateway/types.gen.js';
import type { ServerClient } from './server-client.js';
import { deployedToFollow, endLostFollow, followAgent, isAgentId, traceRun } from './trace.js';

type TracePlane = Pick<ServerClient, 'callStream' | 'calls' | 'describe'>;

function fake(overrides: Partial<Record<keyof TracePlane, unknown>>): TracePlane {
  return overrides as unknown as TracePlane;
}

/** A gateway whose call stream tells the events given, then ends. */
function streaming(
  events: (callId: string, options: unknown) => CallStreamEvent[],
  asked: unknown[] = [],
): TracePlane['callStream'] {
  return (callId, options, onEvent) => {
    const { onEnd, ...rest } = options;
    asked.push([callId, rest]);
    queueMicrotask(() => {
      for (const event of events(callId, rest)) onEvent(event);
      onEnd?.();
    });
    return () => undefined;
  };
}

async function run(
  client: TracePlane,
  target: string,
  options: Parameters<typeof traceRun>[2],
): Promise<string> {
  let text = '';
  await traceRun(client, target, options, (chunk) => {
    text += chunk;
  });
  return text;
}

const SUMMARY = {
  callId: 'inv_1',
  agentId: 'payments/payment-retry',
  handler: 'onPaymentFailed',
  at: '2026-08-09T12:00:00Z',
  durationMs: 42,
  status: 'ok' as const,
};

test("trace asks the gateway for the call's conversation stream and writes its lines as they come", async () => {
  // The chat is rendered on the plane by the trace view and streamed
  // by the gateway (`view=conversation`): the frame's lines ride alone,
  // a record's lines ride with it, and the cli writes each line as it
  // arrives, asking for the details and debug lines the flags name.
  const asked: unknown[] = [];
  const client = fake({
    callStream: streaming(
      () => [
        { call: SUMMARY, depth: 0 },
        {
          lines: [
            'Payment Retry · On payment failed  ok  42ms  inv_1',
            '2026-08-09 12:00:00 UTC',
            '',
            '12:00:00  ← On payment failed',
          ],
        },
        {
          record: {
            kind: 'log',
            level: 'info',
            message: 'retrying',
            agentId: 'a',
            callId: 'inv_1',
            seq: 1,
            at: '2026-08-09T12:00:01Z',
          },
          lines: ['', '12:00:01  retrying'],
        },
        { lines: ['', '12:00:02  → reply  42ms'] },
      ],
      asked,
    ),
  });
  const text = [
    'Payment Retry · On payment failed  ok  42ms  inv_1',
    '2026-08-09 12:00:00 UTC',
    '',
    '12:00:00  ← On payment failed',
    '',
    '12:00:01  retrying',
    '',
    '12:00:02  → reply  42ms',
    '',
  ].join('\n');
  assert.equal(await run(client, 'inv_1', {}), text);
  assert.equal(await run(client, 'inv_1', { details: true, debug: true }), text);
  assert.deepEqual(asked, [
    ['inv_1', { view: 'conversation', details: false, debug: false }],
    ['inv_1', { view: 'conversation', details: true, debug: true }],
  ]);
});

test('trace -o json assembles the tree the walk tells, no view asked', async () => {
  const asked: unknown[] = [];
  const call = (callId: string, agentId: string) => ({
    callId,
    agentId,
    handler: 'refund',
    at: '2026-08-16T20:00:00Z',
    durationMs: 5,
    status: 'ok' as const,
  });
  const record = (callId: string, seq: number) => ({
    kind: 'log' as const,
    level: 'info' as const,
    message: `line ${String(seq)}`,
    agentId: 'x',
    callId,
    seq,
    at: '2026-08-16T20:00:00Z',
  });
  const client = fake({
    callStream: streaming(
      () => [
        { call: call('inv_3', 'payments/refund-runner'), depth: 0 },
        { record: record('inv_3', 1) },
        { call: call('inv_3a', 'payments/books'), depth: 1 },
        { record: record('inv_3a', 1) },
        { call: call('inv_3aa', 'cernanto/decision'), depth: 2 },
        { call: call('inv_3b', 'payments/mail'), depth: 1 },
        { record: record('inv_3b', 1) },
        { record: record('inv_3b', 2) },
      ],
      asked,
    ),
  });
  const text = await run(client, 'inv_3', { output: 'json' });
  const expected = {
    call: call('inv_3', 'payments/refund-runner'),
    records: [record('inv_3', 1)],
    children: [
      {
        call: call('inv_3a', 'payments/books'),
        records: [record('inv_3a', 1)],
        children: [{ call: call('inv_3aa', 'cernanto/decision'), records: [], children: [] }],
      },
      {
        call: call('inv_3b', 'payments/mail'),
        records: [record('inv_3b', 1), record('inv_3b', 2)],
        children: [],
      },
    ],
  };
  // Written as the walk came, in the very text of the whole.
  assert.equal(text, `${JSON.stringify(expected, null, 2)}\n`);
  assert.deepEqual(asked, [['inv_3', { tree: true }]]);
  // A call alone, nothing beneath it.
  const alone = fake({
    callStream: streaming(() => [{ call: call('inv_5', 'payments/mail'), depth: 0 }]),
  });
  assert.equal(
    await run(alone, 'inv_5', { output: 'json' }),
    `${JSON.stringify({ call: call('inv_5', 'payments/mail'), records: [], children: [] }, null, 2)}\n`,
  );
});

test('trace --raw writes the records as one json array, each as it arrives', async () => {
  const records = [
    {
      kind: 'begin',
      of: 'handler',
      handler: 'run',
      agentId: 'a',
      callId: 'inv_1',
      seq: 0,
      at: '2026-08-09T12:00:00Z',
    },
    {
      kind: 'handler',
      handler: 'run',
      durationMs: 3,
      agentId: 'a',
      callId: 'inv_1',
      seq: 0,
      at: '2026-08-09T12:00:00Z',
    },
  ] as const;
  const client = fake({
    callStream: streaming(() => [
      { call: SUMMARY, depth: 0 },
      ...records.map((record) => ({ record })),
    ]),
  });
  const text = await run(client, 'inv_1', { raw: true });
  assert.equal(text, `${JSON.stringify(records, null, 2)}\n`);
  const empty = fake({ callStream: streaming(() => [{ call: SUMMARY, depth: 0 }]) });
  assert.equal(await run(empty, 'inv_1', { raw: true }), '[]\n');
});

test("an error the stream ends with is the trace's failure, in its words", async () => {
  const client = fake({
    callStream: streaming(() => [
      { call: SUMMARY, depth: 0 },
      { error: 'the store could not be reached' },
    ]),
  });
  await assert.rejects(run(client, 'inv_1', {}), /the store could not be reached/);
});

test("trace of an agent id reads the agent's latest call; none yet says so", async () => {
  const asked: { agent?: string; limit?: number }[] = [];
  const traced: string[] = [];
  const client = fake({
    calls: (filter: { agent?: string; limit?: number }) => {
      asked.push(filter);
      return Promise.resolve(
        filter.agent === 'text/word-count'
          ? [
              {
                callId: 'inv_run',
                agentId: 'text/word-count',
                handler: 'run',
                at: '2026-08-19T10:00:00Z',
                durationMs: 12,
                status: 'ok',
              },
            ]
          : [],
      );
    },
    callStream: streaming((callId) => {
      traced.push(callId);
      return [
        { call: { ...SUMMARY, callId, agentId: 'text/word-count', handler: 'run' }, depth: 0 },
        { lines: [`Word Count · Run  ok  12ms  ${callId}`] },
      ];
    }),
  });
  const text = await run(client, 'text/word-count', {});
  assert.deepEqual(asked, [{ agent: 'text/word-count', limit: 1 }]);
  assert.deepEqual(traced, ['inv_run']);
  assert.ok(text.startsWith('Word Count · Run  '), text);
  // A run id goes straight to the trace, no lookup.
  await run(client, 'inv_direct', {});
  assert.deepEqual(traced, ['inv_run', 'inv_direct']);
  assert.equal(asked.length, 1);
  await assert.rejects(
    run(client, 'ops/never-ran', {}),
    /no calls of "ops\/never-ran" yet.*cernanto trace ops\/never-ran -f/,
  );
});

test('trace of an id nothing is deployed as says so, for its latest call and for a follow, in place of waiting for calls that cannot come', async () => {
  const gone = (): Promise<never> =>
    Promise.reject(new CernantoError({ kind: 'terminal', message: 'no agent "ops/deleted"' }));
  // No call of it is recorded and the plane holds no such agent.
  const asked: string[] = [];
  const client = fake({
    calls: () => Promise.resolve([]),
    describe: (agentId: string) => {
      asked.push(agentId);
      return gone();
    },
  });
  const quick = { pause: () => Promise.resolve() };
  await assert.rejects(run(client, 'ops/deleted', quick), (error: unknown) => {
    assert.ok(error instanceof CernantoError);
    assert.equal(error.kind, 'terminal');
    assert.equal(
      error.message,
      'nothing is deployed as "ops/deleted" (list what runs with: cernanto ls)',
    );
    return true;
  });
  assert.deepEqual(asked, ['ops/deleted']);
  // A follow asks the same question before it opens its stream.
  await assert.rejects(
    deployedToFollow(client, 'ops/deleted'),
    /^CernantoError: nothing is deployed as "ops\/deleted" \(list what runs with: cernanto ls\)$/,
  );
  // A deployed agent that has not been called yet keeps its own words,
  // and is followed.
  const idle = fake({
    calls: () => Promise.resolve([]),
    describe: () => Promise.resolve({ agent: { agentId: 'ops/never-ran' } }),
  });
  await assert.rejects(
    run(idle, 'ops/never-ran', quick),
    /no calls of "ops\/never-ran" yet.*cernanto trace ops\/never-ran -f/,
  );
  await deployedToFollow(idle, 'ops/never-ran');
  // An ask the plane cannot answer leaves the follow to say its own.
  const unreachable = fake({
    describe: () =>
      Promise.reject(new CernantoError({ kind: 'retryable', message: 'fetch failed' })),
  });
  await deployedToFollow(unreachable, 'ops/never-ran');
});

test('trace of an agent id asks again while its latest call is young and still running, then reads it whole', async () => {
  const asked: number[] = [];
  const startedAt = new Date().toISOString();
  const client = fake({
    calls: () => {
      asked.push(Date.now());
      // Running for the first two asks (the sinks have not shipped the
      // end yet), settled at the third.
      const status = asked.length < 3 ? 'running' : 'ok';
      return Promise.resolve([
        {
          callId: 'inv_young',
          agentId: 'text/word-count',
          handler: 'run',
          at: startedAt,
          durationMs: asked.length < 3 ? 0 : 12,
          status,
        },
      ]);
    },
    callStream: streaming((callId) => [
      { call: { ...SUMMARY, callId, agentId: 'text/word-count', handler: 'run' }, depth: 0 },
      { lines: [`Word Count · Run  ok  12ms  ${callId}`] },
    ]),
  });
  const paused: number[] = [];
  const text = await run(client, 'text/word-count', {
    pause: (ms) => {
      paused.push(ms);
      return Promise.resolve();
    },
  });
  assert.equal(asked.length, 3, 'asked three times while the call read as running');
  assert.deepEqual(paused, [1000, 1000]);
  assert.ok(text.startsWith('Word Count · Run  '), text);
});

test('an agent id is told from a call id by its shape, a single segment included', async () => {
  assert.equal(isAgentId('text/word-count'), true);
  assert.equal(isAgentId('hello'), true);
  assert.equal(isAgentId('cernanto_compile:20002:k-compile-7c48d9ebffdb2b78'), false);
  assert.equal(isAgentId('inv_direct'), false);
  // A spec at the workspace's root: its one-segment id reads its latest call.
  const asked: unknown[] = [];
  const client = fake({
    calls: (filter: { agent?: string; limit?: number }) => {
      asked.push(filter);
      return Promise.resolve([
        {
          callId: 'hello:20002:k-1',
          agentId: 'hello',
          handler: 'greet',
          at: '2026-08-19T10:00:00Z',
          durationMs: 3,
          status: 'ok',
        },
      ]);
    },
    callStream: streaming((callId) => [{ lines: [`Hello · Greet  ok  3ms  ${callId}`] }]),
  });
  const text = await run(client, 'hello', {});
  assert.deepEqual(asked, [{ agent: 'hello', limit: 1 }]);
  assert.equal(text, 'Hello · Greet  ok  3ms  hello:20002:k-1\n');
});

type FollowPlane = Pick<ServerClient, 'callsStream'>;

/** One opening of the agent's stream, as the follow asked for it. */
interface Opening {
  backlog: number | undefined;
  since: string | undefined;
  open: () => void;
  tell: (record: unknown, lines?: string[]) => void;
  end: (error?: unknown) => void;
}

/** A plane whose stream openings are held for the test to drive. */
function openings(): { client: FollowPlane; opened: Opening[]; next: () => Promise<Opening> } {
  const opened: Opening[] = [];
  let taken = 0;
  const client = {
    callsStream: (
      _agentId: string,
      options: {
        backlog?: number;
        since?: string;
        onOpen?: () => void;
        onEnd?: (error?: unknown) => void;
      },
      onRecord: (record: TraceRecord, lines?: string[]) => void,
    ) => {
      opened.push({
        backlog: options.backlog,
        since: options.since,
        open: () => options.onOpen?.(),
        tell: (record, lines) => {
          onRecord(record as TraceRecord, lines);
        },
        end: (error) => options.onEnd?.(error),
      });
      return () => undefined;
    },
  } as unknown as FollowPlane;
  const next = async (): Promise<Opening> => {
    for (;;) {
      const opening = opened[taken];
      if (opening !== undefined) {
        taken += 1;
        return opening;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  return { client, opened, next };
}

const recordAt = (seq: number, at: string): unknown => ({
  agentId: 'text/word-count',
  callId: 'text_word-count:20002:k-1',
  seq,
  at,
  kind: 'log',
  level: 'info',
  message: `line ${String(seq)}`,
});

test("a follow whose stream the plane refuses ends in the plane's words", async () => {
  const { client, next } = openings();
  const said: string[] = [];
  const follow = followAgent(
    client,
    'ops/ghost',
    { backlog: 10 },
    () => undefined,
    (line) => said.push(line),
  );
  (await next()).end(new Error('no agent named ops/ghost is deployed'));
  await assert.rejects(follow.ended, /no agent named ops\/ghost is deployed/);
  assert.deepEqual(said, []);
});

test('a follow whose stream breaks reopens it from the last record told, each record written once', async () => {
  const { client, opened, next } = openings();
  const told: string[] = [];
  const said: string[] = [];
  const follow = followAgent(
    client,
    'text/word-count',
    { backlog: 10, reopenMs: 1 },
    (record, lines) => told.push(`${String(record.seq)} ${(lines ?? []).join('')}`),
    (line) => said.push(line),
  );
  const first = await next();
  assert.equal(first.backlog, 10);
  first.open();
  first.tell(recordAt(1, '2026-08-19T10:00:01.000Z'), ['one']);
  first.tell(recordAt(2, '2026-08-19T10:00:02.000Z'), ['two']);
  first.end(new Error('socket hang up'));
  const second = await next();
  // The reopened stream reads from the last record told, and tells it again.
  assert.equal(second.since, '2026-08-19T10:00:02.000Z');
  assert.equal(second.backlog, undefined);
  second.open();
  second.tell(recordAt(2, '2026-08-19T10:00:02.000Z'), ['two']);
  second.tell(recordAt(3, '2026-08-19T10:00:03.000Z'), ['three']);
  assert.deepEqual(told, ['1 one', '2 two', '3 three']);
  assert.deepEqual(said, ['the stream of text/word-count broke (socket hang up); reopening it\n']);
  // A stream the plane closes by itself is reopened the same way.
  second.end();
  (await next()).open();
  assert.equal(said[1], 'the stream of text/word-count ended; reopening it\n');
  follow.stop();
  await follow.ended;
  assert.equal(opened.length, 3);
});

test('a follow tells every attempt of a call: the sequence starts over with each, and the attempt tells them apart', async () => {
  const { client, next } = openings();
  const told: string[] = [];
  const follow = followAgent(
    client,
    'ops/flaky',
    { backlog: 10, reopenMs: 1 },
    (record) => {
      const { attemptId } = record;
      told.push(`${attemptId ?? ''} ${record.kind} ${String(record.seq)}`);
    },
    () => undefined,
  );
  const handlerOf = (attemptId: string, at: string, outcome: object): unknown => ({
    agentId: 'ops/flaky',
    callId: 'ops_flaky:20002:k-9',
    attemptId,
    seq: 0,
    at,
    kind: 'handler',
    handler: 'run',
    durationMs: 5,
    ...outcome,
  });
  const failed = handlerOf('att-1', '2026-08-19T10:00:01.000Z', {
    error: 'the provider timed out',
  });
  const answered = handlerOf('att-2', '2026-08-19T10:00:02.000Z', { result: 'done' });
  const first = await next();
  first.open();
  first.tell(failed);
  first.tell(answered);
  assert.deepEqual(told, ['att-1 handler 0', 'att-2 handler 0']);
  // A reopened stream tells the second attempt's record again: it is
  // written once.
  first.end(new Error('socket hang up'));
  const second = await next();
  second.open();
  second.tell(answered);
  assert.deepEqual(told, ['att-1 handler 0', 'att-2 handler 0']);
  follow.stop();
  await follow.ended;
});

test('a follow gives up in words once its reopenings keep failing', async () => {
  const { client, opened, next } = openings();
  const follow = followAgent(
    client,
    'text/word-count',
    { backlog: 0, reopenMs: 1 },
    () => undefined,
    () => undefined,
  );
  const lost = assert.rejects(
    follow.ended,
    /the stream of text\/word-count could not be reopened: connect ECONNREFUSED; follow it again with: cernanto trace text\/word-count -f/,
  );
  const first = await next();
  first.open();
  first.end(new Error('socket hang up'));
  // Every reopening is refused: the fifth in a row ends the follow.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    (await next()).end(new Error('connect ECONNREFUSED'));
  }
  await lost;
  assert.equal(opened.length, 6);
});

test('a follow whose stream is lost says so after the answer that holds the terminal has run to its end, and no answer begins from there', async () => {
  const told: string[] = [];
  let finishAnswer: () => void = () => undefined;
  const answering = new Promise<void>((resolve) => {
    finishAnswer = resolve;
  });
  const asks = {
    stop: (): void => {
      told.push('the watch stopped');
    },
    settled: (): Promise<void> => answering,
  };
  const ending = endLostFollow(asks, new Error('the stream was lost'), (error) => {
    told.push(`failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(told, ['the watch stopped'], 'the failure waits for the answer under way');
  finishAnswer();
  await ending;
  assert.deepEqual(told, ['the watch stopped', 'failed: the stream was lost']);
  // A follow that keeps no watch fails at once.
  const bare: string[] = [];
  await endLostFollow(undefined, new Error('lost'), () => bare.push('failed'));
  assert.deepEqual(bare, ['failed']);
});

test("a worker's follow ends when the program it watched ends, and not on an older run's end", async () => {
  const bootOf = (callId: string, seq: number, at: string, kind: 'begin' | 'handler'): unknown =>
    kind === 'begin'
      ? {
          agentId: 'chain/report',
          callId,
          seq,
          at,
          kind,
          of: 'handler',
          handler: 'boot',
          input: {},
        }
      : {
          agentId: 'chain/report',
          callId,
          seq,
          at,
          kind,
          handler: 'boot',
          output: 'Ended: run over, exit 0',
          durationMs: 1,
        };
  const { client, next } = openings();
  const told: string[] = [];
  const follow = followAgent(
    client,
    'chain/report',
    { backlog: 10, endsWithProgram: true },
    (record) => told.push(`${record.callId} ${String(record.seq)}`),
    () => undefined,
  );
  const first = await next();
  first.open();
  // The backlog carries an older run whole, its begin and its close:
  // the follow goes on.
  first.tell(bootOf('chain_report:20010:k-boot', 1, '2026-08-19T09:59:00.000Z', 'begin'), []);
  first.tell(bootOf('chain_report:20010:k-boot', 2, '2026-08-19T10:00:00.000Z', 'handler'), []);
  let ended = false;
  void follow.ended.then(() => {
    ended = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ended, false);
  // The watched program: its boot begins, runs, and closes.
  const now = new Date().toISOString();
  first.tell(bootOf('chain_report:20016:k-boot', 0, now, 'begin'), []);
  first.tell(recordAt(1, now), ['one']);
  first.tell(bootOf('chain_report:20016:k-boot', 1, now, 'handler'), []);
  await follow.ended;
  assert.equal(told.length, 5);
});

test("a worker's follow ends on its program's own close, the run call, before the process goes", async () => {
  const runOf = (seq: number, at: string, kind: 'begin' | 'handler'): unknown => ({
    agentId: 'chain/report',
    callId: 'chain_report:20016:k-worker',
    seq,
    at,
    kind,
    handler: 'run',
    ...(kind === 'begin' ? { of: 'handler', input: {} } : { output: undefined, durationMs: 16300 }),
  });
  const { client, next } = openings();
  const told: string[] = [];
  const follow = followAgent(
    client,
    'chain/report',
    { backlog: 10, endsWithProgram: true },
    (record) => told.push(`${record.callId} ${String(record.seq)}`),
    () => undefined,
  );
  const first = await next();
  first.open();
  // An older run in the backlog, begin and close, ends nothing.
  first.tell(
    {
      ...(runOf(8, '2026-08-19T09:59:00.000Z', 'begin') as object),
      callId: 'chain_report:20015:k-worker',
    },
    [],
  );
  first.tell(
    {
      ...(runOf(9, '2026-08-19T10:00:00.000Z', 'handler') as object),
      callId: 'chain_report:20015:k-worker',
    },
    [],
  );
  let ended = false;
  void follow.ended.then(() => {
    ended = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ended, false);
  // The program runs and its run call closes: the follow is over,
  // whether or not the process's boot call closes after it.
  const now = new Date().toISOString();
  first.tell(runOf(0, now, 'begin'), ['17:39:08  ← Run']);
  first.tell(recordAt(1, now), ['one']);
  first.tell(runOf(2, now, 'handler'), ['17:39:24  → reply  16.3s']);
  assert.equal(await follow.ended, 'program');
  assert.equal(told.length, 5);
});

test("a finished worker's follow ends as nothing began when no run begins within its patience, and goes on when one does", async () => {
  const runBegin = (at: string): unknown => ({
    agentId: 'chain/report',
    callId: 'chain_report:20017:k-worker',
    seq: 0,
    at,
    kind: 'begin',
    of: 'handler',
    handler: 'run',
    input: {},
  });
  // Nothing begins: the patience ends the follow.
  {
    const { client, next } = openings();
    const follow = followAgent(
      client,
      'chain/report',
      { backlog: 10, endsWithProgram: true, startPatienceMs: 20 },
      () => undefined,
      () => undefined,
    );
    (await next()).open();
    assert.equal(await follow.ended, 'nothing-began');
  }
  // A run begins in time (a restart's): the follow goes on to its close.
  {
    const { client, next } = openings();
    const follow = followAgent(
      client,
      'chain/report',
      { backlog: 10, endsWithProgram: true, startPatienceMs: 50 },
      () => undefined,
      () => undefined,
    );
    const first = await next();
    first.open();
    first.tell(runBegin(new Date().toISOString()), ['← Run']);
    await new Promise((resolve) => setTimeout(resolve, 70));
    let ended = false;
    void follow.ended.then(() => {
      ended = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ended, false);
    follow.stop();
    assert.equal(await follow.ended, 'stopped');
  }
});

test('a read of a call still running ends at the records that stand: a quiet after the last event lets the stream go', async () => {
  let stopped = 0;
  const client = fake({
    callStream: (
      callId: string,
      _options: { onEnd?: (error?: unknown) => void },
      onEvent: (event: CallStreamEvent) => void,
    ) => {
      // The stream never ends by itself: the call runs on.
      queueMicrotask(() => {
        onEvent({ lines: [`Clock · Run  running  ${callId}`] });
        onEvent({ lines: ['12:00:00  ← Run'] });
      });
      return () => {
        stopped += 1;
      };
    },
  });
  const out: string[] = [];
  await traceRun(client, 'basics_clock:20010:k-worker-1', { quietMs: 20 }, (text) => {
    out.push(text);
  });
  assert.equal(stopped, 1, 'the stream was let go');
  assert.deepEqual(out, [
    'Clock · Run  running  basics_clock:20010:k-worker-1\n',
    '12:00:00  ← Run\n',
  ]);
});
