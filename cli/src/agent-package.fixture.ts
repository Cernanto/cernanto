// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composePackageManifest,
  readCernPackage,
  registryBlobPath,
  writeCernPackage,
} from '@cernanto/package-format';
import type { AgentType } from '@cernanto/package-format';

import type { ReadPlane, ReadSeams } from './agent-package.js';
import { RegistryClient } from './registry.js';

// The reading verbs' fixture: the package of a small agent with its
// spec, contract, code, tests and lock, the tree it lies in, and a
// registry of it served in process, for the proofs of `contract`,
// `code` and `tests`.

/** A plane of the given functions alone; a proof fakes what it reads. */
export function fakePlane(overrides: Partial<Record<keyof ReadPlane, unknown>>): ReadPlane {
  return overrides as unknown as ReadPlane;
}

/** Seams for a road that reads no plane, no registry and no tree: a
 * read of any of them fails the proof. */
export const OFFLINE_SEAMS: ReadSeams = {
  plane: () => {
    throw new Error('the plane was read');
  },
  registry: () => {
    throw new Error('the registry was read');
  },
  agentsRoot: () => {
    throw new Error('the tree was read');
  },
};

export const SPEC = '# Greeter\n\nUses: npm:left-pad\n\nGreets whoever asks, by name.\n';
export const CONTRACT =
  'export declare function greet(input: { name: string }): Promise<string>;\n';
export const CODE =
  'export async function greet(input: { name: string }): Promise<string> {\n  return `hello ${input.name}`;\n}\n';
export const TEST = "import { test } from 'node:test';\ntest('greets', () => {});\n";
const LOCK = JSON.stringify({
  name: 'x',
  lockfileVersion: 3,
  packages: {
    '': { dependencies: { 'left-pad': '1.3.0' } },
    'node_modules/left-pad': { version: '1.3.0' },
  },
});

/** What a proof varies in the greeter's package. */
export interface PackageShape {
  type?: AgentType;
  code?: Record<string, string>;
  tests?: Record<string, string>;
}

/** The greeter's package: a verified task by default, with one code
 * file and one test. */
export function packageBytes(shape: PackageShape = {}): Buffer {
  const type = shape.type ?? 'task';
  return writeCernPackage({
    manifest: composePackageManifest({
      name: 'ops/greeter',
      version: '0.0.0',
      type,
      spec: SPEC,
      contract: CONTRACT,
      handlers: ['greet'],
      npm: { 'left-pad': { grant: '^1', version: '1.3.0' } },
      license: 'MIT',
      copyright: ['2026 Acme'],
      provenance: {
        cernanto: '0.4.0',
        doctrine: '36.0.0',
        harness: {
          name: 'cernanto/harness/claude-code',
          cli: '2.1.250',
          model: 'claude-opus-5',
          effort: 'medium',
        },
        verified: { at: '2026-09-17T00:00:00.000Z' },
      },
    }),
    spec: SPEC,
    contract: CONTRACT,
    lock: LOCK,
    code: shape.code ?? { 'index.ts': CODE },
    tests: shape.tests ?? { 'greeter.test.ts': TEST },
  });
}

/** A tree holding the greeter's spec and its package beside it. */
export function treeWith(bytes: Buffer = packageBytes()): { agentsRoot: string; file: string } {
  const agentsRoot = mkdtempSync(join(tmpdir(), 'cli-read-'));
  mkdirSync(join(agentsRoot, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(agentsRoot, 'ops', 'greeter.cern.md'), SPEC);
  const file = join(agentsRoot, 'ops', '.cern', 'greeter.cern');
  writeFileSync(file, bytes);
  return { agentsRoot, file };
}

/** The greeter's package stamped with a version, as a publish stamps
 * it: the content stays, the package digest is the stamped one. */
export function stampedBytes(version: string): Buffer {
  const pkg = readCernPackage(packageBytes());
  return writeCernPackage({
    manifest: { ...pkg.manifest, version },
    spec: pkg.spec,
    ...(pkg.contract === undefined ? {} : { contract: pkg.contract }),
    ...(pkg.lock === undefined ? {} : { lock: pkg.lock }),
    code: pkg.code,
    tests: pkg.tests,
    files: pkg.files,
    openapi: pkg.openapi,
    mcp: pkg.mcp,
  });
}

/** A registry of the greeter, in process: the index, the stats and the
 * blobs of its package at 0.0.0 and at `latest`, served off a fetch
 * seam, with the hits recorded. */
export function registryOf(options: { latest?: string } = {}): {
  client: RegistryClient;
  hits: string[];
  digest: string;
} {
  const latest = options.latest ?? '0.0.0';
  const blobs = new Map<string, Buffer>();
  const version = (v: string) => {
    const bytes = stampedBytes(v);
    const digest = readCernPackage(bytes).packageDigest;
    blobs.set(registryBlobPath(digest), bytes);
    return {
      version: v,
      packageDigest: digest,
      url: registryBlobPath(digest),
      size: bytes.length,
      publishedAt: '2026-10-09T08:00:00.000Z',
      type: 'task',
      uses: ['ops/base'],
      license: 'MIT',
    };
  };
  const versions = latest === '0.0.0' ? [version('0.0.0')] : [version('0.0.0'), version(latest)];
  const index = { indexFormat: 1, name: 'ops/greeter', latest, versions };
  const hits: string[] = [];
  const fetchImpl = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    hits.push(url);
    const path = url.replace('https://packages.test', '');
    if (path === '/index/v1/ops/greeter.json') {
      return Promise.resolve(new Response(JSON.stringify(index), { status: 200 }));
    }
    if (path === '/stats/v1/ops/greeter.json') {
      return Promise.resolve(
        new Response(JSON.stringify({ downloads: 12, stars: 1 }), { status: 200 }),
      );
    }
    const blob = blobs.get(path);
    if (blob !== undefined) {
      return Promise.resolve(new Response(new Uint8Array(blob), { status: 200 }));
    }
    return Promise.resolve(new Response('', { status: 404 }));
  }) as typeof fetch;
  return {
    client: new RegistryClient(
      { gateUrl: 'https://registry.test', indexUrl: 'https://packages.test' },
      undefined,
      fetchImpl,
    ),
    hits,
    digest: versions[0]?.packageDigest ?? '',
  };
}
