// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { test } from 'node:test';

import {
  CernantoError,
  composePackageManifest,
  platformFolderEntries,
  platformReleaseBodyOf,
  platformReleaseBytes,
  readCernPackage,
  stampCernPackage,
  writeCernPackage,
} from '@cernanto/package-format';
import { system } from '@cernanto/system';

import { asHome } from '../home.fixture.js';
import {
  WORKSPACE_MARKER,
  agentsRootOf,
  assertWorkspace,
  entriesOf,
  expandFolders,
  folderSelection,
  isBareFileTarget,
  isPlatformAgent,
  keepPulledPackages,
  landPackages,
  landPlatformFolder,
  packageCurrency,
  readPlatformFolder,
  sha256Of,
  resolveAgentSelector,
  treePackages,
  unfitWorkspace,
  workspaceAgentIds,
  workspaceFolders,
  workspaceRootHint,
} from './landing.js';
import { noticeOf } from './landing.js';
import { fakeCompileClient } from './plane.fixture.js';
import { packWorkspace } from './upload.js';

const specOf = (title: string): string => `# ${title}\n\n\n${title}.\n`;

function packageOf(name: string, spec: string, uses: Record<string, string>): Buffer {
  const contract = `export declare function run(): Promise<{ ${name.replace('/', '_')}: number }>;\n`;
  return writeCernPackage({
    manifest: composePackageManifest({
      name,
      version: '1.0.0',
      type: 'task',
      spec,
      contract,
      handlers: ['run'],
      uses: Object.fromEntries(
        Object.entries(uses).map(([id, contractHash]) => [id, { type: 'task', contractHash }]),
      ),
      provenance: {},
    }),
    spec,
    contract,
    code: { 'index.ts': Buffer.from('export async function run() { return {}; }\n') },
    tests: {},
    files: {},
    openapi: {},
    mcp: {},
  });
}

test('a package is current for the page it was compiled from, by its sha, and for the files the page grants', () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-page-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  mkdirSync(join(root, 'ops', 'notes'), { recursive: true });
  const page =
    '# Notes\n\nUses:\n\n- file:notes/team.md\n\nAnswer a question from the file notes/team.md.\n';
  const contract = 'export declare function run(): Promise<string>;\n';
  const write = (team: string): void => {
    writeFileSync(
      join(root, 'ops', '.cern', 'notes.cern'),
      writeCernPackage({
        manifest: composePackageManifest({
          name: 'ops/notes',
          version: '1.0.0',
          type: 'task',
          spec: page,
          contract,
          handlers: ['run'],
          files: ['notes/team.md'],
          provenance: {},
        }),
        spec: page,
        contract,
        code: { 'index.ts': Buffer.from('export async function run() { return ""; }\n') },
        tests: {},
        files: { 'team.md': Buffer.from(team) },
        openapi: {},
        mcp: {},
      }),
    );
  };
  writeFileSync(join(root, 'ops', 'notes.cern.md'), page);
  writeFileSync(join(root, 'ops', 'notes', 'team.md'), 'the team\n');
  write('the team\n');
  assert.equal(packageCurrency(root, 'ops/notes', treePackages(root)).current, true);
  // The granted file is found through the label the page writes.
  writeFileSync(join(root, 'ops', 'notes', 'team.md'), 'the team, edited\n');
  assert.deepEqual(packageCurrency(root, 'ops/notes', treePackages(root)), {
    current: false,
    reason: 'the granted file team.md moved since the package was compiled',
  });
  // An edit of the page is a spec that moved.
  writeFileSync(join(root, 'ops', 'notes', 'team.md'), 'the team\n');
  writeFileSync(join(root, 'ops', 'notes.cern.md'), `${page}\nSay so when it is not there.\n`);
  assert.deepEqual(packageCurrency(root, 'ops/notes', treePackages(root)), {
    current: false,
    reason: 'its spec moved since the package was compiled',
  });
});

test('the tree road: a current package lands with its current dependencies, a stale one goes to the compile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-land-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  const hex = (text: string): string => createHash('sha256').update(text).digest('hex');
  // util: current; app uses util at util's contract: current; stale:
  // its spec moved after its package was written.
  writeFileSync(join(root, 'ops', 'util.cern.md'), specOf('Util'));
  const util = packageOf('ops/util', specOf('Util'), {});
  writeFileSync(join(root, 'ops', '.cern', 'util.cern'), util);
  const utilContract = readCernPackage(util).manifest.contractHash;
  assert.ok(utilContract);
  writeFileSync(join(root, 'ops', 'app.cern.md'), specOf('App'));
  writeFileSync(
    join(root, 'ops', '.cern', 'app.cern'),
    packageOf('ops/app', specOf('App'), { 'ops/util': utilContract }),
  );
  writeFileSync(join(root, 'ops', 'stale.cern.md'), specOf('Stale, moved'));
  writeFileSync(
    join(root, 'ops', '.cern', 'stale.cern'),
    packageOf('ops/stale', specOf('Stale'), {}),
  );
  const client = fakeCompileClient({ callId: 'inv-l', stream: [], doneAfter: 1 });
  const lines: string[] = [];
  const landing = await landPackages(client, ['ops/app', 'ops/stale'], {
    agentsRoot: root,
    onLine: (line) => lines.push(line),
  });
  // util lands before app, the one target that needs it; stale goes to
  // the compile with why.
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['ops/util', 'ops/app'],
  );
  assert.deepEqual(landing.toCompile, [
    { agentId: 'ops/stale', reason: 'its spec moved since the package was compiled' },
  ]);
  assert.deepEqual(
    client.landings.map((one) => [one.body.targets, one.body.installed]),
    [[client.landings[0]?.body.targets, undefined]],
    "the author's own packages land unmarked, in one landing",
  );
  assert.equal(client.landings[0]?.body.targets?.length, 2, 'util and app in one landing');
  assert.ok(lines.some((line) => line.startsWith('landed ops/util 1.0.0 (sha256:')));
  assert.ok(lines.some((line) => line.startsWith('landed ops/app 1.0.0 (sha256:')));
  assert.ok(
    lines.some(
      (line) => line === 'ops/stale: its spec moved since the package was compiled; compiling it\n',
    ),
  );
  assert.equal(client.submitted.length, 0, 'the landing submits no compile');
  // The bytes the store lacked were uploaded by digest.
  assert.equal(client.store.size, 2);
  assert.equal(hex(specOf('Util')), readCernPackage(util).manifest.specSha);
  // A dependency whose contract moved makes its dependent stale.
  writeFileSync(
    join(root, 'ops', '.cern', 'util.cern'),
    writeCernPackage({
      manifest: composePackageManifest({
        name: 'ops/util',
        version: '1.0.1',
        type: 'task',
        spec: specOf('Util'),
        contract: 'export declare function run(): Promise<{ moved: true }>;\n',
        handlers: ['run'],
        provenance: {},
      }),
      spec: specOf('Util'),
      contract: 'export declare function run(): Promise<{ moved: true }>;\n',
      code: { 'index.ts': Buffer.from('export async function run() { return {}; }\n') },
      tests: {},
      files: {},
      openapi: {},
      mcp: {},
    }),
  );
  const moved = await landPackages(client, ['ops/app'], { agentsRoot: root });
  assert.deepEqual(moved.landed, []);
  assert.deepEqual(moved.toCompile, [
    {
      agentId: 'ops/app',
      reason: 'ops/util moved: the package was compiled against another contract of it',
    },
  ]);
});

test('an interface lands before its implementors, and both before the package that uses it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-land-iface-'));
  mkdirSync(join(root, 'x', '.cern'), { recursive: true });
  const contract = 'export declare function serve(): Promise<{ ok: true }>;\n';
  const contractSha = createHash('sha256').update(contract).digest('hex');
  const write = (name: string, bytes: Buffer): void => {
    writeFileSync(join(root, 'x', `${name.split('/')[1] ?? name}.cern.md`), specOf(name));
    writeFileSync(join(root, 'x', '.cern', `${name.split('/')[1] ?? name}.cern`), bytes);
  };
  const packageWith = (
    name: string,
    type: 'interface' | 'module' | 'task',
    extra: { uses?: Record<string, string>; implements?: { id: string; contractSha: string }[] },
  ): Buffer =>
    writeCernPackage({
      manifest: composePackageManifest({
        name,
        version: '1.0.0',
        type,
        spec: specOf(name),
        contract,
        handlers: type === 'interface' ? [] : ['serve'],
        uses: Object.fromEntries(
          Object.entries(extra.uses ?? {}).map(([id, contractHash]) => [
            id,
            { type: 'interface', contractHash },
          ]),
        ),
        ...(extra.implements === undefined ? {} : { implements: extra.implements }),
        provenance: {},
      }),
      spec: specOf(name),
      contract,
      code:
        type === 'interface'
          ? {}
          : { 'index.ts': Buffer.from('export async function serve() { return { ok: true }; }\n') },
      tests: {},
      files: {},
      openapi: {},
      mcp: {},
    });
  write('x/backend', packageWith('x/backend', 'interface', {}));
  const backendContract = readCernPackage(readFileSync(join(root, 'x', '.cern', 'backend.cern')))
    .manifest.contractHash;
  assert.ok(backendContract);
  write(
    'x/native',
    packageWith('x/native', 'module', { implements: [{ id: 'x/backend', contractSha }] }),
  );
  write('x/user', packageWith('x/user', 'task', { uses: { 'x/backend': backendContract } }));
  const client = fakeCompileClient({ callId: 'inv-i', stream: [], doneAfter: 1 });
  const landing = await landPackages(client, ['x/user'], { agentsRoot: root });
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['x/backend', 'x/native', 'x/user'],
  );
});

test('a landing refused for the bytes the plane lacks uploads them and asks once more', async () => {
  // The plane holds the package's record and not its bytes (a removal
  // of the same digest landed between the existence read and the
  // ship) and names its cure: the landing uploads the bytes and lands.
  const root = mkdtempSync(join(tmpdir(), 'plane-land-retry-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'util.cern.md'), specOf('Util'));
  const util = packageOf('ops/util', specOf('Util'), {});
  writeFileSync(join(root, 'ops', '.cern', 'util.cern'), util);
  const base = fakeCompileClient({ callId: 'inv-r', stream: [], doneAfter: 1 });
  const digest = `sha256:${createHash('sha256').update(util).digest('hex')}`;
  base.store.set(digest, util);
  let refusals = 1;
  let puts = 0;
  const client = {
    ...base,
    packagePut: (wanted: string, bytes: Buffer) => {
      puts += 1;
      return base.packagePut(wanted, bytes);
    },
    land: (body: { target?: string; targets?: string[]; installed?: boolean }) => {
      if (refusals > 0) {
        refusals -= 1;
        return Promise.reject(
          new Error(
            'ops/util: the package catalog holds no tester artifact for ops/util; upload its complete .cern package',
          ),
        );
      }
      return base.land(body);
    },
  };
  const landing = await landPackages(client, ['ops/util'], {
    agentsRoot: root,
  });
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['ops/util'],
  );
  assert.equal(puts, 1, "the bytes were uploaded on the plane's word");
  assert.deepEqual(landing.toCompile, []);
});

test("a package whose bytes left between the existence read and the landing is uploaded on the plane's other word", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-cure-gone-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'util.cern.md'), specOf('Util'));
  const util = packageOf('ops/util', specOf('Util'), {});
  writeFileSync(join(root, 'ops', '.cern', 'util.cern'), util);
  const base = fakeCompileClient({ callId: 'inv-r', stream: [], doneAfter: 1 });
  const digest = `sha256:${createHash('sha256').update(util).digest('hex')}`;
  base.store.set(digest, util);
  let refusals = 1;
  let puts = 0;
  const client = {
    ...base,
    packagePut: (wanted: string, bytes: Buffer) => {
      puts += 1;
      return base.packagePut(wanted, bytes);
    },
    land: (body: { target?: string; targets?: string[]; installed?: boolean }) => {
      if (refusals > 0) {
        refusals -= 1;
        return Promise.reject(
          new Error(`ops/util: ${digest} is not a package the plane holds; upload it first`),
        );
      }
      return base.land(body);
    },
  };
  const landing = await landPackages(client, ['ops/util'], {
    agentsRoot: root,
  });
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['ops/util'],
  );
  assert.equal(puts, 1, "the bytes were uploaded on the plane's word");
  assert.deepEqual(landing.toCompile, []);
});

test("a package whose bytes left before the admission's catalog read is uploaded on the admission's word; another artifact's absence is no cure", async () => {
  // A delete's retirement removes the package between the landing's
  // read of it and the admission's catalog read, which names the
  // landed artifact by its first nineteen characters.
  const root = mkdtempSync(join(tmpdir(), 'plane-cure-catalog-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'util.cern.md'), specOf('Util'));
  const util = packageOf('ops/util', specOf('Util'), {});
  writeFileSync(join(root, 'ops', '.cern', 'util.cern'), util);
  const digest = `sha256:${createHash('sha256').update(util).digest('hex')}`;
  const landedWith = async (refusal: string): Promise<{ landed: string[]; puts: number }> => {
    const base = fakeCompileClient({ callId: 'inv-c', stream: [], doneAfter: 1 });
    base.store.set(digest, util);
    let refusals = 1;
    let puts = 0;
    const client = {
      ...base,
      packagePut: (wanted: string, bytes: Buffer) => {
        puts += 1;
        return base.packagePut(wanted, bytes);
      },
      land: (body: { target?: string; targets?: string[]; installed?: boolean }) => {
        if (refusals > 0) {
          refusals -= 1;
          return Promise.reject(new Error(refusal));
        }
        return base.land(body);
      },
    };
    const landing = await landPackages(client, ['ops/util'], { agentsRoot: root });
    return { landed: landing.landed.map((one) => one.agentId), puts };
  };
  const cured = await landedWith(
    `ops/util: artifact ${digest.slice(0, 19)} is not in the package catalog; redeploy it with: cernanto deploy ops/util`,
  );
  assert.deepEqual(cured.landed, ['ops/util']);
  assert.equal(cured.puts, 1, "the bytes were uploaded on the admission's word");
  const other = await landedWith(
    'ops/util: tester artifact sha256:0123456789ab is not in the package catalog; redeploy it with: cernanto deploy ops/util',
  );
  assert.deepEqual(other.landed, [], "another artifact's absence is the landing's own refusal");
  assert.equal(other.puts, 0);
});

test('a landing the plane refuses hands the target to the compile; a verified deploy takes an unstamped row on', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-refuse-'));
  mkdirSync(join(root, 'a', '.cern'), { recursive: true });
  writeFileSync(join(root, 'a', 'a.cern.md'), specOf('A'));
  writeFileSync(join(root, 'a', '.cern', 'a.cern'), packageOf('a/a', specOf('A'), {}));
  const client = fakeCompileClient({ callId: 'inv-r', stream: [], doneAfter: 1 });
  client.refusals.set('a/a', 'the plane says no');
  const lines: string[] = [];
  const refused = await landPackages(client, ['a/a'], {
    agentsRoot: root,
    onLine: (line) => lines.push(line),
  });
  assert.deepEqual(refused.toCompile, [{ agentId: 'a/a', reason: 'the plane says no' }]);
  assert.ok(lines.includes('a/a: the plane says no; compiling it\n'));
  // A verified deploy: a landed target whose row carries no verified
  // stamp goes on to the compile, where the plane re-gates the held
  // package and runs its tests.
  client.refusals.clear();
  client.rows = () =>
    Promise.resolve([{ agentId: 'a/a', artifact: 'sha256:x', handlers: ['run'], uses: [] }]);
  const verified = await landPackages(client, ['a/a'], {
    agentsRoot: root,
    verify: true,
  });
  assert.deepEqual(
    verified.landed.map((one) => one.agentId),
    ['a/a'],
  );
  assert.deepEqual(verified.toCompile, [{ agentId: 'a/a', reason: 'deployed, not verified' }]);
  // A worker or an interface never carries a stamp (a worker's run is
  // its proof, an interface runs nothing), so a verified deploy leaves
  // such a row as it landed instead of recompiling it every time.
  for (const type of ['worker', 'interface'] as const) {
    client.rows = () =>
      Promise.resolve([{ agentId: 'a/a', artifact: 'sha256:x', handlers: [], uses: [], type }]);
    const proven = await landPackages(client, ['a/a'], {
      agentsRoot: root,
      verify: true,
    });
    assert.deepEqual(proven.toCompile, [], `a ${type} row without a stamp stays landed`);
  }
});

test("a foreign package in the root's .cern folder lands as a third party's, and a command above the workspace root is refused with where to run", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-foreign-'));
  mkdirSync(join(root, '.cern'), { recursive: true });
  // A registry package, kept in the root's .cern/ with no spec beside it.
  writeFileSync(
    join(root, '.cern', 'acme-greeter.cern'),
    packageOf('acme/greeter', specOf('G'), {}),
  );
  const tree = treePackages(root);
  assert.equal(tree.packages['acme/greeter']?.foreign, true);
  const currency = packageCurrency(root, 'acme/greeter', tree);
  assert.ok(currency.current && currency.foreign === true);
  const client = fakeCompileClient({ callId: 'inv-f', stream: [], doneAfter: 1 });
  const landing = await landPackages(client, ['acme/greeter'], {
    agentsRoot: root,
  });
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['acme/greeter'],
  );
  assert.deepEqual(
    client.landings.map((one) => one.body.installed),
    [true],
  );
  // The repository above a workspace: the id the directory gives is
  // longer than the one the package names, and the command says where
  // to run instead of compiling everything under wrong ids.
  const above = mkdtempSync(join(tmpdir(), 'plane-above-'));
  mkdirSync(join(above, 'platform', 'ops', '.cern'), { recursive: true });
  writeFileSync(join(above, 'platform', 'ops', 'x.cern.md'), specOf('X'));
  writeFileSync(
    join(above, 'platform', 'ops', '.cern', 'x.cern'),
    packageOf('ops/x', specOf('X'), {}),
  );
  assert.equal(workspaceRootHint('platform/ops/x', 'ops/x'), 'platform');
  assert.equal(workspaceRootHint('ops/x', 'ops/x'), undefined);
  const judged = packageCurrency(above, 'platform/ops/x', treePackages(above));
  assert.ok(!judged.current);
  assert.match(judged.reason, /run cernanto from platform\//);
  await assert.rejects(
    landPackages(client, ['platform/ops/x'], { agentsRoot: above }),
    /platform\/ops\/x: its package names ops\/x: this directory is above the workspace; run cernanto from platform\//,
  );
});

test('the workspace is the nearest folder above the command that holds the marker, else the directory the command runs from', () => {
  const flat = mkdtempSync(join(tmpdir(), 'root-flat-'));
  assert.equal(agentsRootOf(flat), flat);
  mkdirSync(join(flat, 'agents'));
  assert.equal(agentsRootOf(flat), flat, 'a folder named agents is a folder like any other');
  // A marker above: the ids are the paths from it, wherever the command runs.
  const repo = mkdtempSync(join(tmpdir(), 'root-marked-'));
  writeFileSync(join(repo, WORKSPACE_MARKER), '{"version": 1, "folders": ["cernanto"]}\n');
  mkdirSync(join(repo, 'cernanto', 'compile'), { recursive: true });
  writeFileSync(join(repo, 'cernanto', 'decision.cern.md'), specOf('Decision'));
  writeFileSync(join(repo, 'cernanto', 'compile.cern.md'), specOf('Compile'));
  writeFileSync(join(repo, 'cernanto', 'compile', 'plan.cern.md'), specOf('Plan'));
  mkdirSync(join(repo, 'tests', 'fixtures'), { recursive: true });
  writeFileSync(join(repo, 'tests', 'fixtures', 'echo.cern.md'), specOf('Echo'));
  mkdirSync(join(repo, 'agents', 'examples', 'basics'), { recursive: true });
  writeFileSync(join(repo, 'agents', WORKSPACE_MARKER), '{"version": 1}\n');
  writeFileSync(join(repo, 'agents', 'examples', 'basics', 'counter.cern.md'), specOf('Counter'));
  assert.equal(agentsRootOf(repo), repo);
  assert.equal(agentsRootOf(join(repo, 'cernanto', 'compile')), repo);
  assert.equal(agentsRootOf(join(repo, 'tests')), repo);
  // The listed folders are the workspace: a spec elsewhere under the
  // root is not an agent of it, and a nested workspace is its own.
  assert.deepEqual(workspaceAgentIds(repo), [
    'cernanto/compile',
    'cernanto/compile/plan',
    'cernanto/decision',
  ]);
  assert.deepEqual(workspaceFolders(repo), [join(repo, 'cernanto')]);
  assert.equal(agentsRootOf(join(repo, 'agents', 'examples', 'basics')), join(repo, 'agents'));
  assert.deepEqual(workspaceAgentIds(join(repo, 'agents')), ['examples/basics/counter']);
  // A marker without folders: the whole folder, minus nested workspaces.
  const whole = mkdtempSync(join(tmpdir(), 'root-whole-'));
  writeFileSync(join(whole, WORKSPACE_MARKER), '{"version": 1}\n');
  mkdirSync(join(whole, 'ops', 'inner'), { recursive: true });
  writeFileSync(join(whole, 'ops', 'x.cern.md'), specOf('X'));
  writeFileSync(join(whole, 'ops', 'inner', WORKSPACE_MARKER), '{"version": 1}\n');
  writeFileSync(join(whole, 'ops', 'inner', 'y.cern.md'), specOf('Y'));
  assert.deepEqual(workspaceAgentIds(whole), ['ops/x']);
  assert.deepEqual(workspaceAgentIds(join(whole, 'ops', 'inner')), ['y']);
  // A marker that does not read is named, not guessed around.
  const broken = mkdtempSync(join(tmpdir(), 'root-broken-'));
  writeFileSync(join(broken, WORKSPACE_MARKER), '{"folders": "cernanto"}\n');
  assert.throws(
    () => workspaceAgentIds(broken),
    /"folders" lists the workspace's folders as strings/,
  );
});

test('a folder argument selects every spec under it; an agent beside its own folder stays an agent', () => {
  const repo = mkdtempSync(join(tmpdir(), 'folder-select-'));
  writeFileSync(join(repo, WORKSPACE_MARKER), '{"version": 1, "folders": ["cernanto"]}\n');
  mkdirSync(join(repo, 'cernanto', 'compile'), { recursive: true });
  mkdirSync(join(repo, 'cernanto', 'decision', 'prompts'), { recursive: true });
  writeFileSync(join(repo, 'cernanto', 'decision.cern.md'), specOf('Decision'));
  writeFileSync(join(repo, 'cernanto', 'compile.cern.md'), specOf('Compile'));
  writeFileSync(join(repo, 'cernanto', 'compile', 'plan.cern.md'), specOf('Plan'));
  writeFileSync(join(repo, 'cernanto', 'compile', 'gates.cern.md'), specOf('Gates'));
  mkdirSync(join(repo, 'cli'));
  // The folder, with or without its slash, from the root or from below it.
  assert.deepEqual(folderSelection('cernanto/', repo), [
    'cernanto/compile',
    'cernanto/compile/gates',
    'cernanto/compile/plan',
    'cernanto/decision',
  ]);
  assert.deepEqual(folderSelection('cernanto', repo), folderSelection('cernanto/', repo));
  assert.deepEqual(
    folderSelection('cernanto/', join(repo, 'cli')),
    folderSelection('cernanto/', repo),
  );
  assert.deepEqual(folderSelection('./', join(repo, 'cernanto', 'compile')), [
    'cernanto/compile/gates',
    'cernanto/compile/plan',
  ]);
  // An agent's own folder names the agent; its slash form names the folder.
  assert.equal(folderSelection('cernanto/decision', repo), undefined);
  assert.deepEqual(folderSelection('cernanto/decision/', repo), []);
  assert.equal(folderSelection('cernanto/compile', repo), undefined);
  assert.deepEqual(folderSelection('cernanto/compile/', repo), [
    'cernanto/compile/gates',
    'cernanto/compile/plan',
  ]);
  // An id, a file and a registry reference are not folders.
  assert.equal(folderSelection('cernanto/compile/plan', repo), undefined);
  assert.equal(folderSelection('cernanto/decision.cern.md', repo), undefined);
  assert.equal(folderSelection('acme/mailer@^2', repo), undefined);
  assert.equal(folderSelection('missing', repo), undefined);
  assert.deepEqual(expandFolders(['cernanto/compile/', 'cernanto/decision'], repo), [
    'cernanto/compile/gates',
    'cernanto/compile/plan',
    'cernanto/decision',
  ]);
  assert.throws(
    () => expandFolders(['cernanto/decision/'], repo),
    /no specs under cernanto\/decision\//,
  );
  assert.throws(() => expandFolders(['missing/'], repo), /no specs under missing\//);
});

test('resolveAgentSelector reads a tab-completed spec file as its agent id', () => {
  const root = mkdtempSync(join(tmpdir(), 'selector-'));
  mkdirSync(join(root, 'domains'), { recursive: true });
  writeFileSync(join(root, 'domains', 'godaddy-check.cern.md'), '# spec\n');
  mkdirSync(join(root, 'ops', 'mailer'), { recursive: true });
  writeFileSync(join(root, 'ops', 'mailer', 'agent.cern.md'), '# spec\n');
  // The tab-completed file form, at the workspace root.
  assert.equal(
    resolveAgentSelector('domains/godaddy-check.cern.md', root),
    'domains/godaddy-check',
  );
  // A spec named agent is an agent named agent: there is no directory layout.
  assert.equal(resolveAgentSelector('ops/mailer/agent.cern.md', root), 'ops/mailer/agent');
  // A spec path that is not on disk still strips the extension.
  assert.equal(resolveAgentSelector('ops/other.cern.md', root), 'ops/other');
  // A plain markdown file is not a spec: the argument passes through untouched.
  assert.equal(resolveAgentSelector('ops/other.md', root), 'ops/other.md');
  // An id passes through untouched.
  assert.equal(resolveAgentSelector('domains/godaddy-check', root), 'domains/godaddy-check');
  // The bare file form: an existing spec or package file, never a word.
  assert.equal(isBareFileTarget('domains/godaddy-check.cern.md', root), true);
  assert.equal(isBareFileTarget('domains/missing.cern.md', root), false);
  assert.equal(isBareFileTarget('domains/godaddy-check', root), false);
  assert.equal(isBareFileTarget('status', root), false);
  writeFileSync(join(root, 'x.cern'), 'not really');
  assert.equal(isBareFileTarget('x.cern', root), true);
});

test("a stale dependency is the compile's own target; its current dependent lands as it is", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-land-dep-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  // util's package was written for an earlier spec; app is current and
  // pins util at the contract the tree's package still carries.
  writeFileSync(join(root, 'ops', 'util.cern.md'), specOf('Util, reworded'));
  const util = packageOf('ops/util', specOf('Util'), {});
  writeFileSync(join(root, 'ops', '.cern', 'util.cern'), util);
  const utilContract = readCernPackage(util).manifest.contractHash;
  assert.ok(utilContract);
  writeFileSync(join(root, 'ops', 'app.cern.md'), specOf('App'));
  writeFileSync(
    join(root, 'ops', '.cern', 'app.cern'),
    packageOf('ops/app', specOf('App'), { 'ops/util': utilContract }),
  );
  const client = fakeCompileClient({ callId: 'inv-d', stream: [], doneAfter: 1 });
  const lines: string[] = [];
  const landing = await landPackages(client, ['ops/app'], {
    agentsRoot: root,
    onLine: (line) => lines.push(line),
  });
  // The stale leaf goes to the compile under its own name, never under
  // its dependent's: the compiler compiles what it is given.
  assert.deepEqual(landing.toCompile, [
    { agentId: 'ops/util', reason: 'its spec moved since the package was compiled' },
  ]);
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['ops/app'],
  );
  assert.ok(
    lines.some(
      (line) => line === 'ops/util: its spec moved since the package was compiled; compiling it\n',
    ),
  );
});

test("a stale implementor of a landed interface goes to the compile with the consumer's deploy", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-land-impl-'));
  mkdirSync(join(root, 'x', '.cern'), { recursive: true });
  const contract = 'export declare function serve(): Promise<{ ok: true }>;\n';
  const contractSha = createHash('sha256').update(contract).digest('hex');
  const packageWith = (
    name: string,
    type: 'interface' | 'module' | 'task',
    spec: string,
    extra: { uses?: Record<string, string>; implements?: { id: string; contractSha: string }[] },
  ): Buffer =>
    writeCernPackage({
      manifest: composePackageManifest({
        name,
        version: '1.0.0',
        type,
        spec,
        contract,
        handlers: type === 'interface' ? [] : ['serve'],
        uses: Object.fromEntries(
          Object.entries(extra.uses ?? {}).map(([id, contractHash]) => [
            id,
            { type: 'interface', contractHash },
          ]),
        ),
        ...(extra.implements === undefined ? {} : { implements: extra.implements }),
        provenance: {},
      }),
      spec,
      contract,
      code:
        type === 'interface'
          ? {}
          : { 'index.ts': Buffer.from('export async function serve() { return { ok: true }; }\n') },
      tests: {},
      files: {},
      openapi: {},
      mcp: {},
    });
  const write = (name: string, spec: string, bytes: Buffer): void => {
    writeFileSync(join(root, 'x', `${name.split('/')[1] ?? name}.cern.md`), spec);
    writeFileSync(join(root, 'x', '.cern', `${name.split('/')[1] ?? name}.cern`), bytes);
  };
  write(
    'x/backend',
    specOf('x/backend'),
    packageWith('x/backend', 'interface', specOf('x/backend'), {}),
  );
  const backendContract = readCernPackage(readFileSync(join(root, 'x', '.cern', 'backend.cern')))
    .manifest.contractHash;
  assert.ok(backendContract);
  const claim = { implements: [{ id: 'x/backend', contractSha }] };
  write(
    'x/native',
    specOf('x/native'),
    packageWith('x/native', 'module', specOf('x/native'), claim),
  );
  // pods2 implements the interface too, but its spec moved since its
  // package was written.
  write(
    'x/native2',
    specOf('x/native2, reworded'),
    packageWith('x/native2', 'task', specOf('x/native2'), claim),
  );
  write(
    'x/user',
    specOf('x/user'),
    packageWith('x/user', 'task', specOf('x/user'), { uses: { 'x/backend': backendContract } }),
  );
  const client = fakeCompileClient({ callId: 'inv-s', stream: [], doneAfter: 1 });
  const landing = await landPackages(client, ['x/user'], { agentsRoot: root });
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['x/backend', 'x/native', 'x/user'],
  );
  assert.deepEqual(landing.toCompile, [
    { agentId: 'x/native2', reason: 'its spec moved since the package was compiled' },
  ]);
  // An implementor deployed alone lands after the interface it
  // implements: the plane reads its stamp as a need of the package and
  // refuses it while the interface is not deployed.
  const alone = fakeCompileClient({ callId: 'inv-s2', stream: [], doneAfter: 1 });
  const implementorFirst = await landPackages(alone, ['x/native'], {
    agentsRoot: root,
  });
  assert.deepEqual(
    implementorFirst.landed.map((one) => one.agentId),
    ['x/backend', 'x/native'],
  );
  // An implementor that uses another implementor of the same interface
  // (usher uses formal) lands after it, whichever the deploy names first:
  // the interface's implementors are visited after the pass, never from
  // inside a sibling's visit.
  write(
    'x/usher',
    specOf('x/usher'),
    packageWith('x/usher', 'task', specOf('x/usher'), {
      implements: claim.implements,
      uses: { 'x/native': contractSha },
    }),
  );
  const family = fakeCompileClient({ callId: 'inv-s3', stream: [], doneAfter: 1 });
  const ordered = await landPackages(family, ['x/native', 'x/usher'], {
    agentsRoot: root,
  });
  assert.deepEqual(
    ordered.landed.map((one) => one.agentId),
    ['x/backend', 'x/native', 'x/usher'],
  );
});

test('a stale front with a stale module below it hands both to the compile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-land-deep-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'util.cern.md'), specOf('Util, reworded'));
  const util = packageOf('ops/util', specOf('Util'), {});
  writeFileSync(join(root, 'ops', '.cern', 'util.cern'), util);
  const utilContract = readCernPackage(util).manifest.contractHash;
  assert.ok(utilContract);
  writeFileSync(join(root, 'ops', 'app.cern.md'), specOf('App, reworded'));
  writeFileSync(
    join(root, 'ops', '.cern', 'app.cern'),
    packageOf('ops/app', specOf('App'), { 'ops/util': utilContract }),
  );
  const client = fakeCompileClient({ callId: 'inv-e', stream: [], doneAfter: 1 });
  const landing = await landPackages(client, ['ops/app'], { agentsRoot: root });
  assert.deepEqual(landing.landed, []);
  assert.deepEqual(landing.toCompile, [
    { agentId: 'ops/app', reason: 'its spec moved since the package was compiled' },
    { agentId: 'ops/util', reason: 'its spec moved since the package was compiled' },
  ]);
});

test("a dependency's compatible contract change leaves its dependent current, as the plane reads pins", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-land-compat-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'util.cern.md'), specOf('Util'));
  const util = packageOf('ops/util', specOf('Util'), {});
  const utilContract = readCernPackage(util).manifest.contractHash;
  assert.ok(utilContract);
  writeFileSync(join(root, 'ops', 'app.cern.md'), specOf('App'));
  writeFileSync(
    join(root, 'ops', '.cern', 'app.cern'),
    packageOf('ops/app', specOf('App'), { 'ops/util': utilContract }),
  );
  // util's contract moved compatibly: its new package lists the old
  // contract among the ones it is compatible with.
  const moved = 'export declare function run(): Promise<{ ops_util: number; more?: string }>;\n';
  writeFileSync(
    join(root, 'ops', '.cern', 'util.cern'),
    writeCernPackage({
      manifest: composePackageManifest({
        name: 'ops/util',
        version: '1.0.1',
        type: 'task',
        spec: specOf('Util'),
        contract: moved,
        handlers: ['run'],
        contractCompatibleWith: [utilContract],
        provenance: {},
      }),
      spec: specOf('Util'),
      contract: moved,
      code: { 'index.ts': Buffer.from('export async function run() { return {}; }\n') },
      tests: {},
      files: {},
      openapi: {},
      mcp: {},
    }),
  );
  const client = fakeCompileClient({ callId: 'inv-c', stream: [], doneAfter: 1 });
  const landing = await landPackages(client, ['ops/app'], { agentsRoot: root });
  assert.deepEqual(landing.toCompile, [], 'a compatible pin sends nothing to the compile');
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['ops/util', 'ops/app'],
  );
});

test('a package whose manifest lags the notice labels of its unchanged spec is stale, with why', () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-notice-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  // The spec moved only in its labels and the package was respun under
  // the new text but kept the previous manifest's notice.
  const spec = `${specOf('Labelled')}\n## License\n\nCopyright: 2026 Cernanto\n\nLicense: BUSL-1.1\n`;
  writeFileSync(join(root, 'ops', 'labelled.cern.md'), spec);
  const contract = 'export declare function run(): Promise<{ ops_labelled: number }>;\n';
  writeFileSync(
    join(root, 'ops', '.cern', 'labelled.cern'),
    writeCernPackage({
      manifest: composePackageManifest({
        name: 'ops/labelled',
        version: '1.0.0',
        type: 'task',
        spec,
        contract,
        handlers: ['run'],
        license: 'LicenseRef-Old',
        copyright: ['2026 Cernanto. All rights reserved.'],
        provenance: {},
      }),
      spec,
      contract,
      code: {
        'index.ts': Buffer.from('export async function run() { return { ops_labelled: 1 }; }\n'),
      },
      tests: {},
      files: {},
      openapi: {},
      mcp: {},
    }),
  );
  const state = packageCurrency(root, 'ops/labelled', treePackages(root));
  assert.deepEqual(state, {
    current: false,
    reason: 'its notice labels moved since the package was compiled',
  });
  assert.deepEqual(noticeOf(spec), { license: 'BUSL-1.1', copyright: ['2026 Cernanto'] });
  assert.deepEqual(noticeOf('Copyright:\n\n- A\n- B\n\nLicense: MIT\n'), {
    license: 'MIT',
    copyright: ['A', 'B'],
  });
  assert.deepEqual(noticeOf('no labels here\n'), { copyright: [] });
});

test("a marker's folders lie under the workspace root: any other folder refuses the marker before a file is read", () => {
  const outside = mkdtempSync(join(tmpdir(), 'root-outside-'));
  writeFileSync(join(outside, 'private.txt'), "not the workspace's\n");
  const refused = (folders: string[]): void => {
    const root = mkdtempSync(join(tmpdir(), 'root-contained-'));
    mkdirSync(join(root, 'agents'));
    writeFileSync(join(root, 'agents', 'x.cern.md'), specOf('X'));
    // A link under the root to a folder outside it.
    if (system.name !== 'windows') symlinkSync(outside, join(root, 'linked'));
    writeFileSync(join(root, WORKSPACE_MARKER), JSON.stringify({ version: 1, folders }));
    for (const read of [workspaceFolders, workspaceAgentIds, treePackages, packWorkspace]) {
      assert.throws(
        () => read(root),
        /"folders" lists ".*", which lies outside the workspace; a workspace's folders are paths under its root/,
        `${read.name} ${JSON.stringify(folders)}`,
      );
    }
  };
  refused(['agents', '../outside']);
  refused([outside]);
  refused(['agents/../..']);
  if (system.name !== 'windows') refused(['linked']);
  // The root itself and a folder below it are the workspace's own.
  const root = mkdtempSync(join(tmpdir(), 'root-contained-'));
  mkdirSync(join(root, 'agents', 'deep'), { recursive: true });
  writeFileSync(join(root, WORKSPACE_MARKER), '{"version": 1, "folders": [".", "agents/deep"]}\n');
  assert.deepEqual(workspaceFolders(root), [root, join(root, 'agents', 'deep')]);
});

test('a home folder, a folder that holds it and the root of a file system are no workspace until their author marks them', () => {
  const above = mkdtempSync(join(tmpdir(), 'unfit-'));
  const home = join(above, 'home');
  mkdirSync(join(home, 'agents'), { recursive: true });
  assert.equal(unfitWorkspace(home, home), 'your home folder');
  assert.equal(unfitWorkspace(above, home), 'a folder that holds your home folder');
  assert.equal(unfitWorkspace(parse(above).root, home), 'a folder that holds your home folder');
  // A root that holds no home: a system of several roots has them.
  if (system.name === 'windows') {
    const other = parse(above).root.toUpperCase().startsWith('Q') ? 'R:\\' : 'Q:\\';
    assert.equal(unfitWorkspace(other, home), 'the root of a file system');
  }
  // A folder below the home is a folder of its own.
  assert.equal(unfitWorkspace(join(home, 'agents'), home), undefined);
  assert.throws(
    () => {
      assertWorkspace(home, home);
    },
    (error: unknown) =>
      error instanceof CernantoError &&
      error.message ===
        `${home} is your home folder, which is no workspace: a workspace is a folder that holds agents alone, and a command reads all of it; make a folder for your agents and run the command from there`,
  );
  assertWorkspace(join(home, 'agents'), home);
  // The author's marker makes any folder a workspace, by its word.
  writeFileSync(join(home, WORKSPACE_MARKER), '{"version": 1, "folders": ["agents"]}\n');
  assert.equal(unfitWorkspace(home, home), undefined);
  assertWorkspace(home, home);
});

test('no walk of the workspace reads a home folder its author did not mark, whatever it holds', async () => {
  const home = mkdtempSync(join(tmpdir(), 'unfit-home-'));
  mkdirSync(join(home, 'examples', '.cern'), { recursive: true });
  writeFileSync(join(home, 'examples', 'x.cern.md'), specOf('X'));
  writeFileSync(
    join(home, 'examples', '.cern', 'x.cern'),
    packageOf('examples/x', specOf('X'), {}),
  );
  mkdirSync(join(home, 'letters'));
  writeFileSync(join(home, 'letters', 'private.txt'), 'not an agent\n');
  await asHome(home, () => {
    for (const read of [workspaceFolders, workspaceAgentIds, treePackages, packWorkspace]) {
      assert.throws(
        () => read(home),
        /is your home folder, which is no workspace: a workspace is a folder that holds agents alone/,
        read.name,
      );
    }
    // A folder of its own below the home reads as any workspace does.
    assert.deepEqual(workspaceAgentIds(join(home, 'examples')), ['x']);
    // Marked for the folders that hold its agents, the home reads them alone.
    writeFileSync(join(home, WORKSPACE_MARKER), '{"version": 1, "folders": ["examples"]}\n');
    assert.deepEqual(workspaceAgentIds(home), ['examples/x']);
    assert.deepEqual(Object.keys(treePackages(home).packages), ['examples/x']);
    assert.deepEqual(Object.keys(packWorkspace(home)), ['examples/x.cern.md']);
  });
});

test('an entry of the workspace the system will not read is said in words, with how the root was taken', () => {
  const root = mkdtempSync(join(tmpdir(), 'unreadable-'));
  const inWords = (tail: RegExp) => (error: unknown) =>
    error instanceof CernantoError &&
    error.message.startsWith(
      `the workspace under ${root} holds gone, which cannot be read (ENOENT); a workspace is a folder that holds agents alone, and a command reads all of it: `,
    ) &&
    tail.test(error.message);
  assert.throws(
    () => entriesOf(root, join(root, 'gone')),
    inWords(
      /no cernanto\.json stands at or above the folder the command ran from, so that folder was taken for the workspace; run the command from the folder of your agents$/,
    ),
  );
  writeFileSync(join(root, WORKSPACE_MARKER), '{"version": 1}\n');
  assert.throws(
    () => entriesOf(root, join(root, 'gone')),
    inWords(
      /where the folder holds other things too, its cernanto\.json lists the folders that hold its agents, under "folders"$/,
    ),
  );
  // A folder and a file the account may not read stop every walk, each
  // by its path from the root. An account that reads everything, and a
  // system whose modes close nothing, have no such entry to make.
  if (system.name === 'windows' || process.getuid?.() === 0) return;
  const closed = mkdtempSync(join(tmpdir(), 'unreadable-closed-'));
  mkdirSync(join(closed, 'ops', 'locked'), { recursive: true });
  writeFileSync(join(closed, 'ops', 'x.cern.md'), specOf('X'));
  chmodSync(join(closed, 'ops', 'locked'), 0o000);
  try {
    for (const read of [workspaceAgentIds, treePackages, packWorkspace]) {
      assert.throws(
        () => read(closed),
        /holds ops\/locked, which cannot be read \(EACCES\)/,
        read.name,
      );
    }
  } finally {
    chmodSync(join(closed, 'ops', 'locked'), 0o700);
  }
  rmSync(join(closed, 'ops', 'locked'), { recursive: true });
  writeFileSync(join(closed, 'ops', 'sealed.md'), 'sealed\n');
  chmodSync(join(closed, 'ops', 'sealed.md'), 0o000);
  try {
    assert.throws(
      () => packWorkspace(closed),
      /holds ops\/sealed\.md, which cannot be read \(EACCES\)/,
    );
  } finally {
    chmodSync(join(closed, 'ops', 'sealed.md'), 0o600);
  }
});

test("a foreign package is found in the root's .cern folder whichever folders the marker lists", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-scoped-'));
  writeFileSync(join(root, WORKSPACE_MARKER), '{"version": 1, "folders": ["agents"]}\n');
  mkdirSync(join(root, 'agents', '.cern'), { recursive: true });
  writeFileSync(join(root, 'agents', 'own.cern.md'), specOf('Own'));
  writeFileSync(
    join(root, 'agents', '.cern', 'own.cern'),
    packageOf('agents/own', specOf('Own'), {}),
  );
  mkdirSync(join(root, '.cern'), { recursive: true });
  writeFileSync(
    join(root, '.cern', 'acme--greeter.cern'),
    packageOf('acme/greeter', specOf('G'), {}),
  );
  // A spec at the root is outside the listed folders: its package is
  // another workspace's business.
  writeFileSync(join(root, 'stray.cern.md'), specOf('Stray'));
  writeFileSync(join(root, '.cern', 'stray.cern'), packageOf('stray', specOf('Stray'), {}));
  const tree = treePackages(root);
  assert.deepEqual(Object.keys(tree.packages).sort(), ['acme/greeter', 'agents/own']);
  assert.equal(tree.packages['acme/greeter']?.foreign, true);
  assert.deepEqual(tree.orphans, []);
  const client = fakeCompileClient({ callId: 'inv-s', stream: [], doneAfter: 1 });
  const landing = await landPackages(client, ['acme/greeter'], { agentsRoot: root });
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['acme/greeter'],
  );
  assert.deepEqual(landing.toCompile, []);
});

test('a landing the plane asks to try again is asked again: a target that is away, a retryable refusal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-again-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'util.cern.md'), specOf('Util'));
  writeFileSync(join(root, 'ops', '.cern', 'util.cern'), packageOf('ops/util', specOf('Util'), {}));
  const client = fakeCompileClient({ callId: 'inv-a', stream: [], doneAfter: 1 });
  const land = client.land.bind(client);
  const refusals = [
    new CernantoError({
      kind: 'target-unavailable',
      message: 'cernanto/packages is not deployed yet',
    }),
    new CernantoError({ kind: 'retryable', message: 'the controller is rolling' }),
  ];
  let asked = 0;
  client.land = (body) => {
    asked += 1;
    const refusal = refusals.shift();
    return refusal === undefined ? land(body) : Promise.reject(refusal);
  };
  const landing = await landPackages(client, ['ops/util'], { agentsRoot: root });
  assert.equal(asked, 3);
  assert.deepEqual(
    landing.landed.map((one) => one.agentId),
    ['ops/util'],
  );
});

test('what the plane pulled from the registry for an agent is kept in the workspace: each installed use once, its own uses too, never one with a spec here', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-kept-'));
  mkdirSync(join(root, 'demo'), { recursive: true });
  writeFileSync(join(root, 'demo', 'welcome.cern.md'), specOf('Welcome'));
  // A spec of the greeter's base lives here: its road is its spec.
  mkdirSync(join(root, 'acme'), { recursive: true });
  writeFileSync(join(root, 'acme', 'base.cern.md'), specOf('Base'));
  const greeter = packageOf('acme/greeter', specOf('G'), {});
  const words = packageOf('acme/words', specOf('W'), {});
  const store = new Map<string, Buffer>([
    [sha256Of(greeter), greeter],
    [sha256Of(words), words],
  ]);
  const rows = [
    { agentId: 'demo/welcome', artifact: 'sha256:own', handlers: [], uses: ['acme/greeter'] },
    {
      agentId: 'acme/greeter',
      artifact: sha256Of(greeter),
      handlers: [],
      uses: ['acme/words', 'acme/base'],
      package: { digest: sha256Of(greeter), version: '0.0.1', publisher: 'acme' },
    },
    {
      agentId: 'acme/words',
      artifact: sha256Of(words),
      handlers: [],
      uses: [],
      package: { digest: sha256Of(words) },
    },
    {
      agentId: 'acme/base',
      artifact: 'sha256:base',
      handlers: [],
      uses: [],
      package: { digest: 'sha256:base' },
    },
  ];
  const asked: string[] = [];
  const client = {
    rows: () => Promise.resolve(rows),
    packageGet: (digest: string) => {
      asked.push(digest);
      const bytes = store.get(digest);
      return bytes === undefined ? Promise.reject(new Error('none')) : Promise.resolve(bytes);
    },
  };
  const lines: string[] = [];
  const kept = await keepPulledPackages(client, root, ['demo/welcome'], (line) => lines.push(line));
  assert.deepEqual(kept, ['acme/greeter', 'acme/words']);
  assert.deepEqual(asked, [sha256Of(greeter), sha256Of(words)]);
  assert.equal(
    readFileSync(join(root, '.cern', 'acme--greeter.cern')).toString('hex'),
    greeter.toString('hex'),
  );
  assert.ok(existsSync(join(root, '.cern', 'acme--words.cern')));
  assert.ok(!existsSync(join(root, '.cern', 'acme--base.cern')), 'a spec here is its own road');
  assert.deepEqual(lines, [
    'kept acme/greeter 0.0.1 at .cern/acme--greeter.cern; commit it with your agents\n',
    'kept acme/words at .cern/acme--words.cern; commit it with your agents\n',
  ]);
  // Kept already: nothing is read or written again.
  asked.length = 0;
  assert.deepEqual(await keepPulledPackages(client, root, ['demo/welcome']), []);
  assert.deepEqual(asked, []);
  // A plane that answers no rows keeps nothing.
  assert.deepEqual(await keepPulledPackages({}, root, ['demo/welcome']), []);
});

test("a platform package an agent uses is never kept in the workspace: it is the release's own", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-kept-platform-'));
  mkdirSync(join(root, 'demo'), { recursive: true });
  writeFileSync(join(root, 'demo', 'welcome.cern.md'), specOf('Welcome'));
  const llm = packageOf('cernanto/llm', specOf('L'), {});
  const rows = [
    { agentId: 'demo/welcome', artifact: 'sha256:own', handlers: [], uses: ['cernanto/llm'] },
    {
      agentId: 'cernanto/llm',
      artifact: sha256Of(llm),
      handlers: [],
      uses: [],
      package: { digest: sha256Of(llm), version: '0.5.3', publisher: 'cernanto' },
    },
  ];
  const asked: string[] = [];
  const client = {
    rows: () => Promise.resolve(rows),
    packageGet: (digest: string) => {
      asked.push(digest);
      return Promise.resolve(llm);
    },
  };
  assert.deepEqual(await keepPulledPackages(client, root, ['demo/welcome']), []);
  assert.deepEqual(asked, []);
  assert.ok(!existsSync(join(root, '.cern')));
  assert.equal(isPlatformAgent('cernanto/llm'), true);
  assert.equal(isPlatformAgent('cernanto-plus/llm'), false);
});

/** A platform folder as a pull lays it and a pack of a release writes
 * it: the marker, the record and each package at the place its id
 * names, no spec anywhere. Answers the packages by id. */
function platformFolder(
  folder: string,
  version: string,
  packages: Record<string, Record<string, string>>,
): Record<string, Buffer> {
  const stamped: Record<string, Buffer> = {};
  for (const [id, uses] of Object.entries(packages)) {
    stamped[id] = stampCernPackage(packageOf(id, specOf(id), uses), {
      version,
      publisher: 'cernanto',
    });
  }
  const body = platformReleaseBodyOf(
    version,
    Object.entries(stamped).map(([id, bytes]) => ({
      id,
      version,
      packageDigest: readCernPackage(bytes).packageDigest,
      blobDigest: sha256Of(bytes),
    })),
  );
  const entries = platformFolderEntries(
    platformReleaseBytes(body),
    Object.entries(stamped).map(([id, bytes]) => ({ id, bytes })),
  );
  for (const entry of entries) {
    const file = join(folder, ...entry.path.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, entry.bytes);
  }
  return stamped;
}

test("a platform folder lands by its record: exactly the record's packages, a package before the ones that use it, as one landing marked installed", async () => {
  const folder = mkdtempSync(join(tmpdir(), 'plane-platform-'));
  const contractOf = (id: string): string =>
    readCernPackage(packageOf(id, specOf(id), {})).manifest.contractHash ?? '';
  const stamped = platformFolder(folder, '0.5.3', {
    'cernanto/gateway': { 'cernanto/compile/judge': contractOf('cernanto/compile/judge') },
    'cernanto/compile/judge': {},
    'cernanto/auth': {},
  });
  // The workspace road finds nothing to land in such a folder: no spec
  // names an agent, and a package below the root's own .cern/ with no
  // spec beside it is an orphan to it.
  assert.deepEqual(workspaceAgentIds(folder), []);
  assert.equal(treePackages(folder).orphans.length, 3);
  const platform = readPlatformFolder(folder);
  assert.equal(platform.body.version, '0.5.3');
  assert.deepEqual(platform.packages.map((one) => one.id).sort(), [
    'cernanto/auth',
    'cernanto/compile/judge',
    'cernanto/gateway',
  ]);
  const client = fakeCompileClient({ callId: 'inv-p', stream: [], doneAfter: 1 });
  const landing = await landPlatformFolder(client, platform);
  const digestOf = (id: string): string => sha256Of(stamped[id] ?? Buffer.alloc(0));
  assert.deepEqual(client.landings, [
    {
      body: {
        targets: [
          digestOf('cernanto/auth'),
          digestOf('cernanto/compile/judge'),
          digestOf('cernanto/gateway'),
        ],
        installed: true,
      },
    },
  ]);
  assert.deepEqual(
    landing.landed.map((one) => [one.agentId, one.version]),
    [
      ['cernanto/auth', '0.5.3'],
      ['cernanto/compile/judge', '0.5.3'],
      ['cernanto/gateway', '0.5.3'],
    ],
  );
  assert.deepEqual([...client.store.keys()].sort(), Object.keys(stamped).map(digestOf).sort());
  // Landed again, the plane holds the bytes and nothing is put twice.
  let puts = 0;
  client.packagePut = () => {
    puts += 1;
    return Promise.resolve();
  };
  await landPlatformFolder(client, readPlatformFolder(folder));
  assert.equal(puts, 0);
});

test('a platform folder that disagrees with its record is refused in words naming the package', () => {
  const made = (): string => {
    const folder = mkdtempSync(join(tmpdir(), 'plane-platform-bad-'));
    platformFolder(folder, '0.5.3', { 'cernanto/gateway': {}, 'cernanto/auth': {} });
    return folder;
  };
  // A package the record names is not there.
  const missing = made();
  rmSync(join(missing, 'cernanto', '.cern', 'auth.cern'));
  assert.throws(
    () => readPlatformFolder(missing),
    /cernanto\/auth is named by the record and cernanto\/\.cern\/auth\.cern is not there/,
  );
  // A package's bytes are another's.
  const swapped = made();
  writeFileSync(
    join(swapped, 'cernanto', '.cern', 'auth.cern'),
    stampCernPackage(packageOf('cernanto/auth', specOf('another page'), {}), {
      version: '0.5.3',
      publisher: 'cernanto',
    }),
  );
  assert.throws(
    () => readPlatformFolder(swapped),
    /cernanto\/auth does not match its record \(cernanto\/\.cern\/auth\.cern is sha256:[a-f0-9]{64}, the record names sha256:[a-f0-9]{64}\)/,
  );
  // A package the record does not name.
  const extra = made();
  mkdirSync(join(extra, 'cernanto', 'compile', '.cern'), { recursive: true });
  writeFileSync(
    join(extra, 'cernanto', 'compile', '.cern', 'judge.cern'),
    packageOf('cernanto/compile/judge', specOf('J'), {}),
  );
  assert.throws(
    () => readPlatformFolder(extra),
    /cernanto\/compile\/\.cern\/judge\.cern is not named by the record/,
  );
  // A record edited by hand, and a folder with none.
  const edited = made();
  const recordFile = join(edited, 'platform-release.json');
  writeFileSync(recordFile, readFileSync(recordFile, 'utf8').replace('0.5.3', '0.5.4'));
  assert.throws(() => readPlatformFolder(edited), /the platform at .*: /);
  const none = mkdtempSync(join(tmpdir(), 'plane-platform-none-'));
  assert.throws(
    () => readPlatformFolder(none),
    /no platform-release\.json; it is not a platform folder/,
  );
});
