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

/** The package warehouse: the materialize asks it for a package the
 * release does not carry. */
export const PACKAGES_AGENT = 'cernanto/packages';
/** The fleet, the controller's state module's record: the rows the
 * materialize reads a deployed dependency's facts off. */
export const FLEET_RECORD = 'controller/fleet';

/** The bring-up set, a fact of the release: the plane's first processes,
 * booted from the release's packages as generations of the fleet on
 * the bring-up ports before any row exists; the controller adopts them
 * and converges the rest of the platform. The host job writes their
 * orders. */
export const BRING_UP_SET: readonly { agentId: string; port: number }[] = [
  { agentId: 'cernanto/packages', port: 19990 },
  { agentId: 'cernanto/config', port: 19991 },
  { agentId: 'cernanto/trace', port: 19992 },
  { agentId: 'cernanto/controller', port: 19993 },
  { agentId: 'cernanto/gateway', port: 19994 },
  { agentId: 'cernanto/host', port: 19995 },
];
/** The one agent of the release that keeps a root launcher's
 * privileges: the host job, whose acts on the machine (a dump, a
 * restore, the forwarding table) are the only root acts on the plane an
 * agent performs. Its copy keeps the privileges when the artifact it
 * runs is the release's own package of that id, by digest, and runs
 * dropped like any other copy otherwise. */
export const PRIVILEGED_AGENT = 'cernanto/host';
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

/** The hand-written libraries by their npm short name: where each lives. */
export const LIBRARY_DIRS: Readonly<Record<string, string>> = {
  'runtime-lib': 'runtime/lib',
  process: 'runtime/process',
  'package-format': 'format',
  cli: 'cli',
};
