// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  composePackageManifest,
  platformReleaseBodyOf,
  platformReleaseBytes,
  platformReleaseDigestOf,
  readCernPackage,
  readPlatformRelease,
  registryBlobPath,
  sha256DigestOf,
  stampCernPackage,
  writeCernPackage,
} from '@cernanto/package-format';

import {
  installPlatform,
  installedPlatform,
  platformFolderOf,
  platformLaidFor,
  platformOfMachine,
  platformOfRuntime,
} from './platform.js';
import type { PlatformRecord } from './platform.js';
import { RegistryClient } from './registry.js';

const INDEX = 'https://packages.test';

/** One platform package, stamped as a release stamps it. */
function packageOf(id: string, version: string, words = id): Buffer {
  const spec = `# ${id}\n\n${words}.\n`;
  const contract = 'export declare function run(): Promise<void>;\n';
  const bytes = writeCernPackage({
    manifest: composePackageManifest({
      name: id,
      version: '0.0.0',
      type: 'task',
      spec,
      contract,
      handlers: ['run'],
      provenance: {},
    }),
    spec,
    contract,
    code: { 'index.ts': Buffer.from('export async function run() {}\n') },
  });
  return stampCernPackage(bytes, { version, publisher: 'cernanto' });
}

interface Registry {
  /** The blobs the packages host serves, by path; a path with none
   * answers 404. */
  files: Map<string, Buffer>;
  /** Every path fetched, in order. */
  fetched: string[];
  client: RegistryClient;
  /** The platform release of two packages, as a runtime carries it. */
  platform: PlatformRecord;
  packages: Record<string, Buffer>;
  down: boolean;
}

/** A registry's packages host as static files behind a fetch of its
 * own, serving the blobs of one platform release of two packages. */
function registryWith(version: string): Registry {
  const packages: Record<string, Buffer> = {
    'cernanto/auth': packageOf('cernanto/auth', version),
    'cernanto/compile/judge': packageOf('cernanto/compile/judge', version),
  };
  const body = platformReleaseBodyOf(
    version,
    Object.entries(packages).map(([id, bytes]) => ({
      id,
      version,
      packageDigest: readCernPackage(bytes).packageDigest,
      blobDigest: sha256DigestOf(bytes),
    })),
  );
  const files = new Map<string, Buffer>();
  const fetched: string[] = [];
  for (const [id, bytes] of Object.entries(packages)) {
    const entry = body.packages.find((one) => one.id === id);
    assert.ok(entry !== undefined);
    files.set(registryBlobPath(entry.packageDigest), bytes);
  }
  const registry: Registry = {
    files,
    fetched,
    platform: { body, digest: platformReleaseDigestOf(body), bytes: platformReleaseBytes(body) },
    packages,
    down: false,
    client: new RegistryClient(
      { gateUrl: 'https://registry.test', indexUrl: INDEX },
      undefined,
      (input: string | URL | Request) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (registry.down) return Promise.reject(new TypeError('fetch failed'));
        const path = url.slice(INDEX.length);
        fetched.push(path);
        const file = files.get(path);
        return Promise.resolve(
          file === undefined
            ? new Response('', { status: 404 })
            : new Response(new Uint8Array(file), { status: 200 }),
        );
      },
    ),
  };
  return registry;
}

function scratchPrefix(): string {
  const prefix = join(mkdtempSync(join(tmpdir(), 'cern-platform-')), 'runtime', '0.5.3');
  mkdirSync(prefix, { recursive: true });
  return prefix;
}

test("the platform install pulls every package the runtime's record names from the registry, holds every byte to the record, and lays the platform folder", async () => {
  const registry = registryWith('0.5.3');
  const prefix = scratchPrefix();
  const said: string[] = [];
  assert.equal(installedPlatform(prefix, registry.platform), undefined);
  const folder = await installPlatform(prefix, registry.platform, registry.client, (line) =>
    said.push(line),
  );
  assert.equal(folder, platformFolderOf(prefix));
  assert.equal(installedPlatform(prefix, registry.platform), folder);
  assert.deepEqual(said, [
    `pulling the platform release 0.5.3, 2 packages, from ${INDEX}`,
    'the platform release 0.5.3 is installed',
  ]);
  // The folder is the layout a pack of a release writes: the marker, the
  // record in its canonical bytes, each package at the place its id
  // names, and no spec beside any.
  assert.equal(
    readFileSync(join(folder, 'cernanto.json'), 'utf8'),
    '{"version":1,"folders":["cernanto"]}\n',
  );
  assert.equal(
    readFileSync(join(folder, 'platform-release.json')).equals(registry.platform.bytes),
    true,
  );
  assert.equal(
    readFileSync(join(folder, 'cernanto', '.cern', 'auth.cern')).equals(
      registry.packages['cernanto/auth'] ?? Buffer.alloc(0),
    ),
    true,
  );
  assert.ok(existsSync(join(folder, 'cernanto', 'compile', '.cern', 'judge.cern')));
  assert.ok(!existsSync(join(folder, 'cernanto', 'auth.cern.md')));
  assert.ok(!existsSync(`${folder}.part`));
  // The blobs alone are asked of the registry, each by its digest.
  assert.deepEqual(
    [...registry.fetched].sort(),
    registry.platform.body.packages.map((one) => registryBlobPath(one.packageDigest)).sort(),
  );
  // Installed, the folder is read off the disk alone.
  const before = registry.fetched.length;
  assert.equal(installedPlatform(prefix, registry.platform), folder);
  assert.equal(registry.fetched.length, before);
  // A folder laid for another release is not this runtime's.
  const other = registryWith('0.5.4');
  assert.equal(installedPlatform(prefix, other.platform), undefined);
});

test("a machine pulls the packages that fit it: the ones it leaves out are never asked of the registry, and the folder is laid under the record of what it holds, a part of the runtime's", async () => {
  const registry = registryWith('0.5.3');
  const prefix = scratchPrefix();
  const said: string[] = [];
  const leftOut = ['cernanto/compile/judge', 'cernanto/absent'];
  const folder = await installPlatform(
    prefix,
    registry.platform,
    registry.client,
    (line) => said.push(line),
    leftOut,
  );
  assert.deepEqual(said, [
    `pulling the platform release 0.5.3, 1 packages, from ${INDEX}`,
    'the platform release 0.5.3 is installed',
  ]);
  // The package left out is neither pulled nor laid.
  const judge = registry.platform.body.packages.find((one) => one.id === 'cernanto/compile/judge');
  assert.ok(judge !== undefined);
  assert.equal(registry.fetched.includes(registryBlobPath(judge.packageDigest)), false);
  assert.ok(existsSync(join(folder, 'cernanto', '.cern', 'auth.cern')));
  assert.ok(!existsSync(join(folder, 'cernanto', 'compile', '.cern', 'judge.cern')));
  // The folder's record names what the folder holds, in the record's own
  // form: the landing reads a folder by its record and refuses one that
  // holds more or less.
  const machine = platformOfMachine(registry.platform, leftOut);
  assert.deepEqual(
    machine.body.packages.map((one) => one.id),
    ['cernanto/auth'],
  );
  assert.equal(
    readFileSync(join(folder, 'platform-release.json')).equals(machine.bytes),
    true,
    "the folder's record is the machine's",
  );
  assert.deepEqual(readPlatformRelease(machine.bytes).digest, machine.digest);
  // The runtime's platform is installed: its record less what a machine
  // leaves out. Read off the disk alone.
  assert.equal(installedPlatform(prefix, registry.platform), folder);
  // Laid for this machine, and for no machine that leaves out another
  // set: an install on that one pulls again.
  assert.equal(platformLaidFor(prefix, registry.platform, leftOut), folder);
  assert.equal(platformLaidFor(prefix, registry.platform, ['cernanto/auth']), undefined);
  assert.equal(platformLaidFor(prefix, registry.platform, []), undefined);
  // A whole folder, a release proven from a pack of the tree, is laid
  // for every machine: a plane that holds every implementor binds the
  // one that fits.
  const whole = scratchPrefix();
  await installPlatform(whole, registry.platform, registry.client, () => undefined);
  assert.equal(platformLaidFor(whole, registry.platform, leftOut), platformFolderOf(whole));
  assert.equal(platformLaidFor(whole, registry.platform, []), platformFolderOf(whole));
  // A machine that leaves nothing out holds the record itself.
  assert.equal(platformOfMachine(registry.platform, []).digest, registry.platform.digest);
});

test('a registry that does not answer, or a package that does not match the record, is refused with its name, its digest and the host, and no platform is laid', async () => {
  // The registry is out of reach.
  const down = registryWith('0.5.3');
  down.down = true;
  const first = scratchPrefix();
  await assert.rejects(
    installPlatform(first, down.platform, down.client, () => undefined),
    /cernanto\/(auth|compile\/judge) 0\.5\.3 \(sha256:[a-f0-9]{64}\) could not be pulled from https:\/\/packages\.test: fetch failed; cernanto dev pulls again/,
  );
  assert.ok(!existsSync(platformFolderOf(first)));
  // A blob's bytes are another package's: a package that reads, under
  // the wrong digest.
  const swapped = registryWith('0.5.3');
  const auth = swapped.platform.body.packages.find((one) => one.id === 'cernanto/auth');
  assert.ok(auth !== undefined);
  swapped.files.set(
    registryBlobPath(auth.packageDigest),
    packageOf('cernanto/auth', '0.5.3', 'another page'),
  );
  const second = scratchPrefix();
  await assert.rejects(
    installPlatform(second, swapped.platform, swapped.client, () => undefined),
    /cernanto\/auth 0\.5\.3 from https:\/\/packages\.test does not match the platform release: its bytes hash to sha256:[a-f0-9]{64}, the release names sha256:[a-f0-9]{64}; nothing was installed/,
  );
  assert.ok(!existsSync(platformFolderOf(second)));
  // A blob cut short in transit.
  const cut = registryWith('0.5.3');
  const judge = cut.platform.body.packages.find((one) => one.id === 'cernanto/compile/judge');
  assert.ok(judge !== undefined);
  cut.files.set(
    registryBlobPath(judge.packageDigest),
    (cut.packages['cernanto/compile/judge'] ?? Buffer.alloc(0)).subarray(0, 700),
  );
  const third = scratchPrefix();
  await assert.rejects(
    installPlatform(third, cut.platform, cut.client, () => undefined),
    /cernanto\/compile\/judge 0\.5\.3 from https:\/\/packages\.test does not match the platform release/,
  );
  assert.ok(!existsSync(platformFolderOf(third)));
  // A blob the host lacks.
  const absent = registryWith('0.5.3');
  absent.files.delete(registryBlobPath(auth.packageDigest));
  const fourth = scratchPrefix();
  await assert.rejects(
    installPlatform(fourth, absent.platform, absent.client, () => undefined),
    /cernanto\/auth 0\.5\.3 \(sha256:[a-f0-9]{64}\) could not be pulled from https:\/\/packages\.test: .*answered 404; cernanto dev pulls again/,
  );
  assert.ok(!existsSync(platformFolderOf(fourth)));
  // The same pull against the whole registry lays the platform: a
  // failed pull left nothing in its way.
  absent.files.set(
    registryBlobPath(auth.packageDigest),
    absent.packages['cernanto/auth'] ?? Buffer.alloc(0),
  );
  await installPlatform(fourth, absent.platform, absent.client, () => undefined);
  assert.equal(installedPlatform(fourth, absent.platform), platformFolderOf(fourth));
});

test('the platform release a runtime carries is the record at its root; a package that carries none, or one that does not read as a record, answers nothing', () => {
  const registry = registryWith('0.5.3');
  const runtimePackage = mkdtempSync(join(tmpdir(), 'cern-runtime-package-'));
  assert.equal(platformOfRuntime(runtimePackage), undefined);
  writeFileSync(join(runtimePackage, 'platform-release.json'), registry.platform.bytes);
  assert.deepEqual(platformOfRuntime(runtimePackage), registry.platform);
  // The same record written another way is not the record: it is read
  // in its one canonical form or not at all.
  writeFileSync(
    join(runtimePackage, 'platform-release.json'),
    JSON.stringify(registry.platform.body),
  );
  assert.equal(platformOfRuntime(runtimePackage), undefined);
  writeFileSync(join(runtimePackage, 'platform-release.json'), 'not a record');
  assert.equal(platformOfRuntime(runtimePackage), undefined);
});
