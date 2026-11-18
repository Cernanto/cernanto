// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';

import { ServerClient } from './server-client.js';

// The stream of a watched call, read as the plane writes it: each event
// one JSON text, so an answer of nothing reaches the client as an event
// with no `result` at all, and a failure as the document's error
// envelope, its kind and words.

/** The events the next stream answers, each written as JSON. */
let events: unknown[] = [];

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(': stream open\n\n');
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end();
});

after(() => {
  server.closeAllConnections();
  server.close();
});

async function client(): Promise<ServerClient> {
  if (!server.listening) {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
  }
  const { port } = server.address() as AddressInfo;
  return new ServerClient({ baseUrl: `http://127.0.0.1:${String(port)}`, token: undefined });
}

test('a watched call of a function that answers nothing ends with its answer, nothing', async () => {
  events = [{ accepted: { callId: 'ops_void:20001:c-1:0123456789abcdef' } }, { result: undefined }];
  const answered = await (await client()).invokeStream('ops/void', 'go', {}, {});
  assert.deepEqual(answered, { result: undefined, callId: 'ops_void:20001:c-1:0123456789abcdef' });
});

test('a watched call that answers a value ends with it, null among them', async () => {
  events = [{ accepted: { callId: 'ops_null:20001:c-2:0123456789abcdef' } }, { result: null }];
  const answered = await (await client()).invokeStream('ops/null', 'go', {}, {});
  assert.deepEqual(answered, { result: null, callId: 'ops_null:20001:c-2:0123456789abcdef' });
});

test("a watched call's failure is thrown in its kind and words", async () => {
  events = [
    { accepted: { callId: 'ops_fail:20001:c-3:0123456789abcdef' } },
    { error: { kind: 'retryable', message: 'the trace agent is away' } },
  ];
  await assert.rejects(
    (await client()).invokeStream('ops/fail', 'go', {}, {}),
    (error: unknown) => {
      const failure = error as { kind?: string; message?: string };
      assert.equal(failure.kind, 'retryable');
      assert.equal(failure.message, 'the trace agent is away');
      return true;
    },
  );
});

test('a stream that ends before the answer is a retryable failure', async () => {
  events = [{ accepted: { callId: 'ops_cut:20001:c-4:0123456789abcdef' } }];
  await assert.rejects((await client()).invokeStream('ops/cut', 'go', {}, {}), (error: unknown) => {
    assert.equal((error as { kind?: string }).kind, 'retryable');
    return true;
  });
});
