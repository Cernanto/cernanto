// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The commands a call spawns are its own: every child process a
// handler starts carries the attempt's nonce in its environment and
// runs in a process group of its own, and the groups an attempt marked
// are stopped when the attempt ends, whether it returned, was cancelled
// or failed (a compile's type check, a coder's session, a job's tool).
// This is process supervision, outside the journal: the same rule the
// host job applies to a generation's whole tree with its launch nonce. A
// synchronous command is refused in a serving process, since it would
// block every call the process holds.

import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as realDelay } from 'node:timers/promises';

import { system } from '@cernanto/system';

import { currentExecution } from './execution.js';
import { CernantoError } from '../language/errors.js';
import { CHILD_GRACE_MS } from './facts.js';
import type { CallLifetime } from './lifetime.js';
import { carriesTag, living, signalTargets, stopUntilGone, unowned } from './processes.js';
import type { ProcessRow } from './processes.js';

const NONCE = 'CERNANTO_CALL_NONCE';
const commandOwners = new WeakSet<CallLifetime>();
/** The runtime's own commands (the process table read that stops an
 * attempt's groups) run outside any call and are always allowed. */
const machine = new AsyncLocalStorage<true>();
let installed = false;
let serving = false;

/** Runs the runtime's own command work: a process the runtime itself
 * keeps for the life of this process (a lane's server) starts under it,
 * kept by the runtime and ended by its keeper. */
export function asRuntimeCommand<T>(fn: () => T): T {
  return machine.run(true, fn);
}

/** The spawn options the keeper reads and sets. */
interface SpawnCall {
  file: string;
  detached?: boolean;
  envPairs?: string[];
}

/** A command as its keeper sees it: what says that it ended. */
export interface StartedCommand {
  once(event: 'exit', listener: () => void): unknown;
}

/** How a call's commands are kept and ended: the one object a
 * spawn and a cleanup see, chosen once for the system. */
interface CommandKeeper {
  /** The options a command is started with. */
  options(call: SpawnCall): SpawnCall;
  /** A command the owner started, by its pid, with the command itself. */
  started(owner: CallLifetime, pid: number, command: StartedCommand): void;
  /** Ends every command the owner started. */
  stop(owner: CallLifetime): Promise<void>;
}

/** Stops every command group this call spawned (the groups its
 * nonce marks), with the shared primitives (processes.ts): the table
 * read, the groups verified as this user's own, a term, the grace, a
 * kill, the termination verified. */
async function stopCommands(nonce: string): Promise<void> {
  const members = async (): Promise<ProcessRow[]> => {
    let all: ProcessRow[];
    try {
      all = living(await machine.run(true, () => system.processTable({ environment: true })));
    } catch {
      throw new CernantoError({
        kind: 'retryable',
        message:
          'cannot inspect owned command processes; this process must drain before replacement',
      });
    }
    const groups = new Set(
      all.filter((row) => carriesTag(row, NONCE, nonce)).map((row) => row.group),
    );
    const rows = all.filter((row) => groups.has(row.group));
    if (unowned(rows)) {
      throw new CernantoError({
        kind: 'retryable',
        message:
          'the command process group no longer proves its launch ownership; no signal was sent',
      });
    }
    return rows;
  };
  const gone = await stopUntilGone({
    members,
    signal: (name, rows, phase) => {
      if (phase !== 'poll')
        signalTargets(
          rows.map((row) => -row.group),
          name,
        );
    },
    graceMs: CHILD_GRACE_MS,
    pollMs: 50,
  });
  if (!gone) {
    throw new CernantoError({
      kind: 'retryable',
      message:
        'owned command descendants did not terminate; replacement must wait for process cleanup',
    });
  }
}

/** The keeper of a system with process groups: every command runs in a
 * group of its own, and the groups the owner's nonce marks are stopped
 * through the table, a term, the grace, a kill. */
const groupKeeper: CommandKeeper = {
  options: (call) => ({ ...call, detached: true }),
  started: () => undefined,
  stop: (owner) => stopCommands(owner.id),
};

/** Whether a pid still names a live process (EPERM is alive too). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The commands of each owner that still run, by pid, for the keeper
 * of a system with no group to signal and no environment to read: the
 * owner's own list is what its cleanup ends, tree by tree. */
const commandPids = new WeakMap<CallLifetime, Set<number>>();

/** Keeps a command's pid among its owner's for as long as the command
 * runs, and no longer: the system hands the pid of a process that ended
 * to the next one it starts, so a pid kept past its command's end would
 * name a stranger to the cleanup, which ends what it names. A call that
 * lives long and starts many commands (the host's own) holds the pids
 * of the ones running now and nothing else. */
export function keepWhileItRuns(pids: Set<number>, pid: number, command: StartedCommand): void {
  pids.add(pid);
  command.once('exit', () => {
    pids.delete(pid);
  });
}

/** Stops every command tree the pids name: the system's own tree kill
 * on each, then the pids checked gone within the grace. A pid is ended
 * while it is still among the kept ones at that moment, so a command
 * that ended meanwhile is left alone. A helper whose parent already
 * left can outlive this, an accepted stray. */
async function stopCommandTrees(pids: Set<number>): Promise<void> {
  const living = (): number[] => [...pids].filter(alive);
  if (living().length === 0) return;
  await machine.run(true, async () => {
    for (const pid of living()) {
      if (pids.has(pid)) await system.killTree(pid);
    }
  });
  const deadline = Date.now() + CHILD_GRACE_MS;
  while (Date.now() < deadline) {
    if (living().length === 0) return;
    await realDelay(50);
  }
  if (living().length > 0) {
    throw new CernantoError({
      kind: 'retryable',
      message:
        'owned command descendants did not terminate; replacement must wait for process cleanup',
    });
  }
}

/** The keeper of a system without process groups: a command stays
 * attached, so it dies with this process by the system's own job, and
 * its pid is kept for the cleanup. */
const treeKeeper: CommandKeeper = {
  options: (call) => call,
  started: (owner, pid, command) => {
    const set = commandPids.get(owner) ?? new Set<number>();
    commandPids.set(owner, set);
    keepWhileItRuns(set, pid, command);
  },
  stop: (owner) => stopCommandTrees(commandPids.get(owner) ?? new Set()),
};

const keeper: CommandKeeper = system.name === 'windows' ? treeKeeper : groupKeeper;

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
    if (machine.getStore() === true) return spawn.call(this, options);
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
    const pairs = (options.envPairs ?? []).filter((pair) => !pair.startsWith(`${NONCE}=`));
    pairs.push(`${NONCE}=${owner.id}`);
    const nativeNonce = process.env['CERNANTO_PROCESS_GROUP_NONCE'];
    if (
      nativeNonce !== undefined &&
      !pairs.some((pair) => pair.startsWith('CERNANTO_PROCESS_GROUP_NONCE='))
    )
      pairs.push(`CERNANTO_PROCESS_GROUP_NONCE=${nativeNonce}`);
    if (!commandOwners.has(owner)) {
      owner.own(() => keeper.stop(owner));
      commandOwners.add(owner);
    }
    // A command runs without a console window.
    const result = spawn.call(this, {
      ...keeper.options({ ...options, envPairs: pairs }),
      windowsHide: true,
    });
    const command = this as unknown as { pid?: number } & StartedCommand;
    if (typeof command.pid === 'number') keeper.started(owner, command.pid, command);
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
