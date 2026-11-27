#!/usr/bin/env node
// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// Makes the UI's gateway client from the gateway's OpenAPI document,
// with the generator the cli uses and by the cli's own script, so the
// two clients are made alike. The output is derived and never
// committed: `src/gateway/` is made before every build, type-check
// and lint, and left as it is while the document has not moved.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOCUMENT, regenerateGateway } from '../../cli/scripts/regen-gateway.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'src', 'gateway');
const STAMP = join(OUTPUT, '.document');

const digest = createHash('sha256').update(readFileSync(DOCUMENT)).digest('hex');
const current = existsSync(STAMP) && readFileSync(STAMP, 'utf8') === digest;
if (!current) {
  await regenerateGateway(OUTPUT);
  writeFileSync(STAMP, digest);
  process.stdout.write(`gateway client: made under ${OUTPUT}\n`);
}
