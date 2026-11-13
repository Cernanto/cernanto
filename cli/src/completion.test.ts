// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Command } from 'commander';

import { commandTree, completionScript } from './completion.js';

function program(): Command {
  const root = new Command('cernanto').option('-o, --output <format>');
  const auth = root.command('auth');
  auth.command('login').option('--from <file>');
  auth.command('list');
  root.command('ls').option('-w, --watch');
  return root;
}

test('the completion scripts follow the command tree', () => {
  const tree = commandTree(program());
  assert.deepEqual(
    tree.commands.map((child) => [child.name, child.commands.map((grand) => grand.name)]),
    [
      ['auth', ['login', 'list']],
      ['ls', []],
    ],
  );
  const zsh = completionScript(program(), 'zsh');
  assert.match(zsh, /^#compdef cernanto\n/);
  assert.match(zsh, /_cernanto_auth_login\(\)/);
  assert.match(zsh, /'--watch'/);
  const bash = completionScript(program(), 'bash');
  assert.match(bash, /"cernanto auth"\) words="login list" ;;/);
  assert.match(bash, /"cernanto ls"\) words="--watch -w" ;;/);
  assert.match(bash, /complete -F _cernanto cernanto/);
  assert.throws(() => completionScript(program(), 'fish'), /zsh or bash/);
});
