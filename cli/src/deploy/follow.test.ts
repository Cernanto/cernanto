// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { followWorkerRun } from './follow.js';

type FollowClient = Parameters<typeof followWorkerRun>[0];

function fake(overrides: Partial<Record<keyof FollowClient, unknown>>): FollowClient {
  return overrides as unknown as FollowClient;
}

test('a worker follow stays silent until go, narrates the run, and closes when it ends', async () => {
  // The follow is created before the ship: records buffer while the
  // deploy prints its own lines, go() takes over, and the run's own
  // handler record ends the story with the verdict and the trace
  // handle. An old generation's dying record is passed over.
  const at = '2026-08-21T10:00:00.000Z';
  const base = { agentId: 'news/monitor', callId: 'run_1', at };
  const oldTail = {
    agentId: 'news/monitor',
    callId: 'run_0',
    seq: 7,
    at: '2026-08-21T09:59:59.000Z',
    kind: 'log' as const,
    level: 'info' as const,
    message: 'the old generation still talking',
  };
  const begin = {
    ...base,
    seq: 0,
    kind: 'begin' as const,
    of: 'handler' as const,
    handler: 'run',
  };
  const log = {
    ...base,
    seq: 1,
    at: '2026-08-21T10:00:01.000Z',
    kind: 'log' as const,
    level: 'info' as const,
    message: 'checking the feed',
  };
  const end = {
    ...base,
    seq: 0,
    at: '2026-08-21T10:00:05.000Z',
    kind: 'handler' as const,
    handler: 'run',
    input: undefined,
    output: undefined,
    durationMs: 5000,
  };
  // The lines the plane renders each record as (the trace view's live
  // reading) ride the stream beside the record.
  const rendered = {
    begin: ['10:00:00  ← Run'],
    log: ['10:00:01  checking the feed'],
    end: ['10:00:05  → reply  5.0s', '            Done'],
  };
  let emit: ((record: unknown, lines?: string[]) => void) | undefined;
  const stopped: number[] = [];
  const asked: unknown[] = [];
  const client = fake({
    callsStream: (
      _agentId: string,
      streamOptions: { backlog?: number; view?: string; onOpen?: () => void },
      onRecord: (record: unknown, lines?: string[]) => void,
    ) => {
      asked.push(streamOptions.view);
      emit = onRecord;
      streamOptions.onOpen?.();
      return () => stopped.push(1);
    },
    call: (_callId: string, options: unknown) => {
      asked.push(options);
      return Promise.resolve({
        call: { callId: 'run_1' },
        records: [begin, log, end],
        lines: [rendered.begin, rendered.log, rendered.end],
      });
    },
  });
  let out = '';
  const follow = followWorkerRun(client, 'news/monitor', {
    write: (text) => (out += text),
    now: () => Date.parse(at),
  });
  await follow.opened;
  emit?.(oldTail, ['09:59:59  the old generation still talking']);
  emit?.(begin, rendered.begin);
  emit?.(log, rendered.log);
  assert.equal(out, '');
  follow.go();
  emit?.(end, rendered.end);
  const outcome = await follow.done;
  assert.deepEqual(outcome, { agentId: 'news/monitor', outcome: 'ok', callId: 'run_1' });
  assert.equal(stopped.length, 1);
  // The stream and the closing read both ask the plane for the live view.
  assert.deepEqual(asked, ['live', { view: 'live', details: false, debug: false }]);
  assert.equal(
    out,
    [
      'following news/monitor live; ctrl-c detaches and the program continues on the plane',
      '10:00:00  ← Run',
      '10:00:01  checking the feed',
      '10:00:05  → reply  5.0s',
      '            Done',
      '',
      'news/monitor finished   trace: cernanto trace run_1',
      '',
    ].join('\n'),
  );
});

test('a worker follow closes on a run keyed by the controller, the escaped id whole', async () => {
  // The controller starts a worker under
  // `worker:<env>:<agent>:p<port>`, and the run's call id is that key
  // escaped, with every `~` spelled out: the follow roots every record
  // on the first `~` (a linked module's call id is `<host>~<ordinal>`)
  // and closes only when the handler record's call id is the root it
  // claimed, so a `~` left in the key would root the run to a prefix of
  // itself and the follow would stay open.
  const callId = 'chain_report:20002:k-worker=003adev=003achain=002freport=003ap20002';
  const at = '2026-09-18T04:25:53.040Z';
  const base = { agentId: 'chain/report', callId, at };
  const begin = { ...base, seq: 0, kind: 'begin' as const, of: 'handler' as const, handler: 'run' };
  const linked = {
    agentId: 'chain/middle',
    callId: `${callId}~1`,
    seq: 0,
    at,
    kind: 'begin' as const,
    of: 'handler' as const,
    handler: 'compareFoundings',
    callerAgentId: 'chain/report',
  };
  const end = {
    ...base,
    seq: 0,
    at: '2026-09-18T04:26:15.724Z',
    kind: 'handler' as const,
    handler: 'run',
    input: {},
    durationMs: 22684,
  };
  let emit: ((record: unknown, lines?: string[]) => void) | undefined;
  const client = fake({
    callsStream: (
      _agentId: string,
      streamOptions: { onOpen?: () => void },
      onRecord: (record: unknown, lines?: string[]) => void,
    ) => {
      emit = onRecord;
      streamOptions.onOpen?.();
      return () => undefined;
    },
    call: () =>
      Promise.resolve({
        call: { callId },
        records: [begin, linked, end],
        lines: [['04:25:53  ← Run'], ['04:25:53  Middle  ← Report'], ['04:26:15  → reply  22.7s']],
      }),
  });
  let out = '';
  const follow = followWorkerRun(client, 'chain/report', {
    write: (text) => (out += text),
    now: () => Date.parse(at),
  });
  await follow.opened;
  follow.go();
  emit?.(begin, ['04:25:53  ← Run']);
  emit?.(linked, ['04:25:53  Middle  ← Report']);
  emit?.(end, ['04:26:15  → reply  22.7s']);
  const outcome = await follow.done;
  assert.deepEqual(outcome, { agentId: 'chain/report', outcome: 'ok', callId });
  assert.ok(out.includes(`chain/report finished   trace: cernanto trace ${callId}`), out);
});

test("a worker follow reports a failed run with the run's own error", async () => {
  const at = '2026-08-21T10:00:00.000Z';
  const base = { agentId: 'news/monitor', callId: 'run_9', at };
  const begin = {
    ...base,
    seq: 0,
    kind: 'begin' as const,
    of: 'handler' as const,
    handler: 'run',
  };
  const end = {
    ...base,
    seq: 0,
    at: '2026-08-21T10:00:02.000Z',
    kind: 'handler' as const,
    handler: 'run',
    input: undefined,
    error: 'the feed answered 500',
    durationMs: 2000,
  };
  let emit: ((record: unknown, lines?: string[]) => void) | undefined;
  const client = fake({
    callsStream: (
      _agentId: string,
      streamOptions: { onOpen?: () => void },
      onRecord: (record: unknown, lines?: string[]) => void,
    ) => {
      emit = onRecord;
      streamOptions.onOpen?.();
      return () => undefined;
    },
    call: () =>
      Promise.resolve({
        call: { callId: 'run_9' },
        records: [begin, end],
        lines: [['10:00:00  ← Run'], ['10:00:02  → error  the feed answered 500']],
      }),
  });
  let out = '';
  const follow = followWorkerRun(client, 'news/monitor', {
    write: (text) => (out += text),
    now: () => Date.parse(at),
  });
  await follow.opened;
  follow.go();
  emit?.(begin, ['10:00:00  ← Run']);
  emit?.(end, ['10:00:02  → error  the feed answered 500']);
  const outcome = await follow.done;
  assert.deepEqual(outcome, {
    agentId: 'news/monitor',
    outcome: 'failed',
    error: 'the feed answered 500',
    callId: 'run_9',
  });
  assert.ok(
    out.includes('news/monitor failed: the feed answered 500   trace: cernanto trace run_9'),
    out,
  );
});

test('a worker follow narrates every attempt of the run: the attempt tells two records of one sequence apart', async () => {
  const base = { agentId: 'news/monitor', callId: 'run_4' };
  const attemptOf = (attemptId: string, began: string, logged: string): unknown[] => [
    {
      ...base,
      attemptId,
      seq: 0,
      at: began,
      kind: 'begin' as const,
      of: 'handler' as const,
      handler: 'run',
    },
    {
      ...base,
      attemptId,
      seq: 1,
      at: logged,
      kind: 'log' as const,
      level: 'info' as const,
      message: 'checking the feed',
    },
  ];
  // The first attempt died with its process; the second begins the
  // handler again, its sequence starting over, and answers.
  const records = [
    ...attemptOf('att-1', '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:01.000Z'),
    ...attemptOf('att-2', '2026-08-21T10:00:03.000Z', '2026-08-21T10:00:04.000Z'),
    {
      ...base,
      attemptId: 'att-2',
      seq: 0,
      at: '2026-08-21T10:00:05.000Z',
      kind: 'handler' as const,
      handler: 'run',
      durationMs: 2000,
    },
  ];
  const lines = [
    ['10:00:00  ← Run'],
    ['10:00:01  checking the feed'],
    ['10:00:03  ← Run'],
    ['10:00:04  checking the feed'],
    ['10:00:05  → reply  2.0s'],
  ];
  let emit: ((record: unknown, lines?: string[]) => void) | undefined;
  const client = fake({
    callsStream: (
      _agentId: string,
      streamOptions: { onOpen?: () => void },
      onRecord: (record: unknown, lines?: string[]) => void,
    ) => {
      emit = onRecord;
      streamOptions.onOpen?.();
      return () => undefined;
    },
    call: () => Promise.resolve({ call: { callId: 'run_4' }, records, lines }),
  });
  let out = '';
  const follow = followWorkerRun(client, 'news/monitor', {
    write: (text) => (out += text),
    now: () => Date.parse('2026-08-21T10:00:00.000Z'),
  });
  await follow.opened;
  follow.go();
  records.forEach((record, index) => emit?.(record, lines[index]));
  assert.equal((await follow.done).outcome, 'ok');
  // Each attempt's lines once, in the order they came.
  assert.ok(out.includes(`${lines.map((group) => group.join('\n')).join('\n')}\n`), out);
  assert.equal(out.split('checking the feed').length - 1, 2);
});

test('a worker follow gives up plainly when the run never begins', async () => {
  const client = fake({
    callsStream: (_agentId: string, streamOptions: { onOpen?: () => void }) => {
      streamOptions.onOpen?.();
      return () => undefined;
    },
  });
  let out = '';
  const follow = followWorkerRun(client, 'news/monitor', {
    write: (text) => (out += text),
    startTimeoutMs: 20,
  });
  await follow.opened;
  follow.go();
  const outcome = await follow.done;
  assert.deepEqual(outcome, { agentId: 'news/monitor', outcome: 'unseen' });
  assert.ok(
    out.includes(
      'no run of news/monitor began within 0s; the deploy stands: cernanto trace news/monitor -f',
    ),
    out,
  );
});

test("a follow opened after the ship claims the run that began from the deploy's moment on", async () => {
  // The deploy began at 10:00:00 and the plane shipped inside the
  // compile: the run began at 10:00:20, and the follow opens at 10:01:00.
  const deployBegan = Date.parse('2026-08-21T10:00:00.000Z');
  const base = { agentId: 'news/monitor', callId: 'run_2' };
  const earlier = {
    agentId: 'news/monitor',
    callId: 'run_1',
    seq: 0,
    at: '2026-08-21T09:40:00.000Z',
    kind: 'begin' as const,
    of: 'handler' as const,
    handler: 'run',
  };
  const begin = {
    ...base,
    seq: 0,
    at: '2026-08-21T10:00:20.000Z',
    kind: 'begin' as const,
    of: 'handler' as const,
    handler: 'run',
  };
  const end = {
    ...base,
    seq: 0,
    at: '2026-08-21T10:00:25.000Z',
    kind: 'handler' as const,
    handler: 'run',
    input: undefined,
    output: undefined,
    durationMs: 5000,
  };
  const asked: (string | undefined)[] = [];
  const client = fake({
    callsStream: (
      _agentId: string,
      streamOptions: { since?: string; onOpen?: () => void },
      onRecord: (record: unknown, lines?: string[]) => void,
    ) => {
      asked.push(streamOptions.since);
      streamOptions.onOpen?.();
      // The backlog since the deploy's moment: the run before the
      // deploy, then the deploy's own, begun and ended already.
      setImmediate(() => {
        onRecord(earlier, ['09:40:00  ← Run']);
        onRecord(begin, ['10:00:20  ← Run']);
        onRecord(end, ['10:00:25  → reply  5.0s']);
      });
      return () => undefined;
    },
    call: () => Promise.resolve({ call: { callId: 'run_2' }, records: [begin, end], lines: [] }),
  });
  let out = '';
  const follow = followWorkerRun(client, 'news/monitor', {
    write: (text) => (out += text),
    since: deployBegan,
    now: () => Date.parse('2026-08-21T10:01:00.000Z'),
  });
  await follow.opened;
  follow.go();
  const outcome = await follow.done;
  assert.deepEqual(outcome, { agentId: 'news/monitor', outcome: 'ok', callId: 'run_2' });
  // The stream reads from the deploy's moment, with its margin for the
  // plane's clock.
  assert.deepEqual(asked, ['2026-08-21T09:55:00.000Z']);
  assert.ok(out.includes('news/monitor finished   trace: cernanto trace run_2'), out);
  assert.ok(!out.includes('09:40:00'), out);
});
