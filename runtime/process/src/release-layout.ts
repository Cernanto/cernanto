// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// The few facts of a release's layout the runtime reads, relative to
// its root: the tree is laid out as a release, a packed release keeps
// the tree's paths, and the view over an npm install links the same
// paths. A release is the installed runtime and is never made at run
// time; the map of the layout, the releases installed and the highest
// one are the launcher's and the host job's.

/** The block: the one command that runs a package, `cernanto-agent`. */
export const AGENT_BIN = 'runtime/process/dist/agent/bin.js';

/** The release a program of the release runs from: four folders over
 * the program's own folder (`<release>/runtime/process/dist/agent/`),
 * by the program's path as it was invoked, since an installed release
 * is a view of links and the program's real path lies outside it. */
export function releaseOfProgram(program: string): string {
  return resolve(dirname(program), '..', '..', '..', '..');
}

/** The modules the materialize is made of: the glue it writes, the
 * contract it reads, the composition. */
export const MATERIALIZE_DIR = 'runtime/process/dist/materialize';

/** What a release's materialize is, as a digest of its code: every
 * module under its directory, by path and bytes, and the release's own
 * place. A directory materialized by another materialize holds other
 * glue, and one laid out under another release links that release's
 * runtime, which an upgrade's pruning takes away (the host job's
 * folder outlives releases, since the host job does not roll), so a boot
 * that finds a different identity materializes the generation again. */
export function materializerIdentity(release: string): string {
  const hash = createHash('sha256');
  hash.update(release);
  hash.update('\0');
  const dir = join(release, MATERIALIZE_DIR);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => `${MATERIALIZE_DIR}/${name}`);
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(release, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** The zod the runtime library resolves: beside it under its own
 * node_modules in the tree's layout, or wherever the package manager
 * placed the one copy an installed release shares (npm hoists it to
 * the install's root). Resolved from the library's real path, so a
 * release reached through links answers the same; the tree's path
 * when the library resolves none. */
export function zodOfRuntimeLib(runtimeLib: string): string {
  try {
    const own = createRequire(join(realpathSync(runtimeLib), 'package.json'));
    return dirname(own.resolve('zod/package.json'));
  } catch {
    return join(runtimeLib, 'node_modules', 'zod');
  }
}

/** Where the runtime library lies in a release. */
export const RUNTIME_LIB_DIR = 'runtime/lib';
