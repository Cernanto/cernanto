// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openInBrowser } from './open-url.js';

test('opening a url hands it whole to the opener, its query string with it', async () => {
  const opened: string[] = [];
  const url = 'http://127.0.0.1:7434/v1/oauth/consent?state=abc&client_id=def&scope=read';
  openInBrowser(url, (one) => {
    opened.push(one);
    return Promise.resolve();
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // A query string with its `&` reaches the opener as one word: a
  // shell would end its command at the first one.
  assert.deepEqual(opened, [url]);
});

test('a machine with no opener leaves the url to the operator: the process goes on', async () => {
  openInBrowser('http://127.0.0.1:7434/v1/oauth/consent?state=abc', () =>
    Promise.reject(new Error('this machine has no opener')),
  );
  openInBrowser('http://127.0.0.1:7434/v1/oauth/consent?state=abc', () => {
    throw new Error('the opener could not be started');
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
});
