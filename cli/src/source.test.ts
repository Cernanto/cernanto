// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CernantoError, readCernPackage } from '@cernanto/package-format';

import {
  OFFLINE_SEAMS,
  SPEC,
  fakePlane,
  packageBytes,
  registryOf,
  treeWith,
} from './agent-package.fixture.js';
import { sourceOf } from './source.js';

test('source prints the page as the package holds it, byte for byte, so a redirect writes the file it was compiled from', async () => {
  const bytes = packageBytes();
  const { file } = treeWith(bytes);
  const printed = await sourceOf(file, {}, OFFLINE_SEAMS);
  assert.equal(printed, SPEC);
  // The package was compiled from a page of this very sha: what the
  // cli's own judge holds a tree's page to.
  assert.equal(
    createHash('sha256').update(printed, 'utf8').digest('hex'),
    readCernPackage(bytes).manifest.specSha,
  );
  // As json, the page's text by its path in the package.
  assert.deepEqual(JSON.parse(await sourceOf(file, { output: 'json' }, OFFLINE_SEAMS)), {
    files: { 'agent.cern.md': SPEC },
  });
});

test('source of a deployed agent reads its package back by the digest its row names', async () => {
  const bytes = packageBytes();
  const digest = `sha256:${'d'.repeat(64)}`;
  const asked: string[] = [];
  const plane = fakePlane({
    describe: () =>
      Promise.resolve({ agent: { agentId: 'ops/greeter', uses: [], artifact: digest } }),
    packageGet: (wanted: string) => {
      asked.push(wanted);
      return Promise.resolve(bytes);
    },
  });
  assert.equal(await sourceOf('ops/greeter', {}, { ...OFFLINE_SEAMS, plane: () => plane }), SPEC);
  assert.deepEqual(asked, [digest]);
});

test("source resolves its argument as contract does: the tree's package when nothing is deployed, the registry for a version or when the tree holds none", async () => {
  const { agentsRoot } = treeWith();
  const notDeployed = fakePlane({
    describe: () =>
      Promise.reject(new CernantoError({ kind: 'terminal', message: 'no agent "ops/greeter"' })),
  });
  const registry = registryOf({ latest: '0.1.0' });
  const seams = {
    plane: () => notDeployed,
    registry: () => registry.client,
    agentsRoot: () => agentsRoot,
  };
  // An id nothing is deployed as is the tree's package, and the
  // registry is not asked.
  assert.equal(await sourceOf('ops/greeter', {}, seams), SPEC);
  assert.deepEqual(registry.hits, []);
  // A name with a version is the registry's, whatever the tree holds.
  assert.equal(await sourceOf('ops/greeter@0.1.0', {}, seams), SPEC);
  assert.ok(registry.hits.length > 0);
  // With no package of the id in the tree, the registry's latest.
  const elsewhere = {
    ...seams,
    agentsRoot: () => mkdtempSync(join(tmpdir(), 'cli-source-empty-')),
  };
  assert.equal(await sourceOf('ops/greeter', {}, elsewhere), SPEC);
});
