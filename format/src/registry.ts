// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { REGISTRY_NAME_PATTERN } from './naming.js';
import { RELEASE_VERSION_PATTERN } from './version.js';

// The registry protocol: the gate's request and response shapes and the
// public index file shapes, shared by the cli and the gate so both
// sides parse one truth. Reads are static files on the packages host;
// the gate serves identity and writes. Paths carry the protocol
// version; the hosts stay unversioned.

export const REGISTRY_GATE_DEFAULT = 'https://registry.cernanto.com';
export const REGISTRY_INDEX_DEFAULT = 'https://packages.cernanto.com';

/** Where a package's per-name index file lives on the packages host. */
export function registryIndexPath(name: string): string {
  return `/index/v1/${name}.json`;
}

/** Where a package blob lives: digest-named, names live in the index. */
export function registryBlobPath(packageDigest: string): string {
  return `/blobs/${packageDigest.replace(':', '-')}.cern`;
}

export function registryStatsPath(name: string): string {
  return `/stats/v1/${name}.json`;
}

export const REGISTRY_SUMMARY_PATH = '/index/v1/packages.json';
export const REGISTRY_META_PATH = '/meta/v1/registry.json';

// --- package references --------------------------------------------------

/** Splits `acme/fact-check@^1.2.0` into the id and the range; an id
 * with no range means `latest`. */
export function parsePackageRef(ref: string): { name: string; range: string } | undefined {
  const at = ref.lastIndexOf('@');
  const name = at === -1 ? ref : ref.slice(0, at);
  const range = at === -1 ? 'latest' : ref.slice(at + 1);
  if (!REGISTRY_NAME_PATTERN.test(name)) return undefined;
  if (range !== 'latest' && range !== '*') {
    const floor = range.startsWith('^') || range.startsWith('~') ? range.slice(1) : range;
    if (!RELEASE_VERSION_PATTERN.test(floor)) return undefined;
  }
  return { name, range };
}

// --- the gate's request and response shapes ------------------------------

export const registryErrorSchema = z.looseObject({
  error: z.looseObject({ code: z.string().min(1), message: z.string().min(1) }),
});

/** Public login configuration: the CLI builds the GitHub authorize url
 * from it (the client id is public by OAuth design). */
export const loginConfigSchema = z.looseObject({
  clientId: z.string().min(1),
  authorizeUrl: z.string().min(1),
});

export const loginRequestSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().min(1),
});

export const publisherViewSchema = z.looseObject({
  publisherId: z.string().min(1),
  login: z.string().min(1),
  email: z.string().min(1).optional(),
});

export const loginResponseSchema = z.looseObject({
  token: z.string().min(1),
  publisher: publisherViewSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const tokenScopesSchema = z.looseObject({
  namespaces: z.array(z.string().min(1)).optional(),
  actions: z.array(z.enum(['publish', 'yank', 'org'])).optional(),
});
export type TokenScopes = z.infer<typeof tokenScopesSchema>;

export const tokenCreateRequestSchema = z.object({
  name: z.string().min(1),
  expiresInDays: z.number().int().positive().optional(),
  scopes: tokenScopesSchema.optional(),
});

export const tokenCreatedSchema = z.looseObject({
  tokenId: z.string().min(1),
  token: z.string().min(1),
});
export type TokenCreated = z.infer<typeof tokenCreatedSchema>;

export const tokenRowSchema = z.looseObject({
  tokenId: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  scopes: tokenScopesSchema.optional(),
});
export type TokenRow = z.infer<typeof tokenRowSchema>;

export const memberRequestSchema = z.object({
  login: z.string().min(1),
  role: z.enum(['owner', 'publisher']),
});

export const publishBeginRequestSchema = z.object({
  name: z.string().regex(REGISTRY_NAME_PATTERN),
  version: z.string().regex(RELEASE_VERSION_PATTERN),
  size: z.number().int().positive(),
});

export const publishBeginResponseSchema = z.looseObject({
  publishId: z.string().min(1),
  uploadUrl: z.string().min(1),
});

export const publishCommitRequestSchema = z.object({
  publishId: z.string().min(1),
});

export const publishCommitResponseSchema = z.looseObject({
  name: z.string().min(1),
  version: z.string().min(1),
  packageDigest: z.string().min(1),
});
export type PublishCommitResponse = z.infer<typeof publishCommitResponseSchema>;

export const yankRequestSchema = z.object({ reason: z.string().min(1).optional() });
export const deprecateRequestSchema = z.object({ message: z.string().min(1) });

export const starResponseSchema = z.looseObject({
  starred: z.boolean(),
  stars: z.number().int().nonnegative(),
});

export const reportRequestSchema = z.object({
  package: z.string().min(1),
  reason: z.string().min(1),
});

// --- the public index file shapes ----------------------------------------

export const indexPlatformSchema = z.union([
  z.literal('any'),
  z.looseObject({
    os: z.string().min(1),
    cpu: z.string().min(1),
    libc: z.string().min(1).optional(),
  }),
]);

export const indexVersionSchema = z.looseObject({
  version: z.string().min(1),
  packageDigest: z.string().min(1),
  /** Path on the packages host (`/blobs/...`), joined to the index
   * base by the client, so mirrors relocate freely. */
  url: z.string().min(1),
  size: z.number().int().nonnegative(),
  publishedAt: z.string().min(1),
  platform: indexPlatformSchema.default('any'),
  contractHash: z.string().min(1).optional(),
  uses: z.array(z.string().min(1)).default([]),
  /** The agent type the package carries (service when absent). */
  type: z.string().min(1).optional(),
  /** The contract hash each dependency was built against, by id:
   * what an install's closure walk resolves a dependency by. */
  usesContracts: z.record(z.string(), z.string()).optional(),
  /** The interfaces the package implements, with the contract sha
   * each was held to: an implementor's interface is a dependency of
   * its install too. */
  implements: z
    .array(z.looseObject({ id: z.string().min(1), contractSha: z.string().min(1) }))
    .optional(),
  /** The previous contracts this version is additive over: a
   * consumer pinned to any of them installs it without a recompile. */
  contractCompatibleWith: z.array(z.string().min(1)).optional(),
  /** The SPDX license expression the package's manifest states. */
  license: z.string().min(1).optional(),
  yanked: z.boolean().optional(),
});

export const packageIndexSchema = z.looseObject({
  indexFormat: z.literal(1),
  name: z.string().min(1),
  latest: z.string().min(1).optional(),
  deprecated: z.string().min(1).optional(),
  versions: z.array(indexVersionSchema).default([]),
});
export type PackageIndex = z.infer<typeof packageIndexSchema>;

export const summaryRowSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)).default([]),
  latest: z.string().min(1),
  /** The latest version's license, for the listing. */
  license: z.string().min(1).optional(),
  downloads: z.number().int().nonnegative().default(0),
  stars: z.number().int().nonnegative().default(0),
  publishedAt: z.string().min(1),
});
export type SummaryRow = z.infer<typeof summaryRowSchema>;

export const packagesSummarySchema = z.looseObject({
  indexFormat: z.literal(1),
  generatedAt: z.string().min(1),
  packages: z.array(summaryRowSchema).default([]),
});
export type PackagesSummary = z.infer<typeof packagesSummarySchema>;

/** Ranks summary rows for a free-text query: token hits over name,
 * keywords and description, then popularity, then recency. Search is
 * client-side over the static summary by design; this matcher is the
 * one ranking every client shares. */
export function searchSummary(summary: PackagesSummary, query: string): SummaryRow[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [];
  const scored = summary.packages.flatMap((row) => {
    const name = row.name.toLowerCase();
    const keywords = row.keywords.map((keyword) => keyword.toLowerCase());
    const description = (row.description ?? '').toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (name === token || name.endsWith(`/${token}`)) score += 8;
      else if (name.includes(token)) score += 5;
      if (keywords.includes(token)) score += 3;
      else if (keywords.some((keyword) => keyword.includes(token))) score += 2;
      // A description hit needs a word, not a particle: "it" is in
      // every description.
      if (token.length >= 3 && description.includes(token)) score += 1;
    }
    return score > 0 ? [{ row, score }] : [];
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.row.downloads - a.row.downloads ||
      b.row.stars - a.row.stars ||
      b.row.publishedAt.localeCompare(a.row.publishedAt),
  );
  return scored.map((entry) => entry.row);
}
