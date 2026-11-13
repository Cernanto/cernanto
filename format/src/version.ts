// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// Versions: semver 2.0 with an optional prerelease and nothing after a
// plus, `x.y.z` or `x.y.z-<identifiers>`, and the one precedence every
// reader orders them by. A package carries a version of either
// form, so a run of a release that is not the release itself (a lab's,
// a local one) names itself by a prerelease of it. The registry
// publishes RELEASES alone, `x.y.z`: its protocol, its floor and the
// ranges an install speaks know no prerelease.

const NUMBER = '(?:0|[1-9]\\d*)';
/** A prerelease identifier: a number with no leading zero, or
 * alphanumerics and hyphens of which one at least is no digit. */
const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';

/** A version: `1.4.2`, or `1.4.2-lab.3` with its prerelease. */
export const VERSION_PATTERN = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`,
);

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** The prerelease identifiers in order; none for a release. */
  prerelease: readonly string[];
}

/** A version taken apart, or nothing for a text that is no version. */
export function parseVersion(version: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** Whether a version carries a prerelease. */
export function isPrerelease(version: string): boolean {
  return (parseVersion(version)?.prerelease.length ?? 0) > 0;
}

/** Two prerelease identifiers in semver's order: numbers by value and
 * below every text, texts by their characters. A number carries no
 * leading zero, so the longer one is the larger at any size. */
function compareIdentifiers(a: string, b: string): number {
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (numericA) return -1;
  if (numericB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver precedence: the three numbers, then a prerelease before its
 * release, the identifiers one by one, and a longer set after a shorter
 * one it begins with. A text that is no version sorts first. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === undefined || right === undefined) {
    if (left === undefined && right === undefined) return 0;
    return left === undefined ? -1 : 1;
  }
  for (const part of ['major', 'minor', 'patch'] as const) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const order = compareIdentifiers(left.prerelease[index] ?? '', right.prerelease[index] ?? '');
    if (order !== 0) return order;
  }
  if (left.prerelease.length === right.prerelease.length) return 0;
  return left.prerelease.length < right.prerelease.length ? -1 : 1;
}

/** The range grammar installs speak: `latest`, an exact version,
 * `^x.y.z` (same major, at least x.y.z), `~x.y.z` (same major.minor,
 * at least x.y.z). A range stays within one major, and takes releases
 * alone: a prerelease answers its own exact version and no range. */
export function satisfiesRange(version: string, range: string): boolean {
  const candidate = parseVersion(version);
  if (candidate === undefined) return false;
  if (version === range) return true;
  if (candidate.prerelease.length > 0) return false;
  if (range === 'latest' || range === '*' || range === '') return true;
  if (range.startsWith('^') || range.startsWith('~')) {
    const floor = parseVersion(range.slice(1));
    if (floor === undefined) return false;
    if (candidate.major !== floor.major) return false;
    if (range.startsWith('~') && candidate.minor !== floor.minor) return false;
    return compareVersions(version, range.slice(1)) >= 0;
  }
  return false;
}

/** The highest version satisfying the range; yanked versions are the
 * caller's business to exclude first. */
export function pickVersion(versions: readonly string[], range: string): string | undefined {
  const satisfying = versions.filter((version) => satisfiesRange(version, range));
  satisfying.sort(compareVersions);
  return satisfying.at(-1);
}

/** A RELEASE: a version with no prerelease, `x.y.z`. The registry
 * publishes releases alone; a prerelease is a version a package may
 * carry (a lab's run of a release, a local one) and is never
 * published. */
export const RELEASE_VERSION_PATTERN = new RegExp(`^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})$`);

/** Why a version may not be published over the one that stands. */
export interface VersionFloorRefusal {
  code: 'version-not-higher';
  message: string;
}

/** The registry's version floor against the highest published version
 * of a name, read by the gate at a publish and by a publisher before
 * one: a version strictly rises above it. Which of its numbers rises,
 * the patch, the minor or the major, is the publisher's to say,
 * whatever the contract did. */
export function versionFloorRefusal(
  next: { version: string },
  previous: { version: string },
): VersionFloorRefusal | undefined {
  if (compareVersions(next.version, previous.version) <= 0) {
    return {
      code: 'version-not-higher',
      message: `version ${next.version} is not higher than the published ${previous.version}; published versions are immutable, publish a higher one`,
    };
  }
  return undefined;
}
