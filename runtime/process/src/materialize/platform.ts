// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The platform's own boot from its packages: a seed's artifact and
// composition derived from the release for the init, each runner's
// process composed with the modules it links, the vendor packages
// materialized for the machine, and the version a release runs as. The
// bring-up set itself is the deployer's to spell (cernanto dev, a
// seed host's orders).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReleasePackage } from './release-packages.js';

/** The digest a plane knows a package by: the sha256 of its bytes as
 * the store holds them and a row's `artifact` names them (the manifest
 * digest inside the package identifies its content, not its bytes). */
export function blobDigestOf(held: ReleasePackage): string {
  return `sha256:${createHash('sha256').update(held.bytes).digest('hex')}`;
}

/** The composition of a runner from the release's packages: every
 * module its closure links, by id, to that module's blob digest; the
 * rule the converge computes from the rows (the module grants and the
 * module implementors of the granted interfaces, closed). */
export function compositionOf(
  agentId: string,
  index: ReadonlyMap<string, ReleasePackage>,
): Record<string, string> {
  const composition: Record<string, string> = {};
  for (const id of linkedModulesOf(agentId, index)) {
    const held = index.get(id);
    if (held !== undefined) composition[id] = blobDigestOf(held);
  }
  return composition;
}

/** The platform modules one agent links directly: its uses of type
 * module that are placed packages, and the placed module implementors
 * of every interface it uses (the harness facade and its vendors). */
function directlyLinkedModulesOf(
  agentId: string,
  index: ReadonlyMap<string, ReleasePackage>,
): string[] {
  const held = index.get(agentId);
  if (held === undefined) return [];
  const uses = Object.entries(held.pkg.manifest.uses);
  const direct = uses
    .filter(([id, use]) => id !== agentId && use.type === 'module' && index.has(id))
    .map(([id]) => id);
  const interfaces = new Set(uses.filter(([, use]) => use.type === 'interface').map(([id]) => id));
  const implementors = [...index.values()]
    .filter(
      (other) =>
        other.pkg.manifest.name !== agentId &&
        other.pkg.manifest.type === 'module' &&
        other.pkg.manifest.implements.some((entry) => interfaces.has(entry.id)),
    )
    .map((other) => other.pkg.manifest.name);
  return [...new Set([...direct, ...implementors])].sort();
}

/** The platform modules a runner's process composes: the whole closure
 * of what it links and what those link in turn, placed flat at the
 * carrier's top level so a module's own stub of another module
 * resolves from inside the composition. */
export function linkedModulesOf(
  agentId: string,
  index: ReadonlyMap<string, ReleasePackage>,
): string[] {
  const closure = new Set<string>();
  const queue = [agentId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const linked of directlyLinkedModulesOf(id, index)) {
      if (linked === agentId || closure.has(linked)) continue;
      closure.add(linked);
      queue.push(linked);
    }
  }
  return [...closure].sort();
}

/** The cernanto version a release runs as: its release.json, else 0.0.0. */
export function releaseVersionOf(releaseDir: string): string {
  const file = join(releaseDir, 'release.json');
  if (!existsSync(file)) return '0.0.0';
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
