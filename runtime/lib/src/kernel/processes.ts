// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { setTimeout as realDelay } from 'node:timers/promises';

import { system } from '@cernanto/system';
import type { ProcessRow } from '@cernanto/system';

// One set of process rules over the system's process table: the
// call's cleanup of the commands it spawned and the host job's stop
// of a runner's groups both find the groups a tag in the environment
// marks, refuse to act when a member is not theirs, signal whole groups
// and verify that they went before anything replaces them. The tag
// match and the signalling are here; the table is the system's; the
// policies (what a group must prove, how long the grace is, what is
// signalled first) stay each caller's. Importing this module has no
// side effect.

export type { ProcessRow } from '@cernanto/system';

/** Whether a process carries `NAME=value` in its environment: one row
 * of the table read with its environment. Only the answer leaves; the
 * environment itself stays out of every diagnostic. */
export async function holdsTag(pid: number, name: string, value: string): Promise<boolean> {
  const [row] = await system.processTable({ pid, environment: true });
  return row !== undefined && carriesTag(row, name, value);
}

/** Whether a row carries the tag: among its environment's words where
 * the system gave them, or among its command line's where the system
 * lays the environment into it. */
export function carriesTag(row: ProcessRow, name: string, value: string): boolean {
  const tag = `${name}=${value}`;
  return (
    (row.environment?.includes(tag) ?? false) || system.commandWords(row.command).includes(tag)
  );
}

/** The rows that are live processes: a zombie has no work left to stop. */
export function living(rows: ProcessRow[]): ProcessRow[] {
  return rows.filter((row) => !row.state.startsWith('Z'));
}

/** Whether a row is another user's: a group with one is left alone.
 * Where the system names no user, a row carries minus one, and so does
 * this process. */
export function unowned(rows: ProcessRow[]): boolean {
  const mine = process.getuid?.() ?? -1;
  return rows.some((row) => row.uid !== mine);
}

/** Sends a signal to whole process groups (negative numbers) or to
 * single processes; a target that is already gone is no error, and
 * neither is one whose number another user's process holds now: the
 * pid or the group was recycled between the listing and the signal,
 * so nothing of ours is there to signal, which the system says as
 * EPERM. */
export function signalTargets(targets: Iterable<number>, name: NodeJS.Signals): void {
  for (const target of new Set(targets)) {
    try {
      process.kill(target, name);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH' && code !== 'EPERM') throw error;
    }
  }
}

/** Stops what `members` still finds: a term, the grace, a kill, five
 * seconds more; answers whether everything went. `signal` is the
 * caller's policy: asked once at the start with SIGTERM (`first`), on
 * every poll of the grace (`poll`, where a policy widens its targets
 * once a leader is gone, or sends nothing) and once after the grace
 * with SIGKILL (`kill`). */
export async function stopUntilGone(options: {
  members: () => Promise<ProcessRow[]>;
  signal: (
    name: NodeJS.Signals,
    members: ProcessRow[],
    phase: 'first' | 'poll' | 'kill',
  ) => void | Promise<void>;
  graceMs: number;
  pollMs: number;
}): Promise<boolean> {
  const initial = await options.members();
  if (initial.length === 0) return true;
  await options.signal('SIGTERM', initial, 'first');
  const deadline = Date.now() + options.graceMs;
  while (Date.now() < deadline) {
    const members = await options.members();
    if (members.length === 0) return true;
    await options.signal('SIGTERM', members, 'poll');
    await realDelay(options.pollMs);
  }
  const left = await options.members();
  if (left.length === 0) return true;
  await options.signal('SIGKILL', left, 'kill');
  const killed = Date.now() + 5000;
  while (Date.now() < killed) {
    if ((await options.members()).length === 0) return true;
    await realDelay(50);
  }
  return false;
}
