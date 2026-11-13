// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The materialize of a generation, in the process that will serve it:
// the block runs this once in the generation's working folder before
// it serves, handed the generation's facts and the plane's place. It
// fetches the generation's package and every module of its composition
// by digest from the warehouse, over the substrate, turns the
// package into a directory under `work/` with each module placed inside
// its node_modules, and answers what it derived. A generation whose
// facts carry no artifact is one of the plane's first processes (the
// host job's bring-up set): the artifact and the composition are derived
// from the release's packages, and the package is read from the release
// itself. The warehouse is asked for anything the release does not carry,
// as the machine's own ask (without a calling agent or a token).

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_SEAM } from '@cernanto/runtime-lib/serve';

import type { DerivedFacts, GenerationFacts } from '../generation.js';
import { readPackage } from './manifest.js';
import type { AgentType } from './manifest.js';
import { refuseComposedCollisions } from './glue.js';
import {
  composedModuleDir,
  deployedFacts,
  factsOfPackage,
  finishComposition,
  materializePackage,
} from './materialize-package.js';
import type { DependencyFacts } from './materialize-package.js';
import { blobDigestOf, compositionOf } from './platform.js';
import { releasePackages } from './release-packages.js';
import { applyTestForm } from './test-form.js';
import { FLEET_RECORD, LIBRARY_DIRS, PACKAGES_AGENT } from '../release-layout.js';

type MachineRoad = {
  setProcessFacts: (facts: { substrateUrl: string; callAddress?: string }) => void;
  machineCall: (agentId: string, handler: string, args: unknown) => Promise<unknown>;
  openSubstrate: () => Promise<{
    records: { read: (key: string) => Promise<{ value: string | null }> };
  }>;
  putDownSubstrate: () => Promise<void>;
};

/** What a generation's materialize is asked. */
export interface MaterializeGenerationAsk {
  /** The generation's facts, as the block reads them off the copy's
   * slot record, or as the release's own package gives them. */
  facts: GenerationFacts;
  /** The plane's place: the store's road. */
  substrateUrl: string;
  /** The address this machine's call servers bind, the host's private
   * address on a server (the loopback when absent): the store's answer
   * comes back there from whichever host's copy of the store took the
   * ask. */
  callAddress?: string | undefined;
  /** The release the generation boots from. */
  releaseDir: string;
  /** The generation's working folder: `work/agent` under it is where
   * the block boots from. */
  workingDir: string;
  /** The machine's closure store: a lock's npm closure installed once
   * and linked into every generation that carries the lock; nothing
   * installs in place. */
  closures?: string | undefined;
  /** Where the materialize's lines go. */
  log?: ((line: string) => void) | undefined;
}

function pause(ms: number): Promise<void> {
  return new Promise<void>((done) => {
    setTimeout(done, ms);
  });
}

function transient(error: unknown): boolean {
  const kind = (error as { kind?: unknown }).kind;
  return kind === 'retryable' || kind === 'target-unavailable';
}

/** How long an ask of the warehouse runs before the materialize says
 * it is still waiting, and again every such while: the words a reader
 * of the copy's error stream sees when a boot takes long. */
const ASK_PATIENCE_MS = 20_000;

interface RowWire {
  agentId: string;
  artifact?: string;
  type?: AgentType;
  handlers?: string[];
  /** The contract text the entry carries: an interface's whole artifact. */
  contract?: string;
  /** The earlier contracts this one is compatible with, as the compile
   * judged them and the landing wrote them on the row. */
  contractCompatibleWith?: string[];
}

/** Materializes a generation into its working folder and answers what
 * it derived for a generation that boots from the release (its
 * artifact and its composition), nothing for one whose facts name its
 * artifact. Throws in words when the package cannot be had or placed.
 * @example await materializeGeneration({ facts, substrateUrl, releaseDir, workingDir });
 */
export async function materializeGeneration(
  ask: MaterializeGenerationAsk,
): Promise<DerivedFacts | undefined> {
  const { facts, substrateUrl, callAddress, releaseDir, workingDir, closures } = ask;
  const say = ask.log ?? ((): void => undefined);
  const workDir = join(workingDir, 'work');
  const agentDir = join(workDir, 'agent');
  let releaseIndex: ReturnType<typeof releasePackages> | undefined;
  const releasedPackages = (): ReturnType<typeof releasePackages> => {
    releaseIndex ??= releasePackages(releaseDir);
    return releaseIndex;
  };
  // The deployer's first processes boot before any row exists, so their
  // facts name the agent alone and the rest is derived from the release's
  // packages: the release package's blob digest as the artifact, the
  // release's module closure as the composition.
  const agentId = facts.agentId;
  const bootsFromRelease = facts.artifact === undefined;
  let artifact: string;
  let composition: Record<string, string>;
  if (facts.artifact === undefined) {
    const seed = releasedPackages().get(agentId);
    if (seed === undefined) throw new Error(`the release carries no package for ${agentId}`);
    artifact = blobDigestOf(seed);
    composition = compositionOf(agentId, releasedPackages());
    say(
      `seed: ${agentId} from the release, artifact ${artifact.slice(0, 19)}..., ${String(Object.keys(composition).length)} modules`,
    );
  } else {
    artifact = facts.artifact;
    composition = facts.composition ?? {};
  }

  // The warehouse's road: a package the release does not carry is asked
  // of the warehouse (cernanto/packages) over the substrate, with no
  // calling agent, over a road of this materialize's own (the block's
  // own connection opens in its agent's name once it serves); a
  // deployed dependency's facts are read off the fleet, the controller's
  // record, through the same substrate. The warehouse may not serve
  // yet (the plane's own processes boot together and the retries do the
  // ordering): a call to a target nobody serves fails as transient and
  // is asked again, for a while.
  let road: MachineRoad | undefined;
  const machineRoad = async (): Promise<MachineRoad> => {
    if (road === undefined) {
      const serve = join(
        releaseDir,
        LIBRARY_DIRS['runtime-lib'] ?? 'runtime/lib',
        'dist',
        'serve.js',
      );
      road = (await import(pathToFileURL(serve).href)) as MachineRoad;
      road.setProcessFacts({
        substrateUrl,
        ...(callAddress === undefined ? {} : { callAddress }),
      });
    }
    return road;
  };
  const askWarehouse = async (handler: string, args: unknown): Promise<unknown> => {
    const { machineCall } = await machineRoad();
    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      const waiting = setInterval(() => {
        say(
          `${PACKAGES_AGENT}.${handler}: still waiting after ${String(Math.round((Date.now() - started) / 1000))} s (attempt ${String(attempt)})`,
        );
      }, ASK_PATIENCE_MS);
      try {
        return await machineCall(PACKAGES_AGENT, handler, args);
      } catch (error) {
        if (attempt >= 30 || !transient(error)) throw error;
        say(
          `${PACKAGES_AGENT}.${handler}: ${error instanceof Error ? error.message : String(error)}; retrying`,
        );
      } finally {
        clearInterval(waiting);
      }
      await pause(Math.min(2000 * attempt, 15_000));
    }
  };

  /** Reads one package's bytes from the warehouse, slice by slice, and
   * verifies them against the digest that names them. */
  const fetchBytes = async (digest: string): Promise<Buffer> => {
    const { manifest } = (await askWarehouse('packageManifest', digest)) as {
      manifest: { slices: number; bytes: number } | null;
    };
    if (manifest === null) throw new Error(`the plane holds no package ${digest}`);
    const parts: Buffer[] = [];
    for (let index = 0; index < manifest.slices; index += 1) {
      const { data } = (await askWarehouse('packageSlice', [digest, index])) as {
        data: string | null;
      };
      if (data === null)
        throw new Error(`the package ${digest} is missing its slice ${String(index)}`);
      parts.push(Buffer.from(data, 'base64'));
    }
    const bytes = Buffer.concat(parts);
    const sha = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (sha !== digest)
      throw new Error(
        `the package read as ${digest} hashes to ${sha}; the warehouse's slices are corrupt`,
      );
    return bytes;
  };

  /** A digest the release's own packages hold: read from the release,
   * so the platform's generations boot from the release with no
   * warehouse to ask. */
  const releasedBytes = (digest: string): Buffer | undefined => {
    for (const held of releasedPackages().values())
      if (blobDigestOf(held) === digest) return held.bytes;
    return undefined;
  };
  const fetched = new Map<string, Promise<Buffer>>();
  const bytesOf = (digest: string): Promise<Buffer> => {
    let pending = fetched.get(digest);
    if (pending === undefined) {
      const released = releasedBytes(digest);
      pending = released === undefined ? fetchBytes(digest) : Promise.resolve(released);
      fetched.set(digest, pending);
    }
    return pending;
  };
  const releasedFacts = (id: string): DependencyFacts | undefined => {
    const held = releasedPackages().get(id);
    return held === undefined ? undefined : factsOfPackage(held.pkg);
  };
  let rowsPending: Promise<RowWire[]> | undefined;
  /** The fleet's rows, the controller's record read off the plane's
   * records: a deployed dependency's type, its handlers and its package,
   * without the package itself. A plane that cannot be read (the
   * deployer's first processes boot before anything answers) reads as
   * no rows. */
  const fleetRows = (): Promise<RowWire[]> => {
    rowsPending ??= (async (): Promise<RowWire[]> => {
      try {
        const { openSubstrate } = await machineRoad();
        const { value } = await (await openSubstrate()).records.read(FLEET_RECORD);
        if (value === null) return [];
        const document = JSON.parse(value) as { agents?: RowWire[] };
        return document.agents ?? [];
      } catch {
        return [];
      }
    })();
    return rowsPending;
  };
  /** A dependency's facts: a composed module from its own package, a
   * deployed agent from the fleet's rows and its package's contract in
   * the warehouse, and, for the deployer's first processes that boot
   * before the fleet exists, a release agent from the release's
   * packages. */
  const factsOf = new Map<string, Promise<DependencyFacts | undefined>>();
  const dependencyFactsOf = async (id: string): Promise<DependencyFacts | undefined> => {
    const moduleDigest = composition[id];
    if (moduleDigest !== undefined) {
      const bytes = await bytesOf(moduleDigest);
      return factsOfPackage(readPackage(bytes));
    }
    if (bootsFromRelease) return releasedFacts(id);
    const row = (await fleetRows()).find((entry) => entry.agentId === id);
    if (row === undefined) return releasedFacts(id);
    return deployedFacts(row, async (digest) => {
      const { text } = (await askWarehouse('packageEntry', [digest, 'contract.d.ts'])) as {
        text: string | null;
      };
      return text;
    });
  };
  const dependencyFacts = (id: string): Promise<DependencyFacts | undefined> => {
    let found = factsOf.get(id);
    if (found === undefined) {
      found = dependencyFactsOf(id);
      factsOf.set(id, found);
    }
    return found;
  };
  const seam = { custody: DEFAULT_SEAM.custody.agent };
  /** Materializes one digest into a directory by the runtime's one
   * road; a module placed inside the carrier runs on the carrier's
   * runtime. Answers the directory. */
  const materializeInto = async (
    digest: string,
    into: string,
    composed = false,
  ): Promise<string> => {
    say(`fetching ${digest.slice(0, 19)}...`);
    const tar = await bytesOf(digest);
    const materialized = await materializePackage({
      bytes: tar,
      into,
      releaseDir,
      closures,
      composed,
      dependency: dependencyFacts,
      seam,
      log: say,
    });
    say(
      `${digest.slice(0, 19)}... materialized as ${materialized.agentId} (${String(tar.length)} bytes)`,
    );
    return materialized.dir;
  };

  try {
    // Each module is placed in a folder named from its id: two that read
    // as one folder are refused before anything is written.
    refuseComposedCollisions(Object.keys(composition));
    mkdirSync(workDir, { recursive: true });
    const ownBytes = await bytesOf(artifact);
    const ownPackage = readPackage(ownBytes);
    // The forms: the facts say which form the package takes. The tester
    // form is the package's tests as a task calling `testOf`; the test
    // form is the package itself with its mocks linked at every depth; a
    // module target's tester takes the test form as well, the mocks
    // applied to the tester's own composition.
    let ownDir: string;
    let testForm = false;
    if (facts.form === 'tester') {
      const tester = await materializePackage({
        bytes: ownBytes,
        into: agentDir,
        releaseDir,
        closures,
        form: 'tester',
        testOf: facts.testOf,
        dependency: dependencyFacts,
        seam,
        log: say,
      });
      say(
        `${agentId}: the tester of ${tester.targetId}${tester.testOf === undefined ? '' : `, its tests calling ${tester.testOf}`}${tester.mocks.length === 0 ? '' : ` (mocks: ${tester.mocks.join(', ')})`}`,
      );
      ownDir = tester.dir;
      testForm = ownPackage.manifest.type === 'module' && tester.mocks.length > 0;
    } else if (facts.form === 'test') {
      ownDir = await materializeInto(artifact, agentDir);
      testForm = true;
    } else {
      ownDir = await materializeInto(artifact, agentDir);
    }
    const mockedIds = new Set(
      testForm ? (ownPackage.manifest.tests?.mocks ?? []).map((mock) => mock.id) : [],
    );
    // The modules are placed side by side, as many at a time as the
    // machine has processors (each placement is an npm install of the
    // module's closure, one process of its own).
    const atOnce = Math.max(2, availableParallelism());
    const placements: [string, string][] = [];
    for (const [moduleId, digest] of Object.entries(composition)) {
      if (mockedIds.has(moduleId)) {
        say(`${moduleId}: mocked by the tests, left out of the composition`);
        continue;
      }
      placements.push([moduleId, digest]);
    }
    const placedDirs = new Map<string, string>();
    const queue = [...placements];
    await Promise.all(
      Array.from({ length: Math.min(atOnce, queue.length) }, async () => {
        for (;;) {
          const nextOne = queue.shift();
          if (nextOne === undefined) return;
          const [moduleId, digest] = nextOne;
          placedDirs.set(
            moduleId,
            await materializeInto(digest, composedModuleDir(ownDir, moduleId), true),
          );
        }
      }),
    );
    // The composition's own order, whatever order the placements ended in.
    const moduleDirs: Record<string, string> = {};
    for (const [moduleId] of placements) {
      const dir = placedDirs.get(moduleId);
      if (dir !== undefined) moduleDirs[moduleId] = dir;
    }
    if (testForm)
      await applyTestForm({
        pkg: ownPackage,
        dirs: { [agentId]: ownDir, ...moduleDirs },
        dependency: dependencyFacts,
        log: say,
      });
    const placed = Object.keys(moduleDirs);
    finishComposition(ownDir, placed);
    if (placed.length > 0) say(`composed ${String(placed.length)} modules`);
    say(`ready: ${agentId} at ${ownDir}`);
    return bootsFromRelease ? { artifact, composition } : undefined;
  } finally {
    // The road is put down, not closed for good: the block serves in
    // this same process next, over a connection of the agent's own.
    if (road !== undefined) await road.putDownSubstrate().catch(() => undefined);
  }
}
