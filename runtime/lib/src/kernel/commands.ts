// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The commands a call spawns are its own: every child process a
// handler starts carries the call's word in its environment and, where
// the system has process groups, leads one of its own. What an attempt
// owns is stopped when the attempt ends, whether it returned, was
// cancelled or failed (a compile's type check, a coder's session, a
// job's tool). What it owns is the process adapter's to say
// (process-adapter.ts), the same rule on every system: the commands
// that still run with what descends from them, the groups they lead,
// and whatever carries the call's word where the system shows a
// process's environment. This is process supervision, outside the
// journal. A synchronous command is refused in a serving process,
// since it would block every call the process holds.

import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

import { currentExecution } from './execution.js';
import { CernantoError } from '../language/errors.js';
import { CHILD_GRACE_MS } from './facts.js';
import type { CallLifetime } from './lifetime.js';
import { isRuntimeCommand } from './own-commands.js';
import {
  Ownership,
  OwnershipRefused,
  ProcessReadFailure,
  StopLeftRunning,
  StopUnverified,
  stopOwned,
} from './process-adapter.js';
import { reader } from './process-readers.js';

export { asRuntimeCommand } from './own-commands.js';

/** The word a call lays into the environment of every command it runs. */
const CALL_WORD = 'CERNANTO_CALL_NONCE';
/** The word of the copy's launch, handed on to every command the copy
 * runs: by it the host job has what a launch left ended. */
const LAUNCH_WORD = 'CERNANTO_PROCESS_GROUP_NONCE';
const commandOwners = new WeakSet<CallLifetime>();
let installed = false;
let serving = false;

/** The spawn options the keeper reads and sets. */
interface SpawnCall {
  file: string;
  detached?: boolean;
  envPairs?: string[];
}

/** A command as its keeper holds it: its pid, whether it ended, the
 * word of its end, and a signal through its own handle. */
export interface StartedCommand {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  once(event: 'exit', listener: () => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

/** The commands of each owner that still run, each by its handle. */
const commandsOf = new WeakMap<CallLifetime, Set<StartedCommand>>();

/** Keeps a command among its owner's for as long as it runs, and no
 * longer: the system hands the pid of a process that ended to the next
 * one it starts, so a command kept past its end would name a stranger
 * to the cleanup. A call that lives long and starts many commands (the
 * host's own) holds the ones running now and nothing else. */
export function keepWhileItRuns(commands: Set<StartedCommand>, command: StartedCommand): void {
  commands.add(command);
  command.once('exit', () => {
    commands.delete(command);
  });
}

/** The commands that have not ended, each one's pid still its own. */
function stillRunning(commands: Iterable<StartedCommand>): StartedCommand[] {
  return [...commands].filter(
    (command) =>
      command.pid !== undefined && command.exitCode === null && command.signalCode === null,
  );
}

/** Stops everything this call's commands started, by the adapter's
 * stop: what is owned is read, sent a term, given the grace, sent a
 * kill, and looked at until it is gone. A read that fails, a process
 * no read shows while the system says it runs, a group that holds
 * another user's process and a process that would not end each fail
 * the end of the call, in words. */
async function stopCommands(owner: CallLifetime): Promise<void> {
  const commands = commandsOf.get(owner) ?? new Set<StartedCommand>();
  // Where the read shows no environment, a command that ended left
  // nothing its call can find.
  if (!reader.facts.environments && stillRunning(commands).length === 0) return;
  const ownership = new Ownership({
    roots: () =>
      stillRunning(commands).flatMap((command) => (command.pid === undefined ? [] : [command.pid])),
    words: [`${CALL_WORD}=${owner.id}`],
    sameUser: true,
  });
  try {
    await stopOwned(ownership, {
      graceMs: CHILD_GRACE_MS,
      also: (name) => {
        for (const command of stillRunning(commands)) command.kill(name);
      },
    });
  } catch (error) {
    // A read that failed, and one that does not show a process the
    // system says is running: neither can be inspected.
    if (error instanceof ProcessReadFailure || error instanceof StopUnverified)
      throw new CernantoError({
        kind: 'retryable',
        message:
          'cannot inspect owned command processes; this process must drain before replacement',
      });
    if (error instanceof OwnershipRefused)
      throw new CernantoError({
        kind: 'retryable',
        message:
          'the command process group no longer proves its launch ownership; no signal was sent',
      });
    if (error instanceof StopLeftRunning)
      throw new CernantoError({
        kind: 'retryable',
        message:
          'owned command descendants did not terminate; replacement must wait for process cleanup',
      });
    throw error;
  }
}

/** Installs command ownership before the agent's code loads. In a
 * serving process every command belongs to a running call. */
export function installCommandOwnership(servingProcess = false): void {
  serving ||= servingProcess;
  if (installed) return;
  installed = true;
  const prototype = childProcess.ChildProcess.prototype as unknown as {
    spawn: (options: SpawnCall & { windowsHide?: boolean }) => number;
  };
  const spawn = prototype.spawn;
  prototype.spawn = function ownedSpawn(options): number {
    if (isRuntimeCommand()) return spawn.call(this, options);
    const execution = currentExecution();
    if (execution === undefined) {
      if (serving)
        throw new CernantoError({
          kind: 'terminal',
          message:
            'a command must belong to a running agent or job call; start it inside a handler',
        });
      return spawn.call(this, options);
    }
    if (execution.kind === 'service' || execution.kind === 'worker')
      throw new CernantoError({
        kind: 'terminal',
        message:
          'stateful agents and workers cannot run commands; call an ordinary agent or job that owns the complete operation',
      });
    const owner = execution.owner;
    if (owner === undefined)
      throw new CernantoError({
        kind: 'terminal',
        message: 'the command has no call owner; execute it through a served agent or job',
      });
    owner.assertActive();
    const pairs = (options.envPairs ?? []).filter((pair) => !pair.startsWith(`${CALL_WORD}=`));
    pairs.push(`${CALL_WORD}=${owner.id}`);
    const launch = process.env[LAUNCH_WORD];
    if (launch !== undefined && !pairs.some((pair) => pair.startsWith(`${LAUNCH_WORD}=`)))
      pairs.push(`${LAUNCH_WORD}=${launch}`);
    if (!commandOwners.has(owner)) {
      owner.own(() => stopCommands(owner));
      commandOwners.add(owner);
    }
    // A command leads a group of its own where the system has groups,
    // and runs without a console window.
    const result = spawn.call(this, {
      ...options,
      envPairs: pairs,
      ...(reader.facts.groups ? { detached: true } : {}),
      windowsHide: true,
    });
    const command = this as unknown as StartedCommand;
    if (typeof command.pid === 'number') {
      const commands = commandsOf.get(owner) ?? new Set<StartedCommand>();
      commandsOf.set(owner, commands);
      keepWhileItRuns(commands, command);
    }
    return result;
  };
  const target = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['execSync', 'execFileSync', 'spawnSync']) {
    const real = target[name];
    if (real === undefined) continue;
    target[name] = (...args: unknown[]): unknown => {
      if (serving || currentExecution() !== undefined)
        throw new CernantoError({
          kind: 'terminal',
          message: `the synchronous command ${name} blocks the serving process and its probes; use its asynchronous form: exec, execFile or spawn`,
        });
      return real(...args);
    };
  }
  syncBuiltinESMExports();
}
