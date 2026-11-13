// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';

import { handedContracts } from './upload.js';
import type { Command } from 'commander';

import { CernantoError, readCernPackage } from '@cernanto/package-format';
import type { CernPackage } from '@cernanto/package-format';

import { cardOfPackage } from '../card.js';
import { diagnosticsSummary } from '../diagnostics.js';
import { cardText } from '../card-view.js';
import type { CommandShell } from '../card-view.js';
import { ensureCoder } from '../dev.js';
import { currentPlane } from '../gateway-client.js';
import { commandShell, fail, outputOf } from '../output.js';
import { ServerClient } from '../server-client.js';
import { formatReport, writtenLines } from './afterword.js';
import { askWatcher } from './deploy.js';
import {
  agentsRootOf,
  assertWorkspace,
  expandFolders,
  packageCurrency,
  resolveAgentSelector,
  treePackages,
  workspaceAgentIds,
  workspaceSpecOf,
} from './landing.js';
import { watchedCompile } from './screen.js';

// `cernanto compile`: stage one of the pipeline. The compiler amends
// the package over the previous compile, gates it and writes it beside
// the spec, unverified, and stops before the ship; the compile ends on
// where each package landed and its card. A current package is
// reported and left alone unless `--recompile`. A `deploy` of the same
// spec after a `compile` reuses the compiled code: the compile cache is
// content-addressed, so the deploy re-gates the compiled bytes and goes
// straight to the live tests.

export interface CompileFlags {
  recompile?: boolean;
  dryRun?: boolean;
  /** False under `--no-ask`: nobody is here to log an account in. */
  ask?: boolean;
  contract?: string;
  contracts?: string;
  newContract?: boolean;
  quiet?: boolean;
  utc?: boolean;
  output?: string;
}

export async function compileAction(targets: string[], options: CompileFlags): Promise<void> {
  const json = outputOf(options).output === 'json';
  // The compile's own lines. Under `-o json` the output is the one
  // document, and the lines go to the error stream beside it.
  const write = (line: string): void => {
    if (json) process.stderr.write(line);
    else process.stdout.write(line);
  };
  const agentsRoot = agentsRootOf();
  assertWorkspace(agentsRoot);
  let agentIds = expandFolders(targets).map((target) => resolveAgentSelector(target));
  if (agentIds.length === 0) {
    agentIds = workspaceAgentIds(agentsRoot);
    if (agentIds.length === 0) {
      throw new Error(`no specs under ${agentsRoot}; write one and compile it`);
    }
  }
  for (const agentId of agentIds) {
    if (workspaceSpecOf(agentsRoot, agentId) === undefined) {
      throw new CernantoError({
        kind: 'terminal',
        message: `no spec for "${agentId}" under ${agentsRoot}; compile takes the workspace's own agents`,
      });
    }
  }
  let contracts: Record<string, string> | undefined;
  if (options.contract !== undefined) {
    const only = agentIds[0];
    if (agentIds.length !== 1 || only === undefined) {
      throw new CernantoError({
        kind: 'terminal',
        message: '--contract applies to exactly one agent; compile that agent alone',
      });
    }
    contracts = { [only]: readFileSync(options.contract, 'utf8') };
  }
  if (options.contracts !== undefined) {
    contracts = { ...contracts, ...handedContracts(options.contracts, agentIds) };
  }
  if (contracts !== undefined && options.newContract === true) {
    throw new CernantoError({
      kind: 'terminal',
      message:
        '--contract and --new-contract exclude each other: keep the given contract, or let the session write a new one',
    });
  }
  // A current package needs no compile: the first stage skips itself.
  const tree = treePackages(agentsRoot);
  const toCompile: string[] = [];
  for (const agentId of agentIds) {
    const currency = packageCurrency(agentsRoot, agentId, tree);
    if (
      currency.current &&
      options.recompile !== true &&
      options.dryRun !== true &&
      contracts === undefined &&
      options.newContract !== true
    ) {
      if (!json) {
        write(`${agentId} is current (${currency.digest.slice(0, 19)}...); nothing to compile\n`);
      }
      continue;
    }
    toCompile.push(agentId);
  }
  if (toCompile.length === 0) {
    if (json) process.stdout.write(`${JSON.stringify({ status: 'ok', agents: [] }, null, 2)}\n`);
    return;
  }
  await ensureCoder(currentPlane());
  const written: { agentId: string; path: string; digest: string }[] = [];
  const watched = await watchedCompile(new ServerClient(), toCompile, {
    verify: false,
    deploy: false,
    // Under `--no-ask` an account a compile asks for ends it at once.
    ...(options.ask === false ? { ...askWatcher(), noAsk: true } : {}),
    agentsRoot,
    ...(options.newContract === true ? { newContract: true } : {}),
    onPackageWritten: (entry) => {
      written.push(entry);
    },
    ...(options.quiet === undefined ? {} : { quiet: options.quiet }),
    ...(options.utc === undefined ? {} : { utc: options.utc }),
    ...(options.recompile === undefined ? {} : { recompile: options.recompile }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(contracts === undefined ? {} : { contracts }),
    write,
    json,
  });
  const report = watched.response;
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    write(formatReport(report));
    write(
      compileEnding(written, {
        agentsRoot,
        ...(options.quiet === undefined ? {} : { quiet: options.quiet }),
      }),
    );
    // The compile ends on its diagnostics when it has any, as a
    // compiler does: the size warning and the plan's spec issues, each
    // on its line, then their count.
    const summary = diagnosticsSummary(watched.diagnostics);
    if (summary !== '') write(`\n${summary}`);
  }
  if (report.status !== 'ok') process.exitCode = report.status === 'spec-gate-failure' ? 2 : 1;
}

/**
 * The ending of a compile, one for every package it wrote: where the
 * package landed (`wrote ops/.cern/greeter.cern`, the digest in the
 * log) and, beneath it, the card the package gets: `contract`'s
 * rendering read off the package and the workspace beside it, since
 * what an author compiles for is the contract. A package that does not
 * read ends on its wrote line.
 *
 * @param written - The packages written, each by path and digest.
 * @param options - The workspace the packages lie in, the log form and the shell.
 * @returns The lines, with their newlines; empty when nothing was written.
 * @example
 * write(compileEnding(written, { agentsRoot }));
 */
export function compileEnding(
  written: { path: string; digest: string }[],
  options: { agentsRoot: string; quiet?: boolean; shell?: CommandShell },
): string {
  let text = '';
  for (const entry of written) {
    text += writtenLines([entry], options.quiet !== true, '');
    let pkg: CernPackage;
    try {
      pkg = readCernPackage(readFileSync(entry.path));
    } catch {
      continue;
    }
    const card = cardOfPackage(pkg, {
      agentsRoot: options.agentsRoot,
      shell: options.shell ?? commandShell(),
    });
    text += `\n${cardText(card)}\n`;
  }
  return text;
}

export function registerCompile(program: Command): void {
  program
    .command('compile')
    .argument(
      '[agent-ids...]',
      'the agents to compile, by id, spec file or folder (none: the whole workspace)',
    )
    .option(
      '--recompile',
      'compile again from the spec: the package beside it, the previous compile and the resume seed ignored',
    )
    .option(
      '--dry-run',
      'read the change since the previous compile and stop: the plan of each agent is printed, nothing is written',
    )
    .option(
      '--contract <file>',
      "use this declaration file as the one agent's contract, whether or not a previous package or row exists, with no judgment",
    )
    .option(
      '--contracts <file>',
      'a JSON map of agent id to declaration file: the contract each named agent keeps, as --contract hands one',
    )
    .option(
      '--new-contract',
      'skip the compatibility judgment and the anchor: the session writes a new contract from the spec, and the dependents whose pinned contract breaks are recompiled in the same run',
    )
    .option(
      '--no-ask',
      'never wait for a login: when an agent asks for an account, end at once, name the login it needs and exit 3',
    )
    .option(
      '-q, --quiet',
      'the quiet form: what the compile read from each spec, a dot per record while it works, one verdict line per agent',
    )
    .option('--utc', 'times in utc instead of local time')
    .option('-o, --output <format>', 'table or json')
    .description('compile an agent and write its package beside the spec; nothing ships')
    .action(async (targets: string[], options: CompileFlags) => {
      try {
        await compileAction(targets, options);
      } catch (error) {
        fail(error);
      }
    });
}
