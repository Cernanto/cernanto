// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Command } from 'commander';

import { compileIdOf, emptyCallIdWords, registerCancel } from './cancel.js';

// The cancel verb's words: one call id, ended at its next step.

test('cancel takes one call id and says what ending it means', () => {
  const program = new Command('cernanto');
  registerCancel(program);
  const verb = program.commands.find((command) => command.name() === 'cancel');
  assert.ok(verb !== undefined, 'cancel registers');
  assert.deepEqual(
    verb.registeredArguments.map((arg) => [arg.name(), arg.required]),
    [['call-id', true]],
  );
  assert.equal(verb.description(), 'end a call: the agent stops at its next step');
  assert.deepEqual(verb.options, []);
});

// A compile's call id names its compile by its key; a plain call names none.
test('a compile call id names its compile, a plain call id names none', () => {
  assert.equal(
    compileIdOf('cernanto_compile:20002:k-compile-7f16baae49321f72'),
    'compile-7f16baae49321f72',
  );
  assert.equal(
    compileIdOf('basics_counter:20292:c-56f0ef0b-7685-4ac7-b9b9-ad34bcce3a74'),
    undefined,
  );
  assert.equal(compileIdOf('k-compile-abc'), 'compile-abc');
});

// The verb refuses an empty call id in words, before any request.
test('an empty call id is refused in words before any request', () => {
  assert.equal(emptyCallIdWords(''), 'a call id is needed: cernanto cancel <call-id>');
  assert.equal(emptyCallIdWords('   '), 'a call id is needed: cernanto cancel <call-id>');
  assert.equal(emptyCallIdWords('cernanto_compile:20002:k-compile-7f16baae49321f72'), undefined);
});
