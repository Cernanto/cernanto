// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLI_VERSION } from './version.js';

test("the cli's version is the package's", () => {
  assert.match(CLI_VERSION, /^\d+\.\d+\.\d+/);
});
