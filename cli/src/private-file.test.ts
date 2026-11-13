// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { system } from '@cernanto/system';

import { writePrivateFile } from './private-file.js';

test("a credential file lands whole, under its owner's mode, in a folder made for the owner", () => {
  const folder = join(mkdtempSync(join(tmpdir(), 'private-')), 'cernanto');
  const file = join(folder, 'registry-auth.json');
  writePrivateFile(file, 'one\n');
  writePrivateFile(file, 'two\n');
  assert.equal(readFileSync(file, 'utf8'), 'two\n');
  // The temporary it was written under is gone: the folder holds the file alone.
  assert.deepEqual(readdirSync(folder), ['registry-auth.json']);
  if (system.name !== 'windows') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(folder).mode & 0o777, 0o700);
  }
});
