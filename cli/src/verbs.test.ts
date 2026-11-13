// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Command } from 'commander';

import { compileProgram } from './program.js';

// The verb set is a designed table: a verb exists because a row below
// says so, with its name, its arguments and its flags. This proof walks
// the program the binary compiles and holds it to that table, verb by
// verb and flag by flag, so a new verb, alias or flag arrives with its
// row. The bare file form is the one default command.

/** One row of the table as the tree spells it: the leaf's path, its
 * arguments (`?` optional, `...` variadic) and its long flags. */
type Row = [path: string, args: string, flags: string];

const VERBS: Row[] = [
  // Plane and box
  ['dev', 'verb?', '--coder --data-dir --release-dir --port --registry'],
  ['login', 'url', '--token --name'],
  ['context', 'name?', ''],
  ['completion', 'shell', ''],
  ['config', 'agent? setting?', ''],
  ['token create', 'name', ''],
  ['token list', '', '--output --no-headers'],
  ['token revoke', 'name', ''],
  ['cluster upgrade', 'version', ''],
  ['cluster drain', 'host', ''],
  // Authoring
  [
    'compile',
    '...agent-ids?',
    '--recompile --dry-run --contract --contracts --new-contract --no-ask --quiet --utc --output',
  ],
  [
    'deploy',
    '...targets?',
    '--no-verify --follow --quiet --utc --recompile --dry-run --fail-fast --no-ask --contract --contracts --new-contract --no-deps --output',
  ],
  ['contract', 'agent-id-or-package', '--output'],
  ['code', 'agent-id-or-package', '--output'],
  ['tests', 'agent-id-or-package', '--output'],
  ['source', 'agent-id-or-package', '--output --to'],
  ['skill', '', '--global'],
  // Operating
  ['ls', 'agent-id?', '--output --no-headers --watch'],
  ['calls', 'agent-id?', '--limit --output --no-headers'],
  ['call', 'agent-id function ...args?', '--args --output --quiet --details --debug'],
  ['trace', 'call-id-or-agent', '--follow --backlog --raw --details --debug --output'],
  ['cancel', 'call-id', ''],
  ['delete', 'agent-id', '--force'],
  // Credentials
  ['auth list', 'agent?', '--output --no-headers'],
  ['auth login', 'agent? name?', '--all --from'],
  ['auth logout', 'agent name', ''],
  // Registry
  ['registry login', '', '--token-stdin'],
  ['registry logout', '', ''],
  ['registry whoami', '', ''],
  ['registry publish', 'agent-id@version-or-file', '--publisher --unverified'],
  ['registry search', '...query', ''],
  ['registry yank', 'ref', '--reason'],
  ['registry deprecate', 'name ...message', ''],
  ['registry token create', 'name', '--namespace --days'],
  ['registry token list', '', ''],
  ['registry token revoke', 'token-id', ''],
  ['registry namespace claim', 'namespace', ''],
  ['registry namespace list', '', ''],
  ['registry namespace add', 'namespace login', '--role'],
  ['registry namespace remove', 'namespace login', ''],
  ['registry get', 'name-or-folder', ''],
];

/** The bare file form: `cernanto ops/greeter.cern.md` deploys the file,
 * the default command commander falls back to. */
const DEFAULT_COMMAND = 'file';

function leaves(command: Command, path: string[]): Row[] {
  const name = [...path, command.name()].join(' ');
  const args = command.registeredArguments
    .map((arg) => `${arg.variadic ? '...' : ''}${arg.name()}${arg.required ? '' : '?'}`)
    .join(' ');
  const flags = command.options
    .map((option) => option.long ?? option.short ?? '')
    .filter((flag) => flag !== '')
    .join(' ');
  const own: Row[] = command.commands.length === 0 || args !== '' ? [[name, args, flags]] : [];
  return [...own, ...command.commands.flatMap((child) => leaves(child, [...path, command.name()]))];
}

function sorted(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => a[0].localeCompare(b[0]));
}

test("the verbs, their arguments and their flags are the table's, nothing more", () => {
  const program = compileProgram();
  const found = leaves(program, []).map(([path, args, flags]): Row => [
    path.replace(/^cernanto ?/, ''),
    args,
    flags,
  ]);
  const verbs = found.filter(([path]) => path !== DEFAULT_COMMAND);
  assert.deepEqual(sorted(verbs), sorted(VERBS));
  const fallback = found.find(([path]) => path === DEFAULT_COMMAND);
  assert.ok(fallback !== undefined, 'the bare file form is the default command');
  assert.equal(fallback[1], '...targets?');
});

test('the root carries the context override and the version flag only', () => {
  const program = compileProgram();
  assert.deepEqual(
    program.options.map((option) => option.long),
    ['--version', '--context'],
  );
});

test('no verb has an alias: every job has one name', () => {
  const walk = (command: Command): void => {
    assert.deepEqual(command.aliases(), [], `${command.name()} carries an alias`);
    for (const child of command.commands) walk(child);
  };
  walk(compileProgram());
});
