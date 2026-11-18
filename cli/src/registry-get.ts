// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { Command } from 'commander';

import {
  AGENT_PATH_PATTERN,
  CernantoError,
  parsePackageRef,
  readCernPackage,
  specFileNameOf,
  workspacePackagePath,
} from '@cernanto/package-format';
import type { CernPackage } from '@cernanto/package-format';

import { planLaying, sourceFilesOf, writeLaying } from './deploy/granted-files.js';
import type { LaidFile } from './deploy/granted-files.js';
import {
  agentsRootOf,
  assertWorkspace,
  foreignPackagePath,
  workspaceSpecOf,
} from './deploy/landing.js';
import { fail } from './output.js';
import { fetchPackage, resolveInIndex } from './registry.js';
import type { RegistryClient, ResolvedPackage } from './registry.js';

// `cernanto registry get <name | folder/>[@version]`: a package of the
// registry, or every package under a folder of it, brought into this
// workspace AS SOURCE. For each package the page lies at the path its
// id names, the package beside it in its own place, and the files the
// page grants where its grant lines name them, so the agent is the
// reader's own from then on: a deploy lands it with nothing to compile,
// and an edit of its page is an amend. Nothing is deployed and no plane
// is asked. A get is all or nothing and over nothing: every package is
// fetched and every path it would write is held before the first file
// is written.

/** How many packages are asked of the registry at once. */
const PACKAGES_AT_ONCE = 8;

/** What a get was asked for: one package by its name, or every package
 * under a folder, and the version or range, `latest` when none. */
interface Wanted {
  folder?: string;
  name?: string;
  range: string;
}

function refuse(message: string): never {
  throw new CernantoError({ kind: 'terminal', message });
}

/** Reads the argument: `acme/greeter`, `acme/greeter@^1.2.0`, or a
 * folder by its slash, `acme/`, `acme/desks/@1.2.0`. */
function wantedOf(argument: string): Wanted {
  const at = argument.lastIndexOf('@');
  const target = at === -1 ? argument : argument.slice(0, at);
  const range = at === -1 ? 'latest' : argument.slice(at + 1);
  // The range is held to the rule a package reference's is.
  if (parsePackageRef(`a/b@${range}`) === undefined) {
    refuse(`"${range}" is not a version (x.y.z, ^x.y.z or ~x.y.z)`);
  }
  if (target.endsWith('/')) {
    const folder = target.slice(0, -1);
    if (!AGENT_PATH_PATTERN.test(folder)) {
      refuse(`"${target}" is not a folder of the registry (examples/, acme/desks/)`);
    }
    return { folder, range };
  }
  if (parsePackageRef(target) === undefined) {
    refuse(
      `"${target}" is not a package of the registry: name one, acme/greeter, or a folder by its slash, acme/`,
    );
  }
  return { name: target, range };
}

/** Runs a piece of work over every item, several at a time, the
 * answers in the items' order. */
async function severalAtOnce<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const answers: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      answers[index] = await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PACKAGES_AT_ONCE, items.length) }, worker));
  return answers;
}

/** One package of a get: what the registry resolved, its bytes and
 * what they read as. */
interface Taken {
  picked: ResolvedPackage;
  bytes: Buffer;
  pkg: CernPackage;
}

/** The packages a get names, each resolved and fetched, verified
 * against the digest the index names; and, for a folder asked at a
 * version, the packages under it that have no such version. */
async function taken(
  registry: RegistryClient,
  wanted: Wanted,
): Promise<{ packages: Taken[]; without: string[] }> {
  const fetched = async (picked: ResolvedPackage): Promise<Taken> => {
    const bytes = await fetchPackage(registry, picked);
    return { picked, bytes, pkg: readCernPackage(bytes) };
  };
  if (wanted.name !== undefined) {
    const index = await registry.packageIndex(wanted.name);
    if (index === undefined) refuse(`no package "${wanted.name}" in the registry`);
    return {
      packages: [await fetched(resolveInIndex(index, { name: wanted.name, range: wanted.range }))],
      without: [],
    };
  }
  const folder = wanted.folder ?? '';
  const names = (await registry.summary()).packages
    .map((row) => row.name)
    .filter((name) => name.startsWith(`${folder}/`))
    .sort();
  if (names.length === 0) refuse(`the registry has no package under ${folder}/`);
  const without: string[] = [];
  const answers = await severalAtOnce(names, async (name) => {
    const index = await registry.packageIndex(name);
    if (index === undefined) {
      refuse(`the registry lists ${name} and its index does not answer yet; try again in a minute`);
    }
    let picked: ResolvedPackage;
    try {
      picked = resolveInIndex(index, { name, range: wanted.range });
    } catch (error) {
      // A folder asked at a version takes the packages that have one:
      // a package published after it has none, and is said.
      if (wanted.range === 'latest') throw error;
      without.push(name);
      return undefined;
    }
    return fetched(picked);
  });
  const packages = answers.filter((one): one is Taken => one !== undefined);
  if (packages.length === 0) {
    refuse(`no package under ${folder}/ has a version that satisfies "${wanted.range}"`);
  }
  return { packages, without: without.sort() };
}

/**
 * Brings a package of the registry, or every package under a folder,
 * into a workspace as source, and answers the ids taken.
 *
 * @param registry - The registry to read.
 * @param argument - A package's name or a folder with its slash, each with or without `@` and a version or range.
 * @param agentsRoot - The workspace the source is laid in.
 * @param write - Where the lines a person reads go.
 * @returns The ids of the agents taken, in order.
 * @example
 * await registryGet(registry, 'examples/', agentsRootOf(), (line) => process.stdout.write(line));
 */
export async function registryGet(
  registry: RegistryClient,
  argument: string,
  agentsRoot: string,
  write: (line: string) => void,
): Promise<string[]> {
  const wanted = wantedOf(argument);
  // The source is laid in the workspace: a folder that can be none is
  // refused before the registry is asked and before a file is written.
  assertWorkspace(agentsRoot);
  const { packages, without } = await taken(registry, wanted);
  const shown = (path: string): string => relative(agentsRoot, path).split(sep).join('/');

  // Every path the get would write, held before anything is written.
  const problems: string[] = [];
  const files: LaidFile[] = [];
  for (const { bytes, pkg } of packages) {
    const agentId = pkg.manifest.name;
    const held = workspaceSpecOf(agentsRoot, agentId);
    if (held !== undefined) {
      problems.push(
        `${agentId} already exists here as your local agent (its spec is ${shown(held)})`,
      );
      continue;
    }
    const kept = foreignPackagePath(agentsRoot, agentId);
    if (existsSync(kept)) {
      problems.push(
        `${agentId} is kept here as an installed package, at ${shown(kept)}; remove that file, and the agent from the plane with cernanto delete ${agentId}, to take it as source`,
      );
      continue;
    }
    // The page and the files it grants, then the package beside the page.
    const source = sourceFilesOf(agentsRoot, specFileNameOf(agentId), pkg);
    if ('problem' in source) {
      problems.push(`${agentId}: ${source.problem}`);
      continue;
    }
    files.push(...source.files, {
      path: join(agentsRoot, ...workspacePackagePath(agentId).split('/')),
      bytes,
      agentId,
    });
  }
  const laying = planLaying(agentsRoot, files);
  problems.push(...laying.problems);
  if (problems.length > 0) {
    refuse(`nothing was written:\n  ${problems.join('\n  ')}`);
  }
  writeLaying(laying.writes);
  const ids: string[] = [];
  for (const { picked, pkg } of packages) {
    const agentId = pkg.manifest.name;
    ids.push(agentId);
    write(`${agentId} ${picked.version}  ${specFileNameOf(agentId)}\n`);
    if (picked.deprecated !== undefined) {
      write(`warning: ${agentId} is deprecated: ${picked.deprecated}\n`);
    }
  }
  if (without.length > 0) {
    write(`no version "${wanted.range}" of: ${without.join(', ')}\n`);
  }
  const one = ids.length === 1;
  // The argument a deploy takes for the same agents: the name or the
  // folder, without the version.
  const again = wanted.name ?? `${wanted.folder ?? ''}/`;
  write(
    `${String(ids.length)} agent${one ? '' : 's'} taken as source: ${one ? 'it is' : 'they are'} yours in this workspace now, and a later version of the registry no longer lands over ${one ? 'it' : 'them'}\n`,
  );
  write(`deploy ${one ? 'it' : 'them'} with: cernanto deploy ${again}\n`);
  return ids;
}

/** Registers `get` among the registry's verbs. */
export function registerRegistryGet(registry: Command, open: () => Promise<RegistryClient>): void {
  registry
    .command('get')
    .argument(
      '<name-or-folder>',
      'a registry package by name or name@version, or every package under a folder: examples/, examples/@0.4.0',
    )
    .description(
      'bring a registry package, or a folder of them, into this workspace as source: the page, the package, the granted files',
    )
    .action(async (argument: string) => {
      try {
        await registryGet(await open(), argument, agentsRootOf(), (line) =>
          process.stdout.write(line),
        );
      } catch (error) {
        fail(error);
      }
    });
}
