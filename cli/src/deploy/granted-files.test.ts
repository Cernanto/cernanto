// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { composePackageManifest, writeCernPackage } from '@cernanto/package-format';
import type { PackageManifest } from '@cernanto/package-format';
import { system } from '@cernanto/system';

import { packageCurrency, treePackages } from './landing.js';

// A package is current for the files its spec grants when it carries
// them all as the tree holds them: the files the code is granted, the
// document the agent implements and the files the tests are granted.
// The proofs compile a workspace and a package of its agent on disk, move
// one file at a time and read the cli's judgement.

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Writes a file under a root, its folders made. */
function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A package of `ops/greeter` compiled from a spec, carrying the granted
 * files and the tests' files given, each by its path in its folder. */
function packageOf(
  spec: string,
  carried: {
    files?: Record<string, string>;
    assets?: Record<string, string>;
    tests?: boolean;
    implements?: PackageManifest['implements'];
  },
): Buffer {
  const contract = 'export declare function greet(): Promise<string>;\n';
  const assets = carried.assets ?? {};
  const tests = carried.tests ?? Object.keys(assets).length > 0;
  return writeCernPackage({
    manifest: composePackageManifest({
      name: 'ops/greeter',
      version: '1.0.0',
      type: 'task',
      spec,
      contract,
      handlers: ['greet'],
      files: Object.keys(carried.files ?? {}),
      ...(carried.implements === undefined ? {} : { implements: carried.implements }),
      ...(tests
        ? {
            tests: {
              uses: [],
              npm: {},
              ...(Object.keys(assets).length === 0
                ? {}
                : {
                    assets: Object.fromEntries(
                      Object.entries(assets).map(([path, text]) => [path, sha(text)]),
                    ),
                  }),
            },
          }
        : {}),
      provenance: {},
    }),
    spec,
    contract,
    code: { 'index.ts': Buffer.from('export async function greet() { return "hello"; }\n') },
    tests: tests
      ? {
          'greeter.test.ts': Buffer.from('// the tests\n'),
          ...Object.fromEntries(
            Object.entries(assets).map(([path, text]) => [`assets/${path}`, Buffer.from(text)]),
          ),
        }
      : {},
    files: Object.fromEntries(
      Object.entries(carried.files ?? {}).map(([path, text]) => [path, Buffer.from(text)]),
    ),
    openapi: {},
    mcp: {},
  });
}

/** A workspace holding `ops/greeter` with its spec and its package. */
function workspaceOf(spec: string, pack: Buffer): string {
  const root = mkdtempSync(join(tmpdir(), 'granted-'));
  put(root, 'ops/greeter.cern.md', spec);
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', '.cern', 'greeter.cern'), pack);
  return root;
}

/** The cli's judgement of the workspace's one package: `current`, or
 * the reason it is not. */
function judged(root: string): string {
  const state = packageCurrency(root, 'ops/greeter', treePackages(root));
  return state.current ? 'current' : state.reason;
}

const GRANTING = [
  '# Greeter',
  '',
  'Uses: cernanto/decision, file:greeter/prompts/, file:greeter/notes/reply.md, file:/shared/terms.md',
  '',
  'Greets.',
  '',
].join('\n');

const GRANTED = {
  'prompts/first.md': 'first',
  'prompts/rules/second.md': 'second',
  'reply.md': 'reply',
  'terms.md': 'terms',
};

/** The workspace of the granting spec, its files as the package has them. */
function grantingWorkspace(): string {
  const root = workspaceOf(GRANTING, packageOf(GRANTING, { files: GRANTED }));
  put(root, 'ops/greeter/prompts/first.md', 'first');
  put(root, 'ops/greeter/prompts/rules/second.md', 'second');
  put(root, 'ops/greeter/notes/reply.md', 'reply');
  put(root, 'shared/terms.md', 'terms');
  return root;
}

test('a package is current when it carries every granted file as the tree holds it: a folder under its name, a file under its own, from the spec or from the root', () => {
  const root = grantingWorkspace();
  assert.equal(judged(root), 'current');
  // What a granted folder never gives a package changes nothing: a dot
  // name, node_modules, a link.
  put(root, 'ops/greeter/prompts/.DS_Store', 'finder');
  put(root, 'ops/greeter/prompts/node_modules/left/index.js', 'left');
  if (system.name !== 'windows') {
    symlinkSync(
      join(root, 'ops/greeter/notes/reply.md'),
      join(root, 'ops/greeter/prompts/linked.md'),
    );
  }
  assert.equal(judged(root), 'current');
});

test('a file added to a granted folder, one that moved and one that left each send the package to the compiler', () => {
  const added = grantingWorkspace();
  put(added, 'ops/greeter/prompts/rules/third.md', 'third');
  assert.equal(
    judged(added),
    'the granted file prompts/rules/third.md was added since the package was compiled',
  );
  const moved = grantingWorkspace();
  put(moved, 'ops/greeter/prompts/rules/second.md', 'second, reworded');
  assert.equal(
    judged(moved),
    'the granted file prompts/rules/second.md moved since the package was compiled',
  );
  const fromRoot = grantingWorkspace();
  put(fromRoot, 'shared/terms.md', 'other terms');
  assert.equal(judged(fromRoot), 'the granted file terms.md moved since the package was compiled');
  const left = grantingWorkspace();
  rmSync(join(left, 'ops/greeter/prompts/first.md'));
  assert.equal(judged(left), 'the granted file prompts/first.md is gone from the tree');
  const gone = grantingWorkspace();
  rmSync(join(gone, 'ops/greeter/notes/reply.md'));
  assert.equal(judged(gone), 'the granted file greeter/notes/reply.md is gone from the tree');
  // The judgement of the packages as they are leaves the files out.
  const state = packageCurrency(gone, 'ops/greeter', treePackages(gone), { asItIs: true });
  assert.equal(state.current, true);
});

test('a granted file is the one its grant names: another file of its name in the tree stands for nothing', () => {
  const root = grantingWorkspace();
  // The granted file moved, and a file of the same name elsewhere under
  // the agent's folder still holds the bytes the package carries.
  put(root, 'ops/greeter/notes/reply.md', 'reply, reworded');
  put(root, 'ops/greeter/drafts/reply.md', 'reply');
  put(root, 'ops/reply.md', 'reply');
  put(root, 'reply.md', 'reply');
  assert.equal(judged(root), 'the granted file reply.md moved since the package was compiled');
});

const TESTED = [
  '# Greeter',
  '',
  'Uses:',
  '',
  '- cernanto/decision',
  '- file:greeter/prompts/',
  '',
  'Greets.',
  '',
  '## Tests',
  '',
  'Uses:',
  '- file:greeter/samples/photo.png',
  '',
  '- file:greeter/samples/scans/',
  '',
  'The photo is a receipt.',
  '',
].join('\n');

/** The workspace of the tested spec, with the package given. */
function testedWorkspace(pack: Buffer): string {
  const root = workspaceOf(TESTED, pack);
  put(root, 'ops/greeter/prompts/first.md', 'first');
  put(root, 'ops/greeter/samples/photo.png', 'photo');
  put(root, 'ops/greeter/samples/scans/one.pdf', 'one');
  return root;
}

test("the files the Tests section grants are held to the tree as the code's are, for a package that carries tests", () => {
  const carried = {
    files: { 'prompts/first.md': 'first' },
    assets: { 'photo.png': 'photo', 'scans/one.pdf': 'one' },
  };
  assert.equal(judged(testedWorkspace(packageOf(TESTED, carried))), 'current');
  const moved = testedWorkspace(packageOf(TESTED, carried));
  put(moved, 'ops/greeter/samples/photo.png', 'another photo');
  assert.equal(
    judged(moved),
    "the tests' granted file photo.png moved since the package was compiled",
  );
  const added = testedWorkspace(packageOf(TESTED, carried));
  put(added, 'ops/greeter/samples/scans/two.pdf', 'two');
  assert.equal(
    judged(added),
    "the tests' granted file scans/two.pdf was added since the package was compiled",
  );
  const left = testedWorkspace(packageOf(TESTED, carried));
  rmSync(join(left, 'ops/greeter/samples/scans/one.pdf'));
  assert.equal(judged(left), 'the granted folder greeter/samples/scans/ holds no file');
  // A package compiled without its tests carries none of their files, and
  // is held to none.
  const untested = testedWorkspace(packageOf(TESTED, { files: { 'prompts/first.md': 'first' } }));
  assert.equal(judged(untested), 'current');
  put(untested, 'ops/greeter/samples/photo.png', 'another photo');
  assert.equal(judged(untested), 'current');
});

test('the document an agent implements is a granted file when it lies in the tree, and the compiler alone answers for one behind a url', () => {
  const local = ['# Greeter', '', 'Implements: openapi:./greeter/openapi.yaml', '', 'Greets.', ''];
  const inTree = workspaceOf(
    local.join('\n'),
    packageOf(local.join('\n'), {
      files: { 'openapi.yaml': 'openapi: 3.1.0' },
      implements: [
        { id: 'openapi:./greeter/openapi.yaml', specHash: 'one', file: 'files/openapi.yaml' },
      ],
    }),
  );
  put(inTree, 'ops/greeter/openapi.yaml', 'openapi: 3.1.0');
  assert.equal(judged(inTree), 'current');
  put(inTree, 'ops/greeter/openapi.yaml', 'openapi: 3.1.1');
  assert.equal(
    judged(inTree),
    'the granted file openapi.yaml moved since the package was compiled',
  );
  const remote = [
    '# Greeter',
    '',
    'Implements: openapi:https://example.com/greeter.yaml',
    '',
    'Greets.',
    '',
  ];
  const fetched = workspaceOf(
    remote.join('\n'),
    packageOf(remote.join('\n'), {
      files: { 'document.yaml': 'openapi: 3.1.0' },
      implements: [
        {
          id: 'openapi:https://example.com/greeter.yaml',
          specHash: 'one',
          file: 'files/document.yaml',
        },
      ],
    }),
  );
  assert.equal(judged(fetched), 'current');
});
