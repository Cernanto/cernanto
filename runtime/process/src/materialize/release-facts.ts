// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The release's facts as a program the host job runs once at the start of
// its serve: what this release is, read off its own files, which only
// the materialize's readers can read (the packages' manifests among
// them). Prints one JSON document and exits.
//
//   node release-facts.js
//
// `{version, releaseAgents, types}`: the version the release runs as,
// the ids of the release's packages, and the type each package states,
// by its id (the host job orders the plane's first agents by it). Nothing
// of the machine: an agent learns the machine's basics from the
// environment it was started with, and the release it runs from in the
// mark of its own folder.

import { resolve } from 'node:path';

import { releaseOfProgram } from '../release-layout.js';
import { releaseVersionOf } from './platform.js';
import { releasePackages } from './release-packages.js';

const program = process.argv[1];
const release =
  program !== undefined
    ? releaseOfProgram(resolve(program))
    : resolve(import.meta.dirname, '..', '..', '..', '..');
const packages = releasePackages(release);
const ids = [...packages.keys()].sort();
const facts = {
  version: releaseVersionOf(release),
  releaseAgents: ids,
  types: Object.fromEntries(ids.map((id) => [id, packages.get(id)?.pkg.manifest.type])),
};
process.stdout.write(`${JSON.stringify(facts)}\n`);
