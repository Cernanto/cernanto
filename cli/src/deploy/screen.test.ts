// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { CompileProgressResponse, PlaneCompileResponse } from '../gateway/types.gen.js';
import type { TraceRecord } from '../gateway/types.gen.js';

import type { ProgressRecord } from './compile-view.js';
import {
  AccountNeeded,
  askHoldsCompile,
  CompileScreen,
  askOfCompile,
  detachHint,
  watchedCompile,
} from './screen.js';
import type { PendingAsk } from './screen.js';
import type { CompileClient } from './upload.js';
import { exitOf } from '../output.js';
import { terminalIo } from '../terminal.js';

const T0 = Date.parse('2026-08-17T15:04:12.000Z');

function record(
  seq: number,
  offsetS: number,
  fields: Omit<ProgressRecord, 'attemptId' | 'seq' | 'at'>,
): ProgressRecord {
  return {
    attemptId: 'att-1',
    seq,
    at: new Date(T0 + offsetS * 1000).toISOString(),
    ...fields,
  };
}

/** A short compile: one agent, its tests fail once, triage blames the
 * tests, the fix lands, the agent verifies live. */
function shortCompile(): ProgressRecord[] {
  const g = 'ops/greeter';
  return [
    record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }),
    record(100002, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: g }),
    record(100003, 1, { step: 'write code', state: 'begin', detail: 'attempt 1', subject: g }),
    record(100004, 30, {
      step: 'write code',
      state: 'end',
      detail: 'attempt 1',
      ok: true,
      subject: g,
    }),
    record(100005, 30, { step: 'write tests', state: 'begin', detail: 'attempt 1', subject: g }),
    record(100006, 60, {
      step: 'write tests',
      state: 'end',
      detail: 'attempt 1',
      ok: true,
      subject: g,
    }),
    record(100007, 60, { step: 'deploy', state: 'end', detail: 'dev', ok: true, subject: g }),
    record(100008, 70, {
      step: 'verify',
      state: 'end',
      detail: '1 test passed, 1 failed:',
      ok: false,
      subject: g,
      failures: [{ name: 'greets by name', message: 'expected "hi Ada", got "hi"' }],
    }),
    record(100009, 70, { step: 'triage', state: 'begin', detail: 'who is at fault', subject: g }),
    record(100010, 90, {
      step: 'triage',
      state: 'end',
      detail: 'the code is at fault',
      subject: g,
    }),
    record(100011, 90, { step: 'fix code', state: 'begin', detail: 'after triage', subject: g }),
    record(100012, 120, {
      step: 'fix code',
      state: 'end',
      detail: 'after triage',
      ok: true,
      subject: g,
    }),
    record(100013, 130, {
      step: 'check code',
      state: 'end',
      detail: 'after the fix',
      ok: true,
      subject: g,
    }),
    record(100014, 131, {
      step: 'store',
      state: 'end',
      detail: 'stored sha256:1',
      ok: true,
      subject: g,
    }),
    record(100015, 160, { step: 'deploy', state: 'end', detail: 'dev', ok: true, subject: g }),
    record(100016, 190, {
      step: 'verify',
      state: 'end',
      detail: '2 tests passed',
      ok: true,
      subject: g,
    }),
    record(100017, 190, {
      step: 'agent',
      state: 'end',
      detail: 'verified live in dev',
      ok: true,
      result: 'compiled',
      verification: 'live',
      durationMs: 189_000,
      subject: g,
    }),
    record(100018, 190, { step: 'done', state: 'end', detail: 'compile complete', ok: true }),
  ];
}

function screenOf(overrides: {
  /** The quiet form; absent, the log form the terminal shows by
   * default. */
  quiet?: boolean;
  now?: () => number;
  heartbeatMs?: number;
}): { screen: CompileScreen; out: string[] } {
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => {
      out.push(text);
    },
    ...(overrides.quiet === undefined ? {} : { quiet: overrides.quiet }),
    utc: true,
    compileId: 'compile-1',
    verify: true,
    startedAt: new Date(T0).toISOString(),
    now: overrides.now ?? ((): number => T0 + 200_000),
    ...(overrides.heartbeatMs === undefined ? {} : { heartbeatMs: overrides.heartbeatMs }),
  });
  return { screen, out };
}

test('the log: the header, one line per thing that happened as it came, then the table and the verdict', () => {
  // Append-only, the same on a terminal and a pipe: what a cloud
  // deploy does. Long steps show their begin (a session, a deploy,
  // a run), every end its outcome and elapsed, and a failure reads
  // whole in its place; the summary closes the compile.
  const { screen, out } = screenOf({});
  screen.start();
  for (const item of shortCompile()) screen.record(item);
  screen.finish({ traceHandle: 'inv-1', totalMs: 190_000 });
  assert.equal(
    out.join(''),
    [
      'compile compile-1   verify on   started 2026-08-17 15:04:12 UTC',
      '15:04:12  compile      plan         1 agent: ops/greeter',
      '15:04:13  ops/greeter  write code   attempt 1',
      '15:04:42  ops/greeter  write code   ok attempt 1',
      '15:04:42  ops/greeter  write tests  attempt 1',
      '15:05:12  ops/greeter  write tests  ok attempt 1',
      '15:05:12  ops/greeter  deploy       ok dev',
      '15:05:22  ops/greeter  verify       FAIL greets by name: expected "hi Ada", got "hi"',
      '15:05:22  ops/greeter  triage       who is at fault',
      '15:05:42  ops/greeter  triage       the code is at fault',
      '15:05:42  ops/greeter  fix code     after triage',
      '15:06:12  ops/greeter  fix code     fixed after triage',
      '15:06:22  ops/greeter  check code   ok after the fix',
      '15:06:23  ops/greeter  store        ok stored sha256:1',
      '15:06:52  ops/greeter  deploy       ok dev',
      '15:07:22  ops/greeter  verify       ok 2 tests passed',
      '15:07:22  ops/greeter  done         verified live in dev  3m09s',
      '15:07:22  compile      done         compile complete',
      '',
      'AGENT        WRITE CODE  WRITE TESTS  RUN TESTS  RESULT                TIME',
      'ops/greeter  2 attempts  1 attempt    2 ok       verified live in dev  3m09s',
      'done   1 agent verified live in dev   3m10s   trace: cernanto trace inv-1',
      '',
    ].join('\n'),
  );
  // The output is appended lines alone, free of cursor movement.
  assert.ok(!out.join('').includes(String.fromCharCode(27)));
});

test('an agent the compile only reads is no row of the table and no count of the verdict, done or failed', () => {
  // A compile of one agent prepares the packages of the agents beside
  // it and says so; they are read, never compiled.
  const read = (seq: number, subject: string): ProgressRecord =>
    record(seq, 0, {
      step: 'prepare',
      state: 'note',
      detail: `${subject}: the package in the tree (5b646e6a37)`,
      subject,
    });
  const beside = [read(100000.1, 'ops/mailer'), read(100000.2, 'ops/usher')];
  const done = screenOf({});
  done.screen.start();
  for (const item of [...beside, ...shortCompile()]) done.screen.record(item);
  done.screen.finish({ traceHandle: 'inv-1', totalMs: 190_000 });
  const said = done.out.join('');
  // Their lines are said as they came.
  assert.match(said, /\n15:04:12 {2}ops\/mailer +prepare +ops\/mailer: the package in the tree/);
  assert.match(said, /\n15:04:12 {2}ops\/usher +prepare +ops\/usher: the package in the tree/);
  assert.ok(
    said.endsWith(
      [
        'AGENT        WRITE CODE  WRITE TESTS  RUN TESTS  RESULT                TIME',
        'ops/greeter  2 attempts  1 attempt    2 ok       verified live in dev  3m09s',
        'done   1 agent verified live in dev   3m10s   trace: cernanto trace inv-1',
        '',
      ].join('\n'),
    ),
    said,
  );
  // A compile that fails names the agent it failed on, and no other.
  const failed = screenOf({});
  failed.screen.start();
  for (const item of [...beside, ...shortCompile().slice(0, 4)]) failed.screen.record(item);
  failed.screen.finish({ traceHandle: 'inv-2', failure: 'the plane went away' });
  const words = failed.out.join('');
  assert.ok(
    words.endsWith(
      [
        'AGENT        WRITE CODE  WRITE TESTS  RUN TESTS  RESULT                      TIME',
        'ops/greeter  1 attempt   -            -          FAILED the plane went away  0s',
        'failed   1 agent FAILED   30s   trace: cernanto trace inv-2',
        '',
      ].join('\n'),
    ),
    words,
  );
});

test('the default is quiet: what the compile read, a line of dots while it works, one verdict per agent, the verdict', () => {
  // A new author sees three things: what the compile understood of the
  // spec, that it is working, and what it made. The steps, the coder's
  // words and the tests' conversation are the log's (the default) and
  // the trace's; the dots are --quiet.
  const g = 'ops/greeter';
  const quiet = screenOf({ quiet: true });
  quiet.screen.start();
  quiet.screen.record(
    record(100000, 0, {
      step: 'plan',
      state: 'note',
      detail: 'reads a service: "one count this agent keeps for everyone who calls it"',
      subject: g,
    }),
  );
  quiet.screen.record(
    record(100000.2, 0, {
      step: 'plan',
      state: 'note',
      detail: 'reads a worker, from the Type: label',
      subject: g,
    }),
  );
  quiet.screen.record(
    record(100000.5, 0, {
      step: 'plan',
      state: 'note',
      detail: 'reads Uses: npm:yahoo-finance2',
      subject: g,
    }),
  );
  for (const item of shortCompile()) quiet.screen.record(item);
  quiet.screen.finish({ traceHandle: 'inv-1', totalMs: 190_000 });
  assert.equal(
    quiet.out.join(''),
    [
      'ops/greeter  reads a service',
      'ops/greeter  reads a worker',
      'ops/greeter  reads Uses: npm:yahoo-finance2',
      'compiling ops/greeter .............. verified live in dev  3m09s',
      '',
    ].join('\n'),
  );

  // A failure is the one thing said in full: the verdict line names it
  // and the last failing step's words follow, indented.
  const failed = screenOf({ quiet: true });
  failed.screen.start();
  failed.screen.record(record(1, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }));
  // What the compile read comes after the plan's end on the wire; the
  // dots open after it.
  failed.screen.record(
    record(1.5, 0, { step: 'plan', state: 'note', detail: 'reads a task', subject: g }),
  );
  failed.screen.record(record(2, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: g }));
  failed.screen.record(
    record(3, 1, { step: 'write code', state: 'begin', detail: 'attempt 1', subject: g }),
  );
  failed.screen.record(
    record(4, 20, { step: 'write code', state: 'end', detail: 'attempt 1', ok: true, subject: g }),
  );
  failed.screen.record(
    record(5, 21, {
      step: 'check code',
      state: 'end',
      detail: 'tsc: src/index.ts(3,1): error TS1005',
      ok: false,
      subject: g,
    }),
  );
  failed.screen.record(
    record(6, 22, {
      step: 'agent',
      state: 'end',
      detail: 'the code did not pass the checks',
      ok: false,
      result: 'failed',
      durationMs: 21_000,
      subject: g,
    }),
  );
  failed.screen.record(
    record(7, 22, { step: 'done', state: 'end', detail: 'compile failed', ok: false }),
  );
  failed.screen.finish({ traceHandle: 'inv-2', totalMs: 22_000 });
  const text = failed.out.join('');
  assert.ok(
    text.startsWith(
      'ops/greeter  reads a task\ncompiling ops/greeter ...\nops/greeter  failed: the code did not pass the checks\n  ',
    ),
    text,
  );
  assert.ok(text.includes('tsc: src/index.ts(3,1): error TS1005'), text);
  assert.ok(/\nfailed   1 agent .*trace: cernanto trace inv-2\n$/.test(text), text);
  assert.ok(!text.includes('AGENT        WRITE CODE'), text);
});

test('a long step in silence says it is still running every thirty seconds, with its elapsed', () => {
  // The Terraform device: a session that has been writing for two
  // minutes with nothing to report still shows a sign of life, and how
  // long it has been at it (since the step began, not since the last
  // line).
  let now = T0;
  const { screen, out } = screenOf({ now: () => now, heartbeatMs: 30_000 });
  screen.start();
  const records = shortCompile();
  screen.record(records[0] as ProgressRecord);
  screen.record(records[1] as ProgressRecord);
  screen.record(records[2] as ProgressRecord);
  const printed = out.length;
  now = T0 + 20_000;
  screen.tick();
  assert.equal(out.length, printed, 'twenty seconds of silence says nothing');
  now = T0 + 31_000;
  screen.tick();
  assert.equal(out.at(-1), '15:04:43  ops/greeter  write code   still running  30s\n');
  now = T0 + 45_000;
  screen.tick();
  assert.equal(out.length, printed + 1, 'the next heartbeat waits its thirty seconds');
  now = T0 + 62_000;
  screen.tick();
  assert.equal(out.at(-1), '15:05:14  ops/greeter  write code   still running  1m01s\n');
  // A record resets the silence.
  screen.record(records[3] as ProgressRecord);
  now = T0 + 80_000;
  screen.tick();
  assert.equal(out.at(-1), '15:04:42  ops/greeter  write code   ok attempt 1\n');
});

test("the sessions' activity prints under the agent and step running now, as the coder works", () => {
  // Every tool the coder reaches for is a log record of the harness
  // call under this compile; the screen follows the harness
  // stream and prints them where they belong. Another compile's session
  // on the same plane, and records other than the activity, stay out.
  const watched: { agentId: string; onRecord: (record: TraceRecord) => void }[] = [];
  const stopped: string[] = [];
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => {
      out.push(text);
    },
    utc: true,
    compileId: 'compile-1',
    verify: true,
    startedAt: new Date(T0).toISOString(),
    now: () => T0 + 200_000,
    callId: 'inv-1',
    activity: {
      callsStream: (agentId, onRecord) => {
        watched.push({ agentId, onRecord });
        return () => {
          stopped.push(agentId);
        };
      },
    },
  });
  screen.start();
  const harness = watched.find((entry) => entry.agentId === 'cernanto/harness/claude-code');
  assert.ok(harness, 'the harness stream is followed from the start');
  // The vendor agents' streams are followed beside the facade's: a
  // vendor turn is its own call, admitted by the begin record
  // that names this compile as its parent.
  const vendor = watched.find((entry) => entry.agentId === 'cernanto/harness/claude-code');
  assert.ok(vendor, 'the vendor stream is followed from the start');
  const g = 'ops/greeter';
  screen.record(record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }));
  screen.record(record(100002, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: g }));
  screen.record(
    record(100003, 1, { step: 'write code', state: 'begin', detail: 'attempt 1', subject: g }),
  );
  const at = (offsetS: number): string => new Date(T0 + offsetS * 1000).toISOString();
  harness.onRecord({
    kind: 'log',
    level: 'info',
    message: '+6.1s read src/agents/cernanto-decision.ts',
    agentId: 'cernanto/harness/claude-code',
    callId: 'inv-1~1',
    seq: 1,
    at: at(7),
  });
  harness.onRecord({
    kind: 'log',
    level: 'info',
    message: '+27.4s wrote src/index.ts',
    agentId: 'cernanto/harness/claude-code',
    callId: 'inv-1~1',
    seq: 2,
    at: at(28),
  });
  // Another compile's session, and a debug line: not this log's.
  harness.onRecord({
    kind: 'log',
    level: 'info',
    message: '+2.0s wrote elsewhere',
    agentId: 'cernanto/harness/claude-code',
    callId: 'inv-other~1',
    seq: 1,
    at: at(29),
  });
  harness.onRecord({
    kind: 'log',
    level: 'debug',
    message: 'noise',
    agentId: 'cernanto/harness/claude-code',
    callId: 'inv-1~1',
    seq: 3,
    at: at(29),
  });
  // A vendor turn of this compile (its begin names the compile call as
  // parent) narrates; a vendor turn nobody parented here does not.
  vendor.onRecord({
    kind: 'begin',
    of: 'handler',
    handler: 'openSession',
    agentId: 'cernanto/harness/claude-code',
    callId: 'inv-vendor-1',
    parentCallId: 'inv-1',
    seq: 0,
    at: at(29),
  });
  vendor.onRecord({
    kind: 'log',
    level: 'info',
    message: '+1.2s read src/index.ts',
    agentId: 'cernanto/harness/claude-code',
    callId: 'inv-vendor-1',
    seq: 1,
    at: at(29),
  });
  vendor.onRecord({
    kind: 'log',
    level: 'info',
    message: '+0.5s read elsewhere',
    agentId: 'cernanto/harness/claude-code',
    callId: 'inv-vendor-other',
    seq: 1,
    at: at(29),
  });
  screen.record(
    record(100004, 30, {
      step: 'write code',
      state: 'end',
      detail: 'attempt 1',
      ok: true,
      subject: g,
    }),
  );
  assert.deepEqual(out.slice(1), [
    '15:04:12  compile      plan         1 agent: ops/greeter\n',
    '15:04:13  ops/greeter  write code   attempt 1\n',
    '15:04:19  ops/greeter  write code   +6.1s read src/agents/cernanto-decision.ts\n',
    '15:04:40  ops/greeter  write code   +27.4s wrote src/index.ts\n',
    '15:04:41  ops/greeter  write code   +1.2s read src/index.ts\n',
    '15:04:42  ops/greeter  write code   ok attempt 1\n',
  ]);
  screen.finish({ totalMs: 200_000 });
  assert.deepEqual(stopped, [
    'cernanto/harness/claude-code',
    'cernanto/harness/codex',
    'cernanto/harness/fake',
  ]);
});

test('a session line is labelled with the step running at its own time, not at its arrival', () => {
  // A session line stamped before a step began reaches the screen after
  // that step's record (the sink delivers it at its tick). The
  // label follows the record's time.
  const watched: { agentId: string; onRecord: (record: TraceRecord) => void }[] = [];
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => {
      out.push(text);
    },
    utc: true,
    compileId: 'compile-1',
    verify: true,
    startedAt: new Date(T0).toISOString(),
    now: () => T0 + 200_000,
    callId: 'inv-1',
    activity: {
      callsStream: (agentId, onRecord) => {
        watched.push({ agentId, onRecord });
        return () => undefined;
      },
    },
  });
  screen.start();
  const harness = watched.find((entry) => entry.agentId === 'cernanto/harness/claude-code');
  assert.ok(harness, 'the harness stream is followed from the start');
  const g = 'ops/greeter';
  const at = (offsetS: number): string => new Date(T0 + offsetS * 1000).toISOString();
  const line = (seq: number, offsetS: number, message: string): TraceRecord => ({
    kind: 'log',
    level: 'info',
    message,
    agentId: 'cernanto/harness/claude-code',
    callId: 'inv-1~1',
    seq,
    at: at(offsetS),
  });
  screen.record(record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }));
  screen.record(record(100002, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: g }));
  harness.onRecord(line(1, 3, '+2.2s session 2.1.280 model claude-sonnet-5-5 tools 28'));
  screen.record(
    record(100003, 9, { step: 'write code', state: 'begin', detail: 'attempt 1', subject: g }),
  );
  // Stamped before the coder attempt began, delivered after it.
  harness.onRecord(line(2, 8, '+7.8s said {"helpUrl":"https://app.hubspot.com/"}'));
  harness.onRecord(line(3, 10, '+0.6s session 2.1.280 model claude-sonnet-5-5 tools 28'));
  assert.deepEqual(out.slice(1), [
    '15:04:12  compile      plan         1 agent: ops/greeter\n',
    '15:04:15  ops/greeter  agent        +2.2s session 2.1.280 model claude-sonnet-5-5 tools 28\n',
    '15:04:21  ops/greeter  write code   attempt 1\n',
    '15:04:20  ops/greeter  agent        +7.8s said {"helpUrl":"https://app.hubspot.com/"}\n',
    '15:04:22  ops/greeter  write code   +0.6s session 2.1.280 model claude-sonnet-5-5 tools 28\n',
  ]);
  screen.finish({ totalMs: 200_000 });
});

test('a pending ask from any agent surfaces through the poll and connects inline', async () => {
  // A linked module inside the agent under test asks for an
  // authorization, and its trace record rides the module's own stream,
  // outside the ones the screen follows. The poll reads the plane's
  // pending rows directly, so the ask surfaces wherever it was raised.
  const out: string[] = [];
  const asked: string[] = [];
  let resolveConnect: () => void = () => undefined;
  const rows: PendingAsk[] = [];
  const screen = new CompileScreen({
    write: (text) => out.push(text),
    compileId: 'compile-poll',
    verify: true,
    startedAt: '2026-08-20T12:04:12.000Z',
    utc: true,
    now: () => Date.parse('2026-08-20T12:06:00.000Z'),
    onAsk: (account) => {
      asked.push(account);
      return new Promise((resolve) => {
        resolveConnect = resolve;
      });
    },
    pendingAsks: () => Promise.resolve([...rows]),
  });
  rows.push({
    id: 'cr-1',
    kind: 'oauth',
    account: 'microsoft',
    agentId: 'office/client',
    requestedAt: '2026-08-20T12:05:00.000Z',
  });
  await screen.pollAsks();
  assert.deepEqual(asked, ['microsoft']);
  assert.ok(
    out.some((text) =>
      text.includes('office/client asked the operator authorization for microsoft'),
    ),
    out.join(''),
  );
  // A row fires once, and a second row for the account waits out the
  // flow in flight (the flow answers the account's rows itself,
  // follow-up stages included).
  rows.push({
    id: 'cr-2',
    kind: 'oauth',
    account: 'microsoft',
    agentId: 'office/client',
    requestedAt: '2026-08-20T12:05:30.000Z',
  });
  await screen.pollAsks();
  assert.deepEqual(asked, ['microsoft']);
  resolveConnect();
  await screen.asksSettled;
  // The flow settled and the second row still pends: a fresh flow.
  await screen.pollAsks();
  assert.deepEqual(asked, ['microsoft', 'microsoft']);
});

test('an ask row opened before this compile stays out of its screen', async () => {
  const out: string[] = [];
  const asked: string[] = [];
  const screen = new CompileScreen({
    write: (text) => out.push(text),
    compileId: 'compile-stale',
    startedAt: '2026-08-20T12:04:12.000Z',
    now: () => Date.parse('2026-08-20T12:06:00.000Z'),
    onAsk: (account) => {
      asked.push(account);
      return Promise.resolve();
    },
    pendingAsks: () =>
      Promise.resolve([
        {
          id: 'cr-old',
          kind: 'oauth' as const,
          account: 'microsoft',
          agentId: 'office/client',
          requestedAt: '2026-08-20T11:00:00.000Z',
        },
        {
          id: 'cr-undated',
          kind: 'oauth' as const,
          account: 'microsoft',
          agentId: 'office/client',
        },
      ]),
  });
  await screen.pollAsks();
  await screen.asksSettled;
  assert.deepEqual(asked, []);
  assert.equal(out.length, 0, out.join(''));
});

test("another compile's tester ask stays out of this compile's screen, whatever its age", async () => {
  // A run detached at Ctrl-C keeps compiling on the plane, and its
  // tester's ask belongs to that compile: this screen leaves it alone and
  // surfaces its own tester's.
  const out: string[] = [];
  const asked: string[] = [];
  const screen = new CompileScreen({
    write: (text) => out.push(text),
    compileId: 'compile-fedcba9876543210',
    startedAt: '2026-08-20T12:04:12.000Z',
    now: () => Date.parse('2026-08-20T12:06:00.000Z'),
    onAsk: (account) => {
      asked.push(account);
      return Promise.resolve();
    },
    pendingAsks: () =>
      Promise.resolve([
        {
          id: 'cr-theirs',
          kind: 'oauth' as const,
          account: 'google',
          agentId: 'connectors/google/client-tester-compile-0123456789abcdef-r1',
          requestedAt: '2026-08-20T12:03:30.000Z',
        },
        {
          id: 'cr-mine',
          kind: 'oauth' as const,
          account: 'google-mine',
          agentId: 'connectors/google/client-tester-compile-fedcba9876543210-r1',
          requestedAt: '2026-08-20T12:05:00.000Z',
        },
      ]),
  });
  await screen.pollAsks();
  await screen.asksSettled;
  assert.deepEqual(asked, ['google-mine']);
  assert.ok(!out.join('').includes('compile-0123456789abcdef'), out.join(''));
});
test('an older ask of an agent this compile names surfaces once its test round is under way, and not before', async () => {
  // A run left at Ctrl-C keeps its ask pending, and the next compile's
  // ask joins that row, older than the compile: the screen surfaces it
  // from the moment the compile's own round stands on the plane. Before
  // it, the row is the earlier run's alone: nothing of this compile
  // waits on it, and no copy of the agent is there to answer a provider
  // that checks the agent before it lets the person go on.
  const out: string[] = [];
  const asked: string[] = [];
  const screen = new CompileScreen({
    write: (text) => out.push(text),
    compileId: 'compile-joined',
    startedAt: '2026-08-20T12:04:12.000Z',
    now: () => Date.parse('2026-08-20T12:06:00.000Z'),
    onAsk: (account) => {
      asked.push(account);
      return Promise.resolve();
    },
    pendingAsks: () =>
      Promise.resolve([
        {
          id: 'cr-earlier-run',
          kind: 'fields' as const,
          account: 'connectors/postgres',
          agentId: 'connectors/postgres',
          name: 'postgres',
          provider: 'postgres',
          requestedAt: '2026-08-20T11:00:00.000Z',
        },
      ]),
  });
  screen.record(
    record(1, 0, { step: 'plan', state: 'end', detail: '1 agent: connectors/postgres' }),
  );
  screen.record(
    record(2, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: 'connectors/postgres' }),
  );
  // The compile works on its code: the row an earlier run left waits.
  await screen.pollAsks();
  await screen.asksSettled;
  assert.deepEqual(asked, []);
  assert.equal(out.join('').includes('asked the operator'), false, out.join(''));
  // The round's pair is deployed: the row is this compile's from here.
  screen.record(
    record(3, 20, {
      step: 'deploy',
      state: 'end',
      detail: 'dev',
      ok: true,
      subject: 'connectors/postgres',
    }),
  );
  await screen.pollAsks();
  await screen.asksSettled;
  assert.deepEqual(asked, ['connectors/postgres']);
  assert.ok(
    out.some((line) => line.includes('connectors/postgres asked the operator credentials')),
    out.join(''),
  );
});

test('a pipe names the connect command for a polled ask', async () => {
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => out.push(text),
    compileId: 'compile-pipe',
    startedAt: '2026-08-20T12:04:12.000Z',
    utc: true,
    now: () => Date.parse('2026-08-20T12:06:00.000Z'),
    pendingAsks: () =>
      Promise.resolve([
        {
          id: 'cr-1',
          kind: 'fields' as const,
          account: 'microsoft',
          agentId: 'office/client',
          requestedAt: '2026-08-20T12:05:00.000Z',
        },
      ]),
  });
  await screen.pollAsks();
  assert.ok(
    out.some((text) => text.includes('office/client asked the operator credentials for microsoft')),
    out.join(''),
  );
  assert.ok(
    out.some((text) =>
      text.includes(
        'log it in from another terminal: cernanto auth login microsoft (this run resumes by itself)',
      ),
    ),
    out.join(''),
  );
});

/** A promise and the function that keeps it. */
function held<T>(): { promise: Promise<T>; keep: (value: T) => void } {
  let keep: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    keep = resolve;
  });
  return { promise, keep };
}

const microsoftAsk: PendingAsk = {
  id: 'cr-late',
  kind: 'oauth',
  account: 'microsoft',
  agentId: 'office/client',
  requestedAt: '2026-08-20T12:05:00.000Z',
};

/** An ask of the watched compiles' own agent, raised while the compile
 * runs. */
function greeterAsk(): PendingAsk {
  return { ...microsoftAsk, agentId: 'ops/greeter', requestedAt: new Date().toISOString() };
}

test('a poll of the asks that the plane answers after the compile ended surfaces nothing: no line, no login', async () => {
  for (const end of ['the compile ended', 'the verdict printed'] as const) {
    const out: string[] = [];
    const asked: string[] = [];
    const rows = held<PendingAsk[]>();
    const screen = new CompileScreen({
      write: (text) => out.push(text),
      compileId: 'compile-late',
      startedAt: '2026-08-20T12:04:12.000Z',
      utc: true,
      now: () => Date.parse('2026-08-20T12:06:00.000Z'),
      onAsk: (account) => {
        asked.push(account);
        return Promise.resolve();
      },
      pendingAsks: () => rows.promise,
    });
    // The plane is asked, and the compile ends before it answers.
    const polling = screen.pollAsks();
    if (end === 'the compile ended') screen.endAsks();
    else screen.finish({});
    const printed = out.length;
    rows.keep([microsoftAsk]);
    await polling;
    await screen.asksSettled;
    assert.deepEqual(asked, [], end);
    assert.equal(out.length, printed, `${end}: ${out.slice(printed).join('')}`);
    // And no poll starts from there.
    await screen.pollAsks();
    await screen.asksSettled;
    assert.deepEqual(asked, [], end);
  }
});

test('a login waiting its turn never takes the terminal once the compile ended; the one that holds it runs to its end', async () => {
  const out: string[] = [];
  const asked: string[] = [];
  const first = held<undefined>();
  const screen = new CompileScreen({
    write: (text) => out.push(text),
    compileId: 'compile-turn',
    startedAt: '2026-08-20T12:04:12.000Z',
    utc: true,
    now: () => Date.parse('2026-08-20T12:06:00.000Z'),
    onAsk: async (account) => {
      asked.push(account);
      if (account === 'microsoft') await first.promise;
    },
    pendingAsks: () =>
      Promise.resolve([microsoftAsk, { ...microsoftAsk, id: 'cr-second', account: 'google' }]),
  });
  await screen.pollAsks();
  // The first login holds the terminal and the second waits behind it.
  await Promise.resolve();
  assert.deepEqual(asked, ['microsoft']);
  screen.endAsks();
  first.keep(undefined);
  await screen.asksSettled;
  assert.deepEqual(asked, ['microsoft']);
});

test('watchedCompile closes the asks when the compile ends: the verdict is the last word, whatever a late poll brings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'watched-asks-'));
  mkdirSync(join(root, 'ops'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), '# Greeter\n');
  const response: PlaneCompileResponse = {
    protocol: 0,
    status: 'ok',
    issues: [],
    agents: [
      { agentId: 'ops/greeter', status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0 },
    ],
    rows: [],
  };
  const steps = shortCompile();
  const asked: string[] = [];
  const out: string[] = [];
  // The plane holds every read of the asks until the compile has ended.
  const rows = held<PendingAsk[]>();
  let polls = 0;
  let reads = 0;
  const client: CompileClient = {
    packageExists: () => Promise.resolve(true),
    packagePut: () => Promise.resolve(),
    packageGet: () => Promise.reject(new Error('no store here')),
    land: () => Promise.reject(new Error('no landing here')),
    compile: () => Promise.resolve({ callId: 'inv-1' }),
    deploy: () => Promise.resolve({ callId: 'inv-1' }),
    compileProgress: async (compileId) => {
      reads += 1;
      // The compile goes on until a poll of the asks is under way.
      const ended = reads >= 3 && polls > 0;
      if (!ended) await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        compileId,
        callId: 'inv-1',
        status: ended ? 'done' : 'running',
        steps: ended ? steps : steps.slice(0, 6),
        ...(ended ? { answer: response } : {}),
      };
    },
    callsStream: () => () => undefined,
  };
  await watchedCompile(client, ['ops/greeter'], {
    compileId: 'compile-1',
    deploy: true,
    utc: true,
    detachOnInterrupt: false,
    agentsRoot: root,
    pollMs: 10,
    askPollMs: 5,
    write: (text) => {
      out.push(text);
    },
    onAsk: (account) => {
      asked.push(account);
      return Promise.resolve();
    },
    pendingAsks: () => {
      polls += 1;
      return rows.promise;
    },
  });
  assert.ok(polls > 0, 'the asks were polled while the compile ran');
  const printed = out.length;
  rows.keep([{ ...microsoftAsk, agentId: 'ops/greeter', requestedAt: new Date().toISOString() }]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(asked, []);
  assert.equal(out.length, printed, out.slice(printed).join(''));
  assert.match(out.join(''), /\ndone   1 agent .*\n$/);
});

/** A compile client whose compile runs until `ended` says so, then ends
 * the way given: one agent's narration, its first steps while the
 * compile runs and when it fails, the whole of it when it is done.
 * `over` resolves at the read that takes the compile's document, the
 * last thing a watch asks the plane before its compile ends. */
function compileClientEnding(
  ended: () => boolean,
  end: Pick<CompileProgressResponse, 'status' | 'answer' | 'error'>,
): { client: CompileClient; over: Promise<undefined> } {
  const whole = shortCompile();
  const begun = whole.slice(0, 6);
  const over = held<undefined>();
  const client: CompileClient = {
    packageExists: () => Promise.resolve(true),
    packagePut: () => Promise.resolve(),
    packageGet: () => Promise.reject(new Error('no store here')),
    land: () => Promise.reject(new Error('no landing here')),
    compile: () => Promise.resolve({ callId: 'inv-1' }),
    deploy: () => Promise.resolve({ callId: 'inv-1' }),
    compileProgress: async (compileId, options) => {
      if (options?.take === true) over.keep(undefined);
      if (!ended()) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { compileId, callId: 'inv-1', steps: begun, status: 'running' };
      }
      return { compileId, callId: 'inv-1', steps: end.status === 'done' ? whole : begun, ...end };
    },
    callsStream: () => () => undefined,
  };
  return { client, over: over.promise };
}

/** Resolves once the watch of a compile that is over has gone on past
 * its compile's end: everything between the two is already queued. */
async function watchWentOn(over: Promise<undefined>): Promise<void> {
  await over;
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** A workspace holding the one agent the watched compiles name. */
function greeterWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'watched-end-'));
  mkdirSync(join(root, 'ops'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), '# Greeter\n');
  return root;
}

test('a compile that fails while a login holds the terminal ends as one that passes does: the verdict and the failure wait for the login, and no other login begins', async () => {
  const asked: string[] = [];
  const out: string[] = [];
  const first = held<undefined>();
  // The compile fails once the first login holds the terminal.
  const { client, over } = compileClientEnding(() => asked.length > 0, {
    status: 'failed',
    error: { kind: 'terminal', message: 'the compiler stopped' },
  });
  let ending: 'open' | 'answered' | 'failed' = 'open';
  let failure: unknown;
  const watching = watchedCompile(client, ['ops/greeter'], {
    compileId: 'compile-1',
    deploy: true,
    utc: true,
    detachOnInterrupt: false,
    agentsRoot: greeterWorkspace(),
    pollMs: 10,
    askPollMs: 5,
    write: (text) => {
      out.push(text);
    },
    onAsk: async (account) => {
      asked.push(account);
      if (asked.length === 1) await first.promise;
    },
    pendingAsks: () =>
      Promise.resolve([greeterAsk(), { ...greeterAsk(), id: 'cr-second', account: 'google' }]),
  }).then(
    () => {
      ending = 'answered';
    },
    (error: unknown) => {
      ending = 'failed';
      failure = error;
    },
  );
  // The compile fails, and the login still holds the terminal.
  await watchWentOn(over);
  assert.equal(ending, 'open', 'the failure waits for the login');
  assert.doesNotMatch(out.join(''), /\nfailed {3}/, 'and so does the verdict');
  first.keep(undefined);
  await watching;
  assert.equal(ending, 'failed');
  assert.match(String(failure), /the compiler stopped/);
  assert.deepEqual(asked, ['microsoft'], 'no other login begins');
  assert.match(out.join(''), /\nfailed {3}.*\n$/);
});

test('a compile that ends while a login holds the terminal tells the login at once how it ended, once, and the verdict still waits for the login', async () => {
  // The log waits behind the prompt, so a person who reads the prompt
  // alone would go on answering a run that is over: the end is said
  // above the prompt the moment it comes, and the login stays theirs.
  const answer = (verification: 'live' | 'waiting'): PlaneCompileResponse => ({
    protocol: 0,
    status: 'ok',
    issues: [],
    agents: [
      {
        agentId: 'ops/greeter',
        status: 'compiled',
        attempts: 1,
        triageCount: 0,
        costUsd: 0,
        verification,
      },
    ],
    rows: [],
  });
  const endings: [Pick<CompileProgressResponse, 'status' | 'answer' | 'error'>, RegExp][] = [
    [
      { status: 'failed', error: { kind: 'terminal', message: 'the compiler stopped' } },
      /it failed: .*the compiler stopped/,
    ],
    [
      {
        status: 'done',
        answer: {
          ...answer('live'),
          status: 'compile-failure',
          agents: [
            { agentId: 'ops/greeter', status: 'failed', attempts: 1, triageCount: 0, costUsd: 0 },
          ],
        },
      },
      /ops\/greeter failed\./,
    ],
    [{ status: 'done', answer: answer('waiting') }, /its tests stopped waiting for a login\./],
    [{ status: 'done', answer: answer('live') }, /it passed\./],
  ];
  for (const [end, outcome] of endings) {
    const asked: string[] = [];
    const out: string[] = [];
    const first = held<undefined>();
    const { client, over } = compileClientEnding(() => asked.length > 0, end);
    const watching = watchedCompile(client, ['ops/greeter'], {
      compileId: 'compile-1',
      deploy: true,
      utc: true,
      detachOnInterrupt: false,
      agentsRoot: greeterWorkspace(),
      pollMs: 10,
      askPollMs: 5,
      write: (text) => {
        out.push(text);
      },
      onAsk: async (account) => {
        asked.push(account);
        await first.promise;
      },
      pendingAsks: () => Promise.resolve([greeterAsk()]),
    }).catch(() => undefined);
    await watchWentOn(over);
    const told = out.join('');
    assert.match(told, /\nthe compile ended while this login waits: /, String(outcome));
    assert.match(told, outcome);
    assert.match(told, /The login above is still open: answer it .*, or press Ctrl-C; .*\n$/);
    assert.doesNotMatch(told, /\n(?:failed|done) {3}/, 'the verdict waits for the login');
    first.keep(undefined);
    await watching;
    const whole = out.join('');
    assert.equal(
      whole.split('the compile ended while this login waits').length,
      2,
      'the end is said once',
    );
    assert.match(whole.slice(told.length), /\n(?:failed|done) {3}.*\n$/, 'then the verdict');
  }
});

test('a compile that ends with no login at the terminal says nothing of one', async () => {
  const out: string[] = [];
  const { client } = compileClientEnding(() => true, {
    status: 'failed',
    error: { kind: 'terminal', message: 'the compiler stopped' },
  });
  await watchedCompile(client, ['ops/greeter'], {
    compileId: 'compile-1',
    deploy: true,
    utc: true,
    detachOnInterrupt: false,
    agentsRoot: greeterWorkspace(),
    pollMs: 10,
    askPollMs: 5,
    write: (text) => {
      out.push(text);
    },
    onAsk: () => Promise.resolve(),
    pendingAsks: () => Promise.resolve([]),
  }).catch(() => undefined);
  assert.doesNotMatch(out.join(''), /this login waits/);
  assert.match(out.join(''), /\nfailed {3}.*\n$/);
});

test('an interrupt after the compile ended says its verdict, never that the compile goes on', async () => {
  for (const end of ['failed', 'done'] as const) {
    const asked: string[] = [];
    const out: string[] = [];
    const exits: number[] = [];
    const first = held<undefined>();
    const { client, over } = compileClientEnding(
      () => asked.length > 0,
      end === 'failed'
        ? {
            status: 'failed',
            error: { kind: 'terminal', message: 'the compiler stopped' },
          }
        : {
            status: 'done',
            answer: {
              protocol: 0,
              status: 'ok',
              issues: [],
              agents: [
                {
                  agentId: 'ops/greeter',
                  status: 'compiled',
                  attempts: 1,
                  triageCount: 0,
                  costUsd: 0,
                },
              ],
              rows: [],
            },
          },
    );
    const watching = watchedCompile(client, ['ops/greeter'], {
      compileId: 'compile-1',
      deploy: true,
      utc: true,
      agentsRoot: greeterWorkspace(),
      pollMs: 10,
      askPollMs: 5,
      write: (text) => {
        out.push(text);
      },
      exit: (code) => {
        exits.push(code);
      },
      onAsk: async (account) => {
        asked.push(account);
        await first.promise;
      },
      pendingAsks: () => Promise.resolve([greeterAsk()]),
    }).catch(() => undefined);
    await watchWentOn(over);
    // The operator leaves the login that still holds the terminal.
    process.emit('SIGINT');
    assert.deepEqual(exits, [130], end);
    const text = out.join('');
    assert.doesNotMatch(text, /detached; the compile continues/, end);
    assert.match(text, end === 'failed' ? /\nfailed {3}.*\n$/ : /\ndone {3}.*\n$/, end);
    first.keep(undefined);
    await watching;
    assert.equal(text, out.join(''), `${end}: the verdict is said once`);
  }
});

test("Ctrl-C typed at a login's own prompt reaches the watch: a failed compile says its verdict before the process ends", async () => {
  // The login reads its answer from a terminal in raw mode, where
  // Ctrl-C arrives as a key and never as a signal.
  const keys = new PassThrough();
  const modes: boolean[] = [];
  const ended: string[] = [];
  const out: string[] = [];
  // What the log held at the moment the process ended.
  let said = '';
  const io = terminalIo({
    input: Object.assign(keys, {
      isTTY: true,
      setRawMode: (mode: boolean): void => {
        modes.push(mode);
      },
    }),
    output: { write: (): boolean => true },
    exit: (code) => {
      ended.push(`the terminal ended the process with ${String(code)}`);
    },
  });
  const asked: string[] = [];
  const { client, over } = compileClientEnding(() => asked.length > 0, {
    status: 'failed',
    error: { kind: 'terminal', message: 'the compiler stopped' },
  });
  const watching = watchedCompile(client, ['ops/greeter'], {
    compileId: 'compile-1',
    deploy: true,
    utc: true,
    agentsRoot: greeterWorkspace(),
    pollMs: 10,
    askPollMs: 5,
    write: (text) => {
      out.push(text);
    },
    exit: (code) => {
      said = out.join('');
      ended.push(
        `the watch ended the process with ${String(code)}, the terminal ${modes.at(-1) === false ? 'restored' : 'raw'}`,
      );
    },
    onAsk: async (account) => {
      asked.push(account);
      await io.ask('password', true);
    },
    pendingAsks: () => Promise.resolve([greeterAsk()]),
  }).catch(() => undefined);
  // The compile fails while the operator is at the prompt.
  await watchWentOn(over);
  assert.doesNotMatch(out.join(''), /\nfailed {3}/, 'the verdict waits for the login');
  keys.write('half a pass\u0003');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ended, ['the watch ended the process with 130, the terminal restored']);
  assert.match(said, /\nfailed {3}.*\n$/, 'the verdict is the last word before the end');
  assert.doesNotMatch(said, /detached; the compile continues/);
  await watching;
});

test('watchedCompile drives the plane compile under the screen and closes with the trace handle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'watched-'));
  mkdirSync(join(root, 'ops'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), '# Greeter\n');
  const response: PlaneCompileResponse = {
    protocol: 0,
    status: 'ok',
    issues: [],
    agents: [
      { agentId: 'ops/greeter', status: 'compiled', attempts: 1, triageCount: 1, costUsd: 0 },
    ],
    rows: [],
  };
  const steps = shortCompile();
  let reads = 0;
  const verbs: string[] = [];
  const submitted: unknown[] = [];
  const client: CompileClient = {
    packageExists: () => Promise.resolve(true),
    packagePut: () => Promise.resolve(),
    packageGet: () => Promise.reject(new Error('no store here')),
    land: () => Promise.reject(new Error('no landing here')),
    compile: () => {
      verbs.push('compile');
      return Promise.resolve({ callId: 'inv-1' });
    },
    deploy: (request) => {
      verbs.push('deploy');
      submitted.push(request);
      return Promise.resolve({ callId: 'inv-1' });
    },
    // The narration grows read by read, then the compile reads as done.
    compileProgress: (compileId) => {
      reads += 1;
      const ended = reads >= 3;
      const progress: CompileProgressResponse = {
        compileId,
        callId: 'inv-1',
        status: ended ? 'done' : 'running',
        steps: ended ? steps : steps.slice(0, reads * 6),
        ...(ended ? { answer: response } : {}),
      };
      return Promise.resolve(progress);
    },
    callsStream: () => () => undefined,
  };
  const out: string[] = [];
  const outcome = await watchedCompile(client, ['ops/greeter'], {
    compileId: 'compile-1',
    verify: true,
    deploy: true,
    newContract: true,
    utc: true,
    detachOnInterrupt: false,
    agentsRoot: root,
    pollMs: 10,
    write: (text) => {
      out.push(text);
    },
  });
  assert.equal(outcome.response.status, 'ok');
  assert.equal(outcome.callId, 'inv-1');
  const text = out.join('');
  assert.ok(text.startsWith('compile compile-'), text);
  assert.ok(text.includes('   verify on   started '), text);
  assert.ok(text.includes('15:05:42  ops/greeter  triage       the code is at fault\n'), text);
  assert.ok(
    text.includes('ops/greeter  2 attempts  1 attempt    2 ok       verified live in dev  3m09s\n'),
    text,
  );
  assert.ok(
    /\ndone   1 agent verified live in dev   \d+s   trace: cernanto trace inv-1\n$/.test(text),
    text,
  );
});

test("Ctrl-C detaches: the compile is the plane's, the hint says how to follow it and how to stop it", () => {
  assert.equal(
    detachHint('bld_7'),
    'detached; the compile continues on the plane: cernanto trace bld_7 to follow it, cernanto cancel bld_7 to stop it\n',
  );
  assert.equal(detachHint(undefined), 'detached; the compile continues on the plane\n');
  // A compile the compiler has not taken yet has no trace to follow:
  // the id of its call as the plane stored it stops it.
  assert.equal(
    detachHint(undefined, 'cernanto_compile::k-bld_7'),
    'detached; the compile waits for the compiler on the plane: cernanto cancel cernanto_compile::k-bld_7 to stop it\n',
  );
});

/** A plane whose compile never ends by itself: every read answers the
 * steps given, still running; a cancel is kept by the call it names. */
function waitingPlane(steps: ProgressRecord[]): { client: CompileClient; cancelled: string[] } {
  const cancelled: string[] = [];
  const client: CompileClient = {
    packageExists: () => Promise.resolve(true),
    packagePut: () => Promise.resolve(),
    packageGet: () => Promise.reject(new Error('no store here')),
    land: () => Promise.reject(new Error('no landing here')),
    compile: () => Promise.resolve({ callId: 'inv-1' }),
    deploy: () => Promise.resolve({ callId: 'inv-1' }),
    compileProgress: async (compileId) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { compileId, callId: 'inv-1', status: 'running', steps };
    },
    callsStream: () => () => undefined,
    cancel: (callId) => {
      cancelled.push(callId);
      return Promise.resolve();
    },
  };
  return { client, cancelled };
}

test('under noAsk an account met while a test round is under way ends the watch at once, and the compile keeps its own ending', async () => {
  const g = 'ops/greeter';
  // The compile as it stands while its tester waits on the agent's
  // account: the round's pair is deployed.
  const { client, cancelled } = waitingPlane([
    record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }),
    record(100002, 1, { step: 'agent', state: 'begin', detail: '1/1', subject: g }),
    record(100003, 2, { step: 'verify', state: 'note', detail: 'round 1', subject: g }),
    record(100004, 2, { step: 'deploy', state: 'begin', detail: 'round 1', subject: g }),
    record(100005, 3, { step: 'deploy', state: 'end', detail: 'round 1', ok: true, subject: g }),
    record(100006, 3, {
      step: 'verify',
      state: 'begin',
      detail: `${g}-tester-compile-1-r1 ${g}-under-test-compile-1-r1`,
      subject: g,
    }),
  ]);
  const ask: PendingAsk = {
    id: 'cr-1',
    kind: 'fields',
    account: `${g} stripe.com`,
    agentId: g,
    name: 'stripe.com',
    provider: 'stripe.com',
    requestedAt: new Date().toISOString(),
  };
  const out: string[] = [];
  const asked: string[] = [];
  const began = Date.now();
  await assert.rejects(
    watchedCompile(client, [g], {
      compileId: 'compile-1',
      deploy: true,
      utc: true,
      detachOnInterrupt: false,
      agentsRoot: greeterWorkspace(),
      pollMs: 5,
      askPollMs: 5,
      write: (text) => {
        out.push(text);
      },
      noAsk: true,
      pendingAsks: () => Promise.resolve([ask]),
      // Nobody is asked under noAsk, a terminal or none.
      onAsk: (account) => {
        asked.push(account);
        return Promise.resolve();
      },
    }),
    (error: unknown) =>
      error instanceof AccountNeeded &&
      !error.stopped &&
      error.ask.id === 'cr-1' &&
      exitOf(error) === 3 &&
      error.message ===
        `${g} needs its account "stripe.com" (stripe.com), and this run asks nobody (--no-ask): log it in with cernanto auth login ${g} stripe.com, then run this again; the test run that waits for it ends by itself on the plane`,
  );
  assert.ok(Date.now() - began < 5000, 'the watch ended at once');
  // A stop here would leave the round's pair on the plane: none is sent.
  assert.deepEqual(cancelled, []);
  assert.deepEqual(asked, []);
  // The screen closes as a failed compile's does, on the account.
  assert.match(out.join(''), /FAILED ops\/greeter needs its account "stripe\.com"/);
  assert.match(out.join(''), /\nfailed {3}1 agent FAILED {3}/);
});

test('under noAsk an account met before anything is deployed stops the compile on the plane', async () => {
  const g = 'ops/greeter';
  // The compile holds at its prepare, on the sign-in of a server it
  // lists the tools of: nothing of it stands on the plane.
  const { client, cancelled } = waitingPlane([
    record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }),
    record(100002, 1, { step: 'agent', state: 'begin', detail: '1/1', subject: g }),
    record(100003, 2, {
      step: 'prepare',
      state: 'note',
      detail: 'connecting to https://mcp.example.com/mcp for tool schemas',
      subject: g,
    }),
  ]);
  const ask: PendingAsk = {
    id: 'cr-2',
    kind: 'oauth',
    account: `${g} mcp.example.com`,
    agentId: g,
    name: 'mcp.example.com',
    provider: 'mcp.example.com',
    requestedAt: new Date().toISOString(),
  };
  // No screen either: under -o json the watch ends the same way.
  await assert.rejects(
    watchedCompile(client, [g], {
      compileId: 'compile-1',
      detachOnInterrupt: false,
      agentsRoot: greeterWorkspace(),
      pollMs: 5,
      askPollMs: 5,
      json: true,
      noAsk: true,
      pendingAsks: () => Promise.resolve([ask]),
    }),
    (error: unknown) =>
      error instanceof AccountNeeded &&
      error.stopped &&
      exitOf(error) === 3 &&
      error.message ===
        `${g} needs its account "mcp.example.com" (mcp.example.com), and this run asks nobody (--no-ask): log it in with cernanto auth login ${g} mcp.example.com, then run this again`,
  );
  assert.deepEqual(cancelled, ['inv-1']);
});

test("under noAsk an account a module asks for from this compile's own round ends the watch on that account", async () => {
  const g = 'ops/greeter';
  const { client, cancelled } = waitingPlane([
    record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }),
    record(100002, 1, { step: 'agent', state: 'begin', detail: '1/1', subject: g }),
    record(100003, 2, { step: 'deploy', state: 'begin', detail: 'round 1', subject: g }),
    record(100004, 3, { step: 'deploy', state: 'end', detail: 'round 1', ok: true, subject: g }),
    record(100005, 3, { step: 'verify', state: 'begin', detail: 'the pair', subject: g }),
  ]);
  // The module linked into the agent under test owns the account, and
  // the call that waits is the round's own copy of the agent.
  const ask: PendingAsk = {
    id: 'cr-3',
    kind: 'oauth',
    account: 'ops/client google.com',
    agentId: 'ops/client',
    name: 'google.com',
    provider: 'google.com',
    requestedAt: new Date().toISOString(),
    callId: 'ops_greeter_under_test_compile_1_r1:20101:c-1',
  };
  await assert.rejects(
    watchedCompile(client, [g], {
      compileId: 'compile-1',
      deploy: true,
      detachOnInterrupt: false,
      agentsRoot: greeterWorkspace(),
      pollMs: 5,
      askPollMs: 5,
      json: true,
      noAsk: true,
      pendingAsks: () => Promise.resolve([ask]),
    }),
    (error: unknown) =>
      error instanceof AccountNeeded &&
      !error.stopped &&
      error.message.startsWith(
        'ops/client needs its account "google.com" (google.com), and this run asks nobody (--no-ask): log it in with cernanto auth login ops/client google.com, then run this again',
      ),
  );
  assert.deepEqual(cancelled, []);
});

test("under noAsk another agent's ask, another compile's round and an old ask end nothing: a compile stops on its own accounts alone", async () => {
  const g = 'ops/greeter';
  const response: PlaneCompileResponse = {
    protocol: 0,
    status: 'ok',
    issues: [],
    agents: [{ agentId: g, status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0 }],
    rows: [],
  };
  const steps = shortCompile();
  let reads = 0;
  let polls = 0;
  const client: CompileClient = {
    ...waitingPlane(steps).client,
    compileProgress: async (compileId) => {
      reads += 1;
      // The compile ends once the asks were read a few times.
      const ended = reads >= 3 && polls >= 3;
      if (!ended) await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        compileId,
        callId: 'inv-1',
        status: ended ? 'done' : 'running',
        steps,
        ...(ended ? { answer: response } : {}),
      };
    },
  };
  const out: string[] = [];
  await watchedCompile(client, [g], {
    compileId: 'compile-1',
    deploy: true,
    utc: true,
    detachOnInterrupt: false,
    agentsRoot: greeterWorkspace(),
    pollMs: 5,
    askPollMs: 5,
    write: (text) => {
      out.push(text);
    },
    noAsk: true,
    pendingAsks: () => {
      polls += 1;
      return Promise.resolve([
        // Another compile's test round, raised a moment ago.
        {
          id: 'cr-other',
          kind: 'fields' as const,
          account: 'ops/mailer smtp',
          agentId: 'ops/mailer-under-test-compile-9-r1',
          requestedAt: new Date().toISOString(),
        },
        // Another agent's account, asked for a moment ago by the round
        // of the compile before this one, which still waits on the plane.
        {
          id: 'cr-before',
          kind: 'oauth' as const,
          account: 'ops/client google.com',
          agentId: 'ops/client',
          name: 'google.com',
          requestedAt: new Date().toISOString(),
          callId: 'ops_client_under_test_compile_8_r1:20100:c-1',
        },
        // An agent this compile does not work on, asked long ago.
        {
          id: 'cr-old',
          kind: 'oauth' as const,
          account: 'ops/calendar google',
          agentId: 'ops/calendar',
          requestedAt: '2020-01-01T00:00:00.000Z',
        },
      ]);
    },
  });
  assert.ok(polls >= 3, 'the asks were read while the compile ran');
  assert.match(out.join(''), /\ndone {3}1 agent verified live in dev {3}/);
});

test("an ask is a compile's when it was raised since the compile began by any agent but another compile's round, or when an earlier run left it for an agent the compile works on and a round of the compile is under way", () => {
  const before = {
    agents: ['ops/greeter'],
    compileId: 'compile-1',
    startedAt: '2026-08-20T12:04:12.000Z',
    roundUnderWay: false,
  };
  const compile = { ...before, roundUnderWay: true };
  const row = (agentId: string, requestedAt?: string): PendingAsk => ({
    id: 'cr',
    kind: 'fields',
    account: `${agentId} x`,
    agentId,
    ...(requestedAt === undefined ? {} : { requestedAt }),
  });
  // Its own agent's ask, raised since the compile began: at once.
  assert.equal(askOfCompile(row('ops/greeter', '2026-08-20T12:05:00.000Z'), before), true);
  // Its own agent's ask an earlier run left, whatever its age: once a
  // round of the compile is under way, and not before, when nothing of
  // the compile waits on it and no copy of the agent stands.
  assert.equal(askOfCompile(row('ops/greeter', '2020-01-01T00:00:00.000Z'), before), false);
  assert.equal(askOfCompile(row('ops/greeter'), before), false);
  assert.equal(askOfCompile(row('ops/greeter', '2020-01-01T00:00:00.000Z'), compile), true);
  assert.equal(askOfCompile(row('ops/greeter'), compile), true);
  // A module linked into the agent under test asks as itself, now.
  assert.equal(askOfCompile(row('ops/client', '2026-08-20T12:05:00.000Z'), compile), true);
  // Its own round's pair.
  assert.equal(
    askOfCompile(row('ops/greeter-under-test-compile-1-r1', '2026-08-20T12:05:00.000Z'), compile),
    true,
  );
  // Another agent's old ask, one with no moment, and another compile's round.
  assert.equal(askOfCompile(row('ops/client', '2026-08-20T11:00:00.000Z'), compile), false);
  assert.equal(askOfCompile(row('ops/client'), compile), false);
  assert.equal(
    askOfCompile(row('ops/mailer-tester-compile-9-r2', '2026-08-20T12:05:00.000Z'), compile),
    false,
  );
});

test("an ask holds a compile when it is the account of an agent the compile works on, or when a call of the compile's own round waits on it", () => {
  const compile = { agents: ['ops/greeter'], compileId: 'compile-1' };
  const row = (agentId: string, callId?: string): PendingAsk => ({
    id: 'cr',
    kind: 'fields',
    account: `${agentId} x`,
    agentId,
    requestedAt: new Date().toISOString(),
    ...(callId === undefined ? {} : { callId }),
  });
  // Its own agent's account, whoever raised the ask first.
  assert.equal(askHoldsCompile(row('ops/greeter'), compile), true);
  assert.equal(
    askHoldsCompile(row('ops/greeter', 'ops_greeter_under_test_compile_7_r1:20100:c-1'), compile),
    true,
  );
  // Another agent's account, asked for from this compile's round.
  assert.equal(
    askHoldsCompile(row('ops/client', 'ops_greeter_under_test_compile_1_r2:20100:c-1'), compile),
    true,
  );
  assert.equal(
    askHoldsCompile(row('ops/client', 'ops_greeter_tester_compile_1_r1:20100:c-1'), compile),
    true,
  );
  // Another agent's account asked for a moment ago by anyone else: a
  // compile whose id only begins the same, another compile's round, a
  // plain call, a row that names no call.
  assert.equal(
    askHoldsCompile(row('ops/client', 'ops_client_under_test_compile_12_r1:20100:c-1'), compile),
    false,
  );
  assert.equal(
    askHoldsCompile(row('ops/client', 'ops_client_under_test_compile_8_r1:20100:c-1'), compile),
    false,
  );
  assert.equal(askHoldsCompile(row('ops/client', 'ops_client:20100:c-1'), compile), false);
  assert.equal(askHoldsCompile(row('ops/client'), compile), false);
});

test('a failure that names its own exit ends the command with it; any other ends it with 1', () => {
  const ask: PendingAsk = { id: 'cr', kind: 'fields', account: 'a b', agentId: 'a' };
  assert.equal(exitOf(new AccountNeeded(ask, true)), 3);
  assert.equal(exitOf(new Error('boom')), 1);
  assert.equal(exitOf(Object.assign(new Error('boom'), { exit: 0 })), 1);
  assert.equal(exitOf(Object.assign(new Error('boom'), { exit: 2.5 })), 1);
  assert.equal(exitOf('boom'), 1);
});

test('a prepare holding on an mcp sign-in runs the login inline, once', async () => {
  // The ask device at compile time: the note names the account (the agent
  // under compile, the server's host) in waitingFor, the screen runs the
  // login in this terminal, and the same compile resumes by itself; a
  // re-announced wait keeps to the login already opened.
  const asked: string[] = [];
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => {
      out.push(text);
    },
    utc: true,
    compileId: 'compile-1',
    verify: true,
    startedAt: new Date(T0).toISOString(),
    now: (): number => T0,
    onAsk: (target) => {
      asked.push(target);
      return Promise.resolve();
    },
  });
  screen.start();
  const waiting = {
    step: 'prepare' as const,
    state: 'note' as const,
    detail:
      'mcp.stripe.com requires a sign-in; log it in: cernanto auth login acme/bill mcp.stripe.com',
    waitingFor: ['acme/bill mcp.stripe.com'],
  };
  screen.record(record(100001, 0, { ...waiting, waitingFor: [...waiting.waitingFor] }));
  screen.record(record(100002, 2, { ...waiting, waitingFor: [...waiting.waitingFor] }));
  await screen.asksSettled;
  assert.deepEqual(asked, ['acme/bill mcp.stripe.com']);
  assert.ok(out.some((line) => line.includes('cernanto auth login acme/bill mcp.stripe.com')));
});

test("while the tests run, the tester's and the agent's conversations print on the log, on its grid, the tester's lines marked", () => {
  // The verify step names the tester, and from there the tester's
  // stream and the agent's are followed (from the deploy's moment, so
  // the run's first record is caught) until the run's reply record was
  // shown after the verdict: a process ships its records at its sink's
  // tick, so the reply may land after the narration's verdict. A run of
  // the tester older than this deploy, and a call to the agent from
  // anyone but the tester, stay out. The lines are the heads of the
  // ones `cernanto trace -f` shows, on the log's grid: the time, the
  // agent under compile, the step, the message; the body under a
  // message (the arguments, the answer) is the trace's alone.
  const watched: {
    agentId: string;
    since: string | undefined;
    onRecord: (record: TraceRecord, lines?: string[]) => void;
  }[] = [];
  const stopped: string[] = [];
  const source = {
    callsStream: (
      agentId: string,
      options: { since?: string },
      onRecord: (record: TraceRecord, lines?: string[]) => void,
    ): (() => void) => {
      watched.push({ agentId, since: options.since, onRecord });
      return () => {
        stopped.push(agentId);
      };
    },
  };
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => {
      out.push(text);
    },
    utc: true,
    compileId: 'compile-1',
    verify: true,
    startedAt: new Date(T0).toISOString(),
    now: () => T0 + 200_000,
    conversations: source,
  });
  screen.start();
  const g = 'ops/greeter';
  const tester = 'ops/greeter-tester-compile-1-r1';
  const at = (offsetS: number): string => new Date(T0 + offsetS * 1000).toISOString();
  screen.record(record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }));
  screen.record(record(100002, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: g }));
  screen.record(record(100003, 60, { step: 'deploy', state: 'begin', detail: 'dev', subject: g }));
  screen.record(
    record(100004, 90, { step: 'deploy', state: 'end', detail: 'dev', ok: true, subject: g }),
  );
  assert.equal(watched.length, 0, 'nothing followed before the verify names the tester');
  screen.record(record(100005, 90, { step: 'verify', state: 'begin', detail: tester, subject: g }));
  assert.deepEqual(
    watched.map((entry) => entry.agentId),
    [tester, g],
    'the tester and the agent are followed from the verify',
  );
  assert.deepEqual(
    watched.map((entry) => entry.since),
    [at(60), at(60)],
    'both streams read from the deploy’s moment',
  );
  const testerStream = watched[0];
  const agentStream = watched[1];
  assert.ok(testerStream && agentStream);
  // An older run of the tester (before this deploy): not this compile's.
  testerStream.onRecord({
    kind: 'begin',
    of: 'handler',
    handler: 'run',
    agentId: tester,
    callId: 'old-run',
    seq: 1,
    at: at(10),
    input: {},
  });
  // The run of this deploy: the tester calls the agent, prints each
  // test's verdict, answers.
  testerStream.onRecord(
    {
      kind: 'begin',
      of: 'handler',
      handler: 'run',
      agentId: tester,
      callId: 'run-1',
      seq: 0,
      at: at(91),
      input: {},
    },
    ['15:05:43  ← Run'],
  );
  testerStream.onRecord(
    {
      kind: 'begin',
      of: 'call',
      target: g,
      handler: 'greet',
      args: { name: 'Ada' },
      agentId: tester,
      callId: 'run-1',
      seq: 1,
      at: at(92),
    },
    ['15:05:44  → Greeter', '            Greet', '            Name: Ada'],
  );
  // The agent's side: the call from the tester shows, a call from an
  // operator does not.
  agentStream.onRecord(
    {
      kind: 'begin',
      of: 'handler',
      handler: 'greet',
      agentId: g,
      callId: 'greet-1',
      seq: 0,
      at: at(92),
      input: { name: 'Ada' },
      callerAgentId: tester,
      parentCallId: 'run-1',
    },
    ['15:05:44  ← Greeter Tester Bld 1 R1', '            Greet', '            Name: Ada'],
  );
  agentStream.onRecord({
    kind: 'begin',
    of: 'handler',
    handler: 'greet',
    agentId: g,
    callId: 'greet-op',
    seq: 0,
    at: at(92),
    input: { name: 'Bob' },
  });
  agentStream.onRecord({
    kind: 'handler',
    handler: 'greet',
    agentId: g,
    callId: 'greet-op',
    seq: 0,
    at: at(93),
    input: { name: 'Bob' },
    output: { greeting: 'hi Bob' },
    durationMs: 100,
  });
  agentStream.onRecord(
    {
      kind: 'handler',
      handler: 'greet',
      agentId: g,
      callId: 'greet-1',
      seq: 0,
      at: at(93),
      input: { name: 'Ada' },
      output: { greeting: 'hi Ada' },
      durationMs: 1200,
      callerAgentId: tester,
      parentCallId: 'run-1',
    },
    ['15:05:45  → Greeter Tester Bld 1 R1  1.2s', '            Greeting: hi Ada'],
  );
  testerStream.onRecord(
    {
      kind: 'agent-call',
      target: g,
      handler: 'greet',
      args: { name: 'Ada' },
      result: { greeting: 'hi Ada' },
      agentId: tester,
      callId: 'run-1',
      seq: 1,
      at: at(93),
      durationMs: 1200,
    },
    ['15:05:45  ← Greeter  1.2s', '            Greeting: hi Ada'],
  );
  testerStream.onRecord(
    {
      kind: 'log',
      level: 'info',
      message: '✔ greets by name  1.2s',
      agentId: tester,
      callId: 'run-1',
      seq: 2,
      at: at(94),
    },
    ['15:05:46  ✔ greets by name  1.2s'],
  );
  // The verdict reaches the narration before the run's reply record
  // reaches the store: the streams stay open for it.
  screen.record(
    record(100006, 95, {
      step: 'verify',
      state: 'end',
      detail: '1 test passed',
      ok: true,
      subject: g,
    }),
  );
  assert.deepEqual(stopped, [], 'the streams wait for the reply record');
  testerStream.onRecord(
    {
      kind: 'handler',
      handler: 'run',
      agentId: tester,
      callId: 'run-1',
      seq: 0,
      at: at(95),
      input: {},
      output: { passed: 1, failures: [] },
      durationMs: 4000,
    },
    ['15:05:47  → reply  4.0s', '            Passed:   1', '            Failures: []'],
  );
  assert.deepEqual(stopped, [tester, g], 'both streams stop once the reply was shown');
  // Every line on the one grid: the time, the agent under compile, the
  // step (verify: the tests run on the plane), then the chat
  // line's head: the agent's own lines bare (the agent column names
  // it), the tester's marked `tester`; no body under a message.
  assert.deepEqual(out.slice(1), [
    '15:04:12  compile      plan         1 agent: ops/greeter\n',
    '15:05:12  ops/greeter  deploy       dev\n',
    '15:05:42  ops/greeter  deploy       ok dev\n',
    `15:05:42  ops/greeter  verify       ${tester}\n`,
    '15:05:43  ops/greeter  verify       tester  ← Run\n',
    '15:05:44  ops/greeter  verify       tester  → Greeter\n',
    '15:05:44  ops/greeter  verify       ← Greeter Tester Bld 1 R1\n',
    '15:05:45  ops/greeter  verify       → Greeter Tester Bld 1 R1  1.2s\n',
    '15:05:45  ops/greeter  verify       tester  ← Greeter  1.2s\n',
    '15:05:46  ops/greeter  verify       tester  ✔ greets by name  1.2s\n',
    '15:05:47  ops/greeter  verify       ok 1 test passed\n',
    '15:05:47  ops/greeter  verify       tester  → reply  4.0s\n',
  ]);
  // A second deploy after a fix follows again, fresh; the end of the
  // compile closes whatever is still open.
  screen.record(record(100007, 120, { step: 'deploy', state: 'begin', detail: 'dev', subject: g }));
  const tester2 = 'ops/greeter-tester-compile-1-r2';
  screen.record(
    record(100008, 150, { step: 'verify', state: 'begin', detail: tester2, subject: g }),
  );
  assert.deepEqual(
    watched.map((entry) => entry.agentId),
    [tester, g, tester2, g],
  );
  screen.finish({ totalMs: 200_000 });
  assert.deepEqual(stopped, [tester, g, tester2, g]);
});

test("the agent's end right behind the verdict leaves the streams open for a run whose records are still in the sink's tick", async () => {
  // A short verify: its tests run inside the last second, and the
  // verdict and the agent's end land in one batch before the process
  // ships a record. The streams stay open for the run's reply, and the
  // finish waits for it, up to the patience.
  const watched: { agentId: string; onRecord: (record: TraceRecord, lines?: string[]) => void }[] =
    [];
  const stopped: string[] = [];
  const source = {
    callsStream: (
      agentId: string,
      _options: { since?: string },
      onRecord: (record: TraceRecord, lines?: string[]) => void,
    ): (() => void) => {
      watched.push({ agentId, onRecord });
      return () => {
        stopped.push(agentId);
      };
    },
  };
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => {
      out.push(text);
    },
    utc: true,
    compileId: 'compile-1',
    verify: true,
    startedAt: new Date(T0).toISOString(),
    now: () => T0 + 200_000,
    conversations: source,
    patienceMs: 2000,
  });
  screen.start();
  const g = 'ops/greeter';
  const tester = 'ops/greeter-tester-compile-1-r1';
  const at = (offsetS: number): string => new Date(T0 + offsetS * 1000).toISOString();
  screen.record(record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }));
  screen.record(record(100002, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: g }));
  screen.record(record(100003, 60, { step: 'deploy', state: 'begin', detail: 'dev', subject: g }));
  screen.record(
    record(100004, 90, { step: 'deploy', state: 'end', detail: 'dev', ok: true, subject: g }),
  );
  screen.record(record(100005, 90, { step: 'verify', state: 'begin', detail: tester, subject: g }));
  // The verdict and the agent's end land together, before any record.
  screen.record(
    record(100006, 95, {
      step: 'verify',
      state: 'end',
      detail: '2 tests passed',
      ok: true,
      subject: g,
    }),
  );
  screen.record(
    record(100007, 95, {
      step: 'agent',
      state: 'end',
      detail: 'verified live in dev',
      ok: true,
      subject: g,
    }),
  );
  assert.deepEqual(stopped, [], "the agent's end leaves the streams open for the run's records");
  const testerStream = watched[0];
  assert.ok(testerStream);
  // The finish waits for the conversation to close.
  let settled = false;
  const waiting = screen.conversationsSettled().then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false, 'the finish waits for the reply');
  // The sink's tick delivers the run: its begin and its reply.
  testerStream.onRecord(
    {
      kind: 'begin',
      of: 'handler',
      handler: 'run',
      agentId: tester,
      callId: 'run-1',
      seq: 0,
      at: at(94),
      input: {},
    },
    ['15:05:46  ← Run'],
  );
  testerStream.onRecord(
    {
      kind: 'handler',
      handler: 'run',
      agentId: tester,
      callId: 'run-1',
      seq: 0,
      at: at(95),
      input: {},
      output: { passed: 2, failures: [] },
      durationMs: 900,
    },
    ['15:05:47  → reply  900ms', '            Passed:   2', '            Failures: []'],
  );
  await waiting;
  assert.deepEqual(stopped, [tester, g], 'both streams close once the reply was shown');
  screen.finish({ totalMs: 200_000 });
  const text = out.join('');
  assert.ok(text.includes('15:05:46  ops/greeter  verify       tester  ← Run\n'), text);
  assert.ok(text.includes('15:05:47  ops/greeter  verify       tester  → reply  900ms\n'), text);
  assert.ok(
    text.indexOf('verified live in dev') < text.indexOf('tester  ← Run'),
    'the run prints after the verdict it came behind',
  );
  assert.ok(text.indexOf('tester  → reply') < text.indexOf('AGENT '), 'and before the table');
});

test('a run whose reply never comes closes at the patience, by the tick or by the finish', async () => {
  const stopped: string[] = [];
  const source = {
    callsStream: (agentId: string): (() => void) => {
      return () => {
        stopped.push(agentId);
      };
    },
  };
  let clock = T0 + 200_000;
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => {
      out.push(text);
    },
    utc: true,
    compileId: 'compile-1',
    verify: true,
    startedAt: new Date(T0).toISOString(),
    now: () => clock,
    conversations: source,
    patienceMs: 50,
  });
  screen.start();
  const g = 'ops/greeter';
  const tester = 'ops/greeter-tester-compile-1-r1';
  screen.record(record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }));
  screen.record(record(100002, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: g }));
  screen.record(record(100003, 60, { step: 'deploy', state: 'begin', detail: 'dev', subject: g }));
  screen.record(record(100004, 90, { step: 'verify', state: 'begin', detail: tester, subject: g }));
  screen.record(
    record(100005, 95, {
      step: 'agent',
      state: 'end',
      detail: 'verified live in dev',
      ok: true,
      subject: g,
    }),
  );
  // Mid-compile, the clock tick closes the follow once its patience passed.
  clock += 40;
  screen.tick();
  assert.deepEqual(stopped, [], 'inside the patience the streams stay open');
  clock += 20;
  screen.tick();
  assert.deepEqual(stopped, [tester, g], 'past the patience the tick closes them');
  // At the end of the compile, the finish waits the patience and no longer.
  const g2 = 'ops/usher';
  const tester2 = 'ops/usher-tester-compile-1-r1';
  screen.record(
    record(100006, 100, { step: 'deploy', state: 'begin', detail: 'dev', subject: g2 }),
  );
  screen.record(
    record(100007, 120, { step: 'verify', state: 'begin', detail: tester2, subject: g2 }),
  );
  const began = Date.now();
  await screen.conversationsSettled();
  assert.ok(Date.now() - began < 1000, 'the wait is the patience, not a hang');
  screen.finish({ totalMs: 200_000 });
  assert.deepEqual(stopped, [tester, g, tester2, g2]);
});

test("the verify names the pair: the agent's side follows the copy under test, its own calls printed bare", () => {
  // The tests run against a fresh copy of the agent
  // (`<id>-under-test-<compile>-r<round>`); the narration names both ids,
  // the tester's first, and the screen follows the copy's stream, so
  // the copy's side (its call to a mocked dependency included) prints.
  const watched: { agentId: string; onRecord: (record: TraceRecord, lines?: string[]) => void }[] =
    [];
  const stopped: string[] = [];
  const source = {
    callsStream: (
      agentId: string,
      _options: { since?: string },
      onRecord: (record: TraceRecord, lines?: string[]) => void,
    ): (() => void) => {
      watched.push({ agentId, onRecord });
      return () => {
        stopped.push(agentId);
      };
    },
  };
  const out: string[] = [];
  const screen = new CompileScreen({
    write: (text) => {
      out.push(text);
    },
    utc: true,
    compileId: 'compile-1',
    verify: true,
    startedAt: new Date(T0).toISOString(),
    now: () => T0 + 200_000,
    conversations: source,
  });
  screen.start();
  const g = 'ops/greeter';
  const tester = 'ops/greeter-tester-compile-1-r1';
  const copy = 'ops/greeter-under-test-compile-1-r1';
  const at = (offsetS: number): string => new Date(T0 + offsetS * 1000).toISOString();
  screen.record(record(100001, 0, { step: 'plan', state: 'end', detail: `1 agent: ${g}` }));
  screen.record(record(100002, 1, { step: 'agent', state: 'begin', detail: '0/1', subject: g }));
  screen.record(record(100003, 60, { step: 'deploy', state: 'begin', detail: 'dev', subject: g }));
  screen.record(
    record(100005, 90, { step: 'verify', state: 'begin', detail: `${tester} ${copy}`, subject: g }),
  );
  assert.deepEqual(
    watched.map((entry) => entry.agentId),
    [tester, copy],
    'the tester and the copy under test are followed',
  );
  const testerStream = watched[0];
  const copyStream = watched[1];
  assert.ok(testerStream && copyStream);
  // The tester's side lands first, its reply included: the streams
  // stay open, since the copy's side of the call is still on its way
  // from the copy's own process.
  testerStream.onRecord(
    {
      kind: 'begin',
      of: 'handler',
      handler: 'run',
      agentId: tester,
      callId: 'run-1',
      seq: 0,
      at: at(91),
      input: {},
    },
    ['15:05:43  ← Run'],
  );
  testerStream.onRecord(
    {
      kind: 'begin',
      of: 'call',
      target: copy,
      handler: 'greet',
      args: { name: 'Ada' },
      agentId: tester,
      callId: 'run-1',
      seq: 1,
      at: at(92),
    },
    ['15:05:44  → Greeter Under Test Bld 1 R1', '            Greet', '            Name: Ada'],
  );
  testerStream.onRecord(
    {
      kind: 'agent-call',
      target: copy,
      handler: 'greet',
      args: { name: 'Ada' },
      result: { greeting: 'hi Ada' },
      agentId: tester,
      callId: 'run-1',
      seq: 2,
      at: at(93),
      durationMs: 1200,
    },
    ['15:05:45  ← Greeter Under Test Bld 1 R1  1.2s', '            Greeting: hi Ada'],
  );
  screen.record(
    record(100006, 95, {
      step: 'verify',
      state: 'end',
      detail: '1 test passed',
      ok: true,
      subject: g,
    }),
  );
  testerStream.onRecord(
    {
      kind: 'handler',
      handler: 'run',
      agentId: tester,
      callId: 'run-1',
      seq: 0,
      at: at(95),
      input: {},
      output: { passed: 1, failures: [] },
      durationMs: 4000,
    },
    ['15:05:47  → reply  4.0s', '            Passed:   1', '            Failures: []'],
  );
  assert.deepEqual(stopped, [], "the run's reply alone does not close the copy's side");
  // The copy's side: the tester's call received, the copy's own call
  // to a dependency beneath it, and its answer; the story is whole.
  copyStream.onRecord(
    {
      kind: 'begin',
      of: 'handler',
      handler: 'greet',
      agentId: copy,
      callId: 'greet-1',
      seq: 0,
      at: at(92),
      input: { name: 'Ada' },
      callerAgentId: tester,
      parentCallId: 'run-1',
    },
    ['15:05:44  ← Greeter Tester Bld 1 R1', '            Greet', '            Name: Ada'],
  );
  copyStream.onRecord(
    {
      kind: 'begin',
      of: 'call',
      target: 'ops/style',
      handler: 'pick',
      args: { name: 'Ada' },
      agentId: copy,
      callId: 'greet-1',
      seq: 1,
      at: at(92),
    },
    ['15:05:44  → Style', '            Pick', '            Name: Ada'],
  );
  copyStream.onRecord(
    {
      kind: 'handler',
      handler: 'greet',
      agentId: copy,
      callId: 'greet-1',
      seq: 0,
      at: at(93),
      input: { name: 'Ada' },
      output: { greeting: 'hi Ada' },
      durationMs: 1200,
      callerAgentId: tester,
      parentCallId: 'run-1',
    },
    ['15:05:45  → Greeter Tester Bld 1 R1  1.2s', '            Greeting: hi Ada'],
  );
  // The copy's reply landed before the answer of its own call beneath
  // it (a reply can precede its children on the live stream): the
  // streams wait for that answer too.
  assert.deepEqual(stopped, [], "the copy's reply alone does not close the story");
  copyStream.onRecord(
    {
      kind: 'agent-call',
      target: 'ops/style',
      handler: 'pick',
      args: { name: 'Ada' },
      result: { style: 'plain' },
      agentId: copy,
      callId: 'greet-1',
      seq: 2,
      at: at(93),
      durationMs: 1,
    },
    ['15:05:45  ← Style  1ms', '            Style: plain'],
  );
  assert.deepEqual(
    stopped,
    [tester, copy],
    "both streams close once the copy's own call was answered",
  );
  const text = out.join('');
  assert.ok(text.includes('15:05:44  ops/greeter  verify       ← Greeter Tester Bld 1 R1\n'), text);
  assert.ok(text.includes('15:05:44  ops/greeter  verify       → Style\n'), text);
  assert.ok(
    text.includes('15:05:45  ops/greeter  verify       → Greeter Tester Bld 1 R1  1.2s\n'),
    text,
  );
  // A narration naming the tester alone: the agent under compile stands
  // for its copy.
  screen.record(record(100007, 120, { step: 'deploy', state: 'begin', detail: 'dev', subject: g }));
  const tester2 = 'ops/greeter-tester-compile-1-r2';
  screen.record(
    record(100008, 150, { step: 'verify', state: 'begin', detail: tester2, subject: g }),
  );
  assert.deepEqual(
    watched.map((entry) => entry.agentId),
    [tester, copy, tester2, g],
  );
});

test('the dots line names the agents compiling now and closes on each verdict', () => {
  // Two agents side by side: the line names both; the first to end
  // closes it with its name and verdict; the next line names the one
  // left and closes with its verdict alone; a third that joins later
  // prints its reads and takes a line of its own.
  const quiet = screenOf({ quiet: true });
  quiet.screen.start();
  const a = 'chain/bottom';
  const b = 'chain/middle';
  const c = 'chain/report';
  quiet.screen.record(
    record(1, 0, { step: 'plan', state: 'note', detail: 'reads a module', subject: a }),
  );
  quiet.screen.record(
    record(2, 0, { step: 'plan', state: 'note', detail: 'reads a module', subject: b }),
  );
  quiet.screen.record(
    record(3, 0, { step: 'plan', state: 'end', detail: `3 agents: ${a}, ${b}, ${c}` }),
  );
  quiet.screen.record(
    record(4, 1, { step: 'agent', state: 'begin', detail: '1 of 3', subject: a }),
  );
  quiet.screen.record(
    record(5, 1, { step: 'agent', state: 'begin', detail: '2 of 3', subject: b }),
  );
  quiet.screen.record(
    record(6, 2, { step: 'write code', state: 'begin', detail: 'attempt 1', subject: a }),
  );
  quiet.screen.record(
    record(7, 3, { step: 'write code', state: 'begin', detail: 'attempt 1', subject: b }),
  );
  quiet.screen.record(
    record(8, 40, {
      step: 'agent',
      state: 'end',
      detail: 'verified live',
      ok: true,
      result: 'compiled',
      durationMs: 39_000,
      subject: a,
    }),
  );
  quiet.screen.record(
    record(9, 41, { step: 'write tests', state: 'begin', detail: 'attempt 1', subject: b }),
  );
  quiet.screen.record(
    record(10, 70, {
      step: 'agent',
      state: 'end',
      detail: 'verified live',
      ok: true,
      result: 'compiled',
      durationMs: 69_000,
      subject: b,
    }),
  );
  quiet.screen.record(
    record(11, 71, { step: 'plan', state: 'note', detail: 'reads a worker', subject: c }),
  );
  quiet.screen.record(
    record(12, 71, { step: 'agent', state: 'begin', detail: '3 of 3', subject: c }),
  );
  quiet.screen.record(
    record(13, 72, { step: 'write code', state: 'begin', detail: 'attempt 1', subject: c }),
  );
  quiet.screen.record(
    record(14, 100, {
      step: 'agent',
      state: 'end',
      detail: 'verified live',
      ok: true,
      result: 'compiled',
      durationMs: 29_000,
      subject: c,
    }),
  );
  quiet.screen.record(
    record(15, 101, { step: 'done', state: 'end', detail: 'compile complete', ok: true }),
  );
  quiet.screen.finish({ totalMs: 101_000 });
  assert.equal(
    quiet.out.join(''),
    [
      'chain/bottom  reads a module',
      'chain/middle  reads a module',
      'compiling chain/bottom, chain/middle .. chain/bottom verified live  39s',
      'compiling chain/middle . verified live  1m09s',
      'chain/report  reads a worker',
      'compiling chain/report . verified live  29s',
      '',
    ].join('\n'),
  );
});
