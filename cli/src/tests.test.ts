// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AgentType } from '@cernanto/package-format';

import { OFFLINE_SEAMS, TEST, packageBytes, treeWith } from './agent-package.fixture.js';
import { testsOf } from './tests.js';

const BY_NAME = "import { test } from 'node:test';\ntest('greets by name', () => {});\n";

test('tests prints the tests the compile wrote, each under its path in the package', async () => {
  const { file } = treeWith(
    packageBytes({ tests: { 'greeter.test.ts': TEST, 'by-name.test.ts': BY_NAME } }),
  );
  assert.equal(
    await testsOf(file, {}, OFFLINE_SEAMS),
    `==== tests/by-name.test.ts ====\n${BY_NAME}==== tests/greeter.test.ts ====\n${TEST}`,
  );
  const json = JSON.parse(await testsOf(file, { output: 'json' }, OFFLINE_SEAMS)) as {
    files: Record<string, string>;
  };
  assert.deepEqual(json.files, {
    'tests/by-name.test.ts': BY_NAME,
    'tests/greeter.test.ts': TEST,
  });
});

test('a package without tests says why: the agents that implement an interface carry its tests, and a worker carries none', async () => {
  const cases: [AgentType, string][] = [
    ['interface', 'ops/greeter is an interface: the agents that implement it carry the tests\n'],
    ['worker', 'ops/greeter is a worker, and a worker carries no tests\n'],
    ['task', 'no tests in the package of ops/greeter\n'],
  ];
  for (const [type, words] of cases) {
    const { file } = treeWith(packageBytes({ type, tests: {} }));
    assert.equal(await testsOf(file, {}, OFFLINE_SEAMS), words, type);
    const json = JSON.parse(await testsOf(file, { output: 'json' }, OFFLINE_SEAMS)) as {
      files: Record<string, string>;
    };
    assert.deepEqual(json.files, {}, type);
  }
});
