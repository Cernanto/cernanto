// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  PLATFORM_RELEASE_FILE,
  isPlatformReleasePart,
  platformFolderEntries,
  platformReleaseBytes,
  platformReleaseDigestOf,
  platformReleaseWithout,
  readCernPackage,
  readPlatformRelease,
  registryBlobPath,
  sha256DigestOf,
} from '@cernanto/package-format';
import type { PlatformReleaseBody, PlatformReleasePackage } from '@cernanto/package-format';

import type { RegistryClient } from './registry.js';

// The platform's install. npmjs carries the runtime and nothing of the
// platform's packages: the runtime package carries THE PLATFORM RELEASE
// of its own version, the record that names every platform package by
// id and digest, and the packages themselves are the registry's, like
// any agent's. Installing a release is the runtime from npm and then
// this: the packages of the record THAT FIT THIS MACHINE pulled from
// the registry by their digests and held to the record, and the lot
// laid as THE PLATFORM FOLDER beside the runtime, in the layout a pack
// of a release writes, under a record that names what the folder holds.
// A machine leaves out the implementors of another system and another
// store, which the runtime it has just installed names, so its plane
// holds one implementor of each and binds it with nothing configured.
// The pull is part of installing a release and never of starting one:
// a folder once laid is read from the disk alone.

/** How many packages are pulled at once. */
const PULLS_AT_ONCE = 8;

/** A platform release as a runtime package carries it: the record, its
 * digest and its bytes. */
export interface PlatformRecord {
  body: PlatformReleaseBody;
  digest: string;
  bytes: Buffer;
}

/** The folder a runtime's platform is laid in, beside its npm install. */
export function platformFolderOf(prefix: string): string {
  return join(prefix, 'platform');
}

/** The platform release a runtime package carries, the record at its
 * root; nothing for a package that carries none, or one that does not
 * read. */
export function platformOfRuntime(runtimePackage: string): PlatformRecord | undefined {
  try {
    const bytes = readFileSync(join(runtimePackage, PLATFORM_RELEASE_FILE));
    return { ...readPlatformRelease(bytes), bytes };
  } catch {
    return undefined;
  }
}

/** The platform release as a machine holds it: the runtime's record
 * less the packages the machine leaves out. */
export function platformOfMachine(
  platform: PlatformRecord,
  leftOut: readonly string[],
): PlatformRecord {
  const body = platformReleaseWithout(platform.body, leftOut);
  return { body, digest: platformReleaseDigestOf(body), bytes: platformReleaseBytes(body) };
}

/** The record a platform folder is laid under, or nothing when the
 * prefix holds none that reads. */
function laidRecord(prefix: string): { body: PlatformReleaseBody; digest: string } | undefined {
  try {
    return readPlatformRelease(readFileSync(join(platformFolderOf(prefix), PLATFORM_RELEASE_FILE)));
  } catch {
    return undefined;
  }
}

/** The platform folder of a prefix, when it is laid and its record is
 * the runtime's as a machine holds it, whole or less what a machine
 * leaves out; nothing otherwise. The folder alone is read: no registry
 * is asked and no program is run. */
export function installedPlatform(prefix: string, platform: PlatformRecord): string | undefined {
  const laid = laidRecord(prefix);
  return laid !== undefined && isPlatformReleasePart(laid.body, platform.body)
    ? platformFolderOf(prefix)
    : undefined;
}

/** The platform folder of a prefix, when it is laid for this machine:
 * under the record of what the machine holds, or under the runtime's
 * whole record (a release proven from a pack of the tree arrives as a
 * whole folder, and a plane that holds every implementor binds the one
 * that fits). A folder laid for another machine is not this one's. */
export function platformLaidFor(
  prefix: string,
  platform: PlatformRecord,
  leftOut: readonly string[],
): string | undefined {
  const laid = laidRecord(prefix);
  if (laid === undefined) return undefined;
  return laid.digest === platform.digest ||
    laid.digest === platformOfMachine(platform, leftOut).digest
    ? platformFolderOf(prefix)
    : undefined;
}

function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One package of the record, pulled and held to it: the bytes' own
 * hash, the package digest by the format's own reader (which holds the
 * content, the spec and the contract to the manifest as it reads), the
 * name and the version. A package that fails one is refused in words
 * naming it, the digest and the host. */
async function pullPackage(
  registry: RegistryClient,
  entry: PlatformReleasePackage,
): Promise<Buffer> {
  const named = `${entry.id} ${entry.version}`;
  const host = registry.indexHost;
  let bytes: Buffer;
  try {
    bytes = await registry.downloadBlob(registryBlobPath(entry.packageDigest));
  } catch (error) {
    throw new Error(
      `${named} (${entry.packageDigest}) could not be pulled from ${host}: ${wordsOf(error)}; cernanto dev pulls again`,
    );
  }
  const refuse = (what: string): never => {
    throw new Error(
      `${named} from ${host} does not match the platform release: ${what}; nothing was installed`,
    );
  };
  const blobDigest = sha256DigestOf(bytes);
  if (blobDigest !== entry.blobDigest) {
    refuse(`its bytes hash to ${blobDigest}, the release names ${entry.blobDigest}`);
  }
  let read: ReturnType<typeof readCernPackage>;
  try {
    read = readCernPackage(bytes);
  } catch (error) {
    return refuse(`it does not read as a package (${wordsOf(error)})`);
  }
  if (read.packageDigest !== entry.packageDigest) {
    refuse(`its package digest is ${read.packageDigest}, the release names ${entry.packageDigest}`);
  }
  if (read.manifest.name !== entry.id || read.manifest.version !== entry.version) {
    refuse(`it holds ${read.manifest.name} ${read.manifest.version}`);
  }
  return bytes;
}

/**
 * Pulls the platform a runtime's record names for this machine and
 * lays its folder: every package of the record but the ones the machine
 * leaves out, pulled from the registry by its package digest and held
 * to the record; once every one verified they are laid with the
 * workspace marker and the record of what the folder holds into
 * `platform.part`, which is renamed `platform`, so a pull that failed
 * lays nothing a start would take for a platform. Answers the folder.
 */
export async function installPlatform(
  prefix: string,
  whole: PlatformRecord,
  registry: RegistryClient,
  say: (line: string) => void,
  leftOut: readonly string[] = [],
): Promise<string> {
  const platform = platformOfMachine(whole, leftOut);
  const { version, packages } = platform.body;
  say(
    `pulling the platform release ${version}, ${String(packages.length)} packages, from ${registry.indexHost}`,
  );
  const pulled: { id: string; bytes: Buffer }[] = [];
  let next = 0;
  const pull = async (): Promise<void> => {
    for (;;) {
      const one = packages[next];
      if (one === undefined) return;
      next += 1;
      pulled.push({ id: one.id, bytes: await pullPackage(registry, one) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PULLS_AT_ONCE, packages.length) }, pull));
  const folder = platformFolderOf(prefix);
  const part = `${folder}.part`;
  rmSync(part, { recursive: true, force: true, maxRetries: 5 });
  for (const entry of platformFolderEntries(platform.bytes, pulled)) {
    const file = join(part, ...entry.path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, entry.bytes);
  }
  rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  renameSync(part, folder);
  say(`the platform release ${version} is installed`);
  return folder;
}
