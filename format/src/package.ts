// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { AGENT_PATH_PATTERN } from './naming.js';
import { VERSION_PATTERN } from './version.js';

/** The agent types. A `task` serves isolated calls and keeps nothing
 * between them; a `service` is one program whose module variables are
 * its memory; a `job` serves each call as one live run, started again
 * from the top on a retryable failure; a `worker` is a program the
 * plane starts and stops; a `module` is code linked into its
 * consumers; an `interface` compiles to a contract alone: a shared
 * surface other agents implement (`Implements:`) or bind by name at
 * run time (a plain `Uses:` grant). */
export const agentTypeSchema = z.enum(['service', 'task', 'job', 'worker', 'module', 'interface']);
export type AgentType = z.infer<typeof agentTypeSchema>;

/** The spec file suffix: a spec is `<id>.cern.md`, whatever its type.
 * It ends in `.md` so the file renders as markdown everywhere. The type
 * is what the page states on its `Type:` line, a task when it states
 * nothing. */
export const SPEC_SUFFIX = '.cern.md';

/** The suffix a spec path ends with, `.cern.md`, or undefined for any
 * other path: a plain `.md` is documentation, and any other name is a
 * file like any other. */
export function specSuffixOf(path: string): string | undefined {
  return path.endsWith(SPEC_SUFFIX) ? SPEC_SUFFIX : undefined;
}

/** Whether a path names a spec file. */
export function isSpecPath(path: string): boolean {
  return specSuffixOf(path) !== undefined;
}

/** The spec file name of an agent (or of any base name):
 * `payments/payment-retry` is `payments/payment-retry.cern.md`. */
export function specFileNameOf(base: string): string {
  return `${base}${SPEC_SUFFIX}`;
}

/** A spec file's name taken apart: the leaf that names the agent and
 * the suffix. Undefined when the path is no spec file. A dot in the leaf is kept as
 * the leaf's own (`digest.svc.cern.md` is the leaf `digest.svc`, which
 * the agent path rule refuses): the kind is stated on the page, by its
 * `Type:` line, never by the name. */
export function parseSpecFileName(path: string): { leaf: string; suffix: string } | undefined {
  const suffix = specSuffixOf(path);
  if (suffix === undefined) return undefined;
  return { leaf: path.slice(path.lastIndexOf('/') + 1, -suffix.length), suffix };
}

/** The agent id a spec path names: the path relative to the workspace
 * root with forward slashes, minus its suffix. Undefined when the path
 * is no spec file. */
export function agentIdOfSpecPath(relativePath: string): string | undefined {
  const parsed = parseSpecFileName(relativePath);
  if (parsed === undefined) return undefined;
  const slash = relativePath.lastIndexOf('/');
  const dir = slash < 0 ? '' : relativePath.slice(0, slash);
  const id = dir === '' ? parsed.leaf : `${dir}/${parsed.leaf}`;
  return id === '' ? undefined : id;
}

/** The package file extension: `chain-report-1.2.0.cern`. */
export const PACKAGE_EXTENSION = '.cern';

/** The spec inside a package: `agent.cern.md`, whatever the type; the
 * manifest carries the type. */
export const PACKAGE_SPEC_PATH = 'agent.cern.md';

/** The AI coder that wrote the bytes: the vendor agent that ran the
 * session (`cernanto/harness/claude-code`, `cernanto/harness/codex`,
 * any vendor behind the cernanto/harness interface), its CLI's
 * version as the plane probed it, the model that actually served as
 * the vendor reported it (the version-bearing id, in place of the
 * alias that was asked for) and the effort asked. */
export const packageHarnessSchema = z.looseObject({
  name: z.string().min(1),
  cli: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
});
export type PackageHarness = z.infer<typeof packageHarnessSchema>;

// The package format, version 4: the package is what the model wrote,
// the author's inputs and the pins of the world at compile time; whatever
// a machine derives from them is left to its reader. One manifest at
// the root records every content file's sha256, so the manifest's own
// sha256 covers the package whole.

/** The package format major this code speaks. Format 4 carries the
 * coder's code, the tester's tests, the spec, the contract, the lock,
 * the granted files and the fetched documents. */
export const PACKAGE_FORMAT = 4;

/** The manifest at the package root: ours, and named so. */
export const PACKAGE_MANIFEST_PATH = 'cernanto.json';
/** npm's own lock for the agent's closure, at the root, when npm
 * packages are granted. */
export const PACKAGE_LOCK_PATH = 'package-lock.json';
export const PACKAGE_CONTRACT_PATH = 'contract.d.ts';
/** The reserved detached signature over the manifest bytes: the one
 * file a package may carry outside its record. */
export const PACKAGE_SIGNATURE_PATH = 'cernanto.sig';
/** What the coder wrote. */
export const PACKAGE_CODE_DIR = 'code';
/** What the tester wrote; `tests/package-lock.json` is the tester's
 * own lock when the tests grant npm packages. */
export const PACKAGE_TESTS_DIR = 'tests';
/** The author's `file:` grants. */
export const PACKAGE_FILES_DIR = 'files';
/** The OpenAPI documents the compiler fetched at the compile. */
export const PACKAGE_OPENAPI_DIR = 'openapi';
/** The MCP listings the compiler recorded at the compile. */
export const PACKAGE_MCP_DIR = 'mcp';
/** The folders the format names; a file under any other folder
 * refuses the package. */
export const PACKAGE_FOLDERS: readonly string[] = [
  PACKAGE_CODE_DIR,
  PACKAGE_TESTS_DIR,
  PACKAGE_FILES_DIR,
  PACKAGE_OPENAPI_DIR,
  PACKAGE_MCP_DIR,
];

const SHA256_HEX = /^[a-f0-9]{64}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** The one target this release emits and serves. A manifest names its
 * target so a reader can refuse one it does not know before a second
 * emission language exists. */
export const PACKAGE_TARGET = { language: 'typescript', runtime: 'node' } as const;

export const packageTargetSchema = z.looseObject({
  language: z.string().min(1),
  runtime: z.string().min(1),
});

/** A dependency on another agent: its type (a module entry is a
 * link), the contract hash the code was written against, and the
 * registry facts for an install by range. */
export const packageUseSchema = z.looseObject({
  type: agentTypeSchema,
  contractHash: z.string().regex(SHA256_HEX).optional(),
  range: z.string().min(1).optional(),
  builtAgainst: z.string().regex(VERSION_PATTERN).optional(),
});

/** An npm grant: what the author wrote (`grant`, absent when the spec
 * named no pin) and what the compile chose (`version`, always present). */
export const packageNpmEntrySchema = z.looseObject({
  grant: z.string().min(1).optional(),
  version: z.string().min(1),
});

/** An implemented interface by its contract sha (an agent interface,
 * or an implemented document `openapi:<doc>` stamped with the sha of
 * the contract rendered from it, the document itself riding under
 * `files/`), or an implemented document by its own hash and its file
 * under `openapi/`. */
export const packageImplementsEntrySchema = z.union([
  z.looseObject({
    id: z.string().min(1),
    contractSha: z.string().regex(SHA256_HEX),
  }),
  z.looseObject({
    id: z.string().regex(/^openapi:.+/),
    specHash: z.string().min(1),
    file: z.string().min(1),
  }),
]);

/** The words the operator is asked with for a document that
 * authenticates: the page to open, the numbered steps and the scopes
 * the agent's work needs, judged at the compile and pinned here. */
export const packageOnboardingSchema = z.looseObject({
  helpUrl: z.string().min(1),
  instructions: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  road: z.enum(['token', 'client']).optional(),
  credential: z.string().optional(),
});

export const packageOpenapiEntrySchema = z.looseObject({
  specHash: z.string().min(1),
  file: z.string().min(1),
  onboarding: packageOnboardingSchema.optional(),
});
export const packageMcpEntrySchema = z.looseObject({
  schemaHash: z.string().min(1),
  file: z.string().min(1),
});

/** What the tests were written against (the contract hash and the
 * `## Tests` section sha decide their reuse) and the tester's own
 * grants; `tests/package-lock.json` exists when `npm` has entries, and
 * the tester's granted files sit under `tests/assets/`. */
export const packageTestsSchema = z.looseObject({
  contractHash: z.string().regex(SHA256_HEX).optional(),
  testsSectionSha: z.string().regex(SHA256_HEX).optional(),
  /** The agents the tests replaced with mocks (the spec's `Mocks:`),
   * each with the hash of the contract its mock was written against;
   * absent when the tests ran against every dependency live. */
  mocks: z
    .array(z.object({ id: z.string().min(1), contractHash: z.string().regex(SHA256_HEX) }))
    .optional(),
  uses: z.array(z.string().min(1)).default([]),
  npm: z.record(z.string(), packageNpmEntrySchema).default({}),
  /** The tester's granted files, each path under `tests/assets/` to the
   * sha256 hex of its bytes; absent when the Tests section grants none. */
  assets: z.record(z.string().min(1), z.string().regex(SHA256_HEX)).optional(),
});

/** One content file: its sha256 and its size in bytes. */
export const packageRecordEntrySchema = z.looseObject({
  sha256: z.string().regex(SHA256_HEX),
  size: z.number().int().nonnegative(),
});

export const packageProvenanceSchema = z.looseObject({
  cernanto: z.string().min(1).optional(),
  compiler: z.string().min(1).optional(),
  doctrine: z.string().min(1).optional(),
  harness: packageHarnessSchema.optional(),
  tools: z.record(z.string(), z.string()).optional(),
  attempts: z.number().int().positive().optional(),
  triageCount: z.number().int().nonnegative().optional(),
  /** The live verification the compile passed, with the digests of the
   * artifact and tester it produced, kept as evidence. */
  verified: z
    .looseObject({
      at: z.iso.datetime(),
      /** The agents the tests replaced with mocks when the row was
       * verified: the weaker proof, named wherever the bytes go. */
      mocks: z.array(z.string().min(1)).optional(),
      artifact: z.string().regex(DIGEST_PATTERN).optional(),
      tester: z.string().regex(DIGEST_PATTERN).optional(),
    })
    .optional(),
  /** Where the spec that produced this lives, when the tree was a
   * repository at deploy. */
  source: z
    .looseObject({
      repository: z.string().min(1).optional(),
      commit: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
    })
    .optional(),
});

export const packageManifestSchema = z.looseObject({
  packageFormat: z.literal(PACKAGE_FORMAT),
  name: z.string().regex(AGENT_PATH_PATTERN),
  version: z.string().regex(VERSION_PATTERN),
  type: agentTypeSchema,
  target: packageTargetSchema,
  description: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  copyright: z.array(z.string().min(1)).optional(),
  publisher: z.string().min(1).optional(),
  specSha: z.string().regex(SHA256_HEX),
  contractHash: z.string().regex(SHA256_HEX).optional(),
  contractCompatibleWith: z.array(z.string().regex(SHA256_HEX)).optional(),
  handlers: z.array(z.string().min(1)).default([]),
  uses: z.record(z.string(), packageUseSchema).default({}),
  implements: z.array(packageImplementsEntrySchema).optional(),
  npm: z.record(z.string(), packageNpmEntrySchema).default({}),
  openapi: z.record(z.string(), packageOpenapiEntrySchema).default({}),
  mcp: z.record(z.string(), packageMcpEntrySchema).default({}),
  files: z.array(z.string().min(1)).default([]),
  tests: packageTestsSchema.optional(),
  record: z.record(z.string().min(1), packageRecordEntrySchema),
  contentDigest: z.string().regex(DIGEST_PATTERN),
  provenance: packageProvenanceSchema,
});
export type PackageManifest = z.infer<typeof packageManifestSchema>;
export type PackageTests = z.infer<typeof packageTestsSchema>;
export type PackageRecordEntry = z.infer<typeof packageRecordEntrySchema>;

/** A manifest before the writer computes its record and its content
 * digest: what a compile composes. */
export const packageManifestDraftSchema = packageManifestSchema.omit({
  record: true,
  contentDigest: true,
});
export type PackageManifestDraft = z.infer<typeof packageManifestDraftSchema>;

/**
 * Parses a format 4 manifest: an older format is refused by name, an
 * unknown target by name. Unknown fields pass through (additive
 * evolution).
 */
export function parsePackageManifest(value: unknown): PackageManifest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('not a cernanto package manifest');
  }
  const format = (value as { packageFormat?: unknown }).packageFormat;
  if (format !== PACKAGE_FORMAT) {
    throw new Error(
      `this package is format ${typeof format === 'number' ? String(format) : 'unknown'} and this tool speaks ${String(PACKAGE_FORMAT)}; recompile the agent to repack it`,
    );
  }
  const manifest = packageManifestSchema.parse(value);
  if (
    manifest.target.language !== PACKAGE_TARGET.language ||
    manifest.target.runtime !== PACKAGE_TARGET.runtime
  ) {
    throw new Error(
      `this package targets ${manifest.target.language} on ${manifest.target.runtime}; this tool serves ${PACKAGE_TARGET.language} on ${PACKAGE_TARGET.runtime}`,
    );
  }
  return manifest;
}

function sortedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedDeep);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortedDeep(entry)]),
    );
  }
  return value;
}

/** The one serialization of any JSON value the format hashes: keys
 * sorted deep by their UTF-16 code units (the language's plain sort,
 * the same under every locale: `VERSION` before `language`), two-space
 * indent, a trailing newline. Same value, same bytes, everywhere. */
export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(sortedDeep(value), null, 2)}\n`);
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256DigestOf(bytes: Buffer | string): string {
  return `sha256:${sha256Hex(bytes)}`;
}

/** The content digest: sha256 over the record's canonical bytes. The
 * same content across two compiles has the same content digest. */
export function contentDigestOf(record: Readonly<Record<string, PackageRecordEntry>>): string {
  return sha256DigestOf(canonicalJsonBytes(record));
}

/** The conventional file name: `chain/report` at 1.2.0 packs as
 * `chain-report-1.2.0.cern`. A convenience only: install reads the
 * manifest inside and verifies its digests. */
export function packageFileName(name: string, version: string): string {
  return `${name.replaceAll('/', '-')}-${version}${PACKAGE_EXTENSION}`;
}
