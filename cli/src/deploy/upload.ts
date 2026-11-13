// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  CernantoError,
  SPEC_SUFFIX,
  readCernPackage,
  specFileNameOf,
} from '@cernanto/package-format';

import type {
  CompileProgressResponse,
  CompileStepRecord,
  CompileRequest,
  PlaneCompileResponse,
  FleetAgentRowWire,
  TraceRecord,
} from '../gateway/types.gen.js';
import type { LandingAnswer } from './landing.js';
import {
  agentsRootOf,
  entriesOf,
  isNestedWorkspace,
  readOf,
  rootTaken,
  sha256Of,
  treePackagePath,
  treePackages,
  workspaceFolders,
} from './landing.js';

// The compiler's road: the specs upload through the plane's gateway, the
// plane's compiler converges them, the compile's narration is read off
// its document as it goes, and the packages the compile answered land
// beside their specs when the compile finishes. The compiler and its
// sessions run on the plane.

/** An upload larger than this is almost certainly not a spec
 * workspace; refuse before the wire does. Specs are small; the room
 * is for the files specs grant (`file:`), which ride the same upload. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** Packs the workspace for upload: every regular file of the
 * workspace's folders, relative path to base64. Specs and the files
 * they grant ride; anything vendored (node_modules, dot-caches) and a
 * workspace nested below this one do not. */
/** The contracts a JSON map file hands, agent id to the path of a
 * declaration file (relative to the map's own folder): each read as
 * `--contract` reads one, for several agents of one compile. */
export function handedContracts(
  mapFile: string,
  agentIds: readonly string[],
): Record<string, string> {
  const folder = dirname(resolve(mapFile));
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(mapFile, 'utf8'));
  } catch (error) {
    throw new CernantoError({
      kind: 'terminal',
      message: `--contracts: ${mapFile} is not a JSON map of agent id to declaration file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CernantoError({
      kind: 'terminal',
      message: `--contracts: ${mapFile} must hold an object of agent id to declaration file`,
    });
  }
  const out: Record<string, string> = {};
  for (const [agentId, file] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof file !== 'string') {
      throw new CernantoError({
        kind: 'terminal',
        message: `--contracts: ${agentId} names no file`,
      });
    }
    if (agentIds.length > 0 && !agentIds.includes(agentId)) {
      throw new CernantoError({
        kind: 'terminal',
        message: `--contracts names ${agentId}, which this compile does not target; name it among the targets`,
      });
    }
    out[agentId] = readFileSync(resolve(folder, file), 'utf8');
  }
  return out;
}

export function packWorkspace(agentsRoot: string): Record<string, string> {
  const files: Record<string, string> = {};
  let total = 0;
  const walk = (dir: string): void => {
    for (const entry of entriesOf(agentsRoot, dir)) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isNestedWorkspace(path, agentsRoot)) walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      // The size is asked of the file system first: a file past the
      // limit is refused before its bytes are read.
      total += readOf(agentsRoot, path, () => statSync(path).size);
      if (total > MAX_UPLOAD_BYTES) {
        throw new CernantoError({
          kind: 'terminal',
          message: `the workspace under ${agentsRoot} exceeds ${String(MAX_UPLOAD_BYTES / (1024 * 1024))}MB; a spec workspace holds specs and the files they grant, not the compiler's output: ${rootTaken(agentsRoot)}`,
        });
      }
      files[relative(agentsRoot, path).split('\\').join('/')] = readOf(agentsRoot, path, () =>
        readFileSync(path),
      ).toString('base64');
    }
  };
  if (!existsSync(agentsRoot)) {
    throw new CernantoError({ kind: 'terminal', message: `no workspace at ${agentsRoot}` });
  }
  for (const folder of workspaceFolders(agentsRoot)) {
    if (existsSync(folder)) walk(folder);
  }
  return files;
}

export interface PlaneCompileOptions {
  /** Run the live tier inside the compile: the plane deploys each
   * verified agent and runs its tester against its own gateway. */
  verify?: boolean;
  /** The whole road: the plane ships the compiled rows inside itself and
   * the run answers once they converged; off, the compile stops at the
   * packages. */
  deploy?: boolean;
  /** Skip the compatibility judgment and the anchor: the session
   * writes a new contract from the spec, and the dependents whose
   * pinned contract breaks recompile in the same run. */
  newContract?: boolean;
  /** Compile again from the spec: the previous compile, the package beside
   * the spec and the resume seed ignored. */
  recompile?: boolean;
  /** Dry run: stop after the change step of every target and answer the
   * plans alone. */
  dryRun?: boolean;
  /** Fail at the first failing test run, before any triage or fix. */
  failFast?: boolean;
  /** A contract per agent id (a declaration file's text) the compile
   * uses as it is, whatever the tree or the plane holds. */
  contracts?: Record<string, string>;
  /** The coding model and effort for this compile's sessions. */
  model?: string;
  effort?: string;
  /** A line the compile has to say beside its progress: an orphan
   * package, a package that did not verify. */
  onLine?: (line: string) => void;
  /** Called for every package written back beside its spec. */
  onPackageWritten?: (written: { agentId: string; path: string; digest: string }) => void;
  agentsRoot?: string;
  /** The compile's own id, the identity its progress records carry and
   * the plane's idempotency key; minted here when absent (a test, or a
   * re-run of the same compile, names one). */
  compileId?: string;
  /** Every step of the compile's narration as its document gains it. */
  onProgress?: (step: CompileStepRecord) => void;
  /** Called once the plane has stored the compile, with its handles: its
   * id, and the id of its call, which names no version yet and is what
   * a cancellation takes. */
  onSubmitted?: (handles: { compileId: string; callId: string }) => void;
  /** Called once the compiler has taken the compile, with the
   * compile's own call id: the id its records are filed under. */
  onTaken?: (callId: string) => void;
  /** Polling cadence for the narration; tests speed it up. */
  pollMs?: number;
  /** How long a read the gateway cannot answer is asked again for (two
   * minutes): the gateway rolling under its own ship, a substrate
   * hiccup. A compile the compiler has not taken yet is waited for
   * without this limit. */
  patienceMs?: number;
  /** Asked at every turn of the follow: an error ends the follow with
   * it, and the compile is the plane's from there. */
  halted?: () => Error | undefined;
}

/** The plane surface a compile needs; the gateway client satisfies it,
 * tests fake it. */
export interface CompileClient {
  /** Compiles the targets and stops at the packages; the run to follow. */
  compile(request: CompileRequest): Promise<{ callId: string }>;
  /** The whole road: the plane compiles, verifies when asked and ships
   * the rows inside itself; the run to follow. */
  deploy(request: CompileRequest): Promise<{ callId: string }>;
  /** A compile's narration and outcome off its document; `take` on an
   * ended compile removes the document as it is answered. */
  compileProgress(
    compileId: string,
    options?: { take?: boolean; call?: string },
  ): Promise<CompileProgressResponse>;
  /** Follows an agent's runs live; the callback sees each record and,
   * under `view: 'live'`, the lines the plane rendered it as; `onOpen`
   * hears the stream connect, `onEnd` hears it close, and the returned
   * function stops the watch. */
  callsStream(
    agentId: string,
    options: {
      backlog?: number;
      since?: string;
      view?: 'live';
      details?: boolean;
      debug?: boolean;
      onOpen?: () => void;
      onEnd?: (error?: unknown) => void;
    },
    onRecord: (record: TraceRecord, lines?: string[]) => void,
  ): () => void;
  /** Whether the plane holds a package of the digest. */
  packageExists(digest: string): Promise<boolean>;
  /** Puts a package's bytes on the plane under its digest. */
  packagePut(digest: string, bytes: Buffer): Promise<void>;
  /** Reads a package back by its digest. */
  packageGet(digest: string): Promise<Buffer>;
  /** Lands packages the plane holds into the fleet: one target, or
   * several as one landing. */
  land(body: {
    target?: string;
    targets?: string[];
    noDeps?: boolean;
    installed?: boolean;
  }): Promise<LandingAnswer>;
  /** The fleet's rows, with their verified stamps. */
  rows?(): Promise<FleetAgentRowWire[]>;
  /** Ends a call by its id: what stops a compile nobody waits for. */
  cancel?(callId: string): Promise<unknown>;
}

/** A target must be a spec under the workspace root before anything is
 * uploaded: `<id>.cern.md`. A typo or a renamed spec fails here, at
 * once, instead of as a compile that produced nothing. */
export function assertTargetsExist(agentsRoot: string, targets: string[]): void {
  for (const target of targets) {
    const dir = dirname(target);
    const name = specFileNameOf(basename(target));
    const candidate = dir === '.' ? name : join(dir, name);
    if (existsSync(join(agentsRoot, candidate))) continue;
    throw new CernantoError({
      kind: 'terminal',
      message: `no spec for "${target}" under ${agentsRoot} (looked for ${target}${SPEC_SUFFIX})`,
    });
  }
}

/** Asks again for as long as the patience lasts when the gateway cannot
 * answer (the gateway rolling under its own ship, a substrate
 * hiccup); the last refusal is the error past it. A refusal `final`
 * says the plane will not take back is the error at once. */
async function withPatience<T>(
  ask: () => Promise<T>,
  patienceMs: number,
  pollMs: number,
  final?: (error: unknown) => boolean,
): Promise<T> {
  const since = Date.now();
  for (;;) {
    try {
      return await ask();
    } catch (error) {
      if (final?.(error) === true || Date.now() - since >= patienceMs) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, Math.max(pollMs, 1000)));
    }
  }
}

/**
 * Compiles targets the one-surface way: the specs upload through the
 * gateway, the plane's compiler converges them, the compile's narration is
 * read off its document while it runs, and the packages the compile
 * answered land beside their specs when the compile finishes. Every
 * step reaches the caller once (deduplicated on attempt and sequence).
 */
export async function planeCompile(
  client: CompileClient,
  targets: string[],
  options: PlaneCompileOptions = {},
): Promise<PlaneCompileResponse> {
  const agentsRoot = options.agentsRoot ?? agentsRootOf();
  assertTargetsExist(agentsRoot, targets);
  const compileId = options.compileId ?? `compile-${randomBytes(8).toString('hex')}`;
  // The tree's own packages ride by digest: the plane seeds each
  // agent's compile from its package ahead of the fleet's row and
  // answers it current when nothing moved. Only bytes the store lacks
  // are uploaded.
  const tree = treePackages(agentsRoot);
  for (const orphan of tree.orphans) {
    options.onLine?.(
      `orphan package ${orphan}: no spec beside it; remove it or restore the spec\n`,
    );
  }
  const packages: Record<string, string> = {};
  for (const [agentId, entry] of Object.entries(tree.packages)) {
    if (!(await client.packageExists(entry.digest))) {
      await client.packagePut(entry.digest, readFileSync(entry.path));
    }
    packages[agentId] = entry.digest;
  }
  const request: CompileRequest = {
    protocol: 0,
    op: 'compile.run',
    compileId,
    targets,
    files: packWorkspace(agentsRoot),
    ...(Object.keys(packages).length === 0 ? {} : { packages }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    ...(options.verify === true ? { verify: true } : {}),
    ...(options.newContract === true ? { newContract: true } : {}),
    ...(options.recompile === true ? { recompile: true } : {}),
    ...(options.dryRun === true ? { planOnly: true } : {}),
    ...(options.failFast === true ? { maxLiveCycles: 0 } : {}),
    ...(options.contracts === undefined ? {} : { contracts: options.contracts }),
  };
  const pollMs = options.pollMs ?? 1000;
  const patienceMs = options.patienceMs ?? 120_000;
  // The verb is the operation: `deploy` ships inside the plane and the
  // run answers once the rows converged, `compile` stops at the
  // packages.
  const started =
    options.deploy === true ? await client.deploy(request) : await client.compile(request);
  options.onSubmitted?.({ compileId, callId: started.callId });
  // The narration: the compile writes its steps into its document as it
  // goes, and a light read of that document, repeated, is the deploy's
  // whole follow. A read the gateway cannot answer for a moment (the
  // gateway rolling under its own ship, a substrate hiccup) is asked
  // again for as long as the patience lasts. The compile is stored on
  // the plane from the gateway's answer on, and every read names the call
  // that answer named: until the compiler brings the compile to its
  // document the plane answers that it waits, which is waited out in
  // silence however long it takes. A read the plane refuses as
  // no compile, for a compile it accepted and no document was read of,
  // says the compile ended before it wrote anything: that refusal is
  // final, and the deploy ends in words.
  const taking = { taken: false };
  const gone = (error: unknown): boolean =>
    !taking.taken && error instanceof Error && error.message.includes(`no compile "${compileId}"`);
  //
  // The write-back: a package the compile answered lands beside its spec,
  // unless the tree already holds those bytes. Written whole under a
  // temporary name and renamed into place, so a killed deploy leaves the
  // tree's package whole; verified against the digest named before it
  // is kept.
  const kept = new Map<string, string>();
  // The packages the plane answered with other bytes than their digest
  // names: the tree keeps what it had, and the compile ends as a failure.
  const unverified = new Map<string, string>();
  const writeBack = async (agentId: string, named: string): Promise<void> => {
    // A dry run answers the plans alone and writes nothing: neither the
    // package an agent's end step names nor the row a deploy shipped.
    if (options.dryRun === true) return;
    if (tree.packages[agentId]?.digest === named || kept.get(agentId) === named) return;
    const target = treePackagePath(agentsRoot, agentId);
    if (target === undefined) return;
    // The same patience as the poll: the gateway may be rolling under the
    // gateway's own ship while the packages are fetched.
    const bytes = await withPatience(() => client.packageGet(named), patienceMs, pollMs);
    const digest = sha256Of(bytes);
    if (digest !== named) {
      unverified.set(agentId, `${digest} is not ${named}`);
      options.onLine?.(
        `the package of ${agentId} did not verify (${digest} is not ${named}); not written\n`,
      );
      return;
    }
    unverified.delete(agentId);
    // The same package under other bytes (re-serialized by the plane with
    // its manifest unchanged: the content, the pins and the stamp) is the
    // package the tree already holds: nothing is written; a moved pin or a
    // new stamp is another package and is written.
    if (existsSync(target) && sameContent(readFileSync(target), bytes)) {
      kept.set(agentId, named);
      return;
    }
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
    kept.set(agentId, named);
    options.onPackageWritten?.({ agentId, path: target, digest });
  };
  // As each agent ends: the agent's end step names its stamped package,
  // stored the moment the agent ended, so a compile cancelled or killed
  // later keeps what finished before it; a step without one (an older
  // compiler, a worker, an interface) falls back to the row a deploy
  // already shipped. The final answer writes whatever this missed.
  const keepAsLanded = async (agentId: string, stamped: string | undefined): Promise<void> => {
    try {
      if (stamped !== undefined) {
        await writeBack(agentId, stamped);
        return;
      }
      if (options.deploy !== true || client.rows === undefined) return;
      const rows = await client.rows();
      const row = rows.find((candidate) => candidate.agentId === agentId);
      if (row !== undefined) await writeBack(agentId, row.artifact);
    } catch (error) {
      options.onLine?.(
        `the package of ${agentId} is kept when the compile ends: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  };
  const seen = new Set<string>();
  let progress: CompileProgressResponse | undefined;
  for (;;) {
    const halt = options.halted?.();
    if (halt !== undefined) throw halt;
    try {
      progress = await withPatience(
        () => client.compileProgress(compileId, { call: started.callId }),
        patienceMs,
        pollMs,
        gone,
      );
    } catch (error) {
      if (!gone(error)) throw error;
      throw new CernantoError({
        kind: 'terminal',
        message:
          'the compile ended before it wrote anything: it was cancelled before a compiler took it, or its compiler stopped as it began',
      });
    }
    if (progress.status === 'waiting') {
      await new Promise((resolvePoll) => setTimeout(resolvePoll, pollMs));
      continue;
    }
    if (!taking.taken) {
      taking.taken = true;
      options.onTaken?.(progress.callId);
    }
    for (const step of progress.steps) {
      const key = JSON.stringify([step.attemptId, step.seq]);
      if (seen.has(key)) continue;
      seen.add(key);
      options.onProgress?.(step);
      // The agent's own end step carries its result; the compile's `done`
      // step is the whole compile's.
      if (
        step.step === 'agent' &&
        step.state === 'end' &&
        step.result === 'compiled' &&
        step.subject !== undefined
      ) {
        await keepAsLanded(step.subject, step.package);
      }
    }
    if (progress.status !== 'running') break;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, pollMs));
  }
  // A compile that ended with a report answers it, whatever its status
  // (the verbs read the failures off the report); one that ended with
  // no report failed in words.
  if (progress.answer === undefined) {
    // The deploy has read the final state: the document leaves with it.
    await client.compileProgress(compileId, { take: true }).catch(() => undefined);
    throw new CernantoError({
      kind: 'terminal',
      message: progress.error?.message ?? 'the compile ended without an answer',
    });
  }
  const response = progress.answer;
  // Every package the answer names that is not kept yet.
  for (const agent of response.agents) {
    if (agent.package === undefined) continue;
    if (agent.status !== 'compiled' && agent.status !== 'current') continue;
    await writeBack(agent.agentId, agent.package);
  }
  // A package that did not verify fails the compile while its document
  // is still on the plane: the digests the compile named stay readable
  // there.
  if (unverified.size > 0) {
    const named = [...unverified].map(([agentId, words]) => `${agentId} (${words})`);
    throw new CernantoError({
      kind: 'terminal',
      message: `the plane answered other bytes than the digest the compile named for ${named.join(', ')}; the tree keeps what it had. The compile itself ended ${response.status} on the plane, and its document stays there as compile ${compileId}: run the command again`,
    });
  }
  // The afterword's read: the document lives like an answer and leaves
  // once the deploy has read the final state and kept its packages.
  await client.compileProgress(compileId, { take: true }).catch(() => undefined);
  return response;
}

/** Whether two packages are the same package: their manifests' canonical
 * digests equal (the content, the pins, the stamp and the provenance with
 * it), whatever bytes serialize them. */
function sameContent(a: Buffer, b: Buffer): boolean {
  try {
    return readCernPackage(a).packageDigest === readCernPackage(b).packageDigest;
  } catch {
    return false;
  }
}
