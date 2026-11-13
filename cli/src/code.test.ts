// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CernantoError } from '@cernanto/package-format';

import {
  CODE,
  OFFLINE_SEAMS,
  fakePlane,
  packageBytes,
  registryOf,
  treeWith,
} from './agent-package.fixture.js';
import { codeOf } from './code.js';

const HELPER = 'export function shout(text: string): string {\n  return text.toUpperCase();\n}\n';
const ABOUT = "export const about = 'greets';";

test('code prints every file the coder wrote, each under its path in the package, the entry module first', async () => {
  const { file } = treeWith(
    packageBytes({ code: { 'words.ts': HELPER, 'index.ts': CODE, 'about.ts': ABOUT } }),
  );
  assert.equal(
    await codeOf(file, {}, OFFLINE_SEAMS),
    `==== code/index.ts ====\n${CODE}==== code/about.ts ====\n${ABOUT}\n==== code/words.ts ====\n${HELPER}`,
  );
  // As json, each file's text by its path, as the package holds it.
  const json = JSON.parse(await codeOf(file, { output: 'json' }, OFFLINE_SEAMS)) as {
    files: Record<string, string>;
  };
  assert.deepEqual(Object.keys(json.files), ['code/index.ts', 'code/about.ts', 'code/words.ts']);
  assert.deepEqual(json.files, {
    'code/index.ts': CODE,
    'code/about.ts': ABOUT,
    'code/words.ts': HELPER,
  });
});

test('code of a deployed agent reads its package back by the digest its row names', async () => {
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
  assert.equal(
    await codeOf('ops/greeter', {}, { ...OFFLINE_SEAMS, plane: () => plane }),
    `==== code/index.ts ====\n${CODE}`,
  );
  assert.deepEqual(asked, [digest]);
  const bare = fakePlane({
    describe: () => Promise.resolve({ agent: { agentId: 'ops/greeter', uses: [] } }),
  });
  await assert.rejects(
    codeOf('ops/greeter', {}, { ...OFFLINE_SEAMS, plane: () => bare }),
    /ops\/greeter is deployed without a package to read/,
  );
});

test("code resolves its argument as contract does: the tree's package when nothing is deployed, the registry for a version or when the tree holds none", async () => {
  const { agentsRoot } = treeWith(packageBytes({ code: { 'index.ts': CODE, 'words.ts': HELPER } }));
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
  assert.equal(
    await codeOf('ops/greeter', {}, seams),
    `==== code/index.ts ====\n${CODE}==== code/words.ts ====\n${HELPER}`,
  );
  assert.deepEqual(registry.hits, []);
  assert.equal(await codeOf('ops/greeter@0.1.0', {}, seams), `==== code/index.ts ====\n${CODE}`);
  const elsewhere = {
    ...seams,
    agentsRoot: () => mkdtempSync(join(tmpdir(), 'cli-code-empty-')),
  };
  assert.equal(await codeOf('ops/greeter', {}, elsewhere), `==== code/index.ts ====\n${CODE}`);
});
