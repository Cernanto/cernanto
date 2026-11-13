// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  CernantoError,
  PACKAGE_EXTENSION,
  PLATFORM_NAMESPACE,
  PLATFORM_RELEASE_FILE,
  agentIdOfSpecPath as agentIdOfSpecPathOfKit,
  isSpecPath as isSpecPathOfKit,
  parseSpecFileName,
  readCernPackage,
  readPlatformRelease,
  specFileNameOf,
  workspacePackagePath,
} from '@cernanto/package-format';
import type { PackageManifest, PlatformReleaseBody } from '@cernanto/package-format';

import type { FleetAgentRowWire } from '../gateway/types.gen.js';

import { grantedFilesMoved } from './granted-files.js';

// The tree road of a deploy: the workspace is the nearest folder above
// the command that holds a `cernanto.json` marker, else the directory
// the command runs from, which a person's home folder, a folder that
// holds it and the root of a file system never are; a spec file is an
// agent wherever it sits, its id its path from the root minus the spec
// suffix, and the compiled package lives beside it under `.cern/`. The
// cli judges each package current for its spec or not (the spec's sha,
// the granted files, the pins on the dependencies the tree holds) and
// lands the current ones through the plane's landing, a package before
// the packages that need it; the rest is the compiler's. The plane
// composes every row.

/** The workspace marker: a folder holding one is a workspace, and the
 * ids are the paths from it. `{"version": 1}` marks a folder of specs;
 * `"folders"` lists the folders below the root that hold the
 * workspace's agents, for a root that also holds other things (a
 * repository whose specs live under one folder). */
export const WORKSPACE_MARKER = 'cernanto.json';

/** A marker's content, as the cli reads it. */
interface WorkspaceMarker {
  version?: number;
  folders?: string[];
}

function readMarker(path: string): WorkspaceMarker {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CernantoError({
      kind: 'terminal',
      message: `${path} does not read as a workspace marker: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CernantoError({
      kind: 'terminal',
      message: `${path} does not read as a workspace marker: an object with "version" was expected`,
    });
  }
  const marker = parsed as Record<string, unknown>;
  const folders = marker['folders'];
  if (
    folders !== undefined &&
    (!Array.isArray(folders) || folders.some((folder) => typeof folder !== 'string'))
  ) {
    throw new CernantoError({
      kind: 'terminal',
      message: `${path}: "folders" lists the workspace's folders as strings`,
    });
  }
  return {
    ...(typeof marker['version'] === 'number' ? { version: marker['version'] } : {}),
    ...(folders === undefined ? {} : { folders: folders as string[] }),
  };
}

/** Whether a path is a folder's own or lies under it. */
function liesUnder(folder: string, path: string): boolean {
  const between = relative(folder, path);
  return (
    between === '' || (between !== '..' && !between.startsWith(`..${sep}`) && !isAbsolute(between))
  );
}

/** A folder the marker lists, as a path under the root: by its own
 * spelling, and by what it resolves to on disk when it is a link, so a
 * walk of the workspace reads the workspace alone. Any other folder
 * refuses the marker in words. */
function folderUnderRoot(agentsRoot: string, marker: string, folder: string): string {
  const path = resolve(agentsRoot, folder);
  const inside =
    !isAbsolute(folder) &&
    liesUnder(agentsRoot, path) &&
    (!existsSync(path) || liesUnder(realpathSync(agentsRoot), realpathSync(path)));
  if (!inside) {
    throw new CernantoError({
      kind: 'terminal',
      message: `${marker}: "folders" lists "${folder}", which lies outside the workspace; a workspace's folders are paths under its root`,
    });
  }
  return path;
}

/** A path as it resolves on disk, by its own spelling where it does
 * not resolve. */
function onDisk(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** What a folder with no marker is when it can be no workspace, in the
 * words a refusal says: a person's home folder, a folder that holds
 * it, or the root of a file system; nothing for any other folder. A
 * workspace is a folder that holds agents alone, and a command reads
 * all of it, which none of the three is whatever it holds. A folder
 * its author marked is a workspace by that word. */
export function unfitWorkspace(agentsRoot: string, home: string = homedir()): string | undefined {
  if (existsSync(join(agentsRoot, WORKSPACE_MARKER))) return undefined;
  const root = onDisk(agentsRoot);
  const own = onDisk(home);
  if (relative(root, own) === '') return 'your home folder';
  if (liesUnder(root, own)) return 'a folder that holds your home folder';
  if (dirname(root) === root) return 'the root of a file system';
  return undefined;
}

/** Refuses, in words, a folder that can be no workspace, before a
 * command reads or writes anything in it. */
export function assertWorkspace(agentsRoot: string, home: string = homedir()): void {
  const what = unfitWorkspace(agentsRoot, home);
  if (what === undefined) return;
  throw new CernantoError({
    kind: 'terminal',
    message: `${agentsRoot} is ${what}, which is no workspace: a workspace is a folder that holds agents alone, and a command reads all of it; make a folder for your agents and run the command from there`,
  });
}

/** How the workspace's root was taken, and what to do where the folder
 * holds more than agents: the last words of a refusal that met
 * something in it no workspace holds. */
export function rootTaken(agentsRoot: string): string {
  return existsSync(join(agentsRoot, WORKSPACE_MARKER))
    ? `where the folder holds other things too, its ${WORKSPACE_MARKER} lists the folders that hold its agents, under "folders"`
    : `no ${WORKSPACE_MARKER} stands at or above the folder the command ran from, so that folder was taken for the workspace; run the command from the folder of your agents`;
}

/** An entry of the workspace that does not read, in words: its path
 * from the root, the system's reason, and how the root was taken. A
 * workspace is read whole, so an entry that does not read is never
 * passed over. */
export function unreadable(agentsRoot: string, path: string, error: unknown): CernantoError {
  const reason =
    error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : String(error);
  const shown = relative(agentsRoot, path).split(sep).join('/');
  return new CernantoError({
    kind: 'terminal',
    message: `the workspace under ${agentsRoot} holds ${shown === '' ? 'a folder' : shown}, which cannot be read (${reason}); a workspace is a folder that holds agents alone, and a command reads all of it: ${rootTaken(agentsRoot)}`,
  });
}

/** What one read of the workspace answers; a read the system refuses
 * is said in words. */
export function readOf<T>(agentsRoot: string, path: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof CernantoError) throw error;
    throw unreadable(agentsRoot, path, error);
  }
}

/** The entries of one folder of the workspace. */
export function entriesOf(agentsRoot: string, dir: string): Dirent[] {
  return readOf(agentsRoot, dir, () => readdirSync(dir, { withFileTypes: true }));
}

/** The folders a walk of the workspace covers: the ones the marker
 * lists, each under the root, else the root itself, which is refused
 * where it can be no workspace. A listed folder that does not exist is
 * an empty one. */
export function workspaceFolders(agentsRoot: string): string[] {
  const marker = join(agentsRoot, WORKSPACE_MARKER);
  if (!existsSync(marker)) {
    assertWorkspace(agentsRoot);
    return [agentsRoot];
  }
  const folders = readMarker(marker).folders;
  if (folders === undefined) return [agentsRoot];
  return folders.map((folder) => folderUnderRoot(agentsRoot, marker, folder));
}

/** Whether a directory below the root is a workspace of its own: it
 * holds a marker, and a walk of the root stays out of it. */
export function isNestedWorkspace(dir: string, agentsRoot: string): boolean {
  return dir !== agentsRoot && existsSync(join(dir, WORKSPACE_MARKER));
}

/** Whether a path names a spec file: `.cern.md`, whatever the type. */
export function isSpecPath(path: string): boolean {
  return isSpecPathOfKit(path);
}

/** The agent id a spec path names, the path relative to the workspace
 * root with forward slashes: the path minus its suffix, and a
 * directory agent's `agent.cern.md` names its directory. Undefined
 * when the path is not a spec file, or when nothing is left. */
export function agentIdOfSpecPath(relativePath: string): string | undefined {
  return agentIdOfSpecPathOfKit(relativePath);
}

/** The spec file in a directory whose name carries the leaf, the
 * agent's own name; undefined when there is none. */
function specFileIn(dir: string, leaf: string): string | undefined {
  const candidate = join(dir, specFileNameOf(leaf));
  return existsSync(candidate) ? candidate : undefined;
}

/** Where the specs are: the nearest folder at or above the command's
 * directory that holds the workspace marker, else the directory the
 * command runs from. */
export function agentsRootOf(cwd: string = process.cwd()): string {
  const start = resolve(cwd);
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** The agents a folder argument names: every spec under the folder, for
 * an argument ending in `/`, or naming an existing directory under the
 * root that no spec names (an agent's own folder beside its spec names
 * the agent). The folder is looked for from the command's directory,
 * then from the root, so `cernanto/` names the root's `cernanto/` from
 * anywhere in the workspace. Undefined for any other argument; an
 * empty list when the folder holds no spec. */
export function folderSelection(
  argument: string,
  cwd: string = process.cwd(),
): string[] | undefined {
  const root = agentsRootOf(cwd);
  const trailing = argument.endsWith('/');
  const folder = [resolve(cwd, argument), resolve(root, argument)].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isDirectory(),
  );
  if (folder === undefined) return trailing ? [] : undefined;
  const relativePath = relative(root, folder).split(sep).join('/');
  if (relativePath.startsWith('..')) return trailing ? [] : undefined;
  if (!trailing && workspaceSpecOf(root, relativePath) !== undefined) return undefined;
  const prefix = relativePath === '' ? '' : `${relativePath}/`;
  return workspaceAgentIds(root).filter((id) => id.startsWith(prefix));
}

/** The targets with every folder argument replaced by the agents under
 * it; a folder that holds no spec is refused in words. */
export function expandFolders(targets: string[], cwd: string = process.cwd()): string[] {
  return targets.flatMap((target) => {
    const selection = folderSelection(target, cwd);
    if (selection === undefined) return [target];
    if (selection.length === 0) {
      throw new CernantoError({ kind: 'terminal', message: `no specs under ${target}` });
    }
    return selection;
  });
}

/** The workspace id a spec path names: the path minus its spec
 * suffix, a directory agent's `agent.cern.md` naming its directory
 * (the same rule the compiler's workspace loader applies). */
function stripSpecExtension(path: string): string {
  return agentIdOfSpecPath(path) ?? path;
}

/** An agent argument as the id it names. The shell completes the spec
 * file (`domains/godaddy-check.cern.md`), and an agent's id is its
 * spec path from the workspace root minus the spec suffix, so a file
 * argument names one agent: one that exists under the root resolves
 * through the filesystem (right from any cwd, and for a directory
 * agent's agent.cern.md); one that merely ends with a spec suffix
 * strips it; anything else is already an id. An unresolvable
 * path keeps the author's own words for the plane's error to name. */
export function resolveAgentSelector(argument: string, cwd: string = process.cwd()): string {
  if (!isSpecPath(argument)) return argument;
  const asPath = resolve(cwd, argument);
  if (existsSync(asPath)) {
    const root = agentsRootOf(cwd);
    const relativePath = relative(root, asPath).split(sep).join('/');
    if (!relativePath.startsWith('..')) return stripSpecExtension(relativePath);
  }
  return stripSpecExtension(argument);
}

/** Where the workspace root is when a package names a shorter id
 * than the directory gives it: the command ran above the root. */
export function workspaceRootHint(agentId: string, manifestName: string): string | undefined {
  if (agentId === manifestName || !agentId.endsWith(`/${manifestName}`)) return undefined;
  return agentId.slice(0, -manifestName.length - 1);
}

/** Whether an argument is the bare file form of a deploy: an existing
 * path ending in a spec extension or in `.cern`. A word is a verb or a
 * mistake, never a file; an id carries a slash and no extension. */
export function isBareFileTarget(argument: string, cwd: string = process.cwd()): boolean {
  if (!isSpecPath(argument) && !argument.endsWith(PACKAGE_EXTENSION)) return false;
  return existsSync(resolve(cwd, argument));
}

export function sha256Of(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The workspace's own packages: every `.cern/<base>.cern` whose spec
 * `<base>.<suffix>` sits beside the `.cern/` folder, keyed by the
 * agent id the placement names (a directory agent's `agent.cern` names
 * its directory). A package in the root's `.cern/` folder with no spec
 * beside it is a foreign one, taken from the registry or a file, keyed
 * by the name its manifest carries and landed as a third party's; the
 * root's `.cern/` is read for them whichever folders the marker lists.
 * A package with no spec beside it anywhere else, or one that does not
 * read, is an orphan, named and left out of the landing. Dot folders
 * other than `.cern/` stay out of the walk, as they do for the upload. */
export function treePackages(agentsRoot: string): {
  packages: Record<string, { path: string; digest: string; foreign?: boolean }>;
  orphans: string[];
} {
  const packages: Record<string, { path: string; digest: string; foreign?: boolean }> = {};
  const orphans: string[] = [];
  const posix = (path: string): string => relative(agentsRoot, path).split(sep).join('/');
  // The packages of one `.cern/` folder. `own` says the folder beside
  // it is walked for the workspace's agents; where it is the root of a
  // workspace whose marker lists other folders, the foreign packages
  // alone are read.
  const read = (dir: string, own: boolean): void => {
    const folder = join(dir, '.cern');
    for (const file of entriesOf(agentsRoot, folder).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !file.name.endsWith(PACKAGE_EXTENSION)) continue;
      const base = file.name.slice(0, -PACKAGE_EXTENSION.length);
      const spec = specFileIn(dir, base);
      if (spec !== undefined && !own) continue;
      const packagePath = join(folder, file.name);
      const bytes = readOf(agentsRoot, packagePath, () => readFileSync(packagePath));
      const foreign = spec === undefined && dir === agentsRoot;
      const id =
        spec === undefined
          ? foreign
            ? foreignPackageName(bytes)
            : undefined
          : agentIdOfSpecPath(posix(spec));
      if (id === undefined) {
        orphans.push(posix(packagePath));
        continue;
      }
      // Two files of one foreign agent: the one under the agent's own
      // file name stands.
      if (foreign && packages[id]?.path === foreignPackagePath(agentsRoot, id)) continue;
      packages[id] = {
        path: packagePath,
        digest: sha256Of(bytes),
        ...(foreign ? { foreign: true } : {}),
      };
    }
  };
  const walk = (dir: string): void => {
    for (const entry of entriesOf(agentsRoot, dir)) {
      if (entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.name === '.cern' && entry.isDirectory()) {
        read(dir, true);
        continue;
      }
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && !isNestedWorkspace(path, agentsRoot)) walk(path);
    }
  };
  const folders = workspaceFolders(agentsRoot);
  for (const folder of folders) {
    if (existsSync(folder)) walk(folder);
  }
  if (!folders.includes(agentsRoot) && existsSync(join(agentsRoot, '.cern'))) {
    read(agentsRoot, false);
  }
  return { packages, orphans };
}

/** The agent id a foreign package names, undefined when the bytes do
 * not read as a package. */
function foreignPackageName(bytes: Buffer): string | undefined {
  try {
    return readCernPackage(bytes).manifest.name;
  } catch {
    return undefined;
  }
}

/** Where an agent's package lives in the tree: `.cern/<base>.cern` in
 * its spec's own directory (`.cern/agent.cern` inside a directory
 * agent); undefined when no spec of the id is under the root. */
export function treePackagePath(agentsRoot: string, agentId: string): string | undefined {
  const spec = workspaceSpecOf(agentsRoot, agentId);
  if (spec === undefined) return undefined;
  const leaf = parseSpecFileName(basename(spec))?.leaf ?? basename(spec);
  return join(dirname(spec), '.cern', `${leaf}${PACKAGE_EXTENSION}`);
}

/** Where a foreign package lands in the tree: the root's `.cern/`
 * folder, named after the agent with each slash as two dashes. An
 * agent id carries single dashes alone, so each agent has a file name
 * of its own, apart from every other agent's and from the package of a
 * spec at the root. */
export function foreignPackagePath(agentsRoot: string, agentId: string): string {
  return join(agentsRoot, '.cern', `${agentId.replaceAll('/', '--')}${PACKAGE_EXTENSION}`);
}

/** Where an agent's spec lives under the root: `<id>.cern.md`;
 * undefined when the workspace holds none. */
export function workspaceSpecOf(agentsRoot: string, agentId: string): string | undefined {
  return specFileIn(join(agentsRoot, dirname(agentId)), basename(agentId));
}

/** Every agent id the workspace holds a spec for, sorted: what a
 * deploy with no ids named targets. */
export function workspaceAgentIds(agentsRoot: string): string[] {
  const ids: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of entriesOf(agentsRoot, dir)) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isNestedWorkspace(path, agentsRoot)) walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const id = agentIdOfSpecPath(relative(agentsRoot, path).split(sep).join('/'));
      if (id !== undefined) ids.push(id);
    }
  };
  for (const folder of workspaceFolders(agentsRoot)) {
    if (existsSync(folder)) walk(folder);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/** The notice labels of a spec text: the `License:` expression and the
 * `Copyright:` holders (one per label line, or the bullets under a bare
 * label), read anywhere in the file as the grammar reads them. */
export function noticeOf(specText: string): { license?: string; copyright: string[] } {
  const lines = specText.split('\n');
  let license: string | undefined;
  const copyright: string[] = [];
  for (const [index, line] of lines.entries()) {
    const label = /^(License|Copyright):\s*(.*)$/.exec(line);
    if (label === null) continue;
    const value = (label[2] ?? '').trim();
    if (label[1] === 'License') {
      if (value !== '') license = value;
      continue;
    }
    if (value !== '') {
      copyright.push(value);
      continue;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const bullet = /^\s*[-*]\s+(.+)$/.exec(lines[next] ?? '');
      if (bullet === null) {
        if ((lines[next] ?? '').trim() === '') continue;
        break;
      }
      copyright.push((bullet[1] ?? '').trim());
    }
  }
  return { ...(license === undefined ? {} : { license }), copyright };
}

/** Whether a package's manifest carries the notice its spec states:
 * the license expression and the copyright holders, when the spec
 * states them. */
function noticeCurrent(specText: string, manifest: PackageManifest): boolean {
  const notice = noticeOf(specText);
  if (notice.license !== undefined && manifest.license !== notice.license) return false;
  if (notice.copyright.length > 0) {
    const held = manifest.copyright ?? [];
    if (held.length !== notice.copyright.length) return false;
    if (held.some((holder, index) => holder !== notice.copyright[index])) return false;
  }
  return true;
}

/** What the tree says about an agent's package: current for its spec,
 * or the reason it is not. */
export type PackageCurrency =
  | {
      current: true;
      path: string;
      digest: string;
      manifest: PackageManifest;
      /** A third party's package in the root's `.cern/` folder. */
      foreign?: boolean;
    }
  | { current: false; reason: string };

/**
 * Whether the tree's package of an agent is current: the spec's sha256
 * is the manifest's, the package carries the files the spec grants as
 * the tree holds them (the files its code is granted, the document it
 * implements and the files its tests are granted: none moved, none
 * left, none added), and every dependency and implemented interface
 * with a package in the tree is at the contract this package was compiled
 * against. Anything else names the reason the compiler is the road; a
 * wording change of the spec is one (the compiler judges whether the
 * words changed the code). A foreign package has no spec and is
 * current when it reads and names its agent; `asItIs` holds the spec
 * and the granted files out of the judgement (the pins are still held
 * to the tree).
 */
export function packageCurrency(
  agentsRoot: string,
  agentId: string,
  tree: ReturnType<typeof treePackages>,
  options: { asItIs?: boolean } = {},
): PackageCurrency {
  const entry = tree.packages[agentId];
  if (entry === undefined) return { current: false, reason: 'no package in the tree' };
  const bytes = readFileSync(entry.path);
  let manifest: PackageManifest;
  try {
    const read = readCernPackage(bytes);
    manifest = read.manifest;
  } catch (error) {
    return {
      current: false,
      reason: `its package does not read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (manifest.name !== agentId) {
    const root = workspaceRootHint(agentId, manifest.name);
    return {
      current: false,
      reason:
        root === undefined
          ? `its package names ${manifest.name}`
          : `its package names ${manifest.name}: this directory is above the workspace; run cernanto from ${root}/`,
    };
  }
  if (entry.foreign === true) {
    return { current: true, path: entry.path, digest: entry.digest, manifest, foreign: true };
  }
  const spec = workspaceSpecOf(agentsRoot, agentId);
  if (spec === undefined) return { current: false, reason: 'no spec in the tree' };
  const specBytes = readFileSync(spec);
  const specText = specBytes.toString('utf8');
  // The package was compiled from the page as it is: the page's sha is
  // the manifest's specSha, or the page moved.
  if (options.asItIs !== true && sha256Hex(specBytes) !== manifest.specSha) {
    return { current: false, reason: 'its spec moved since the package was compiled' };
  }
  // The manifest mirrors the spec's notice labels (the registry refuses
  // a package without a license): a label the manifest does not carry
  // yet is a package to write again under the same text.
  if (options.asItIs !== true && !noticeCurrent(specText, manifest)) {
    return { current: false, reason: 'its notice labels moved since the package was compiled' };
  }
  if (options.asItIs !== true) {
    const moved = grantedFilesMoved(agentsRoot, spec, specText, manifest);
    if (moved !== undefined) return { current: false, reason: moved };
  }
  const pinned: { id: string; hash: string }[] = [];
  for (const [id, use] of Object.entries(manifest.uses)) {
    if (use.contractHash !== undefined) pinned.push({ id, hash: use.contractHash });
  }
  for (const claim of manifest.implements ?? []) {
    const sha: unknown = (claim as { contractSha?: unknown }).contractSha;
    if (typeof sha === 'string' && !claim.id.startsWith('openapi:')) {
      pinned.push({ id: claim.id, hash: sha });
    }
  }
  // Every pin on a dependency the tree holds a package for is judged,
  // a platform agent's included: the platform's own workspace pins
  // its agents on each other, and a customer's workspace holds no
  // package for the platform agents it grants.
  for (const pin of pinned) {
    const dependency = tree.packages[pin.id];
    if (dependency === undefined) continue;
    let contractHash: string | undefined;
    let compatibleWith: string[] = [];
    try {
      const manifest = readCernPackage(readFileSync(dependency.path)).manifest;
      contractHash = manifest.contractHash;
      compatibleWith = manifest.contractCompatibleWith ?? [];
    } catch {
      continue;
    }
    // A pin the dependency's current contract lists as compatible is
    // current, as the plane's own rule reads it (the converge's
    // ContractsCompatible): a compatible change of a dependency, an
    // added optional input, leaves its dependents as they are.
    if (contractHash !== pin.hash && !compatibleWith.includes(pin.hash)) {
      return {
        current: false,
        reason: `${pin.id} moved: the package was compiled against another contract of it`,
      };
    }
  }
  return { current: true, path: entry.path, digest: entry.digest, manifest };
}

/** The plane surface a landing needs; the gateway client satisfies it,
 * tests fake it. */
export interface LandingPlane {
  /** Whether the plane holds a package of the digest. */
  packageExists(digest: string): Promise<boolean>;
  /** Puts a package's bytes on the plane under its digest. */
  packagePut(digest: string, bytes: Buffer): Promise<void>;
  /** Lands packages into the fleet: the plane reads their manifests,
   * resolves one closure, admits it and ships the rows in one ship.
   * A target is the digest of a package the plane holds, or a registry
   * reference the plane resolves through the index; `targets` lands
   * several as one landing, `target` one. `installed` marks a third
   * party's packages; a deploy lands the author's own without it. */
  land(body: {
    target?: string;
    targets?: string[];
    noDeps?: boolean;
    installed?: boolean;
  }): Promise<LandingAnswer>;
  /** The fleet's rows, with their verified stamps. */
  rows?(): Promise<FleetAgentRowWire[]>;
}

/** Whether an id names a package of the platform: one of the namespace
 * the platform's publisher holds in the registry. */
export function isPlatformAgent(agentId: string): boolean {
  return agentId.startsWith(`${PLATFORM_NAMESPACE}/`);
}

/**
 * The third parties' packages the plane pulled from the registry for
 * these agents, kept in the workspace as one deployed from a file is:
 * for each agent's row, each use whose row carries the package mark,
 * has no spec in this workspace, and whose copy the tree lacks or
 * holds under another digest, is read off the plane by its digest and
 * written to the root's `.cern/` folder, its own uses walked the same
 * way, so the tree stays whole and a clone lands the same bytes.
 * Answers the ids kept, in the order written; a plane that cannot
 * answer rows or packages keeps nothing.
 */
export async function keepPulledPackages(
  client: { rows?(): Promise<FleetAgentRowWire[]>; packageGet?(digest: string): Promise<Buffer> },
  agentsRoot: string,
  agentIds: string[],
  onLine?: (line: string) => void,
): Promise<string[]> {
  if (client.rows === undefined || client.packageGet === undefined) return [];
  const rows = await client.rows().catch((): FleetAgentRowWire[] => []);
  const byId = new Map(rows.map((row) => [row.agentId, row]));
  const tree = treePackages(agentsRoot).packages;
  const kept: string[] = [];
  const queue = [...agentIds];
  const seen = new Set<string>();
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    if (row === undefined) continue;
    for (const use of row.uses) {
      const dependency = byId.get(use);
      if (dependency?.package === undefined) continue;
      // The platform's packages are the release's own: every plane
      // holds them by the release it runs, so a workspace keeps none.
      if (isPlatformAgent(use)) continue;
      if (workspaceSpecOf(agentsRoot, use) !== undefined) continue;
      queue.push(use);
      if (tree[use]?.digest === dependency.artifact) continue;
      const bytes = await client.packageGet(dependency.artifact).catch(() => undefined);
      if (bytes === undefined) continue;
      const landing = foreignPackagePath(agentsRoot, use);
      mkdirSync(dirname(landing), { recursive: true });
      writeFileSync(landing, bytes);
      tree[use] = { path: landing, digest: dependency.artifact, foreign: true };
      kept.push(use);
      const shown = relative(agentsRoot, landing).split(sep).join('/');
      onLine?.(
        `kept ${use}${dependency.package.version === undefined ? '' : ` ${dependency.package.version}`} at ${shown}; commit it with your agents\n`,
      );
    }
  }
  return kept;
}

/** What a landing answers: the given package, the packages the
 * registry supplied for its closure, and the warnings. */
export interface LandingAnswer {
  landed: LandedPackage[];
  resolved: LandedPackage[];
  warnings: string[];
}

export interface LandedPackage {
  agentId: string;
  version: string;
  digest: string;
  neededBy?: string;
}

export interface LandPackagesOptions {
  agentsRoot?: string;
  /** A line per package landed, resolved or handed to the compile. */
  onLine?: (line: string) => void;
  /** The packages as they are: a spec or a granted file that moved
   * since its package was compiled does not hold the package back (the
   * tree's packages land together; the deploy that recompiles one is the
   * author's next step), while the pins are still held to the tree. */
  asTheyAre?: boolean;
  /** The deploy verifies: a landed target whose row carries no
   * verified stamp goes on to the compile, where the plane re-gates the
   * held package with no session, runs its tests live and stamps the
   * row. A package shipped with --no-verify is verified this way by
   * the next deploy that names it. */
  verify?: boolean;
  /** Land what was given even when a dependency cannot be resolved
   * from the registry: the plane names it and warns, instead of
   * refusing. */
  noDeps?: boolean;
}

/** What the landing left: the packages that landed, in landing order,
 * and the targets the compile takes, each with why. */
export interface Landing {
  landed: LandedPackage[];
  toCompile: { agentId: string; reason: string }[];
}

/**
 * The tree road: every target whose package is current, with its
 * current workspace dependencies, lands as it is, a package before the
 * packages that need it, through the plane's landing (the plane reads
 * the manifest, composes the row, admits it and ships it). A target
 * that is not current, or whose landing the plane refuses, is handed
 * to the compile with the reason. A foreign package lands as a third
 * party's.
 */
/** How long a landing keeps asking a gateway that cannot be reached: the
 * plane's own gateway rolls in seconds on a laptop, in minutes on
 * servers bringing a release up, and a landing under way must
 * outlive that: a pass cut in the middle leaves the plane rolling its
 * carriers once more for every pass that follows. */
const GATEWAY_PATIENCE_MS = 300_000;

/** A land asked again while the plane says to (the gateway out of reach,
 * a platform agent rolling: a retryable failure or a target that is
 * away), for as long as the patience lasts; any other failure is the
 * landing's own. */
async function landWhenReachable(
  client: LandingPlane,
  body: Parameters<LandingPlane['land']>[0],
): Promise<LandingAnswer> {
  const deadline = Date.now() + GATEWAY_PATIENCE_MS;
  for (;;) {
    try {
      return await client.land(body);
    } catch (error) {
      const retryable =
        error instanceof CernantoError &&
        (error.kind === 'retryable' || error.kind === 'target-unavailable');
      if (!retryable || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/** Whether a refusal is one the bytes cure: the plane holds a package's
 * record and not its bytes, or the bytes left between the existence
 * read and the landing (a retired generation's digest, removed the
 * moment nothing named it), said by the landing itself or by the
 * admission's catalog read of one of the digests landed. */
function curedByTheBytes(words: string, digests: readonly string[]): boolean {
  if (words.includes('upload its complete .cern package') || words.includes('upload it first'))
    return true;
  return digests.some((digest) =>
    words.includes(`artifact ${digest.slice(0, 19)} is not in the package catalog`),
  );
}

/** A package's record read from its bytes alone, judged or not: a stale
 * package still says what it uses and which interface it implements. */
function recordOfPackage(path: string | undefined): PackageManifest | undefined {
  if (path === undefined) return undefined;
  try {
    return readCernPackage(readFileSync(path)).manifest;
  } catch {
    return undefined;
  }
}

/** The interface claims a package's record makes. */
function claimsOfPackage(path: string | undefined): { id: string }[] {
  return recordOfPackage(path)?.implements ?? [];
}

/** How many landings are in flight at once. */
const LANDINGS_AT_ONCE = 8;

/** How many packages go up to the plane at once. */
const UPLOADS_AT_ONCE = 8;

export async function landPackages(
  client: LandingPlane,
  targets: string[],
  options: LandPackagesOptions,
): Promise<Landing> {
  const agentsRoot = options.agentsRoot ?? agentsRootOf();
  const tree = treePackages(agentsRoot);
  const judged = new Map<string, PackageCurrency>();
  const judge = (agentId: string): PackageCurrency => {
    let state = judged.get(agentId);
    if (state === undefined) {
      state = packageCurrency(agentsRoot, agentId, tree, { asItIs: options.asTheyAre === true });
      judged.set(agentId, state);
    }
    return state;
  };
  // A workspace dependency: one with a spec and a package in the tree
  // (a platform agent a customer's workspace grants has no spec there,
  // and the platform's own workspace holds them all).
  const workspaceUses = (manifest: PackageManifest): string[] =>
    Object.keys(manifest.uses).filter(
      (id) => tree.packages[id] !== undefined && workspaceSpecOf(agentsRoot, id) !== undefined,
    );
  const usesOfPackage = (path: string | undefined): string[] => {
    const record = recordOfPackage(path);
    return record === undefined ? [] : workspaceUses(record);
  };
  const toCompile: { agentId: string; reason: string }[] = [];
  const named = new Set<string>();
  const handToCompile = (agentId: string, reason: string): void => {
    if (named.has(agentId)) return;
    named.add(agentId);
    toCompile.push({ agentId, reason });
  };
  // Every stale package in an agent's closure is the compile's own
  // target, the agent itself included when it is stale: the compiler
  // compiles what is given and reads the rest from the tree, so a stale
  // dependency handed in under its dependent's name would be read as it
  // is and never compiled. A recompiled dependency whose contract moves takes
  // its deployed dependents with it through the compiler's cascade; one
  // whose contract holds leaves them as they are.
  const stale = (agentId: string, trail: Set<string>): { agentId: string; reason: string }[] => {
    if (trail.has(agentId)) return [];
    trail.add(agentId);
    const state = judge(agentId);
    // A stale agent's own dependencies are walked as well: a stale
    // package still names what it uses, and a stale module under a
    // stale front is the compile's target in its own right.
    const below = usesOfPackage(tree.packages[agentId]?.path).flatMap((id) => stale(id, trail));
    return state.current ? below : [{ agentId, reason: state.reason }, ...below];
  };
  const order: string[] = [];
  // The workspace's implementors of an interface: the packages whose
  // record claims it. A current one lands right after the interface
  // and before anything that uses it, so a carrier is always planned
  // with the implementor its generation composes (the plane passes
  // after every landing, and a generation born without its implementor
  // rolls the moment the implementor lands); a stale one goes to the
  // compile, so a consumer's live tests find every implementor of the
  // workspace deployed.
  const implementorsOf = (interfaceId: string): string[] =>
    Object.keys(tree.packages)
      .filter((id) => {
        if (id === interfaceId || workspaceSpecOf(agentsRoot, id) === undefined) return false;
        const state = judge(id);
        const claims = state.current
          ? (state.manifest.implements ?? [])
          : claimsOfPackage(tree.packages[id]?.path);
        return claims.some((claim) => claim.id === interfaceId);
      })
      .sort();
  const visiting = new Set<string>();
  // An agent whose dependency is mid-visit above it (an implementor that
  // uses a sibling implementor, both reached through their interface)
  // waits for the pass to end and joins after that dependency landed.
  const deferred: string[] = [];
  const visit = (agentId: string): boolean => {
    if (order.includes(agentId)) return true;
    if (visiting.has(agentId)) return false;
    const state = judge(agentId);
    if (!state.current) return true;
    visiting.add(agentId);
    let ready = true;
    for (const id of workspaceUses(state.manifest)) if (!visit(id)) ready = false;
    // An implementor lands after the interface it implements: the plane
    // reads a stamp as a need of the package, and refuses an implementor
    // whose interface is not deployed yet.
    for (const claim of state.manifest.implements ?? []) {
      if (
        !claim.id.startsWith('openapi:') &&
        tree.packages[claim.id] !== undefined &&
        !visit(claim.id)
      ) {
        ready = false;
      }
    }
    if (!ready) {
      visiting.delete(agentId);
      if (!deferred.includes(agentId)) deferred.push(agentId);
      return false;
    }
    order.push(agentId);
    if (state.manifest.type === 'interface') {
      for (const id of implementorsOf(agentId)) {
        const implementor = judge(id);
        if (implementor.current) visit(id);
        else handToCompile(id, implementor.reason);
      }
    }
    visiting.delete(agentId);
    return true;
  };
  const settle = (): void => {
    for (let rounds = 0; deferred.length > 0 && rounds < 64; rounds += 1) {
      for (const id of deferred.splice(0)) visit(id);
    }
  };
  for (const target of targets) {
    const found = stale(target, new Set());
    const above = found.find((one) => one.reason.includes('this directory is above the workspace'));
    if (above !== undefined) {
      throw new CernantoError({ kind: 'terminal', message: `${above.agentId}: ${above.reason}` });
    }
    for (const one of found) handToCompile(one.agentId, one.reason);
    // A current target lands now with the current part of its closure;
    // a stale one is the compile's, whole.
    if (!found.some((one) => one.agentId === target)) {
      visit(target);
      settle();
    }
  }
  const landed: LandedPackage[] = [];
  const failed = new Set<string>();
  // The schedule: a package lands the moment everything that must land
  // before it has (what it uses, the interfaces it implements, and the
  // implementors of the interfaces it uses, so a carrier is always
  // planned with its implementor), and the ready ones go in the
  // order of the largest closure among the packages that need them: the
  // plane takes landings one at a time, and this way the carrier with
  // the most to compose is planned the earliest (the compiler and its
  // twenty modules, whose materialize takes seconds).
  const current = order.filter((agentId) => judge(agentId).current);
  const currentSet = new Set(current);
  const beforeOf = new Map<string, Set<string>>();
  for (const agentId of current) {
    const state = judge(agentId);
    if (!state.current) continue;
    const before = new Set<string>();
    for (const id of workspaceUses(state.manifest)) {
      if (currentSet.has(id)) before.add(id);
      const used = judge(id);
      if (used.current && used.manifest.type === 'interface')
        for (const implementor of implementorsOf(id))
          if (currentSet.has(implementor)) before.add(implementor);
    }
    for (const claim of state.manifest.implements ?? [])
      if (currentSet.has(claim.id)) before.add(claim.id);
    before.delete(agentId);
    beforeOf.set(agentId, before);
  }
  const closures = new Map<string, Set<string>>();
  const closureOf = (agentId: string): Set<string> => {
    const known = closures.get(agentId);
    if (known !== undefined) return known;
    const closure = new Set<string>();
    closures.set(agentId, closure);
    const state = judge(agentId);
    if (!state.current) return closure;
    for (const id of workspaceUses(state.manifest)) {
      if (!currentSet.has(id)) continue;
      closure.add(id);
      for (const below of closureOf(id)) closure.add(below);
    }
    return closure;
  };
  // What a carrier composes: the modules it links and the modules
  // those link, the way its generation is materialized (a module of a
  // module is placed beside it); a package that is not a module ends
  // the walk. The count is what a generation's materialize costs.
  const composedOf = (carrier: string): number => {
    const modules = new Set<string>();
    const queue = [carrier];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      const state = judge(id);
      if (!state.current) continue;
      const linked = workspaceUses(state.manifest).flatMap((used) => {
        const other = judge(used);
        if (!other.current) return [];
        if (other.manifest.type === 'module') return [used];
        if (other.manifest.type === 'interface')
          return implementorsOf(used).filter((implementor) => {
            const found = judge(implementor);
            return found.current && found.manifest.type === 'module';
          });
        return [];
      });
      for (const module of linked) {
        if (module === carrier || modules.has(module)) continue;
        modules.add(module);
        queue.push(module);
      }
    }
    return modules.size;
  };
  const priority = new Map<string, number>();
  for (const carrier of current) {
    const composed = composedOf(carrier);
    for (const member of [carrier, ...closureOf(carrier)])
      priority.set(member, Math.max(priority.get(member) ?? 0, composed));
  }
  const answers = new Map<string, LandingAnswer>();
  /** A landed target that could have been verified and was not goes
   * to the compile: a worker's run is its proof and an interface runs
   * nothing, so neither ever carries a stamp. */
  const verifyLanded = async (agentId: string): Promise<void> => {
    const state = judge(agentId);
    if (
      options.verify !== true ||
      !state.current ||
      state.foreign === true ||
      !targets.includes(agentId) ||
      client.rows === undefined
    )
      return;
    const fleet = await client.rows().catch((): FleetAgentRowWire[] => []);
    const row = fleet.find((one) => one.agentId === agentId);
    const proven = row?.type === 'worker' || row?.type === 'interface';
    if (row !== undefined && row.verified === undefined && !proven)
      handToCompile(agentId, 'deployed, not verified');
  };
  // The one landing: every
  // current package of the author's own lands in one call, in landing
  // order, so the plane admits and ships them together and rolls each
  // carrier once. A plane that refuses the batch is asked again one
  // package at a time below, which names the culprit and hands it to
  // the compile; a third party's packages land one at a time as well.
  const batch = order.filter((agentId) => {
    const state = judge(agentId);
    return state.current && state.foreign !== true;
  });
  const landedTogether = new Set<string>();
  if (batch.length > 1) {
    const digests = new Map<string, string>();
    const uploads: { digest: string; path: string }[] = [];
    for (const agentId of batch) {
      const state = judge(agentId);
      if (!state.current) continue;
      digests.set(agentId, state.digest);
      uploads.push({ digest: state.digest, path: state.path });
    }
    // The plane takes the bytes in any order, so several go up at once.
    let next = 0;
    const upload = async (): Promise<void> => {
      for (;;) {
        const one = uploads[next];
        if (one === undefined) return;
        next += 1;
        if (!(await client.packageExists(one.digest)))
          await client.packagePut(one.digest, readFileSync(one.path));
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, uploads.length) }, upload));
    const body = {
      targets: [...digests.values()],
      ...(options.noDeps === true ? { noDeps: true } : {}),
    };
    let answer: LandingAnswer | undefined;
    try {
      try {
        answer = await landWhenReachable(client, body);
      } catch (error) {
        const words = error instanceof Error ? error.message : String(error);
        if (!curedByTheBytes(words, [...digests.values()])) throw error;
        for (const agentId of batch) {
          const state = judge(agentId);
          if (state.current) await client.packagePut(state.digest, readFileSync(state.path));
        }
        answer = await client.land(body);
      }
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error);
      options.onLine?.(
        `the plane refused the one landing (${words}); landing one package at a time\n`,
      );
      answer = undefined;
    }
    if (answer !== undefined) {
      const [first] = batch;
      for (const one of answer.landed) {
        answers.set(one.agentId, {
          landed: [one],
          resolved: one.agentId === first ? answer.resolved : [],
          warnings: one.agentId === first ? answer.warnings : [],
        });
        options.onLine?.(`landed ${one.agentId} ${one.version} (${one.digest.slice(0, 19)}...)\n`);
      }
      for (const one of answer.resolved)
        options.onLine?.(
          `resolved ${one.agentId} ${one.version} (${one.digest.slice(0, 19)}...)${one.neededBy === undefined ? '' : `, needed by ${one.neededBy}`}\n`,
        );
      for (const warning of answer.warnings) options.onLine?.(`warning: ${warning}\n`);
      for (const agentId of batch) {
        landedTogether.add(agentId);
        await verifyLanded(agentId);
      }
    }
  }
  const landOne = async (agentId: string): Promise<void> => {
    const state = judge(agentId);
    if (!state.current) return;
    // A dependency the plane refused takes its dependents with it: the
    // compiler answers for the closure.
    const broken = workspaceUses(state.manifest).find((id) => failed.has(id));
    if (broken !== undefined) {
      failed.add(agentId);
      if (targets.includes(agentId)) {
        handToCompile(agentId, `${broken} goes to the compile`);
      }
      return;
    }
    if (!(await client.packageExists(state.digest))) {
      await client.packagePut(state.digest, readFileSync(state.path));
    }
    const body = {
      target: state.digest,
      ...(state.foreign === true ? { installed: true } : {}),
      ...(options.noDeps === true ? { noDeps: true } : {}),
    };
    let answer: LandingAnswer;
    try {
      try {
        answer = await landWhenReachable(client, body);
      } catch (error) {
        // The bytes the plane lacks, uploaded, and asked once more.
        const words = error instanceof Error ? error.message : String(error);
        if (!curedByTheBytes(words, [state.digest])) throw error;
        await client.packagePut(state.digest, readFileSync(state.path));
        answer = await client.land(body);
      }
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error);
      failed.add(agentId);
      if (state.foreign === true) {
        throw new CernantoError({ kind: 'terminal', message: `${agentId}: ${words}` });
      }
      handToCompile(agentId, words);
      options.onLine?.(`${agentId}: ${words}; compiling it\n`);
      return;
    }
    answers.set(agentId, answer);
    for (const one of answer.landed)
      options.onLine?.(`landed ${one.agentId} ${one.version} (${one.digest.slice(0, 19)}...)\n`);
    for (const one of answer.resolved)
      options.onLine?.(
        `resolved ${one.agentId} ${one.version} (${one.digest.slice(0, 19)}...)${one.neededBy === undefined ? '' : `, needed by ${one.neededBy}`}\n`,
      );
    for (const warning of answer.warnings) options.onLine?.(`warning: ${warning}\n`);
    await verifyLanded(agentId);
  };
  // What landed together is settled; the rest goes one at a time.
  const waiting = new Set(current.filter((agentId) => !landedTogether.has(agentId)));
  const settled = new Set<string>(landedTogether);
  await new Promise<void>((finish, fail) => {
    let inFlight = 0;
    const ready = (): string[] => {
      const found = [...waiting].filter((agentId) =>
        [...(beforeOf.get(agentId) ?? [])].every((id) => settled.has(id)),
      );
      // Nothing ready with landings still waiting: a cycle (an
      // implementor using a sibling implementor, both reached through
      // their interface); what waits lands in the order given.
      const chosen = found.length === 0 && inFlight === 0 ? [...waiting] : found;
      return chosen.sort(
        (a, b) =>
          (priority.get(b) ?? 0) - (priority.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b),
      );
    };
    const pump = (): void => {
      if (waiting.size === 0 && inFlight === 0) {
        finish();
        return;
      }
      for (const agentId of ready()) {
        if (inFlight >= LANDINGS_AT_ONCE) break;
        waiting.delete(agentId);
        inFlight += 1;
        landOne(agentId).then(() => {
          settled.add(agentId);
          inFlight -= 1;
          pump();
        }, fail);
      }
    };
    pump();
  });
  // What landed, told in the landing order.
  for (const agentId of order) {
    const answer = answers.get(agentId);
    if (answer === undefined) continue;
    for (const one of answer.landed) landed.push(one);
    for (const one of answer.resolved) landed.push(one);
  }
  for (const one of toCompile) {
    if (one.reason.endsWith('goes to the compile')) continue;
    if (failed.has(one.agentId)) continue;
    options.onLine?.(`${one.agentId}: ${one.reason}; compiling it\n`);
  }
  return { landed, toCompile };
}

/** A platform folder read by its record: the record's body and digest,
 * and each package the record names, at the place its id names in the
 * folder, with the digest of its bytes and its manifest. */
export interface PlatformFolder {
  body: PlatformReleaseBody;
  digest: string;
  packages: { id: string; path: string; digest: string; manifest: PackageManifest }[];
}

/**
 * Reads a platform folder, the layout a pull from the registry lays and
 * a pack of a release writes, BY ITS RECORD and never by what the folder
 * happens to hold: `platform-release.json` at its root names the
 * packages, each is read at the place its id names and held to the
 * record (the bytes' digest, the package digest, the name and the
 * version), and a package file the record does not name refuses the
 * folder. A folder that disagrees with its record is refused in words
 * naming the package.
 */
export function readPlatformFolder(folder: string): PlatformFolder {
  const refuse = (message: string): never => {
    throw new CernantoError({ kind: 'terminal', message: `the platform at ${folder}: ${message}` });
  };
  let record: Buffer;
  try {
    record = readFileSync(join(folder, PLATFORM_RELEASE_FILE));
  } catch {
    return refuse(`no ${PLATFORM_RELEASE_FILE}; it is not a platform folder`);
  }
  let read: ReturnType<typeof readPlatformRelease>;
  try {
    read = readPlatformRelease(record);
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
  const packages: PlatformFolder['packages'] = [];
  const named = new Set<string>();
  for (const entry of read.body.packages) {
    const relativePath = workspacePackagePath(entry.id);
    named.add(relativePath);
    const path = join(folder, ...relativePath.split('/'));
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      return refuse(`${entry.id} is named by the record and ${relativePath} is not there`);
    }
    const digest = sha256Of(bytes);
    if (digest !== entry.blobDigest) {
      return refuse(
        `${entry.id} does not match its record (${relativePath} is ${digest}, the record names ${entry.blobDigest})`,
      );
    }
    let manifest: PackageManifest;
    let packageDigest: string;
    try {
      const pkg = readCernPackage(bytes);
      manifest = pkg.manifest;
      packageDigest = pkg.packageDigest;
    } catch (error) {
      return refuse(
        `${entry.id} does not read as a package: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      packageDigest !== entry.packageDigest ||
      manifest.name !== entry.id ||
      manifest.version !== entry.version
    ) {
      return refuse(
        `${entry.id} does not match its record (${relativePath} holds ${manifest.name} ${manifest.version}, ${packageDigest})`,
      );
    }
    packages.push({ id: entry.id, path, digest, manifest });
  }
  // A package file the record does not name: the folder holds more
  // than its release.
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      if (entry.name.startsWith('.') && entry.name !== '.cern') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (basename(dir) !== '.cern' || !entry.name.endsWith(PACKAGE_EXTENSION)) continue;
      const relativePath = relative(folder, path).split(sep).join('/');
      if (!named.has(relativePath)) refuse(`${relativePath} is not named by the record`);
    }
  };
  walk(folder);
  return { body: read.body, digest: read.digest, packages };
}

/** The packages in landing order: each after the ones it uses and the
 * interfaces it implements, among the packages given; ids in their own
 * order where nothing else decides. */
function dependenciesFirst(packages: PlatformFolder['packages']): PlatformFolder['packages'] {
  const byId = new Map(packages.map((one) => [one.id, one]));
  const ordered: PlatformFolder['packages'] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    const one = byId.get(id);
    if (one === undefined || seen.has(id)) return;
    seen.add(id);
    const needs = [
      ...Object.keys(one.manifest.uses),
      ...(one.manifest.implements ?? []).map((claim) => claim.id),
    ].sort();
    for (const need of needs) visit(need);
    ordered.push(one);
  };
  for (const id of [...byId.keys()].sort()) visit(id);
  return ordered;
}

/**
 * Lands a platform folder into the fleet from its record: exactly the
 * record's packages, each put on the plane under its digest unless the
 * plane holds it, then all of them as ONE landing marked `installed`,
 * so the plane admits and ships them together, rolls each carrier once
 * and shows the platform as the installed packages of its publisher.
 * The plane's own landing of the release reads the same record and
 * lands the same digests, so the two never disagree.
 */
export async function landPlatformFolder(
  client: LandingPlane,
  platform: PlatformFolder,
): Promise<LandingAnswer> {
  const ordered = dependenciesFirst(platform.packages);
  let next = 0;
  const upload = async (): Promise<void> => {
    for (;;) {
      const one = ordered[next];
      if (one === undefined) return;
      next += 1;
      if (!(await client.packageExists(one.digest)))
        await client.packagePut(one.digest, readFileSync(one.path));
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, ordered.length) }, upload));
  const digests = ordered.map((one) => one.digest);
  const body = { targets: digests, installed: true };
  try {
    return await landWhenReachable(client, body);
  } catch (error) {
    // The bytes the plane lacks after all, put again, and asked once more.
    const words = error instanceof Error ? error.message : String(error);
    if (!curedByTheBytes(words, digests)) throw error;
    for (const one of ordered) await client.packagePut(one.digest, readFileSync(one.path));
    return client.land(body);
  }
}
