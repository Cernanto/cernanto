// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parseSpecLabels } from '@cernanto/package-format';
import type { CernPackage, PackageManifest } from '@cernanto/package-format';

// The files a spec grants, as the tree holds them: what a package compiled
// from the spec now would carry under `files/` and `tests/assets/`. The
// labels are read through the kit's twin of the compiler's grammar, so a
// fenced label and a near miss mean the same thing on both sides; a
// grant's path resolves by the compiler's grant rule, and a granted
// folder is walked as the compiler walks it, so the two inventories are
// held to each other whole: a file that moved, one that left and one
// that was added each make the package the compiler's to write again.

/** Where a package keeps the files the spec grants its code. */
const FILES_DIR = 'files/';

/** Where a package keeps the files the Tests section grants its tests. */
const TEST_ASSETS_DIR = 'tests/assets/';

const FILE_GRANT_PATH = /^\/?(?:[^/\\\0]+\/)*[^/\\\0]*$/;

/** Whether a written path is one a `file:` grant may carry. */
function isFileGrantPath(path: string): boolean {
  return FILE_GRANT_PATH.test(path) && path.replace(/\/+$/, '') !== '';
}

/** The paths a section's `Uses:` grants as files, as written. */
function fileGrantsOf(uses: readonly string[]): string[] {
  return uses
    .filter((entry) => entry.startsWith('file:'))
    .map((entry) => entry.slice('file:'.length))
    .filter(isFileGrantPath);
}

/** The document a spec implements, as written: the rest of the
 * `openapi:` entry of its `Implements:`, a path in the tree or a url. */
function implementedDocumentOf(implemented: readonly string[]): string | undefined {
  return implemented.find((entry) => entry.startsWith('openapi:'))?.slice('openapi:'.length);
}

/** A file the tree holds for a grant: its path inside the package's
 * folder of granted files, and where it lies. */
interface GrantedFile {
  path: string;
  source: string;
}

/** The files one written grant names, or the words for a grant the
 * tree cannot answer. A path with a leading slash is read from the
 * workspace root and any other from the spec's folder; a file rides
 * under its own name and a folder's files under the folder's name,
 * each at its path inside the folder. Dot names and `node_modules` are
 * left out of a folder, and so is anything that is neither a file nor
 * a folder. */
function locate(
  agentsRoot: string,
  specDir: string,
  written: string,
): { files: GrantedFile[] } | { problem: string } {
  const target = written.startsWith('/') ? join(agentsRoot, written) : resolve(specDir, written);
  const fromRoot = relative(agentsRoot, target).split(sep).join('/');
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
    return { problem: `the granted file ${written} lies outside the workspace` };
  }
  const name = fromRoot.slice(fromRoot.lastIndexOf('/') + 1);
  const found = lstatSync(target, { throwIfNoEntry: false });
  if (found === undefined) return { problem: `the granted file ${written} is gone from the tree` };
  if (found.isFile()) return { files: [{ path: name, source: target }] };
  if (!found.isDirectory()) {
    return { problem: `the granted file ${written} is neither a file nor a folder` };
  }
  const files: GrantedFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else if (entry.isFile()) files.push({ path, source: join(dir, entry.name) });
    }
  };
  walk(target, name);
  if (files.length === 0) return { problem: `the granted folder ${written} holds no file` };
  return { files };
}

/** The files a list of written grants names, by their path inside the
 * package's folder: every tree file that rides under the path. */
function located(
  agentsRoot: string,
  specDir: string,
  grants: readonly string[],
): { files: Map<string, string[]> } | { problem: string } {
  const files = new Map<string, string[]>();
  for (const written of grants) {
    const answer = locate(agentsRoot, specDir, written);
    if ('problem' in answer) return answer;
    for (const file of answer.files) {
      const sources = files.get(file.path) ?? [];
      if (!sources.includes(file.source)) sources.push(file.source);
      files.set(file.path, sources);
    }
  }
  return { files };
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The package paths a manifest names for the document it implements. */
function documentFilesOf(manifest: PackageManifest): Set<string> {
  const named = new Set<string>();
  for (const claim of manifest.implements ?? []) {
    const file: unknown = (claim as { file?: unknown }).file;
    if (typeof file === 'string') named.add(file);
  }
  return named;
}

/** One folder of a package held to the tree's files for it: the first
 * difference in words, a recorded file that moved or left, or a tree
 * file the package does not carry. */
function difference(
  recorded: ReadonlyMap<string, string>,
  held: ReadonlyMap<string, string[]>,
  whose: string,
): string | undefined {
  for (const [path, sha256] of recorded) {
    const sources = held.get(path);
    if (sources === undefined) return `${whose} ${path} is gone from the tree`;
    if (!sources.some((source) => sha256Hex(readFileSync(source)) === sha256)) {
      return `${whose} ${path} moved since the package was compiled`;
    }
  }
  for (const path of held.keys()) {
    if (!recorded.has(path)) return `${whose} ${path} was added since the package was compiled`;
  }
  return undefined;
}

/**
 * Why a package no longer carries the files its spec grants, or
 * undefined when it carries them all as the tree holds them: the files
 * the spec's `Uses:` grants and the document it implements from the
 * tree, under `files/`, and the files its Tests section grants, under
 * `tests/assets/`, for a package that carries tests. A document
 * implemented from a url is the compiler's to fetch and is held to
 * nothing here. The spec is the one the package was compiled from, so its
 * grants are the package's own.
 */
export function grantedFilesMoved(
  agentsRoot: string,
  specPath: string,
  specText: string,
  manifest: PackageManifest,
): string | undefined {
  const specDir = dirname(specPath);
  const labels = parseSpecLabels(specText);
  const document = implementedDocumentOf(labels.head.implements);
  const inTree = document !== undefined && isFileGrantPath(document);
  const own = located(agentsRoot, specDir, [
    ...fileGrantsOf(labels.head.uses),
    ...(inTree ? [document] : []),
  ]);
  if ('problem' in own) return own.problem;
  const fetched = document !== undefined && !inTree ? documentFilesOf(manifest) : new Set<string>();
  const recorded = (folder: string): Map<string, string> =>
    new Map(
      Object.entries(manifest.record)
        .filter(([path]) => path.startsWith(folder) && !fetched.has(path))
        .map(([path, entry]) => [path.slice(folder.length), entry.sha256]),
    );
  const moved = difference(recorded(FILES_DIR), own.files, 'the granted file');
  if (moved !== undefined || manifest.tests === undefined) return moved;
  const forTests = located(agentsRoot, specDir, fileGrantsOf(labels.tests?.uses ?? []));
  if ('problem' in forTests) return forTests.problem;
  return difference(recorded(TEST_ASSETS_DIR), forTests.files, "the tests' granted file");
}

/** A file a package carries for one of its page's grants, where a tree
 * holds it. */
export interface GrantedPlace {
  path: string;
  bytes: Buffer;
}

/**
 * Where the files a package carries for its page's grants lie in a
 * tree: the rule above read backwards, off the page's own grant lines.
 * A grant is read from the page's folder, or from the workspace root
 * when it opens with a slash; the package's file of the grant's own
 * name goes to that path, and the files under a folder of that name go
 * under it, each at its path inside the folder. The files the code is
 * granted and a document implemented from the tree are read from
 * `files/`, the files the tests are granted from `tests/assets/`. A
 * grant that lies outside the workspace, a file the package carries
 * that no grant line names, and two files of the package that would
 * land on one path with different bytes are each answered in words,
 * with no place at all: a package laid this way is one the judgement
 * above calls current.
 *
 * @param agentsRoot - The workspace root.
 * @param specPath - Where the package's page lies, or will lie.
 * @param pkg - The package, read.
 * @returns The places of its granted files, or why they have none.
 * @example
 * const answer = grantedFilePlaces(root, join(root, 'ops/greeter.cern.md'), pkg);
 */
export function grantedFilePlaces(
  agentsRoot: string,
  specPath: string,
  pkg: Pick<CernPackage, 'spec' | 'manifest' | 'files' | 'tests'>,
): { places: GrantedPlace[] } | { problem: string } {
  const specDir = dirname(specPath);
  const labels = parseSpecLabels(pkg.spec);
  const document = implementedDocumentOf(labels.head.implements);
  const inTree = document !== undefined && isFileGrantPath(document);
  const fetched =
    document !== undefined && !inTree ? documentFilesOf(pkg.manifest) : new Set<string>();
  const places = new Map<string, Buffer>();
  const lay = (
    grants: readonly string[],
    carried: Readonly<Record<string, Buffer>>,
    folder: string,
    whose: string,
  ): string | undefined => {
    const named = new Set<string>();
    for (const written of grants) {
      const target = written.startsWith('/')
        ? join(agentsRoot, written)
        : resolve(specDir, written);
      const fromRoot = relative(agentsRoot, target).split(sep).join('/');
      if (
        fromRoot === '' ||
        fromRoot === '..' ||
        fromRoot.startsWith('../') ||
        isAbsolute(fromRoot)
      ) {
        return `the granted file ${written} lies outside the workspace`;
      }
      const name = fromRoot.slice(fromRoot.lastIndexOf('/') + 1);
      for (const [path, bytes] of Object.entries(carried)) {
        const place =
          path === name
            ? target
            : path.startsWith(`${name}/`)
              ? join(target, ...path.slice(name.length + 1).split('/'))
              : undefined;
        if (place === undefined) continue;
        named.add(path);
        const standing = places.get(place);
        if (standing !== undefined && !standing.equals(bytes)) {
          return `${whose} ${path} lands where another file of the package does, with other content`;
        }
        places.set(place, bytes);
      }
    }
    for (const path of Object.keys(carried)) {
      if (!named.has(path) && !fetched.has(`${folder}${path}`)) {
        return `${whose} ${path} is granted by no line of the page`;
      }
    }
    return undefined;
  };
  const own = lay(
    [...fileGrantsOf(labels.head.uses), ...(inTree ? [document] : [])],
    pkg.files,
    FILES_DIR,
    'the granted file',
  );
  if (own !== undefined) return { problem: own };
  if (pkg.manifest.tests !== undefined) {
    // The package holds its tests by their path under `tests/`; the
    // files the tests are granted lie in the assets folder among them.
    const inTests = TEST_ASSETS_DIR.slice('tests/'.length);
    const assets = Object.fromEntries(
      Object.entries(pkg.tests)
        .filter(([path]) => path.startsWith(inTests))
        .map(([path, bytes]) => [path.slice(inTests.length), bytes]),
    );
    const forTests = lay(
      fileGrantsOf(labels.tests?.uses ?? []),
      assets,
      TEST_ASSETS_DIR,
      "the tests' granted file",
    );
    if (forTests !== undefined) return { problem: forTests };
  }
  return { places: [...places].map(([path, bytes]) => ({ path, bytes })) };
}

/** A file a verb lays in a tree, and the agent whose file it is. */
export interface LaidFile extends GrantedPlace {
  agentId: string;
}

/**
 * The page of a package and the files the page grants, as files of a
 * tree: the page at the path the agent's id names under the root, and
 * each granted file at the place the rule above reads it from.
 *
 * @param agentsRoot - The root the files are laid under.
 * @param specFileName - The page's file name from the root, by the agent's id.
 * @param pkg - The package, read.
 * @returns The page first and the granted files after it, or why they have no place.
 * @example
 * const answer = sourceFilesOf(root, 'ops/greeter.cern.md', pkg);
 */
export function sourceFilesOf(
  agentsRoot: string,
  specFileName: string,
  pkg: Pick<CernPackage, 'spec' | 'manifest' | 'files' | 'tests'>,
): { files: LaidFile[] } | { problem: string } {
  const agentId = pkg.manifest.name;
  const specPath = join(agentsRoot, ...specFileName.split('/'));
  const granted = grantedFilePlaces(agentsRoot, specPath, pkg);
  if ('problem' in granted) return granted;
  return {
    files: [
      { path: specPath, bytes: Buffer.from(pkg.spec, 'utf8'), agentId },
      ...granted.places.map((place) => ({ ...place, agentId })),
    ],
  };
}

/**
 * Holds files against a tree before any is written: a laying is all or
 * nothing and over nothing. A file that stands at the very bytes is
 * left as it is and is no write; a file that stands with other content,
 * and two files of one laying that name one path with different bytes,
 * are each a problem in words.
 *
 * @param agentsRoot - The root the paths are shown from.
 * @param files - The files to lay.
 * @returns The files to write, and the problems that forbid the laying.
 * @example
 * const { writes, problems } = planLaying(root, files);
 */
export function planLaying(
  agentsRoot: string,
  files: readonly LaidFile[],
): { writes: LaidFile[]; problems: string[] } {
  const shown = (path: string): string => relative(agentsRoot, path).split(sep).join('/');
  const writes = new Map<string, LaidFile>();
  const problems: string[] = [];
  for (const one of files) {
    const planned = writes.get(one.path);
    if (planned !== undefined) {
      if (!planned.bytes.equals(one.bytes)) {
        problems.push(
          `${shown(one.path)} is a file of ${planned.agentId} and of ${one.agentId}, with other content`,
        );
      }
      continue;
    }
    if (existsSync(one.path)) {
      if (readFileSync(one.path).equals(one.bytes)) continue;
      problems.push(
        `${shown(one.path)} stands here with other content, and ${one.agentId} would write over it`,
      );
      continue;
    }
    writes.set(one.path, one);
  }
  return { writes: [...writes.values()], problems };
}

/** Writes the files a laying planned, each folder made on the way. */
export function writeLaying(writes: readonly LaidFile[]): void {
  for (const one of writes) {
    mkdirSync(dirname(one.path), { recursive: true });
    writeFileSync(one.path, one.bytes);
  }
}
