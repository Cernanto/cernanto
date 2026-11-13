// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';

import { system } from '@cernanto/system';

// The connect flows (harness sign-ins, MCP account consents) hand the
// operator an authorize url; this opens it in their default browser.

/** Opens a url in the operator's default browser, the system's way. On
 * a machine with no opener (a server reached over ssh) the url is the
 * operator's to open: every caller prints it beside the ask. */
export function openInBrowser(url: string, spawnFn: typeof spawn = spawn): void {
  const opener = system.openerCommand(url);
  try {
    const child = spawnFn(opener.file, opener.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    // A missing opener is reported on the child, after the spawn.
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // The opener could not be started: the printed url stands.
  }
}
