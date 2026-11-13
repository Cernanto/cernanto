// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A .cern package becomes the directory a process boots from, by one
// road for every agent: the coder's TypeScript stripped to JavaScript
// under `dist/`, the glue written beside it from the names the packages
// hold (the entry, the os module, the stubs of its dependencies, the
// binds of its interfaces, the assets module, the lane modules), the
// granted files under `assets/`, the exact npm closure installed from
// the package's lock, the release's runtime linked, the wiring the
// plane reads written last. The same road in tester form materializes
// the package's tester from the same bytes: the tests it carries as a
// task with one function `run`, which runs them in a child of the call,
// a stub of the agent under test naming the id the tests call, the
// stubs of what the tests were granted, the tests' own npm closure. The
// plane launches a tester under a compile's own id on the target's
// package digest with the form named in its facts, so the tester is
// derived from the very bytes it certifies.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { system } from '@cernanto/system';

import { LIBRARY_DIRS, zodOfRuntimeLib } from '../release-layout.js';

import {
  wireShapesOfSurface,
  declaredSurfaceOf,
  handlersOf,
  secretHandlersOf,
  wireParametersOf,
} from './declarations.js';
import type { WireParameters, WireShapes } from './declarations.js';
import type { DeclaredSurface } from './declarations.js';
import {
  assetsModule,
  bindModule,
  composedPackageNameOf,
  entryModule,
  linkedStubModule,
  linkedTableModule,
  osModule,
  refuseStubCollisions,
  stubFileName,
  suiteRunnerModule,
  testerTaskEntryModule,
  wireStubModule,
} from './glue.js';
import { installClosure } from './install.js';
import {
  isLocalMcpServer,
  lanesOf,
  mcpModuleSource,
  openApiModuleSource,
  openApiServerLanesOf,
  openApiServerModuleSource,
} from './lanes.js';
import { readPackage } from './manifest.js';
import type { AgentType, PackageTests, ReadPackage } from './manifest.js';
import { javaScriptNameOf, stripToJavaScript } from './strip.js';

/** What the glue needs of a dependency: its type, its handlers, the
 * hash of its contract and the contract itself (the declared surface a
 * module or an interface stub is written from). A package answers all
 * of them; a deployed row answers them without a package. */
export interface DependencyFacts {
  name: string;
  type: AgentType;
  handlers: string[];
  contractHash?: string | undefined;
  /** The earlier contracts this one is compatible with, as the compile
   * judged them (a function added, nothing a consumer holds moved): a
   * consumer pinned to one of them binds this contract as it is. */
  contractCompatibleWith?: string[] | undefined;
  contract?: string | undefined;
}

/** A package's facts as a dependency. */
export function factsOfPackage(pkg: ReadPackage): DependencyFacts {
  return {
    name: pkg.manifest.name,
    type: pkg.manifest.type,
    handlers: pkg.manifest.handlers,
    contractHash: pkg.manifest.contractHash,
    contractCompatibleWith: pkg.manifest.contractCompatibleWith,
    contract: pkg.contract,
  };
}

/** What the fleet's entry for a deployed agent says of it: an
 * interface's entry carries its contract as text (the contract is its
 * whole artifact); any entry may name the package it came from. */
export interface DeployedEntry {
  agentId: string;
  type?: AgentType | undefined;
  handlers?: string[] | undefined;
  artifact?: string | undefined;
  contract?: string | undefined;
  /** The earlier contracts the entry's contract is compatible with. */
  contractCompatibleWith?: string[] | undefined;
}

/** A deployed agent's facts from the fleet's entry for it: the
 * contract text the entry carries, else the package's `contract.d.ts`
 * fetched by the entry's artifact, else none (a stub needs the
 * handlers alone; an interface's bind is written from the contract);
 * and the earlier contracts the entry says it is compatible with, so a
 * consumer pinned to one of them binds it as it is, as the landing
 * admitted it. */
export async function deployedFacts(
  entry: DeployedEntry,
  fetchContract: (artifact: string) => Promise<string | null>,
): Promise<DependencyFacts> {
  let contract = entry.contract;
  if (contract === undefined && entry.artifact !== undefined) {
    const text = await fetchContract(entry.artifact);
    if (text !== null) contract = text;
  }
  return {
    name: entry.agentId,
    type: entry.type ?? 'service',
    handlers: entry.handlers ?? [],
    ...(contract === undefined
      ? {}
      : { contract, contractHash: createHash('sha256').update(contract).digest('hex') }),
    ...(entry.contractCompatibleWith === undefined || entry.contractCompatibleWith.length === 0
      ? {}
      : { contractCompatibleWith: entry.contractCompatibleWith }),
  };
}

/** Answers a dependency's facts by its agent id: the release's platform
 * packages, the store's deployed packages; undefined when none holds it. */
export type DependencyResolver = (agentId: string) => Promise<DependencyFacts | undefined>;

export interface MaterializePackageInput {
  /** The package's bytes, the `.cern` tar. */
  bytes: Buffer;
  /** The directory to materialize into: written whole, a present one
   * replaced. It is a process's own folder: what a directory holds
   * depends on its dependencies' contracts as well as on the package,
   * which makes it unfit for a cache keyed by the package alone. */
  into: string;
  /** The release, for the runtime and zod links. */
  releaseDir: string;
  /** The machine's closure store, when the generation may link its npm
   * closure instead of installing it in place (install.ts). */
  closures?: string | undefined;
  /** The package is a module placed inside a carrier's node_modules
   * (composedModuleDir): it runs on the carrier's runtime and gets no
   * links of its own. */
  composed?: boolean | undefined;
  /** The form: the package itself (absent) or its tester, the tests it
   * carries as a task with one function `run`, derived from the same
   * bytes. */
  form?: 'tester' | undefined;
  /** For the tester: the id the tests call, the target's test form
   * served apart, or, for a module target, the id the tester links the
   * module under (the module's test-form row, composed into the tester
   * under that id). Absent, the tests call the package's own id, and a
   * module target is linked under its own. */
  testOf?: string | undefined;
  dependency: DependencyResolver;
  /** The seam's agent the glue names: the custody agent a lane module
   * asks for its credentials. */
  seam: MaterializeSeam;
  env?: NodeJS.ProcessEnv | undefined;
  log?: ((line: string) => void) | undefined;
}

/** The agent of the seam the materialize names in what it writes. */
export interface MaterializeSeam {
  custody: string;
}

export interface MaterializedPackage {
  dir: string;
  agentId: string;
  type: AgentType;
  packageDigest: string;
}

/** A materialized tester: the task's id is the target's with the
 * suffix, the target and what the tests call named beside it. */
export interface MaterializedTester extends MaterializedPackage {
  targetId: string;
  /** The id the tests call, when the target is served apart. */
  testOf?: string | undefined;
  /** The ids the tests replace with mocks, sorted. */
  mocks: string[];
}

/** The suffix a tester's id carries after the id of the agent it tests. */
export const TESTER_SUFFIX = '-tester';

/** The tester's id for an agent: the agent's id with the suffix. */
export function testerIdOf(agentId: string): string {
  return `${agentId}${TESTER_SUFFIX}`;
}

/** A mocked contract's declared surface: read off its contract when
 * the facts carry one, else its handlers as async functions. */
export function surfaceOf(facts: DependencyFacts): DeclaredSurface {
  return facts.contract === undefined
    ? {
        functions: facts.handlers.map((name) => ({
          name,
          async: true,
          parameters: [],
          secret: false,
        })),
        constants: [],
      }
    : declaredSurfaceOf(facts.contract);
}

function testsOf(pkg: ReadPackage): PackageTests {
  return pkg.manifest.tests ?? { uses: [], npm: {}, mocks: [] };
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The file a package's own name for it lands at under a folder: the
 * name read against the folder, and refused when it leads anywhere
 * but inside it.
 * @param folder - The folder the file is written into.
 * @param name - The name the package gave the file.
 * @returns The file's path under the folder.
 * @example insideOf(dist, 'lib/format.js');
 */
export function insideOf(folder: string, name: string): string {
  const file = resolve(folder, name);
  const from = relative(resolve(folder), file);
  if (from === '' || from === '..' || from.startsWith(`..${sep}`) || isAbsolute(from)) {
    throw new Error(
      `the package names ${JSON.stringify(name)}, which lies outside the folder it is written into`,
    );
  }
  return file;
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function writeBytes(file: string, bytes: Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

/** A dependency's facts, or a refusal in words naming what could not be written without them. */
export async function resolveFacts(
  resolve: DependencyResolver,
  agentId: string,
  reason: string,
): Promise<DependencyFacts> {
  const facts = await resolve(agentId);
  if (facts === undefined) {
    throw new Error(
      `${agentId} is not deployed and not in the release: ${reason} cannot be written without its contract`,
    );
  }
  return facts;
}

/** Writes the coder's files as JavaScript under `dist/`. */
function writeCode(pkg: ReadPackage, dist: string): void {
  for (const [name, bytes] of Object.entries(pkg.code)) {
    const target = javaScriptNameOf(name);
    if (target === undefined) continue;
    if (target === name) {
      writeBytes(insideOf(dist, name), bytes);
      continue;
    }
    writeText(insideOf(dist, target), stripToJavaScript(bytes.toString('utf8'), name));
  }
}

function handlersOfDependency(facts: DependencyFacts): string[] {
  return facts.contract === undefined
    ? facts.handlers
    : handlersOf(declaredSurfaceOf(facts.contract));
}

/** The wire parameters a contract declares; none without a contract. */
export function wireParametersOfContract(contract: string | undefined): WireParameters {
  return contract === undefined ? {} : wireParametersOf(declaredSurfaceOf(contract));
}

/** The handlers a contract marks secret; none without a contract. */
export function secretHandlersOfContract(contract: string | undefined): string[] {
  return contract === undefined ? [] : secretHandlersOf(declaredSurfaceOf(contract));
}

/** Where a contract's handlers carry dates or bytes; none without a contract. */
export function wireShapesOfContract(contract: string | undefined): Record<string, WireShapes> {
  return contract === undefined ? {} : wireShapesOfSurface(declaredSurfaceOf(contract));
}

/** What a dependency's stub is: a linked module's (traced as itself),
 * an interface's bind, or the wire stub of a task, a service or a job. */
export type StubKind = 'linked' | 'bind' | 'wire';

/**
 * The stub a consumer imports for one dependency, written from the
 * dependency's facts: a module's linked stub and an interface's bind
 * from its contract, a wire stub from its handlers. The type is the
 * consumer's word (its manifest's use) when it has one, else the
 * dependency's own; the bind's sha is the consumer's pin when it has
 * one, else the dependency's current hash.
 */
export async function dependencyStubSource(
  agentId: string,
  type: AgentType | undefined,
  contractHash: string | undefined,
  resolve: DependencyResolver,
): Promise<{ kind: StubKind; source: string; facts: DependencyFacts }> {
  const facts = await resolveFacts(resolve, agentId, `the stub of ${agentId}`);
  // The consumer was compiled against the contract its pin names: a
  // dependency whose contract moved since is not written into it
  // afresh (the stub would be another contract's), it is refused in
  // words, and the consumer's own recompile follows the move; a
  // contract the compile judged compatible with the pinned one serves as
  // it stands, as the landing admits it.
  if (
    contractHash !== undefined &&
    facts.contractHash !== undefined &&
    contractHash !== facts.contractHash &&
    !(facts.contractCompatibleWith ?? []).includes(contractHash)
  ) {
    throw new Error(
      `${agentId}'s contract moved since this package was compiled: the package pins ${contractHash.slice(0, 12)}, the plane serves ${facts.contractHash.slice(0, 12)}; a deploy recompiles the consumer against it`,
    );
  }
  const kind = type ?? facts.type;
  if (kind === 'module') {
    if (facts.contract === undefined) {
      throw new Error(`${agentId} has no contract: the stub of a linked module is written from it`);
    }
    return {
      kind: 'linked',
      source: linkedStubModule(agentId, declaredSurfaceOf(facts.contract)),
      facts,
    };
  }
  if (kind === 'interface') {
    if (facts.contract === undefined) {
      throw new Error(`${agentId} has no contract: an interface's bind is written from it`);
    }
    const sha = contractHash ?? facts.contractHash ?? '';
    const surface = declaredSurfaceOf(facts.contract);
    return {
      kind: 'bind',
      source: bindModule(
        agentId,
        sha,
        handlersOf(surface),
        secretHandlersOf(surface),
        wireShapesOfSurface(surface),
        wireParametersOf(surface),
      ),
      facts,
    };
  }
  if (kind === 'worker') {
    throw new Error(`${agentId} is a worker: a worker is never a dependency`);
  }
  return {
    kind: 'wire',
    source: wireStubModule(
      agentId,
      handlersOfDependency(facts),
      secretHandlersOfContract(facts.contract),
      wireShapesOfContract(facts.contract),
      wireParametersOfContract(facts.contract),
    ),
    facts,
  };
}

/** Writes one dependency's stub at `dist/agents/<stub>.js`. */
export async function writeDependencyStub(
  dist: string,
  agentId: string,
  type: AgentType | undefined,
  contractHash: string | undefined,
  resolve: DependencyResolver,
): Promise<{ kind: StubKind; facts: DependencyFacts }> {
  const stub = await dependencyStubSource(agentId, type, contractHash, resolve);
  writeText(join(dist, 'agents', `${stubFileName(agentId)}.js`), stub.source);
  return { kind: stub.kind, facts: stub.facts };
}

/** Writes the glue the code imports: entry, os, stubs, binds, assets, lanes. */
async function writeGlue(
  pkg: ReadPackage,
  dist: string,
  resolve: DependencyResolver,
  seam: MaterializeSeam,
): Promise<{ links: string[]; uses: string[] }> {
  const { manifest } = pkg;
  const links: string[] = [];
  const uses = Object.keys(manifest.uses).sort();
  // Every stub is a file named from its agent's id: two ids that read
  // as one file are refused before either is written.
  refuseStubCollisions(uses);
  const os = osModule(manifest.type);
  if (os !== undefined) writeText(join(dist, 'os.js'), os);
  if (manifest.type !== 'interface') {
    writeText(
      join(dist, 'main.js'),
      entryModule(
        manifest.type,
        manifest.handlers,
        secretHandlersOfContract(pkg.contract),
        wireShapesOfContract(pkg.contract),
        wireParametersOfContract(pkg.contract),
      ),
    );
    // The table of the modules composed here: empty until the
    // generation's modules are placed and the composition finished.
    writeText(join(dist, 'linked.js'), linkedTableModule([]));
  }
  if (manifest.files.length > 0) writeText(join(dist, 'assets.js'), assetsModule(manifest.files));
  for (const agentId of uses) {
    const use = manifest.uses[agentId];
    if (use === undefined) continue;
    const written = await writeDependencyStub(dist, agentId, use.type, use.contractHash, resolve);
    if (written.kind === 'linked') links.push(agentId);
  }
  const lanes = lanesOf(pkg);
  const custodyStub = stubFileName(seam.custody);
  let needsAuth = false;
  for (const lane of lanes.openapi) {
    writeText(join(dist, 'openapi', `${lane.module}.js`), openApiModuleSource(lane, custodyStub));
    if (lane.secured) needsAuth = true;
  }
  // The server module of each implemented document, beside the client
  // lane modules: the agent's own listener serves the document through it.
  for (const lane of openApiServerLanesOf(pkg)) {
    writeText(join(dist, 'openapi', `${lane.module}.server.js`), openApiServerModuleSource(lane));
  }
  for (const lane of lanes.mcp) {
    writeText(join(dist, 'mcp', `${lane.module}.js`), mcpModuleSource(lane, custodyStub));
    // A remote server signs its account in through custody; a local
    // one runs with the environment its command carries.
    if (!isLocalMcpServer(lane.server)) needsAuth = true;
  }
  // A lane module reaches custody through the custody agent's stub:
  // written when a lane needs it and no grant already placed it.
  if (needsAuth && !uses.includes(seam.custody)) {
    refuseStubCollisions([...uses, seam.custody]);
    const facts = await resolveFacts(
      resolve,
      seam.custody,
      'the custody stub a lane module imports',
    );
    writeText(
      join(dist, 'agents', `${custodyStub}.js`),
      wireStubModule(
        seam.custody,
        handlersOfDependency(facts),
        secretHandlersOfContract(facts.contract),
        wireShapesOfContract(facts.contract),
        wireParametersOfContract(facts.contract),
      ),
    );
    uses.push(seam.custody);
  }
  return { links, uses };
}

/** Writes the tests the package carries as JavaScript under `dist/`:
 * every top-level `.ts` beside the entry, every `mocks/<name>.ts`
 * under `dist/mocks/`; declaration files and anything else skipped. */
function writeTests(pkg: ReadPackage, dist: string): void {
  for (const [name, bytes] of Object.entries(pkg.tests)) {
    const parts = name.split('/');
    const top = parts.length === 1;
    const mock = parts.length === 2 && parts[0] === 'mocks';
    if (!top && !mock) continue;
    const target = javaScriptNameOf(name);
    if (target === undefined) continue;
    if (target === name) {
      writeBytes(insideOf(dist, name), bytes);
      continue;
    }
    writeText(insideOf(dist, target), stripToJavaScript(bytes.toString('utf8'), name));
  }
}

/**
 * Writes the tester's granted files: every `tests/assets/<path>` of the
 * package lands under the tester's `assets/` beside `dist/`, and
 * `dist/assets.js` names their paths, as an agent's own granted files
 * reach it (the tests import the module and read the files with the
 * fs subset a file grant turns on). Answers the paths written.
 */
function writeTesterAssets(pkg: ReadPackage, staging: string, dist: string): string[] {
  const paths: string[] = [];
  for (const [name, bytes] of Object.entries(pkg.tests)) {
    if (!name.startsWith('assets/')) continue;
    const path = name.slice('assets/'.length);
    if (path === '') continue;
    writeBytes(insideOf(join(staging, 'assets'), path), bytes);
    paths.push(path);
  }
  if (paths.length > 0) writeText(join(dist, 'assets.js'), assetsModule(paths));
  return paths;
}

/**
 * Writes the tester's glue: the tests under `dist/` beside the task's
 * entry (`run`), the suite runner the task spawns, the os module, the
 * stub of the target (a wire stub naming `testOf` for a served target,
 * the linked stub for a module) and the stubs of what the tests were
 * granted; the mocked ids as wire-shaped dependencies (the mocks do
 * their work inside the test form; the tests import their types
 * alone). Answers the tester's wiring and the ids the tests mock.
 */
async function writeTesterGlue(
  pkg: ReadPackage,
  dist: string,
  resolve: DependencyResolver,
  testOf: string | undefined,
): Promise<{ wiring: Record<string, unknown>; mocks: string[]; linkedAs: string }> {
  const { manifest } = pkg;
  const target = manifest.name;
  const tests = testsOf(pkg);
  const mocked = sortedUnique(tests.mocks.map((mock) => mock.id));
  // The id the tester's own composition links a module target under.
  const linkedAs = manifest.type === 'module' ? (testOf ?? target) : target;
  refuseStubCollisions([target, ...tests.uses, ...mocked]);
  writeTests(pkg, dist);
  const os = osModule('task');
  if (os !== undefined) writeText(join(dist, 'os.js'), os);
  writeText(join(dist, 'main.js'), entryModule('task', ['run']));
  writeText(join(dist, 'index.js'), testerTaskEntryModule());
  writeText(join(dist, 'suite.js'), suiteRunnerModule());
  const links: string[] = [];
  const usesContracts: Record<string, string> = {};
  const own = factsOfPackage(pkg);
  if (manifest.type === 'module') {
    // The tests import the module by its own stub name; the stub
    // links whatever id the composition places the module under.
    const stub = await dependencyStubSource(linkedAs, 'module', manifest.contractHash, () =>
      Promise.resolve({ ...own, name: linkedAs }),
    );
    writeText(join(dist, 'agents', `${stubFileName(target)}.js`), stub.source);
    links.push(linkedAs);
  } else {
    // The tests import the target by its own stub name and call
    // whatever id serves its test form.
    writeText(
      join(dist, 'agents', `${stubFileName(target)}.js`),
      wireStubModule(
        testOf ?? target,
        manifest.handlers,
        secretHandlersOfContract(pkg.contract),
        wireShapesOfContract(pkg.contract),
        wireParametersOfContract(pkg.contract),
      ),
    );
  }
  if (manifest.contractHash !== undefined) usesContracts[linkedAs] = manifest.contractHash;
  for (const id of sortedUnique(tests.uses)) {
    if (id === target) continue;
    const granted = await writeDependencyStub(dist, id, undefined, undefined, resolve);
    if (granted.kind === 'linked') links.push(id);
    if (granted.facts.contractHash !== undefined) usesContracts[id] = granted.facts.contractHash;
  }
  for (const id of mocked) {
    if (id === target || tests.uses.includes(id)) continue;
    const facts = await resolveFacts(resolve, id, `the stub of the mocked ${id}`);
    const pin = tests.mocks.find((mock) => mock.id === id)?.contractHash;
    const stub = await writeDependencyStub(
      dist,
      id,
      facts.type === 'interface' ? 'interface' : 'task',
      pin,
      () => Promise.resolve(facts),
    );
    const hash = pin ?? stub.facts.contractHash;
    if (hash !== undefined) usesContracts[id] = hash;
  }
  const uses = sortedUnique([linkedAs, ...tests.uses, ...mocked]);
  const wiring = {
    agentId: testerIdOf(target),
    type: 'task',
    uses,
    ...(links.length === 0 ? {} : { links }),
    ...(Object.keys(usesContracts).length === 0 ? {} : { usesContracts }),
    entry: 'dist/main.js',
  };
  return { wiring, mocks: mocked, linkedAs };
}

function wiringOf(
  pkg: ReadPackage,
  links: readonly string[],
  uses: readonly string[],
): Record<string, unknown> {
  const { manifest } = pkg;
  const stamps = manifest.implements.filter((entry) => entry.contractSha !== undefined);
  const implemented = manifest.implements.find(
    (entry) => entry.id.startsWith('openapi:') && !/^openapi:https?:/.test(entry.id),
  );
  let openapi: Record<string, unknown> | undefined;
  if (implemented !== undefined) {
    const base = implemented.id.slice('openapi:'.length).replace(/\/$/, '');
    const name = base.slice(base.lastIndexOf('/') + 1);
    const bytes = pkg.files[name];
    if (bytes !== undefined) {
      openapi = {
        file: `assets/${name}`,
        sha256: sha256Hex(bytes),
      };
    }
  }
  const usesContracts: Record<string, string> = {};
  for (const id of [...uses].sort((a, b) => a.localeCompare(b))) {
    const hash = manifest.uses[id]?.contractHash;
    if (hash !== undefined) usesContracts[id] = hash;
  }
  return {
    agentId: manifest.name,
    type: manifest.type,
    ...(stamps.length === 0
      ? {}
      : { implements: stamps.map((entry) => ({ id: entry.id, contractSha: entry.contractSha })) }),
    ...(openapi === undefined ? {} : { openapi }),
    uses: [...uses],
    ...(links.length === 0 ? {} : { links: [...links] }),
    ...(Object.keys(usesContracts).length === 0 ? {} : { usesContracts }),
    ...(manifest.type === 'interface' ? {} : { entry: 'dist/main.js' }),
  };
}

/**
 * Materializes one package into the directory given, replacing what
 * was there, in the form asked: the package itself, or its tester
 * (`form: 'tester'`), a task derived from the same bytes. Answers the
 * directory; a failure mid-way removes it, so a process boots from a
 * whole directory or from none.
 */
export async function materializePackage(
  input: MaterializePackageInput & { form: 'tester' },
): Promise<MaterializedTester>;
export async function materializePackage(
  input: MaterializePackageInput,
): Promise<MaterializedPackage>;
export async function materializePackage(
  input: MaterializePackageInput,
): Promise<MaterializedPackage> {
  const log = input.log ?? ((): void => undefined);
  const pkg = readPackage(input.bytes);
  const { manifest } = pkg;
  const tester = input.form === 'tester';
  if (tester && (manifest.type === 'worker' || manifest.type === 'interface')) {
    throw new Error(
      `${manifest.name} is ${manifest.type === 'worker' ? 'a worker' : 'an interface'}: it has no tester`,
    );
  }
  const dir = input.into;
  mkdirSync(dirname(dir), { recursive: true });
  await rm(dir, { recursive: true, force: true });
  const staging = dir;
  let mocks: string[] = [];
  try {
    mkdirSync(staging, { recursive: true });
    const dist = join(staging, 'dist');
    mkdirSync(dist, { recursive: true });
    let wiring: Record<string, unknown>;
    if (tester) {
      const glue = await writeTesterGlue(pkg, dist, input.dependency, input.testOf);
      writeTesterAssets(pkg, staging, dist);
      wiring = glue.wiring;
      mocks = glue.mocks;
      await installClosure({
        directory: staging,
        packageName: composedPackageNameOf(testerIdOf(manifest.name)),
        npm: testsOf(pkg).npm,
        lock: pkg.testsLock,
        closures: input.closures,
        env: input.env,
        log,
      });
    } else {
      writeCode(pkg, dist);
      for (const [name, bytes] of Object.entries(pkg.files)) {
        writeBytes(insideOf(join(staging, 'assets'), name), bytes);
      }
      const { links, uses } = await writeGlue(pkg, dist, input.dependency, input.seam);
      if (pkg.contract !== undefined) {
        writeText(join(staging, 'contract.d.ts'), pkg.contract);
        writeText(join(staging, 'types', 'index.d.ts'), pkg.contract);
      }
      await installClosure({
        directory: staging,
        packageName: composedPackageNameOf(manifest.name),
        npm: manifest.npm,
        lock: pkg.lock,
        closures: input.closures,
        env: input.env,
        log,
      });
      wiring = wiringOf(pkg, links, uses);
    }
    writeText(join(staging, 'cernanto.json'), `${JSON.stringify(wiring, null, 2)}\n`);
    if (manifest.type !== 'interface' && input.composed !== true) {
      linkRuntime(staging, input.releaseDir);
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const where = `materialized from ${pkg.packageDigest.slice(0, 19)}... at ${relative(dirname(dir), dir)}`;
  if (!tester) {
    log(`${manifest.name}: ${where}`);
    return { dir, agentId: manifest.name, type: manifest.type, packageDigest: pkg.packageDigest };
  }
  const testOf = input.testOf;
  log(
    `the tester of ${manifest.name}: ${where}${testOf === undefined ? '' : `, its tests calling ${testOf}`}${mocks.length === 0 ? '' : ` (mocks: ${mocks.join(', ')})`}`,
  );
  const answer: MaterializedTester = {
    dir,
    agentId: testerIdOf(manifest.name),
    type: 'task',
    packageDigest: pkg.packageDigest,
    targetId: manifest.name,
    ...(testOf === undefined ? {} : { testOf }),
    mocks,
  };
  return answer;
}

/** The runtime a package resolves through the release: the runtime
 * library and zod beside it, linked into the directory's node_modules.
 * A module placed inside a carrier gets none: its imports resolve
 * upward to the carrier's one copy. A link already there is kept. */
export function linkRuntime(dir: string, releaseDir: string): void {
  const modules = join(dir, 'node_modules');
  mkdirSync(join(modules, '@cernanto'), { recursive: true });
  const runtimeLib = join(releaseDir, LIBRARY_DIRS['runtime-lib'] ?? 'runtime/lib');
  ensureLink(join(modules, '@cernanto', 'runtime-lib'), runtimeLib);
  ensureLink(join(modules, 'zod'), zodOfRuntimeLib(runtimeLib));
}

/** Points `link` at `target` when the target exists: a vendored copy (a
 * real directory) is left alone, a link already there is kept, and a
 * link elsewhere or dangling (`existsSync` reads false through it and
 * a fresh symlink would throw EEXIST on the entry that is there) is
 * replaced, the system's way (a symbolic link, or a junction). */
function ensureLink(link: string, target: string): void {
  if (!existsSync(target)) return;
  try {
    if (!lstatSync(link).isSymbolicLink()) return;
  } catch {
    // Nothing there yet.
  }
  system.linkFolder(target, link);
}

/**
 * Where a module composed into a carrier is placed: inside the
 * carrier's node_modules under its package name. Node resolves the
 * module's imports upward from a real path there and finds the other
 * modules placed beside it and the carrier's one runtime, so one
 * runtime lives in the process (a second instance has no execution
 * context: the module's wire calls would take the outside-any-
 * call road and its traces would go missing). A symlink into a
 * directory of the module's own would resolve to its real path outside
 * the carrier and see none of them; --preserve-symlinks would split
 * the runtime in two.
 */
export function composedModuleDir(carrierDir: string, agentId: string): string {
  return join(carrierDir, 'node_modules', composedPackageNameOf(agentId));
}

/**
 * Finishes a generation's composition once its modules are placed:
 * the table of the composed ids is written into the carrier's dist and
 * into each placed module's (a module binds an interface through its
 * own bind, which reads the table beside it). Nothing to finish
 * without modules: the empty table the materialize wrote stands.
 */
/** The conformance stamps a materialized package's wiring carries;
 * none when it carries none or cannot be read. */
function stampsOf(dir: string): { id: string; contractSha: string }[] {
  let wiring: unknown;
  try {
    wiring = JSON.parse(readFileSync(join(dir, 'cernanto.json'), 'utf8'));
  } catch {
    return [];
  }
  const listed = (wiring as { implements?: unknown }).implements;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((entry: unknown) => {
    const { id, contractSha } = (entry ?? {}) as { id?: unknown; contractSha?: unknown };
    return typeof id === 'string' && typeof contractSha === 'string' ? [{ id, contractSha }] : [];
  });
}

export function finishComposition(carrierDir: string, moduleIds: readonly string[]): void {
  if (moduleIds.length === 0) return;
  // What each placed module implements, as its own wiring says: a bind
  // answers in process only for an implementor of its interface.
  const stamps: Record<string, { id: string; contractSha: string }[]> = {};
  for (const id of moduleIds) stamps[id] = stampsOf(composedModuleDir(carrierDir, id));
  const table = linkedTableModule(moduleIds, stamps);
  writeText(join(carrierDir, 'dist', 'linked.js'), table);
  for (const id of moduleIds) {
    const dist = join(composedModuleDir(carrierDir, id), 'dist');
    if (existsSync(dist)) writeText(join(dist, 'linked.js'), table);
  }
}
