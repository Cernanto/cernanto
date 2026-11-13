// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { fail } from './output.js';
import { ServerClient } from './server-client.js';

// `cernanto cluster`: the operator's words on a plane of several
// servers, a group with the cluster's own lifecycle. `upgrade <version>` names the
// release the plane's hosts upgrade to, one host at a time, each
// draining first: the plane's release word, written through the
// gateway and the controller, which every host reads against the
// releases installed on it. `drain <host>` tells one host to let its
// copies go for the other hosts to take. A plane of one machine refuses
// both: its release is the box's own, and nothing drains on one machine.

/** The words that refuse an empty version, else undefined: commander
 * requires the argument, and an empty string still passes. */
export function emptyVersionWords(version: string): string | undefined {
  return version.trim() === ''
    ? 'a version is needed: cernanto cluster upgrade <version>'
    : undefined;
}

/** The words that refuse an empty host, else undefined. */
export function emptyHostWords(host: string): string | undefined {
  return host.trim() === '' ? 'a host is needed: cernanto cluster drain <host>' : undefined;
}

export function registerCluster(program: Command): void {
  const cluster = program
    .command('cluster')
    .description("the operator's words on a plane of several servers");
  cluster
    .command('upgrade')
    .argument('<version>')
    .description('name the release the hosts upgrade to, one host at a time')
    .action(async (version: string) => {
      try {
        const refused = emptyVersionWords(version);
        if (refused !== undefined) throw new Error(refused);
        const outcome = await new ServerClient().upgrade(version);
        process.stdout.write(
          `the release word names ${outcome.version}; the hosts upgrade to it one at a time\n`,
        );
      } catch (error) {
        fail(error);
      }
    });
  cluster
    .command('drain')
    .argument('<host>')
    .description('tell one host to let its copies go for the other hosts to take')
    .action(async (host: string) => {
      try {
        const refused = emptyHostWords(host);
        if (refused !== undefined) throw new Error(refused);
        const outcome = await new ServerClient().drainHost(host);
        process.stdout.write(`host ${outcome.host} drains: its copies move to the other hosts\n`);
      } catch (error) {
        fail(error);
      }
    });
}
