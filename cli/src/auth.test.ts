// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { isCernantoError } from '@cernanto/package-format';

import { accountOfWords, askWords, loginCommand, renderDisplayContent } from './asks.js';
import { answersFromFile, authListCommand, authLogoutCommand, authRows } from './auth.js';
import type { Plane } from './gateway-client.js';
import type { AgentAsk } from './gateway/types.gen.js';
import type { ConnectIo } from './terminal.js';

// The auth verbs against a fake plane, the auth family faked by its
// document: the login screen end to end (a fields ask renders the
// agent's instructions and prompts, the filled values reach the ask's
// route, the ask leaves the pending list, and the follow-up
// authorization ask surfaces its url and waits until the agent side
// completes it), a refused credential asked again with the provider's
// words, the picker among several, the file answers, the listing
// without values, and a logout that names what is missing.

interface LoggedIn {
  agent: string;
  name: string;
  provider: string;
  kind: string;
  fieldNames: string[];
  loggedInAt?: string;
  loggedInBy?: string;
}
const state: { asks: AgentAsk[]; answers: { id: string; fields: Record<string, string> }[] } = {
  asks: [],
  answers: [],
};
const safe = new Map<string, LoggedIn>();
const wordsOf = (agent: string, name: string): string => `${agent}#${name}`;

function readBody(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    request.on('end', () => {
      resolve(raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>));
    });
  });
}

const plane_ = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const json = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && url.pathname === '/v1/auth/accounts') {
      const agent = url.searchParams.get('agent');
      json(200, {
        accounts: [...safe.values()].filter((row) => agent === null || row.agent === agent),
        asks: state.asks.filter((ask) => agent === null || ask.agent === agent),
      });
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/v1/auth/asks/')) {
      const id = url.pathname.slice('/v1/auth/asks/'.length);
      const ask = state.asks.find((row) => row.id === id);
      if (ask === undefined) {
        json(404, { error: { kind: 'terminal', message: `no ask ${id}` } });
        return;
      }
      if (ask.kind !== 'fields') {
        json(400, {
          error: {
            kind: 'terminal',
            message: "an authorization or a display completes on the agent's side",
          },
        });
        return;
      }
      const body = await readBody(request);
      const fields = body['fields'] as Record<string, string>;
      state.answers.push({ id, fields });
      safe.set(wordsOf(ask.agent, ask.name), {
        agent: ask.agent,
        name: ask.name,
        provider: ask.provider,
        kind: 'fields',
        fieldNames: Object.keys(fields),
        loggedInAt: '2026-09-28T10:00:00.000Z',
        loggedInBy: 'local',
      });
      state.asks = state.asks.filter((row) => row.id !== id);
      // The resumed agent parks again: on its authorization, or on a
      // refusal of what was just pasted.
      if (fields['password'] === 'wrong') {
        state.asks.push({
          ...ask,
          id: `${id}-again`,
          refused: 'password authentication failed',
          requestedAt: '2026-09-28T10:00:01.000Z',
        });
      } else if (ask.agent === 'ops/gmail') {
        state.asks.push({
          id: 'ask-2',
          kind: 'oauth',
          agent: ask.agent,
          name: ask.name,
          provider: ask.provider,
          agentId: ask.agent,
          callId: ask.callId,
          requestedAt: '2026-09-28T10:00:01.000Z',
          authorizationUrl: 'https://accounts.example/auth?state=s-1',
        });
      }
      json(200, { agent: ask.agent, name: ask.name, loggedIn: true });
      return;
    }
    if (request.method === 'DELETE' && url.pathname === '/v1/auth/accounts') {
      const agent = url.searchParams.get('agent') ?? '';
      const name = url.searchParams.get('name') ?? '';
      if (!safe.delete(wordsOf(agent, name))) {
        json(404, {
          error: { kind: 'terminal', message: `no account "${name}" of ${agent} is known` },
        });
        return;
      }
      json(200, { agent, name, forgotten: true });
      return;
    }
    response.writeHead(404);
    response.end();
  })();
});

const plane: Plane = await new Promise((resolve) => {
  plane_.listen(0, '127.0.0.1', () => {
    const { port } = plane_.address() as AddressInfo;
    resolve({ baseUrl: `http://127.0.0.1:${String(port)}`, token: undefined });
  });
});

after(() => {
  plane_.close();
});

function fieldsAsk(agent: string, name: string, provider: string, id = 'ask-1'): AgentAsk {
  return {
    id,
    kind: 'fields',
    agent,
    name,
    provider,
    agentId: agent,
    callId: 'c-1',
    requestedAt: '2026-09-28T10:00:00.000Z',
    helpUrl: 'https://console.example/credentials',
    instructions: '1. Create an OAuth client\n2. Copy both values',
    fields: [
      { name: 'clientId', label: 'Client ID' },
      { name: 'clientSecret', label: 'Client Secret', secret: true },
    ],
    scopes: ['gmail.readonly'],
  };
}

function scriptedIo(
  answers: string[],
  options: { onSleep?: () => void; pick?: number } = {},
): {
  io: ConnectIo;
  output: string[];
  asked: { label: string; secret: boolean }[];
  opened: string[];
} {
  const output: string[] = [];
  const asked: { label: string; secret: boolean }[] = [];
  const opened: string[] = [];
  const queue = [...answers];
  const io: ConnectIo = {
    write: (line) => {
      output.push(line);
    },
    open: (url) => {
      opened.push(url);
    },
    ask: (label, secret) => {
      asked.push({ label, secret });
      return Promise.resolve(queue.shift() ?? '');
    },
    sleep: () => {
      options.onSleep?.();
      return Promise.resolve();
    },
    ...(options.pick === undefined ? {} : { pick: () => Promise.resolve(options.pick ?? 0) }),
  };
  return { io, output, asked, opened };
}

test('the fields then authorization flow runs the login screen end to end', async () => {
  state.asks = [fieldsAsk('ops/gmail', 'billing', 'google.com')];
  state.answers = [];
  let polls = 0;
  const { io, output, asked, opened } = scriptedIo(['c-1', 'cs-1'], {
    onSleep: () => {
      // The third poll of the authorization ask completes it, standing
      // in for the agent finishing its exchange after the callback.
      polls += 1;
      if (polls >= 3) state.asks = state.asks.filter((ask) => ask.id !== 'ask-2');
    },
  });
  const handled = await loginCommand(plane, { agent: 'ops/gmail' }, io, { quietPolls: 2 });
  assert.equal(handled, 2);
  const text = output.join('');
  assert.match(text, /ops\/gmail needs its account "billing" \(google\.com\)/);
  assert.match(text, /Create an OAuth client/);
  assert.match(text, /help: https:\/\/console\.example\/credentials/);
  assert.match(text, /sent; ops\/gmail is resuming/);
  assert.match(text, /your browser opens the sign-in page/);
  assert.match(text, /accounts\.example\/auth\?state=s-1/);
  assert.deepEqual(asked, [
    { label: 'Client ID', secret: false },
    { label: 'Client Secret', secret: true },
  ]);
  assert.deepEqual(state.answers, [
    { id: 'ask-1', fields: { clientId: 'c-1', clientSecret: 'cs-1' } },
  ]);
  assert.deepEqual(opened, ['https://accounts.example/auth?state=s-1']);
});

test("a refused credential comes back as the same prompt with the provider's words above it", async () => {
  state.asks = [
    {
      ...fieldsAsk('acme/orders-db', 'postgres', 'postgres'),
      fields: [
        { name: 'host', label: 'Host' },
        { name: 'password', label: 'Password', secret: true },
      ],
    },
  ];
  state.answers = [];
  const { io, output } = scriptedIo(['db.internal', 'wrong', 'db.internal', 'right']);
  const handled = await loginCommand(plane, { agent: 'acme/orders-db' }, io, { quietPolls: 2 });
  assert.equal(handled, 2);
  const text = output.join('');
  assert.match(text, /the provider refused the last one: password authentication failed/);
  assert.equal(state.answers.length, 2);
  assert.deepEqual(state.answers[1]?.fields, { host: 'db.internal', password: 'right' });
});

test('an empty answer to a field is asked for once more, and the second answer stands, typed or empty', async () => {
  // Enter pressed over an empty prompt would store an account that
  // reads as logged in and works for nothing, with no ask left.
  const ask = {
    ...fieldsAsk('acme/chat', 'slack.com', 'slack.com'),
    fields: [
      { name: 'token', label: 'Bot token', secret: true },
      { name: 'secret', label: 'Signing secret', secret: true },
    ],
  };
  // The second field is left empty by mistake, then typed.
  state.asks = [ask];
  state.answers = [];
  const typed = scriptedIo(['xoxb-1', '', 's-1']);
  await loginCommand(plane, { agent: 'acme/chat' }, typed.io, { quietPolls: 1 });
  assert.deepEqual(
    typed.asked.map((prompt) => prompt.label),
    ['Bot token', 'Signing secret', 'Signing secret'],
  );
  assert.match(
    typed.output.join(''),
    /Signing secret is empty: type it, or press Enter again to leave it empty\n/,
  );
  assert.deepEqual(state.answers[0]?.fields, { token: 'xoxb-1', secret: 's-1' });
  // Left empty twice, it is the person's answer: a provider may take it.
  state.asks = [ask];
  state.answers = [];
  const empty = scriptedIo(['xoxb-1', '', '']);
  await loginCommand(plane, { agent: 'acme/chat' }, empty.io, { quietPolls: 1 });
  assert.equal(empty.asked.length, 3);
  assert.deepEqual(state.answers[0]?.fields, { token: 'xoxb-1', secret: '' });
  // A field answered at once is asked for once.
  state.asks = [ask];
  state.answers = [];
  const plain = scriptedIo(['xoxb-1', 's-1']);
  await loginCommand(plane, { agent: 'acme/chat' }, plain.io, { quietPolls: 1 });
  assert.equal(plain.asked.length, 2);
  assert.doesNotMatch(plain.output.join(''), /is empty/);
});

test('several waiting: a terminal picks one, a pipe is told to name one, --all walks them', async () => {
  state.asks = [
    fieldsAsk('acme/a', 'stripe.com', 'stripe.com', 'ask-a'),
    fieldsAsk('acme/b', 'postgres', 'postgres', 'ask-b'),
  ];
  state.answers = [];
  const piped = scriptedIo([]);
  await assert.rejects(
    loginCommand(plane, {}, piped.io, { quietPolls: 1 }),
    (error: unknown) =>
      isCernantoError(error) && error.message === 'name one: cernanto auth login acme/a stripe.com',
  );
  assert.match(
    piped.output.join(''),
    /2 accounts are waiting:\n  1\. acme\/a stripe\.com  credentials\n  2\. acme\/b postgres  credentials/,
  );
  const picked = scriptedIo(['c', 's'], { pick: 1 });
  assert.equal(await loginCommand(plane, {}, picked.io, { quietPolls: 1 }), 1);
  assert.deepEqual(
    state.answers.map((row) => row.id),
    ['ask-b'],
  );
  const all = scriptedIo(['c', 's']);
  assert.equal(await loginCommand(plane, {}, all.io, { quietPolls: 1, all: true }), 1);
  assert.deepEqual(
    state.answers.map((row) => row.id),
    ['ask-b', 'ask-a'],
  );
  assert.equal(await loginCommand(plane, {}, all.io, { quietPolls: 1 }), 0);
  assert.match(all.output.join(''), /nothing is waiting to log in/);
});

test('a file answers a fields ask by name, and names the fields when one is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auth-'));
  const file = join(dir, 'answers.json');
  writeFileSync(file, JSON.stringify({ clientId: 'c-9', clientSecret: 'cs-9' }));
  assert.deepEqual(answersFromFile(file), { clientId: 'c-9', clientSecret: 'cs-9' });
  writeFileSync(file, '[1]');
  assert.throws(() => answersFromFile(file), /must hold one json object/);
  state.asks = [fieldsAsk('acme/c', 'google.com', 'google.com', 'ask-c')];
  state.answers = [];
  const { io } = scriptedIo([]);
  await assert.rejects(
    loginCommand(plane, { agent: 'acme/c' }, io, { quietPolls: 1, given: { clientId: 'c-9' } }),
    /the file answers no "clientSecret" for acme\/c google\.com; its fields are: clientId, clientSecret/,
  );
  assert.equal(
    await loginCommand(plane, { agent: 'acme/c' }, io, {
      quietPolls: 1,
      given: { clientId: 'c-9', clientSecret: 'cs-9' },
    }),
    1,
  );
  assert.deepEqual(state.answers[0]?.fields, { clientId: 'c-9', clientSecret: 'cs-9' });
});

test('the listing shows the waiting asks first and the logged-in accounts, never a value; a logout names what is missing', async () => {
  state.asks = [fieldsAsk('acme/d', 'postgres', 'postgres', 'ask-d')];
  const listing = await authListCommand(plane);
  const rows = authRows(listing);
  assert.deepEqual(rows[0], [
    'acme/d',
    'postgres',
    'postgres',
    'waiting for credentials since 2026-09-28T10:00:00.000Z',
  ]);
  assert.ok(
    rows.some(
      (row) =>
        row[0] === 'acme/c' && row[3]?.startsWith('logged in 2026-09-28T10:00:00.000Z by local'),
    ),
  );
  assert.ok(!JSON.stringify(listing).includes('cs-9'));
  await authLogoutCommand(plane, 'acme/c', 'google.com');
  // Logged out once, it is no account any more: the refusal says so in
  // the listing's own words, and where its accounts are shown.
  await assert.rejects(
    authLogoutCommand(plane, 'acme/c', 'google.com'),
    (error: unknown) =>
      isCernantoError(error) &&
      error.kind === 'terminal' &&
      error.message ===
        'acme/c has no account "google.com" logged in, so there is nothing to log out; cernanto auth list acme/c shows its accounts',
  );
  // An account an agent still waits for stands in the same listing and
  // is no account either: nothing is stored for it, and the refusal
  // names the login that answers it.
  await assert.rejects(
    authLogoutCommand(plane, 'acme/d', 'postgres'),
    (error: unknown) =>
      isCernantoError(error) &&
      error.message ===
        'acme/d has no account "postgres" logged in, so there is nothing to log out: it is waiting for that login, and nothing is stored for it. Log it in with cernanto auth login acme/d postgres',
  );
  assert.equal(askWords({ agent: 'acme/c', name: 'google.com' }), 'acme/c google.com');
  assert.deepEqual(accountOfWords('acme/c google.com'), { agent: 'acme/c', name: 'google.com' });
  assert.deepEqual(accountOfWords('acme/c'), { agent: 'acme/c' });
  assert.equal(renderDisplayContent('qr:abc'), 'qr payload (render with any qr tool):\nabc');
});
