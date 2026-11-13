// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The release's own packages as a release carries them: every `.cern`
// under the release's agent tree (`cernanto/`), each beside its spec
// under `.cern/`. The materialize reads them for a seed dependency's
// facts (its type, its handlers, its contract) and the host job boots the
// plane's first processes from them.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { readPackage } from './manifest.js';
import type { ReadPackage } from './manifest.js';

/** The agent trees of a release, in the order they are read: one, the
 * platform's. */
export const PLATFORM_ROOTS: readonly string[] = ['cernanto'];

function* packageFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    // A dot folder is a tool's state; .cern/ alone holds packages.
    if (name.startsWith('.') && name !== '.cern') continue;
    if (statSync(path).isDirectory()) {
      yield* packageFiles(path);
    } else if (basename(dir) === '.cern' && name.endsWith('.cern')) {
      yield path;
    }
  }
}

/** Every platform package file a release carries, in a stable order. */
export function releasePackageFiles(releaseDir: string): string[] {
  const files: string[] = [];
  for (const root of PLATFORM_ROOTS) {
    const dir = join(releaseDir, root);
    if (!existsSync(dir)) continue;
    files.push(...packageFiles(dir));
  }
  return files;
}

export interface ReleasePackage {
  file: string;
  bytes: Buffer;
  pkg: ReadPackage;
}

/** The release's platform packages read and indexed by agent id. */
export function releasePackages(releaseDir: string): Map<string, ReleasePackage> {
  const index = new Map<string, ReleasePackage>();
  for (const file of releasePackageFiles(releaseDir)) {
    const bytes = readFileSync(file);
    const pkg = readPackage(bytes);
    const twin = index.get(pkg.manifest.name);
    if (twin !== undefined) {
      throw new Error(
        `${pkg.manifest.name} is placed twice in the release: ${twin.file} and ${file}`,
      );
    }
    index.set(pkg.manifest.name, { file, bytes, pkg });
  }
  return index;
}
