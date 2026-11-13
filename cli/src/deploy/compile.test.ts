// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Command } from 'commander';

import { composePackageManifest, writeCernPackage } from '@cernanto/package-format';

import { compileEnding, registerCompile } from './compile.js';

// The compile verb's words: stage one of the pipeline, the same flags
// as deploy where they mean the same thing, and the help lines a user
// reads; and its ending, the packages written with their cards.

function compileVerb(): Command {
  const program = new Command('cernanto');
  registerCompile(program);
  const verb = program.commands.find((command) => command.name() === 'compile');
  assert.ok(verb !== undefined, 'compile registers');
  return verb;
}

test('compile takes agent ids, compiles on the plane and writes the packages, nothing ships', () => {
  const verb = compileVerb();
  assert.equal(
    verb.description(),
    'compile an agent and write its package beside the spec; nothing ships',
  );
  assert.deepEqual(
    verb.registeredArguments.map((arg) => [arg.name(), arg.required, arg.variadic]),
    [['agent-ids', false, true]],
  );
});

test("compile's flags are the design's: the force flag, the contracts and the log's shape", () => {
  const verb = compileVerb();
  assert.deepEqual(
    verb.options.map((option) => option.long),
    [
      '--recompile',
      '--dry-run',
      '--contract',
      '--contracts',
      '--new-contract',
      '--no-ask',
      '--quiet',
      '--utc',
      '--output',
    ],
  );
  const words = new Map(verb.options.map((option) => [option.long ?? '', option.description]));
  assert.match(
    words.get('--no-ask') ?? '',
    /never wait for a login: when an agent asks for an account, end at once, name the login it needs and exit 3/,
  );
  assert.match(words.get('--recompile') ?? '', /compile again from the spec/);
  assert.match(
    words.get('--contract') ?? '',
    /use this declaration file as the one agent's contract/,
  );
  assert.match(
    words.get('--new-contract') ?? '',
    /the session writes a new contract from the spec/,
  );
  assert.match(words.get('--contracts') ?? '', /a JSON map of agent id to declaration file/);
  assert.match(
    words.get('--dry-run') ?? '',
    /the plan of each agent is printed, nothing is written/,
  );
});

test('a compile ends on where each package landed and, beneath it, the card of the package', () => {
  // The package a compile wrote, as it lies beside its spec in a
  // workspace: the ending prints its wrote line and the card contract
  // prints for the file, the contract compiled and not yet verified.
  const root = mkdtempSync(join(tmpdir(), 'compile-ending-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'cernanto.json'), '{}\n');
  const spec = '# Greeter\n\nGreets whoever asks, by name.\n';
  const contract = 'export declare function greet(input: { name: string }): Promise<string>;\n';
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), spec);
  const path = join(root, 'ops', '.cern', 'greeter.cern');
  writeFileSync(
    path,
    writeCernPackage({
      manifest: composePackageManifest({
        name: 'ops/greeter',
        version: '0.0.0',
        type: 'task',
        spec,
        contract,
        handlers: ['greet'],
        provenance: {},
      }),
      spec,
      contract,
      code: {
        'index.ts':
          'export async function greet(input: { name: string }) {\n  return input.name;\n}\n',
      },
      tests: {},
    }),
  );
  const written = [{ path, digest: `sha256:${'a'.repeat(64)}` }];
  const text = compileEnding(written, { agentsRoot: root, shell: 'posix' });
  assert.match(
    text,
    /^wrote .*greeter\.cern \(sha256:aaaaaaaaaaaa\.\.\.\)\n\nGreeter {3}ops\/greeter {3}agent {3}compiled {3}not verified\n/,
  );
  assert.match(text, /\n {2}call it: cernanto call ops\/greeter greet name=\.\.\.\n\n$/);
  // The quiet form leaves the digest off the wrote line.
  assert.match(
    compileEnding(written, { agentsRoot: root, quiet: true, shell: 'posix' }),
    /^wrote .*greeter\.cern\n\nGreeter /,
  );
  // A package that does not read ends on its wrote line; nothing
  // written is nothing said.
  const broken = join(root, 'ops', '.cern', 'broken.cern');
  writeFileSync(broken, 'not a package');
  assert.match(
    compileEnding([{ path: broken, digest: 'sha256:b' }], { agentsRoot: root }),
    /^wrote .*broken\.cern \(sha256:b\.\.\.\)\n$/,
  );
  assert.equal(compileEnding([], { agentsRoot: root }), '');
});
