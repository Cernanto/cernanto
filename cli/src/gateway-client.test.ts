// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CernantoError } from '@cernanto/package-format';
import { homeEnvironment } from '@cernanto/system';

import { saveContext } from './context.js';
import {
  accepted,
  gatewayClients,
  planeFetch,
  unreachable,
  unread,
  unwrap,
  whenLoopbackDown,
} from './gateway-client.js';
import type { Plane } from './gateway-client.js';
import * as gateway from './gateway/sdk.gen.js';
import { ServerClient } from './server-client.js';

// The words for a local plane that did not answer: "not running" only
// when nothing listens on the port; any other failure names its cause,
// so a connection the gateway reset mid-request is told from a parked
// plane.

const local = { baseUrl: 'http://127.0.0.1:7434' } as unknown as Parameters<typeof unreachable>[0];

function fetchFailed(code: string, message: string): Error {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(message), { code }),
  });
}

test('a refused connection to the local plane says the plane is not running', () => {
  const words = unreachable(
    local,
    fetchFailed('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:7434'),
  ).message;
  assert.equal(words, 'the local plane is not running; start it with: cernanto dev');
});

test('any other failure of the local plane carries its cause', () => {
  const words = unreachable(local, fetchFailed('ECONNRESET', 'socket hang up')).message;
  assert.match(words, /^the local plane did not answer: socket hang up/);
  assert.doesNotMatch(words, /is not running/);
});

/** The error a refusal of the plane becomes. */
function refusalOf(status: number, body: unknown): CernantoError {
  try {
    unwrap({ response: new Response('', { status }), error: body }, '/v1/packages/land');
  } catch (error) {
    assert.ok(error instanceof CernantoError);
    return error;
  }
  throw new Error('the refusal was accepted');
}

test("a refusal keeps the plane's own kind, so a caller that retries reads the plane's word", () => {
  const rolling = refusalOf(503, { error: { kind: 'retryable', message: 'the store is rolling' } });
  assert.equal(rolling.kind, 'retryable');
  assert.equal(rolling.message, 'the store is rolling');
  assert.equal(
    refusalOf(503, { error: { kind: 'target-unavailable', message: 'not deployed yet' } }).kind,
    'target-unavailable',
  );
  // A kind the platform does not know, and an answer with none, are terminal.
  assert.equal(refusalOf(400, { error: { kind: 'odd', message: 'no' } }).kind, 'terminal');
  assert.equal(refusalOf(404, {}).kind, 'terminal');
  assert.equal(refusalOf(404, {}).message, 'the plane answered 404 for /v1/packages/land');
});

/** A loopback port nothing listens on: taken from the kernel and given
 * back, so a connection to it is refused at once. */
async function closedPort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  return port;
}

test('the request that started the local plane goes again with the token the start saved', async () => {
  // The first try is refused: nothing listens on the port yet.
  const port = await closedPort();
  // The contexts of this test live under a home of its own.
  Object.assign(process.env, homeEnvironment(mkdtempSync(join(tmpdir(), 'gateway-client-home-'))));
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const bearers: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    bearers.push(request.headers.authorization);
    response.end('ok');
  });
  whenLoopbackDown(async () => {
    // The start brings the plane up and saves its context, as `cernanto dev` does.
    await new Promise<void>((resolve) => {
      server.listen(port, '127.0.0.1', resolve);
    });
    saveContext('local', { server: baseUrl, token: 'minted-at-start' });
    return true;
  });
  try {
    const plane: Plane = { baseUrl, token: undefined };
    const answer = await planeFetch(plane, `${baseUrl}/healthz`);
    assert.equal(answer.status, 200);
    assert.deepEqual(bearers, ['Bearer minted-at-start']);
    // The requests after it carry the same token.
    assert.equal(plane.token, 'minted-at-start');
    await planeFetch(plane, `${baseUrl}/v1/status`);
    assert.deepEqual(bearers, ['Bearer minted-at-start', 'Bearer minted-at-start']);
  } finally {
    whenLoopbackDown(undefined);
    server.close();
  }
});

test('a time limit runs from each issue: the request that started the local plane has the whole of it', async () => {
  const port = await closedPort();
  Object.assign(process.env, homeEnvironment(mkdtempSync(join(tmpdir(), 'gateway-client-home-'))));
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end('{}');
  });
  whenLoopbackDown(async () => {
    // The start takes longer than the request's own limit.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await new Promise<void>((resolve) => {
      server.listen(port, '127.0.0.1', resolve);
    });
    return true;
  });
  try {
    const gateways = gatewayClients({ baseUrl, token: undefined });
    const health = await gateway.healthz({ client: gateways.within(200) });
    assert.equal(accepted(health), true);
  } finally {
    whenLoopbackDown(undefined);
    server.close();
  }
});

test('a request held past its time limit ends in words', async () => {
  const silent = createServer(() => {
    // The plane takes the request and answers nothing.
  });
  await new Promise<void>((resolve) => {
    silent.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = silent.address() as AddressInfo;
    const gateways = gatewayClients({
      baseUrl: `http://127.0.0.1:${String(port)}`,
      token: undefined,
    });
    const held = await gateway.healthz({ client: gateways.within(150) });
    assert.equal(accepted(held), false);
    assert.throws(() => unwrap(held, '/healthz'), /the local plane did not answer: timed out/);
  } finally {
    silent.closeAllConnections();
    silent.close();
  }
});

/** A plane on a loopback port answering every request the way given,
 * until closed. */
async function planeAnswering(
  answer: (response: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => void }> {
  const server = createServer((_request, response) => {
    answer(response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/** What reading a result as an accepted answer throws. */
function refusedRead(result: Parameters<typeof unwrap>[0], path: string): CernantoError {
  try {
    unwrap(result, path);
  } catch (error) {
    assert.ok(error instanceof CernantoError, String(error));
    return error;
  }
  throw new Error('the answer was read');
}

test('an answer the plane gave that cannot be read is a failure in words, never an empty answer: a body that is not what the route answers', async () => {
  const plane = await planeAnswering((response) => {
    response.setHeader('content-type', 'application/json');
    response.end('{"asks": [');
  });
  try {
    const gateways = gatewayClients({ baseUrl: plane.baseUrl, token: undefined });
    const result = await gateway.authList({ client: gateways.client });
    assert.equal(result.response?.status, 200, 'the plane said ok');
    assert.equal(result.data, undefined);
    assert.equal(accepted(result), false);
    const failure = refusedRead(result, '/v1/auth/accounts');
    assert.equal(failure.kind, 'retryable', 'the same request may go again');
    assert.match(
      failure.message,
      /^the plane's answer for \/v1\/auth\/accounts could not be read: /,
    );
    assert.deepEqual(unread(result, '/v1/auth/accounts')?.message, failure.message);
  } finally {
    plane.close();
  }
});

test('an answer cut on the way is the same failure, for a document and for the bytes of a package', async () => {
  const plane = await planeAnswering((response) => {
    // The plane says ok and promises more than it sends.
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '4096' });
    response.write('{"harness": ');
    setTimeout(() => {
      response.destroy();
    }, 50);
  });
  try {
    const gateways = gatewayClients({ baseUrl: plane.baseUrl, token: undefined });
    const view = await gateway.harnessView({ client: gateways.client });
    assert.equal(view.response?.ok, true);
    assert.equal(accepted(view), false);
    assert.equal(refusedRead(view, '/v1/harness').kind, 'retryable');
    const bytes = await gateway.packageGet({
      client: gateways.client,
      path: { digest: 'sha256:0' },
      parseAs: 'arrayBuffer',
    });
    assert.equal(bytes.response?.ok, true);
    assert.equal(accepted(bytes), false);
    assert.match(
      unread(bytes, '/v1/packages/sha256:0')?.message ?? '',
      /^the plane's answer for \/v1\/packages\/sha256:0 could not be read/,
    );
  } finally {
    plane.close();
  }
});

test("the plane's client fails in the same words where a command needs the answer: a document, a package's bytes, a put", async () => {
  const plane = await planeAnswering((response) => {
    response.setHeader('content-type', 'application/json');
    response.end('{"cut": ');
  });
  try {
    const client = new ServerClient({ baseUrl: plane.baseUrl, token: undefined });
    const unreadAnswer = (path: string): RegExp =>
      new RegExp(`the plane's answer for ${path.replaceAll('/', '\\/')} could not be read`);
    await assert.rejects(client.agents(), unreadAnswer('/v1/agents'));
    await assert.rejects(
      client.packagePut('sha256:0', Buffer.from('bytes')),
      unreadAnswer('/v1/packages/sha256%3A0'),
    );
    const cut = await planeAnswering((response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': '4096',
      });
      response.write('half');
      setTimeout(() => {
        response.destroy();
      }, 50);
    });
    try {
      const reader = new ServerClient({ baseUrl: cut.baseUrl, token: undefined });
      await assert.rejects(reader.packageGet('sha256:0'), (error: unknown) => {
        assert.ok(error instanceof CernantoError, String(error));
        assert.equal(error.kind, 'retryable');
        assert.match(error.message, unreadAnswer('/v1/packages/sha256%3A0'));
        return true;
      });
    } finally {
      cut.close();
    }
  } finally {
    plane.close();
  }
});

test('a read answer and a refusal are no unread answer', () => {
  assert.equal(
    unread({ response: new Response('{}', { status: 200 }), data: {} }, '/x'),
    undefined,
  );
  assert.equal(
    unread({ response: new Response('', { status: 404 }), error: { error: {} } }, '/x'),
    undefined,
  );
  assert.equal(unread({ error: new Error('fetch failed') }, '/x'), undefined);
  assert.equal(accepted({ response: new Response('{}', { status: 200 }), data: {} }), true);
});

test('a read whose connection the plane closed before it answered goes again; a request that changes the plane does not', async () => {
  // A plane whose gateway copy is leaving: the first connections are
  // dropped once the request is in, as a listener that closes drops
  // what it had not answered; the ones after are served.
  const serve = async (
    drops: (method: string, dropped: number) => boolean,
  ): Promise<{ baseUrl: string; seen: string[]; close: () => void }> => {
    const seen: string[] = [];
    let dropped = 0;
    const server = createTcpServer((socket) => {
      socket.once('data', (bytes) => {
        const method = bytes.toString('utf8').split(' ')[0] ?? '';
        seen.push(method);
        if (drops(method, dropped)) {
          dropped += 1;
          socket.destroy();
          return;
        }
        socket.end(
          'HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 13\r\nconnection: close\r\n\r\n{"agents":[]}',
        );
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    return {
      baseUrl: `http://127.0.0.1:${String(port)}`,
      seen,
      close: () => {
        server.close();
      },
    };
  };
  // Dropped twice, answered the third time: the read arrives.
  const leaving = await serve((_method, dropped) => dropped < 2);
  try {
    const answer = await planeFetch(
      { baseUrl: leaving.baseUrl, token: undefined },
      `${leaving.baseUrl}/v1/ls`,
    );
    assert.equal(answer.status, 200);
    assert.deepEqual(leaving.seen, ['GET', 'GET', 'GET']);
  } finally {
    leaving.close();
  }
  // A plane that keeps closing is said in the same words as before,
  // after the read went again its few times.
  const gone = await serve(() => true);
  try {
    await assert.rejects(
      planeFetch({ baseUrl: gone.baseUrl, token: undefined }, `${gone.baseUrl}/v1/ls`),
      (error: unknown) => {
        assert.ok(error instanceof CernantoError, String(error));
        assert.equal(error.kind, 'retryable');
        assert.match(error.message, /^the local plane did not answer: /);
        return true;
      },
    );
    assert.equal(gone.seen.length, 4, 'the first try and three more');
  } finally {
    gone.close();
  }
  // A put is sent once: the plane may have taken it.
  const once = await serve((method) => method === 'PUT');
  try {
    const client = new ServerClient({ baseUrl: once.baseUrl, token: undefined });
    await assert.rejects(client.packagePut('sha256:0', Buffer.from('bytes')));
    assert.deepEqual(
      once.seen.filter((method) => method === 'PUT'),
      ['PUT'],
      'the put went once',
    );
  } finally {
    once.close();
  }
});
