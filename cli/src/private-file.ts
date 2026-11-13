// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { renameHeld } from '@cernanto/system';

// A file that holds a credential (the contexts, the registry sign-in):
// readable by its owner alone, and written whole.

/** Writes a credential file whole: its folder made for the owner alone
 * when absent, the text written under a temporary name with the
 * owner's mode and renamed into place, so a reader sees all of it or
 * the one before, and a file that existed with a wider mode is
 * narrowed.
 * @param file - The file's absolute path.
 * @param text - What the file holds.
 * @example writePrivateFile(contextsPath(), `${JSON.stringify(data)}\n`);
 */
export function writePrivateFile(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, text, { mode: 0o600 });
    renameHeld(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
