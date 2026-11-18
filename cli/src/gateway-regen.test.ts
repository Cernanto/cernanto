// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import { OUTPUT, regenerateGateway } from '../scripts/regen-gateway.mjs';

// The gateway client under src/gateway is generated from the gateway's
// OpenAPI document and committed: this proof regenerates it beside
// the checkout and refuses any difference, so a document edit that
// forgot `pnpm run regen:gateway`, or an edit by hand of a generated file,
// fails here instead of drifting the cli from the gateway.

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const path of walk(root)) files.set(relative(root, path), readFileSync(path, 'utf8'));
  return files;
}

test('the committed gateway client is what the document generates', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cern-gateway-'));
  try {
    const fresh = snapshot(await regenerateGateway(join(scratch, 'gateway')));
    const committed = snapshot(OUTPUT);
    assert.deepEqual(
      [...fresh.keys()],
      [...committed.keys()],
      'the generated file set differs from src/gateway; run: pnpm run regen:gateway',
    );
    for (const [name, text] of fresh) {
      assert.equal(
        committed.get(name),
        text,
        `src/gateway/${name} differs from a fresh generation; run: pnpm run regen:gateway`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("every generated file carries the cli's Apache header", () => {
  for (const path of walk(OUTPUT)) {
    if (!path.endsWith('.ts')) continue;
    const [first, second] = readFileSync(path, 'utf8').split('\n');
    assert.equal(first, '// Copyright (c) 2026 Cernanto.', path);
    assert.equal(second, '// SPDX-License-Identifier: Apache-2.0', path);
  }
});
