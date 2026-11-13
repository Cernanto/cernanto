// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The release view over an npm install: a server or a laptop installs
// the runtime's version from npm into a prefix of its own, and the
// block and the materialize join a release root and the tree's paths
// (the release layout), so the install is laid out as the tree is, one
// link per part. Nothing is copied.
//
//   node <prefix>/node_modules/@cernanto/runtime/dist/release-view.js <prefix> <view> <platform folder>
//
// The view carries the process package, the runtime library, the
// platform folder's packages with its workspace marker and its record
// (the folder the release's platform was pulled into), the cli and the
// format kit when the prefix holds them, and release.json: the version,
// with the facts the runtime's package states of its release (the
// moment of its pack, the commit, the Node it runs on).

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { system } from '@cernanto/system';

/** The runtime's name on npm, which the prefix installs it under. */
const RUNTIME_PACKAGE = '@cernanto/runtime';
/** The platform's agent folder, its workspace marker and its record,
 * as a platform folder holds them. */
const PLATFORM_AGENTS = 'cernanto';
const PLATFORM_MARKER = 'cernanto.json';
const PLATFORM_RECORD = 'platform-release.json';
/** The release's facts: the file the runtime's package carries at its
 * root and the release folder states of itself. */
const RELEASE_FACTS = 'release.json';

const [prefixArgument, viewArgument, platformArgument] = process.argv.slice(2);
if (prefixArgument === undefined || viewArgument === undefined || platformArgument === undefined) {
  process.stderr.write('usage: release-view <npm prefix> <view folder> <platform folder>\n');
  process.exit(2);
}
const prefix = resolve(prefixArgument);
const view = resolve(viewArgument);
const platform = resolve(platformArgument);
const processPackage = join(prefix, 'node_modules', ...RUNTIME_PACKAGE.split('/'));
if (!existsSync(join(processPackage, 'package.json'))) {
  process.stderr.write(
    `${prefix} holds no ${RUNTIME_PACKAGE}: npm install ${RUNTIME_PACKAGE} there first\n`,
  );
  process.exit(1);
}
for (const part of [PLATFORM_AGENTS, PLATFORM_MARKER, PLATFORM_RECORD]) {
  if (!existsSync(join(platform, part))) {
    process.stderr.write(
      `${platform} holds no ${part}: it is not a platform folder; the release's platform is pulled from the registry first\n`,
    );
    process.exit(1);
  }
}
const fromProcess = createRequire(join(realpathSync(processPackage), 'package.json'));
/** A package's real folder, resolved from the process package's place,
 * or nothing when the prefix lacks it. */
const beneath = (name: string): string | undefined => {
  try {
    return realpathSync(dirname(fromProcess.resolve(`${name}/package.json`)));
  } catch {
    return undefined;
  }
};
const required = (name: string): string => {
  const found = beneath(name);
  if (found === undefined) {
    process.stderr.write(`${prefix} holds no ${name}; the install is incomplete\n`);
    process.exit(1);
  }
  return found;
};
mkdirSync(join(view, 'runtime'), { recursive: true, mode: 0o755 });
system.linkFolder(realpathSync(processPackage), join(view, 'runtime', 'process'));
system.linkFolder(required('@cernanto/runtime-lib'), join(view, 'runtime', 'lib'));
const platformRoot = realpathSync(platform);
system.linkFolder(join(platformRoot, PLATFORM_AGENTS), join(view, PLATFORM_AGENTS));
system.linkFile(join(platformRoot, PLATFORM_MARKER), join(view, PLATFORM_MARKER));
system.linkFile(join(platformRoot, PLATFORM_RECORD), join(view, PLATFORM_RECORD));
// The cli: the seed host deploys the release's packages with it, and the
// operator's own calls go through it. The format kit comes with it.
const cli = beneath('cernanto');
if (cli !== undefined) system.linkFolder(cli, join(view, 'cli'));
const format = beneath('@cernanto/package-format');
if (format !== undefined) system.linkFolder(format, join(view, 'format'));
const version = (
  JSON.parse(readFileSync(join(processPackage, 'package.json'), 'utf8')) as { version: string }
).version;
// The release's facts, which the runtime's package carries beside its
// manifest: the moment it was packed, which orders the releases
// installed on a host, the commit, and the Node it runs on. A runtime
// that carries none (the tree's own, an early release) states its
// version alone.
const facts = ((): { packed?: string; commit?: string; node?: string } => {
  try {
    const stated = JSON.parse(readFileSync(join(processPackage, RELEASE_FACTS), 'utf8')) as {
      packed?: unknown;
      commit?: unknown;
      node?: unknown;
    };
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' && value !== '' ? value : undefined;
    const kept: { packed?: string; commit?: string; node?: string } = {};
    const packed = text(stated.packed);
    if (packed !== undefined) kept.packed = packed;
    const commit = text(stated.commit);
    if (commit !== undefined) kept.commit = commit;
    const node = text(stated.node);
    if (node !== undefined) kept.node = node;
    return kept;
  } catch {
    return {};
  }
})();
writeFileSync(
  join(view, RELEASE_FACTS),
  `${JSON.stringify({ version, ...facts, runtime: prefix, name: `cernanto-release-${version}` }, null, 2)}\n`,
);
process.stdout.write(
  `${view}: the release ${version} laid over ${prefix}${cli === undefined ? ' (without the cli: install cernanto there for the seed host)' : ''}\n`,
);
