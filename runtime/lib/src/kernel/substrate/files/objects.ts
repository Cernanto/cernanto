// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The plane's objects on files, `<root>/objects/<name>`, each written
// to a temporary name and renamed into place, so a reader never meets a
// half-written object.

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Objects } from '../../substrate.js';
import { escaped } from '../../subjects.js';

/** A segment of an object's name as the name of its folder or file: a
 * name is plain text, and a file's name is not, so every character
 * outside letters, digits, `_`, `.` and `-` is escaped. The objects
 * implementor `cernanto/objects/files` spells the same way, so both
 * meet at one file. */
function fileName(segment: string): string {
  return escaped(segment, /[^A-Za-z0-9_.-]/g);
}

/** The plane's objects on files: `<root>/objects/<name>`, a name's
 * segments the folders and the file under it (the folder the objects
 * implementor `cernanto/objects/files` serves), each written to a
 * temporary name and renamed into place. A segment that climbs is
 * refused. */
export class FileObjects implements Objects {
  private readonly folder: string;

  constructor(root: string) {
    this.folder = join(root, 'objects');
  }

  private fileOf(name: string): string {
    const segments = name.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
      throw new Error(`the object name ${name} is refused`);
    return join(this.folder, ...segments.map(fileName));
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    const file = this.fileOf(name);
    mkdirSync(dirname(file), { recursive: true });
    const staged = `${file}.${String(process.pid)}.tmp`;
    await writeFile(staged, bytes);
    try {
      renameSync(staged, file);
    } catch (error) {
      rmSync(staged, { force: true });
      throw error;
    }
  }

  async get(name: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(this.fileOf(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  has(name: string): Promise<boolean> {
    return Promise.resolve(existsSync(this.fileOf(name)));
  }

  delete(name: string): Promise<void> {
    rmSync(this.fileOf(name), { force: true });
    return Promise.resolve();
  }
}
