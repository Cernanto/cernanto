// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CernantoError, composePackageManifest, writeCernPackage } from '@cernanto/package-format';
import type { PackageManifest } from '@cernanto/package-format';

import { CODE, CONTRACT, SPEC, TEST } from '../agent-package.fixture.js';
import { fakeCompileClient, progressOf, responseOf } from './plane.fixture.js';
import { assertTargetsExist, packWorkspace, planeCompile } from './upload.js';
import type { CompileClient } from './upload.js';

test('packWorkspace uploads specs relative to the workspace root and skips vendored trees', () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-'));
  mkdirSync(join(root, 'ops'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.md'), '# Greeter\n');
  mkdirSync(join(root, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'junk', 'index.js'), 'x');
  mkdirSync(join(root, '.cache'), { recursive: true });
  writeFileSync(join(root, '.cache', 'blob'), 'x');
  const files = packWorkspace(root);
  assert.deepEqual(Object.keys(files).sort(), ['ops/greeter.md']);
  assert.equal(Buffer.from(files['ops/greeter.md'] ?? '', 'base64').toString(), '# Greeter\n');
});

test("packWorkspace carries the marker's folders alone, and never a workspace nested below the root", () => {
  const repo = mkdtempSync(join(tmpdir(), 'pack-marked-'));
  writeFileSync(join(repo, 'cernanto.json'), '{"version": 1, "folders": ["cernanto"]}\n');
  mkdirSync(join(repo, 'cernanto', 'gateway'), { recursive: true });
  writeFileSync(join(repo, 'cernanto', 'gateway.cern.md'), '# Gateway\n');
  writeFileSync(join(repo, 'cernanto', 'gateway', 'openapi.yaml'), 'openapi: 3.1.0\n');
  mkdirSync(join(repo, 'cli', 'src'), { recursive: true });
  writeFileSync(join(repo, 'cli', 'src', 'main.ts'), 'export {};\n');
  writeFileSync(join(repo, 'README.md'), '# The repository\n');
  assert.deepEqual(Object.keys(packWorkspace(repo)).sort(), [
    'cernanto/gateway.cern.md',
    'cernanto/gateway/openapi.yaml',
  ]);
  const whole = mkdtempSync(join(tmpdir(), 'pack-whole-'));
  writeFileSync(join(whole, 'cernanto.json'), '{"version": 1}\n');
  mkdirSync(join(whole, 'ops', 'inner'), { recursive: true });
  writeFileSync(join(whole, 'ops', 'x.cern.md'), '# X\n');
  writeFileSync(join(whole, 'ops', 'inner', 'cernanto.json'), '{"version": 1}\n');
  writeFileSync(join(whole, 'ops', 'inner', 'y.cern.md'), '# Y\n');
  assert.deepEqual(Object.keys(packWorkspace(whole)).sort(), ['cernanto.json', 'ops/x.cern.md']);
});

test('packWorkspace refuses an upload that is clearly not a spec workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-big-'));
  writeFileSync(join(root, 'blob.md'), Buffer.alloc(65 * 1024 * 1024));
  assert.throws(() => packWorkspace(root), /exceeds/);
});

test('planeCompile submits the workspace, reads the narration off the compile document, and writes back what the run learned', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-compile-'));
  mkdirSync(join(root, 'ops'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), '# Greeter\n\n\nGreet.\n');
  const client = fakeCompileClient({
    callId: 'inv-1',
    steps: [
      progressOf('att-1', 1, { step: 'plan', state: 'end', detail: '1 agent: ops/greeter' }),
      progressOf('att-1', 2, {
        step: 'agent',
        state: 'begin',
        detail: '0/1',
        subject: 'ops/greeter',
      }),
      // A step read twice (every read answers the whole narration) folds once.
      progressOf('att-1', 2, {
        step: 'agent',
        state: 'begin',
        detail: '0/1',
        subject: 'ops/greeter',
      }),
      // A retried attempt narrates again under its own sequence.
      progressOf('att-2', 1, { step: 'retry', state: 'note', detail: 'the plane retried' }),
      progressOf('att-2', 9, {
        step: 'done',
        state: 'end',
        detail: 'compile complete',
        ok: true,
      }),
    ],
    doneAfter: 3,
    response: responseOf({}),
  });
  const seen: string[] = [];
  let handles: { compileId: string; callId: string } | undefined;
  let taken: string | undefined;
  const response = await planeCompile(client, ['ops/greeter'], {
    compileId: 'compile-t',
    agentsRoot: root,
    recompile: true,
    failFast: true,
    dryRun: true,
    contracts: { 'ops/greeter': 'export declare function greet(): Promise<string>;' },
    onProgress: (step) =>
      seen.push(`${step.attemptId}:${String(step.seq)}:${step.step}:${step.detail}`),
    onSubmitted: (given) => {
      handles = given;
    },
    onTaken: (callId) => {
      taken = callId;
    },
    pollMs: 5,
  });
  assert.equal(response.status, 'ok');
  assert.equal(handles?.callId, 'inv-1');
  assert.equal(taken, 'inv-1', "the compile's own call id comes with its progress");
  // The request carried the packed workspace and the flags (recompile =
  // ignore the cache, fail-fast = zero fix rounds after a failing test
  // run, dry-run = the plans alone, the given contract as the plane's
  // field).
  const request = client.submitted[0] as {
    files: Record<string, string>;
    recompile?: boolean;
    planOnly?: boolean;
    maxLiveCycles?: number;
    contracts?: Record<string, string>;
  };
  assert.deepEqual(request.contracts, {
    'ops/greeter': 'export declare function greet(): Promise<string>;',
  });
  assert.ok(Object.keys(request.files).includes('ops/greeter.cern.md'));
  assert.equal(request.recompile, true);
  assert.equal(request.planOnly, true);
  assert.equal(request.maxLiveCycles, 0);
  // Every step reached the caller once, in the narration's order.
  assert.deepEqual(seen, [
    'att-1:1:plan:1 agent: ops/greeter',
    'att-1:2:agent:0/1',
    'att-2:1:retry:the plane retried',
    'att-2:9:done:compile complete',
  ]);
  // The narration was read until the compile ended, then taken once.
  assert.equal(client.progressReads, 4);
  assert.equal(client.taken, 1);
});

test("planeCompile ships the tree's packages by digest, names them in the request, and writes the compiled ones back", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-packages-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), '# Greeter\n\n\nGreet.\n');
  writeFileSync(join(root, 'ops', 'other.cern.md'), '# Other\n\n\nOther.\n');
  const previous = Buffer.from('the package in the tree');
  writeFileSync(join(root, 'ops', '.cern', 'greeter.cern'), previous);
  // A package with no spec beside it is an orphan: named and left out.
  writeFileSync(join(root, 'ops', '.cern', 'ghost.cern'), Buffer.from("nobody's"));
  // A file with a suffix of before is no spec: the package beside it
  // is an orphan like any other, and the file itself goes unmentioned.
  writeFileSync(join(root, 'ops', 'legacy.cerns.md'), '# Legacy\n\n\nKeep.\n');
  writeFileSync(join(root, 'ops', '.cern', 'legacy.cern'), Buffer.from('an old package'));
  const previousDigest = `sha256:${createHash('sha256').update(previous).digest('hex')}`;
  const compiled = Buffer.from('the package the compile composed');
  const builtDigest = `sha256:${createHash('sha256').update(compiled).digest('hex')}`;
  const otherBuilt = Buffer.from('another package');
  const otherDigest = `sha256:${createHash('sha256').update(otherBuilt).digest('hex')}`;
  const client = fakeCompileClient({
    callId: 'inv-p',
    stream: [],
    doneAfter: 2,
    response: responseOf({
      agents: [
        {
          agentId: 'ops/greeter',
          status: 'compiled',
          attempts: 1,
          triageCount: 0,
          costUsd: 0,
          package: builtDigest,
        },
        {
          agentId: 'ops/other',
          status: 'current',
          attempts: 0,
          triageCount: 0,
          costUsd: 0,
          package: otherDigest,
        },
        // A failed agent's package, when named, stays out of the tree.
        {
          agentId: 'ops/failed',
          status: 'failed',
          attempts: 1,
          triageCount: 0,
          costUsd: 0,
          package: otherDigest,
        },
      ],
    }),
  });
  client.store.set(builtDigest, compiled);
  client.store.set(otherDigest, otherBuilt);
  const lines: string[] = [];
  const written: { agentId: string; path: string; digest: string }[] = [];
  await planeCompile(client, ['ops/greeter', 'ops/other'], {
    compileId: 'compile-p',
    agentsRoot: root,
    pollMs: 1,
    onLine: (line) => lines.push(line),
    onPackageWritten: (entry) => written.push(entry),
  });
  // The tree's package went to the store under its digest and rode
  // the request by id; the orphan was named and not sent.
  assert.ok(client.store.has(previousDigest));
  const request = client.submitted[0] as { packages?: Record<string, string> };
  assert.deepEqual(request.packages, { 'ops/greeter': previousDigest });
  assert.deepEqual(lines, [
    'orphan package ops/.cern/ghost.cern: no spec beside it; remove it or restore the spec\n',
    'orphan package ops/.cern/legacy.cern: no spec beside it; remove it or restore the spec\n',
  ]);
  // The write-back: the compiled package replaced the tree's, the current
  // one landed beside its spec, the failed one did not.
  assert.equal(
    readFileSync(join(root, 'ops', '.cern', 'greeter.cern')).toString(),
    compiled.toString(),
  );
  assert.equal(
    readFileSync(join(root, 'ops', '.cern', 'other.cern')).toString(),
    otherBuilt.toString(),
  );
  assert.deepEqual(
    written.map(
      (entry) => `${entry.agentId} ${entry.digest === builtDigest ? 'compiled' : 'other'}`,
    ),
    ['ops/greeter compiled', 'ops/other other'],
  );
  assert.ok(!existsSync(join(root, 'ops', '.cern', 'failed.cern')));
  // A second deploy whose report names the digest already in the tree
  // writes nothing; a store that answers other bytes than the digest
  // names fails the compile in words, and the tree keeps what it had.
  const again = fakeCompileClient({
    callId: 'inv-q',
    stream: [],
    doneAfter: 2,
    response: responseOf({
      agents: [
        {
          agentId: 'ops/greeter',
          status: 'current',
          attempts: 0,
          triageCount: 0,
          costUsd: 0,
          package: builtDigest,
        },
        {
          agentId: 'ops/other',
          status: 'compiled',
          attempts: 1,
          triageCount: 0,
          costUsd: 0,
          package: 'sha256:0000',
        },
      ],
    }),
  });
  again.store.set(builtDigest, compiled);
  again.store.set(otherDigest, otherBuilt);
  again.store.set('sha256:0000', Buffer.from('not what the digest says'));
  const secondWritten: string[] = [];
  const secondLines: string[] = [];
  await assert.rejects(
    planeCompile(again, ['ops/greeter', 'ops/other'], {
      compileId: 'compile-q',
      agentsRoot: root,
      pollMs: 1,
      onLine: (line) => secondLines.push(line),
      onPackageWritten: (entry) => secondWritten.push(entry.agentId),
    }),
    /the plane answered other bytes than the digest the compile named for ops\/other \(sha256:[0-9a-f]+ is not sha256:0000\); the tree keeps what it had\. The compile itself ended ok on the plane, and its document stays there as compile compile-q: run the command again/,
  );
  // The failure is raised with the compile's document still on the plane:
  // it was read, never taken.
  assert.equal(again.taken, 0);
  assert.ok(again.progressReads >= 2);
  assert.deepEqual(secondWritten, []);
  assert.equal(
    readFileSync(join(root, 'ops', '.cern', 'other.cern')).toString(),
    otherBuilt.toString(),
  );
  assert.ok(secondLines.some((line) => line.startsWith('the package of ops/other did not verify')));
  // Both packages were already in the store: nothing was put again.
  assert.deepEqual((again.submitted[0] as { packages?: Record<string, string> }).packages, {
    'ops/greeter': builtDigest,
    'ops/other': otherDigest,
  });
});

test('a dry run writes no package: neither the one its answer names nor the row the plane shipped', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-dry-run-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), '# Greeter\n\n\nGreet.\n');
  const previous = Buffer.from('the package in the tree');
  writeFileSync(join(root, 'ops', '.cern', 'greeter.cern'), previous);
  const shipped = Buffer.from('the package the plane runs');
  const shippedDigest = `sha256:${createHash('sha256').update(shipped).digest('hex')}`;
  const client = fakeCompileClient({
    callId: 'inv-d',
    steps: [
      progressOf('att-1', 1, { step: 'done', state: 'end', detail: 'compile complete', ok: true }),
    ],
    doneAfter: 1,
    response: responseOf({
      agents: [
        {
          agentId: 'ops/greeter',
          status: 'current',
          attempts: 0,
          triageCount: 0,
          costUsd: 0,
          package: shippedDigest,
        },
      ],
    }),
  });
  client.store.set(shippedDigest, shipped);
  const written: string[] = [];
  const response = await planeCompile(client, ['ops/greeter'], {
    compileId: 'compile-d',
    agentsRoot: root,
    deploy: true,
    dryRun: true,
    pollMs: 1,
    onPackageWritten: (entry) => written.push(entry.agentId),
  });
  assert.equal(response.status, 'ok');
  assert.deepEqual(written, []);
  assert.deepEqual(readFileSync(join(root, 'ops', '.cern', 'greeter.cern')), previous);
});

test("a deploy keeps each compiled package beside its spec as its agent lands, before the compile's answer", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-landed-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), '# Greeter\n\n\nGreet.\n');
  writeFileSync(join(root, 'ops', 'other.cern.md'), '# Other\n\n\nOther.\n');
  const compiled = Buffer.from('the package the compile composed');
  const builtDigest = `sha256:${createHash('sha256').update(compiled).digest('hex')}`;
  // The narration: the greeter is done and compiled while the compile still
  // runs (the other agent is still compiling), and its row on the
  // fleet names the package it shipped.
  const client = fakeCompileClient({
    callId: 'inv-l',
    stream: [],
    doneAfter: 4,
    steps: [
      {
        ...progressOf('a1', 1, {
          step: 'agent',
          state: 'end',
          detail: 'verified live in dev',
          subject: 'ops/greeter',
          ok: true,
        }),
        result: 'compiled',
      },
    ],
    // The answer names no package: what the tree holds at the end came
    // from the landing, not from the answer.
    response: responseOf({
      agents: [
        { agentId: 'ops/greeter', status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0 },
        { agentId: 'ops/other', status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0 },
      ],
    }),
  });
  client.store.set(builtDigest, compiled);
  let rowReads = 0;
  client.rows = () => {
    rowReads += 1;
    return Promise.resolve([
      { agentId: 'ops/greeter', artifact: builtDigest, handlers: ['greet'], uses: [] },
    ]);
  };
  const written: { agentId: string; digest: string; atRead: number }[] = [];
  await planeCompile(client, ['ops/greeter', 'ops/other'], {
    compileId: 'compile-l',
    agentsRoot: root,
    deploy: true,
    pollMs: 1,
    onPackageWritten: (entry) =>
      written.push({ agentId: entry.agentId, digest: entry.digest, atRead: client.progressReads }),
  });
  // Written once, from the row, while the compile was still running.
  assert.equal(rowReads, 1);
  assert.deepEqual(
    written.map(
      (entry) =>
        `${entry.agentId} ${entry.digest === builtDigest ? 'compiled' : 'other'} at read ${String(entry.atRead)}`,
    ),
    ['ops/greeter compiled at read 1'],
  );
  assert.equal(
    readFileSync(join(root, 'ops', '.cern', 'greeter.cern')).toString(),
    compiled.toString(),
  );
  assert.ok(!existsSync(join(root, 'ops', '.cern', 'other.cern')));
});

test('a target with no spec under the workspace root fails before anything is uploaded', async () => {
  // A typo or a renamed spec fails at once, with where the deploy
  // looked.
  const root = mkdtempSync(join(tmpdir(), 'plane-missing-'));
  mkdirSync(join(root, 'fun'), { recursive: true });
  writeFileSync(join(root, 'fun', 'day-greeter.cern.md'), '# Day Greeter\n\n\nGreet.\n');
  assert.doesNotThrow(() => {
    assertTargetsExist(root, ['fun/day-greeter']);
  });
  assert.throws(() => {
    assertTargetsExist(root, ['text/word-count']);
  }, /no spec for "text\/word-count" under .* \(looked for .*text\/word-count\.cern\.md/);
  const client = fakeCompileClient({ callId: 'inv-m', stream: [], doneAfter: 1 });
  await assert.rejects(
    planeCompile(client, ['text/word-count'], { agentsRoot: root, pollMs: 1 }),
    /no spec for "text\/word-count"/,
  );
  assert.equal(client.submitted.length, 0, 'nothing was uploaded');
});

test("planeCompile surfaces a failed compile as the document's error", async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-fail-'));
  writeFileSync(join(root, 'x.cern.md'), '# X\n');
  const client = fakeCompileClient({
    callId: 'inv-x',
    doneAfter: 1,
    error: 'the compile failed: boom',
  });
  await assert.rejects(
    planeCompile(client, ['x'], { agentsRoot: root, pollMs: 1 }),
    /the compile failed: boom/,
  );
  assert.equal(client.taken, 1, 'the failure was read: the document leaves with it');
});

test('a read the gateway cannot answer for a moment is asked again, within the patience', async () => {
  // The gateway rolls under its own ship, a substrate hiccups: the
  // poll asks again instead of failing the deploy; a gateway that stays
  // silent past the patience fails it with the last refusal.
  const root = mkdtempSync(join(tmpdir(), 'plane-refused-'));
  writeFileSync(join(root, 'x.cern.md'), '# X\n');
  let reads = 0;
  const client: CompileClient = {
    packageExists: () => Promise.resolve(true),
    packagePut: () => Promise.resolve(),
    packageGet: () => Promise.reject(new Error('no store here')),
    land: () => Promise.reject(new Error('no landing here')),
    compile: () => Promise.resolve({ callId: 'inv-r' }),
    deploy: () => Promise.resolve({ callId: 'inv-r' }),
    compileProgress: (compileId) => {
      reads += 1;
      if (reads < 3) return Promise.reject(new Error('fetch failed'));
      return Promise.resolve({
        compileId,
        callId: 'inv-r',
        status: 'done' as const,
        steps: [progressOf('att-1', 1, { step: 'plan', state: 'end', detail: '1 agent: x' })],
        answer: responseOf() as never,
      });
    },
    callsStream: () => () => undefined,
  };
  const seen: number[] = [];
  await planeCompile(client, ['x'], {
    agentsRoot: root,
    pollMs: 1,
    compileId: 'compile-r',
    onProgress: (step) => seen.push(step.seq),
  });
  assert.deepEqual(seen, [1]);
  assert.ok(reads >= 3, 'the refused reads were asked again');
  let silent = 0;
  const down: CompileClient = {
    ...client,
    compileProgress: () => {
      silent += 1;
      return Promise.reject(new Error('fetch failed'));
    },
  };
  await assert.rejects(
    planeCompile(down, ['x'], {
      agentsRoot: root,
      pollMs: 1,
      patienceMs: 30,
      compileId: 'compile-s',
    }),
    /fetch failed/,
  );
  assert.ok(silent >= 1);
});

test('a compile the plane accepted that ended before it wrote anything ends the deploy at once, in words: the refused read is final, whether it comes first or behind a wait', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-gone-'));
  writeFileSync(join(root, 'x.cern.md'), '# X\n');
  for (const waits of [0, 2]) {
    let reads = 0;
    const client: CompileClient = {
      packageExists: () => Promise.resolve(true),
      packagePut: () => Promise.resolve(),
      packageGet: () => Promise.reject(new Error('no store here')),
      land: () => Promise.reject(new Error('no landing here')),
      compile: () => Promise.resolve({ callId: 'cernanto_compile::k-compile-g' }),
      deploy: () => Promise.resolve({ callId: 'cernanto_compile::k-compile-g' }),
      // The compile's call stands for the first reads, then stands no
      // more, and no document was ever written.
      compileProgress: (compileId) => {
        reads += 1;
        if (reads <= waits) {
          return Promise.resolve({
            compileId,
            callId: 'cernanto_compile::k-compile-g',
            status: 'waiting' as const,
            steps: [],
          });
        }
        return Promise.reject(
          new CernantoError({ kind: 'terminal', message: `no compile "${compileId}"` }),
        );
      },
      callsStream: () => () => undefined,
    };
    const began = Date.now();
    await assert.rejects(
      planeCompile(client, ['x'], {
        agentsRoot: root,
        pollMs: 1,
        patienceMs: 60_000,
        compileId: 'compile-g',
      }),
      /^CernantoError: the compile ended before it wrote anything: it was cancelled before a compiler took it, or its compiler stopped as it began$/,
    );
    assert.equal(reads, waits + 1, 'the refusal was not asked again');
    assert.ok(Date.now() - began < 10_000, 'the deploy did not wait out its patience');
  }
});

test('a compile the plane stored and the compiler has not taken yet is waited for past the patience: every read names the call the start answered, nothing is said of the wait, and the compile is followed from the read that names the version that took it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-waiting-'));
  writeFileSync(join(root, 'x.cern.md'), '# X\n');
  let reads = 0;
  const named: (string | undefined)[] = [];
  const client: CompileClient = {
    packageExists: () => Promise.resolve(true),
    packagePut: () => Promise.resolve(),
    packageGet: () => Promise.reject(new Error('no store here')),
    land: () => Promise.reject(new Error('no landing here')),
    compile: () => Promise.resolve({ callId: 'cernanto_compile::k-compile-w' }),
    deploy: () => Promise.resolve({ callId: 'cernanto_compile::k-compile-w' }),
    // The compiler has not taken the compile for the first reads: the
    // compile has no document, its call still stands, and the plane says
    // it waits.
    compileProgress: (compileId, options) => {
      reads += 1;
      // The deploy's last read removes the document, and names no call.
      if (options?.take !== true) named.push(options?.call);
      if (reads < 4) {
        return Promise.resolve({
          compileId,
          callId: 'cernanto_compile::k-compile-w',
          status: 'waiting' as const,
          steps: [],
        });
      }
      return Promise.resolve({
        compileId,
        callId: 'cernanto_compile:7:k-compile-w',
        status: 'done' as const,
        steps: [progressOf('att-1', 1, { step: 'plan', state: 'end', detail: '1 agent: x' })],
        answer: responseOf() as never,
      });
    },
    callsStream: () => () => undefined,
  };
  const said: string[] = [];
  const ids: string[] = [];
  await planeCompile(client, ['x'], {
    agentsRoot: root,
    pollMs: 1,
    patienceMs: 30,
    compileId: 'compile-w',
    onLine: (line) => said.push(line),
    onSubmitted: (handles) => ids.push(handles.callId),
    onTaken: (callId) => ids.push(callId),
  });
  assert.ok(reads >= 4, 'the waiting compile was read again, past the patience');
  assert.deepEqual(
    [...new Set(named)],
    ['cernanto_compile::k-compile-w'],
    'every read names the call the start answered',
  );
  assert.deepEqual(
    said.filter((line) => line.includes('waits for the compiler')),
    [],
    'the wait is not said: the cli polls in silence',
  );
  assert.deepEqual(ids, ['cernanto_compile::k-compile-w', 'cernanto_compile:7:k-compile-w']);
});

test('a package answered under other bytes with the same manifest leaves the tree file as it is', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plane-same-content-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  writeFileSync(join(root, 'ops', 'greeter.cern.md'), SPEC);
  const packageWith = (provenance: PackageManifest['provenance']): Buffer =>
    writeCernPackage({
      manifest: composePackageManifest({
        name: 'ops/greeter',
        version: '0.0.0',
        type: 'task',
        spec: SPEC,
        contract: CONTRACT,
        handlers: ['greet'],
        provenance,
      }),
      spec: SPEC,
      contract: CONTRACT,
      code: { 'index.ts': CODE },
      tests: { 'greeter.test.ts': TEST },
    });
  const stamp = { at: '2026-11-04T10:00:00.000Z' };
  const inTree = packageWith({ doctrine: 'aaaaaaaaaaaa', verified: stamp });
  // The plane re-serialized the package: the same manifest under other
  // bytes (a tar may end in more zero blocks), so the same package.
  const respun = Buffer.concat([inTree, Buffer.alloc(1024)]);
  // Another provenance is another manifest, so another package: written.
  const reprovenanced = packageWith({ doctrine: 'bbbbbbbbbbbb', verified: stamp });
  // A new stamp is a new fact about the package: it is written.
  const restamped = packageWith({
    doctrine: 'aaaaaaaaaaaa',
    verified: { at: '2026-11-04T11:00:00.000Z' },
  });
  assert.notEqual(inTree.toString('hex'), respun.toString('hex'));
  writeFileSync(join(root, 'ops', '.cern', 'greeter.cern'), inTree);
  const digestOf = (bytes: Buffer): string =>
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const cases: { bytes: Buffer; written: boolean }[] = [
    { bytes: respun, written: false },
    { bytes: reprovenanced, written: true },
    { bytes: restamped, written: true },
  ];
  for (const [index, { bytes, written }] of cases.entries()) {
    const client = fakeCompileClient({
      callId: `inv-same-${String(index)}`,
      stream: [],
      doneAfter: 2,
      response: responseOf({
        agents: [
          {
            agentId: 'ops/greeter',
            status: 'current',
            attempts: 0,
            triageCount: 0,
            costUsd: 0,
            package: digestOf(bytes),
          },
        ],
      }),
    });
    client.store.set(digestOf(bytes), bytes);
    const writtenIds: string[] = [];
    await planeCompile(client, ['ops/greeter'], {
      compileId: `compile-same-${String(index)}`,
      agentsRoot: root,
      pollMs: 1,
      onPackageWritten: (entry) => writtenIds.push(entry.agentId),
    });
    assert.deepEqual(writtenIds, written ? ['ops/greeter'] : [], `case ${String(index)}`);
    const now = readFileSync(join(root, 'ops', '.cern', 'greeter.cern'));
    assert.ok(
      now.equals(written ? bytes : inTree),
      `case ${String(index)}: the tree holds the wrong bytes`,
    );
    if (written) writeFileSync(join(root, 'ops', '.cern', 'greeter.cern'), inTree);
  }
});
