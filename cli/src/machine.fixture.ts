// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// What the cli's proofs ask of the machine they run on, by its own
// answer and never by its name: whether files have owners and modes
// here, and whether this account makes a symbolic link.

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Whether this system has users: a file's mode closes it to another
 * user, and an account may be root. */
export const hasUsers: boolean = process.getuid !== undefined;

let links: boolean | undefined;

/** Whether this account makes a symbolic link here, asked once: a
 * system that keeps links to the privileged refuses an ordinary one. */
export function makesLinks(): boolean {
  if (links !== undefined) return links;
  const folder = mkdtempSync(join(tmpdir(), 'cern-links-'));
  try {
    writeFileSync(join(folder, 'target'), '');
    symlinkSync(join(folder, 'target'), join(folder, 'link'));
    links = true;
  } catch {
    links = false;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return links;
}
