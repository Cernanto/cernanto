// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The packages of a release's platform this machine leaves out: the
// implementors of the interfaces the plane itself decides that do not
// fit it (another system's machine, another store's documents, objects
// and trace reader). The cli asks before it pulls a release's platform,
// so a machine holds one implementor of each and a bind takes it.
//
//   node <prefix>/node_modules/@cernanto/runtime/dist/platform-fit.js <release folder>
//
// The release folder is the one being laid (a server's
// /opt/cernanto/releases/<version>, a laptop's view): the store is the
// one the machine names for a plane run from there, a server's machine
// file or the files anywhere else. Prints one JSON document,
// `{system, store, fits, leftOut}`, and exits.

import { resolve } from 'node:path';

import { leftOutOn, planeFit, storeKindOfPlace } from '@cernanto/runtime-lib/serve';
import { system } from '@cernanto/system';

import { machineFacts } from './agent/place.js';

const [releaseArgument] = process.argv.slice(2);
if (releaseArgument === undefined) {
  process.stderr.write('usage: platform-fit <release folder>\n');
  process.exit(2);
}
const store = storeKindOfPlace(machineFacts(resolve(releaseArgument)).substrate);
process.stdout.write(
  `${JSON.stringify({
    system: system.name,
    store,
    fits: planeFit(system.name, store),
    leftOut: leftOutOn(system.name, store),
  })}\n`,
);
