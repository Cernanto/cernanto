// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The user the agents' processes run as. A host job running as root (a
// server's unit) hands every agent process to the owner of the plane's
// root folder, the plane's user, and gives that user the folders and
// the files the processes read and write; a host job running as a user (a
// laptop) runs them as itself, and nothing is handed over.

import { lstatSync, mkdirSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The agents' user by its ids. */
export interface AgentUser {
  uid: number;
  gid: number;
}

/** The agents' user of a plane whose root folder is `root`: the
 * folder's owner when this process is root and the owner is not;
 * nothing otherwise. */
export function agentUserOf(root: string): AgentUser | undefined {
  if (process.getuid?.() !== 0) return undefined;
  try {
    const { uid, gid } = statSync(root);
    return uid === 0 ? undefined : { uid, gid };
  } catch {
    return undefined;
  }
}

/** How a folder is looked at, never through a link; a proof hands its
 * own. */
export type FolderLook = (
  path: string,
) => Pick<Stats, 'isSymbolicLink' | 'isDirectory' | 'uid' | 'mode'>;

/** Why a folder is not root's alone, or nothing when it is: a folder
 * (never a link) owned by root that nobody else may write. */
function notRootsAlone(path: string, look: FolderLook): string | undefined {
  let stat;
  try {
    stat = look(path);
  } catch (error) {
    return `${path} cannot be read (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`;
  }
  if (stat.isSymbolicLink()) return `${path} is a link`;
  if (!stat.isDirectory()) return `${path} is not a folder`;
  if (stat.uid !== 0) return `${path} belongs to the user ${String(stat.uid)}`;
  if ((stat.mode & 0o022) !== 0)
    return `${path} may be written by others (mode ${(stat.mode & 0o777).toString(8)})`;
  return undefined;
}

/** Makes sure a folder a privileged copy runs and writes from is root's
 * alone, the folder and every folder above it: a folder another user
 * can write, or one under such a folder, could be replaced by that
 * user, and what root runs or writes there would be that user's
 * choice. The folder is made, root's and closed to writes by others,
 * when the folder above it passes. Refused in words naming the folder
 * that fails and the remedy. */
export function rootsAloneFolder(path: string, look: FolderLook = lstatSync): void {
  const absolute = resolve(path);
  const chain: string[] = [];
  for (let at = absolute; ; at = dirname(at)) {
    chain.unshift(at);
    if (dirname(at) === at) break;
  }
  for (const folder of chain) {
    if (folder === absolute) {
      try {
        look(folder);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        mkdirSync(folder, { mode: 0o755 });
      }
    }
    const why = notRootsAlone(folder, look);
    if (why !== undefined)
      throw new Error(
        `the host job's home ${absolute} is not root's alone: ${why}; the release's host job runs with root's privileges only from folders root alone may write (chown root:root and chmod go-w each of them)`,
      );
  }
}
