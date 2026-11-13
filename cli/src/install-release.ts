// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { REGISTRY_GATE_DEFAULT, REGISTRY_INDEX_DEFAULT } from '@cernanto/package-format';

import { RegistryClient } from './registry.js';
import { installPlatformAt, layReleaseView } from './release.js';
import { NODE_SOURCE_DEFAULT, layReleaseNode } from './release-node.js';

// A release installed on a server. npm puts the runtime and the cli of
// one version into a prefix; the platform's packages are the
// registry's and the Node the release runs on is its own, so a release
// is whole once both are laid. This program does what `cernanto dev`
// does for a laptop, at the places a server's operator names, and
// what a server needs beside it:
//
//   - the platform release the runtime carries is pulled into the
//     prefix, each package held to the record, unless its folder is
//     laid there already: the packages that fit this server, which
//     holds no implementor of another system or of another store than
//     the one its machine file names, so the machine file is written
//     before this runs;
//   - the release folder a host runs from is laid over the prefix, one
//     link per part in the tree's layout, with the facts the runtime
//     states of its release;
//   - the Node the release names is laid into that folder, `bin/node`
//     with npm beside it, taken from nodejs.org at that exact version
//     and held to its list of checksums.
//
//   npm install --prefix <prefix> cernanto@<version> @cernanto/runtime@<version>
//   node <prefix>/node_modules/cernanto/dist/install-release.js <prefix> <release folder> [packages host] [node source]
//
// THE RELEASE FOLDER IS LAID WHOLE OR NOT AT ALL: under
// `<release folder>.part`, renamed once everything is in it, since a
// host's launcher starts the highest release whose runner is in place
// and a folder half laid must never be chosen. A release folder that
// stands is left as it is: a plane may be running from it.
//
// The packages host is the public registry's and the Node source is
// nodejs.org's unless a mirror of each is named.

/** The runner of a release, whose presence says a release folder
 * stands. */
const RUNNER = join('runtime', 'process', 'dist', 'agent', 'bin.js');

const USAGE = 'install-release <npm prefix> <release folder> [packages host] [node source]';

const HELP = `install-release: completes a release on a server, after npm laid the runtime and the cli into a prefix

  ${USAGE}

It pulls the platform's packages the runtime names that fit this server, each held to
its digest, lays the release's own Node at bin/node of the release folder, and lays the
release folder over the prefix, whole. A server holds the packages of its own store, the
one its machine file /etc/cernanto/machine.json names, so that file is written first.
The packages host is packages.cernanto.com and the Node source is nodejs.org/dist unless
a mirror of each is named. A release folder that stands is left as it is.
`;

const given = process.argv.slice(2);
if (given[0] === '--help' || given[0] === '-h') {
  // The exit waits for the write, which a pipe may take after this turn.
  await new Promise<void>((written) => {
    process.stdout.write(HELP, () => {
      written();
    });
  });
  process.exit(0);
}
const [prefixArgument, folderArgument, hostArgument, nodeArgument] = given;
if (
  prefixArgument === undefined ||
  folderArgument === undefined ||
  given.length > 4 ||
  given.some((word) => word.startsWith('-'))
) {
  process.stderr.write(`usage: ${USAGE}\n`);
  process.exit(2);
}
const prefix = resolve(prefixArgument);
const folder = resolve(folderArgument);
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const registry = new RegistryClient({
  gateUrl: REGISTRY_GATE_DEFAULT,
  indexUrl: (hostArgument ?? REGISTRY_INDEX_DEFAULT).replace(/\/+$/, ''),
});
try {
  await installPlatformAt(prefix, registry, say, folder);
  if (existsSync(join(folder, RUNNER))) {
    say(`${folder}: the release stands and is left as it is`);
  } else if (existsSync(folder)) {
    // Nothing of the operator's is ever removed here: a folder that
    // stands and is no release is theirs to look at.
    throw new Error(
      `${folder} stands and holds no release; remove it, or name another folder for the release`,
    );
  } else {
    const part = `${folder}.part`;
    rmSync(part, { recursive: true, force: true, maxRetries: 5 });
    layReleaseView(prefix, part);
    await layReleaseNode(part, nodeArgument ?? NODE_SOURCE_DEFAULT, say);
    renameSync(part, folder);
    say(`${folder}: the release is laid over ${prefix}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
