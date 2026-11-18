// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A program run by its name, the same call on every system: cross-spawn
// finds a `.cmd` shim on Windows and quotes for its shell, so a caller
// hands a file and its arguments wherever it runs. And npm under a
// node, found beside that node.

import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import crossSpawn from 'cross-spawn';

/** A command to run: a file and its arguments. */
export interface Command {
  file: string;
  args: string[];
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
 * finds one, without a console window. The caller owns the process
 * from here: its streams, its end and its group. */
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

/** npm's own entry script beside a node (the nodejs.org layout on every
 * system, a version manager's, Homebrew's), or nothing when the node
 * ships without npm. */
export function npmEntryBesideNode(node: string): string | undefined {
  const folder = dirname(node);
  const above = dirname(folder);
  return [
    join(folder, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(above, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(above, 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => existsSync(candidate));
}

/** npm under a node, so that an install runs on the node the plane
 * runs on: this process's own when none is named. The command on the
 * PATH when the node ships without npm, run by its name like any tool. */
export function npmCommand(args: readonly string[], node: string = process.execPath): Command {
  const entry = npmEntryBesideNode(node);
  return entry === undefined
    ? { file: 'npm', args: [...args] }
    : { file: node, args: [entry, ...args] };
}
