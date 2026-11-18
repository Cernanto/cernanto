// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { PACKAGE_SPEC_PATH } from './package.js';
import {
  PACKAGE_CODE_DIR,
  PACKAGE_CONTRACT_PATH,
  PACKAGE_FILES_DIR,
  PACKAGE_FOLDERS,
  PACKAGE_LOCK_PATH,
  PACKAGE_MANIFEST_PATH,
  PACKAGE_MCP_DIR,
  PACKAGE_OPENAPI_DIR,
  PACKAGE_SIGNATURE_PATH,
  PACKAGE_TESTS_DIR,
  canonicalJsonBytes,
  contentDigestOf,
  packageManifestSchema,
  parsePackageManifest,
  sha256DigestOf,
  sha256Hex,
} from './package.js';
import type { PackageManifest, PackageManifestDraft, PackageRecordEntry } from './package.js';
import { writeTar } from './tar.js';
import type { TarEntry } from './tar.js';
import { readTar } from './tar-reader.js';

// The .cern package file, format 4: one deterministic uncompressed tar
// carrying the manifest at the root, then npm's lock, the spec, the
// contract, and the content folders, each file recorded in the manifest
// by sha256 and size. Writing computes and verifies the record before a
// byte lands; reading verifies every file against it before anything is
// answered. A package that does not verify is refused whole.

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Bytes = Buffer | string;

function toBuffer(value: Bytes): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

/** A path inside the package: relative, forward slashes, no `.` or
 * `..` segment, no empty segment. */
export function assertPackagePath(path: string): void {
  expect(path !== '' && !path.startsWith('/'), `not a package-relative path: ${path}`);
  expect(!path.includes('\\'), `a package path uses forward slashes: ${path}`);
  for (const segment of path.split('/')) {
    expect(
      segment !== '' && segment !== '.' && segment !== '..',
      `not a package-relative path: ${path}`,
    );
  }
}

/** The content of one package, by folder; every map is keyed by the
 * path inside its folder. */
export interface PackageContent {
  spec: string;
  /** The exported surface; absent for a worker. */
  contract?: Bytes;
  /** npm's lock for the agent's closure; required when npm packages
   * are granted, refused otherwise. */
  lock?: Bytes;
  /** What the coder wrote. */
  code?: Readonly<Record<string, Bytes>>;
  /** What the tester wrote. */
  tests?: Readonly<Record<string, Bytes>>;
  /** The tester's own lock, when the tests grant npm packages. */
  testsLock?: Bytes;
  /** The author's `file:` grants. */
  files?: Readonly<Record<string, Bytes>>;
  /** The OpenAPI documents, keyed by the path the manifest names
   * without the folder. */
  openapi?: Readonly<Record<string, Bytes>>;
  /** The MCP listings, the same. */
  mcp?: Readonly<Record<string, Bytes>>;
  /** The reserved detached signature. */
  signature?: Bytes;
}

export interface CernPackageInput extends PackageContent {
  manifest: PackageManifestDraft;
}

/** The parsed, record-verified contents of a package file. */
export interface CernPackage {
  manifest: PackageManifest;
  /** The manifest bytes exactly as stored: what a signature signs. */
  manifestBytes: Buffer;
  /** sha256 of the stored manifest bytes: the package's identity. */
  packageDigest: string;
  /** sha256 over the record: the same content across compiles. */
  contentDigest: string;
  /** sha256 of the whole file: the storage and transport key. */
  fileDigest: string;
  spec: string;
  contract?: string;
  lock?: Buffer;
  code: Record<string, Buffer>;
  tests: Record<string, Buffer>;
  testsLock?: Buffer;
  files: Record<string, Buffer>;
  openapi: Record<string, Buffer>;
  mcp: Record<string, Buffer>;
  signature?: Buffer;
}

interface LockPackages {
  packages?: Record<string, { version?: string }>;
}

function resolvedVersions(lock: Buffer, where: string): Map<string, string> {
  let parsed: LockPackages;
  try {
    parsed = JSON.parse(lock.toString('utf8')) as LockPackages;
  } catch {
    throw new Error(`${where} is not a JSON lock file`);
  }
  const versions = new Map<string, string>();
  for (const [path, entry] of Object.entries(parsed.packages ?? {})) {
    if (
      path.startsWith('node_modules/') &&
      !path.slice('node_modules/'.length).includes('node_modules/')
    ) {
      if (typeof entry.version === 'string')
        versions.set(path.slice('node_modules/'.length), entry.version);
    }
  }
  return versions;
}

/** Every npm entry's recorded version must be the lock's resolved one:
 * the manifest is the compile's choice and the lock is its closure, and
 * the two must agree. */
function verifyNpmAgainstLock(
  npm: Readonly<Record<string, { version: string }>>,
  lock: Buffer | undefined,
  where: string,
): void {
  const names = Object.keys(npm);
  if (names.length === 0) {
    expect(lock === undefined, `${where}: a lock was given but no npm package is granted`);
    return;
  }
  expect(lock !== undefined, `${where}: npm packages are granted but no lock was given`);
  const versions = resolvedVersions(lock, where);
  for (const name of names) {
    const entry = npm[name];
    if (entry === undefined) continue;
    const resolved = versions.get(name);
    expect(
      resolved !== undefined,
      `${where}: the manifest records ${name}@${entry.version} but the lock does not resolve ${name}`,
    );
    expect(
      resolved === entry.version,
      `${where}: the manifest records ${name}@${entry.version} but the lock resolved ${resolved}`,
    );
  }
}

function sortedEntries(map: Readonly<Record<string, Bytes>> | undefined): [string, Buffer][] {
  return Object.entries(map ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => {
      assertPackagePath(path);
      return [path, toBuffer(content)];
    });
}

/**
 * Writes one package file. Deterministic: fixed entry order (the
 * manifest, the lock, the spec, the contract, then each folder's files
 * sorted), the canonical manifest serialization, the tar writer's
 * stable headers; the same inputs produce the same bytes on any
 * machine. The record and the content digest are computed here, and
 * every fact the manifest states about the content is verified before
 * a byte is written, so every package this function writes is true to
 * its manifest.
 */
export function writeCernPackage(input: CernPackageInput): Buffer {
  const draft = input.manifest;
  const spec = Buffer.from(input.spec, 'utf8');
  expect(
    sha256Hex(spec) === draft.specSha,
    `the spec's sha256 is not the manifest's specSha; the manifest was composed from another spec`,
  );
  const contract = input.contract === undefined ? undefined : toBuffer(input.contract);
  if (draft.contractHash === undefined) {
    expect(contract === undefined, 'a contract was given but the manifest records no contractHash');
  } else {
    expect(contract !== undefined, 'the manifest records a contractHash but no contract was given');
    expect(
      sha256Hex(contract) === draft.contractHash,
      "the contract's sha256 is not the manifest's contractHash",
    );
  }
  const lock = input.lock === undefined ? undefined : toBuffer(input.lock);
  verifyNpmAgainstLock(draft.npm, lock, 'the agent');
  const testsLock = input.testsLock === undefined ? undefined : toBuffer(input.testsLock);
  verifyNpmAgainstLock(draft.tests?.npm ?? {}, testsLock, 'the tests');
  const code = sortedEntries(input.code);
  const tests = sortedEntries(input.tests);
  expect(
    !tests.some(([path]) => path === PACKAGE_LOCK_PATH),
    `tests/${PACKAGE_LOCK_PATH} is the tester's lock; give it as testsLock`,
  );
  const files = sortedEntries(input.files);
  const openapi = sortedEntries(input.openapi);
  const mcp = sortedEntries(input.mcp);
  for (const [url, entry] of Object.entries(draft.openapi)) {
    expect(
      entry.file.startsWith(`${PACKAGE_OPENAPI_DIR}/`) &&
        openapi.some(([path]) => `${PACKAGE_OPENAPI_DIR}/${path}` === entry.file),
      `the manifest names ${entry.file} for ${url} but the package does not carry it`,
    );
  }
  for (const [url, entry] of Object.entries(draft.mcp)) {
    expect(
      entry.file.startsWith(`${PACKAGE_MCP_DIR}/`) &&
        mcp.some(([path]) => `${PACKAGE_MCP_DIR}/${path}` === entry.file),
      `the manifest names ${entry.file} for ${url} but the package does not carry it`,
    );
  }
  const content: [string, Buffer][] = [];
  if (lock !== undefined) content.push([PACKAGE_LOCK_PATH, lock]);
  content.push([PACKAGE_SPEC_PATH, spec]);
  if (contract !== undefined) content.push([PACKAGE_CONTRACT_PATH, contract]);
  for (const [path, bytes] of code) content.push([`${PACKAGE_CODE_DIR}/${path}`, bytes]);
  for (const [path, bytes] of tests) content.push([`${PACKAGE_TESTS_DIR}/${path}`, bytes]);
  if (testsLock !== undefined) {
    content.push([`${PACKAGE_TESTS_DIR}/${PACKAGE_LOCK_PATH}`, testsLock]);
  }
  for (const [path, bytes] of files) content.push([`${PACKAGE_FILES_DIR}/${path}`, bytes]);
  for (const [path, bytes] of openapi) content.push([`${PACKAGE_OPENAPI_DIR}/${path}`, bytes]);
  for (const [path, bytes] of mcp) content.push([`${PACKAGE_MCP_DIR}/${path}`, bytes]);
  const record: Record<string, PackageRecordEntry> = {};
  for (const [path, bytes] of content) {
    record[path] = { sha256: sha256Hex(bytes), size: bytes.length };
  }
  const manifest = packageManifestSchema.parse({
    ...draft,
    record,
    contentDigest: contentDigestOf(record),
  });
  const entries: TarEntry[] = [
    { path: PACKAGE_MANIFEST_PATH, kind: 'file', content: canonicalJsonBytes(manifest) },
    ...content.map(([path, bytes]): TarEntry => ({ path, kind: 'file', content: bytes })),
  ];
  if (input.signature !== undefined) {
    entries.push({
      path: PACKAGE_SIGNATURE_PATH,
      kind: 'file',
      content: toBuffer(input.signature),
    });
  }
  return writeTar(entries);
}

/**
 * Reads a package file: the manifest is parsed (an older format and
 * an unknown target refused by name), every file is placed by the
 * layout (a file the format does not name refuses the package), and
 * every content file is verified against the record, the record
 * against the content digest, the spec against its sha, the contract
 * against its hash and the npm entries against the lock, before
 * anything is answered.
 */
export function readCernPackage(bytes: Buffer): CernPackage {
  const stored = new Map<string, Buffer>();
  for (const entry of readTar(bytes)) {
    if (entry.kind === 'dir') continue;
    expect(entry.kind === 'file', `a package carries files only; ${entry.path} is not one`);
    stored.set(entry.path, entry.content ?? Buffer.alloc(0));
  }
  const manifestBytes = stored.get(PACKAGE_MANIFEST_PATH);
  if (manifestBytes === undefined) {
    expect(
      !stored.has('package.json'),
      'this package is format 3 (a package.json at its root) and this tool speaks 4; recompile the agent to repack it',
    );
    throw new Error(`not a cernanto package: no ${PACKAGE_MANIFEST_PATH} at the root`);
  }
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(manifestBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`${PACKAGE_MANIFEST_PATH} is not JSON; the package is corrupt`);
  }
  const manifest = parsePackageManifest(parsedManifest);
  stored.delete(PACKAGE_MANIFEST_PATH);
  const signature = stored.get(PACKAGE_SIGNATURE_PATH);
  stored.delete(PACKAGE_SIGNATURE_PATH);
  // Placement: every remaining file is a root file the format names
  // or lives under a folder it names.
  const code: Record<string, Buffer> = {};
  const tests: Record<string, Buffer> = {};
  const files: Record<string, Buffer> = {};
  const openapi: Record<string, Buffer> = {};
  const mcp: Record<string, Buffer> = {};
  let spec: string | undefined;
  let contract: string | undefined;
  let lock: Buffer | undefined;
  let testsLock: Buffer | undefined;
  for (const [path, content] of stored) {
    assertPackagePath(path);
    const slash = path.indexOf('/');
    if (slash === -1) {
      if (path === PACKAGE_SPEC_PATH) spec = content.toString('utf8');
      else if (path === PACKAGE_CONTRACT_PATH) contract = content.toString('utf8');
      else if (path === PACKAGE_LOCK_PATH) lock = content;
      else throw new Error(`the package carries ${path}, which the format does not name`);
      continue;
    }
    const folder = path.slice(0, slash);
    const inner = path.slice(slash + 1);
    expect(
      PACKAGE_FOLDERS.includes(folder),
      `the package carries ${path}, which the format does not name`,
    );
    if (folder === PACKAGE_CODE_DIR) code[inner] = content;
    else if (folder === PACKAGE_TESTS_DIR) {
      if (inner === PACKAGE_LOCK_PATH) testsLock = content;
      else tests[inner] = content;
    } else if (folder === PACKAGE_FILES_DIR) files[inner] = content;
    else if (folder === PACKAGE_OPENAPI_DIR) openapi[inner] = content;
    else mcp[inner] = content;
  }
  // The record: every content file in it, every entry present.
  for (const [path, content] of stored) {
    const entry = manifest.record[path];
    expect(
      entry !== undefined,
      `the package carries ${path} outside its record; the package is corrupt or edited`,
    );
    expect(
      entry.size === content.length && entry.sha256 === sha256Hex(content),
      `${path} does not match the record; the package is corrupt or edited`,
    );
  }
  for (const path of Object.keys(manifest.record)) {
    expect(stored.has(path), `the record names ${path} but the package does not carry it`);
  }
  expect(
    contentDigestOf(manifest.record) === manifest.contentDigest,
    'the content digest does not match the record; the package is corrupt or edited',
  );
  expect(spec !== undefined, `not a cernanto package: no ${PACKAGE_SPEC_PATH} at the root`);
  expect(
    sha256Hex(spec) === manifest.specSha,
    "the spec does not match the manifest's specSha; the package is corrupt or edited",
  );
  if (manifest.contractHash === undefined) {
    expect(
      contract === undefined,
      'the package carries a contract but the manifest records no contractHash',
    );
  } else {
    expect(
      contract !== undefined,
      'the manifest records a contractHash but the package carries no contract',
    );
    expect(
      sha256Hex(contract) === manifest.contractHash,
      "the contract does not match the manifest's contractHash; the package is corrupt or edited",
    );
  }
  verifyNpmAgainstLock(manifest.npm, lock, 'the agent');
  verifyNpmAgainstLock(manifest.tests?.npm ?? {}, testsLock, 'the tests');
  for (const [url, entry] of Object.entries(manifest.openapi)) {
    expect(
      stored.has(entry.file),
      `the manifest names ${entry.file} for ${url} but the package does not carry it`,
    );
  }
  for (const [url, entry] of Object.entries(manifest.mcp)) {
    expect(
      stored.has(entry.file),
      `the manifest names ${entry.file} for ${url} but the package does not carry it`,
    );
  }
  return {
    manifest,
    manifestBytes,
    packageDigest: sha256DigestOf(manifestBytes),
    contentDigest: manifest.contentDigest,
    fileDigest: sha256DigestOf(bytes),
    spec,
    ...(contract === undefined ? {} : { contract }),
    ...(lock === undefined ? {} : { lock }),
    code,
    tests,
    ...(testsLock === undefined ? {} : { testsLock }),
    files,
    openapi,
    mcp,
    ...(signature === undefined ? {} : { signature }),
  };
}

/**
 * A package with a version, and a publisher when one is given, stamped
 * into its manifest: the content and its digest stay, the package
 * digest and the file's become the stamped ones. A function of the
 * bytes and the stamp alone, so the same package stamped twice is the
 * same file on any machine.
 */
export function stampCernPackage(
  bytes: Buffer,
  stamp: { version: string; publisher?: string },
): Buffer {
  const pkg = readCernPackage(bytes);
  return writeCernPackage({
    manifest: {
      ...pkg.manifest,
      version: stamp.version,
      ...(stamp.publisher === undefined ? {} : { publisher: stamp.publisher }),
    },
    spec: pkg.spec,
    ...(pkg.contract === undefined ? {} : { contract: pkg.contract }),
    ...(pkg.lock === undefined ? {} : { lock: pkg.lock }),
    code: pkg.code,
    tests: pkg.tests,
    ...(pkg.testsLock === undefined ? {} : { testsLock: pkg.testsLock }),
    files: pkg.files,
    openapi: pkg.openapi,
    mcp: pkg.mcp,
    ...(pkg.signature === undefined ? {} : { signature: pkg.signature }),
  });
}

function isText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function section(path: string, bytes: Buffer): string {
  const body = isText(bytes)
    ? bytes.toString('utf8')
    : `<binary: ${String(bytes.length)} bytes, sha256 ${sha256Hex(bytes)}>\n`;
  return `==== ${path} ====\n${body}${body.endsWith('\n') ? '' : '\n'}`;
}

/**
 * The package as plain text, for a reader and for git's `textconv`:
 * a header, the manifest, the spec, the contract, then every content
 * file in the package's own order, binaries by size and sha. The
 * same package renders the same text everywhere.
 */
export function renderPackageText(pkg: CernPackage): string {
  const parts: string[] = [
    `cernanto package ${pkg.manifest.name} ${pkg.manifest.version} (${pkg.manifest.type})\n`,
    `package digest ${pkg.packageDigest}\ncontent digest ${pkg.contentDigest}\n\n`,
    section(PACKAGE_MANIFEST_PATH, pkg.manifestBytes),
    section(PACKAGE_SPEC_PATH, Buffer.from(pkg.spec, 'utf8')),
  ];
  if (pkg.contract !== undefined) {
    parts.push(section(PACKAGE_CONTRACT_PATH, Buffer.from(pkg.contract, 'utf8')));
  }
  const folders: [string, Record<string, Buffer>][] = [
    [PACKAGE_CODE_DIR, pkg.code],
    [PACKAGE_TESTS_DIR, pkg.tests],
    [PACKAGE_FILES_DIR, pkg.files],
    [PACKAGE_OPENAPI_DIR, pkg.openapi],
    [PACKAGE_MCP_DIR, pkg.mcp],
  ];
  for (const [folder, entries] of folders) {
    for (const [path, bytes] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
      parts.push(section(`${folder}/${path}`, bytes));
    }
  }
  if (pkg.testsLock !== undefined) {
    parts.push(section(`${PACKAGE_TESTS_DIR}/${PACKAGE_LOCK_PATH}`, pkg.testsLock));
  }
  if (pkg.lock !== undefined) parts.push(section(PACKAGE_LOCK_PATH, pkg.lock));
  return parts.join('');
}
