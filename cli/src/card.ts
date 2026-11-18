// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { readCernPackage } from '@cernanto/package-format';
import type { CernPackage, PackageManifest } from '@cernanto/package-format';

import { readBuiltBy } from './built-view.js';
import { WORKSPACE_MARKER, treePackages } from './deploy/landing.js';
import type { CardInput, CommandShell } from './card-view.js';
import type { AuthListResult, FleetAgentRowWire } from './gateway/types.gen.js';
import { composedIntoOf, isTesterRow } from './fleet.js';
import { commandShell } from './output.js';

// The card's facts, gathered once for every road that prints a card:
// the deploy's ending, `contract <agent-id>`, `contract <file>.cern`
// and the compile's ending. A deployed agent is read off the plane:
// its row, the fleet's relations, the generations' compositions, the
// history's start and the safe's accounts. A package is read off its
// own manifest and the manifests of the packages beside it in the
// tree. The card view renders what is gathered, the same way for
// both.

/** One generation as the card reads it: whose it is, its number, its
 * phase and what it composes. */
export interface CardGeneration {
  agentId?: string;
  gen: number;
  status: string;
  composition?: Record<string, string>;
}

/** The plane surface a card is read from; the gateway client satisfies
 * it, the proofs fake it. What a plane cannot answer, or has no
 * function for, leaves its lines off the card. */
export interface CardPlane {
  /** The fleet's rows as shipped. */
  rows(): Promise<FleetAgentRowWire[]>;
  /** One agent as the plane describes it: its row and the contract its
   * card renders. */
  describe?(agentId: string): Promise<{ agent?: FleetAgentRowWire; contract?: string }>;
  /** The fleet's generations with their compositions. */
  generations?(): Promise<CardGeneration[]>;
  /** The agent's generations with their starts, newest first. */
  history?(agentId: string): Promise<{ at: string; status: string }[]>;
  /** The agent's accounts and the asks it is parked on. */
  auth?(agentId: string): Promise<AuthListResult>;
}

/** What the caller already read of the agent. */
export interface KnownAgent {
  row: FleetAgentRowWire;
  contract?: string;
}

/** How the card of a deployed agent is read. */
export interface PlaneCardOptions {
  /** The row as the caller holds it (a deploy's shipped row, the
   * `contract` verb's answer), with the contract when it read it: the
   * plane is asked to describe the agent only for what is missing. */
  known?: KnownAgent;
  /** The fleet as already read, so the card reads it once. */
  fleet?: FleetAgentRowWire[];
  /** The generations as already read. */
  generations?: CardGeneration[];
  /** True for the card a deploy ends on: the head says `deployed`
   * without the start the history would give (the deploy is the
   * start), the safe is not read for the accounts (the deploy handled
   * its asks), and the compiled-by and memory lines stay the `contract`
   * verb's (the log names the coder; the memory is the operator's fact). */
  afterDeploy?: boolean;
  /** The shell the `call it` line is pasted into; this machine's
   * when absent. */
  shell?: CommandShell;
}

/** A read of the plane that answers undefined for whatever the plane
 * cannot say, a function it lacks included. */
async function quietly<T>(read: () => Promise<T> | undefined): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** The lines of an agent's accounts and asks, one each, the values
 * withheld. */
function accountLines(listing: AuthListResult | undefined): string[] {
  if (listing === undefined) return [];
  return [
    ...listing.asks.map(
      (ask) =>
        `${ask.name} (${ask.provider}) waiting for ${ask.kind === 'fields' ? 'credentials' : ask.kind === 'oauth' ? 'authorization' : 'a pairing'}: cernanto auth login ${ask.agent} ${ask.name}`,
    ),
    ...listing.accounts.map(
      (account) =>
        `${account.name} (${account.provider}) logged in${account.loggedInAt === undefined ? '' : ` ${account.loggedInAt}`}${account.loggedInBy === undefined ? '' : ` by ${account.loggedInBy}`}`,
    ),
  ];
}

/**
 * The card of a deployed agent, read off the plane. The row is the one
 * the caller holds or the one the plane describes; the relations come
 * off the fleet (who uses it, the modules it links, an interface's
 * implementors), a module's carriers off the generations, the running
 * version's start off the history and the accounts off the safe. What
 * the plane cannot answer leaves its lines off. Undefined when no
 * contract can be read: the agent has no card.
 *
 * @param plane - The plane the agent runs on.
 * @param agentId - The agent, by id.
 * @param options - What is already known and what to leave unread.
 * @returns The card's input for the card view, or undefined.
 * @example
 * const card = await cardOnPlane(client, 'ops/greeter');
 */
export async function cardOnPlane(
  plane: CardPlane,
  agentId: string,
  options: PlaneCardOptions = {},
): Promise<CardInput | undefined> {
  let row = options.known?.row;
  let contract = options.known?.contract ?? row?.contract;
  if (plane.describe !== undefined && (row === undefined || contract === undefined)) {
    const described = await quietly(() => plane.describe?.(agentId));
    if (described !== undefined) {
      row ??= described.agent;
      contract ??= described.contract ?? described.agent?.contract;
    }
  }
  if (row === undefined || contract === undefined) return undefined;
  const fleet = options.fleet ?? (await quietly(() => plane.rows())) ?? [];
  // The relations: used by inverts the fleet's grants, wire and linked
  // alike (the agent's own tester left out), in the order a package's
  // card lists them; links are the direct modules the spec granted,
  // out of the row's carried closure.
  const usedBy = fleet
    .filter(
      (agent) =>
        !isTesterRow(agent.agentId) &&
        (agent.uses.includes(agentId) || (agent.links ?? []).includes(agentId)),
    )
    .map((agent) => agent.agentId)
    .sort();
  const links = row.links ?? [];
  const implemented = (row.implements ?? []).map((entry) => entry.id);
  const implementedBy =
    row.type === 'interface'
      ? fleet
          .filter((agent) => (agent.implements ?? []).some((entry) => entry.id === agentId))
          .map((agent) => agent.agentId)
          .sort()
      : undefined;
  // A module's card names the agents whose newest generation composes
  // it; generations that cannot be read leave the line off.
  const generations =
    row.type === 'module'
      ? (options.generations ?? (await quietly(() => plane.generations?.())))
      : undefined;
  const composedInto = generations === undefined ? undefined : composedIntoOf(generations, agentId);
  const deployedAt =
    options.afterDeploy === true
      ? undefined
      : await quietly(() => plane.history?.(agentId)).then(
          (entries) => entries?.find((entry) => entry.status === 'active')?.at ?? entries?.[0]?.at,
        );
  const accounts =
    options.afterDeploy === true ? [] : accountLines(await quietly(() => plane.auth?.(agentId)));
  const built = options.afterDeploy === true ? undefined : readBuiltBy(row.built);
  // A third party's row carries its package mark: the version and the
  // publisher the package states.
  const installed =
    row.package === undefined
      ? undefined
      : {
          ...(row.package.version === undefined ? {} : { version: row.package.version }),
          ...(row.package.publisher === undefined ? {} : { publisher: row.package.publisher }),
        };
  return {
    agentId,
    contract,
    handlers: row.handlers,
    shell: options.shell ?? commandShell(),
    ...(row.type === undefined ? {} : { type: row.type }),
    ...(implemented.length === 0 ? {} : { implements: implemented }),
    ...(implementedBy === undefined ? {} : { implementedBy }),
    ...(composedInto === undefined ? {} : { composedInto }),
    ...(row.uses.length === 0 ? {} : { uses: row.uses }),
    ...(links.length === 0 ? {} : { links }),
    ...(usedBy.length === 0 ? {} : { usedBy }),
    ...(row.verified === undefined ? {} : { verified: row.verified }),
    ...(installed === undefined ? {} : { installed }),
    ...(deployedAt === undefined ? {} : { deployedAt }),
    ...(built === undefined ? {} : { built }),
    ...(accounts.length === 0 ? {} : { accounts }),
  };
}

/** How the card of a package is read. */
export interface PackageCardOptions {
  /** The workspace whose packages say who uses and implements the
   * agent; absent, no relations are read. */
  agentsRoot?: string;
  /** The shell the `call it` line is pasted into; this machine's
   * when absent. */
  shell?: CommandShell;
  /** The head's state: `compiled`, a package in the tree, when absent;
   * `registry`, a package read off the registry. */
  state?: 'compiled' | 'registry';
}

/** The workspace a file lies in: the nearest directory above it that
 * holds the marker; undefined outside any workspace. */
export function workspaceRootOf(file: string): string | undefined {
  let dir = dirname(resolve(file));
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The manifests of the workspace's other packages, read off the
 * tree; a package that does not read is left out. */
function manifestsBeside(agentsRoot: string, agentId: string): PackageManifest[] {
  let packages: Record<string, { path: string }>;
  try {
    packages = treePackages(agentsRoot).packages;
  } catch {
    return [];
  }
  const manifests: PackageManifest[] = [];
  for (const [id, entry] of Object.entries(packages)) {
    if (id === agentId) continue;
    try {
      manifests.push(readCernPackage(readFileSync(entry.path)).manifest);
    } catch {
      // A package that does not read says nothing of its relations.
    }
  }
  return manifests;
}

/**
 * The card of a package, read off its own manifest and the packages
 * beside it: what it uses and implements, what compiled it, what it
 * needs, its verified stamp when it carries one, and off the
 * workspace's other manifests who uses it and, for an interface, who
 * implements it. A package without a contract reads with no handlers.
 *
 * @param pkg - The package, read and verified.
 * @param options - The workspace to read the relations from, and the shell.
 * @returns The card's input for the card view, in the compiled state.
 * @example
 * cardText(cardOfPackage(pkg, { agentsRoot }));
 */
export function cardOfPackage(pkg: CernPackage, options: PackageCardOptions = {}): CardInput {
  const { manifest } = pkg;
  const agentId = manifest.name;
  const uses = Object.keys(manifest.uses);
  const implemented = (manifest.implements ?? []).map((entry) => entry.id);
  const beside =
    options.agentsRoot === undefined ? [] : manifestsBeside(options.agentsRoot, agentId);
  const usedBy = beside
    .filter((other) => other.uses[agentId] !== undefined)
    .map((other) => other.name)
    .sort();
  const implementedBy =
    manifest.type === 'interface'
      ? beside
          .filter((other) => (other.implements ?? []).some((entry) => entry.id === agentId))
          .map((other) => other.name)
          .sort()
      : undefined;
  const { provenance } = manifest;
  const built = readBuiltBy({
    ...(provenance.harness === undefined ? {} : { harness: provenance.harness }),
    ...(provenance.cernanto === undefined ? {} : { cernanto: provenance.cernanto }),
    ...(provenance.doctrine === undefined ? {} : { doctrine: provenance.doctrine }),
  });
  return {
    agentId,
    contract: pkg.contract ?? '',
    state: options.state ?? 'compiled',
    type: manifest.type,
    handlers: manifest.handlers,
    shell: options.shell ?? commandShell(),
    ...(implemented.length === 0 ? {} : { implements: implemented }),
    ...(implementedBy === undefined ? {} : { implementedBy }),
    ...(uses.length === 0 ? {} : { uses }),
    ...(usedBy.length === 0 ? {} : { usedBy }),
    ...(provenance.verified === undefined ? {} : { verified: { at: provenance.verified.at } }),
    ...(built === undefined ? {} : { built }),
  };
}
