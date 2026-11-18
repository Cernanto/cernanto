// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loginCommandFor, tokenRows } from './token.js';

test('the login command and the tokens table read as the operator pastes and reads them', () => {
  // One url and the token: what a minted token prints for the other
  // laptop or the pipeline's secret.
  assert.equal(
    loginCommandFor({ url: 'https://plane.acme.com', token: 'tok' }),
    'cernanto login https://plane.acme.com --token tok',
  );
  assert.equal(
    loginCommandFor({ url: 'http://10.0.1.10:7434', token: 'tok' }),
    'cernanto login http://10.0.1.10:7434 --token tok',
  );
  assert.deepEqual(
    tokenRows([
      { name: 'bob', createdAt: '2026-08-25T10:00:00.000Z' },
      {
        name: 'ci',
        createdAt: '2026-08-25T09:00:00.000Z',
        lastUsedAt: '2026-08-25T11:00:00.000Z',
        revokedAt: '2026-08-25T12:00:00.000Z',
      },
    ]),
    [
      ['bob', 'live', '2026-08-25T10:00:00.000Z', 'never'],
      [
        'ci',
        'revoked 2026-08-25T12:00:00.000Z',
        '2026-08-25T09:00:00.000Z',
        '2026-08-25T11:00:00.000Z',
      ],
    ],
  );
});
