// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Command } from 'commander';

import { oneAgentWords, registerAgent } from './agent.js';

// The operator's one verb: `delete` removes an agent from the plane by its id.

function tree(): Command {
  const program = new Command('cernanto');
  registerAgent(program);
  return program;
}

function verb(program: Command, ...path: string[]): Command {
  let current = program;
  for (const name of path) {
    const next = current.commands.find((command) => command.name() === name);
    assert.ok(next !== undefined, `${path.join(' ')} registers`);
    current = next;
  }
  return current;
}

test("delete takes the agent's id, as every verb does, and removes it unless forced", () => {
  const program = tree();
  const remove = verb(program, 'delete');
  assert.deepEqual(remove.commands, [], 'delete takes no noun');
  assert.deepEqual(
    remove.registeredArguments.map((arg) => [arg.name(), arg.required]),
    [['agent-id', true]],
  );
  assert.deepEqual(
    remove.options.map((option) => option.long),
    ['--force'],
  );
  assert.match(remove.description(), /delete an agent from the plane/);
});

test('delete answers the noun it once took, and any other extra word, with the verb as it reads now', () => {
  assert.equal(
    oneAgentWords(['agent', 'ops/greeter']),
    "delete takes the agent's id alone: cernanto delete ops/greeter",
  );
  assert.equal(
    oneAgentWords(['ops/greeter', 'ops/mailer']),
    'delete takes one agent id, and 2 words were given: cernanto delete <agent-id>',
  );
  // An agent whose own id is the word is deleted like any other.
  const remove = verb(tree(), 'delete');
  assert.deepEqual(
    remove.registeredArguments.map((arg) => arg.name()),
    ['agent-id'],
  );
});
