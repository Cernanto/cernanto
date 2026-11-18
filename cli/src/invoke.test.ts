// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CernantoError } from '@cernanto/package-format';

import type { ParameterReading } from './card-view.js';
import { answerText, argsOf, invokeAgent, invokeAgentWatched } from './invoke.js';
import { callOfRequest, recordKeyOf, recordsAsTheyHappened } from './server-client.js';
import type { ServerClient } from './server-client.js';

function fake(overrides: Partial<Record<keyof ServerClient, unknown>>): ServerClient {
  return overrides as unknown as ServerClient;
}

test('the arguments read the httpie way: key=value a string, key:=json anything else, or one --args document', () => {
  assert.deepEqual(argsOf(['name=Ada', 'count:=3', 'tags:=["a","b"]', 'flag:=true'], undefined), {
    name: 'Ada',
    count: 3,
    tags: ['a', 'b'],
    flag: true,
  });
  // A value may carry '=' itself; the first one splits.
  assert.deepEqual(argsOf(['url=https://x.example/?a=1'], undefined), {
    url: 'https://x.example/?a=1',
  });
  // No pairs are no arguments, for a function that may take one value as itself.
  assert.equal(argsOf([], undefined), undefined);
  assert.deepEqual(argsOf([], '{"text":"hello"}'), { text: 'hello' });
  assert.throws(() => argsOf(['name=Ada'], '{}'), /key=value pairs or as --args, not both/);
});

test('argsOf reads the arguments by the parameters the contract declares: one record, one value, several in order, a list under --args', () => {
  const text: ParameterReading = {
    name: 'statement',
    type: 'string',
    optional: false,
    rest: false,
    plain: { kind: 'word', word: 'text' },
  };
  const context: ParameterReading = {
    name: 'context',
    type: 'Record<string, unknown> | null',
    optional: false,
    rest: false,
    plain: { kind: 'map', of: { kind: 'word', word: 'unknown' } },
  };
  const count: ParameterReading = {
    name: 'count',
    type: 'number',
    optional: true,
    rest: false,
    plain: { kind: 'word', word: 'number' },
  };
  const flag: ParameterReading = {
    name: 'flag',
    type: 'boolean',
    optional: true,
    rest: false,
    plain: { kind: 'word', word: 'yes or no' },
  };
  const record: ParameterReading = {
    name: 'mail',
    type: 'Mail',
    optional: false,
    rest: false,
    plain: {
      kind: 'fields',
      fields: [{ name: 'to', optional: false, type: { kind: 'word', word: 'text' }, doc: [] }],
    },
  };
  const names: ParameterReading = {
    name: 'names',
    type: 'string[]',
    optional: false,
    rest: true,
    plain: { kind: 'list', of: { kind: 'word', word: 'text' } },
  };
  // None.
  assert.equal(argsOf([], undefined, [], 'next'), undefined);
  assert.throws(() => argsOf(['x=1'], undefined, [], 'next'), /next takes no arguments/);
  // One record: pairs, as ever.
  assert.deepEqual(argsOf(['to=ada@example.com'], undefined, [record], 'send'), {
    to: 'ada@example.com',
  });
  // A record's fields are read by their types as well: a number field takes a number from text.
  const invoice: ParameterReading = {
    name: 'invoice',
    type: 'Invoice',
    optional: false,
    rest: false,
    plain: {
      kind: 'fields',
      fields: [
        { name: 'amount', optional: false, type: { kind: 'word', word: 'number' }, doc: [] },
        { name: 'paid', optional: true, type: { kind: 'word', word: 'yes or no' }, doc: [] },
      ],
    },
  };
  assert.deepEqual(argsOf(['amount=120', 'paid=true'], undefined, [invoice], 'post'), {
    amount: 120,
    paid: true,
  });
  assert.deepEqual(argsOf(['amount:=120'], undefined, [invoice], 'post'), { amount: 120 });
  assert.deepEqual(argsOf([], '{"to":"x"}', [record], 'send'), { to: 'x' });
  // One value: the word, read by its type; a number is 42, text is "42".
  assert.equal(argsOf(['42'], undefined, [text], 'shout'), '42');
  // One value named as the card prints it.
  assert.equal(argsOf(['statement=hello there'], undefined, [text], 'shout'), 'hello there');
  assert.throws(() => argsOf(['text=hello'], undefined, [text], 'shout'), /text is not among them/);
  assert.equal(argsOf(['42'], undefined, [{ ...count, optional: false }], 'take'), 42);
  assert.throws(() => argsOf([], undefined, [text], 'shout'), /shout takes statement/);
  assert.throws(
    () => argsOf(['a', 'b'], undefined, [text], 'shout'),
    /takes one argument, statement; 2 were given/,
  );
  // Several: the words are the values in order, each by its type.
  assert.deepEqual(
    argsOf(
      ['{"message":"hi"}', 'The message asks for help.'],
      undefined,
      [context, text],
      'decideIf',
    ),
    [{ message: 'hi' }, 'The message asks for help.'],
  );
  assert.deepEqual(
    argsOf(['{}', 'x', '3', 'true'], undefined, [context, text, count, flag], 'decideIf'),
    [{}, 'x', 3, true],
  );
  assert.throws(
    () => argsOf(['{}'], undefined, [context, text], 'decideIf'),
    /decideIf takes context, statement; 1 was given/,
  );
  assert.throws(
    () =>
      argsOf(['{}', 'x', '1', 'true', 'more'], undefined, [context, text, count, flag], 'decideIf'),
    /5 were given/,
  );
  assert.throws(
    () => argsOf(['{}', 'x', 'many'], undefined, [context, text, count], 'decideIf'),
    /count is a number: many/,
  );
  // Pairs name the parameters, as today's commands do; each text is read by its type.
  assert.deepEqual(
    argsOf(
      ['statement=The message asks for help.', 'context:={"message":"hi"}'],
      undefined,
      [context, text],
      'decideIf',
    ),
    { context: { message: 'hi' }, statement: 'The message asks for help.' },
  );
  assert.deepEqual(
    argsOf(
      ['context:={}', 'statement=x', 'count=3'],
      undefined,
      [context, text, count, flag],
      'decideIf',
    ),
    { context: {}, statement: 'x', count: 3 },
  );
  assert.throws(
    () => argsOf(['statement=x', 'when=now'], undefined, [context, text], 'decideIf'),
    /when is not among them/,
  );
  // A pair naming a field of one record parameter lands inside it.
  const chat: ParameterReading = {
    name: 'chat',
    type: 'string',
    optional: false,
    rest: false,
    plain: { kind: 'word', word: 'text' },
  };
  const filter: ParameterReading = {
    name: 'filter',
    type: 'MessageFilter',
    optional: true,
    rest: false,
    plain: {
      kind: 'fields',
      fields: [
        { name: 'mentioned', type: { kind: 'word', word: 'yes or no' }, optional: true, doc: [] },
        { name: 'from', type: { kind: 'word', word: 'text' }, optional: true, doc: [] },
      ],
    },
  };
  const timeoutMs: ParameterReading = {
    name: 'timeoutMs',
    type: 'number',
    optional: true,
    rest: false,
    plain: { kind: 'word', word: 'number' },
  };
  assert.deepEqual(
    argsOf(
      ['chat=#support', 'mentioned:=true', 'timeoutMs=2000'],
      undefined,
      [chat, filter, timeoutMs],
      'waitForMessage',
    ),
    { chat: '#support', filter: { mentioned: true }, timeoutMs: 2000 },
  );
  assert.throws(
    () => argsOf(['statement=x'], undefined, [context, text], 'decideIf'),
    /context not given/,
  );
  // A record under --args names them too.
  assert.deepEqual(argsOf([], '{"statement":"x","context":{"a":1}}', [context, text], 'decideIf'), {
    statement: 'x',
    context: { a: 1 },
  });
  // A rest parameter takes every word from its place on.
  assert.deepEqual(argsOf(['a', 'b', 'c'], undefined, [names], 'tally'), ['a', 'b', 'c']);
  // The whole list under --args, in order.
  assert.deepEqual(argsOf([], '[{"a":1},"x"]', [context, text], 'decideIf'), [{ a: 1 }, 'x']);
  assert.throws(() => argsOf([], '"x"', [context, text], 'decideIf'), /--args must be a json list/);
  assert.throws(
    () => argsOf([], '[{}]', [context, text], 'decideIf'),
    /decideIf takes context, statement; 1 were given/,
  );
  assert.throws(() => argsOf([], '{not json'), /--args is not valid json/);
  assert.throws(() => argsOf(['count:=three'], undefined), /count is not valid json: three/);
  assert.throws(
    () => argsOf(['hello'], undefined),
    /"hello" is not an argument: write key=value for a string or key:=<json>/,
  );
});

test('invoke prints the result compact by default and pretty as json', async () => {
  const client = fake({
    invoke: () => Promise.resolve({ retried: true, recovered: true }),
  });
  assert.equal(
    await invokeAgent(client, { agentId: 'a/b', handler: 'run', args: {} }, {}),
    '{"retried":true,"recovered":true}\n',
  );
  const pretty = await invokeAgent(
    client,
    { agentId: 'a/b', handler: 'run', args: {} },
    { output: 'json' },
  );
  assert.ok(pretty.includes('\n  "retried": true'));
});

test('an invoke of an id nothing is deployed as says so, in both forms of the call', async () => {
  const refusal = (): Promise<never> =>
    Promise.reject(new CernantoError({ kind: 'terminal', message: 'no agent "ops/deleted"' }));
  const words =
    /^CernantoError: nothing is deployed as "ops\/deleted" \(list what runs with: cernanto ls\)$/;
  const input = { agentId: 'ops/deleted', handler: 'run', args: {} };
  await assert.rejects(invokeAgent(fake({ invoke: refusal }), input, {}), words);
  const watched = fake({ invokeStream: refusal });
  await assert.rejects(invokeAgentWatched(watched, input, { write: () => undefined }), words);
  // Any other refusal keeps the plane's own words.
  const paused = fake({
    invoke: () =>
      Promise.reject(
        new CernantoError({ kind: 'terminal', message: 'agent "ops/deleted" is paused' }),
      ),
  });
  await assert.rejects(invokeAgent(paused, input, {}), /agent "ops\/deleted" is paused/);
});

test('a call of a function the agent does not have names the card that lists its functions, in both forms of the call', async () => {
  const words =
    /^CernantoError: agent "ops\/greeter" has no function "wave" \(list its functions with: cernanto contract ops\/greeter\)$/;
  const input = { agentId: 'ops/greeter', handler: 'wave', args: {} };
  // The plane's refusal reads the same whether or not it appends words
  // of its own.
  for (const message of [
    'agent "ops/greeter" has no function "wave"',
    'agent "ops/greeter" has no function "wave"; cernanto contract ops/greeter lists its functions',
  ]) {
    const refusal = (): Promise<never> =>
      Promise.reject(new CernantoError({ kind: 'terminal', message }));
    await assert.rejects(invokeAgent(fake({ invoke: refusal }), input, {}), words);
    const watched = fake({ invokeStream: refusal });
    await assert.rejects(invokeAgentWatched(watched, input, { write: () => undefined }), words);
  }
});

test('a terminal answer, when the reply record never came, reads as a reply line with the value as json', () => {
  const text = answerText({
    outcome: 'escalated',
    invoice: { invoiceNumber: 'HK-77812' },
  });
  assert.equal(
    text,
    [
      '          → reply',
      '            {',
      '              "outcome": "escalated",',
      '              "invoice": {',
      '                "invoiceNumber": "HK-77812"',
      '              }',
      '            }',
      '',
    ].join('\n'),
  );
  assert.equal(answerText('approved'), '          → reply\n            approved\n');
  assert.equal(answerText(undefined), '          → reply\n            Done\n');
});

test('a call that answers nothing prints nothing', async () => {
  const client = fake({ invoke: () => Promise.resolve(undefined) });
  assert.equal(await invokeAgent(client, { agentId: 'a/b', handler: 'decide', args: {} }, {}), '');
});

test('a watched invoke narrates the call as it runs, then the result with its trace handle', async () => {
  // The plane makes the call and follows it: it names the call once a
  // copy took it, then tells each record as the copy makes it, in the
  // civilian view (what trace -f shows); the result and the request's id
  // come back to the caller.
  const at = '2026-08-18T10:00:00.000Z';
  const story = 'text_extract_facts:20001:c-9:0123456789abcdef';
  const base = { agentId: 'text/extract-facts', callId: story, at };
  const begin = {
    ...base,
    seq: 0,
    kind: 'begin' as const,
    of: 'handler' as const,
    handler: 'extractFacts',
    input: { text: 'Paris is the capital of France.' },
  };
  const outgoing = {
    ...base,
    seq: 1,
    at: '2026-08-18T10:00:01.000Z',
    kind: 'begin' as const,
    of: 'call' as const,
    target: 'cernanto/decision',
    handler: 'aiList',
    args: { prompt: 'List the facts.', context: { text: 'Paris is the capital of France.' } },
  };
  const answered = {
    ...base,
    seq: 1,
    at: '2026-08-18T10:00:04.000Z',
    kind: 'agent-call' as const,
    target: 'cernanto/decision',
    handler: 'aiList',
    args: { prompt: 'List the facts.' },
    result: ['Paris is the capital of France.'],
    durationMs: 3000,
  };
  const reply = {
    ...base,
    seq: 0,
    at: '2026-08-18T10:00:05.000Z',
    kind: 'handler' as const,
    handler: 'extractFacts',
    input: { text: 'Paris is the capital of France.' },
    output: { facts: ['Paris is the capital of France.'] },
    durationMs: 5000,
  };
  // The lines the plane renders each record as (the trace view's live
  // reading, the stream's agent speaking bare) ride beside the record.
  const rendered = {
    begin: ['10:00:00  ← Extract facts', '            Text: Paris is the capital of France.'],
    outgoing: ['10:00:01  → AI', '            List', '            Prompt: List the facts.'],
    answered: ['10:00:04  ← AI  3.0s', '            - Paris is the capital of France.'],
    reply: [
      '10:00:05  → reply  5.0s',
      '            Facts:',
      '              - Paris is the capital of France.',
    ],
  };
  const asked: unknown[] = [];
  const client = fake({
    invokeStream: async (
      _agentId: string,
      _fn: string,
      _args: unknown,
      options: {
        view?: string;
        details?: boolean;
        debug?: boolean;
        onAccepted?: (callId: string) => void;
        onRecord?: (record: unknown, lines?: string[]) => void;
      },
    ) => {
      asked.push({ view: options.view, details: options.details, debug: options.debug });
      options.onAccepted?.(story);
      options.onRecord?.(begin, rendered.begin);
      options.onRecord?.(outgoing, rendered.outgoing);
      // A record told twice (the store's copy and the copy's own) is
      // written once.
      options.onRecord?.(outgoing, rendered.outgoing);
      options.onRecord?.(answered, rendered.answered);
      options.onRecord?.(reply, rendered.reply);
      await Promise.resolve();
      return { result: { facts: ['Paris is the capital of France.'] }, callId: story };
    },
  });
  let out = '';
  const answer = await invokeAgentWatched(
    client,
    { agentId: 'text/extract-facts', handler: 'extractFacts', args: {} },
    { write: (text) => (out += text) },
  );
  assert.equal(answer.callId, story);
  assert.equal(answer.replied, true, "the call's own end was told");
  assert.deepEqual(answer.result, { facts: ['Paris is the capital of France.'] });
  assert.deepEqual(asked, [{ view: 'live', details: false, debug: false }]);
  assert.equal(
    out,
    [
      // One agent's conversation: the lines carry no name.
      '10:00:00  ← Extract facts',
      '            Text: Paris is the capital of France.',
      // A judgment shows its prompt; its context is a detail (-d).
      '10:00:01  → AI',
      '            List',
      '            Prompt: List the facts.',
      '10:00:04  ← AI  3.0s',
      '            - Paris is the capital of France.',
      '10:00:05  → reply  5.0s',
      '            Facts:',
      '              - Paris is the capital of France.',
      '',
    ].join('\n'),
  );
});

test('a watched invoke narrates every attempt of its call: the attempt tells two records of one sequence apart', async () => {
  const story = 'ops_flaky:20001:c-3:0123456789abcdef';
  const base = { agentId: 'ops/flaky', callId: story };
  const attemptOf = (attemptId: string, at: string, ended: object): unknown[] => [
    {
      ...base,
      attemptId,
      seq: 0,
      at,
      kind: 'begin' as const,
      of: 'handler' as const,
      handler: 'run',
    },
    { ...base, attemptId, seq: 0, at, kind: 'handler' as const, handler: 'run', ...ended },
  ];
  // The first attempt failed and the call went on to a second, whose
  // sequence starts over.
  const records = [
    ...attemptOf('att-1', '2026-08-18T10:00:00.000Z', {
      error: 'the provider timed out',
      durationMs: 900,
    }),
    ...attemptOf('att-2', '2026-08-18T10:00:02.000Z', { output: 'done', durationMs: 400 }),
  ];
  const lines = [
    ['10:00:00  ← Run'],
    ['10:00:00  → error  the provider timed out'],
    ['10:00:02  ← Run'],
    ['10:00:02  → reply  0.4s'],
  ];
  const client = fake({
    invokeStream: async (
      _agentId: string,
      _fn: string,
      _args: unknown,
      options: {
        onAccepted?: (callId: string) => void;
        onRecord?: (record: unknown, lines?: string[]) => void;
      },
    ) => {
      options.onAccepted?.(story);
      records.forEach((record, index) => options.onRecord?.(record, lines[index]));
      await Promise.resolve();
      return { result: 'done', callId: story };
    },
  });
  let out = '';
  const answer = await invokeAgentWatched(
    client,
    { agentId: 'ops/flaky', handler: 'run', args: {} },
    { write: (text) => (out += text) },
  );
  assert.equal(answer.replied, true);
  assert.equal(out, `${lines.map((group) => group.join('\n')).join('\n')}\n`);
});

test('a request that ran again tells each run in the order of runs and, inside a run, of places: two ends of one handler are both told, whatever the clocks said', () => {
  const story = 'ops_counter:20001:c-4:0123456789abcdef';
  const record = (run: string, place: number, kind: string, at: string, more: object = {}) => ({
    agentId: 'ops/counter',
    callId: story,
    seq: 0,
    at,
    run,
    place,
    kind,
    handler: 'count',
    ...more,
  });
  // The first run on a host whose clock runs ahead; the second, a
  // replay, on one that runs behind; the second run's end is told after
  // the first run's, and inside a run the reply after its begin though
  // the clock stepped back between them.
  const firstBegin = record('3.1', 7, 'begin', '2026-11-05T10:00:05.000Z', { of: 'handler' });
  const firstEnd = record('3.1', 8, 'handler', '2026-11-05T10:00:04.000Z', { error: 'lost' });
  const secondEnd = record('4.1', 2, 'handler', '2026-11-05T09:00:00.000Z', { output: 1 });
  const handed = [secondEnd, firstEnd, firstBegin];
  assert.deepEqual(recordsAsTheyHappened(handed as never), [2, 1, 0]);
  const keys = new Set(handed.map((one) => recordKeyOf(one as never)));
  assert.equal(keys.size, 3, "each run's end has a telling key of its own");
  assert.equal(
    recordKeyOf(firstBegin as never),
    recordKeyOf({ ...firstBegin, run: '4.1', place: 1 } as never),
    "a begin's versions in two runs share one telling key",
  );
});

test("a request's id turns into its call's id: the request's part goes, a link's mark stays", () => {
  assert.equal(callOfRequest('ops_bank:20001:c-7:5f2a9c1e0b3d4a6f'), 'ops_bank:20001:c-7');
  assert.equal(callOfRequest('ops_bank:20001:c-7:5f2a9c1e0b3d4a6f~2'), 'ops_bank:20001:c-7~2');
  assert.equal(callOfRequest('ops_bank:20001:c-7'), 'ops_bank:20001:c-7');
  assert.equal(callOfRequest('c-7'), 'c-7');
});

test('a watched invoke whose stream told no reply record says so, so the answer prints in the form of a reply', async () => {
  const story = 'finance_yahoo_finance:20001:c-3:0123456789abcdef';
  const begin = {
    agentId: 'finance/yahoo-finance',
    callId: story,
    at: '2026-09-26T18:19:42.000Z',
    seq: 0,
    kind: 'begin' as const,
    of: 'handler' as const,
    handler: 'stockPrice',
    input: { name: 'ibm' },
  };
  const client = fake({
    invokeStream: (
      _agentId: string,
      _fn: string,
      _args: unknown,
      options: {
        onAccepted?: (callId: string) => void;
        onRecord?: (record: unknown, lines?: string[]) => void;
      },
    ) => {
      options.onAccepted?.(story);
      options.onRecord?.(begin, ['18:19:42  ← Stock price', '            Name: ibm']);
      return Promise.resolve({ result: 225.51, callId: story });
    },
  });
  let out = '';
  const answer = await invokeAgentWatched(
    client,
    { agentId: 'finance/yahoo-finance', handler: 'stockPrice', args: { name: 'ibm' } },
    { write: (text) => (out += text) },
  );
  assert.equal(answer.result, 225.51);
  assert.equal(answer.replied, false);
  assert.equal(out, ['18:19:42  ← Stock price', '            Name: ibm', ''].join('\n'));
});
