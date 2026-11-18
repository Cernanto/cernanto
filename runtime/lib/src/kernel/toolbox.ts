// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The toolbox of a coder's shell, made in one place: a folder that is
// the shell's whole `PATH`, holding the programs of a list and nothing
// else. It goes by what is there. Where the system's own folders hold
// the programs, the toolbox is a folder of links to them. Where they
// hold none, it is a root of its own: copies of the programs an
// install of Git carries, with the runtime files they stand on. The
// answer says which it is: the `PATH` value, the programs it holds,
// and its own shell where it carries one.

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/** What a toolbox answers. */
export interface Toolbox {
  /** The `PATH` value a vendor's shell is handed: the real path of the
   * folder the programs stand in. */
  path: string;
  /** The programs of the list it holds, in the list's order. */
  programs: string[];
  /** Its own shell, where the toolbox is a root of its own and holds
   * one: a system whose programs are linked has its shell already. */
  shell?: string;
}

export interface ToolboxOptions {
  /** The folders the system's own programs are looked for in, in order. */
  systemFolders?: readonly string[] | undefined;
  /** The root of the install the programs are copied from where the
   * system's folders hold none; found by `git` on the `PATH` when none
   * is given. */
  install?: string | undefined;
  /** The `PATH` the install is looked for on. */
  searchPath?: string | undefined;
}

const SYSTEM_FOLDERS = ['/usr/bin', '/bin'] as const;
/** Where an install of Git for Windows lies when the `PATH` names none. */
const USUAL_INSTALL = 'C:\\Program Files\\Git';
/** The one line of the root's `fstab`: no drive is mounted under it. */
const FSTAB = 'none / cygdrive binary,posix=0,noacl,user 0 0\n';

/** The toolbox for a list of programs in a folder, made when absent
 * and kept current: asked for at every turn of a coder, by several
 * turns at once, so making it is idempotent, and several calls that
 * make it at the same moment each answer it whole. */
export function makeToolbox(
  folder: string,
  programs: readonly string[],
  options: ToolboxOptions = {},
): Toolbox {
  const wanted = [...new Set(programs)];
  const folders = options.systemFolders ?? SYSTEM_FOLDERS;
  const found = new Map<string, string>();
  for (const name of wanted) {
    const holder = folders.find((one) => existsSync(join(one, name)));
    if (holder !== undefined) found.set(name, join(holder, name));
  }
  return found.size > 0
    ? linked(folder, wanted, found)
    : copied(folder, wanted, options.install ?? installRoot(options.searchPath));
}

/** A folder of links: one per program the system has, each named as
 * the program and pointing at the first of the system's folders that
 * holds it. A link already there with the right target is kept; one
 * that another call makes at the same moment is read as made; only a
 * link with another target is remade; a link named for a program the
 * list lacks is deleted. */
function linked(folder: string, wanted: readonly string[], found: Map<string, string>): Toolbox {
  mkdirSync(folder, { recursive: true });
  for (const entry of readdirSync(folder)) {
    if (found.has(entry)) continue;
    const path = join(folder, entry);
    try {
      if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
    } catch {
      // Another call removed it at the same moment.
    }
  }
  for (const [name, target] of found) {
    const link = join(folder, name);
    try {
      if (readlinkSync(link) === target) continue;
      unlinkSync(link);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      symlinkSync(target, link);
    } catch (error) {
      // Another call made the link at the same moment.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return {
    path: realpathSync(folder),
    programs: wanted.filter((name) => found.has(name)),
  };
}

/** The root of the install the programs are copied from: the folder
 * two above the `git.exe` found in the folders of the `PATH`, or the
 * usual place. */
function installRoot(searchPath: string | undefined): string {
  for (const folder of (searchPath ?? process.env['PATH'] ?? '').split(delimiter)) {
    if (folder !== '' && existsSync(join(folder, 'git.exe'))) return dirname(folder);
  }
  return USUAL_INSTALL;
}

/** How many copies this process began: with its pid, the name of a
 * copy on its way that no other call writes. */
let made = 0;

/** How often a copy is moved into a place that is held, and the pause
 * that grows between two tries: half a second in all. */
const HELD_TRIES = 10;

/** Whether a copy stands at a path and is current for its original:
 * the same size and the same modification time, kept to the
 * millisecond, the grain it is handed on with. A place that cannot be
 * read is not current. */
function current(to: string, original: { size: number; mtimeMs: number }): boolean {
  try {
    const there = statSync(to);
    return (
      there.size === original.size && Math.floor(there.mtimeMs) === Math.floor(original.mtimeMs)
    );
  } catch {
    return false;
  }
}

/** A file's copy under its own name with the original's modification
 * time kept, made when the folder lacks it or when its size or its
 * modification time differs from the original's. The copy is written
 * beside its place under a name of this call's own and moved into
 * place whole, so no call ever reads half a copy and two calls never
 * write one file. A place that is held as the copy is moved (another
 * call moves its copy of the same original there at the same moment,
 * the system looks at a file just made, a program runs from it) is
 * tried again for a moment, and what stands there is kept as soon as
 * it is current. */
function copyCurrent(from: string, to: string): void {
  const original = statSync(from);
  if (current(to, original)) return;
  made += 1;
  const own = `${to}.${String(process.pid)}-${String(made)}.part`;
  let fault: unknown;
  try {
    copyFileSync(from, own);
    utimesSync(own, original.atime, original.mtime);
    for (let tries = 1; tries <= HELD_TRIES; tries += 1) {
      try {
        renameSync(own, to);
        return;
      } catch (error) {
        fault = error;
      }
      if (current(to, original)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * tries);
    }
  } catch (error) {
    fault = error;
  }
  try {
    unlinkSync(own);
  } catch {
    // Never written, or gone already.
  }
  if (!current(to, original)) throw fault instanceof Error ? fault : new Error(String(fault));
}

/** A root of its own: `usr/bin` holding one copy per program of the
 * list the install carries and every runtime library of the install's
 * `usr/bin` beside them, the magic file when the list names `file`,
 * a `tmp`, and an `etc/fstab` of one line. A copy named for a program
 * the list lacks is deleted, and a program the install lacks is
 * skipped. A machine without the install answers the folder's
 * `usr/bin`, made and empty. */
function copied(folder: string, wanted: readonly string[], install: string): Toolbox {
  const bin = join(folder, 'usr', 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(folder, 'tmp'), { recursive: true });
  mkdirSync(join(folder, 'etc'), { recursive: true });
  const fstab = join(folder, 'etc', 'fstab');
  let written: string | undefined;
  try {
    written = readFileSync(fstab, 'utf8');
  } catch {
    written = undefined;
  }
  if (written !== FSTAB) writeFileSync(fstab, FSTAB);

  const source = join(install, 'usr', 'bin');
  const carried = existsSync(source) ? readdirSync(source) : [];
  const held: string[] = [];
  for (const name of wanted) {
    const file = `${name}.exe`;
    if (!carried.includes(file)) continue;
    copyCurrent(join(source, file), join(bin, file));
    held.push(name);
  }
  for (const file of carried) {
    if (/^msys-.*\.dll$/.test(file)) copyCurrent(join(source, file), join(bin, file));
  }
  const keep = new Set(held.map((name) => `${name}.exe`));
  for (const entry of readdirSync(bin)) {
    if (!entry.endsWith('.exe') || keep.has(entry)) continue;
    try {
      unlinkSync(join(bin, entry));
    } catch {
      // Another call removed it at the same moment.
    }
  }
  if (wanted.includes('file')) {
    const magic = join(install, 'usr', 'share', 'misc', 'magic.mgc');
    if (existsSync(magic)) {
      mkdirSync(join(folder, 'usr', 'share', 'misc'), { recursive: true });
      copyCurrent(magic, join(folder, 'usr', 'share', 'misc', 'magic.mgc'));
    }
  }
  const path = realpathSync(bin);
  return {
    path,
    programs: held,
    ...(held.includes('bash') ? { shell: join(path, 'bash.exe') } : {}),
  };
}
