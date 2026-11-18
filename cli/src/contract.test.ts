// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  CernantoError,
  composePackageManifest,
  registryBlobPath,
  writeCernPackage,
} from '@cernanto/package-format';

import { CODE, CONTRACT, fakePlane, registryOf, treeWith } from './agent-package.fixture.js';
import { contractOfAgent, contractOfFile, contractOfRegistry, contractTarget } from './contract.js';
// The tables render this machine's time; the proof reads them in utc.
process.env['TZ'] = 'UTC';

test('the contract of a package names its kind from the manifest', () => {
  const page =
    '# Notice\n\nType: service\n\nUses: connectors/ntfy\n\nAnnounce an incident with connectors/ntfy.\n';
  const agentsRoot = mkdtempSync(join(tmpdir(), 'cli-contract-kind-'));
  const file = join(agentsRoot, 'notice.cern');
  writeFileSync(
    file,
    writeCernPackage({
      manifest: composePackageManifest({
        name: 'ops/notice',
        version: '0.0.0',
        type: 'service',
        spec: page,
        contract: CONTRACT,
        handlers: ['greet'],
        uses: { 'connectors/ntfy': { type: 'task' } },
        provenance: {},
      }),
      spec: page,
      contract: CONTRACT,
      code: { 'index.ts': CODE },
      tests: {},
    }),
  );
  const text = contractOfFile(file, {});
  assert.match(text, /\bstateful\b/);
  assert.match(text, /connectors\/ntfy/);
  assert.doesNotMatch(text, /free English|read as/);
});

test('the contract of a file prints its card, one line per fact, and verifies it locally', () => {
  const { agentsRoot, file } = treeWith();
  const text = contractOfFile(file, {});
  // The card a deployed agent gets, read off the package: the head says
  // the package is compiled and when it was verified, the functions
  // end on the call to paste; the file's own facts beneath.
  assert.match(
    text,
    /^Greeter {3}ops\/greeter {3}agent {3}compiled {3}verified live 2026-09-17 00:00:00\n/,
  );
  assert.match(
    text,
    /\ncompiled by {2}cernanto\/harness\/claude-code 2\.1\.250, model claude-opus-5 at medium effort, cernanto 0\.4\.0, doctrine 36\.0\.0\n/,
  );
  assert.match(text, /\n {2}call it: cernanto call ops\/greeter greet name=\.\.\.\n/);
  assert.match(text, /\nversion 0\.0\.0\npackage digest sha256:[0-9a-f]{64}\n/);
  assert.match(text, /\ncontent digest sha256:[0-9a-f]{64}\n/);
  assert.match(text, /\nGreeter\. Greets whoever asks, by name\.\n/);
  assert.match(text, /\nlicense MIT\ncopyright 2026 Acme\n/);
  assert.match(text, /\nnpm left-pad@1\.3\.0 \(asked as \^1\)\n/);
  assert.ok(text.endsWith('\nrecord verified: 5 files\n'), text);
  // As json, the manifest the package carries.
  const json = JSON.parse(contractOfFile(file, { output: 'json' })) as { name: string };
  assert.equal(json.name, 'ops/greeter');
  const edited = Buffer.from(readFileSync(file));
  const at = edited.indexOf(Buffer.from('hello ${input.name}'));
  edited.write('hullo ${input.name}', at);
  writeFileSync(join(agentsRoot, 'edited.cern'), edited);
  assert.throws(() => contractOfFile(join(agentsRoot, 'edited.cern'), {}), /corrupt or edited/);
});

test('the contract of a deployed agent renders its contract with its docs, and json is the row', async () => {
  const row = {
    agentId: 'domains/godaddy-check',
    uses: ['cernanto/auth'],
    verified: { at: '2026-08-20T10:00:00Z' },
    contract: [
      'export interface CheckInput {',
      '    /** The domain to check. */',
      '    domain: string;',
      '}',
      '/** Checks whether the domain is available. */',
      'export declare function check(args: CheckInput): Promise<boolean>;',
      '',
    ].join('\n'),
  };
  const client = fakePlane({
    describe: () => Promise.resolve({ agent: row }),
    rows: () => Promise.resolve([]),
    history: () =>
      Promise.resolve([
        {
          agentId: 'domains/godaddy-check',
          gen: 2,
          status: 'active',
          package: 'sha256:abcd',
          at: '2026-08-20T10:05:00Z',
        },
      ]),
  });
  assert.equal(
    await contractOfAgent(client, 'domains/godaddy-check', {}),
    [
      'Godaddy Check   domains/godaddy-check   stateful   deployed 2026-08-20 10:05:00   verified live 2026-08-20 10:00:00',
      'uses  cernanto/auth',
      '',
      '',
      'Check',
      '  Checks whether the domain is available.',
      '',
      '  takes',
      '    domain   text   The domain to check.',
      '',
      '  answers  yes or no',
      '',
      '  call it: cernanto call domains/godaddy-check check domain=...',
      '',
    ].join('\n'),
  );
  assert.equal(
    await contractOfAgent(client, 'domains/godaddy-check', { output: 'json' }),
    `${JSON.stringify(row, null, 2)}\n`,
  );
});

test("the contract lists the functions the agent's row says the plane serves", async () => {
  const row = {
    agentId: 'ops/greeter',
    uses: [],
    handlers: ['greet'],
    contract: [
      'export declare function greet(input: { name: string }): Promise<string>;',
      'export declare function isName(x: unknown): x is string | Promise<string>;',
      'export declare function part(input: { name: string }): Promise<string>;',
      '',
    ].join('\n'),
  };
  const client = fakePlane({
    describe: () => Promise.resolve({ agent: row }),
    rows: () => Promise.resolve([]),
  });
  const card = await contractOfAgent(client, 'ops/greeter', {});
  assert.match(card, /call it: cernanto call ops\/greeter greet /);
  assert.doesNotMatch(card, /call ops\/greeter (?:isName|part)\b/);
});

test('the contract explains a missing agent and an agent without a recorded contract', async () => {
  const missing = fakePlane({
    describe: () =>
      Promise.reject(
        new CernantoError({ kind: 'terminal', message: 'no agent "text/word-count"' }),
      ),
    rows: () => Promise.resolve([]),
  });
  await assert.rejects(
    contractOfAgent(missing, 'text/word-count', {}),
    /nothing is deployed as \"text\/word-count\" \(list what runs with: cernanto ls\)/,
  );
  const bare = fakePlane({
    describe: () => Promise.resolve({ agent: { agentId: 'ops/old' } }),
    rows: () => Promise.resolve([]),
  });
  await assert.rejects(contractOfAgent(bare, 'ops/old', {}), /no recorded contract for "ops\/old"/);
});

test("the contract lists an interface's implementors and its users from the fleet, and an agent that takes deliveries reads as any other", async () => {
  const row = {
    agentId: 'email/client',
    type: 'interface',
    uses: [],
    contract: [
      '/** One email to send. */',
      'export interface SendArgs {',
      '    to: string;',
      '}',
      '/** Sends one email. */',
      'export declare function send(args: SendArgs): Promise<boolean>;',
      '',
    ].join('\n'),
  };
  const client = fakePlane({
    describe: () => Promise.resolve({ agent: row }),
    rows: () =>
      Promise.resolve([
        {
          agentId: 'email/gmail',
          artifact: `sha256:${'a'.repeat(64)}`,
          handlers: ['send'],
          uses: [],
          implements: [{ id: 'email/client', contractSha: 'b'.repeat(64) }],
        },
        {
          agentId: 'text/chaser',
          artifact: `sha256:${'c'.repeat(64)}`,
          handlers: ['chase'],
          uses: ['email/client'],
        },
      ]),
  });
  const card = await contractOfAgent(client, 'email/client', {});
  assert.ok(card.includes('implemented by  email/gmail'), card);
  assert.ok(card.includes('used by         text/chaser'), card);
  const asked: unknown[] = [];
  const consumer = fakePlane({
    describe: (agentId: string) => {
      asked.push(['fleet', agentId]);
      return Promise.resolve({
        agent: {
          agentId: 'ops/sms-responder',
          uses: ['cernanto/webhook'],
          contract:
            'export declare function handleDelivery(delivery: { rawBody: string }): Promise<void>;\n',
        },
      });
    },
    rows: () => Promise.resolve([]),
  });
  const consumerCard = await contractOfAgent(consumer, 'ops/sms-responder', {});
  assert.ok(consumerCard.includes('handleDelivery'), consumerCard);
  assert.deepEqual(asked, [['fleet', 'ops/sms-responder']]);
});

test("the contract of a file names who uses it among the workspace's packages; a package without a stamp is not verified", () => {
  // A workspace: the marker at the root, greeter's package beside its
  // spec, and a caller whose package names greeter among its uses.
  const { agentsRoot, file } = treeWith();
  writeFileSync(join(agentsRoot, 'cernanto.json'), '{}\n');
  const callerSpec = '# Caller\n\nUses: ops/greeter\n\nGreets through ops/greeter.\n';
  writeFileSync(join(agentsRoot, 'ops', 'caller.cern.md'), callerSpec);
  const callerFile = join(agentsRoot, 'ops', '.cern', 'caller.cern');
  writeFileSync(
    callerFile,
    writeCernPackage({
      manifest: composePackageManifest({
        name: 'ops/caller',
        version: '0.0.0',
        type: 'task',
        spec: callerSpec,
        contract: CONTRACT,
        handlers: ['greet'],
        uses: { 'ops/greeter': { type: 'task' } },
        provenance: {},
      }),
      spec: callerSpec,
      contract: CONTRACT,
      code: { 'index.ts': CODE },
      tests: {},
    }),
  );
  const greeter = contractOfFile(file, {});
  assert.match(greeter, /^used by\s+ops\/caller$/m);
  // The caller: what it uses off its own manifest, and no stamp, as a
  // compile leaves a package before its deploy.
  const caller = contractOfFile(callerFile, {});
  assert.match(caller, /^Caller {3}ops\/caller {3}agent {3}compiled {3}not verified\n/);
  assert.match(caller, /^uses\s+ops\/greeter$/m);
  assert.doesNotMatch(caller, /^used by/m);
});

test('the contract of a registry package resolves the name, verifies the download and prints its card with the registry beneath', async () => {
  const registry = registryOf();
  const card = await contractOfRegistry(registry.client, 'ops/greeter', {});
  const lines = card.split('\n');
  assert.equal(
    lines[0],
    'Greeter   ops/greeter   agent   in the registry   verified live 2026-09-17 00:00:00',
  );
  assert.match(lines[1] ?? '', /^compiled by {2}cernanto\/harness\/claude-code/);
  assert.ok(card.includes('\n  call it: cernanto call ops/greeter greet name=...\n'), card);
  assert.ok(card.includes('\nversion 0.0.0\n'), card);
  assert.ok(card.includes('\nlicense MIT\n'), card);
  assert.ok(card.includes('\nregistry latest 0.0.0, 12 downloads, 1 star\n'), card);
  assert.ok(card.includes('\n  0.0.0  2026-10-09 08:00:00\n'), card);
  // A need the registry does not hold must be on the plane already.
  assert.ok(
    card.includes('\nnot in the registry: ops/base   (a deploy needs them on the plane)\n'),
    card,
  );
  assert.ok(card.includes('\ndeploy it with: cernanto deploy ops/greeter@0.0.0\n'), card);
  assert.ok(card.endsWith('\nrecord verified: 5 files\n'), card);
  // The blob was fetched once, after the index.
  assert.deepEqual(registry.hits.slice(0, 2), [
    'https://packages.test/index/v1/ops/greeter.json',
    `https://packages.test${registryBlobPath(registry.digest)}`,
  ]);
  const json = JSON.parse(
    await contractOfRegistry(registry.client, 'ops/greeter', { output: 'json' }),
  ) as { manifest: { name: string }; registry: { latest: string } };
  assert.equal(json.manifest.name, 'ops/greeter');
  assert.equal(json.registry.latest, '0.0.0');
  await assert.rejects(
    contractOfRegistry(registry.client, 'ops/greeter@^9.0.0', {}),
    /no version of ops\/greeter satisfies "\^9\.0\.0"; available: 0\.0\.0/,
  );
  await assert.rejects(
    contractOfRegistry(registry.client, 'ops/nothing', {}),
    /no package "ops\/nothing" in the registry/,
  );
  await assert.rejects(
    contractOfRegistry(registry.client, 'not a ref', {}),
    /not a package reference/,
  );
});

test("an installed agent's card says the registry's newer version, read quietly; none when the index has none or the latest is older", async () => {
  const row = {
    agentId: 'ops/greeter',
    uses: [],
    contract: CONTRACT,
    package: { digest: 'sha256:aa', version: '0.0.0', publisher: 'acme' },
  };
  const plane = fakePlane({
    describe: () => Promise.resolve({ agent: row }),
    rows: () => Promise.resolve([]),
  });
  const newer = await contractOfAgent(
    plane,
    'ops/greeter',
    {},
    registryOf({ latest: '0.1.0' }).client,
  );
  assert.equal(
    newer.split('\n')[1],
    'installed  0.0.0, published by acme; 0.1.0 available in the registry',
  );
  const same = await contractOfAgent(plane, 'ops/greeter', {}, registryOf().client);
  assert.equal(same.split('\n')[1], 'installed  0.0.0, published by acme');
  const unknown = registryOf();
  const other = await contractOfAgent(
    fakePlane({
      describe: () => Promise.resolve({ agent: { ...row, agentId: 'ops/other' } }),
      rows: () => Promise.resolve([]),
    }),
    'ops/other',
    {},
    unknown.client,
  );
  assert.equal(other.split('\n')[1], 'installed  0.0.0, published by acme');
  // Without a registry at hand the line stays as the row says.
  const offline = await contractOfAgent(plane, 'ops/greeter', {});
  assert.equal(offline.split('\n')[1], 'installed  0.0.0, published by acme');
});

test("the contract resolves one argument in the deploy's order: the plane, then the tree's package, then the registry; a version is the registry's", async () => {
  const { agentsRoot, file } = treeWith();
  const notDeployed = fakePlane({
    describe: () =>
      Promise.reject(new CernantoError({ kind: 'terminal', message: 'no agent "ops/greeter"' })),
    rows: () => Promise.resolve([]),
  });
  const registry = registryOf({ latest: '0.1.0' });
  const seams = {
    plane: () => notDeployed,
    registry: () => registry.client,
    agentsRoot: () => agentsRoot,
  };
  // Not deployed, in the tree: the file's card, compiled.
  const inTree = await contractTarget('ops/greeter', {}, seams);
  assert.ok(inTree.startsWith('Greeter   ops/greeter   agent   compiled   verified live'), inTree);
  assert.deepEqual(registry.hits, []);
  // The file itself, by its path.
  const byPath = await contractTarget(file, {}, seams);
  assert.equal(byPath, inTree);
  // A version always means the registry, whatever the tree holds.
  const pinned = await contractTarget('ops/greeter@0.1.0', {}, seams);
  assert.ok(pinned.startsWith('Greeter   ops/greeter   agent   in the registry'), pinned);
  assert.ok(pinned.includes('deploy it with: cernanto deploy ops/greeter@0.1.0\n'), pinned);
  // Neither deployed nor in the tree: the registry's latest.
  const elsewhere = {
    ...seams,
    agentsRoot: () => mkdtempSync(join(tmpdir(), 'cli-contract-empty-')),
  };
  const fromRegistry = await contractTarget('ops/greeter', {}, elsewhere);
  assert.ok(
    fromRegistry.startsWith('Greeter   ops/greeter   agent   in the registry'),
    fromRegistry,
  );
  assert.ok(
    fromRegistry.includes('deploy it with: cernanto deploy ops/greeter@0.1.0\n'),
    fromRegistry,
  );
  // Nowhere: one refusal naming the three places.
  const nowhere = fakePlane({
    describe: () =>
      Promise.reject(new CernantoError({ kind: 'terminal', message: 'no agent "ops/nothing"' })),
    rows: () => Promise.resolve([]),
  });
  await assert.rejects(
    contractTarget('ops/nothing', {}, { ...elsewhere, plane: () => nowhere }),
    /nothing is deployed as "ops\/nothing", no package of it is in the tree, and the registry has no package by that name/,
  );
  // A plane that runs the agent answers first, and its failure of any
  // other kind is its own.
  const broken = fakePlane({
    describe: () =>
      Promise.reject(new CernantoError({ kind: 'retryable', message: 'the plane is rolling' })),
    rows: () => Promise.resolve([]),
  });
  await assert.rejects(
    contractTarget('ops/greeter', {}, { ...seams, plane: () => broken }),
    /the plane is rolling/,
  );
});
