// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  composePackageManifest,
  readCernPackage,
  writeCernPackage,
} from '@cernanto/package-format';

import type { FleetAgentRowWire, TraceRecord } from '../gateway/types.gen.js';
import { asHome } from '../home.fixture.js';
import { classifyTarget, deployAction, fetchIntoTree } from './deploy.js';
import type { DeployPlane } from './deploy.js';
import { fakeCompileClient, responseOf } from './plane.fixture.js';
import type { FakePlane } from './plane.fixture.js';
// The tables render this machine's time; the proof reads them in utc.
process.env['TZ'] = 'UTC';

const specOf = (name: string): string => `# ${name}\n\n\nDoes its thing.\n`;

function packageOf(name: string, type: 'task' | 'worker' = 'task', verifiedAt?: string): Buffer {
  const spec = specOf(name);
  const contract = 'export declare function run(): Promise<void>;\n';
  return writeCernPackage({
    manifest: composePackageManifest({
      name,
      version: '1.2.0',
      type,
      spec,
      contract,
      handlers: ['run'],
      provenance: verifiedAt === undefined ? {} : { verified: { at: verifiedAt } },
    }),
    spec,
    contract,
    code: { 'index.ts': Buffer.from('export async function run() {}\n') },
    tests: {},
    files: {},
    openapi: {},
    mcp: {},
  });
}

/** The plane a deploy asks, over the compile fixture: the fleet's rows
 * and a call's read beside it. */
function planeOf(script: Parameters<typeof fakeCompileClient>[0]): DeployPlane {
  return {
    ...fakeCompileClient(script),
    rows: () => Promise.resolve([]),
    call: (callId: string) => Promise.resolve({ call: { callId }, records: [], calls: [] }),
  } as unknown as DeployPlane;
}

/** The plane a deploy asks, with the fleet a landing leaves: an entry
 * per landed package, composed from its manifest as the plane composes
 * it. */
function landingPlaneOf(script: Parameters<typeof fakeCompileClient>[0]): {
  plane: DeployPlane;
  fake: FakePlane;
} {
  const fake = fakeCompileClient(script);
  const rows = (): Promise<FleetAgentRowWire[]> =>
    Promise.resolve(
      fake.landings.flatMap(({ body }) => {
        const targets = body.targets ?? (body.target === undefined ? [] : [body.target]);
        return targets.flatMap((target) => {
          const bytes = fake.store.get(target);
          if (bytes === undefined) return [];
          const { manifest, contract } = readCernPackage(bytes);
          const verified = manifest.provenance.verified;
          return [
            {
              agentId: manifest.name,
              artifact: target,
              handlers: manifest.handlers,
              uses: Object.keys(manifest.uses),
              type: manifest.type,
              ...(contract === undefined ? {} : { contract }),
              ...(verified === undefined ? {} : { verified: { at: verified.at } }),
            },
          ];
        });
      }),
    );
  const plane = {
    ...fake,
    rows,
    call: (callId: string) => Promise.resolve({ call: { callId }, records: [], calls: [] }),
  } as unknown as DeployPlane;
  return { plane, fake };
}

/** A workspace with one agent whose verified package is current for
 * its spec, so a deploy lands it as it is. */
function workspaceWithCurrent(agentId: string): string {
  const root = mkdtempSync(join(tmpdir(), 'deploy-landed-'));
  const [folder, name] = agentId.split('/') as [string, string];
  mkdirSync(join(root, folder, '.cern'), { recursive: true });
  writeFileSync(join(root, folder, `${name}.cern.md`), specOf(agentId));
  writeFileSync(
    join(root, folder, '.cern', `${name}.cern`),
    packageOf(agentId, 'task', '2026-08-21T10:00:00Z'),
  );
  return root;
}

test("a deploy target is the workspace's own agent, a registry reference, or a package file", () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-target-'));
  mkdirSync(join(root, 'ops'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), '# Greeter\n');
  assert.deepEqual(classifyTarget('ops/greeter', root), { kind: 'own', agentId: 'ops/greeter' });
  assert.deepEqual(classifyTarget('ops/greeter.cern.md', root), {
    kind: 'own',
    agentId: 'ops/greeter',
  });
  // A version makes a registry reference; a plain id with no spec here
  // is looked up in the registry too (local first, then the registry).
  assert.deepEqual(classifyTarget('acme/mailer@^2', root), {
    kind: 'registry',
    ref: 'acme/mailer@^2',
  });
  assert.deepEqual(classifyTarget('acme/mailer', root), { kind: 'registry', ref: 'acme/mailer' });
  assert.deepEqual(classifyTarget('../shared/mailer.cern', root), {
    kind: 'file',
    path: '../shared/mailer.cern',
  });
});

test("a package file is kept in the workspace root's .cern folder and named; one of your own agent is refused", async () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-file-'));
  const shared = mkdtempSync(join(tmpdir(), 'deploy-shared-'));
  const file = join(shared, 'mailer.cern');
  writeFileSync(file, packageOf('acme/mailer'));
  const lines: string[] = [];
  const agentId = await fetchIntoTree({ kind: 'file', path: file }, root, (line) =>
    lines.push(line),
  );
  assert.equal(agentId, 'acme/mailer');
  const kept = join(root, '.cern', 'acme--mailer.cern');
  assert.ok(existsSync(kept));
  assert.equal(readFileSync(kept).toString('hex'), readFileSync(file).toString('hex'));
  assert.match(lines.join(''), /^acme\/mailer 1\.2\.0 from .*mailer\.cern, kept at /);
  // An id with a spec in this workspace has one road, its spec.
  mkdirSync(join(root, 'acme'), { recursive: true });
  writeFileSync(join(root, 'acme', 'mailer.cern.md'), '# Mailer\n');
  await assert.rejects(
    fetchIntoTree({ kind: 'file', path: file }, root, () => undefined),
    /acme\/mailer already exists here as your local agent \(its spec is in this workspace\); deploy it from the spec: cernanto deploy acme\/mailer/,
  );
});

test("a foreign package has a file of its own: two agents never share one, and a local agent's package stands", async () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-foreign-'));
  const shared = mkdtempSync(join(tmpdir(), 'deploy-shared-'));
  // A local agent at the root, whose package lives in the root's .cern
  // folder beside the foreign ones.
  mkdirSync(join(root, '.cern'), { recursive: true });
  writeFileSync(join(root, 'acme-tool.cern.md'), specOf('acme-tool'));
  const local = packageOf('acme-tool');
  writeFileSync(join(root, '.cern', 'acme-tool.cern'), local);
  for (const name of ['acme/tool', 'a/b-c', 'a-b/c']) {
    const file = join(shared, `${name.replaceAll('/', '_')}.cern`);
    writeFileSync(file, packageOf(name));
    assert.equal(await fetchIntoTree({ kind: 'file', path: file }, root, () => undefined), name);
  }
  assert.equal(
    readFileSync(join(root, '.cern', 'acme-tool.cern')).toString('hex'),
    local.toString('hex'),
    "the local agent's package is as it was",
  );
  for (const kept of ['acme--tool.cern', 'a--b-c.cern', 'a-b--c.cern']) {
    assert.ok(existsSync(join(root, '.cern', kept)), kept);
  }
  // A spec at the root that owns the very file is told so, in words.
  writeFileSync(join(root, 'acme--mailer.cern.md'), '# Mailer\n');
  const mailer = join(shared, 'mailer.cern');
  writeFileSync(mailer, packageOf('acme/mailer'));
  await assert.rejects(
    fetchIntoTree({ kind: 'file', path: mailer }, root, () => undefined),
    /acme\/mailer would be kept at .*acme--mailer\.cern, where the package of your local agent .*acme--mailer\.cern\.md lives/,
  );
});

test('a deploy from a home folder is refused before the plane is asked or a file is kept', async () => {
  const home = mkdtempSync(join(tmpdir(), 'deploy-home-'));
  mkdirSync(join(home, 'examples', '.cern'), { recursive: true });
  writeFileSync(join(home, 'examples', 'counter.cern.md'), specOf('counter'));
  writeFileSync(join(home, 'examples', '.cern', 'counter.cern'), packageOf('examples/counter'));
  const shared = mkdtempSync(join(tmpdir(), 'deploy-shared-'));
  const file = join(shared, 'mailer.cern');
  writeFileSync(file, packageOf('acme/mailer'));
  // A plane that fails the proof at its first word.
  const asked: string[] = [];
  const client = new Proxy(
    {},
    {
      get: (_target, word) => {
        asked.push(String(word));
        throw new Error(`the plane was asked: ${String(word)}`);
      },
    },
  ) as unknown as DeployPlane;
  const seams = { agentsRoot: home, client };
  await asHome(home, async () => {
    // An agent of the folder by its id, a page run again from nothing,
    // the folder whole, and a package to keep: none is read or kept.
    for (const [targets, flags] of [
      [['examples/counter'], {}],
      [['examples/counter'], { recompile: true }],
      [[], {}],
      [[file], {}],
    ] as const) {
      await assert.rejects(
        deployAction([...targets], flags, seams),
        /is your home folder, which is no workspace: a workspace is a folder that holds agents alone, and a command reads all of it; make a folder for your agents and run the command from there/,
        JSON.stringify(targets),
      );
    }
  });
  assert.deepEqual(asked, []);
  assert.ok(!existsSync(join(home, '.cern')), 'nothing is kept in the home folder');
});

test('a flag for the compiler is refused on a package before anything is fetched or written', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-dry-'));
  const shared = mkdtempSync(join(tmpdir(), 'deploy-shared-'));
  const file = join(shared, 'external.cern');
  writeFileSync(file, packageOf('acme/external'));
  await assert.rejects(
    deployAction([file], { dryRun: true }, { agentsRoot: root }),
    /--dry-run applies to an agent compiled from its spec; .*external\.cern is a package and lands as it is: deploy it without --dry-run/,
  );
  await assert.rejects(
    deployAction(['acme/mailer@^2'], { recompile: true, newContract: true }, { agentsRoot: root }),
    /--recompile, --new-contract apply to an agent compiled from its spec; acme\/mailer@\^2 is a package/,
  );
  assert.ok(!existsSync(join(root, '.cern')), 'the workspace is as it was');
});

test("under -o json the output is the one document, and the deploy's lines ride the error stream", async () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-json-'));
  mkdirSync(join(root, 'ops'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), specOf('ops/greeter'));
  const run = async (output: string | undefined): Promise<{ out: string; err: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    await deployAction(
      ['ops/greeter'],
      { ...(output === undefined ? {} : { output }) },
      {
        client: planeOf({ callId: 'inv-json', doneAfter: 1, response: responseOf() }),
        agentsRoot: root,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        coder: () => Promise.resolve(),
        asks: {},
      },
    );
    return { out: out.join(''), err: err.join('') };
  };
  const json = await run('json');
  const report = JSON.parse(json.out) as { status: string; rows: { agentId: string }[] };
  assert.equal(report.status, 'ok');
  assert.equal(report.rows[0]?.agentId, 'ops/greeter');
  assert.match(json.err, /ops\/greeter: no package in the tree; compiling it/);
  assert.match(json.err, /deployed ops\/greeter: sha256:abc/);
  // A person's deploy reads the same lines on the output.
  const spoken = await run(undefined);
  assert.match(spoken.out, /deployed ops\/greeter: sha256:abc/);
  assert.equal(spoken.err, '');
});

test('a package that lands as it is ends as a compiled one does: its deployed line and its card', async () => {
  const root = workspaceWithCurrent('ops/echo');
  const run = async (output: string | undefined): Promise<{ out: string; err: string }> => {
    const { plane, fake } = landingPlaneOf({ callId: 'inv-landed', doneAfter: 1 });
    const out: string[] = [];
    const err: string[] = [];
    await deployAction(['ops/echo'], output === undefined ? {} : { output }, {
      client: plane,
      agentsRoot: root,
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      coder: () => Promise.resolve(),
      asks: {},
    });
    assert.equal(fake.submitted.length, 0, 'a landing compiles nothing');
    return { out: out.join(''), err: err.join('') };
  };
  const spoken = await run(undefined);
  assert.match(
    spoken.out,
    /^landed ops\/echo 1\.2\.0 \(sha256:[0-9a-f]+\.\.\.\)\nlanded 1 package; nothing to compile\ndeployed ops\/echo: sha256:[0-9a-f]{64}\n\n/,
  );
  assert.match(
    spoken.out,
    / {3}ops\/echo {3}.* {3}deployed {3}verified live 2026-08-21 10:00:00\n/,
  );
  assert.match(spoken.out, /\n {2}call it: cernanto call ops\/echo run\n/);
  assert.equal(spoken.err, '');
  // Under -o json the output is the one document; the deployed line
  // rides the error stream and the card stays off, as after a compile.
  const json = await run('json');
  const document = JSON.parse(json.out) as { status: string; landed: { agentId: string }[] };
  assert.equal(document.status, 'ok');
  assert.deepEqual(
    document.landed.map((one) => one.agentId),
    ['ops/echo'],
  );
  assert.match(json.err, /\ndeployed ops\/echo: sha256:[0-9a-f]{64}\n$/);
  assert.doesNotMatch(json.err, /call it:/);
});

test('a deploy that names no agent lands the workspace and ends on its landed lines', async () => {
  const root = workspaceWithCurrent('ops/echo');
  const { plane, fake } = landingPlaneOf({ callId: 'inv-workspace', doneAfter: 1 });
  const out: string[] = [];
  await deployAction(
    [],
    {},
    {
      client: plane,
      agentsRoot: root,
      stdout: (text) => out.push(text),
      stderr: () => undefined,
      coder: () => Promise.resolve(),
      asks: {},
    },
  );
  assert.equal(fake.submitted.length, 0);
  assert.match(
    out.join(''),
    /^landed ops\/echo 1\.2\.0 \(sha256:[0-9a-f]+\.\.\.\)\nlanded 1 package; nothing to compile\n$/,
  );
});

test('one deploy ends once for everything it shipped: the landed agent, then the compiled one', async () => {
  const root = workspaceWithCurrent('ops/echo');
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), specOf('ops/greeter'));
  const { plane, fake } = landingPlaneOf({
    callId: 'inv-mixed',
    doneAfter: 1,
    response: responseOf(),
  });
  const out: string[] = [];
  await deployAction(
    ['ops/greeter', 'ops/echo'],
    {},
    {
      client: plane,
      agentsRoot: root,
      stdout: (text) => out.push(text),
      stderr: () => undefined,
      coder: () => Promise.resolve(),
      asks: {},
    },
  );
  const said = out.join('');
  assert.equal(fake.submitted.length, 1, 'the compile takes the agent with no package');
  // The log names the landed package by its version and digest once,
  // and explains the first compile once.
  assert.equal(said.match(/landed ops\/echo 1\.2\.0 /g)?.length, 1, said);
  assert.equal(said.match(/no package in the tree/g)?.length, 1, said);
  // The landed agent ends on its card, the compiled one, which the fake
  // plane cannot describe, on its deployed line alone.
  const ending = said.slice(said.indexOf('\n\n') + 2);
  assert.match(
    ending,
    /^[\s\S]*\n {2}call it: cernanto call ops\/echo run\n\ndeployed ops\/greeter: sha256:abc\S*\n$/,
  );
});

test('a dry run ends at its plan: nothing is said of a ship', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-plan-'));
  mkdirSync(join(root, 'ops'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), specOf('ops/greeter'));
  // A planned agent reads as compiled and ships nothing.
  const fake = fakeCompileClient({
    callId: 'inv-plan',
    doneAfter: 1,
    response: responseOf({
      agents: [
        {
          agentId: 'ops/greeter',
          status: 'compiled',
          code: 'planned',
          attempts: 0,
          triageCount: 0,
          costUsd: 0,
        },
      ],
      rows: [],
    }),
  });
  const out: string[] = [];
  await deployAction(
    ['ops/greeter'],
    { dryRun: true },
    {
      client: { ...fake, rows: () => Promise.resolve([]) } as unknown as DeployPlane,
      agentsRoot: root,
      stdout: (text) => out.push(text),
      stderr: () => undefined,
      coder: () => Promise.resolve(),
      asks: {},
    },
  );
  const said = out.join('');
  assert.equal(fake.submitted.length, 1);
  assert.equal(fake.landings.length, 0, 'a dry run lands nothing');
  assert.doesNotMatch(said, /prepared module|nothing joined the fleet|deployed /);
});

test('--follow follows a worker whose current package lands with no compile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-follow-'));
  mkdirSync(join(root, 'jobs', '.cern'), { recursive: true });
  writeFileSync(join(root, 'jobs', 'tick.cern.md'), specOf('jobs/tick'));
  writeFileSync(join(root, 'jobs', '.cern', 'tick.cern'), packageOf('jobs/tick', 'worker'));
  // The run the landing starts: its begin and its end, as the stream
  // delivers them.
  const at = new Date().toISOString();
  const base = { agentId: 'jobs/tick', callId: 'jobs_tick:20002:k-run', at };
  const stream = [
    { ...base, seq: 0, kind: 'begin', of: 'handler', handler: 'run' },
    { ...base, seq: 0, kind: 'handler', handler: 'run', durationMs: 5 },
  ] as unknown as TraceRecord[];
  const client = planeOf({ callId: 'inv-follow', doneAfter: 1, stream });
  const out: string[] = [];
  const exits: number[] = [];
  await deployAction(
    ['jobs/tick'],
    { follow: true },
    {
      client,
      agentsRoot: root,
      stdout: (text) => out.push(text),
      stderr: () => undefined,
      coder: () => Promise.resolve(),
      asks: {},
      exit: (code) => exits.push(code),
    },
  );
  const said = out.join('');
  assert.match(said, /landed 1 package; nothing to compile/);
  // The followed run ended well: the deploy ends the process, 0.
  assert.deepEqual(exits, [0]);
  assert.match(said, /following jobs\/tick live/);
  assert.match(said, /jobs\/tick finished {3}trace: cernanto trace jobs_tick:20002:k-run/);
  assert.equal((client as unknown as { submitted: unknown[] }).submitted.length, 0);
});

test("a named worker's deploy runs its program again when its row did not roll, and --follow follows that run", async () => {
  const root = mkdtempSync(join(tmpdir(), 'deploy-follow-'));
  mkdirSync(join(root, 'jobs', '.cern'), { recursive: true });
  writeFileSync(join(root, 'jobs', 'tick.cern.md'), specOf('jobs/tick'));
  writeFileSync(join(root, 'jobs', '.cern', 'tick.cern'), packageOf('jobs/tick', 'worker'));
  const at = new Date().toISOString();
  const base = { agentId: 'jobs/tick', callId: 'jobs_tick:20003:k-run', at };
  const stream = [
    { ...base, seq: 0, kind: 'begin', of: 'handler', handler: 'run' },
    { ...base, seq: 0, kind: 'handler', handler: 'run', durationMs: 5 },
  ] as unknown as TraceRecord[];
  const started: string[] = [];
  const client = {
    ...planeOf({ callId: 'inv-follow-2', doneAfter: 1, stream }),
    // The fleet does not move: the package landed as it was, and the
    // worker's program had ended.
    generations: () => Promise.resolve([{ agentId: 'jobs/tick', gen: 1 }]),
    agentStart: (agentId: string) => {
      started.push(agentId);
      return Promise.resolve({});
    },
  } as unknown as DeployPlane;
  const out: string[] = [];
  const exits: number[] = [];
  await deployAction(
    ['jobs/tick'],
    { follow: true },
    {
      client,
      agentsRoot: root,
      stdout: (text) => out.push(text),
      stderr: () => undefined,
      coder: () => Promise.resolve(),
      asks: {},
      exit: (code) => exits.push(code),
    },
  );
  const said = out.join('');
  assert.match(said, /jobs\/tick is unchanged; running its program again/);
  assert.deepEqual(started, ['jobs/tick']);
  assert.deepEqual(exits, [0]);
});
