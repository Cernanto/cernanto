// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { execute, system } from '@cernanto/system';

// The release's own Node on a server. A release names the Node it runs
// on, a fact of the release beside its version, and a release folder
// keeps that very Node at `bin/node`, with npm beside it: a restore maps
// the same binaries by path, on the server that took an image and on
// any other, so every server of a plane holds one Node at one path, and
// no upgrade of a machine's own Node moves it under a running plane.
// The Node a machine has to run npm with is a tool of the install and
// never runs the plane. The archive is nodejs.org's own, of that exact
// version, held to nodejs.org's list of checksums before a file of it
// is laid.

/** Where the Node archives are taken from, unless a mirror is named:
 * the folder that holds one folder per version. */
export const NODE_SOURCE_DEFAULT = 'https://nodejs.org/dist';

/** The list of an archive folder's checksums, as nodejs.org names it. */
const CHECKSUMS = 'SHASUMS256.txt';

/** The Node a release folder names for itself: its release file's
 * `node`, a version as Node prints it (`v26.1.0`); nothing when the
 * release names none, which runs on the machine's own. */
export function nodeOfRelease(folder: string): string | undefined {
  try {
    const facts = JSON.parse(readFileSync(join(folder, 'release.json'), 'utf8')) as {
      node?: unknown;
    };
    return typeof facts.node === 'string' && /^v\d+\.\d+\.\d+$/.test(facts.node)
      ? facts.node
      : undefined;
  } catch {
    return undefined;
  }
}

/** The archive of a Node version for this machine, as nodejs.org names
 * it; nothing on a system the archives are not laid on. */
export function nodeArchiveOf(version: string): string | undefined {
  const os = system.name === 'linux' ? 'linux' : system.name === 'macos' ? 'darwin' : undefined;
  const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined;
  if (os === undefined || arch === undefined) return undefined;
  return `node-${version}-${os}-${arch}.tar.gz`;
}

async function fetched(url: string, patienceMs: number): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(patienceMs) });
  } catch (error) {
    throw new Error(
      `${url} did not answer (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Lays the Node a release folder names into it: `bin/node`, npm under
 * `lib/node_modules/npm` and the `npm` and `npx` links in `bin`, as the
 * archive holds them. The archive of that version is taken from the
 * source, held to the source's own list of checksums, and unpacked;
 * nothing is laid from an archive that fails it. A release that names
 * no Node, and a system the archives are not made for, lay none and
 * say so: such a release runs on the machine's own Node.
 */
export async function layReleaseNode(
  folder: string,
  source: string,
  say: (line: string) => void,
): Promise<void> {
  const version = nodeOfRelease(folder);
  if (version === undefined) {
    say("the release names no Node of its own: it runs on the machine's");
    return;
  }
  const archive = nodeArchiveOf(version);
  if (archive === undefined) {
    say(
      `no Node archive is laid on this system: the release runs on the machine's Node, not its own ${version}`,
    );
    return;
  }
  const base = `${source.replace(/\/+$/, '')}/${version}`;
  say(`laying the release's own Node ${version}, from ${base}`);
  const listed = (await fetched(`${base}/${CHECKSUMS}`, 60_000))
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find((words) => words[1] === archive)?.[0];
  if (listed === undefined || !/^[a-f0-9]{64}$/.test(listed)) {
    throw new Error(`${base}/${CHECKSUMS} lists no checksum for ${archive}; no Node was laid`);
  }
  const bytes = await fetched(`${base}/${archive}`, 10 * 60_000);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== listed) {
    throw new Error(
      `${archive} from ${base} hashes to ${digest}, and its list of checksums names ${listed}; no Node was laid`,
    );
  }
  const work = mkdtempSync(join(tmpdir(), 'cernanto-node-'));
  try {
    const file = join(work, archive);
    writeFileSync(file, bytes);
    // The files are the installer's own, whoever the archive names as
    // their owner: a release folder is laid by root on a server, and a
    // file of it owned by another user would be that user's to change.
    await execute('tar', ['-xzf', file, '--no-same-owner', '-C', work], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const unpacked = join(work, archive.replace(/\.tar\.gz$/, ''));
    const node = join(unpacked, 'bin', 'node');
    if (!existsSync(node)) throw new Error(`${archive} carries no bin/node; no Node was laid`);
    mkdirSync(join(folder, 'bin'), { recursive: true });
    cpSync(node, join(folder, 'bin', 'node'));
    chmodSync(join(folder, 'bin', 'node'), 0o755);
    const npm = join(unpacked, 'lib', 'node_modules', 'npm');
    if (existsSync(npm)) {
      const into = join(folder, 'lib', 'node_modules', 'npm');
      rmSync(into, { recursive: true, force: true });
      mkdirSync(dirname(into), { recursive: true });
      cpSync(npm, into, { recursive: true });
      for (const tool of ['npm', 'npx']) {
        const link = join(folder, 'bin', tool);
        rmSync(link, { force: true });
        symlinkSync(join('..', 'lib', 'node_modules', 'npm', 'bin', `${tool}-cli.js`), link);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  }
  say(`the release's own Node ${version} is laid, with npm beside it`);
}
