#!/usr/bin/env node
// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// Regenerates the cli's gateway client from the gateway's OpenAPI
// document: `cernanto/gateway/openapi.yaml` is the contract the
// gateway implements, and `cli/src/gateway/` is what the pinned
// type engine makes of it (types, one function per operation, the
// fetch client). The output is committed; `gateway-regen.test.ts`
// refuses a checkout whose generated files differ from a fresh
// generation.
//
//   node cli/scripts/regen-gateway.mjs        regenerate in place
//   node cli/scripts/regen-gateway.mjs <dir>  generate into <dir>

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DOCUMENT = join(ROOT, '..', 'cernanto', 'gateway', 'openapi.yaml');
export const OUTPUT = join(ROOT, 'src', 'gateway');

const HEADER = ['// Copyright (c) 2026 Cernanto.', '// SPDX-License-Identifier: Apache-2.0'];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Generates the gateway client into `outDir` (emptied first) and stamps
 * the repository's header onto every file, so the checkout's style
 * rule holds on generated code too. */
export async function regenerateGateway(outDir = OUTPUT) {
  // The engine is the cli's dev dependency, an ESM-only package: its
  // entry is read off its own export map, resolved from the package.
  const require = createRequire(join(ROOT, 'package.json'));
  const manifestPath = require.resolve('@hey-api/openapi-ts/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = join(dirname(manifestPath), manifest.exports['.'].import);
  const { createClient } = await import(pathToFileURL(entry).href);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  await createClient({
    input: DOCUMENT,
    // NodeNext resolution wants the `.js` on every relative import;
    // the engine's own tsconfig discovery stays off so the output is
    // the same bytes on every machine.
    output: { path: outDir, tsConfigPath: null, importFileExtension: '.js' },
    plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
    logs: { level: 'silent', path: join(outDir, '..', '.gateway-logs') },
  });
  rmSync(join(outDir, '..', '.gateway-logs'), { recursive: true, force: true });
  for (const path of walk(outDir)) {
    if (!path.endsWith('.ts')) continue;
    const text = readFileSync(path, 'utf8');
    if (text.startsWith(HEADER[0])) continue;
    // The engine's fetch runtime (client/, core/) is its own tested
    // code written against a looser tsconfig than this repository's
    // (exactOptionalPropertyTypes); it is imported for its behavior
    // and its types, never edited, so its diagnostics are silenced.
    // The surface files (types, sdk, index) stay fully checked.
    const folder = relative(outDir, path).split(sep)[0];
    const runtime = folder === 'client' || folder === 'core';
    const notice = runtime ? ['// @ts-nocheck'] : [];
    writeFileSync(path, `${[...HEADER, ...notice].join('\n')}\n${text}`);
  }
  return outDir;
}

const invoked =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const target = process.argv[2] === undefined ? OUTPUT : resolve(process.argv[2]);
  const out = await regenerateGateway(target);
  const files = [...walk(out)].filter((p) => p.endsWith('.ts')).length;
  process.stdout.write(`gateway client: ${String(files)} files under ${out}\n`);
}
