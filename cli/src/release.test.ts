// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import {
  composePackageManifest,
  platformFolderEntries,
  platformReleaseBodyOf,
  platformReleaseBytes,
  readCernPackage,
  registryBlobPath,
  sha256DigestOf,
  stampCernPackage,
  writeCernPackage,
} from '@cernanto/package-format';
import type { PlatformReleaseBody } from '@cernanto/package-format';

import { platformFolderOf } from './platform.js';
import { nodeArchiveOf } from './release-node.js';
import {
  RUNTIME_PACKAGE,
  installedRelease,
  installedRuntime,
  layOutRelease,
  leftOutAt,
  runtimePrefix,
  treeRelease,
  viewVersion,
} from './release.js';
import { CLI_VERSION } from './version.js';

const digestOf = (letter: string): string => `sha256:${letter.repeat(64)}`;

/** A platform release's body naming one package, by digests of a letter. */
function bodyOf(version: string, letter: string): PlatformReleaseBody {
  return platformReleaseBodyOf(version, [
    {
      id: 'cernanto/gateway',
      version,
      packageDigest: digestOf(letter),
      blobDigest: digestOf(letter),
    },
  ]);
}

/** A platform folder laid beside a runtime, as a pull lays it. */
function layPlatform(prefix: string, body: PlatformReleaseBody): void {
  const entries = platformFolderEntries(platformReleaseBytes(body), [
    { id: 'cernanto/gateway', bytes: Buffer.from('a package') },
  ]);
  for (const entry of entries) {
    const file = join(platformFolderOf(prefix), ...entry.path.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, entry.bytes);
  }
}

/** A runtime install as npm lays it: the runtime package with the runtime library, the
 * cli and the format kit hoisted beside it under the prefix, and none of the platform's
 * packages. The runtime package carries the tree's built release view tool, which the
 * layout runs, and the platform release given, the record at its root; the system
 * package it imports stands beside it as the tree's own. */
function fakeRuntime(prefix: string, version: string, named?: PlatformReleaseBody): void {
  const tree = treeRelease();
  assert.ok(tree !== undefined, 'the proof runs in the tree');
  for (const name of ['runtime', 'runtime-lib', 'package-format']) {
    const dir = join(prefix, 'node_modules', '@cernanto', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: `@cernanto/${name}`, version }),
    );
  }
  const cli = join(prefix, 'node_modules', 'cernanto');
  mkdirSync(cli, { recursive: true });
  writeFileSync(join(cli, 'package.json'), JSON.stringify({ name: 'cernanto', version }));
  const runtimePackage = join(prefix, 'node_modules', ...RUNTIME_PACKAGE.split('/'));
  if (named !== undefined) {
    writeFileSync(join(runtimePackage, 'platform-release.json'), platformReleaseBytes(named));
  }
  // The runner, whose presence says a release folder laid over this
  // runtime stands.
  mkdirSync(join(runtimePackage, 'dist', 'agent'), { recursive: true });
  writeFileSync(join(runtimePackage, 'dist', 'agent', 'bin.js'), '// the block\n');
  copyFileSync(
    join(tree, 'runtime', 'process', 'dist', 'release-view.js'),
    join(runtimePackage, 'dist', 'release-view.js'),
  );
  // The runtime's fit program as far as the cli reads it: it prints the
  // packages this machine leaves out, here the ones a proof names in the
  // file beside it, none without one, and the release folder it was asked
  // about. The runtime's own rule is proven with the runtime.
  writeFileSync(
    join(runtimePackage, 'dist', 'platform-fit.js'),
    [
      "const { existsSync, readFileSync } = require('node:fs');",
      "const { join } = require('node:path');",
      "const named = join(__dirname, 'platform-fit.json');",
      "const leftOut = existsSync(named) ? JSON.parse(readFileSync(named, 'utf8')) : [];",
      'process.stdout.write(`${JSON.stringify({ leftOut, release: process.argv[2] })}\\n`);',
      '',
    ].join('\n'),
  );
  // A junction where the system has them, which an ordinary account
  // there may make and a symbolic link it may not; the word means
  // nothing on the other systems.
  symlinkSync(
    realpathSync(join(tree, 'system')),
    join(prefix, 'node_modules', '@cernanto', 'system'),
    'junction',
  );
}

test('in the tree the release is the tree, and no runtime install is looked for', () => {
  const tree = treeRelease();
  assert.ok(tree !== undefined);
  assert.ok(existsSync(join(tree, 'runtime', 'process', 'package.json')));
  assert.ok(existsSync(join(tree, 'cernanto.json')));
});

test('a home without the runtime of this version has no installed runtime', () => {
  const home = mkdtempSync(join(tmpdir(), 'cern-release-'));
  assert.equal(installedRuntime(home), undefined);
  assert.equal(installedRelease(home), undefined);
  assert.equal(runtimePrefix('1.2.3', home), join(home, '.cernanto', 'runtime', '1.2.3'));
});

test('a release is installed once the runtime stands and the platform folder beside it holds the record the runtime carries', () => {
  const home = mkdtempSync(join(tmpdir(), 'cern-release-'));
  const prefix = runtimePrefix(CLI_VERSION, home);
  const named = bodyOf('0.5.3', 'a');
  // The runtime alone is no release: its platform is not pulled yet.
  fakeRuntime(prefix, CLI_VERSION, named);
  assert.equal(installedRuntime(home), prefix);
  assert.equal(installedRelease(home), undefined);
  // A platform folder of another release is not this runtime's.
  layPlatform(prefix, bodyOf('0.5.3', 'b'));
  assert.equal(installedRelease(home), undefined);
  layPlatform(prefix, named);
  assert.equal(installedRelease(home), prefix);
  // A runtime that carries no platform release is no release either.
  rmSync(prefix, { recursive: true });
  fakeRuntime(prefix, CLI_VERSION);
  layPlatform(prefix, named);
  assert.equal(installedRelease(home), undefined);
});

test('the view links every part of the tree layout into the runtime install and its platform folder, and relinks when it moves', () => {
  const home = mkdtempSync(join(tmpdir(), 'cern-release-'));
  const first = join(home, '.cernanto', 'runtime', 'a');
  fakeRuntime(first, '9.9.9', bodyOf('9.9.9', 'a'));
  layPlatform(first, bodyOf('9.9.9', 'a'));
  const view = layOutRelease(first, home);
  assert.equal(view, join(home, '.cernanto', 'release'));
  const real = (path: string): string => realpathSync(path);
  // On Windows the link is a junction, read back in the system's own
  // spelling: the target is compared resolved, which leaves a POSIX
  // path as it is.
  const linked = (path: string): string => resolve(readlinkSync(path));
  assert.equal(
    linked(join(view, 'runtime', 'process')),
    real(join(first, 'node_modules', '@cernanto', 'runtime')),
  );
  assert.equal(
    linked(join(view, 'runtime', 'lib')),
    real(join(first, 'node_modules', '@cernanto', 'runtime-lib')),
  );
  assert.equal(linked(join(view, 'cernanto')), join(real(platformFolderOf(first)), 'cernanto'));
  assert.ok(existsSync(join(view, 'cernanto', '.cern', 'gateway.cern')));
  assert.equal(
    readFileSync(join(view, 'cernanto.json'), 'utf8'),
    readFileSync(join(platformFolderOf(first), 'cernanto.json'), 'utf8'),
  );
  assert.equal(
    readFileSync(join(view, 'platform-release.json'), 'utf8'),
    platformReleaseBytes(bodyOf('9.9.9', 'a')).toString('utf8'),
  );
  assert.ok(existsSync(join(view, 'cli', 'package.json')));
  assert.ok(existsSync(join(view, 'format', 'package.json')));
  assert.equal(viewVersion(view), '9.9.9');
  const second = join(home, '.cernanto', 'runtime', 'b');
  fakeRuntime(second, '9.9.10', bodyOf('9.9.10', 'b'));
  layPlatform(second, bodyOf('9.9.10', 'b'));
  assert.equal(layOutRelease(second, home), view);
  assert.equal(
    linked(join(view, 'runtime', 'process')),
    real(join(second, 'node_modules', '@cernanto', 'runtime')),
  );
  assert.equal(linked(join(view, 'cernanto')), join(real(platformFolderOf(second)), 'cernanto'));
  assert.equal(
    readFileSync(join(view, 'platform-release.json'), 'utf8'),
    platformReleaseBytes(bodyOf('9.9.10', 'b')).toString('utf8'),
  );
  assert.equal(viewVersion(view), '9.9.10');
  assert.equal(viewVersion(join(home, 'nowhere')), undefined);
});

test('a server installed from npm pulls its platform and lays its release folder with one program, which run again pulls nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cern-release-'));
  const prefix = join(home, 'prefix');
  const spec = 'Answers the plane.\n';
  const contract = 'export declare function go(): Promise<void>;\n';
  const bytes = stampCernPackage(
    writeCernPackage({
      manifest: composePackageManifest({
        name: 'cernanto/gateway',
        version: '0.0.0',
        type: 'task',
        spec,
        contract,
        handlers: ['go'],
        provenance: {},
      }),
      spec,
      contract,
      code: { 'index.ts': 'export async function go(): Promise<void> {}\n' },
    }),
    { version: '9.9.9', publisher: 'cernanto' },
  );
  const packageDigest = readCernPackage(bytes).packageDigest;
  fakeRuntime(
    prefix,
    '9.9.9',
    platformReleaseBodyOf('9.9.9', [
      {
        id: 'cernanto/gateway',
        version: '9.9.9',
        packageDigest,
        blobDigest: sha256DigestOf(bytes),
      },
    ]),
  );
  let served = 0;
  const host = createServer((request, response) => {
    if (request.url === registryBlobPath(packageDigest)) {
      served += 1;
      response.end(bytes);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolveListening) => {
    host.listen(0, '127.0.0.1', resolveListening);
  });
  try {
    const address = host.address();
    assert.ok(address !== null && typeof address !== 'string');
    const folder = join(home, 'releases', '9.9.9');
    const install = (...args: string[]): Promise<{ stdout: string }> =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', join(import.meta.dirname, 'install-release.ts'), ...args],
        { encoding: 'utf8' },
      );
    const first = await install(prefix, folder, `http://127.0.0.1:${String(address.port)}`);
    assert.match(
      first.stdout,
      /pulling the platform release 9\.9\.9, 1 packages, from http:\/\/127\.0\.0\.1:\d+\n/,
    );
    assert.match(first.stdout, /the release is laid over /);
    assert.equal(
      readFileSync(join(folder, 'cernanto', '.cern', 'gateway.cern')).equals(bytes),
      true,
    );
    assert.equal(viewVersion(folder), '9.9.9');
    assert.equal(served, 1);
    // Run again, the platform is on the disk and nothing is pulled.
    const again = await install(prefix, folder, `http://127.0.0.1:${String(address.port)}`);
    assert.doesNotMatch(again.stdout, /pulling/);
    assert.equal(served, 1);
    // A SERVER HOLDS WHAT FITS IT: the program asks the runtime it was
    // installed with which packages this machine leaves out, for the
    // release folder it lays; a runtime that cannot say ends the install
    // in its words, and nothing is laid by guess.
    const fit = join(prefix, 'node_modules', ...RUNTIME_PACKAGE.split('/'), 'dist');
    assert.deepEqual(leftOutAt(prefix, folder), []);
    writeFileSync(join(fit, 'platform-fit.json'), JSON.stringify(['cernanto/gateway/absent']));
    assert.deepEqual(leftOutAt(prefix, folder), ['cernanto/gateway/absent']);
    const same = await install(prefix, folder, `http://127.0.0.1:${String(address.port)}`);
    assert.doesNotMatch(
      same.stdout,
      /pulling/,
      'a name the release lacks leaves the folder as laid',
    );
    writeFileSync(join(fit, 'platform-fit.json'), JSON.stringify({ leftOut: 'everything' }));
    assert.throws(
      () => leftOutAt(prefix, folder),
      /the runtime at .* did not say which packages fit this machine/,
    );
    writeFileSync(
      join(fit, 'platform-fit.js'),
      'process.stderr.write("no machine file\\n"); process.exit(1);\n',
    );
    assert.throws(
      () => leftOutAt(prefix, folder),
      /the runtime at .* could not say which packages fit this machine: no machine file/,
    );
    await assert.rejects(
      install(prefix, folder, `http://127.0.0.1:${String(address.port)}`),
      (error: { stderr?: string }) =>
        /could not say which packages fit this machine: no machine file/.test(error.stderr ?? ''),
    );
    // A use that is not its form is answered with the form in one line,
    // and --help with what the program does, as an answer.
    for (const words of [[prefix], [prefix, folder, 'a', 'b', 'c'], [prefix, '--what']]) {
      await assert.rejects(
        install(...words),
        (error: { stderr?: string }) =>
          error.stderr ===
          'usage: install-release <npm prefix> <release folder> [packages host] [node source]\n',
      );
    }
    const help = await install('--help');
    assert.match(help.stdout, /^install-release: completes a release on a server/);
    assert.ok(help.stdout.includes('  install-release <npm prefix> <release folder> '));
  } finally {
    host.close();
  }
});

test(
  "a server's release folder is laid whole with the facts the runtime states and the release's own Node, held to its checksum; a folder that is no release is never removed",
  { skip: nodeArchiveOf('v9.9.9') === undefined },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'cern-release-'));
    const named = bodyOf('9.9.9', 'a');
    const facts = {
      version: '9.9.9',
      packed: '2026-11-10T12:00:00.000Z',
      commit: 'abc1234',
      node: 'v9.9.9',
    };
    /** A prefix npm laid, its platform folder laid beside the runtime
     * as a lab lays it, and the release's facts in the runtime's
     * package. */
    const prefixOf = (name: string): string => {
      const prefix = join(home, name);
      fakeRuntime(prefix, '9.9.9', named);
      layPlatform(prefix, named);
      writeFileSync(
        join(prefix, 'node_modules', ...RUNTIME_PACKAGE.split('/'), 'release.json'),
        JSON.stringify(facts),
      );
      return prefix;
    };
    // A Node archive as nodejs.org lays one out: the binary, npm beside
    // it, under one folder named as the archive is.
    const archive = nodeArchiveOf('v9.9.9') ?? '';
    const made = join(home, 'node-archive');
    const root = join(made, archive.replace(/\.tar\.gz$/, ''));
    mkdirSync(join(root, 'bin'), { recursive: true });
    mkdirSync(join(root, 'lib', 'node_modules', 'npm', 'bin'), { recursive: true });
    writeFileSync(join(root, 'bin', 'node'), 'the node of this release\n');
    writeFileSync(join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), '// npm\n');
    writeFileSync(join(root, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'), '// npx\n');
    execFileSync('tar', [
      '-czf',
      join(made, archive),
      '-C',
      made,
      archive.replace(/\.tar\.gz$/, ''),
    ]);
    const archiveBytes = readFileSync(join(made, archive));
    const checksum = sha256DigestOf(archiveBytes).replace(/^sha256:/, '');
    let listed = checksum;
    const source = createServer((request, response) => {
      if (request.url === '/v9.9.9/SHASUMS256.txt') {
        response.end(`${'0'.repeat(64)}  another-file.tar.gz\n${listed}  ${archive}\n`);
        return;
      }
      if (request.url === `/v9.9.9/${archive}`) {
        response.end(archiveBytes);
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolveListening) => {
      source.listen(0, '127.0.0.1', resolveListening);
    });
    try {
      const address = source.address();
      assert.ok(address !== null && typeof address !== 'string');
      const at = `http://127.0.0.1:${String(address.port)}`;
      const install = (...args: string[]): Promise<{ stdout: string }> =>
        promisify(execFile)(
          process.execPath,
          ['--import', 'tsx', join(import.meta.dirname, 'install-release.ts'), ...args],
          { encoding: 'utf8' },
        );
      const refusal = async (...args: string[]): Promise<string> => {
        try {
          await install(...args);
        } catch (error) {
          return (error as { stderr?: string }).stderr ?? '';
        }
        assert.fail('the install was expected to refuse');
      };
      // The platform folder stands beside the runtime, so no packages
      // host is asked; the release's Node comes from the source named.
      const folder = join(home, 'releases', '9.9.9');
      const laid = await install(prefixOf('first'), folder, at, at);
      assert.doesNotMatch(laid.stdout, /pulling/);
      assert.match(laid.stdout, /laying the release's own Node v9\.9\.9, from http:/);
      assert.match(laid.stdout, /the release is laid over /);
      assert.equal(readFileSync(join(folder, 'bin', 'node'), 'utf8'), 'the node of this release\n');
      assert.equal(
        readlinkSync(join(folder, 'bin', 'npm')),
        join('..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      );
      assert.equal(readFileSync(join(folder, 'bin', 'npx'), 'utf8'), '// npx\n');
      // The release folder states the facts the runtime's package
      // carries, beside the place it is laid over.
      const stated = JSON.parse(readFileSync(join(folder, 'release.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      assert.deepEqual(
        [stated['version'], stated['packed'], stated['commit'], stated['node']],
        [facts.version, facts.packed, facts.commit, facts.node],
      );
      assert.ok(existsSync(join(folder, 'cernanto', '.cern', 'gateway.cern')));
      assert.ok(!existsSync(`${folder}.part`));
      // Run again, the release stands and nothing of it is touched.
      const again = await install(prefixOf('first-again'), folder, at, at);
      assert.match(again.stdout, /the release stands and is left as it is/);
      // An archive that fails its checksum lays no release folder at all.
      listed = 'f'.repeat(64);
      const unlaid = join(home, 'releases', 'unlaid');
      assert.match(
        await refusal(prefixOf('second'), unlaid, at, at),
        /hashes to [a-f0-9]{64}, and its list of checksums names f{64}; no Node was laid/,
      );
      assert.ok(!existsSync(unlaid));
      // A folder that stands and is no release is the operator's: it is
      // refused in words and nothing in it is removed.
      const theirs = join(home, 'releases', 'theirs');
      mkdirSync(theirs);
      writeFileSync(join(theirs, 'kept.txt'), 'theirs');
      assert.match(
        await refusal(prefixOf('third'), theirs, at, at),
        /stands and holds no release; remove it, or name another folder/,
      );
      assert.equal(readFileSync(join(theirs, 'kept.txt'), 'utf8'), 'theirs');
    } finally {
      source.close();
    }
  },
);

test('the view tool refuses a folder that is no platform folder, in words', () => {
  const home = mkdtempSync(join(tmpdir(), 'cern-release-'));
  const prefix = join(home, '.cernanto', 'runtime', 'a');
  fakeRuntime(prefix, '9.9.9', bodyOf('9.9.9', 'a'));
  const tool = join(
    prefix,
    'node_modules',
    ...RUNTIME_PACKAGE.split('/'),
    'dist',
    'release-view.js',
  );
  const empty = join(home, 'empty');
  mkdirSync(empty);
  assert.throws(
    () =>
      execFileSync(process.execPath, [tool, prefix, join(home, 'view'), empty], { stdio: 'pipe' }),
    (error: { stderr?: Buffer }) =>
      /holds no cernanto: it is not a platform folder/.test(error.stderr?.toString() ?? ''),
  );
  assert.throws(
    () => layOutRelease(prefix, home),
    'a runtime whose platform was never pulled has no view',
  );
});
