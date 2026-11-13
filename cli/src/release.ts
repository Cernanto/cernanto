// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { execute, npmCommand } from '@cernanto/system';

import {
  installPlatform,
  installedPlatform,
  platformFolderOf,
  platformLaidFor,
  platformOfRuntime,
} from './platform.js';
import type { RegistryClient } from './registry.js';

// The release the cli runs. A release is a directory in the tree's
// layout: the block, the process package's tools and the packer each
// join a release root and one constant path (the process package's
// release-layout). Compiled in the tree, the cli sits at cli/dist and
// the tree is the release. Installed from npm, the cli is the thin
// client, the package `cernanto`, and the release is its own install,
// ONE VERSION in two parts: `cernanto dev` lands @cernanto/runtime at
// the cli's version, with the runtime library beneath it, under
// ~/.cernanto/runtime/<version>, with npm, then pulls the packages of
// the platform release that runtime carries from the registry into the
// platform folder beside it (platform.ts), then lays the release view,
// ~/.cernanto/release, one link per part in the tree's layout,
// relinked at every start, so every reader joins the view as it joins
// the tree (a server lays the same view with the process package's
// own release-view tool). Dev alone installs: any other verb that
// finds no plane and no release says so in words.

/** The package the runtime arrives as. */
export const RUNTIME_PACKAGE = '@cernanto/runtime';

/** The words a verb says when there is no plane and no runtime. */
export const NO_RUNTIME_WORDS =
  'no plane on this machine: the local runtime is not installed; cernanto dev installs and starts it, or cernanto login <url> points at a plane elsewhere';

/** The package this file ships in: its folder and its version. */
function ownPackage(): { dir: string; version: string } {
  const dir = resolve(import.meta.dirname, '..');
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    version?: string;
  };
  return { dir, version: manifest.version ?? '0.0.0' };
}

/** The tree, when the cli runs from its compile there. */
export function treeRelease(): string | undefined {
  const tree = resolve(ownPackage().dir, '..');
  return existsSync(join(tree, 'runtime', 'process', 'package.json')) &&
    existsSync(join(tree, 'cernanto.json'))
    ? tree
    : undefined;
}

/** Where the runtime of a version is installed. */
export function runtimePrefix(version: string, home: string = homedir()): string {
  return join(home, '.cernanto', 'runtime', version);
}

/** The runtime package installed at a prefix. */
function runtimePackageOf(prefix: string): string {
  return join(prefix, 'node_modules', ...RUNTIME_PACKAGE.split('/'));
}

/** The installed runtime of this cli's version, or nothing. */
export function installedRuntime(home: string = homedir()): string | undefined {
  const { version } = ownPackage();
  const prefix = runtimePrefix(version, home);
  const marker = join(runtimePackageOf(prefix), 'package.json');
  if (!existsSync(marker)) return undefined;
  try {
    const installed = JSON.parse(readFileSync(marker, 'utf8')) as { version?: string };
    return installed.version === version ? prefix : undefined;
  } catch {
    return undefined;
  }
}

/** The installed release of this cli's version, or nothing: the
 * runtime, and beside it the platform folder of the platform release
 * that runtime carries. Read off the disk alone. */
export function installedRelease(home: string = homedir()): string | undefined {
  const prefix = installedRuntime(home);
  if (prefix === undefined) return undefined;
  const platform = platformOfRuntime(runtimePackageOf(prefix));
  if (platform === undefined) return undefined;
  return installedPlatform(prefix, platform) === undefined ? undefined : prefix;
}

/** The packages of its platform this machine leaves out, asked of the
 * runtime installed at a prefix by that runtime's own program
 * (`platform-fit.js`, which the install carries): the implementors of
 * another system than this one, and of another store than the one a
 * plane run from the release folder named stands on. The rule is the
 * runtime's, where the bind reads it too; the cli holds none. */
export function leftOutAt(prefix: string, release: string): string[] {
  const tool = join(runtimePackageOf(prefix), 'dist', 'platform-fit.js');
  if (!existsSync(tool))
    throw new Error(`${prefix} holds no platform fit tool (${tool}); ${NO_RUNTIME_WORDS}`);
  let said: string;
  try {
    said = execFileSync(process.execPath, [tool, release], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      encoding: 'utf8',
    });
  } catch (error) {
    const written =
      error !== null && typeof error === 'object' && 'stderr' in error
        ? (error as { stderr?: unknown }).stderr
        : undefined;
    const stderr = typeof written === 'string' ? written.trim() : '';
    throw new Error(
      `the runtime at ${prefix} could not say which packages fit this machine${stderr === '' ? '' : `: ${stderr.split('\n').slice(-2).join('; ')}`}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(said);
  } catch {
    parsed = undefined;
  }
  const named: unknown =
    parsed !== null && typeof parsed === 'object' ? (parsed as { leftOut?: unknown }).leftOut : 0;
  if (!Array.isArray(named))
    throw new Error(
      `the runtime at ${prefix} did not say which packages fit this machine: ${said.trim().slice(0, 200)}`,
    );
  const leftOut = named.filter((id): id is string => typeof id === 'string');
  if (leftOut.length !== named.length)
    throw new Error(
      `the runtime at ${prefix} did not say which packages fit this machine: ${said.trim().slice(0, 200)}`,
    );
  return leftOut;
}

/** The platform of the runtime installed at a prefix, pulled from the
 * registry unless its folder is laid for this machine already: what
 * installing a release adds to the npm install, on a laptop and on a
 * server alike. The release folder is the one a plane of this machine
 * runs from, which says the store the plane stands on. */
export async function installPlatformAt(
  prefix: string,
  registry: RegistryClient,
  say: (line: string) => void,
  release: string,
): Promise<void> {
  const platform = platformOfRuntime(runtimePackageOf(prefix));
  if (platform === undefined) {
    throw new Error(
      `the runtime at ${prefix} carries no platform release; install ${RUNTIME_PACKAGE} there again`,
    );
  }
  const leftOut = leftOutAt(prefix, release);
  if (platformLaidFor(prefix, platform, leftOut) === undefined) {
    await installPlatform(prefix, platform, registry, say, leftOut);
  }
}

/** Where a laptop's release view is laid. */
function viewOf(home: string): string {
  return join(home, '.cernanto', 'release');
}

/** Installs the release of this cli's version: the runtime with npm
 * when the machine lacks it, then the packages of the platform release
 * that runtime carries which fit this machine, pulled from the
 * registry, when their folder is not laid. Answers the prefix. */
export async function installRelease(
  say: (line: string) => void,
  registry: RegistryClient,
  home: string = homedir(),
): Promise<string> {
  const prefix = installedRuntime(home) ?? (await installRuntime(say, home));
  await installPlatformAt(prefix, registry, say, viewOf(home));
  return prefix;
}

/** Installs the runtime of this cli's version with npm into its
 * prefix: the runtime package pinned exactly, with the runtime library
 * beneath it. One line names the package and the folder; a failed
 * install names the command to run by hand. */
export async function installRuntime(
  say: (line: string) => void,
  home: string = homedir(),
): Promise<string> {
  const { version } = ownPackage();
  const prefix = runtimePrefix(version, home);
  mkdirSync(prefix, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(prefix, 'package.json'),
    `${JSON.stringify(
      { name: 'cernanto-runtime', private: true, dependencies: { [RUNTIME_PACKAGE]: version } },
      null,
      2,
    )}\n`,
  );
  say(`installing the local runtime ${RUNTIME_PACKAGE} ${version} into ${prefix}`);
  const byHand = `run by hand: cd ${prefix} && npm install`;
  const npm = npmCommand(['install', '--no-audit', '--no-fund', '--loglevel', 'error']);
  try {
    await execute(npm.file, npm.args, {
      cwd: prefix,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const stderr =
      error !== null && typeof error === 'object' && 'stderr' in error
        ? (error as { stderr?: unknown }).stderr
        : undefined;
    const said = typeof stderr === 'string' ? stderr.trim() : '';
    const words = said === '' ? '' : `: ${said.split('\n').slice(-2).join('; ')}`;
    throw new Error(`the local runtime did not install${words}; ${byHand}`);
  }
  const installed = installedRuntime(home);
  if (installed === undefined)
    throw new Error(`the local runtime did not install into ${prefix}; ${byHand}`);
  return installed;
}

/** The view of an installed release, laid or relinked by the process
 * package's own tool (`release-view.js`, which the install carries): the
 * runtime's parts resolved from the runtime package's own place, the
 * platform's packages, its workspace marker and its record from the
 * platform folder beside the runtime, the cli and the format kit when
 * the prefix holds them. One layout, the server's and the laptop's. */
export function layOutRelease(prefix: string, home: string = homedir()): string {
  return layReleaseView(prefix, viewOf(home));
}

/** The release installed at a prefix laid as a view at a folder of the
 * caller's choosing: a laptop's one view, a server's release folder. */
export function layReleaseView(prefix: string, view: string): string {
  const tool = join(
    prefix,
    'node_modules',
    ...RUNTIME_PACKAGE.split('/'),
    'dist',
    'release-view.js',
  );
  if (!existsSync(tool))
    throw new Error(`${prefix} holds no release view tool (${tool}); ${NO_RUNTIME_WORDS}`);
  execFileSync(process.execPath, [tool, prefix, view, platformFolderOf(prefix)], {
    stdio: 'pipe',
    windowsHide: true,
  });
  return view;
}

/** The version a laid-out view runs, from its release.json; nothing
 * when the path holds no view. */
export function viewVersion(view: string): string | undefined {
  try {
    const facts = JSON.parse(readFileSync(join(view, 'release.json'), 'utf8')) as {
      version?: string;
    };
    return facts.version;
  } catch {
    return undefined;
  }
}
