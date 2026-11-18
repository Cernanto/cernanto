// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// What the cli does on the machine it runs on, written once for every
// system: a program run by its name (cross-spawn finds a `.cmd` shim on
// Windows and quotes for its shell, so a caller hands a file and its
// arguments wherever it runs), npm under the running node, a rename and
// a removal tried again while a file is held, and the folders a coder's
// tool is usually installed in. The runtime has the same few lines of
// its own: the cli installs the runtime and cannot import it.

import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import crossSpawn from 'cross-spawn';

/** A command to run: a file and its arguments. */
export interface Command {
  file: string;
  args: string[];
}

/** The options every removal of a tree takes: a file a process just
 * left, or one a scanner reads, is held for a moment on some systems
 * and the removal is tried again; elsewhere the first try settles it. */
export const REMOVAL_RETRIES = { maxRetries: 10, retryDelay: 100 } as const;

/** A rename tried again for a moment while the target is held: a
 * reader, or the system's scanner, may hold the old file for a few
 * milliseconds and the rename answers EPERM, EBUSY or EACCES meanwhile.
 * The retry is the same on every system (where those answers are final,
 * a failure can afford a second's wait). A folder's move names a longer
 * wait: one file held anywhere under it holds it. */
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

/** The variables that name a home folder to a child: both names, since
 * a program written for either system reads its own and the other is
 * harmless. */
export function homeEnvironment(home: string): Record<string, string> {
  return { HOME: home, USERPROFILE: home };
}

/** The folders a coder's tool is usually installed in, beside the
 * PATH: one list for every system. A caller keeps the ones that are
 * there. */
export function usualToolFolders(env: NodeJS.ProcessEnv): string[] {
  const roaming = env['APPDATA'];
  return [
    join(homedir(), '.local', 'bin'),
    ...(roaming === undefined || roaming === '' ? [] : [join(roaming, 'npm')]),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}

/** npm's own entry script beside the node that runs this process (the
 * nodejs.org layout on every system, a version manager's, Homebrew's),
 * or nothing when the node ships without npm. */
function npmEntryBesideNode(node: string): string | undefined {
  const folder = dirname(node);
  const above = dirname(folder);
  return [
    join(folder, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(above, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(above, 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => existsSync(candidate));
}

/** npm under the node that runs this process, so that an install runs
 * on that node; the command on the PATH when the node ships without
 * npm, run by its name like any tool. */
export function npmCommand(args: readonly string[]): Command {
  const entry = npmEntryBesideNode(process.execPath);
  return entry === undefined
    ? { file: 'npm', args: [...args] }
    : { file: process.execPath, args: [entry, ...args] };
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
  /** What the program reads on its standard input; nothing when none. */
  input?: string | undefined;
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
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
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
    if (options.input !== undefined) {
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(options.input);
    }
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
