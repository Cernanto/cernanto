// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';

import { watchAsks } from './asks.js';
import type { Plane } from './gateway-client.js';
import type { AgentAsk } from './gateway/types.gen.js';

// The watch a followed run keeps on the plane's waiting asks ends with
// the run: after `stop` no answer begins, whatever the plane answers a
// poll that was under way, and whatever waits its turn behind the
// answer that holds the terminal. The plane here answers the listing
// of the asks alone, when the proof lets it.

/** The reads of the asks the plane holds, each answered by the proof. */
const reads: ServerResponse[] = [];
let onRead: () => void = () => undefined;

const server = createServer((_request, response) => {
  reads.push(response);
  onRead();
});

after(() => {
  server.closeAllConnections();
  server.close();
});

async function planeOf(): Promise<Plane> {
  if (!server.listening) {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
  }
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${String(port)}`, token: undefined };
}

/** Resolves when the plane holds a read of the asks. */
function nextRead(): Promise<void> {
  if (reads.length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    onRead = resolve;
  });
}

/** Answers every read the plane holds with the asks given. */
function answerReads(asks: AgentAsk[]): void {
  for (const response of reads.splice(0)) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ accounts: [], asks }));
  }
}

function askOf(id: string): AgentAsk {
  return {
    id,
    kind: 'fields',
    agent: 'ops/mail',
    name: 'inbox',
    provider: 'imap',
    agentId: 'ops/mail',
    callId: `call-${id}`,
    requestedAt: '2026-10-05T10:00:00.000Z',
  };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('a poll of the asks that the plane answers after the watch stopped starts no answer', async () => {
  const answered: string[] = [];
  const watch = watchAsks({
    plane: await planeOf(),
    accepts: () => true,
    answer: (ask) => {
      answered.push(ask.id);
      return Promise.resolve();
    },
    pollMs: 10,
  });
  // The plane is asked, and the run ends before it answers.
  await nextRead();
  watch.stop();
  answerReads([askOf('late')]);
  await watch.settled();
  await pause(100);
  assert.deepEqual(answered, []);
  assert.equal(reads.length, 0, 'no poll starts after the stop');
});

test('an answer waiting its turn never begins after the stop; the one under way runs to its end', async () => {
  const answered: string[] = [];
  let finishFirst: () => void = () => undefined;
  const first = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const watch = watchAsks({
    plane: await planeOf(),
    accepts: () => true,
    answer: async (ask) => {
      answered.push(ask.id);
      if (ask.id === 'one') await first;
    },
    pollMs: 10,
  });
  await nextRead();
  answerReads([askOf('one'), askOf('two')]);
  while (answered.length === 0) await pause(5);
  watch.stop();
  let settled = false;
  const settling = watch.settled().then(() => {
    settled = true;
  });
  await pause(30);
  assert.equal(settled, false, 'the answer under way is waited for');
  finishFirst();
  await settling;
  assert.deepEqual(answered, ['one']);
  answerReads([]);
});
