// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CernantoError,
  PACKAGE_CODE_DIR,
  PACKAGE_EXTENSION,
  PACKAGE_TESTS_DIR,
  parsePackageRef,
  readCernPackage,
  sha256Hex,
} from '@cernanto/package-format';
import type { CernPackage, PackageIndex } from '@cernanto/package-format';

import type { CardPlane } from './card.js';
import { agentsRootOf, resolveAgentSelector, treePackages } from './deploy/landing.js';
import type { AgentRow } from './gateway/types.gen.js';
import { asNotDeployed } from './output.js';
import type { OutputOptions } from './output.js';
import { RegistryClient, fetchPackage, registryEndpoints, resolveInIndex } from './registry.js';
import type { ResolvedPackage } from './registry.js';
import { ServerClient } from './server-client.js';

// The agent or package the reading verbs name (`contract`, `code` and
// `tests`): one argument shape, resolved in the deploy's order. A path
// to a `.cern` file is that file, a name with a version is the
// registry's, an id is the agent the plane runs, else the package of
// that id in the tree, else the registry's package of that name.

/** The plane surface the reading verbs read; the gateway client
 * satisfies it. */
export interface ReadPlane extends CardPlane {
  rows(): Promise<AgentRow[]>;
  describe(agentId: string): Promise<{ agent: AgentRow; contract?: string }>;
  generations: ServerClient['generations'];
  /** The agent's generations with their starts, for when the running version began. */
  history?: ServerClient['history'];
  packageGet(digest: string): Promise<Buffer>;
  /** The agent's accounts and asks; absent in the proofs. */
  auth?: ServerClient['auth'];
}

/** Where the reading verbs read from, each opened when its road is
 * taken: the plane is not asked for a registry reference, and the
 * registry not for an agent the plane runs. */
export interface ReadSeams {
  plane: () => ReadPlane;
  registry: () => RegistryClient | Promise<RegistryClient>;
  agentsRoot: () => string;
}

/** The seams a verb reads through on this machine: the current plane,
 * the registry the plane names, and the workspace around the working
 * folder. */
export function readSeams(): ReadSeams {
  const plane = new ServerClient();
  return {
    plane: () => plane,
    registry: async () => new RegistryClient(await registryEndpoints(plane)),
    agentsRoot: () => agentsRootOf(),
  };
}

/** Whether the argument names a package file rather than an agent. */
export function isPackageFile(argument: string, cwd: string = process.cwd()): boolean {
  return argument.endsWith(PACKAGE_EXTENSION) && existsSync(resolve(cwd, argument));
}

/** What a verb reads on each road an argument can take. */
export interface ReadRoads<T> {
  /** A package file on this machine: the one named, or the tree's
   * package of the id. */
  file: (path: string) => T | Promise<T>;
  /** A package in the registry, by name, with or without a version. */
  registry: (registry: RegistryClient, ref: string) => Promise<T>;
  /** The agent the plane runs; a refusal that says nothing is deployed
   * under the id sends the read on to the tree and the registry. */
  plane: (plane: ReadPlane, agentId: string) => Promise<T>;
}

/** The package of an agent in the tree, the author's own or a third
 * party's kept in the root's folder; undefined when the tree does not
 * read or holds none. */
function treePackageOf(agentsRoot: string, agentId: string): string | undefined {
  try {
    return treePackages(agentsRoot).packages[agentId]?.path;
  } catch {
    return undefined;
  }
}

/**
 * Reads one argument on the road it names, in the deploy's order: a
 * `.cern` file is that file; a name with a version is the registry's;
 * an id is the agent the plane runs, else the package of that id in
 * the tree, else the registry's package of that name.
 *
 * @param target - The argument as given: an agent id, a package file or a registry reference.
 * @param seams - Where the roads read from.
 * @param roads - What the verb reads on each road.
 * @returns What the road taken answered.
 * @example
 * const pkg = await readTarget('ops/greeter', readSeams(), roads);
 */
export async function readTarget<T>(
  target: string,
  seams: ReadSeams,
  roads: ReadRoads<T>,
): Promise<T> {
  if (isPackageFile(target)) return roads.file(target);
  if (target.includes('@')) return roads.registry(await seams.registry(), target);
  const agentId = resolveAgentSelector(target);
  try {
    return await roads.plane(seams.plane(), agentId);
  } catch (error) {
    const notDeployed =
      error instanceof Error && error.message.startsWith('nothing is deployed as');
    if (!notDeployed) throw error;
    const inTree = treePackageOf(seams.agentsRoot(), agentId);
    if (inTree !== undefined) return roads.file(inTree);
    const registry = await seams.registry();
    if ((await registry.packageIndex(agentId).catch(() => undefined)) === undefined) {
      throw new CernantoError({
        kind: 'terminal',
        message: `nothing is deployed as "${agentId}", no package of it is in the tree, and the registry has no package by that name`,
      });
    }
    return roads.registry(registry, agentId);
  }
}

/** The package a deployed agent runs, read back by the digest its row
 * names. */
export async function deployedPackage(
  client: Pick<ReadPlane, 'packageGet'>,
  row: { artifact?: string },
  agentId: string,
): Promise<CernPackage> {
  const digest = row.artifact;
  if (digest === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: `${agentId} is deployed without a package to read`,
    });
  }
  try {
    return readCernPackage(await client.packageGet(digest));
  } catch (error) {
    throw new CernantoError({
      kind: 'terminal',
      message: `the package of ${agentId} (${digest.slice(0, 19)}...) does not read: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** The package the plane runs for an agent: the row the plane
 * describes, then the package that row names. */
async function planePackage(client: ReadPlane, agentId: string): Promise<CernPackage> {
  let agent: AgentRow;
  try {
    agent = (await client.describe(agentId)).agent;
  } catch (error) {
    throw asNotDeployed(error, agentId);
  }
  return deployedPackage(client, agent, agentId);
}

/**
 * A package in the registry, resolved through its index (the latest
 * version, or the one the range picks), fetched and verified against
 * the digest the index names, and landed nowhere.
 *
 * @param registry - The registry to read.
 * @param ref - The package's name, with or without a version or a range.
 * @returns The package, the index it was resolved through, and the version picked.
 * @example
 * const { pkg } = await registryPackage(registry, 'ops/greeter@^1.0.0');
 */
export async function registryPackage(
  registry: RegistryClient,
  ref: string,
): Promise<{ pkg: CernPackage; index: PackageIndex; picked: ResolvedPackage }> {
  const parsed = parsePackageRef(ref);
  if (parsed === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: `"${ref}" is not a package reference (name[@version|^x.y.z])`,
    });
  }
  const index = await registry.packageIndex(parsed.name);
  if (index === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: `no package "${parsed.name}" in the registry`,
    });
  }
  const picked = resolveInIndex(index, parsed);
  return { pkg: readCernPackage(await fetchPackage(registry, picked)), index, picked };
}

/** The package an argument names, on whichever road it takes. */
export function packageOfTarget(target: string, seams: ReadSeams): Promise<CernPackage> {
  return readTarget(target, seams, {
    file: (path) => readCernPackage(readFileSync(path)),
    registry: async (registry, ref) => (await registryPackage(registry, ref)).pkg,
    plane: planePackage,
  });
}

/** The two folders of a package the sessions wrote: the code and the
 * tests. */
export type WrittenFolder = typeof PACKAGE_CODE_DIR | typeof PACKAGE_TESTS_DIR;

/** The module every agent's code enters through, printed first. */
const ENTRY_MODULE = 'index.ts';

/** A file's text as it is printed: its own text, or the size and
 * digest of bytes that are not UTF-8. */
function fileText(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return `<binary: ${String(bytes.length)} bytes, sha256 ${sha256Hex(bytes)}>\n`;
  }
}

/** One folder's files by their path in the package, the entry module
 * first and the rest by path. */
export function folderFiles(pkg: CernPackage, folder: WrittenFolder): [string, string][] {
  const files = folder === PACKAGE_CODE_DIR ? pkg.code : pkg.tests;
  return Object.entries(files)
    .sort(([a], [b]) => (a === ENTRY_MODULE ? -1 : b === ENTRY_MODULE ? 1 : a.localeCompare(b)))
    .map(([path, bytes]): [string, string] => [`${folder}/${path}`, fileText(bytes)]);
}

/**
 * What `code` and `tests` print: one folder of the package an argument
 * names, each file under a heading with its path in the package, or as
 * json each file's text by its path. A folder that holds no file
 * prints the words the verb gives for it.
 *
 * @param target - The argument as given.
 * @param folder - The folder to print.
 * @param options - The output form.
 * @param seams - Where the roads read from.
 * @param empty - The words for a package whose folder holds no file.
 * @returns The text to print.
 * @example
 * process.stdout.write(await folderOfTarget('ops/greeter', 'code', {}, readSeams(), words));
 */
export async function folderOfTarget(
  target: string,
  folder: WrittenFolder,
  options: OutputOptions,
  seams: ReadSeams,
  empty: (pkg: CernPackage) => string,
): Promise<string> {
  const pkg = await packageOfTarget(target, seams);
  const files = folderFiles(pkg, folder);
  if (options.output === 'json') {
    return `${JSON.stringify({ files: Object.fromEntries(files) }, null, 2)}\n`;
  }
  if (files.length === 0) return `${empty(pkg)}\n`;
  return files
    .map(([path, text]) => `==== ${path} ====\n${text}${text.endsWith('\n') ? '' : '\n'}`)
    .join('');
}
