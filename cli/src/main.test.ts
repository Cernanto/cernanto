// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { homeEnvironment } from '@cernanto/system';

// The binary through its real entry point, as a process: which plane a
// command reaches is decided before any verb runs, so it is proven on
// the whole program, against two planes that record what they were
// asked.

const SRC = dirname(fileURLToPath(import.meta.url));

/** A plane that records each request and answers the tokens' routes,
 * its health and a status with one problem named. */
interface FakePlane {
  server: Server;
  url: string;
  asked: string[];
}

async function fakePlane(): Promise<FakePlane> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(
      `${request.method ?? ''} ${request.url ?? ''} ${request.headers.authorization ?? ''}`,
    );
    response.setHeader('content-type', 'application/json');
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (path === '/healthz') {
      response.end('{}');
    } else if (path === '/v1/status') {
      response.end(
        JSON.stringify({
          substrate: true,
          survives: 'one node',
          problems: [{ fault: 'the store is behind', remedy: 'give it a minute' }],
          fleet: { draining: 0, conditions: [] },
        }),
      );
    } else if (path.startsWith('/v1/tokens')) {
      response.end(
        request.method === 'DELETE'
          ? JSON.stringify({ revoked: 'ci', revokedAt: '2026-01-01T00:00:00.000Z' })
          : JSON.stringify({ tokens: [] }),
      );
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { message: 'no such route' } }));
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    asked,
  };
}

let development: FakePlane;
let production: FakePlane;
let home: string;

before(async () => {
  development = await fakePlane();
  production = await fakePlane();
  // The contexts live under a home of the test's own: production is the
  // current one.
  home = mkdtempSync(join(tmpdir(), 'cernanto-main-'));
  mkdirSync(join(home, '.cernanto'), { recursive: true });
  writeFileSync(
    join(home, '.cernanto', 'contexts.json'),
    JSON.stringify({
      current: 'production',
      contexts: {
        production: { server: production.url, token: 'production-token' },
        development: { server: development.url, token: 'development-token' },
      },
    }),
  );
});

after(() => {
  development.server.close();
  production.server.close();
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** One run of the binary under the test's home, from a folder that
 * holds no workspace. */
function cernanto(...args: string[]): Promise<Run> {
  return cernantoUnder(home, ...args);
}

/** One run of the binary under a home of its own. */
function cernantoUnder(under: string, ...args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), join(SRC, 'main.ts'), ...args],
      {
        cwd: under,
        env: { ...process.env, ...homeEnvironment(under) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function forget(): void {
  development.asked.length = 0;
  production.asked.length = 0;
}

test('--context=name reaches the named plane, in either spelling and on either side of the verb', async () => {
  forget();
  const equals = await cernanto('--context=development', 'token', 'revoke', 'ci');
  assert.equal(equals.code, 0, equals.stderr);
  assert.deepEqual(development.asked, ['DELETE /v1/tokens/ci Bearer development-token']);
  assert.deepEqual(production.asked, []);

  forget();
  const spaced = await cernanto('--context', 'development', 'token', 'list', '-o', 'json');
  assert.equal(spaced.code, 0, spaced.stderr);
  assert.deepEqual(JSON.parse(spaced.stdout), []);
  assert.deepEqual(development.asked, ['GET /v1/tokens Bearer development-token']);
  assert.deepEqual(production.asked, []);

  forget();
  const after = await cernanto('token', 'list', '--context=development');
  assert.equal(after.code, 0, after.stderr);
  assert.deepEqual(development.asked, ['GET /v1/tokens Bearer development-token']);
  assert.deepEqual(production.asked, []);
});

test('with no override the current context is the plane, and an unknown name is refused before any request', async () => {
  forget();
  const current = await cernanto('token', 'list');
  assert.equal(current.code, 0, current.stderr);
  assert.deepEqual(production.asked, ['GET /v1/tokens Bearer production-token']);
  assert.deepEqual(development.asked, []);

  forget();
  const ghost = await cernanto('--context=ghost', 'token', 'revoke', 'ci');
  assert.equal(ghost.code, 1);
  assert.match(ghost.stderr, /no context named "ghost"/);
  assert.deepEqual(production.asked, []);
  assert.deepEqual(development.asked, []);
});

test('a current context the file does not hold is refused before any request, and a switch repairs it', async () => {
  const dangling = mkdtempSync(join(tmpdir(), 'cernanto-main-dangling-'));
  mkdirSync(join(dangling, '.cernanto'), { recursive: true });
  writeFileSync(
    join(dangling, '.cernanto', 'contexts.json'),
    JSON.stringify({
      current: 'production',
      contexts: { development: { server: development.url, token: 'development-token' } },
    }),
  );
  forget();
  const refused = await cernantoUnder(dangling, 'token', 'list');
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /the current context "production" names no plane in /);
  assert.deepEqual(development.asked, []);
  assert.deepEqual(production.asked, []);

  const switched = await cernantoUnder(dangling, 'context', 'development');
  assert.equal(switched.code, 0, switched.stderr);
  const listed = await cernantoUnder(dangling, 'token', 'list');
  assert.equal(listed.code, 0, listed.stderr);
  assert.deepEqual(development.asked, ['GET /v1/tokens Bearer development-token']);
});
