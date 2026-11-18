// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The materialize's reader of a .cern package (format 4): the tar
// parsed with the process package's own reader, the record and the three digests
// verified with node's crypto, the manifest's fields the glue needs
// read through a schema, every folder's files answered. What the client
// kit verifies, verified here too: the target, the paths (each one
// inside the package), and the npm entries against the lock.

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { readTar } from './tar-reader.js';

// The manifest reader on zod: what a package says about itself is
// validated by a schema, the process package's own instance of the library.

export const AGENT_TYPES = ['service', 'task', 'job', 'module', 'worker', 'interface'] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

/** An agent's id: path segments of lower-case letters and digits, a
 * single dash between two runs of them, the rule the client kit reads
 * ids by. What the materialize writes is named from ids (a stub's
 * file, a composed module's folder), so an id is checked before it
 * names anything. */
export const AGENT_ID_PATTERN: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** The one target this runtime serves. */
const TARGET = { language: 'typescript', runtime: 'node' } as const;

const text = z.string().min(1);
const versions = z.record(z.string(), z.object({ version: text }));
const useSchema = z.object({ type: z.enum(AGENT_TYPES), contractHash: text.optional() });
const implementsEntrySchema = z.object({
  id: text,
  contractSha: text.optional(),
  specHash: text.optional(),
  file: text.optional(),
});
const testsSchema = z.object({
  uses: z.array(text).default([]),
  npm: versions.default({}),
  mocks: z.array(z.object({ id: text, contractHash: text })).default([]),
  assets: z.record(text, text).optional(),
});
export interface PackageUse {
  type: AgentType;
  contractHash?: string | undefined;
}

export interface PackageImplementsEntry {
  id: string;
  contractSha?: string | undefined;
  specHash?: string | undefined;
  file?: string | undefined;
}

export interface PackageTests {
  uses: string[];
  npm: Record<string, { version: string }>;
  mocks: { id: string; contractHash: string }[];
  /** The tester's granted files, each path under `tests/assets/` to the
   * sha256 hex of its bytes; absent when the Tests section grants none. */
  assets?: Record<string, string> | undefined;
}

/** The fields the schema reads off a manifest. */
interface ManifestFields {
  name: string;
  type: AgentType;
  target: { language: string; runtime: string };
  version: string;
  specSha: string;
  contractHash?: string | undefined;
  /** The earlier contracts this one is compatible with, as the compile
   * judged them; a consumer pinned to one of them is served this one. */
  contractCompatibleWith?: string[] | undefined;
  handlers: string[];
  uses: Record<string, PackageUse>;
  npm: Record<string, { version: string }>;
  implements: PackageImplementsEntry[];
  openapi: Record<string, { specHash: string; file: string; onboarding?: Onboarding | undefined }>;
  mcp: Record<string, { schemaHash: string; file: string }>;
  files: string[];
  tests?: PackageTests | undefined;
}

/** The words a document's account is asked with: the page to open,
 * the numbered steps and the scopes the agent's work needs, judged at
 * the compile and pinned in the package. */
export interface Onboarding {
  helpUrl: string;
  instructions: string;
  scopes: string[];
  /** The road the operator walks, when judged: `token` (a credential
   * the provider issues for direct use is pasted) or `client` (an OAuth
   * client is registered and the lane runs the browser flow). */
  road?: 'token' | 'client' | undefined;
  /** The provider's name for what is pasted, the field's label. */
  credential?: string | undefined;
}

const onboardingSchema: z.ZodType<Onboarding> = z.object({
  helpUrl: text,
  instructions: text,
  scopes: z.array(z.string()).default([]),
  road: z.enum(['token', 'client']).optional(),
  credential: text.optional(),
});

// The schema's output is the manifest's shape: what it reads is what
// the glue holds.
const manifestSchema: z.ZodType<ManifestFields> = z.object({
  packageFormat: z.literal(4),
  name: z.string().regex(AGENT_ID_PATTERN),
  type: z.enum(AGENT_TYPES),
  target: z.object({ language: text, runtime: text }),
  version: text,
  specSha: text,
  contractHash: text.optional(),
  contractCompatibleWith: z.array(text).optional(),
  handlers: z.array(z.string()).default([]),
  uses: z.record(z.string(), useSchema).default({}),
  npm: versions.default({}),
  implements: z.array(implementsEntrySchema).default([]),
  openapi: z
    .record(
      z.string(),
      z.object({ specHash: text, file: text, onboarding: onboardingSchema.optional() }),
    )
    .default({}),
  mcp: z.record(z.string(), z.object({ schemaHash: text, file: text })).default({}),
  files: z.array(z.string()).default([]),
  tests: testsSchema.optional(),
});

/** A package's manifest as the schema reads it, and the whole manifest
 * as stored for readers of fields the schema leaves out. */
export interface PackageManifest extends ManifestFields {
  raw: Record<string, unknown>;
}

export interface ReadPackage {
  manifest: PackageManifest;
  /** sha256 of the stored manifest bytes: the package's identity. */
  packageDigest: string;
  /** sha256 over the record: the same content across compiles. */
  contentDigest: string;
  /** sha256 of the whole file: the storage and transport key. */
  fileDigest: string;
  spec: string;
  /** The spec's file name at the package root (`agent.cern.md`). */
  specName: string;
  contract?: string;
  lock?: Buffer;
  testsLock?: Buffer;
  code: Record<string, Buffer>;
  tests: Record<string, Buffer>;
  files: Record<string, Buffer>;
  openapi: Record<string, Buffer>;
  mcp: Record<string, Buffer>;
}

const SPEC_PATH = 'agent.cern.md';
const FOLDERS = ['code', 'tests', 'files', 'openapi', 'mcp'] as const;
type Folder = (typeof FOLDERS)[number];

function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedDeep);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortedDeep(entry)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortedDeep(value), null, 2)}\n`;
}

function refuse(message: string): never {
  throw new Error(message);
}

/** Reads the manifest's fields the materialize needs off the parsed JSON. */
export function parseManifest(raw: unknown): PackageManifest {
  if (!isRecord(raw)) refuse('not a cernanto package manifest');
  if (raw['packageFormat'] !== 4) {
    refuse(`this package is format ${String(raw['packageFormat'])} and this runtime speaks 4`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    refuse(
      `the manifest is not a cernanto package manifest: ${parsed.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || 'the manifest'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const target = parsed.data.target;
  if (target.language !== TARGET.language || target.runtime !== TARGET.runtime) {
    refuse(
      `this package targets ${target.language} on ${target.runtime}; this runtime serves ${TARGET.language} on ${TARGET.runtime}`,
    );
  }
  return { ...parsed.data, raw };
}

/** A path inside the package: relative, forward slashes, no `.` or
 * `..` segment and no empty one, so what it names lies inside the
 * folder the package is written into. */
function assertPackagePath(path: string): void {
  const inside =
    path !== '' &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  if (!inside)
    refuse(`the package carries the path ${JSON.stringify(path)}, which is no path inside it`);
}

/** The versions a lock resolved, by package name: its top-level
 * `node_modules` entries. */
function resolvedVersions(lock: Buffer, where: string): Map<string, string> {
  let parsed: { packages?: Record<string, { version?: unknown }> };
  try {
    parsed = JSON.parse(lock.toString('utf8')) as typeof parsed;
  } catch {
    return refuse(`${where}: the lock is not a JSON lock file`);
  }
  const resolved = new Map<string, string>();
  for (const [path, entry] of Object.entries(parsed.packages ?? {})) {
    if (!path.startsWith('node_modules/')) continue;
    const name = path.slice('node_modules/'.length);
    if (name.includes('node_modules/') || typeof entry.version !== 'string') continue;
    resolved.set(name, entry.version);
  }
  return resolved;
}

/** The manifest's npm entries against the lock: the manifest is the
 * compile's choice and the lock its closure, and what installs is the
 * lock, so the two say the same versions or the package is refused. */
function verifyNpmAgainstLock(
  npm: Readonly<Record<string, { version: string }>>,
  lock: Buffer | undefined,
  where: string,
): void {
  const names = Object.keys(npm);
  if (names.length === 0) {
    if (lock !== undefined) refuse(`${where}: a lock is carried but no npm package is granted`);
    return;
  }
  if (lock === undefined) refuse(`${where}: npm packages are granted but no lock is carried`);
  const resolved = resolvedVersions(lock, where);
  for (const name of names) {
    const declared = npm[name]?.version;
    const installed = resolved.get(name);
    if (installed === undefined) {
      refuse(
        `${where}: the manifest records ${name}@${String(declared)} but the lock does not resolve ${name}`,
      );
    }
    if (installed !== declared) {
      refuse(
        `${where}: the manifest records ${name}@${String(declared)} but the lock resolved ${installed}`,
      );
    }
  }
}

/**
 * Reads one package: the record verified against every stored file,
 * the content digest against the record, the spec against its sha,
 * the contract against its hash; the folders split out.
 */
export function readPackage(bytes: Buffer): ReadPackage {
  const stored = new Map<string, Buffer>();
  for (const entry of readTar(bytes)) {
    if (entry.kind === 'dir') continue;
    if (entry.kind !== 'file') refuse(`a package carries files only; ${entry.path} is not one`);
    assertPackagePath(entry.path);
    stored.set(entry.path, entry.content ?? Buffer.alloc(0));
  }
  const manifestBytes = stored.get('cernanto.json');
  if (manifestBytes === undefined) {
    if (stored.has('package.json')) {
      refuse(
        'this package is format 3 (a package.json at its root); recompile the agent to repack it',
      );
    }
    refuse('not a cernanto package: no cernanto.json at the root');
  }
  const raw: unknown = JSON.parse(manifestBytes.toString('utf8'));
  const manifest = parseManifest(raw);
  stored.delete('cernanto.json');
  stored.delete('cernanto.sig');
  const record = manifest.raw['record'];
  if (!isRecord(record)) refuse('the manifest carries no record of its files');
  for (const [path, content] of stored) {
    const entry = record[path];
    if (!isRecord(entry)) {
      refuse(`the package carries ${path} outside its record; the package is corrupt or edited`);
    }
    if (entry['size'] !== content.length || entry['sha256'] !== sha256Hex(content)) {
      refuse(`${path} does not match the record; the package is corrupt or edited`);
    }
  }
  for (const path of Object.keys(record)) {
    if (!stored.has(path)) refuse(`the record names ${path} but the package does not carry it`);
  }
  const contentDigest = manifest.raw['contentDigest'];
  if (`sha256:${sha256Hex(canonicalJson(record))}` !== contentDigest) {
    refuse('the content digest does not match the record; the package is corrupt or edited');
  }
  const specEntry = [...stored].find(([path]) => path === SPEC_PATH);
  if (specEntry === undefined) refuse('not a cernanto package: no agent spec at the root');
  const spec = specEntry[1].toString('utf8');
  if (sha256Hex(spec) !== manifest.specSha) {
    refuse("the spec does not match the manifest's specSha; the package is corrupt or edited");
  }
  const contractBytes = stored.get('contract.d.ts');
  if (manifest.contractHash !== undefined) {
    if (contractBytes === undefined || sha256Hex(contractBytes) !== manifest.contractHash) {
      refuse(
        "the contract does not match the manifest's contractHash; the package is corrupt or edited",
      );
    }
  }
  const folders: Record<Folder, Record<string, Buffer>> = {
    code: {},
    tests: {},
    files: {},
    openapi: {},
    mcp: {},
  };
  let testsLock: Buffer | undefined;
  for (const [path, content] of stored) {
    const slash = path.indexOf('/');
    if (slash === -1) continue;
    const folder = path.slice(0, slash);
    const inner = path.slice(slash + 1);
    if (!(FOLDERS as readonly string[]).includes(folder)) {
      refuse(`the package carries ${path}, which the format does not name`);
    }
    if (folder === 'tests' && inner === 'package-lock.json') testsLock = content;
    else folders[folder as Folder][inner] = content;
  }
  const lock = stored.get('package-lock.json');
  verifyNpmAgainstLock(manifest.npm, lock, 'the agent');
  verifyNpmAgainstLock(manifest.tests?.npm ?? {}, testsLock, 'the tests');
  return {
    manifest,
    packageDigest: `sha256:${sha256Hex(manifestBytes)}`,
    contentDigest,
    fileDigest: `sha256:${sha256Hex(bytes)}`,
    spec,
    specName: specEntry[0],
    ...(contractBytes === undefined ? {} : { contract: contractBytes.toString('utf8') }),
    ...(lock === undefined ? {} : { lock }),
    ...(testsLock === undefined ? {} : { testsLock }),
    ...folders,
  };
}
