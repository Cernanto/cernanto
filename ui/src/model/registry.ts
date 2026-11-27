// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { compareVersions, pickVersion, searchSummary } from '@cernanto/package-format/browser';
import type { PackageIndex, PackagesSummary, SummaryRow } from '@cernanto/package-format/browser';

import { isPlatform } from './agent.js';

// The registry as a screen lists it. The registry's search is made by
// its client over one static summary, by the ranking the client kit
// holds, so this screen and `cernanto registry search` answer a text
// alike. What is added here is what a plane's reader needs beside it:
// the platform's own packages apart, since every plane already runs
// them, and how a package stands on this plane.

/**
 * The packages of the registry a text finds, the best match first; with
 * no text, every package by its name. The platform's own are left out
 * unless asked for.
 *
 * @param platform - Whether the platform's own packages are listed too.
 */
export function listed(summary: PackagesSummary, text: string, platform = false): SummaryRow[] {
  const rows =
    text.trim() === ''
      ? [...summary.packages].sort((a, b) => a.name.localeCompare(b.name))
      : searchSummary(summary, text);
  return platform ? rows : rows.filter((row) => !isPlatform(row.name));
}

/** How a package of the registry stands on a plane. */
export type Standing =
  /** No agent of the plane carries its id. */
  | { state: 'absent' }
  /** The plane runs it as an installed package, at a version; `newer` when the registry's is higher. */
  | { state: 'installed'; version: string | undefined; newer: boolean }
  /** An agent under its id was deployed from a source: it is its author's own, and no install lands over it. */
  | { state: 'own' };

/**
 * How a package of the registry stands on a plane, by the row the plane
 * holds under its id: a row with the package's mark is an installed
 * package, a row without it an agent deployed from its source.
 *
 * @param row - The plane's row of the id: undefined when it holds none, its package's mark when it carries one.
 */
export function standingOf(
  latest: string,
  row: { package?: { version?: string | undefined } | undefined } | undefined,
): Standing {
  if (row === undefined) return { state: 'absent' };
  if (row.package === undefined) return { state: 'own' };
  const version = row.package.version;
  return {
    state: 'installed',
    version,
    newer: version !== undefined && compareVersions(latest, version) > 0,
  };
}

/** What the registry says of the version of a package an install lands. */
export interface Newest {
  version: string;
  /** The kind of agent it is; a service when the registry names none. */
  type: string;
  /** The agents it uses, which an install brings with it where the plane lacks them. */
  uses: string[];
  implements: string[];
  size: number;
  publishedAt: string;
  license: string | undefined;
  /** The publisher's word that the package is no longer kept up. */
  deprecated: string | undefined;
}

/**
 * The version of a package an install lands, read from the package's
 * own index as the plane picks it: the highest that was not taken back
 * and fits the range asked. A name alone asks for the newest, and a
 * name with a version or a range after its `@` for that one, a newer
 * version beside it or not. Undefined where no version fits.
 *
 * @param range - The range a reference asks: `latest`, a version, `^x.y.z` or `~x.y.z`.
 */
export function newestOf(index: PackageIndex, range = 'latest'): Newest | undefined {
  const live = index.versions.filter((entry) => entry.yanked !== true);
  const picked = pickVersion(
    live.map((entry) => entry.version),
    range,
  );
  const fit = live.find((entry) => entry.version === picked);
  if (fit === undefined) return undefined;
  return {
    version: fit.version,
    type: fit.type ?? 'service',
    uses: fit.uses,
    implements: (fit.implements ?? []).map((entry) => entry.id),
    size: fit.size,
    publishedAt: fit.publishedAt,
    license: fit.license,
    deprecated: index.deprecated,
  };
}

/**
 * Why a package of the registry cannot be granted on a label, in words;
 * undefined when it can. A worker is never granted, and a label that
 * takes a few kinds takes those alone.
 *
 * @param only - The label's own rule over an id and its kind, when it has one.
 * @param what - What the label takes, for the words: "an interface".
 */
export function grantRefusal(
  name: string,
  type: string,
  only: ((agentId: string, type: string) => boolean) | undefined,
  what: string,
): string | undefined {
  if (type === 'worker') return `${name} is a worker, and a worker is never granted.`;
  if (only !== undefined && !only(name, type)) return `${name} is a ${type}; this takes ${what}.`;
  return undefined;
}

/**
 * Why an entry typed whole is not granted on a label, as far as this
 * plane knows what it is; undefined where it is granted. What is typed
 * is held to the rules the list of offers keeps: an agent is not
 * granted to itself, and one the plane runs is held to the plane's own
 * word of its kind. An id the plane does not run is taken as typed: it
 * may be a draft, or an agent deployed later, and the compile judges it.
 *
 * @param entry - What was typed: an id, or an id with the version wanted after an `@`.
 * @param self - The agent whose source is edited.
 * @param typeOf - The kind of an agent this plane runs; undefined for one it does not.
 */
export function typedGrantRefusal(
  entry: string,
  self: string,
  typeOf: (agentId: string) => string | undefined,
  only: ((agentId: string, type: string) => boolean) | undefined,
  what: string,
): string | undefined {
  const at = entry.lastIndexOf('@');
  const name = at > 0 ? entry.slice(0, at) : entry;
  if (name === self) return 'An agent is not granted to itself.';
  const type = typeOf(name);
  return type === undefined ? undefined : grantRefusal(name, type, only, what);
}
