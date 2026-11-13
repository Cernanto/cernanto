// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';

import type { Command } from 'commander';

import { CernantoError, compareVersions, readCernPackage } from '@cernanto/package-format';
import type { CernPackage } from '@cernanto/package-format';

import { readSeams, readTarget, registryPackage } from './agent-package.js';
import type { ReadPlane, ReadSeams } from './agent-package.js';
import { cardOfPackage, cardOnPlane, workspaceRootOf } from './card.js';
import { cardLines, cardText } from './card-view.js';
import type { AgentRow } from './gateway/types.gen.js';
import { asNotDeployed, commandShell, fail, outputOf } from './output.js';
import type { OutputOptions } from './output.js';
import { registryLines } from './registry.js';
import type { RegistryClient } from './registry.js';

// `cernanto contract <agent-id | file.cern | name[@version]>`: the card
// of an agent. Its head says what the agent is and whether it was
// verified, its facts what it uses, who uses it and what compiled it,
// and each function says what it takes and answers and ends on the
// call to paste. A package's card carries the file's own facts
// beneath, and a registry package's card what the registry knows of
// it. The facts are gathered as every card's are, in the card module.

/** The card of a package file: the rendering a deployed agent gets,
 * read off the package and the workspace beside it (the head says
 * `compiled`; the functions end on the call to paste once it is
 * deployed), then the file's own facts, one line each. Throws when the
 * file does not read or does not verify against its own record. */
export function packageCard(
  pkg: CernPackage,
  agentsRoot?: string,
  extra: { state?: 'compiled' | 'registry'; lines?: string[] } = {},
): string {
  const { manifest } = pkg;
  const lines = cardLines(
    cardOfPackage(pkg, {
      ...(agentsRoot === undefined ? {} : { agentsRoot }),
      ...(extra.state === undefined ? {} : { state: extra.state }),
      shell: commandShell(),
    }),
  );
  lines.push('');
  lines.push(`version ${manifest.version}`);
  lines.push(`package digest ${pkg.packageDigest}`);
  lines.push(`content digest ${pkg.contentDigest}`);
  if (manifest.description !== undefined) lines.push(manifest.description);
  if (manifest.license !== undefined) lines.push(`license ${manifest.license}`);
  for (const notice of manifest.copyright ?? []) lines.push(`copyright ${notice}`);
  lines.push(...(extra.lines ?? []));
  const npm = Object.entries(manifest.npm).map(
    ([name, entry]) =>
      `${name}@${entry.version}${entry.grant === undefined ? '' : ` (asked as ${entry.grant})`}`,
  );
  if (npm.length > 0) lines.push(`npm ${npm.join(', ')}`);
  const documents = [...Object.keys(manifest.openapi), ...Object.keys(manifest.mcp)];
  if (documents.length > 0) lines.push(`documents ${documents.join(', ')}`);
  if (manifest.files.length > 0) lines.push(`files ${manifest.files.join(', ')}`);
  lines.push(`record verified: ${String(Object.keys(manifest.record).length)} files`);
  return `${lines.join('\n')}\n`;
}

/** `contract <file.cern>`: the package file, read and verified on
 * this machine; its card's relations off the workspace the file lies
 * in, when it lies in one. */
export function contractOfFile(file: string, options: OutputOptions): string {
  const pkg = readCernPackage(readFileSync(file));
  if (options.output === 'json') return `${JSON.stringify(pkg.manifest, null, 2)}\n`;
  return packageCard(pkg, workspaceRootOf(file));
}

/** `contract <agent-id>`: the deployed agent's card. With the
 * registry, an installed agent's card says when a newer version is
 * published. */
export async function contractOfAgent(
  client: ReadPlane,
  agentId: string,
  options: OutputOptions,
  registry?: Pick<RegistryClient, 'packageIndex'>,
): Promise<string> {
  let agent: AgentRow;
  let contract: string | undefined;
  try {
    const described = await client.describe(agentId);
    agent = described.agent;
    contract = described.contract ?? agent.contract;
  } catch (error) {
    throw asNotDeployed(error, agentId);
  }
  if (options.output === 'json') {
    const row = { ...agent, ...(contract === undefined ? {} : { contract }) };
    return `${JSON.stringify(row, null, 2)}\n`;
  }
  if (contract === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: `no recorded contract for "${agentId}"`,
    });
  }
  // The card: the row as the plane described it, its relations off
  // the fleet, the running version's start off the history and the
  // accounts off the safe; what the plane cannot answer leaves its
  // lines off rather than failing the read.
  const shell = commandShell();
  const card = await cardOnPlane(client, agentId, {
    known: { row: agent, contract },
    shell,
  });
  // An installed package's card says when the registry holds a newer
  // version: a quiet read of its index, nothing when it answers none.
  if (card?.installed?.version !== undefined && registry !== undefined) {
    const index = await registry.packageIndex(agentId).catch(() => undefined);
    if (index?.latest !== undefined && compareVersions(index.latest, card.installed.version) > 0) {
      card.installed.available = index.latest;
    }
  }
  return cardText(card ?? { agentId, contract, shell });
}

/** `contract <name[@version]>` for a package in the registry: its card
 * with the registry's facts beneath, or as json its manifest beside
 * the registry's index. */
export async function contractOfRegistry(
  registry: RegistryClient,
  ref: string,
  options: OutputOptions,
): Promise<string> {
  const { pkg, index, picked } = await registryPackage(registry, ref);
  if (options.output === 'json') {
    return `${JSON.stringify({ manifest: pkg.manifest, registry: index }, null, 2)}\n`;
  }
  return packageCard(pkg, undefined, {
    state: 'registry',
    lines: await registryLines(registry, index, picked.version),
  });
}

/** `contract <x>`: the card on whichever road the argument takes. */
export function contractTarget(
  target: string,
  options: OutputOptions,
  seams: ReadSeams,
): Promise<string> {
  return readTarget(target, seams, {
    file: (path) => contractOfFile(path, options),
    registry: (registry, ref) => contractOfRegistry(registry, ref, options),
    plane: async (plane, agentId) =>
      contractOfAgent(plane, agentId, options, await seams.registry()),
  });
}

export function registerContract(program: Command): void {
  program
    .command('contract')
    .argument(
      '<agent-id-or-package>',
      'an agent by id, a .cern package file, or a registry package by name or name@version',
    )
    .option(
      '-o, --output <format>',
      'text or json (the deployed agent, or the manifest of a package)',
    )
    .description(
      'what an agent does and how to call it: its functions, what it uses and who uses it',
    )
    .action(async (target: string, options: { output?: string }) => {
      try {
        process.stdout.write(await contractTarget(target, outputOf(options), readSeams()));
      } catch (error) {
        fail(error);
      }
    });
}
