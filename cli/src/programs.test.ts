// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ExecutionFailure,
  REMOVAL_RETRIES,
  execute,
  executeSync,
  homeEnvironment,
  npmCommand,
  renameHeld,
  usualToolFolders,
} from './programs.js';

// What the cli does on the machine it runs on, the same call on every
// system. One suite, run as it stands wherever the cli runs.

test('a program runs by its name, takes what it is handed on its input, and its failure carries its words', async () => {
  const said = await execute('node', ['-e', 'process.stdout.write("hi")']);
  assert.equal(said.stdout, 'hi');
  const echoed = await execute(
    'node',
    ['-e', 'process.stdin.on("data", (d) => process.stdout.write(String(d).toUpperCase()))'],
    { input: 'quiet' },
  );
  assert.equal(echoed.stdout, 'QUIET');
  await assert.rejects(
    execute('node', ['-e', 'process.stderr.write("no"); process.exit(3)']),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionFailure);
      assert.equal(error.code, 3);
      assert.match(error.stderr, /no/);
      return true;
    },
  );
  await assert.rejects(
    execute('node', ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 300 }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionFailure);
      assert.match(error.stderr, /did not end within 300ms/);
      return true;
    },
  );
  const sync = executeSync('node', ['-e', 'process.stdout.write("sync")'], { encoding: 'utf8' });
  assert.equal(sync.stdout, 'sync');
  // The field is spawnSync's: absent on success, never null.
  assert.ok(!('error' in sync));
  const missing = executeSync('no-such-program-xyz', [], { encoding: 'utf8' });
  assert.ok(missing.error instanceof Error);
});

test('npm runs under the node that runs the cli, its arguments last', async () => {
  const npm = npmCommand(['--version']);
  assert.equal(npm.args.at(-1), '--version');
  const said = await execute(npm.file, npm.args, { timeoutMs: 60_000 });
  assert.match(said.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('a rename of a held file is tried again for a moment, and a removal retries', () => {
  const root = mkdtempSync(join(tmpdir(), 'cern-rename-'));
  try {
    writeFileSync(join(root, 'a'), 'a');
    renameHeld(join(root, 'a'), join(root, 'b'));
    assert.equal(readFileSync(join(root, 'b'), 'utf8'), 'a');
    // A rename that fails for another reason fails at once, in the
    // system's own word.
    assert.throws(() => {
      renameHeld(join(root, 'nothing'), join(root, 'c'), 50);
    }, /ENOENT/);
    assert.deepEqual(Object.keys(REMOVAL_RETRIES).sort(), ['maxRetries', 'retryDelay']);
  } finally {
    rmSync(root, { recursive: true, force: true, ...REMOVAL_RETRIES });
  }
});

test("a home is named to a child under both names, and the usual folders of a coder's tool are one list on every system", () => {
  assert.deepEqual(homeEnvironment('/h'), { HOME: '/h', USERPROFILE: '/h' });
  const plain = usualToolFolders({});
  assert.deepEqual(plain, [
    join(homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]);
  // Where the environment names the folder npm installs a tool into
  // for the account, that folder is among them.
  const roaming = usualToolFolders({ APPDATA: join('C:', 'Users', 'a', 'AppData', 'Roaming') });
  assert.ok(roaming.includes(join('C:', 'Users', 'a', 'AppData', 'Roaming', 'npm')));
  assert.equal(roaming.length, plain.length + 1);
  assert.deepEqual(usualToolFolders({ APPDATA: '' }), plain, 'an empty word is no word');
});
