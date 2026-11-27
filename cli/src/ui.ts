// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { currentPlane, isLoopbackPlane, planeFetch } from './gateway-client.js';
import type { Plane } from './gateway-client.js';
import { openInBrowser } from './open-url.js';
import { fail } from './output.js';

// `cernanto ui`: the plane's UI, opened in the default browser. The
// gateway serves the UI at its own address, and takes a request that
// carries no token from its own machine alone; a browser carries none.
// So the verb opens the UI of a plane reached on this machine, the
// local plane first among them, and of any other plane it says where
// its UI opens and opens nothing.

/** The address a plane's UI opens at: the gateway's own, its root. */
export function uiAddress(plane: Plane): string {
  return `${plane.baseUrl.replace(/\/+$/, '')}/`;
}

/** The refusal for a plane whose UI a browser of this machine cannot
 * open, else undefined. */
export function elsewhereWords(plane: Plane): string | undefined {
  if (isLoopbackPlane(plane)) return undefined;
  return `the plane at ${plane.baseUrl} serves its UI to its own machine alone: open the gateway's address in a browser there`;
}

/** What the verb does to the world: where it prints, how it opens an
 * address, and how it finds that the plane answers. */
export interface UiIo {
  write: (text: string) => void;
  open: (url: string) => void;
  /** Reaches the plane once before a browser is sent to it: a parked
   * local plane starts here, as for any command that needs it. */
  reach: (plane: Plane) => Promise<void>;
}

/** Opens a plane's UI: the address is printed, so a machine with no
 * opener still has it, and then handed to the default browser. */
export async function openUi(plane: Plane, io: UiIo): Promise<void> {
  const refused = elsewhereWords(plane);
  if (refused !== undefined) throw new Error(refused);
  await io.reach(plane);
  const address = uiAddress(plane);
  io.write(`opening the plane's UI in your browser: ${address}\n`);
  io.open(address);
}

export function registerUi(program: Command): void {
  program
    .command('ui')
    .description("open the plane's UI in your browser")
    .action(async () => {
      try {
        await openUi(currentPlane(), {
          write: (text) => {
            process.stdout.write(text);
          },
          open: (url) => {
            openInBrowser(url);
          },
          reach: async (plane) => {
            await planeFetch(plane, `${plane.baseUrl}/healthz`);
          },
        });
      } catch (error) {
        fail(error);
      }
    });
}
