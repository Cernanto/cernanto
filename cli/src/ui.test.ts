// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Plane } from './gateway-client.js';
import { elsewhereWords, openUi, uiAddress } from './ui.js';
import type { UiIo } from './ui.js';

const LOCAL: Plane = { baseUrl: 'http://127.0.0.1:7434', token: undefined };

/** An io that keeps what the verb did, in the order it did it. */
function recorded(reach: UiIo['reach'] = () => Promise.resolve()): { io: UiIo; did: string[] } {
  const did: string[] = [];
  return {
    did,
    io: {
      write: (text) => did.push(`said ${text.trimEnd()}`),
      open: (url) => did.push(`opened ${url}`),
      reach: async (plane) => {
        did.push(`reached ${plane.baseUrl}`);
        await reach(plane);
      },
    },
  };
}

test("the local plane's UI is its gateway's address: reached, printed, then opened", async () => {
  const { io, did } = recorded();
  await openUi(LOCAL, io);
  assert.deepEqual(did, [
    'reached http://127.0.0.1:7434',
    "said opening the plane's UI in your browser: http://127.0.0.1:7434/",
    'opened http://127.0.0.1:7434/',
  ]);
});

test('the address ends in one slash, however the context spells the plane', () => {
  for (const baseUrl of [
    'http://127.0.0.1:7434',
    'http://127.0.0.1:7434/',
    'http://localhost:9000//',
  ]) {
    const address = uiAddress({ baseUrl, token: undefined });
    assert.match(address, /[^/]\/$/, address);
  }
  assert.equal(uiAddress({ baseUrl: 'http://[::1]:7434', token: undefined }), 'http://[::1]:7434/');
});

test('a plane reached on this machine under any of its loopback names is opened', async () => {
  for (const baseUrl of ['http://localhost:7434', 'http://[::1]:7434', 'http://127.0.0.1:8123']) {
    const { io, did } = recorded();
    await openUi({ baseUrl, token: 'cern_op_token' }, io);
    assert.equal(did.at(-1), `opened ${baseUrl}/`);
  }
});

test('a plane on another machine is refused in words, and nothing is reached or opened', async () => {
  const plane: Plane = { baseUrl: 'https://plane.example.com', token: 'cern_op_token' };
  const { io, did } = recorded();
  await assert.rejects(openUi(plane, io), (error: Error) => {
    assert.equal(error.message, elsewhereWords(plane));
    assert.match(error.message, /https:\/\/plane\.example\.com/);
    assert.match(error.message, /its own machine alone/);
    return true;
  });
  assert.deepEqual(did, []);
  // The token never rides in what is said.
  assert.doesNotMatch(elsewhereWords(plane) ?? '', /cern_op_token/);
});

test('a plane that does not answer opens no browser, and its failure is the one told', async () => {
  const { io, did } = recorded(() => Promise.reject(new Error('the local plane did not answer')));
  await assert.rejects(openUi(LOCAL, io), /the local plane did not answer/);
  assert.deepEqual(did, ['reached http://127.0.0.1:7434']);
});

test('a token is no part of the address a browser is sent to', async () => {
  const { io, did } = recorded();
  await openUi({ baseUrl: 'http://127.0.0.1:7434', token: 'cern_op_token' }, io);
  assert.ok(did.every((line) => !line.includes('cern_op_token')));
});
