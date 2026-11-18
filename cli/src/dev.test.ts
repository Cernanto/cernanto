// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

import { saveContext } from './context.js';
import {
  detectCoder,
  ensureCompileHarness,
  planeHarness,
  releaseWorkspace,
  resetNativeDev,
  setupHarness,
  startBoxWhenNeeded,
  startNativeDev,
  stopNativeDev,
} from './dev.js';
import { planeFetch, whenLoopbackDown } from './gateway-client.js';
import { homeEnvironment } from './programs.js';
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
    // The command held the host by its handle and saw it end: its
    // record names the host no more, so a pid the system hands to
    // another program later is nobody's.
    const record = JSON.parse(readFileSync(join(root, 'dev.json'), 'utf8')) as {
      pids?: { host?: number };
    };
    assert.equal(record.pids?.host, undefined, 'the record names no host that ended');
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

/** A plane's folder whose block stands in and writes down every word
 * it is said: its stop succeeds, its measure answers the word given
 * for the host this verb recorded, and its end of that host succeeds
 * or fails in the words given. `untold`: the record has the host's pid
 * and no start, as a start cut short between the two leaves it. */
function recordedHostPlane(
  hostPid: number,
  measure: 'same' | 'unknown',
  endWords: string | undefined,
  untold = false,
): { data: string; said: () => string[][] } {
  const root = mkdtempSync(join(tmpdir(), 'cernanto-host-end-'));
  layReleaseLayout(root);
  const data = join(root, 'plane');
  mkdirSync(join(data, 'journals'), { recursive: true });
  writeFileSync(join(data, 'journals/journal'), 'what the plane holds');
  writeFileSync(
    join(data, 'dev.json'),
    JSON.stringify({
      version: 4,
      id: 'plane-with-a-recorded-host',
      release: root,
      ports: { gateway: 7434 },
      pids: { host: hostPid },
      ...(untold ? {} : { host: { started: 'the-start', boot: 'boot-1' } }),
    }),
  );
  const log = join(root, 'said.log');
  mkdirSync(join(root, 'runtime/process/dist/agent'), { recursive: true });
  writeFileSync(
    join(root, 'runtime/process/dist/agent/bin.js'),
    `import { appendFileSync } from 'node:fs';
const words = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(words) + '\\n');
const endWords = ${JSON.stringify(endWords ?? null)};
if (words.includes('--stop')) process.exit(0);
else if (words.includes('--measure')) {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    const asked = JSON.parse(input);
    process.stdout.write(JSON.stringify({
      boot: 'boot-1',
      processes: asked.map((one) => ({ pid: one.pid, answer: ${JSON.stringify(measure)}, started: 'the-start' })),
    }));
  });
} else if (words.includes('--end')) {
  if (endWords !== null) process.stderr.write('cernanto-agent: ' + endWords + '\\n');
  process.exitCode = endWords === null ? 0 : 1;
} else process.exit(3);
`,
  );
  return {
    data,
    said: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as string[]),
  };
}

test("the host this command recorded, still there after the block's stop, is ended by the block's word, at once under a reset and a term first under a plain stop, and the block's stop is asked again after it; a host the block cannot vouch for keeps the plane's data", async () => {
  const host = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(host, 'spawn');
  const pid = String(host.pid);
  try {
    // A plain stop: the block's end with no word before the pid. A
    // host that lived through the block's stop may have started copies
    // after it, so the block's stop is asked once more after its end:
    // copies are stopped by their records only once their host is dead.
    const down = recordedHostPlane(host.pid ?? 0, 'same', undefined);
    await stopNativeDev({ say: () => undefined, dataDir: down.data });
    assert.deepEqual(down.said(), [
      ['--stop'],
      ['--measure'],
      ['--end', pid, 'the-start', 'boot-1'],
      ['--stop'],
    ]);
    rmSync(join(down.data, '..'), { recursive: true, force: true });

    // A reset has no grace: the end is asked at once, and the data leaves.
    const reset = recordedHostPlane(host.pid ?? 0, 'same', undefined);
    const words: string[] = [];
    await resetNativeDev({ say: (line) => words.push(line), dataDir: reset.data }, false);
    assert.deepEqual(reset.said(), [
      ['--stop', '--grace', '0'],
      ['--measure'],
      ['--end', '--at-once', pid, 'the-start', 'boot-1'],
      ['--stop', '--grace', '0'],
    ]);
    assert.ok(words.includes('the local plane data was removed'));
    rmSync(join(reset.data, '..'), { recursive: true, force: true });

    // The block cannot vouch for the host: its end sends nothing and
    // fails in its own words, the reset fails with them, and nothing
    // of the plane's data is removed over a host that may still run.
    const unvouched = recordedHostPlane(
      host.pid ?? 0,
      'unknown',
      `the process ${pid} is there and no read tells whether it is the record's: nothing was sent`,
    );
    const kept: string[] = [];
    await assert.rejects(
      resetNativeDev({ say: (line) => kept.push(line), dataDir: unvouched.data }, false),
      new RegExp(
        `^Error: the local plane's host \\(pid ${pid}\\) could not be ended: the process ${pid} is there and no read tells whether it is the record's: nothing was sent; the plane's data is kept as it is$`,
      ),
    );
    assert.ok(existsSync(join(unvouched.data, 'journals/journal')), "the plane's data stays");
    assert.ok(!kept.includes('the local plane data was removed'));
    rmSync(join(unvouched.data, '..'), { recursive: true, force: true });
  } finally {
    host.kill('SIGKILL');
  }
});

test("a record that names the host's pid and no start decides nothing here: the block is asked, and while a process is at the pid the stop fails, the record goes on naming it and a reset removes nothing; once the pid is free the reset goes on", async () => {
  const host = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(host, 'spawn');
  const pid = String(host.pid);
  const recorded = (data: string): unknown =>
    (JSON.parse(readFileSync(join(data, 'dev.json'), 'utf8')) as { pids?: { host?: number } }).pids
      ?.host;
  // What the block says of a process it is handed with no start.
  const blockWords = `the process ${pid} is there and no read tells whether it is the record's: nothing was sent`;
  const refusal = new RegExp(
    `^Error: the local plane's host \\(pid ${pid}\\) could not be ended: ${blockWords} \\(this command's record of the host has no start to know it by: the stop goes on once no process is at the pid ${pid}\\); the plane's data is kept as it is$`,
  );
  const plane = recordedHostPlane(host.pid ?? 0, 'unknown', blockWords, true);
  try {
    // The reset: the block's stop found nothing of the plane, a process
    // is at the recorded pid, and nothing tells whose it is.
    const said: string[] = [];
    await assert.rejects(
      resetNativeDev({ say: (line) => said.push(line), dataDir: plane.data }, false),
      refusal,
    );
    assert.ok(existsSync(join(plane.data, 'journals/journal')), "the plane's data stays");
    assert.ok(!said.includes('the local plane data was removed'));
    assert.ok(!said.some((line) => line.includes('is stopped')), 'and nothing is called stopped');
    assert.equal(recorded(plane.data), host.pid, 'the record goes on naming the host');
    assert.doesNotThrow(() => process.kill(host.pid ?? 0, 0), 'the process was sent nothing');
    // The pid went to the block with the start and the boot the record
    // has, which is none: the block's answer is the stop's.
    assert.deepEqual(
      plane.said().filter((words) => words.includes('--end')),
      [['--end', '--at-once', pid, '', '']],
    );

    // A plain stop the same.
    await assert.rejects(stopNativeDev({ say: () => undefined, dataDir: plane.data }), refusal);
    assert.equal(recorded(plane.data), host.pid);
    assert.deepEqual(
      plane
        .said()
        .filter((words) => words.includes('--end'))
        .at(-1),
      ['--end', pid, '', ''],
    );
  } finally {
    host.kill('SIGKILL');
    await once(host, 'exit');
  }

  // No process is at the pid any more: there is nothing to ask the
  // block about, and the reset goes on.
  const asked = plane.said().filter((words) => words.includes('--end')).length;
  const words: string[] = [];
  await resetNativeDev({ say: (line) => words.push(line), dataDir: plane.data }, false);
  assert.ok(words.includes('the local plane data was removed'));
  assert.equal(existsSync(plane.data), false);
  assert.equal(plane.said().filter((line) => line.includes('--end')).length, asked);
  rmSync(join(plane.data, '..'), { recursive: true, force: true });
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
  // The stop says what stands and where to go, ends nothing of a plane
  // whose processes this version does not know, and keeps the data.
  const down: string[] = [];
  await stopNativeDev({ say: (line) => down.push(line), dataDir: data });
  assert.match(down[0] ?? '', fact);
  assert.match(down[0] ?? '', pointer);
  assert.equal(
    down.at(-1),
    'what of that plane still runs is not known to this version and is left as it is; its data is retained',
  );
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
