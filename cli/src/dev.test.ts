// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { isCernantoError } from '@cernanto/package-format';
import { homeEnvironment } from '@cernanto/system';

import { saveContext } from './context.js';
import {
  detectCoder,
  ensureCompileHarness,
  planeHarness,
  releaseWorkspace,
  resetNativeDev,
  runsOwnBlock,
  setupHarness,
  startBoxWhenNeeded,
  startNativeDev,
  stopNativeDev,
} from './dev.js';
import { planeFetch, whenLoopbackDown } from './gateway-client.js';
import type { Coder, CoderDeps } from './dev.js';
import type { Plane } from './gateway-client.js';
import type { HarnessView } from './gateway/types.gen.js';
import type { ConnectIo } from './terminal.js';

const execute = promisify(execFile);

/** A plane no test reaches: the chooser tests fake every gateway read. */
const elsewhere: Plane = { baseUrl: 'http://gateway', token: undefined };

const connected = (vendor: 'claude-code' | 'codex' | 'openai', mode = 'plan'): HarnessView => ({
  vendor,
  mode,
  source: 'connected',
});

/** Which coders this machine is signed in to, for the probe seam. */
const signedIn =
  (coders: Coder[]) =>
  (coder: Coder): Promise<boolean> =>
    Promise.resolve(coders.includes(coder));

/** An io that records what is printed and refuses every question. */
const silentIo = (output: string[]): ConnectIo => ({
  write: (line) => {
    output.push(line);
  },
  ask: () => Promise.reject(new Error('nothing should be asked')),
  sleep: () => Promise.resolve(),
});

test("the compile guard takes this machine's login without a question, claude first", async () => {
  const output: string[] = [];
  const selected: string[] = [];
  await ensureCompileHarness(elsewhere, silentIo(output), {
    harnessOf: () => Promise.resolve(undefined),
    probe: signedIn(['claude-code', 'codex']),
    select: (plane, coder) => {
      selected.push(`${plane.baseUrl} ${coder}`);
      return Promise.resolve();
    },
    signIn: () => Promise.reject(new Error('nothing should sign in')),
  });
  assert.deepEqual(selected, ['http://gateway claude-code']);
  assert.deepEqual(output, [
    "ai coder: claude (this machine's Claude login); codex is available too; switch with: cernanto dev --coder codex\n",
  ]);
  // Codex alone is codex.
  const codexOnly: string[] = [];
  await ensureCompileHarness(elsewhere, silentIo(codexOnly), {
    harnessOf: () => Promise.resolve(undefined),
    probe: signedIn(['codex']),
    select: () => Promise.resolve(),
  });
  assert.deepEqual(codexOnly, ["ai coder: codex (this machine's ChatGPT login)\n"]);
  // A plane with a selection passes silently and probes nothing.
  const quiet: string[] = [];
  await ensureCompileHarness(elsewhere, silentIo(quiet), {
    harnessOf: () => Promise.resolve(connected('claude-code')),
    probe: () => Promise.reject(new Error('nothing should probe')),
  });
  assert.deepEqual(quiet, []);
  // Off a terminal with nothing signed in, the refusal names the sign-ins.
  await assert.rejects(
    ensureCompileHarness(elsewhere, undefined, {
      harnessOf: () => Promise.resolve(undefined),
      probe: signedIn([]),
    }),
    /no ai coder is signed in on this machine; sign in first: cernanto dev --coder claude {3}or: cernanto dev --coder codex/,
  );
});

test("the sign-in screen offers the two plans and runs the vendor's own login right here", async () => {
  const output: string[] = [];
  const answers = ['banana', '2'];
  const io: ConnectIo = {
    write: (line) => {
      output.push(line);
    },
    ask: (label) => {
      output.push(`${label}?`);
      return Promise.resolve(answers.shift() ?? '');
    },
    sleep: () => Promise.resolve(),
  };
  const signed: Coder[] = [];
  const selected: Coder[] = [];
  await ensureCompileHarness(elsewhere, io, {
    harnessOf: () => Promise.resolve(undefined),
    probe: signedIn([]),
    signIn: (coder) => {
      signed.push(coder);
      return Promise.resolve({ ok: true, detail: "signed in to this machine's ChatGPT login" });
    },
    select: (_plane, coder) => {
      selected.push(coder);
      return Promise.resolve();
    },
  });
  const text = output.join('');
  assert.match(text, /ai coder: none yet; a compile needs one to write the code/);
  assert.match(text, /1\. claude {5}sign in to Claude in your browser \(a Claude plan\)/);
  assert.match(text, /2\. chatgpt {4}sign in to ChatGPT in your browser \(a ChatGPT plan\)/);
  assert.match(text, /connect which\? \[1\]\?/);
  // A word that names no row re-asks; "2" is chatgpt, which is codex.
  assert.match(text, /claude or chatgpt \(1 or 2\)/);
  assert.deepEqual(signed, ['codex']);
  assert.deepEqual(selected, ['codex']);
  assert.match(
    text,
    /signed in to this machine's ChatGPT login; the plane compiles and judges on codex/,
  );
  // An empty answer takes the default, claude.
  const picks: Coder[] = [];
  const defaults: ConnectIo = {
    write: () => undefined,
    ask: () => Promise.resolve(''),
    sleep: () => Promise.resolve(),
  };
  await ensureCompileHarness(elsewhere, defaults, {
    harnessOf: () => Promise.resolve(undefined),
    probe: signedIn([]),
    signIn: (coder) => {
      picks.push(coder);
      return Promise.resolve({ ok: true, detail: 'signed in' });
    },
    select: () => Promise.resolve(),
  });
  assert.deepEqual(picks, ['claude-code']);
  // A failed sign-in is the compile's refusal, in the sign-in's own words.
  await assert.rejects(
    ensureCompileHarness(elsewhere, defaults, {
      harnessOf: () => Promise.resolve(undefined),
      probe: signedIn([]),
      signIn: () =>
        Promise.resolve({ ok: false, detail: 'the claude sign-in did not complete (exit 7)' }),
      select: () => Promise.reject(new Error('nothing should be selected')),
    }),
    /the claude sign-in did not complete \(exit 7\)/,
  );
});

test('the dev coder step prints the state and never blocks off a terminal', async () => {
  const lines: string[] = [];
  const say = (line: string): void => {
    lines.push(line);
  };
  // An earlier pick stands: it is probed again and kept.
  await setupHarness(elsewhere, undefined, say, {
    harnessOf: () => Promise.resolve(connected('claude-code')),
    probe: signedIn(['claude-code', 'codex']),
    select: () => Promise.reject(new Error('an earlier pick is never rewritten')),
  });
  await setupHarness(elsewhere, undefined, say, {
    harnessOf: () => Promise.resolve(connected('codex')),
    probe: signedIn([]),
  });
  // A cluster's selection is reported as it is.
  await setupHarness(elsewhere, undefined, say, {
    harnessOf: () => Promise.resolve(connected('claude-code', 'api-key')),
    probe: () => Promise.reject(new Error('a key is never probed')),
  });
  // Nothing selected yet: this machine's logins decide, claude first.
  const selected: Coder[] = [];
  await setupHarness(elsewhere, undefined, say, {
    harnessOf: () => Promise.resolve(undefined),
    probe: signedIn(['codex', 'claude-code']),
    select: (_plane, coder) => {
      selected.push(coder);
      return Promise.resolve();
    },
  });
  await setupHarness(elsewhere, undefined, say, {
    harnessOf: () => Promise.resolve(undefined),
    probe: signedIn([]),
  });
  await setupHarness(elsewhere, undefined, say, {
    harnessOf: () => Promise.reject(new Error('the gateway answered 503')),
  });
  assert.deepEqual(selected, ['claude-code']);
  assert.deepEqual(lines, [
    "ai coder: claude (this machine's Claude login)",
    "ai coder: codex (this machine's ChatGPT login is gone; sign in with: cernanto dev --coder codex)",
    'ai coder: claude-code (api-key)',
    "ai coder: claude (this machine's Claude login); codex is available too; switch with: cernanto dev --coder codex",
    'ai coder: none yet; a compile needs one. sign in with: cernanto dev --coder claude   or: cernanto dev --coder codex',
    "ai coder: could not read the plane's state (the gateway answered 503); the first deploy checks again",
  ]);
});

test('dev --coder answers the question and never prompts', async () => {
  const lines: string[] = [];
  const selected: Coder[] = [];
  const deps = (logged: Coder[], current?: HarnessView): CoderDeps => ({
    harnessOf: () => Promise.resolve(current),
    probe: signedIn(logged),
    select: (_plane, coder) => {
      selected.push(coder);
      return Promise.resolve();
    },
  });
  // Signed in: selected and reported; already the pick: reported alone.
  await setupHarness(elsewhere, undefined, (line) => lines.push(line), deps(['codex']), {
    coder: 'codex',
  });
  await setupHarness(
    elsewhere,
    undefined,
    (line) => lines.push(line),
    deps(['codex'], connected('codex')),
    { coder: 'codex' },
  );
  // Not signed in, off a terminal: the command, and nothing fails.
  await setupHarness(elsewhere, undefined, (line) => lines.push(line), deps([]), {
    coder: 'claude-code',
  });
  assert.deepEqual(selected, ['codex']);
  assert.deepEqual(lines, [
    "ai coder: codex (this machine's ChatGPT login)",
    "ai coder: codex (this machine's ChatGPT login)",
    'ai coder: claude is not signed in on this machine; sign in with: cernanto dev --coder claude',
  ]);
});

test('dev --coder signs the named coder in at a terminal, screen never shown', async () => {
  const output: string[] = [];
  const io: ConnectIo = {
    write: (line) => {
      output.push(line);
    },
    ask: () => Promise.reject(new Error('the flag answers the question; nothing should be asked')),
    sleep: () => Promise.resolve(),
  };
  const signed: Coder[] = [];
  const selected: Coder[] = [];
  await setupHarness(
    elsewhere,
    io,
    () => undefined,
    {
      harnessOf: () => Promise.resolve(undefined),
      probe: signedIn([]),
      signIn: (coder) => {
        signed.push(coder);
        return Promise.resolve({ ok: true, detail: "signed in to this machine's Claude login" });
      },
      select: (_plane, coder) => {
        selected.push(coder);
        return Promise.resolve();
      },
    },
    { coder: 'claude-code' },
  );
  assert.deepEqual(signed, ['claude-code']);
  assert.deepEqual(selected, ['claude-code']);
  assert.match(
    output.join(''),
    /signed in to this machine's Claude login; the plane compiles and judges on claude/,
  );
});

test('the dev coder step signs a coder in at a terminal; a failed sign-in only notes', async () => {
  const lines: string[] = [];
  const output: string[] = [];
  const io: ConnectIo = {
    write: (line) => {
      output.push(line);
    },
    ask: () => Promise.resolve('chatgpt'),
    sleep: () => Promise.resolve(),
  };
  const signed: Coder[] = [];
  await setupHarness(elsewhere, io, (line) => lines.push(line), {
    harnessOf: () => Promise.resolve(undefined),
    probe: signedIn([]),
    signIn: (coder) => {
      signed.push(coder);
      return Promise.resolve({ ok: true, detail: "signed in to this machine's ChatGPT login" });
    },
    select: () => Promise.resolve(),
  });
  assert.deepEqual(signed, ['codex']);
  assert.match(output.join(''), /ai coder: none yet; a compile needs one to write the code/);
  // A sign-in that fails leaves the plane up and names the retry.
  await setupHarness(elsewhere, io, (line) => lines.push(line), {
    harnessOf: () => Promise.resolve(undefined),
    probe: signedIn([]),
    signIn: () => Promise.resolve({ ok: false, detail: 'the codex sign-in did not complete' }),
    select: () => Promise.resolve(),
  });
  assert.deepEqual(lines, [
    'ai coder: the sign-in did not complete (the codex sign-in did not complete); sign in later with: cernanto dev --coder claude   or: cernanto dev --coder codex',
  ]);
});

test('detection prefers claude', async () => {
  assert.deepEqual(await detectCoder(signedIn(['codex', 'claude-code'])), {
    coder: 'claude-code',
    also: 'codex',
  });
  assert.deepEqual(await detectCoder(signedIn(['codex'])), { coder: 'codex' });
  assert.deepEqual(await detectCoder(signedIn([])), {});
});

/** A loopback port nothing listens on: taken from the kernel and given
 * back, so the connection is refused at once (port 1 is a "bad port"
 * fetch refuses on its own, before any connection). */
async function closedLoopbackPort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

test('a dark gateway answers the remedy, never a raw fetch failure', async () => {
  // The deploy verb's first call is the coder probe: against a parked
  // plane it answers in the plain words every other gateway path speaks,
  // in place of undici's bare "fetch failed". Nothing listens on the
  // port, so the refusal is instant and deterministic.
  const port = await closedLoopbackPort();
  await assert.rejects(
    planeHarness({ baseUrl: `http://127.0.0.1:${String(port)}`, token: undefined }),
    (error: unknown) => {
      assert.ok(isCernantoError(error));
      assert.ok(error.message.includes('cernanto dev'), error.message);
      return true;
    },
  );
});

test(
  'native startup reports an exited supervisor without waiting for the readiness deadline',
  { timeout: 15000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'cern-startup-'));
    t.after(() => {
      rmSync(root, { recursive: true, force: true });
    });
    const release = join(root, 'release');
    layReleaseLayout(release);
    mkdirSync(join(release, 'runtime/process/dist/agent'), { recursive: true });
    mkdirSync(join(release, 'cernanto/.cern'), { recursive: true });
    writeFileSync(join(release, 'runtime/process/dist/agent/bin.js'), 'process.exit(7);');
    // A saved plane with no host behind it: the cli starts one, and
    // that one exits at once.
    writeFileSync(
      join(root, 'dev.json'),
      JSON.stringify({
        version: 4,
        id: 'startup-test',
        release,
        ports: { gateway: 17434 },
      }),
    );
    const env = { ...process.env };
    delete env['NODE_TEST_CONTEXT'];
    delete env['NODE_OPTIONS'];
    const failure: unknown = await execute(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        '--input-type=module',
        '-e',
        `const {startNativeDev} = await import(${JSON.stringify(new URL('./dev.ts', import.meta.url).href)});
     await startNativeDev({dataDir: ${JSON.stringify(root)}, releaseDir: ${JSON.stringify(release)}, say: console.log});`,
      ],
      { env, timeout: 5000 },
    ).catch((error: unknown) => error);
    assert.ok(failure instanceof Error);
    assert.equal(
      Reflect.get(failure, 'code'),
      1,
      'startup should report failure before the test kills it',
    );
    assert.match(String(Reflect.get(failure, 'stderr')), /local plane's host exited \(code 7\)/);
  },
);

/** The release layout a real release carries: the process package's
 * `release-layout.js` with the bring-up set the dev verb reads. */
function layReleaseLayout(release: string): void {
  mkdirSync(join(release, 'runtime/process/dist'), { recursive: true });
  writeFileSync(join(release, 'runtime/process/package.json'), '{ "type": "module" }\n');
  writeFileSync(
    join(release, 'runtime/process/dist/release-layout.js'),
    `export const BRING_UP_SET = ${JSON.stringify([
      { agentId: 'cernanto/packages', port: 19990 },
      { agentId: 'cernanto/config', port: 19991 },
      { agentId: 'cernanto/trace', port: 19992 },
      { agentId: 'cernanto/controller', port: 19993 },
      { agentId: 'cernanto/gateway', port: 19994 },
    ])};\n`,
  );
}

/** A plane's folder with the block standing in: its stop mode ends
 * with the code a stop ends with, and says what went wrong the way the
 * block says it. A host pid named is the plane's host as the record
 * knows it. */
function standInPlane(words: string | undefined, code: number, hostPid?: number): string {
  const root = mkdtempSync(join(tmpdir(), 'cernanto-reset-'));
  layReleaseLayout(root);
  const data = join(root, 'plane');
  mkdirSync(join(data, 'journals'), { recursive: true });
  writeFileSync(join(data, 'journals/journal'), 'what the plane holds');
  writeFileSync(
    join(data, 'dev.json'),
    JSON.stringify({
      version: 4,
      id: 'plane-under-reset',
      release: root,
      ports: { gateway: 7434 },
      ...(hostPid === undefined ? {} : { pids: { host: hostPid } }),
    }),
  );
  mkdirSync(join(root, 'runtime/process/dist/agent'), { recursive: true });
  writeFileSync(
    join(root, 'runtime/process/dist/agent/bin.js'),
    `const words = ${JSON.stringify(words ?? null)};
if (!process.argv.includes('--stop')) process.exit(3);
if (words !== null) process.stderr.write('cernanto-agent: ' + words + '\\n');
process.exit(${String(code)});
`,
  );
  return data;
}

test('dev reset removes no data over a stop the block could not say, and removes it after one that stopped everything', async () => {
  // The host runs (a stand-in process whose command line carries the
  // host's marker) and the block's stop mode fails: the word was not
  // taken, so something of the plane may still run, and the data stays.
  const host = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)', 'bin.js', 'cernanto/host'],
    { stdio: 'ignore' },
  );
  await once(host, 'spawn');
  try {
    const failed = standInPlane(
      'the stop could not be said on the plane: the plane did not take the word within 15 s; the copies leave by their lease',
      1,
      host.pid,
    );
    const said: string[] = [];
    await assert.rejects(
      resetNativeDev({ say: (line) => said.push(line), dataDir: failed }, false),
      /the local plane did not stop: the stop could not be said on the plane: the plane did not take the word within 15 s; the copies leave by their lease; its data is kept as it is/,
    );
    assert.ok(existsSync(join(failed, 'journals/journal')), "the plane's data stays");
    assert.ok(!said.includes('the local plane data was removed'));
    rmSync(join(failed, '..'), { recursive: true, force: true });
  } finally {
    host.kill('SIGKILL');
  }

  // Nothing of the plane runs: there is no word to say, and the data leaves.
  const stopped = standInPlane(undefined, 0);
  const words: string[] = [];
  await resetNativeDev({ say: (line) => words.push(line), dataDir: stopped }, false);
  assert.ok(words.includes('the local plane data was removed'));
  assert.equal(existsSync(stopped), false);
  rmSync(join(stopped, '..'), { recursive: true, force: true });
});

test('a plane another version of cernanto made is said as one and pointed at the reset: dev starts nothing over it, dev down keeps its data, dev reset removes it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cernanto-unread-'));
  const data = join(root, 'plane');
  const held = join(data, 'substrate/record');
  const lay = (record: string): void => {
    mkdirSync(join(data, 'substrate'), { recursive: true });
    writeFileSync(held, 'what the earlier plane held');
    writeFileSync(join(data, 'dev.json'), record);
  };
  // The record an earlier version wrote: its own version, its own fields.
  lay(JSON.stringify({ version: 2, id: 'an-earlier-plane', store: { port: 4222 } }));
  const fact =
    /^the local plane at .* was made by another version of cernanto \(its record is version 2; this one writes version 4\) and cannot be carried over/;
  const pointer = /; run cernanto dev reset to start the plane afresh$/;
  await assert.rejects(
    startNativeDev({ say: () => undefined, dataDir: data, releaseDir: root }),
    (error: Error) => fact.test(error.message) && pointer.test(error.message),
  );
  assert.ok(existsSync(held), 'a start touches nothing of it');
  // Nothing of it runs here: the stop says what stands and where to go,
  // and keeps the data.
  const down: string[] = [];
  await stopNativeDev({ say: (line) => down.push(line), dataDir: data });
  assert.match(down[0] ?? '', fact);
  assert.match(down[0] ?? '', pointer);
  assert.equal(down.at(-1), 'the local plane is stopped; its data is retained');
  assert.ok(existsSync(held), 'a stop keeps its data');
  // The reset says what stands, without being pointed at itself, and
  // the data leaves.
  const reset: string[] = [];
  await resetNativeDev({ say: (line) => reset.push(line), dataDir: data }, false);
  assert.match(reset[0] ?? '', fact);
  assert.ok(!reset.some((line) => /run cernanto dev reset/.test(line)), reset.join('\n'));
  assert.ok(reset.includes('the local plane data was removed'));
  assert.equal(existsSync(data), false);

  // A record that does not read as one goes the same road.
  lay('{ "version": 4, "id": ');
  await assert.rejects(
    startNativeDev({ say: () => undefined, dataDir: data, releaseDir: root }),
    (error: Error) =>
      /^the record of the local plane at .* cannot be read \(dev\.json\); run cernanto dev reset to start the plane afresh$/.test(
        error.message,
      ),
  );
  await resetNativeDev({ say: () => undefined, dataDir: data }, false);
  assert.equal(existsSync(data), false);
  rmSync(root, { recursive: true, force: true });
});

test("where the system names no working folder, a process is a plane's own by the block of the release laid beside the plane's root, and a tree's block is no one plane's", () => {
  const root = join(tmpdir(), 'home', '.cernanto', 'dev');
  const installed = join(tmpdir(), 'home', '.cernanto', 'release');
  const block = join(installed, 'runtime', 'process', 'dist', 'agent', 'bin.js');
  // A copy and the host of the installed release's plane.
  assert.ok(runsOwnBlock(`node ${block} 20001 0 1a2b3c4d`, root, installed));
  assert.ok(runsOwnBlock(`"node" "${block}" cernanto/host`, root, installed));
  // Windows spells a path either way and in either case.
  assert.ok(
    runsOwnBlock(
      'node C:\\Users\\Ada\\.cernanto\\RELEASE\\runtime\\process\\dist\\agent\\bin.js 20001 0 ab',
      'C:/Users/ada/.cernanto/dev',
      'C:\\Users\\ada\\.cernanto\\release',
    ),
  );
  // Another release's block, and a tree's: every plane started from a
  // checkout runs the same block, so it names no one plane.
  const tree = join(tmpdir(), 'checkout');
  const treeBlock = join(tree, 'runtime', 'process', 'dist', 'agent', 'bin.js');
  assert.ok(!runsOwnBlock(`node ${treeBlock} 20001 0 1a2b3c4d`, root, installed));
  assert.ok(!runsOwnBlock(`node ${treeBlock} 20001 0 1a2b3c4d`, root, tree));
  // A plane whose record names no release owns nothing by this rule.
  assert.ok(!runsOwnBlock(`node ${block} 20001 0 1a2b3c4d`, root, undefined));
});

test('the local plane starts for the local context alone: under a named context a refused loopback plane is the answer, and no plane comes up beside it', async () => {
  // A port nothing listens on, and a home of the test's own for the contexts.
  const port = await new Promise<number>((resolve) => {
    const probe = createTcpServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(free);
      });
    });
  });
  const home = mkdtempSync(join(tmpdir(), 'cern-plane-start-'));
  const previous = { HOME: process.env['HOME'], USERPROFILE: process.env['USERPROFILE'] };
  Object.assign(process.env, homeEnvironment(home));
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  try {
    // A server's cli: logged in to its own plane under a name of its own.
    saveContext('plane', { server: baseUrl, token: 'operator' });
    startBoxWhenNeeded();
    await assert.rejects(
      planeFetch({ baseUrl, token: 'operator' }, `${baseUrl}/healthz`),
      /not running/,
    );
    assert.equal(existsSync(join(home, '.cernanto', 'dev')), false, 'no plane was started');
  } finally {
    whenLoopbackDown(undefined);
    if (previous.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previous.HOME;
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previous.USERPROFILE;
    rmSync(home, { recursive: true, force: true });
  }
});

test("the release's packages land from the real folder behind a view's linked tree", () => {
  const root = mkdtempSync(join(tmpdir(), 'cernanto-release-view-'));
  try {
    // The installed runtime's platform package: the marker beside the
    // agent tree, as a pack of a release lays it.
    const platform = join(root, 'platform');
    mkdirSync(join(platform, 'cernanto'), { recursive: true });
    writeFileSync(join(platform, 'cernanto.json'), '{"folders":["cernanto"]}\n');
    // The view the dev verb lays: one link per part.
    const view = join(root, 'view');
    mkdirSync(view);
    symlinkSync(join(platform, 'cernanto'), join(view, 'cernanto'), 'junction');
    assert.equal(releaseWorkspace(view), realpathSync(platform));
    // The tree is its own workspace, and a release without the tree
    // answers its root.
    assert.equal(releaseWorkspace(platform), realpathSync(platform));
    assert.equal(releaseWorkspace(join(root, 'nowhere')), join(root, 'nowhere'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
