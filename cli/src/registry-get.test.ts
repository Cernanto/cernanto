// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  composePackageManifest,
  readCernPackage,
  registryBlobPath,
  writeCernPackage,
} from '@cernanto/package-format';
import type { PackageManifest } from '@cernanto/package-format';

import { OFFLINE_SEAMS, treeWith } from './agent-package.fixture.js';
import { foreignPackagePath, packageCurrency, treePackages } from './deploy/landing.js';
import { asHome } from './home.fixture.js';
import { RegistryClient } from './registry.js';
import { registryGet } from './registry-get.js';
import { extractSource } from './source.js';

// A get brings packages of the registry into a workspace as source. The
// proofs serve a registry of three packages in process (its summary,
// its indexes and its blobs), get from it into an empty folder, and
// read what lies there with the cli's own judge of a tree's package:
// a package got is one a deploy lands with nothing to compile.

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** What a proof's package carries beside its page: the files its code
 * is granted, the files its tests are granted, a document it
 * implements. */
interface Carried {
  files?: Record<string, string>;
  assets?: Record<string, string>;
  implements?: PackageManifest['implements'];
}

/** A package of the registry, as a publication stamps one. */
function pack(name: string, version: string, spec: string, carried: Carried = {}): Buffer {
  const contract = 'export declare function greet(): Promise<string>;\n';
  const assets = carried.assets ?? {};
  const tested = Object.keys(assets).length > 0;
  return writeCernPackage({
    manifest: composePackageManifest({
      name,
      version,
      type: 'task',
      spec,
      contract,
      handlers: ['greet'],
      files: Object.keys(carried.files ?? {}),
      ...(carried.implements === undefined ? {} : { implements: carried.implements }),
      ...(tested
        ? {
            tests: {
              uses: [],
              npm: {},
              assets: Object.fromEntries(
                Object.entries(assets).map(([path, text]) => [path, sha(text)]),
              ),
            },
          }
        : {}),
      publisher: 'acme',
      provenance: {},
    }),
    spec,
    contract,
    code: { 'index.ts': Buffer.from('export async function greet() { return "hello"; }\n') },
    tests: tested
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

/** A page that grants a folder, a file, a file from the workspace root
 * and a document it implements, and whose tests are granted a file. */
const GREETER = [
  '# Greeter',
  '',
  'Implements: openapi:greeter/openapi.yaml',
  '',
  'Uses:',
  '',
  '- file:greeter/prompts/',
  '- file:greeter/notes/reply.md',
  '- file:/shared/terms.md',
  '',
  'Greets whoever asks, by name.',
  '',
  '## Tests',
  '',
  'Uses:',
  '',
  '- file:greeter/samples/photo.png',
  '',
  'The photo is of a person.',
  '',
].join('\n');

const GREETER_CARRIES: Carried = {
  files: {
    'prompts/first.md': 'first',
    'prompts/rules/second.md': 'second',
    'reply.md': 'reply',
    'terms.md': 'terms',
    'openapi.yaml': 'openapi: 3.1.0',
  },
  assets: { 'photo.png': 'photo' },
  implements: [{ id: 'openapi:greeter/openapi.yaml', specHash: 'one', file: 'files/openapi.yaml' }],
};

const HELPER = '# Helper\n\nHelps the greeter.\n';
const THING = '# Thing\n\nDoes one thing.\n';

/** The registry of the proofs: the greeter at two versions and the
 * helper at the later one, both under `acme/desks/`, and a third
 * package outside that folder. Every request is recorded. */
function registryOf(extra: Record<string, Buffer[]> = {}): {
  client: RegistryClient;
  hits: string[];
} {
  const published: Record<string, Buffer[]> = {
    'acme/desks/greeter': [
      pack('acme/desks/greeter', '0.1.0', GREETER, GREETER_CARRIES),
      pack('acme/desks/greeter', '0.2.0', GREETER, GREETER_CARRIES),
    ],
    'acme/desks/helper': [pack('acme/desks/helper', '0.2.0', HELPER)],
    'acme/other/thing': [pack('acme/other/thing', '0.2.0', THING)],
    ...extra,
  };
  const files = new Map<string, Buffer | string>();
  const rows: Record<string, unknown>[] = [];
  for (const [name, versions] of Object.entries(published)) {
    const listed = versions.map((bytes) => {
      const pkg = readCernPackage(bytes);
      files.set(registryBlobPath(pkg.packageDigest), bytes);
      return {
        version: pkg.manifest.version,
        packageDigest: pkg.packageDigest,
        url: registryBlobPath(pkg.packageDigest),
        size: bytes.length,
        publishedAt: '2026-11-11T08:00:00.000Z',
        type: 'task',
        uses: [],
      };
    });
    const latest = listed.at(-1)?.version ?? '0.0.0';
    files.set(
      `/index/v1/${name}.json`,
      JSON.stringify({ indexFormat: 1, name, latest, versions: listed }),
    );
    rows.push({ name, latest, keywords: [], publishedAt: '2026-11-11T08:00:00.000Z' });
  }
  files.set(
    '/index/v1/packages.json',
    JSON.stringify({ indexFormat: 1, generatedAt: '2026-11-11T08:00:00.000Z', packages: rows }),
  );
  const hits: string[] = [];
  const fetchImpl = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const path = url.replace('https://packages.test', '');
    hits.push(path);
    const file = files.get(path);
    if (file === undefined) return Promise.resolve(new Response('', { status: 404 }));
    return Promise.resolve(
      new Response(typeof file === 'string' ? file : new Uint8Array(file), { status: 200 }),
    );
  }) as typeof fetch;
  return {
    client: new RegistryClient(
      { gateUrl: 'https://registry.test', indexUrl: 'https://packages.test' },
      undefined,
      fetchImpl,
    ),
    hits,
  };
}

/** An empty folder to get into, and the lines a get says. */
function workspace(): { root: string; lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return {
    root: mkdtempSync(join(tmpdir(), 'cli-get-')),
    lines,
    write: (line) => lines.push(line),
  };
}

/** Every file under a folder, by its path from it, sorted. */
function filesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else found.push(path);
    }
  };
  walk(root, '');
  return found.sort();
}

/** The cli's judgement of a tree's package: `current`, or why not. */
function judged(root: string, agentId: string): string {
  const state = packageCurrency(root, agentId, treePackages(root));
  return state.current ? (state.foreign === true ? 'installed' : 'current') : state.reason;
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

test('a get lays the page at the path its id names, the package beside it and every granted file where the page grants it, and the tree reads as current', async () => {
  const registry = registryOf();
  const { root, lines, write } = workspace();
  assert.deepEqual(await registryGet(registry.client, 'acme/desks/greeter', root, write), [
    'acme/desks/greeter',
  ]);
  assert.deepEqual(filesUnder(root), [
    'acme/desks/.cern/greeter.cern',
    'acme/desks/greeter.cern.md',
    'acme/desks/greeter/notes/reply.md',
    'acme/desks/greeter/openapi.yaml',
    'acme/desks/greeter/prompts/first.md',
    'acme/desks/greeter/prompts/rules/second.md',
    'acme/desks/greeter/samples/photo.png',
    'shared/terms.md',
  ]);
  // The page is the package's own, byte for byte, and the package is
  // the registry's latest as it serves it.
  assert.equal(readFileSync(join(root, 'acme/desks/greeter.cern.md'), 'utf8'), GREETER);
  const laid = readCernPackage(readFileSync(join(root, 'acme/desks/.cern/greeter.cern')));
  assert.equal(laid.manifest.version, '0.2.0');
  assert.equal(
    readFileSync(join(root, 'acme/desks/greeter/prompts/rules/second.md'), 'utf8'),
    'second',
  );
  assert.equal(readFileSync(join(root, 'shared/terms.md'), 'utf8'), 'terms');
  // The agent is the workspace's own, and a deploy of it compiles
  // nothing: the cli's judge calls its package current, a version and a
  // publisher stamped into it notwithstanding.
  assert.equal(judged(root, 'acme/desks/greeter'), 'current');
  assert.equal(existsSync(foreignPackagePath(root, 'acme/desks/greeter')), false);
  assert.deepEqual(lines, [
    'acme/desks/greeter 0.2.0  acme/desks/greeter.cern.md\n',
    '1 agent taken as source: it is yours in this workspace now, and a later version of the registry no longer lands over it\n',
    'deploy it with: cernanto deploy acme/desks/greeter\n',
  ]);
  // One package asks its own index and its own bytes, and no summary.
  assert.equal(registry.hits.includes('/index/v1/packages.json'), false);
  assert.equal(registry.hits.length, 2);
});

test('a get in a home folder is refused before the registry is asked, and writes nothing', async () => {
  const registry = registryOf();
  const { root: home, lines, write } = workspace();
  writeFileSync(join(home, 'letter.txt'), 'not an agent\n');
  await asHome(home, async () => {
    for (const argument of ['acme/desks/greeter', 'acme/']) {
      await assert.rejects(
        registryGet(registry.client, argument, home, write),
        /is your home folder, which is no workspace: a workspace is a folder that holds agents alone, and a command reads all of it; make a folder for your agents and run the command from there/,
        argument,
      );
    }
    assert.deepEqual(registry.hits, [], 'the registry was not asked');
    // A folder of its own below the home takes the same get.
    const own = join(home, 'agents');
    mkdirSync(own);
    assert.deepEqual(await registryGet(registry.client, 'acme/desks/greeter', own, write), [
      'acme/desks/greeter',
    ]);
  });
  assert.deepEqual(
    filesUnder(home).filter((path) => !path.startsWith('agents/')),
    ['letter.txt'],
  );
  assert.ok(lines.join('').includes('1 agent taken as source'));
});

test('a version or a range names the one to take', async () => {
  const registry = registryOf();
  const { root, write } = workspace();
  await registryGet(registry.client, 'acme/desks/greeter@0.1.0', root, write);
  assert.equal(
    readCernPackage(readFileSync(join(root, 'acme/desks/.cern/greeter.cern'))).manifest.version,
    '0.1.0',
  );
  assert.equal(judged(root, 'acme/desks/greeter'), 'current');
  const other = workspace();
  await registryGet(registry.client, 'acme/desks/greeter@^0.2.0', other.root, other.write);
  assert.equal(
    readCernPackage(readFileSync(join(other.root, 'acme/desks/.cern/greeter.cern'))).manifest
      .version,
    '0.2.0',
  );
});

test('a folder, named with its slash, brings every package under it at its latest, and no package beside it', async () => {
  const registry = registryOf();
  const { root, lines, write } = workspace();
  assert.deepEqual(await registryGet(registry.client, 'acme/desks/', root, write), [
    'acme/desks/greeter',
    'acme/desks/helper',
  ]);
  assert.equal(judged(root, 'acme/desks/greeter'), 'current');
  assert.equal(judged(root, 'acme/desks/helper'), 'current');
  assert.equal(existsSync(join(root, 'acme/other')), false);
  assert.deepEqual(lines.slice(-2), [
    '2 agents taken as source: they are yours in this workspace now, and a later version of the registry no longer lands over them\n',
    'deploy them with: cernanto deploy acme/desks/\n',
  ]);
  // The folder's names come from the summary, read once.
  assert.equal(registry.hits.filter((path) => path === '/index/v1/packages.json').length, 1);
  // A folder above takes what lies under it at any depth.
  const whole = workspace();
  assert.deepEqual(await registryGet(registry.client, 'acme/', whole.root, whole.write), [
    'acme/desks/greeter',
    'acme/desks/helper',
    'acme/other/thing',
  ]);
});

test('a folder asked at a version takes the packages that have one and says the ones that have none', async () => {
  const registry = registryOf();
  const { root, lines, write } = workspace();
  assert.deepEqual(await registryGet(registry.client, 'acme/desks/@0.1.0', root, write), [
    'acme/desks/greeter',
  ]);
  assert.equal(existsSync(join(root, 'acme/desks/helper.cern.md')), false);
  assert.deepEqual(lines, [
    'acme/desks/greeter 0.1.0  acme/desks/greeter.cern.md\n',
    'no version "0.1.0" of: acme/desks/helper\n',
    '1 agent taken as source: it is yours in this workspace now, and a later version of the registry no longer lands over it\n',
    'deploy it with: cernanto deploy acme/desks/\n',
  ]);
  await assert.rejects(
    registryGet(registry.client, 'acme/desks/@9.9.9', workspace().root, write),
    /no package under acme\/desks\/ has a version that satisfies "9\.9\.9"/,
  );
});

test('a get is all or nothing and over nothing: one refusal writes no file of any package', async () => {
  const registry = registryOf();
  // A page the workspace already holds is the reader's own agent.
  const held = workspace();
  put(held.root, 'acme/desks/helper.cern.md', '# My own helper\n');
  await assert.rejects(
    registryGet(registry.client, 'acme/desks/', held.root, held.write),
    /nothing was written:\n {2}acme\/desks\/helper already exists here as your local agent \(its spec is acme\/desks\/helper\.cern\.md\)/,
  );
  assert.deepEqual(filesUnder(held.root), ['acme/desks/helper.cern.md']);
  assert.deepEqual(held.lines, []);
  // A file that stands at another content is written over by nothing.
  const standing = workspace();
  put(standing.root, 'shared/terms.md', 'our own terms');
  await assert.rejects(
    registryGet(registry.client, 'acme/desks/', standing.root, standing.write),
    /shared\/terms\.md stands here with other content, and acme\/desks\/greeter would write over it/,
  );
  assert.deepEqual(filesUnder(standing.root), ['shared/terms.md']);
  // The same file at the very bytes is left, and the get goes through.
  put(standing.root, 'shared/terms.md', 'terms');
  await registryGet(registry.client, 'acme/desks/', standing.root, standing.write);
  assert.equal(judged(standing.root, 'acme/desks/greeter'), 'current');
  // A copy kept from a deploy by name is an installed package: the two
  // standings of one id never share a workspace.
  const kept = workspace();
  const copy = foreignPackagePath(kept.root, 'acme/desks/helper');
  mkdirSync(dirname(copy), { recursive: true });
  writeFileSync(copy, pack('acme/desks/helper', '0.2.0', HELPER));
  await assert.rejects(
    registryGet(registry.client, 'acme/desks/helper', kept.root, kept.write),
    /acme\/desks\/helper is kept here as an installed package, at \.cern\/acme--desks--helper\.cern/,
  );
  assert.equal(existsSync(join(kept.root, 'acme/desks/helper.cern.md')), false);
});

test('a package whose page grants a file outside the workspace, or that carries a file no grant names, is laid nowhere', async () => {
  const outside = '# Leaver\n\nUses: file:../../../leaked.txt\n\nLeaves.\n';
  const stray = '# Stray\n\nCarries more than it grants.\n';
  const registry = registryOf({
    'acme/odd/leaver': [
      pack('acme/odd/leaver', '0.2.0', outside, { files: { 'leaked.txt': 'x' } }),
    ],
    'acme/odd/stray': [pack('acme/odd/stray', '0.2.0', stray, { files: { 'extra.md': 'x' } })],
  });
  const { root, lines, write } = workspace();
  await assert.rejects(registryGet(registry.client, 'acme/odd/', root, write), (error: Error) => {
    assert.match(
      error.message,
      /acme\/odd\/leaver: the granted file \.\.\/\.\.\/\.\.\/leaked\.txt lies outside the workspace/,
    );
    assert.match(
      error.message,
      /acme\/odd\/stray: the granted file extra\.md is granted by no line of the page/,
    );
    return true;
  });
  assert.deepEqual(filesUnder(root), []);
  assert.deepEqual(lines, []);
  assert.equal(existsSync(join(dirname(dirname(root)), 'leaked.txt')), false);
});

test('an argument that names no package and no folder is refused in words, and so is a name the registry does not hold', async () => {
  const registry = registryOf();
  const { root, write } = workspace();
  for (const [argument, words] of [
    ['greeter', /"greeter" is not a package of the registry: name one, acme\/greeter, or a folder/],
    ['Acme/', /"Acme\/" is not a folder of the registry/],
    ['acme/desks/greeter@latest-ish', /"latest-ish" is not a version/],
    ['acme/desks/nobody', /no package "acme\/desks\/nobody" in the registry/],
    ['nobody/', /the registry has no package under nobody\//],
  ] as const) {
    await assert.rejects(registryGet(registry.client, argument, root, write), words, argument);
  }
  assert.deepEqual(filesUnder(root), []);
});

// The laying of a source is one rule for both verbs: `source --to`
// writes what a get lays, less the package, from any package it reads.
test('source --to writes the page and every file it names under a folder, from a package file, and lays no package', async () => {
  const { file } = treeWith(pack('acme/desks/greeter', '0.2.0', GREETER, GREETER_CARRIES));
  const folder = mkdtempSync(join(tmpdir(), 'source-to-'));
  const said = await extractSource(file, folder, {}, OFFLINE_SEAMS);
  const source = [
    'acme/desks/greeter.cern.md',
    'acme/desks/greeter/notes/reply.md',
    'acme/desks/greeter/openapi.yaml',
    'acme/desks/greeter/prompts/first.md',
    'acme/desks/greeter/prompts/rules/second.md',
    'acme/desks/greeter/samples/photo.png',
    'shared/terms.md',
  ];
  assert.deepEqual(filesUnder(folder), source);
  assert.equal(readFileSync(join(folder, 'acme/desks/greeter.cern.md'), 'utf8'), GREETER);
  assert.equal(readFileSync(join(folder, 'acme/desks/greeter/samples/photo.png'), 'utf8'), 'photo');
  // One line per file, the page first, then where the source lies.
  const lines = said.trimEnd().split('\n');
  assert.equal(lines[0], 'acme/desks/greeter.cern.md');
  assert.deepEqual(lines.slice(0, -1).sort(), source);
  assert.equal(
    lines.at(-1),
    `the source of acme/desks/greeter is in ${folder}: its page and the 6 files it names`,
  );
  // Run again over its own work it writes nothing and says the same;
  // as json, the folder and the files by their paths.
  assert.equal(await extractSource(file, folder, {}, OFFLINE_SEAMS), said);
  const asJson = JSON.parse(
    await extractSource(file, folder, { output: 'json' }, OFFLINE_SEAMS),
  ) as { agent: string; folder: string; files: string[] };
  assert.deepEqual(
    [asJson.agent, asJson.folder, [...asJson.files].sort()],
    ['acme/desks/greeter', folder, source],
  );
  // Over a file that stands with other content it is refused whole.
  const taken = mkdtempSync(join(tmpdir(), 'source-to-'));
  put(taken, 'shared/terms.md', 'theirs');
  await assert.rejects(
    extractSource(file, taken, {}, OFFLINE_SEAMS),
    /nothing was written:\n {2}shared\/terms\.md stands here with other content, and acme\/desks\/greeter would write over it/,
  );
  assert.deepEqual(filesUnder(taken), ['shared/terms.md']);
  // A page that names no file is its page alone.
  const { file: plain } = treeWith(pack('acme/desks/helper', '0.2.0', HELPER));
  const alone = mkdtempSync(join(tmpdir(), 'source-to-'));
  assert.equal(
    await extractSource(plain, alone, {}, OFFLINE_SEAMS),
    `acme/desks/helper.cern.md\nthe source of acme/desks/helper is in ${alone}: its page\n`,
  );
});
