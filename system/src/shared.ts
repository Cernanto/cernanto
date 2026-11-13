// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// What every system does the same way, written once: a program run by
// its name (cross-spawn finds a `.cmd` shim on Windows and quotes for
// its shell, so a caller hands a file and its arguments on every
// system), the operator's places as Node names them, npm under the
// running node, an archive unpacked, a rename or a removal tried again,
// a file copied when it moved.

import type {
  ChildProcess,
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from 'node:child_process';
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

import crossSpawn from 'cross-spawn';

import type { Command, Operator } from './system.js';

/** The options every removal of a tree takes: a file a process just
 * left, or one a scanner reads, is held for a moment on Windows and
 * the removal is tried again; elsewhere the first try settles it. */
export const REMOVAL_RETRIES = { maxRetries: 10, retryDelay: 100 } as const;

/** A rename tried again for a moment while the target is held: on
 * Windows a reader, or the system's scanner, may hold the old file for
 * a few milliseconds and the rename answers EPERM, EBUSY or EACCES
 * meanwhile. The retry is the same on every system (elsewhere those
 * answers are final, and a failure can afford a second's wait). A
 * folder's move names a longer wait: one file held anywhere under it
 * holds it. */
export function renameHeld(from: string, to: string, waitMs = 1000): void {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

/** A path's real one when it exists, the path itself otherwise. */
export function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A file's copy at a path, written when the path holds other bytes
 * or nothing: the file link of a system that links folders alone. */
export function copyWhenMoved(target: string, link: string): void {
  const wanted = readFileSync(target);
  try {
    if (readFileSync(link).equals(wanted)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  writeFileSync(link, wanted);
}

/** The operator's places and names: the environment's word first, the
 * system's own after it (Node reads the home and the temp folder the
 * way each system names them, and the account from the system). */
export function operatorOf(env: NodeJS.ProcessEnv, defaultPath: string): Operator {
  let account: string | undefined;
  try {
    account = userInfo().username;
  } catch {
    account = undefined;
  }
  return {
    home: env['HOME'] ?? env['USERPROFILE'] ?? homedir(),
    user: env['USER'] ?? env['LOGNAME'] ?? env['USERNAME'] ?? account ?? 'cernanto',
    tmpdir: env['TMPDIR'] ?? env['TEMP'] ?? env['TMP'] ?? tmpdir(),
    path: env['PATH'] ?? defaultPath,
  };
}

/** The names the operator's places and names are read under. */
const OPERATOR_NAMES: readonly string[] = [
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'USERNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PATH',
];

/** The first of the names the environment sets to something. */
function firstSet(env: NodeJS.ProcessEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/** The machine's basics a child of the plane starts with, made by one
 * rule from the environment of the process that starts it: every name
 * of the system's list as set; the home, the user, the temp folder and
 * the search path the environment names, and the system's own answer
 * where it names none; a proxy from either spelling, under the
 * upper-case name a vendor's tool reads; and the certificate file under
 * both its names when either is set. An empty word is no word. A child
 * started with these holds the machine's basics whatever the starting
 * process's own environment left unsaid. */
export function childEnvironmentOf(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
  defaultPath: string,
): Record<string, string> {
  // Every name is asked of the environment itself, which on Windows
  // answers a name whatever its case.
  const basics: Record<string, string> = {};
  for (const name of names) {
    const value = firstSet(env, [name]);
    if (value !== undefined) basics[name] = value;
  }
  const said: NodeJS.ProcessEnv = {};
  for (const name of OPERATOR_NAMES) {
    const value = firstSet(env, [name]);
    if (value !== undefined) said[name] = value;
  }
  const operator = operatorOf(said, defaultPath);
  basics['HOME'] = operator.home;
  basics['USER'] = operator.user;
  basics['LOGNAME'] = operator.user;
  basics['TMPDIR'] = operator.tmpdir;
  basics['PATH'] = operator.path;
  for (const [upper, lower] of [
    ['HTTP_PROXY', 'http_proxy'],
    ['HTTPS_PROXY', 'https_proxy'],
    ['NO_PROXY', 'no_proxy'],
  ] as const) {
    const proxy = firstSet(env, [upper, lower]);
    if (proxy !== undefined) basics[upper] = proxy;
  }
  const certificates = firstSet(env, ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']);
  if (certificates !== undefined) {
    basics['NODE_EXTRA_CA_CERTS'] = certificates;
    basics['SSL_CERT_FILE'] = certificates;
  }
  return basics;
}

/** The variables that name a home folder to a child: both names, since
 * a program written for either system reads its own and the other is
 * harmless. */
export function homeEnvironment(home: string): Record<string, string> {
  return { HOME: home, USERPROFILE: home };
}

/** npm's own entry script beside the node that runs this process (the
 * nodejs.org layout on every system, a version manager's, Homebrew's),
 * or nothing when the node ships without npm. */
export function npmEntryBesideNode(node: string): string | undefined {
  const folder = dirname(node);
  const above = dirname(folder);
  return [
    join(folder, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(above, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(above, 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => existsSync(candidate));
}

/** npm under the running node, so that the install runs on the node the
 * plane runs on; the command on the PATH when the node ships without
 * npm, run by its name like any tool. */
export function npmCommand(node: string, args: readonly string[]): Command {
  const entry = npmEntryBesideNode(node);
  return entry === undefined
    ? { file: 'npm', args: [...args] }
    : { file: node, args: [entry, ...args] };
}

/** What a run of a program answers once it ended. */
export interface Executed {
  stdout: string;
  stderr: string;
}

/** The failure of a run: the exit code or the signal, and the streams. */
export class ExecutionFailure extends Error {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  constructor(
    file: string,
    outcome: { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string },
  ) {
    super(
      `${file} ${outcome.signal === null ? `exited ${String(outcome.code)}` : `ended by ${outcome.signal}`}${outcome.stderr.trim() === '' ? '' : `: ${outcome.stderr.trim().slice(0, 2000)}`}`,
    );
    this.name = 'ExecutionFailure';
    this.code = outcome.code;
    this.signal = outcome.signal;
    this.stdout = outcome.stdout;
    this.stderr = outcome.stderr;
  }
}

export interface ExecuteOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** How long the run may take before it is killed; none for no limit. */
  timeoutMs?: number | undefined;
  /** How much of each stream is kept. */
  maxBuffer?: number | undefined;
}

/** A program run by its name or path to its end, with its two streams
 * as text; a non-zero exit, a signal or a failure to start is an error
 * carrying the streams. The program runs without a console window. */
export function execute(
  file: string,
  args: readonly string[],
  options: ExecuteOptions = {},
): Promise<Executed> {
  return new Promise((done, failed: (reason: Error) => void) => {
    const limit = options.maxBuffer ?? 32 * 1024 * 1024;
    const child = crossSpawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, options.timeoutMs);
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length < limit) stdout += chunk;
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < limit) stderr += chunk;
    });
    child.once('error', (error) => {
      if (timer !== undefined) clearTimeout(timer);
      failed(error);
    });
    child.once('close', (code, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      if (timedOut) {
        failed(
          new ExecutionFailure(file, {
            code,
            signal,
            stdout,
            stderr: `${stderr}\n${file} did not end within ${String(options.timeoutMs)}ms`,
          }),
        );
        return;
      }
      if (code === 0) done({ stdout, stderr });
      else failed(new ExecutionFailure(file, { code, signal, stdout, stderr }));
    });
  });
}

export interface ProgramOptions {
  env: NodeJS.ProcessEnv;
  cwd?: string | undefined;
  /** Whether the program leads a process group of its own, so a stop
   * reaches what it starts too; a system without groups ignores it. */
  detached?: boolean | undefined;
}

/** A program started by its name or path and left running, its three
 * streams piped to the caller, found and quoted the way `execute`
 * finds one (a `.cmd` shim on Windows through its shell), without a
 * console window. The caller owns the process from here: its streams,
 * its end and its group. */
export function spawnProgram(
  file: string,
  args: readonly string[],
  options: ProgramOptions,
): ChildProcess {
  return crossSpawn(file, [...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: options.detached === true,
    windowsHide: true,
  });
}

/** A program run by its name or path and waited for, the way the
 * caller's own spawnSync would, through cross-spawn. */
export function executeSync(
  file: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string> {
  // cross-spawn answers `error: null` where spawnSync leaves the field
  // out; a caller reads the field as spawnSync's.
  const result: Omit<SpawnSyncReturns<string>, 'error'> & { error?: Error | null } =
    crossSpawn.sync(file, [...args], { ...options, windowsHide: true });
  const { error, ...rest } = result;
  return error == null ? rest : { ...rest, error };
}

/** A command run to its end, its standard output as text (the two
 * implementations' own tool reads). */
export async function run(
  file: string,
  args: readonly string[],
  timeoutMs = 30000,
): Promise<string> {
  return (await execute(file, args, { timeoutMs })).stdout;
}

/** The words of a command line split by blanks, as posix's process
 * table prints them. */
export function blankSeparatedWords(command: string): string[] {
  return command.split(/\s+/).filter((word) => word !== '');
}
