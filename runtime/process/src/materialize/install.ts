// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The install of a package's npm closure at materialize: the exact tree
// its lock certified, landed by `npm ci` as npm's own configuration says
// (lifecycle scripts included, as the compiler installed it, so what ran
// the tests is what runs here; an operator turns them off with npm's
// ignore-scripts setting), the child seeing the machine basics and npm's
// own configuration alone. Where the machine keeps a closure store, a
// lock's closure is installed there once and linked into every directory
// that carries the lock, so a plane's bring-up installs each distinct
// closure once instead of once per generation: of the processes that
// start together and carry one lock, the first to ask installs it and
// the others wait for its tree. An install whose home is another user's
// (a server's root runs with the agents' home) keeps npm's cache in the
// store, unless npm's configuration names one, so it writes nothing
// into that home; every other install keeps the home's own cache.

import { randomBytes, createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { execute, npmCommand, system } from '@cernanto/system';

const INSTALL_ARGS = ['--no-audit', '--no-fund', '--loglevel=error'];
/** The machine basics a child needs on this system, and the names
 * every system's npm reads beside them. */
const ENV_BASICS = [
  ...system.childEnvironmentNames,
  'TMP',
  'TEMP',
  'LC_ALL',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];
const STDERR_CAP = 2000;
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
/** npm's cache inside a closure store. */
export const NPM_CACHE = '.npm';

/** The environment npm runs with: the process basics and npm's own
 * configuration alone. */
export function installChildEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const child: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (typeof value !== 'string') continue;
    if (
      ENV_BASICS.includes(key) ||
      key.startsWith('npm_config_') ||
      key.startsWith('NPM_CONFIG_')
    ) {
      child[key] = value;
    }
  }
  return child;
}

interface LockRoot {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function lockRootOf(lock: Buffer): LockRoot {
  const parsed: unknown = JSON.parse(lock.toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('the package lock is not an object');
  }
  const packages = (parsed as { packages?: Record<string, unknown> }).packages;
  const root = packages?.[''];
  if (typeof root !== 'object' || root === null) return {};
  return root;
}

export interface InstallInput {
  /** The directory the closure lands in (its `node_modules`). */
  directory: string;
  /** The package name the manifest carries (`cernanto-agent-<id>`). */
  packageName: string;
  /** The manifest's npm entries: the exact versions the compile chose. */
  npm: Readonly<Record<string, { version: string }>>;
  /** npm's own lock when the package carries one. */
  lock?: Buffer | undefined;
  /** The machine's closure store, when the directory may share its
   * closure: `<store>/<key>/node_modules` holds the closure of every
   * lock with that key, installed once and linked into each directory
   * that carries the lock. Absent, the closure is installed in place. */
  closures?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  log?: ((line: string) => void) | undefined;
}

/** The key of a lock's closure: the lock's content with the root
 * entry's name left out, so packages that pin the same tree under
 * their own names share one closure. */
export function closureKeyOf(lock: Buffer): string {
  const parsed: unknown = JSON.parse(lock.toString('utf8'));
  const copy: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null ? { ...(parsed as Record<string, unknown>) } : {};
  delete copy['name'];
  const packages = copy['packages'];
  if (typeof packages === 'object' && packages !== null) {
    const rootless = { ...(packages as Record<string, unknown>) };
    const root = rootless[''];
    if (typeof root === 'object' && root !== null) {
      const named = { ...(root as Record<string, unknown>) };
      delete named['name'];
      rootless[''] = named;
    }
    copy['packages'] = rootless;
  }
  return createHash('sha256').update(JSON.stringify(copy)).digest('hex').slice(0, 32);
}

/**
 * Writes the directory's `package.json` from the lock's root (so
 * `npm ci` finds the two in agreement) or from the manifest's exact
 * versions, and installs. A package with no npm grant installs
 * nothing: its runtime and zod are linked from the release.
 */
export async function installClosure(
  input: InstallInput,
): Promise<'installed' | 'linked' | 'nothing'> {
  const root = input.lock === undefined ? {} : lockRootOf(input.lock);
  const dependencies: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.npm).map(([name, entry]) => [name, entry.version])),
    ...(root.dependencies ?? {}),
  };
  // The directory is imported by name when a consumer links it
  // (`node_modules/cernanto-agent-<id>`), so its manifest names the
  // compiled entry.
  const manifest: Record<string, unknown> = {
    name: input.packageName,
    version: '0.0.0',
    private: true,
    type: 'module',
    main: 'dist/index.js',
    types: 'types/index.d.ts',
    dependencies,
    ...(root.devDependencies === undefined ? {} : { devDependencies: root.devDependencies }),
    ...(root.optionalDependencies === undefined
      ? {}
      : { optionalDependencies: root.optionalDependencies }),
  };
  writeFileSync(join(input.directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (input.lock !== undefined) {
    writeFileSync(join(input.directory, 'package-lock.json'), input.lock);
  }
  const count =
    Object.keys(dependencies).length +
    Object.keys(root.devDependencies ?? {}).length +
    Object.keys(root.optionalDependencies ?? {}).length;
  if (count === 0) return 'nothing';
  // A package that grants npm packages carries its lock, and the
  // install is from the lock alone: an `npm install` here would
  // resolve at boot a dependency tree nobody certified, so two boots
  // of one package could run different bytes.
  if (input.lock === undefined) {
    throw new Error(
      `${input.directory}: ${String(count)} npm dependencies and no lock; a package that grants npm packages carries its lock, and nothing installs without one`,
    );
  }
  if (input.closures !== undefined) {
    await linkClosure(input, input.closures, input.lock, manifest, count);
    return 'linked';
  }
  input.log?.(`npm ci (${String(count)} dependencies)`);
  await npmCi(input.directory, input.env);
  return 'installed';
}

/** The cache a store's install keeps for itself: the store's own when
 * the home npm would write its cache into is not this process's, none
 * otherwise. */
export function storeCacheFor(parent: NodeJS.ProcessEnv, store: string): string | undefined {
  const home = parent['HOME'];
  if (home === undefined || home === '' || system.ownsFolder(home)) return undefined;
  return join(store, NPM_CACHE);
}

/** The environment npm runs with, its cache the given folder where
 * npm's own configuration names none. */
export function installChildEnvWithCache(
  parent: NodeJS.ProcessEnv,
  cache: string,
): Record<string, string> {
  const child = installChildEnv(parent);
  const named = Object.keys(child).some((key) => key.toLowerCase() === 'npm_config_cache');
  return named ? child : { ...child, npm_config_cache: cache };
}

/** Runs `npm ci` in a directory that holds its package.json and lock,
 * npm's cache the given folder where one is given. */
async function npmCi(
  directory: string,
  env: NodeJS.ProcessEnv | undefined,
  cache?: string,
): Promise<void> {
  const args = ['ci', ...INSTALL_ARGS];
  const npm = npmCommand(args);
  const parent = env ?? process.env;
  try {
    await execute(npm.file, npm.args, {
      cwd: directory,
      env: cache === undefined ? installChildEnv(parent) : installChildEnvWithCache(parent, cache),
      timeoutMs: INSTALL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `npm ci failed in ${directory}: ${(stderr === '' ? message : stderr).slice(0, STDERR_CAP)}`,
    );
  }
}

/** The installs under way in this process, by key: the modules of one
 * composition are placed side by side and share their closures. */
const installing = new Map<string, Promise<void>>();
const STALE_INSTALL_MS = 60 * 60 * 1000;

/** How often an install touches its hold on a closure, which tells the
 * askers that wait for its tree that it still runs. */
const HOLD_BEAT_MS = 2_000;
/** How long a hold nobody touched is waited out before a waiting asker
 * takes the closure over: the process that installed it is gone. */
const HOLD_SILENCE_MS = 15_000;
/** How often a waiting asker looks for the tree it waits for. */
const HOLD_LOOK_MS = 250;

/** The hold on a closure's install: a folder beside the store's entry,
 * made in one step, so of the processes that ask for one closure at
 * the same moment one makes it and installs. */
export function closureHoldOf(store: string, key: string): string {
  return join(store, `${key}.hold`);
}

/** Whether a folder was left untouched for longer than a hold's
 * silence; undefined when it is not there. */
function silentFor(folder: string): boolean | undefined {
  try {
    return Date.now() - statSync(folder).mtimeMs > HOLD_SILENCE_MS;
  } catch {
    return undefined;
  }
}

/** Takes the hold on a closure, waiting while another process has it,
 * and answers whether this asker holds it: false when the closure came
 * to stand in the store while it waited, installed by the other. A
 * hold left by a process that is gone is taken over by one waiting
 * asker, chosen by a folder of its own made in one step, so the askers
 * that find it silent at the same moment do not all install. */
async function holdClosure(
  hold: string,
  home: string,
  said: (line: string) => void,
): Promise<boolean> {
  const over = `${hold}.over`;
  let waiting = false;
  for (;;) {
    if (existsSync(join(home, 'node_modules'))) return false;
    try {
      mkdirSync(hold);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (silentFor(hold) === true) {
      try {
        mkdirSync(over);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Another asker takes the hold over; one that died doing so
        // left its folder, which is nobody's after the same silence.
        if (silentFor(over) === true) rmSync(over, { recursive: true, force: true });
        await pause(HOLD_LOOK_MS);
        continue;
      }
      try {
        // Held alone from here: the hold is this asker's when it is
        // still silent, by the touch that says an install runs.
        if (silentFor(hold) === true) {
          const now = new Date();
          utimesSync(hold, now, now);
          return true;
        }
      } finally {
        rmSync(over, { recursive: true, force: true });
      }
      continue;
    }
    if (!waiting) {
      said('another process installs this closure; waiting for its tree');
      waiting = true;
    }
    await pause(HOLD_LOOK_MS);
  }
}

/** Installs the lock's closure into the store once and links every
 * entry of it into the directory's node_modules. The first to ask
 * installs under a name of its own beside the store's entry and moves
 * the finished tree into place in one rename; a second asker, in this
 * process or another, waits for that tree and links it. */
async function linkClosure(
  input: InstallInput,
  store: string,
  lock: Buffer,
  manifest: Record<string, unknown>,
  count: number,
): Promise<void> {
  const key = closureKeyOf(lock);
  const home = join(store, key);
  if (!existsSync(join(home, 'node_modules'))) {
    let pending = installing.get(key);
    if (pending === undefined) {
      pending = installIntoStore(input, store, key, home, lock, manifest, count).finally(() => {
        installing.delete(key);
      });
      installing.set(key, pending);
    }
    await pending;
  }
  const modules = join(input.directory, 'node_modules');
  mkdirSync(modules, { recursive: true });
  const kept = join(home, 'node_modules');
  let linked = 0;
  const link = (at: string, target: string): void => {
    if (!statSync(target).isDirectory()) return;
    try {
      if (!lstatSync(at).isSymbolicLink()) return;
      rmSync(at);
    } catch {
      // Nothing there yet.
    }
    system.linkFolder(target, at);
    linked += 1;
  };
  for (const entry of readdirSync(kept)) {
    if (entry === '.package-lock.json') continue;
    if (entry.startsWith('@')) {
      mkdirSync(join(modules, entry), { recursive: true });
      for (const inner of readdirSync(join(kept, entry)))
        link(join(modules, entry, inner), join(kept, entry, inner));
      continue;
    }
    link(join(modules, entry), join(kept, entry));
  }
  input.log?.(`linked ${String(linked)} entries of the closure ${key.slice(0, 12)} from the store`);
}

async function installIntoStore(
  input: InstallInput,
  store: string,
  key: string,
  home: string,
  lock: Buffer,
  manifest: Record<string, unknown>,
  count: number,
): Promise<void> {
  mkdirSync(store, { recursive: true });
  // An install that died mid-way leaves its folder; one older than an
  // hour is nobody's any more.
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith(`${key}.installing-`)) continue;
    try {
      if (Date.now() - statSync(join(store, entry)).mtimeMs > STALE_INSTALL_MS)
        rmSync(join(store, entry), { recursive: true, force: true });
    } catch {
      // Gone already.
    }
  }
  // One install of a closure at a time on the machine: the processes of
  // a bring-up start together and carry the same locks, and each would
  // fetch the whole tree for itself.
  const hold = closureHoldOf(store, key);
  const said = (line: string): void => input.log?.(`${line}, ${key.slice(0, 12)}`);
  if (!(await holdClosure(hold, home, said))) return;
  const beat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(hold, now, now);
    } catch {
      // The hold was taken over: the rename below settles whose tree
      // stands.
    }
  }, HOLD_BEAT_MS);
  const temp = join(
    store,
    `${key}.installing-${String(process.pid)}-${randomBytes(4).toString('hex')}`,
  );
  try {
    mkdirSync(temp, { recursive: true });
    writeFileSync(join(temp, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(temp, 'package-lock.json'), lock);
    input.log?.(
      `npm ci (${String(count)} dependencies) into the closure store, ${key.slice(0, 12)}`,
    );
    await npmCi(temp, input.env, storeCacheFor(input.env ?? process.env, store));
    renameSync(temp, home);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    // Another install of the same closure finished first: its tree is
    // the one to link.
    if (existsSync(join(home, 'node_modules'))) return;
    throw error;
  } finally {
    clearInterval(beat);
    rmSync(hold, { recursive: true, force: true });
  }
}
