// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { AGENT_PATH_PATTERN } from './naming.js';
import { canonicalJsonBytes, sha256DigestOf } from './package.js';
import { VERSION_PATTERN } from './version.js';

// THE PLATFORM RELEASE: the record of one release's platform, the
// lockfile of the platform. It lists the platform's packages by id,
// each with the version it is stamped at, the package digest that
// names its blob in the registry and the digest of the blob's bytes. A
// runtime carries the record of its own version, so the runtime says
// which bytes are its platform and the registry serves them; a
// platform folder carries it beside its packages, and a plane lands a
// release's platform from it. The record is written in one canonical
// form, so the same packages at the same version are the same bytes
// wherever the record is made.

/** The namespace of the platform's packages in the registry, the
 * platform publisher's own. */
export const PLATFORM_NAMESPACE = 'cernanto';

/** The publisher stamped on every platform package. */
export const PLATFORM_PUBLISHER = 'cernanto';

/** THE REHEARSAL AGENTS of the platform: packages of the platform's
 * tree that no release carries. The rehearsal vendor answers a
 * compile's sessions from script files, with no model, so a proof's
 * plane runs whole compiles at no cost; a plane installed from a
 * release holds the real vendors alone, and a setting that names the
 * rehearsal one finds nothing to bind there. A plane run from the tree
 * holds them, as the tree does. */
export const PLATFORM_REHEARSAL_AGENTS: readonly string[] = ['cernanto/harness/fake'];

/** Whether a package of the platform's tree is part of a release: every
 * one but the rehearsal agents. */
export function inPlatformRelease(agentId: string): boolean {
  return !PLATFORM_REHEARSAL_AGENTS.includes(agentId);
}

/** The record's file: in a runtime package and in a platform folder,
 * at the root of each. */
export const PLATFORM_RELEASE_FILE = 'platform-release.json';

/** The workspace marker of a platform folder, by its file's name and
 * its content: its agents lie under the platform's namespace. */
export const PLATFORM_FOLDER_MARKER_FILE = 'cernanto.json';
export const PLATFORM_FOLDER_MARKER: { version: number; folders: string[] } = {
  version: 1,
  folders: [PLATFORM_NAMESPACE],
};

/** Where an agent's package lies in a workspace, from its root, by its
 * id alone: `.cern/<leaf>.cern` in the folder the id names, so
 * `cernanto/compile/judge` lies at `cernanto/compile/.cern/judge.cern`.
 * Forward slashes; the caller joins it to a root. */
export function workspacePackagePath(agentId: string): string {
  const slash = agentId.lastIndexOf('/');
  const folder = slash === -1 ? '' : `${agentId.slice(0, slash)}/`;
  return `${folder}.cern/${agentId.slice(slash + 1)}.cern`;
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const platformReleasePackageSchema = z.strictObject({
  id: z.string().regex(AGENT_PATH_PATTERN),
  /** The version the package is stamped at. */
  version: z.string().regex(VERSION_PATTERN),
  /** The sha256 of the package's manifest: what names its blob. */
  packageDigest: z.string().regex(DIGEST_PATTERN),
  /** The sha256 of the package file's bytes: what a plane's fleet names. */
  blobDigest: z.string().regex(DIGEST_PATTERN),
});
export type PlatformReleasePackage = z.infer<typeof platformReleasePackageSchema>;

export const platformReleaseBodySchema = z.strictObject({
  version: z.string().regex(VERSION_PATTERN),
  packages: z.array(platformReleasePackageSchema).min(1),
});
export type PlatformReleaseBody = z.infer<typeof platformReleaseBodySchema>;

/** A record from a version and its packages, in the one order a record
 * keeps them: by id, each id once. */
export function platformReleaseBodyOf(
  version: string,
  packages: readonly PlatformReleasePackage[],
): PlatformReleaseBody {
  const sorted = [...packages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const [index, entry] of sorted.entries()) {
    if (index > 0 && sorted[index - 1]?.id === entry.id) {
      throw new Error(`the platform release ${version} names ${entry.id} twice`);
    }
  }
  return platformReleaseBodySchema.parse({ version, packages: sorted });
}

/** The record's canonical bytes: what a runtime and a platform folder
 * carry. */
export function platformReleaseBytes(body: PlatformReleaseBody): Buffer {
  return canonicalJsonBytes(platformReleaseBodyOf(body.version, body.packages));
}

/** The record's digest: sha256 over its canonical bytes. */
export function platformReleaseDigestOf(body: PlatformReleaseBody): string {
  return sha256DigestOf(platformReleaseBytes(body));
}

/** Reads a record's bytes: a JSON document of the shape, in its
 * canonical form, so the sha256 of the bytes read is the record's
 * digest. Bytes of any other shape or form are refused in words. */
export function readPlatformRelease(bytes: Buffer): { body: PlatformReleaseBody; digest: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('the platform release does not read as JSON');
  }
  const shaped = platformReleaseBodySchema.safeParse(parsed);
  if (!shaped.success) {
    const issue = shaped.error.issues[0];
    throw new Error(
      `the platform release does not read as one: ${issue === undefined ? 'its shape is wrong' : `${issue.path.join('.')}: ${issue.message}`}`,
    );
  }
  const canonical = platformReleaseBytes(shaped.data);
  if (!canonical.equals(bytes)) {
    throw new Error(
      'the platform release is not in its canonical form; it was edited or re-encoded',
    );
  }
  return { body: shaped.data, digest: sha256DigestOf(bytes) };
}

/** A release's record as one machine holds it: the record less the
 * packages that machine leaves out (another system's, another store's),
 * in the record's own form. A machine that leaves none out holds the
 * record itself, and a name the record does not carry changes nothing. */
export function platformReleaseWithout(
  body: PlatformReleaseBody,
  leftOut: readonly string[],
): PlatformReleaseBody {
  const out = new Set(leftOut);
  return platformReleaseBodyOf(
    body.version,
    body.packages.filter((entry) => !out.has(entry.id)),
  );
}

/** Whether a record is a release's as some machine holds it: the
 * release's own version, and every package it names one the release
 * names by the same version and the same digests. */
export function isPlatformReleasePart(
  part: PlatformReleaseBody,
  whole: PlatformReleaseBody,
): boolean {
  if (part.version !== whole.version) return false;
  const named = new Map(whole.packages.map((entry) => [entry.id, entry]));
  return part.packages.every((entry) => {
    const one = named.get(entry.id);
    return (
      one !== undefined &&
      one.version === entry.version &&
      one.packageDigest === entry.packageDigest &&
      one.blobDigest === entry.blobDigest
    );
  });
}

/** A package of the workspace beside the platform's, as a release
 * weighs it: the catalog of connectors and the examples. */
export interface ReleaseAgentCandidate {
  id: string;
  /** The agent's kind, as its package states it. */
  type: string;
  /** Whether the package carries the stamp of a live verification. */
  verified: boolean;
  /** The agents it uses or implements, by id. */
  needs: readonly string[];
}

/** What a release carries of that workspace, and what it leaves. */
export interface ReleaseAgents {
  /** The ids the release carries, in order. */
  carried: string[];
  /** Each package left out, with the reason, by id. */
  leftOut: { id: string; reason: string }[];
  /** Where the list is not whole: each need of a fit package that
   * neither the platform nor a fit package answers. Empty for a list
   * that is whole. */
  wanting: { id: string; need: string }[];
}

/** THE AGENTS OF A RELEASE. A package is fit to publish when it carries
 * the stamp of a live verification, or is an interface or a worker,
 * which carry none; one that is not is left out and named. A release
 * is whole over the platform and its agents together: every agent a
 * carried package uses or implements is the platform's or a carried
 * one. `wanting` names where the fit ones are not whole, which refuses
 * the pack of a release; `carried` is what remains once every package
 * whose need is missing is left out in its turn, each named with the
 * need, which is what a run that is no release packs. */
export function releaseAgentsOf(
  candidates: readonly ReleaseAgentCandidate[],
  platform: readonly string[],
): ReleaseAgents {
  const byId = (a: { id: string }, b: { id: string }): number =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const isFit = (one: ReleaseAgentCandidate): boolean =>
    one.verified || one.type === 'interface' || one.type === 'worker';
  const leftOut = candidates
    .filter((one) => !isFit(one))
    .map((one) => ({ id: one.id, reason: 'it carries no verified stamp' }));
  let carried = candidates.filter(isFit);
  const missingOf = (one: ReleaseAgentCandidate, held: ReadonlySet<string>): string[] =>
    one.needs.filter((need) => !held.has(need));
  const heldBy = (list: readonly ReleaseAgentCandidate[]): Set<string> =>
    new Set([...platform, ...list.map((one) => one.id)]);
  const fit = heldBy(carried);
  const wanting = [...carried]
    .sort(byId)
    .flatMap((one) => missingOf(one, fit).map((need) => ({ id: one.id, need })));
  for (;;) {
    const held = heldBy(carried);
    const out = carried.filter((one) => missingOf(one, held).length > 0);
    if (out.length === 0) break;
    for (const one of out) {
      leftOut.push({
        id: one.id,
        reason: `it needs ${missingOf(one, held).join(', ')}, which the release does not carry`,
      });
    }
    const dropped = new Set(out.map((one) => one.id));
    carried = carried.filter((one) => !dropped.has(one.id));
  }
  return {
    carried: carried.map((one) => one.id).sort(),
    leftOut: leftOut.sort(byId),
    wanting,
  };
}

/** The files of a platform folder, in the one layout a pull lays and a
 * pack of a release writes: the workspace marker at the root, the record
 * beside it, and each package at the place its id names, no spec beside
 * it (the spec rides inside the package, and a spec beside a package is
 * the mark of an author's own agent). Paths are relative, with forward
 * slashes; the caller writes them under a root. */
export function platformFolderEntries(
  record: Buffer,
  packages: readonly { id: string; bytes: Buffer }[],
): { path: string; bytes: Buffer }[] {
  return [
    {
      path: PLATFORM_FOLDER_MARKER_FILE,
      bytes: Buffer.from(`${JSON.stringify(PLATFORM_FOLDER_MARKER)}\n`),
    },
    { path: PLATFORM_RELEASE_FILE, bytes: record },
    ...packages.map((one) => ({ path: workspacePackagePath(one.id), bytes: one.bytes })),
  ];
}
