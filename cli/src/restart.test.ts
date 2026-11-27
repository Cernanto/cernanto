// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Command } from 'commander';

import { registerRestart, restartedWords } from './restart.js';

// The restart verb's words: a service's, a worker's or a job's program
// runs again from the top. No verb starts or stops an agent besides it.

test('restart takes one agent id and no flag, and no start or stop verb stands beside it', () => {
  const program = new Command('cernanto');
  registerRestart(program);
  assert.deepEqual(
    program.commands.map((command) => command.name()),
    ['restart'],
  );
  const verb = program.commands[0];
  assert.ok(verb !== undefined);
  assert.deepEqual(
    verb.registeredArguments.map((arg) => [arg.name(), arg.required]),
    [['agent-id', true]],
  );
  assert.deepEqual(verb.options, []);
  assert.equal(
    verb.description(),
    "run a service's, a worker's or a job's program again from the top, with an empty memory",
  );
});

test('a restart names the agent and the run it asked for', () => {
  assert.equal(restartedWords('ops/ticker', { run: 3 }), 'ops/ticker runs again (run 3)\n');
  assert.equal(restartedWords('ops/ticker', {}), 'ops/ticker runs again\n');
});
