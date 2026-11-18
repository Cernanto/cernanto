// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Command } from 'commander';

import { emptyHostWords, emptyVersionWords, registerCluster } from './cluster.js';

// The cluster group's words: upgrade with one version, the release the
// hosts upgrade to; drain with one host, told to let its copies go.

test('cluster is a group of two verbs, upgrade with a version and drain with a host', () => {
  const program = new Command('cernanto');
  registerCluster(program);
  const group = program.commands.find((command) => command.name() === 'cluster');
  assert.ok(group !== undefined, 'cluster registers');
  assert.equal(group.description(), "the operator's words on a plane of several servers");
  assert.deepEqual(
    group.commands.map((command) => command.name()),
    ['upgrade', 'drain'],
  );
  const upgrade = group.commands.find((command) => command.name() === 'upgrade');
  assert.ok(upgrade !== undefined);
  assert.deepEqual(
    upgrade.registeredArguments.map((arg) => [arg.name(), arg.required]),
    [['version', true]],
  );
  assert.equal(upgrade.description(), 'name the release the hosts upgrade to, one host at a time');
  assert.deepEqual(upgrade.options, []);
  const drain = group.commands.find((command) => command.name() === 'drain');
  assert.ok(drain !== undefined);
  assert.deepEqual(
    drain.registeredArguments.map((arg) => [arg.name(), arg.required]),
    [['host', true]],
  );
  assert.equal(
    drain.description(),
    'tell one host to let its copies go for the other hosts to take',
  );
  assert.deepEqual(drain.options, []);
  // The two verbs live in the group alone: no root verb duplicates them.
  assert.ok(!program.commands.some((command) => ['upgrade', 'drain'].includes(command.name())));
});

// The verbs refuse an empty argument in words, before any request.
test('an empty version or host is refused in words before any request', () => {
  assert.equal(emptyVersionWords(' '), 'a version is needed: cernanto cluster upgrade <version>');
  assert.equal(emptyVersionWords('0.3.0'), undefined);
  assert.equal(emptyHostWords(''), 'a host is needed: cernanto cluster drain <host>');
  assert.equal(emptyHostWords('core-a'), undefined);
});
