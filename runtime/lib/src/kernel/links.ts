// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// Links, made the same way on every system through Node's own call. A
// link to a folder is a symbolic link where the system makes one for
// every account, and a junction where it does not: Node's `junction`
// type is exactly that. A link to a file is a link, and a copy kept
// current where the system refuses the link. Which one a system made is
// never asked by its name: the call is tried, and its answer decides.

import {
  lstatSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

/** Whether the link at a path leads to the target: by its own text,
 * or, when a system spells a link's target its own way, by the two
 * being one entry of the file system. */
function leadsTo(link: string, target: string): boolean {
  if (readlinkSync(link) === target) return true;
  try {
    const there = statSync(link, { bigint: true });
    const wanted = statSync(target, { bigint: true });
    return there.dev === wanted.dev && there.ino === wanted.ino;
  } catch {
    // One of the two is not there: the link dangles, or its target is
    // yet to be made.
    return false;
  }
}

/** A link at a path to a folder. Kept when it already leads there,
 * replaced when it leads elsewhere or nowhere; an entry at the path
 * that is not a link is somebody's and refused in words. */
export function linkFolder(target: string, link: string): void {
  try {
    if (!lstatSync(link).isSymbolicLink())
      throw new Error(`${link} is not a link; remove it so the link can be made`);
    if (leadsTo(link, target)) return;
    unlinkSync(link);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  symlinkSync(target, link, 'junction');
}

/** A file's copy at a path, written when the path holds other bytes
 * or nothing. */
export function copyWhenMoved(target: string, link: string): void {
  const wanted = readFileSync(target);
  try {
    if (readFileSync(link).equals(wanted)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  writeFileSync(link, wanted);
}

/** Whether a failure says the system does not let this account make
 * the link. */
function refused(error: unknown): boolean {
  return ['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(
    (error as NodeJS.ErrnoException).code ?? '',
  );
}

/** A link at a path to a file: a symbolic link, kept when it already
 * leads there and replaced when it leads elsewhere; where the system
 * refuses the link, a copy of the file, written again when the file
 * it copies moved. */
export function linkFile(target: string, link: string): void {
  try {
    if (lstatSync(link).isSymbolicLink()) {
      if (leadsTo(link, target)) return;
      unlinkSync(link);
    } else {
      // A copy from a system that refuses the link: kept current.
      copyWhenMoved(target, link);
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    symlinkSync(target, link, 'file');
  } catch (error) {
    if (!refused(error)) throw error;
    copyWhenMoved(target, link);
  }
}
