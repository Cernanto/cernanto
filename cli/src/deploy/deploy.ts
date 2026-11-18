// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { Command } from 'commander';

import {
  CernantoError,
  PACKAGE_EXTENSION,
  parsePackageRef,
  parseSpecLabels,
  readCernPackage,
  specFileNameOf,
} from '@cernanto/package-format';

import { accountOfWords, askWords, loginCommand, pendingAsks } from '../asks.js';
import { ensureCoder } from '../dev.js';
import { currentPlane } from '../gateway-client.js';
import type { PlaneCompileResponse } from '../gateway/types.gen.js';
import { fail, interactive, outputOf, shownPath } from '../output.js';
import {
  RegistryClient,
  fetchPackageToFile,
  registryEndpoints,
  resolvePackageRef,
} from '../registry.js';
import type { RegistryEndpoints } from '../registry.js';
import { diagnosticsSummary } from '../diagnostics.js';
import type { Diagnostic } from '../diagnostics.js';
import { ServerClient } from '../server-client.js';
import { terminalIo } from '../terminal.js';
import { followWorkerRun } from './follow.js';
import type { WorkerFollow } from './follow.js';
import {
  agentsRootOf,
  assertWorkspace,
  expandFolders,
  foreignPackagePath,
  isBareFileTarget,
  keepPulledPackages,
  landPackages,
  resolveAgentSelector,
  treePackages,
  workspaceAgentIds,
  workspaceSpecOf,
} from './landing.js';
import { afterShip, formatReport, workerNextStep, writtenLines } from './afterword.js';
import type { ShipPlane } from './afterword.js';
import type { LandingPlane } from './landing.js';
import { watchedCompile } from './screen.js';
import type { PendingAsk, WatchedCompileOptions } from './screen.js';
import { handedContracts } from './upload.js';
import type { CompileClient } from './upload.js';

// `cernanto deploy`: the whole pipeline, compile, verify, ship. A
// target whose package in the tree is current for its spec lands as
// it is; the rest goes to the compiler, which amends over the previous
// compile, gates, writes or reuses the tests, proves them live and ships.
// An id with no spec or package in the tree is looked up in the
// registry, a version always means the registry, a `.cern` file is
// that file. The verb may be left out for an existing spec or package
// file: `cernanto ops/greeter.cern.md` deploys it.

/** The flags `deploy` takes; the bare file form takes the same. */
export function deployOptions(command: Command): Command {
  return command
    .option(
      '--no-verify',
      'ship without running the tests on the plane; the deploy is compiled, not verified',
    )
    .option(
      '--follow',
      'follow a deployed worker live and exit when its program finishes (the run-once worker shape)',
    )
    .option(
      '-q, --quiet',
      'the quiet form: what the compile read from each spec, a dot per record while it works, one verdict line per agent',
    )
    .option('--utc', 'times in utc instead of local time')
    .option(
      '--recompile',
      'compile the named agents again from their specs (every agent when none is named): the package beside each, the previous compile and the resume seed ignored; a current dependency lands as it is',
    )
    .option(
      '--dry-run',
      'read the change since the previous compile and stop: the plan of each agent is printed, nothing is written, verified or shipped',
    )
    .option('--fail-fast', 'fail at the first failing test run, no triage and no fix')
    .option(
      '--no-ask',
      'never wait for a login: when an agent asks for an account, end at once, name the login it needs and exit 3',
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
      '--no-deps',
      'deploy a registry package even when a dependency cannot be resolved from the registry',
    )
    .option('-o, --output <format>', 'table or json');
}

export interface DeployFlags {
  verify?: boolean;
  follow?: boolean;
  quiet?: boolean;
  utc?: boolean;
  recompile?: boolean;
  dryRun?: boolean;
  failFast?: boolean;
  /** False under `--no-ask`: nobody is here to log an account in. */
  ask?: boolean;
  contract?: string;
  contracts?: string;
  newContract?: boolean;
  deps?: boolean;
  output?: string;
}

/** The inline answer for compile asks: on a real terminal the deploy
 * answers an agent's ask in place (the words name the agent and the
 * account); a pipe gets the command hint instead. */
function inlineAsk(): { onAsk?: (target: string) => Promise<void> } {
  if (!interactive()) return {};
  return {
    onAsk: async (target: string): Promise<void> => {
      await loginCommand(currentPlane(), accountOfWords(target), terminalIo(), {
        waitFirstMs: 30_000,
      });
    },
  };
}

/** The deploy's ask watcher: the accounts agents are parked on,
 * polled while the compile runs, so an ask raised by any agent (a
 * linked module inside the agent under test included) surfaces in
 * this terminal even when no followed trace stream carries it. */
export function askWatcher(): { pendingAsks: () => Promise<PendingAsk[]> } {
  return {
    pendingAsks: async (): Promise<PendingAsk[]> =>
      (await pendingAsks(currentPlane())).map((ask) => ({
        id: ask.id,
        kind: ask.kind,
        account: askWords(ask),
        agentId: ask.agent,
        name: ask.name,
        provider: ask.provider,
        requestedAt: ask.requestedAt,
        callId: ask.callId,
      })),
  };
}

/** What a deploy argument names: the author's own agent (a spec or a
 * package in the tree), a registry package (a version, or a name the
 * tree does not hold), or a `.cern` file. */
export function classifyTarget(
  argument: string,
  agentsRoot: string,
):
  | { kind: 'own'; agentId: string }
  | { kind: 'registry'; ref: string }
  | { kind: 'file'; path: string } {
  if (argument.endsWith('.cern')) return { kind: 'file', path: argument };
  if (argument.includes('@')) return { kind: 'registry', ref: argument };
  const agentId = resolveAgentSelector(argument);
  const tree = treePackages(agentsRoot);
  if (workspaceSpecOf(agentsRoot, agentId) !== undefined || tree.packages[agentId] !== undefined) {
    return { kind: 'own', agentId };
  }
  return parsePackageRef(agentId) === undefined
    ? { kind: 'own', agentId }
    : { kind: 'registry', ref: agentId };
}

/** An id with a spec in this workspace has one road, its spec: a
 * package of it from elsewhere would shadow the author's own agent. */
function refuseShadow(agentsRoot: string, agentId: string): void {
  if (workspaceSpecOf(agentsRoot, agentId) === undefined) return;
  throw new CernantoError({
    kind: 'terminal',
    message: `${agentId} already exists here as your local agent (its spec is in this workspace); deploy it from the spec: cernanto deploy ${agentId}`,
  });
}

/** The file a foreign package is kept in, free for it: a spec at the
 * root whose own package lives at that path keeps it, and the package
 * is refused in words. */
function foreignLanding(agentsRoot: string, agentId: string): string {
  const landing = foreignPackagePath(agentsRoot, agentId);
  const base = basename(landing, PACKAGE_EXTENSION);
  const candidate = join(agentsRoot, specFileNameOf(base));
  const owner = existsSync(candidate) ? candidate : undefined;
  if (owner !== undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: `${agentId} would be kept at ${shownPath(landing)}, where the package of your local agent ${shownPath(owner)} lives; rename that spec, then deploy ${agentId} again`,
    });
  }
  return landing;
}

/** The flags that hand a deploy to the compiler: each applies to an
 * agent compiled from its spec. */
function compilerFlags(options: DeployFlags): string[] {
  return [
    options.dryRun === true ? '--dry-run' : undefined,
    options.recompile === true ? '--recompile' : undefined,
    options.contract === undefined ? undefined : '--contract',
    options.newContract === true ? '--new-contract' : undefined,
  ].filter((flag): flag is string => flag !== undefined);
}

/** A registry package or a package file lands as it is: a flag that
 * asks the compiler for it is refused before anything is fetched or
 * written. */
function refuseCompilerFlagsOnPackages(
  classified: ReturnType<typeof classifyTarget>[],
  options: DeployFlags,
): void {
  const flags = compilerFlags(options);
  const packages = classified.flatMap((one) =>
    one.kind === 'registry' ? [one.ref] : one.kind === 'file' ? [one.path] : [],
  );
  if (flags.length === 0 || packages.length === 0) return;
  const one = packages.length === 1;
  throw new CernantoError({
    kind: 'terminal',
    message: `${flags.join(', ')} ${flags.length === 1 ? 'applies' : 'apply'} to an agent compiled from its spec; ${packages.join(', ')} ${one ? 'is a package and lands' : 'are packages and land'} as ${one ? 'it is' : 'they are'}: deploy ${one ? 'it' : 'them'} without ${flags.join(' or ')}`,
  });
}

/** The workers among agents the tree holds: by the `Type:` line the
 * spec states, else by the type the tree's package of the agent
 * states; a spec that states none and whose package is not in the
 * tree is not known to be one here. */
function workersAmong(agentsRoot: string, agentIds: string[]): string[] {
  const tree = treePackages(agentsRoot).packages;
  return agentIds.filter((agentId) => {
    const spec = workspaceSpecOf(agentsRoot, agentId);
    const stated =
      spec === undefined ? undefined : parseSpecLabels(readFileSync(spec, 'utf8')).type;
    if (stated !== undefined) return stated === 'worker';
    const held = tree[agentId];
    if (held === undefined) return false;
    try {
      return readCernPackage(readFileSync(held.path)).manifest.type === 'worker';
    } catch {
      return false;
    }
  });
}

/** Brings a registry package or a package file into the tree: the
 * root's `.cern/` folder, named after the agent, so it lands like the
 * tree's own and is committed like them. Answers the agent id. */
export async function fetchIntoTree(
  target: { kind: 'registry'; ref: string } | { kind: 'file'; path: string },
  agentsRoot: string,
  write: (line: string) => void,
  endpoints?: RegistryEndpoints,
): Promise<string> {
  if (target.kind === 'file') {
    const bytes = readFileSync(target.path);
    const pkg = readCernPackage(bytes);
    refuseShadow(agentsRoot, pkg.manifest.name);
    const landing = foreignLanding(agentsRoot, pkg.manifest.name);
    mkdirSync(dirname(landing), { recursive: true });
    writeFileSync(landing, bytes);
    write(
      `${pkg.manifest.name} ${pkg.manifest.version} from ${target.path}, kept at ${shownPath(landing)}\n`,
    );
    return pkg.manifest.name;
  }
  const registry = new RegistryClient(endpoints ?? (await registryEndpoints()));
  const picked = await resolvePackageRef(registry, target.ref);
  refuseShadow(agentsRoot, picked.name);
  const landing = foreignLanding(agentsRoot, picked.name);
  mkdirSync(dirname(landing), { recursive: true });
  await fetchPackageToFile(registry, picked, landing);
  write(
    `${target.ref.includes('@') ? '' : `no ${picked.name} in the tree; `}deploying ${picked.name}@${picked.version} from the registry, kept at ${shownPath(landing)}\n`,
  );
  if (picked.deprecated !== undefined) {
    write(`warning: ${picked.name} is deprecated: ${picked.deprecated}\n`);
  }
  return picked.name;
}

/** What a deploy asks of the plane: the compile, the landing, the
 * afterword's reads and a worker's follow. The plane's client answers
 * all of it; a proof hands its own. */
export type DeployPlane = CompileClient &
  LandingPlane &
  ShipPlane &
  Pick<ServerClient, 'callsStream' | 'call'> & {
    /** The fleet's generations, to tell a worker whose row the ship
     * did not roll; a plane without them reads every worker as rolled. */
    generations?(): Promise<{ agentId?: string; gen: number }[]>;
    /** The plane's settings, for the registry's hosts; a plane without
     * the function leaves them at the public registry's. */
    invoke?(agentId: string, fn: string, args: unknown): Promise<unknown>;
    /** Runs a worker's program again. */
    agentStart?(agentId: string): Promise<unknown>;
  };

/** Each agent's newest generation number, off the fleet; none when
 * the plane does not answer them. */
async function newestGenerations(plane: DeployPlane): Promise<Map<string, number> | undefined> {
  if (plane.generations === undefined) return undefined;
  try {
    const newest = new Map<string, number>();
    for (const generation of await plane.generations()) {
      if (generation.agentId === undefined) continue;
      newest.set(generation.agentId, Math.max(newest.get(generation.agentId) ?? 0, generation.gen));
    }
    return newest;
  } catch {
    return undefined;
  }
}

/** What a proof hands a deploy in place of the process's own: the
 * plane, the workspace root, the two streams, the coder guard and the
 * asks' terminal. */
export interface DeploySeams {
  client?: DeployPlane;
  agentsRoot?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  coder?: () => Promise<void>;
  asks?: Pick<WatchedCompileOptions, 'onAsk' | 'pendingAsks'>;
  /** What ends the process once every followed run has ended. */
  exit?: (code: number) => void;
}

/** The deploy itself, for the verb and for the bare file form. */
export async function deployAction(
  targets: string[],
  options: DeployFlags,
  seams: DeploySeams = {},
): Promise<void> {
  const json = outputOf(options).output === 'json';
  const stdout = seams.stdout ?? ((text: string): void => void process.stdout.write(text));
  const stderr = seams.stderr ?? ((text: string): void => void process.stderr.write(text));
  // The deploy's own lines. Under `-o json` the output is the one
  // document, and the lines go to the error stream beside it.
  const write = json ? stderr : stdout;
  const startedAt = Date.now();
  const agentsRoot = seams.agentsRoot ?? agentsRootOf();
  // A deploy reads the workspace and keeps what it pulls in it: a
  // folder that can be none is refused before either.
  assertWorkspace(agentsRoot);
  const classified = expandFolders(targets).map((target) => classifyTarget(target, agentsRoot));
  refuseCompilerFlagsOnPackages(classified, options);
  const client: DeployPlane = seams.client ?? new ServerClient();
  let agentIds: string[] = [];
  // The registry's hosts are the plane's settings, read once when a
  // target needs them.
  let endpoints: RegistryEndpoints | undefined;
  for (const one of classified) {
    if (one.kind === 'own') {
      agentIds.push(one.agentId);
      continue;
    }
    endpoints ??= await registryEndpoints(client);
    agentIds.push(await fetchIntoTree(one, agentsRoot, write, endpoints));
  }
  // The agents the deploy was asked for by name: a deploy with no
  // target names none.
  const named = [...new Set(agentIds)];
  if (agentIds.length === 0) {
    // No ids: the whole workspace, in the plane's order. On a fresh
    // plane every unchanged package lands as it is.
    agentIds = workspaceAgentIds(agentsRoot);
    if (agentIds.length === 0) {
      throw new Error(`no specs under ${agentsRoot}; write one and deploy it`);
    }
  }
  // The contract names one agent: the deploy's only target. Read here,
  // on the operator's machine; the plane receives its text.
  let contracts: Record<string, string> | undefined;
  if (options.contract !== undefined) {
    const only = agentIds[0];
    if (agentIds.length !== 1 || only === undefined) {
      throw new CernantoError({
        kind: 'terminal',
        message: '--contract applies to exactly one agent; deploy that agent alone',
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
  // --follow: the run-once/inline worker shape. A worker the deploy
  // names is followed from before the ship, so its run's first record
  // is on the wire before the controller starts it; a worker the ship
  // brings along is followed from the deploy's own moment. The follows
  // stay silent while the deploy prints its own lines, then take over
  // until every followed run ends (a failed run exits 1). Ctrl-c
  // detaches: the run is the plane's and continues.
  /** Each agent's newest generation before the ship, under --follow. */
  let generationsBefore: Map<string, number> | undefined;
  const follows = new Map<string, WorkerFollow>();
  const follow = (agentId: string): WorkerFollow => {
    const open =
      follows.get(agentId) ??
      followWorkerRun(client, agentId, {
        write,
        silent: json,
        since: startedAt,
        ...(options.utc === true ? { utc: true } : {}),
      });
    follows.set(agentId, open);
    return open;
  };
  if (options.follow === true) {
    for (const agentId of workersAmong(agentsRoot, agentIds)) follow(agentId);
    await Promise.all([...follows.values()].map((open) => open.opened));
  }
  const stopFollows = (): void => {
    for (const open of follows.values()) open.stop();
  };
  /** Hands the terminal to the follows of the workers that shipped,
   * until each run ends; a follow of an agent that did not ship stops. */
  const followShipped = async (shipped: string[]): Promise<void> => {
    if (options.follow !== true) return;
    for (const [agentId, open] of follows) {
      if (!shipped.includes(agentId)) open.stop();
    }
    const followed = shipped.map((agentId) => follow(agentId));
    if (followed.length === 0) {
      write('nothing to follow: no worker was deployed\n');
      return;
    }
    await Promise.all(followed.map((open) => open.opened));
    const detach = (): void => {
      for (const open of followed) open.stop();
      if (!json) {
        write('\ndetached: the program continues on the plane\n');
        for (const open of followed) {
          write(
            `  follow it: cernanto trace ${open.agentId} -f   stop and remove it: cernanto delete ${open.agentId}\n`,
          );
        }
      }
      process.exit(0);
    };
    process.once('SIGINT', detach);
    for (const open of followed) open.go();
    const outcomes = await Promise.all(followed.map((open) => open.done));
    process.removeListener('SIGINT', detach);
    if (outcomes.some((outcome) => outcome.outcome === 'failed')) process.exitCode = 1;
    // The runs ended and the deploy's words are out: the process ends
    // here, as a trace's follow does, whatever watch still holds the
    // loop.
    (seams.exit ?? process.exit)(process.exitCode === undefined ? 0 : Number(process.exitCode));
  };
  const written: { agentId: string; path: string; digest: string }[] = [];
  /** The tests each compiled agent passed, off the compile's screen, for its card. */
  let testsByAgent: Record<string, number> = {};
  /** The diagnostics the deploy ends on: the size warning and the
   * plan's spec issues. */
  let diagnostics: Diagnostic[] = [];
  const compileOptions = {
    // An ask is answered in this terminal, or named with its command on
    // a pipe; under `--no-ask` it ends the deploy, and nothing waits.
    ...(seams.asks ?? (options.ask === false ? askWatcher() : { ...inlineAsk(), ...askWatcher() })),
    ...(options.ask === false ? { noAsk: true } : {}),
    agentsRoot,
    verify: options.verify !== false,
    deploy: true,
    ...(options.newContract === true ? { newContract: true } : {}),
    onPackageWritten: (entry: { agentId: string; path: string; digest: string }) => {
      written.push(entry);
    },
    ...(options.quiet === undefined ? {} : { quiet: options.quiet }),
    ...(options.utc === undefined ? {} : { utc: options.utc }),
    ...(options.recompile === undefined ? {} : { recompile: options.recompile }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.failFast === undefined ? {} : { failFast: options.failFast }),
    ...(contracts === undefined ? {} : { contracts }),
    write,
    json,
  };
  try {
    // The road: a target whose package in the tree is current for its
    // spec lands as it is, with its current workspace dependencies,
    // through the plane's landing; the rest is the compiler's. A dry run,
    // a recompile, a given contract and a new contract are the compiler's
    // business whole.
    // The fleet before the ship tells whether a named worker rolled.
    if (workersAmong(agentsRoot, named).length > 0) {
      generationsBefore = await newestGenerations(client);
    }
    const landing =
      options.dryRun === true ||
      options.recompile === true ||
      contracts !== undefined ||
      options.newContract === true
        ? {
            landed: [],
            toCompile: agentIds.map((agentId) => ({ agentId, reason: '' })),
          }
        : await landPackages(client, agentIds, {
            agentsRoot,
            verify: options.verify !== false,
            ...(options.deps === false ? { noDeps: true } : {}),
            // The log explains a first compile ("no package in the tree;
            // compiling it") and names each landed package with its
            // version and digest; the quiet form's `compiling` line and
            // its `landed N packages` line say what the author needs.
            onLine: (line: string) => {
              if (
                options.quiet === true &&
                !json &&
                /(: no package in the tree; compiling it|^landed \S+ \S+ \(sha256:[0-9a-f]+\.\.\.\))\n$/.test(
                  line,
                )
              )
                return;
              write(line);
            },
          });
    const compileTargets = landing.toCompile.map((one) => one.agentId);
    // The named agents that landed as they were, in the order they
    // were named: each ends as a compiled one does. One that went on to
    // the compile is the compile's; a dependency that came along, and every
    // agent of a deploy that named none, keeps its landed line.
    const landedIds = new Set(landing.landed.map((landed) => landed.agentId));
    const landedTargets = named.filter(
      (agentId) => landedIds.has(agentId) && !compileTargets.includes(agentId),
    );
    let report: PlaneCompileResponse | undefined;
    if (compileTargets.length === 0) {
      if (json) {
        stdout(
          `${JSON.stringify({ status: 'ok', landed: landing.landed, agents: [] }, null, 2)}\n`,
        );
      } else {
        write(
          `landed ${String(landing.landed.length)} package${landing.landed.length === 1 ? '' : 's'}; nothing to compile
`,
        );
      }
    } else {
      await (seams.coder ?? ((): Promise<void> => ensureCoder(currentPlane())))();
      const watched = await watchedCompile(client, compileTargets, compileOptions);
      report = watched.response;
      testsByAgent = watched.tests;
      diagnostics = watched.diagnostics;
      if (json) {
        stdout(
          `${JSON.stringify(landing.landed.length === 0 ? report : { ...report, landed: landing.landed }, null, 2)}\n`,
        );
      } else {
        write(formatReport(report));
        // The packages written back beside their specs: the tree is the
        // record, so the author commits them with the specs; the log
        // names them, the quiet form leaves it to the guide.
        if (options.quiet !== true) write(writtenLines(written, true, 'commit it with its spec'));
      }
      if (report.status !== 'ok') {
        stopFollows();
        // A compile that failed ends on its diagnostics: the spec issues
        // that stopped it.
        const refused = diagnosticsSummary(diagnostics);
        if (!json && refused !== '') write(`\n${refused}`);
        process.exitCode = report.status === 'spec-gate-failure' ? 2 : 1;
        return;
      }
      // A dry run ends at its plan, which the compile's log printed.
      if (options.dryRun === true) {
        stopFollows();
        return;
      }
      // An agent left waiting on the operator has not passed: the deploy
      // ships what was compiled (an `auth login` resumes the parked call) and
      // exits with a failure, because its tests did not run.
      if (report.agents.some((agent) => agent.verification === 'waiting')) {
        process.exitCode = 1;
      }
    }
    // The workers this deploy shipped: the ones that landed as they
    // were, and the ones the compile shipped.
    const workers =
      options.follow === true
        ? [
            ...new Set([
              ...workersAmong(
                agentsRoot,
                landing.landed.map((landed) => landed.agentId),
              ),
              ...(report?.rows ?? [])
                .filter((row) => row.type === 'worker')
                .map((row) => row.agentId),
            ]),
          ]
        : [];
    // A worker named in this deploy whose row the ship did not roll (an
    // unchanged package lands as it is) runs its program again: for a
    // program, deploy means run. A worker the ship brought along is
    // left as it is.
    const namedWorkers = workersAmong(agentsRoot, named).filter((agentId) =>
      landing.landed.some((landed) => landed.agentId === agentId),
    );
    if (namedWorkers.length > 0 && client.agentStart !== undefined) {
      const generationsAfter = await newestGenerations(client);
      for (const agentId of namedWorkers) {
        const rolled =
          generationsBefore === undefined ||
          generationsAfter === undefined ||
          (generationsAfter.get(agentId) ?? 0) > (generationsBefore.get(agentId) ?? 0);
        if (rolled) continue;
        write(`${agentId} is unchanged; running its program again\n`);
        await client.agentStart(agentId);
      }
    }
    // What the plane pulled from the registry for these agents is kept
    // in the workspace, as a package deployed from a file is.
    await keepPulledPackages(
      client,
      agentsRoot,
      [
        ...named,
        ...landing.landed.map((landed) => landed.agentId),
        ...(report?.rows ?? []).map((row) => row.agentId),
      ],
      write,
    );
    // One ending for everything the deploy shipped, compiled or landed.
    const { shipped, linkedOnly } = await afterShip(
      client,
      {
        agents: report?.agents ?? [],
        rows: report?.rows ?? [],
        ...(report?.shipped === undefined ? {} : { shipped: report.shipped }),
        landed: landedTargets,
      },
      {
        write,
        card: !json,
        follow: workers.length > 0,
        quiet: options.quiet === true,
        tests: testsByAgent,
      },
    );
    if (report !== undefined) {
      if (report.rows.length === 0 && linkedOnly === 0) {
        throw new Error(`no package was produced for "${compileTargets.join(', ')}"`);
      }
      if (shipped === 0) write('nothing joined the fleet\n');
    }
    // The deploy ends on its diagnostics when it has any, after the
    // cards, as a compiler does: each on its line, then their count.
    const summary = diagnosticsSummary(diagnostics);
    if (!json && summary !== '') write(`\n${summary}`);
    await followShipped(workers);
  } catch (error) {
    stopFollows();
    throw error;
  }
}

export function registerDeploy(program: Command): void {
  deployOptions(
    program
      .command('deploy')
      .argument(
        '[targets...]',
        'agents by id, spec file or folder (every spec under it), registry packages by name or name@version, .cern files (none: the whole workspace)',
      )
      .description('compile an agent from its spec, prove it live, and run it on the plane'),
  ).action(async (targets: string[], options: DeployFlags) => {
    try {
      await deployAction(targets, options);
    } catch (error) {
      fail(error);
    }
  });
}

/** The bare file form: `cernanto ops/greeter.cern.md` deploys the spec,
 * `cernanto ./x.cern` the package file. Registered as the default
 * command; any other word is left to the verbs. */
export function registerBareFileForm(program: Command, unknownVerb: (word: string) => never): void {
  deployOptions(
    program.command('file', { isDefault: true, hidden: true }).argument('[targets...]'),
  ).action(async (targets: string[], options: DeployFlags) => {
    try {
      const first = targets[0];
      if (first === undefined) {
        program.outputHelp();
        return;
      }
      for (const target of targets) {
        if (!isBareFileTarget(target)) unknownVerb(target);
      }
      await deployAction(targets, options);
    } catch (error) {
      fail(error);
    }
  });
}

export { workerNextStep };
