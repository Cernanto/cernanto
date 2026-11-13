// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { system } from '@cernanto/system';

import {
  contextNameOf,
  currentContext,
  currentContextName,
  listContexts,
  overrideContext,
  saveContext,
  useContext,
} from './context.js';

test('contexts save, switch, and list with the current one marked', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ctx-')), 'contexts.json');
  saveContext('prod', { server: 'https://prod.example.com', token: 'p' }, file);
  saveContext('dev', { server: 'https://dev.example.com', token: 'd' }, file);
  assert.deepEqual(listContexts(file), [
    { name: 'dev', server: 'https://dev.example.com', current: true },
    { name: 'prod', server: 'https://prod.example.com', current: false },
  ]);
  const switched = useContext('prod', file);
  assert.equal(switched.server, 'https://prod.example.com');
  assert.ok(listContexts(file).find((row) => row.name === 'prod')?.current);
  assert.equal(currentContextName(file), 'prod');
  assert.throws(() => useContext('ghost', file), /no context named "ghost"/);
  // Nothing saved: no context, and the caller falls back to the plane
  // on this machine.
  const empty = join(mkdtempSync(join(tmpdir(), 'ctx-empty-')), 'contexts.json');
  assert.equal(currentContext(empty), undefined);
  assert.deepEqual(listContexts(empty), []);
});

test('--context picks a plane for the process without touching the file; an unknown name is refused', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cern-contexts-')), 'contexts.json');
  saveContext('prod', { server: 'https://10.0.1.10:7434', token: 'p' }, file);
  saveContext('local', { server: 'http://127.0.0.1:7434' }, file);
  assert.equal(currentContext(file)?.server, 'http://127.0.0.1:7434');
  overrideContext('prod');
  try {
    assert.equal(currentContext(file)?.server, 'https://10.0.1.10:7434');
    assert.equal(currentContextName(file), 'prod');
    assert.equal(listContexts(file).find((context) => context.current)?.name, 'local');
    overrideContext('nowhere');
    assert.throws(() => currentContext(file), /no context named "nowhere"/);
  } finally {
    overrideContext(undefined);
  }
  assert.equal(currentContext(file)?.server, 'http://127.0.0.1:7434');
});

test('a current context the file does not hold is refused in words, and a switch repairs it', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ctx-dangling-')), 'contexts.json');
  writeFileSync(
    file,
    JSON.stringify({
      current: 'production',
      contexts: { staging: { server: 'https://staging.example.com' } },
    }),
  );
  assert.throws(
    () => currentContext(file),
    /the current context "production" names no plane in .*contexts\.json; switch to one with: cernanto context <name>, or save it again with: cernanto login <url> --token <token> --name production/,
  );
  // The planes the file holds still list, none of them marked, and a
  // switch to one makes it the current context.
  assert.deepEqual(listContexts(file), [
    { name: 'staging', server: 'https://staging.example.com', current: false },
  ]);
  useContext('staging', file);
  assert.equal(currentContext(file)?.server, 'https://staging.example.com');
});

test('a context is named after its host, the port kept when it is not the usual one', () => {
  assert.equal(contextNameOf('https://plane.acme.com:7434'), 'plane.acme.com');
  assert.equal(contextNameOf('https://plane.acme.com'), 'plane.acme.com');
  assert.equal(contextNameOf('http://10.0.1.10:18434'), '10.0.1.10:18434');
  assert.equal(contextNameOf('not a url'), 'not a url');
});

test('a contexts file that does not read is refused and left as it is', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ctx-broken-')), 'contexts.json');
  for (const broken of ['{"current": "prod", "contexts": {"prod": {"server"', '{}', '[]']) {
    writeFileSync(file, broken);
    assert.throws(() => currentContext(file), /does not read as the cli's contexts/);
    assert.throws(() => listContexts(file), /does not read as the cli's contexts/);
    // A save reads first: the planes the file names are kept for the
    // operator to recover.
    assert.throws(() => {
      saveContext('local', { server: 'http://127.0.0.1:7434' }, file);
    }, /fix it, or move it away and log in again/);
    assert.equal(readFileSync(file, 'utf8'), broken);
  }
  writeFileSync(file, JSON.stringify({ contexts: { prod: { server: 7434 } } }));
  assert.throws(() => currentContext(file), /each with its "server"/);
});

test('the contexts file is written whole and for its owner alone', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ctx-mode-')), 'contexts.json');
  saveContext('prod', { server: 'https://prod.example.com', token: 'p' }, file);
  // A file that stood with a wider mode is narrowed by the next save.
  chmodSync(file, 0o644);
  saveContext('dev', { server: 'https://dev.example.com', token: 'd' }, file);
  if (system.name !== 'windows') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dirname(file)), ['contexts.json']);
  assert.equal(listContexts(file).length, 2);
});
