// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The system under the cli and the runtime, chosen once: the only file
// in the tree that reads `process.platform`. Everything else asks
// `system`, or the shared roads beside it that every system walks the
// same way.

import { posix } from './posix.js';
import { childEnvironmentOf, npmCommand as npmCommandOf, operatorOf } from './shared.js';
import type { Command, Operator, System } from './system.js';
import { windows } from './windows.js';

export type { Command, Operator, ProcessRow, System } from './system.js';
export {
  ExecutionFailure,
  REMOVAL_RETRIES,
  execute,
  executeSync,
  homeEnvironment,
  renameHeld,
  spawnProgram,
} from './shared.js';

function chosen(): System {
  if (process.platform === 'win32') return windows();
  return posix(process.platform === 'darwin' ? 'macos' : 'linux');
}

/** The system this process runs on. */
export const system: System = chosen();

/** The operator's places and names, the environment's word first. */
export function operator(env: NodeJS.ProcessEnv = process.env): Operator {
  return operatorOf(env, system.defaultPath);
}

/** The machine's basics a child of the plane starts with, made from
 * this process's environment by the one rule every launch follows. */
export function childEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return childEnvironmentOf(env, system.childEnvironmentNames, system.defaultPath);
}

/** npm under the node that runs this process, the command on the PATH
 * when the node ships without one. */
export function npmCommand(args: readonly string[]): Command {
  return npmCommandOf(process.execPath, args);
}
