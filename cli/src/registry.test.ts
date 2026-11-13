// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { system } from '@cernanto/system';

import {
  RegistryClient,
  authorizeUrlOf,
  loadRegistryAuth,
  registryEndpoints,
  registryTokenLogin,
  saveRegistryAuth,
  unverifiedPublishWords,
} from './registry.js';

// The registry client's own rules, provable without the gate. The
// protocol round trips (publish, search, resolve, the login flow) are
// proven against the real gate in the maintainers' test tiers.

test("the registry hosts are the plane's settings, the public registry's otherwise", async () => {
  // No plane at hand, or one without the settings: the public hosts.
  const endpoints = await registryEndpoints();
  assert.match(endpoints.gateUrl, /^https:\/\/[^/]+$/);
  assert.match(endpoints.indexUrl, /^https:\/\/[^/]+$/);
  const unset = await registryEndpoints({ invoke: () => Promise.resolve({ value: null }) });
  assert.deepEqual(unset, endpoints);
  const silent = await registryEndpoints({
    invoke: () => Promise.reject(new Error('no plane')),
  });
  assert.deepEqual(silent, endpoints);
  // A plane that names the hosts steers the cli, a trailing slash
  // trimmed; the same setting steers the plane's own landing.
  const asked: unknown[] = [];
  const configured = await registryEndpoints({
    invoke: (agentId, fn, args) => {
      asked.push([agentId, fn, args]);
      return Promise.resolve({
        value:
          args === 'cernanto/controller/install/registry-gate'
            ? 'http://127.0.0.1:7001/'
            : 'http://127.0.0.1:7002',
      });
    },
  });
  assert.deepEqual(configured, {
    gateUrl: 'http://127.0.0.1:7001',
    indexUrl: 'http://127.0.0.1:7002',
  });
  assert.deepEqual(asked, [
    ['cernanto/config', 'getAt', 'cernanto/controller/install/registry-gate'],
    ['cernanto/config', 'getAt', 'cernanto/controller/install/registry-index'],
  ]);
  const url = authorizeUrlOf(
    'https://github.com/login/oauth/authorize',
    'cid',
    'http://x/cb',
    's1',
  );
  assert.match(url, /client_id=cid/);
  assert.match(url, /state=s1/);
});

test("the registry sign-in is kept under its owner's mode and read back by its gate", () => {
  const file = join(mkdtempSync(join(tmpdir(), 'registry-auth-')), 'registry-auth.json');
  const auth = { token: 'registry-token', publisher: { publisherId: 'p-1', login: 'acme' } };
  saveRegistryAuth('https://registry.example.com', auth, file);
  assert.deepEqual(loadRegistryAuth('https://registry.example.com', file), auth);
  if (system.name !== 'windows') assert.equal(statSync(file).mode & 0o777, 0o600);
  saveRegistryAuth('https://registry.example.com', undefined, file);
  assert.equal(loadRegistryAuth('https://registry.example.com', file), undefined);
});

test('the token sign-in asks the gate who the token is and saves it as the sign-in; a token of another shape is refused', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'registry-token-')), 'registry-auth.json');
  const seen: string[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push(`${init?.method ?? 'GET'} ${url} ${headers['authorization'] ?? ''}`);
    assert.equal(url, 'https://registry.example.com/v1/whoami');
    return Promise.resolve(
      new Response(JSON.stringify({ publisherId: 'p-ci', login: 'ci-bot' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  const endpoints = {
    gateUrl: 'https://registry.example.com',
    indexUrl: 'https://packages.example.com',
  };
  const who = await registryTokenLogin(
    new RegistryClient(endpoints, 'cern_abc', fetchImpl),
    endpoints.gateUrl,
    'cern_abc',
    file,
  );
  assert.deepEqual(who, { publisherId: 'p-ci', login: 'ci-bot' });
  assert.deepEqual(seen, ['GET https://registry.example.com/v1/whoami Bearer cern_abc']);
  assert.deepEqual(loadRegistryAuth(endpoints.gateUrl, file), {
    token: 'cern_abc',
    publisher: { publisherId: 'p-ci', login: 'ci-bot' },
  });
  await assert.rejects(
    registryTokenLogin(
      new RegistryClient(endpoints, 'ghp_x', fetchImpl),
      endpoints.gateUrl,
      'ghp_x',
      file,
    ),
    /a registry token starts with cern_/,
  );
});

test('publish refuses a package without a verified stamp unless asked', () => {
  const unstamped = { name: 'acme/greeter', provenance: {} };
  const stamped = {
    name: 'acme/greeter',
    provenance: { verified: { at: '2026-10-15T00:00:00.000Z' } },
  };
  assert.match(
    unverifiedPublishWords(unstamped, false) ?? '',
    /acme\/greeter carries no verified stamp: deploy it first \(cernanto deploy acme\/greeter\), or publish it as it is with --unverified/,
  );
  assert.equal(unverifiedPublishWords(stamped, false), undefined);
  assert.equal(unverifiedPublishWords(unstamped, true), undefined);
});
