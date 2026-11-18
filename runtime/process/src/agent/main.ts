// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The block, `cernanto-agent`: one command that takes a package and
// runs it, in one process. It finds its folder under the plane's root
// by the root's convention and the generation's name, materializes the
// package into the folder when the folder is not current for it (the
// package read, the glue written, `npm ci` from the lock, the runtime
// linked), imports the served definition from the folder and serves,
// until it is told to stop. A materialize that fails is a boot that
// fails: loud, in the copy's error stream.
//
//   cernanto-agent <generation> <copy> <attempt>   a copy on a plane; the record names the rest
//   cernanto-agent cernanto/host                   the host job, by the release's own package of it
//   cernanto-agent --detach <what to run>          the same, started as its own process
//   cernanto-agent --prepare <generation> <copy>   the folder laid out for a CRIU restore
//   cernanto-agent --stop [--grace <ms>]           the host's stop word: its host job stops every copy here, in order
//
// The block decides by itself what nobody is handed: the plane's
// place, the root (by where the block is installed), its
// release (four folders over its own folder, by the path it was invoked
// by), its folder. The host job, `cernanto-agent cernanto/host`, is the
// process a server's unit and a laptop's `cernanto dev` run, and the
// one agent the block runs with no record to name it: the block places
// its record and rings its `serve` itself, with the host named, for the
// life of the host, and the host job starts every other copy from the
// records, the controller among them.

import { execFile } from 'node:child_process';
import {
  chownSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { Definition } from '@cernanto/runtime-lib';
import {
  endRecorded,
  linkFolder,
  present,
  sample,
  wallElapsedMs,
} from '@cernanto/runtime-lib/machine';
import type { Recorded } from '@cernanto/runtime-lib/machine';
import type {
  CopyRead,
  Holding,
  ProcessFacts,
  ReadsOf,
  SendsOf,
} from '@cernanto/runtime-lib/serve';
import {
  COPY_ROADS,
  HOST_AGENT,
  HOST_PORT,
  SEAM,
  agentOfCopy,
  copiesOnHost,
  hostCall,
  processFacts,
  readHolding,
  setProcessFacts,
  updateRecord,
} from '@cernanto/runtime-lib/serve';

import { rootsAloneFolder } from '../agent-user.js';
import { parseGenerationFacts } from '../generation.js';
import type { DerivedFacts, GenerationFacts } from '../generation.js';
import { materializeGeneration } from '../materialize/generation.js';
import { stampsOf } from '../materialize/materialize-package.js';
import { blobDigestOf, releaseVersionOf } from '../materialize/platform.js';
import { releasePackages } from '../materialize/release-packages.js';
import { AGENT_BIN, materializerIdentity, releaseOfProgram } from '../release-layout.js';
import {
  asRoot,
  commandLineOf,
  freshAttempt,
  identityOf,
  machineRule,
  ownIdentity,
  placeHostJob,
  privileged,
  recordProcess,
  reserveAttempt,
  spawnDetached,
  issueGrant,
} from './launch.js';
import { errorFileOf, generationFolder, machineFacts, wordFileOf } from './place.js';
import { postWord, stopCopies, stopHostJob } from './stop.js';
import type { MachineFacts } from './place.js';

type ServeAgent = typeof import('@cernanto/runtime-lib/serve').serveAgent;
type OpenSubstrate = typeof import('@cernanto/runtime-lib/serve').openSubstrate;
type Invoke = typeof import('@cernanto/runtime-lib').invoke;

const execute = promisify(execFile);

/** How long a copy asks the plane again before it gives up: a
 * rebooted cluster waits for its peers. */
const PLANE_PATIENCE_MS = 600_000;
/** One ask of the plane, and the pause between asks. */
const ASK_PATIENCE_MS = 20_000;
const ASK_PAUSE_MS = 2_000;
/** How long the host's stop word may take to land before the stop is
 * refused in words. */
const WORD_PATIENCE_MS = 15_000;
/** How long past the grace a host job that took its stop word has to
 * be gone: its last resorts, and the moment its traces take to leave. */
const HOST_LEAVE_MS = 60_000;
/** The word of a copy's launch in the environment of every command the
 * copy runs: whoever ends the copy has what carries it ended. */
const LAUNCH_WORD = 'CERNANTO_PROCESS_GROUP_NONCE';
/** The pause before the host job's serve is rung again after it ended for
 * a reason that is not the host's end. */
const RING_PAUSE_MS = 5_000;

/** How long a materialize may run before the block gives up on it. */
const MATERIALIZE_PATIENCE_MS = 300_000;

/** How long the second copy of a folder waits for the first one's
 * materialize before it takes the folder over. */
const LOCK_PATIENCE_MS = 300_000;

/** The release this program lies in: four folders over its own
 * folder, by the path it was invoked by (an installed release reaches
 * the file through links, and the real file lies outside it). */
export function ownRelease(): string {
  const program = process.argv[1];
  return program !== undefined && program.endsWith('bin.js')
    ? releaseOfProgram(resolve(program))
    : resolve(import.meta.dirname, '..', '..', '..', '..');
}

function say(line: string): void {
  process.stderr.write(`cernanto-agent: ${line}\n`);
}

/** Asks the plane again while it does not answer: a server that
 * reboots has no store until its disk is up, and a copy that crashed on
 * that moment (the host job's bring-up set above all, whose controller
 * nobody starts again) would leave the plane with nobody to act for it.
 * Says once that it waits; gives up after the patience, in words. */
async function askingAgain<T>(what: string, ms: number, ask: () => Promise<T>): Promise<T> {
  const deadline = wallElapsedMs() + ms;
  let said = false;
  for (;;) {
    try {
      return await within(what, ASK_PATIENCE_MS, ask());
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (wallElapsedMs() > deadline)
        throw new Error(
          `${what} did not answer within ${String(Math.round(ms / 1000))} s: ${text}`,
        );
      if (!said) {
        say(`waiting for ${what}: ${text}`);
        said = true;
      }
      await pause(ASK_PAUSE_MS);
    }
  }
}

/** Waits for a promise within a patience, in words. */
async function within<T>(what: string, ms: number, pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${what} did not answer within ${String(Math.round(ms / 1000))} s`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** What the folder was materialized as: written after the materialize,
 * read before the next, so a boot of a complete folder writes nothing.
 * Another materialize writes other glue, so its identity is part of the
 * mark. */
interface MaterializedMark {
  artifact: string;
  composition: Record<string, string>;
  materializer: string;
  derived?: DerivedFacts | undefined;
  /** The machine as the block knows it, for the agent in the folder:
   * the host's name (the machine's, or the name a proof gave its
   * plane) and the settings a proof's plane starts with. An agent may
   * read no environment, no `/proc` file and
   * no hostname file, and runs no command before its first call, so
   * the host job learns its host here. */
  machine?:
    | {
        id: string;
        /** The plane's root, where the agents' folders are: the host
         * job's own folder lies in its home, which on a server is not
         * the root. */
        root?: string | undefined;
        /** The folder the plane's files live under (`plane.sqlite`, the
         * journals, the objects): the root on a laptop and a server, a
         * shared folder on a proof's tier of several hosts. */
        plane?: string | undefined;
        /** The plane's place as the machine names it: a `file:` url to
         * the files' root, or `dynamodb://<region>/<table>?bucket=<b>`
         * for a plane on the cloud store, which the documents and
         * objects implementors read for their own clients. */
        substrate?: string | undefined;
        /** The release this process runs from: its folder, as the block
         * reads its own by its program's path, and the version it runs
         * as. An agent that works with the installation (the compiler,
         * the controller, the warehouse) learns it here. */
        release: { folder: string; version: string };
        /** The folder of the node the block runs on, which is the node
         * of every copy it starts. */
        node: string;
        /** The settings a plane's starter named in its machine file,
         * which the config agent sets before it answers an ask. */
        settings: Record<string, unknown>;
        /** The host job's own start, where the starter named it: whether
         * the gateway runs on every host, and the host job's lease. */
        everyHost?: boolean | undefined;
        leaseMs?: number | undefined;
      }
    | undefined;
}

/** The machine's facts as the mark carries them: the launch's own,
 * written anew at every start when they moved. The store's implementors
 * are not among them: a bind takes what is installed. */
function machineOfMark(
  machine: MachineFacts,
  release: string,
): NonNullable<MaterializedMark['machine']> {
  return {
    id: machine.id,
    root: machine.root,
    plane: planeFolderOf(machine),
    substrate: machine.substrate,
    release: { folder: release, version: releaseVersionOf(release) },
    node: dirname(process.execPath),
    settings: machine.settings,
    ...(machine.everyHost === undefined ? {} : { everyHost: machine.everyHost }),
    ...(machine.leaseMs === undefined ? {} : { leaseMs: machine.leaseMs }),
  };
}

/** The folder the plane's files live under: the place the machine
 * names when it is a `file:` url, the root otherwise. */
function planeFolderOf(machine: MachineFacts): string {
  return machine.substrate.startsWith('file:')
    ? fileURLToPath(new URL(machine.substrate))
    : machine.root;
}

function writeMark(folder: string, mark: MaterializedMark): void {
  writeFileSync(join(folder, MARK_FILE), `${JSON.stringify(mark)}\n`, { mode: 0o600 });
}

const MARK_FILE = 'materialized.json';
const LOCK_FOLDER = '.materializing';

function readMark(folder: string): MaterializedMark | undefined {
  try {
    return JSON.parse(readFileSync(join(folder, MARK_FILE), 'utf8')) as MaterializedMark;
  } catch {
    return undefined;
  }
}

/** Whether the folder holds what a copy boots from: the agent's own
 * package and the runtime it is served with. A folder whose mark stands
 * while its code is gone (a materialize ended partway through) is laid
 * out afresh rather than booted into nothing. */
function laidOut(folder: string): boolean {
  const agent = join(folder, 'work', 'agent');
  return (
    existsSync(join(agent, 'package.json')) &&
    existsSync(join(agent, 'node_modules', '@cernanto', 'runtime-lib'))
  );
}

function currentMark(
  folder: string,
  facts: GenerationFacts,
  materializer: string,
  release: string,
): MaterializedMark | undefined {
  const mark = readMark(folder);
  if (mark === undefined || !laidOut(folder)) return undefined;
  if (mark.materializer !== materializer) return undefined;
  // A generation that boots from the release is current while its
  // folder holds the release's package for it: a package compiled anew
  // in a release that keeps its place (the tree a laptop's plane runs)
  // is laid out again at the next start, and a folder laid out for an
  // agent the release carries no package of stands as it is.
  if (facts.artifact === undefined) {
    if (mark.derived === undefined) return undefined;
    const held = releasePackages(release).get(facts.agentId);
    return held === undefined || mark.derived.artifact === blobDigestOf(held) ? mark : undefined;
  }
  return mark.artifact === facts.artifact &&
    JSON.stringify(mark.composition) === JSON.stringify(facts.composition ?? {})
    ? mark
    : undefined;
}

/** Materializes the generation's folder when it is not current for the
 * facts, under the folder's lock: two copies of one generation on one
 * host share the folder and would materialize at once; the first
 * writes, the second waits for the mark. Answers the mark. The
 * privileged copy materializes from the release's own closures, never
 * from the store the plane's user writes, with the install scripts
 * off. */
/** Whether a standing folder is this process's to trust: a privileged
 * copy runs what its folder holds with its privileges kept, so a folder
 * another user owns or can write is removed, to be laid out afresh. */
function trustedFolder(folder: string, keepsPrivileges: boolean): boolean {
  if (!keepsPrivileges) return true;
  let own = true;
  try {
    const { uid, mode } = statSync(folder);
    own = uid === (process.getuid?.() ?? uid) && (mode & 0o022) === 0;
  } catch {
    return true;
  }
  if (!own) rmSync(folder, { recursive: true, force: true });
  return own;
}

export async function ensureMaterialized(options: {
  release: string;
  machine: MachineFacts;
  folder: string;
  facts: GenerationFacts;
  keepsPrivileges: boolean;
}): Promise<MaterializedMark> {
  const { release, machine, folder, facts } = options;
  // A privileged copy runs what its folder holds as root: the host
  // job's home, every folder above it and the folder itself are root's
  // alone.
  if (options.keepsPrivileges) rootsAloneFolder(machine.home);
  const materializer = materializerIdentity(release);
  const standing = trustedFolder(folder, options.keepsPrivileges)
    ? currentMark(folder, facts, materializer, release)
    : undefined;
  if (standing !== undefined) {
    // A folder laid out before: current, with the machine's facts
    // written anew when they moved (a proof's plane named again, a mark
    // written before the release and the node were stated in it, or by
    // a proof's helper with no machine at all). A mark that lacks them
    // stays current: they are the launch's facts and no condition of
    // the folder standing.
    const known = machineOfMark(machine, release);
    if (JSON.stringify(standing.machine) !== JSON.stringify(known)) {
      const marked = { ...standing, machine: known };
      writeMark(folder, marked);
      return marked;
    }
    return standing;
  }
  // The process that runs the generation makes its folder: a copy under
  // the drop its own in the agents' root, the privileged copy its own in
  // the host job's home.
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const lock = join(folder, LOCK_FOLDER);
  // Two counts end the wait for the lock: how long this process has
  // waited, time that passed on the monotonic clock, and how old the
  // lock's own folder is, a moment the file system wrote down, which
  // the wall clock alone can be held against.
  const deadline = wallElapsedMs() + LOCK_PATIENCE_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const again = currentMark(folder, facts, materializer, release);
      if (again !== undefined) return again;
      let since = 0;
      try {
        since = statSync(lock).mtimeMs;
      } catch {
        continue;
      }
      if (Date.now() - since > LOCK_PATIENCE_MS || wallElapsedMs() > deadline) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      await pause(500);
    }
  }
  // The lock came free because another copy of this generation laid the
  // folder out while this one waited: its mark stands and is this
  // copy's too. Laying the folder out again would write the agent's
  // empty module table over the finished one and leave a copy that
  // links nothing.
  const laidWhileWaiting = currentMark(folder, facts, materializer, release);
  if (laidWhileWaiting !== undefined) {
    rmSync(lock, { recursive: true, force: true });
    return laidWhileWaiting;
  }
  try {
    const closures = options.keepsPrivileges
      ? join(machine.home, 'closures')
      : join(machine.root, 'closures');
    mkdirSync(closures, { recursive: true, mode: 0o700 });
    if (options.keepsPrivileges) process.env['npm_config_ignore_scripts'] = 'true';
    // The steps are said when the materialize fails; a folder laid out
    // says nothing of how.
    const lines: string[] = [];
    const derived = await within(
      `the materialize of ${facts.agentId}`,
      MATERIALIZE_PATIENCE_MS,
      materializeGeneration({
        facts,
        substrateUrl: machine.substrate,
        ...(machine.address === undefined ? {} : { callAddress: machine.address }),
        releaseDir: release,
        workingDir: folder,
        closures,
        log: (line) => {
          lines.push(line);
        },
      }),
    ).catch((error: unknown) => {
      for (const line of lines) process.stderr.write(`materialize: ${line}\n`);
      throw error;
    });
    const mark: MaterializedMark = {
      artifact: facts.artifact ?? derived?.artifact ?? '',
      composition: facts.composition ?? derived?.composition ?? {},
      materializer,
      ...(derived === undefined ? {} : { derived }),
      machine: machineOfMark(machine, release),
    };
    writeMark(folder, mark);
    return mark;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** The one agent the block runs by its id: the host job. Every other
 * agent is a copy on the plane, started from its record. Refuses
 * another id in words. */
export function hostJobAlone(agentId: string): void {
  if (agentId !== HOST_AGENT)
    throw new Error(
      `${agentId} is placed by the plane: this command runs ${HOST_AGENT} alone, which starts every other copy from its record`,
    );
}

/** The facts of the host job's copy: the release's own package of it on
 * the port the seam names, the type the package's, no artifact (the
 * materialize derives it from the release). */
export function hostJobFacts(release: string): GenerationFacts {
  const held = releasePackages(release).get(HOST_AGENT);
  if (held === undefined) throw new Error(`the release carries no package for ${HOST_AGENT}`);
  const type = held.pkg.manifest.type;
  if (type !== 'service' && type !== 'task' && type !== 'job' && type !== 'worker')
    throw new Error(`${HOST_AGENT} is a ${type}, which no launch runs`);
  return parseGenerationFacts({ agentId: HOST_AGENT, port: HOST_PORT, gen: 1, type });
}

/** The facts the block serves under: its own, and, where they name no
 * artifact, what the materialize derived into the mark. */
function servedFacts(facts: GenerationFacts, mark: MaterializedMark): GenerationFacts {
  return facts.artifact !== undefined || mark.derived === undefined
    ? facts
    : { ...facts, ...mark.derived };
}

/** The folder a generation's copies boot from: the release's host job,
 * run with the launcher's privileges kept, in its own home; every
 * other generation in the plane's root, the agents' user's. */
function folderOf(machine: MachineFacts, release: string, facts: GenerationFacts): string {
  const home = asRoot() && privileged(release, facts) ? machine.home : machine.root;
  return generationFolder(home, facts.agentId, facts.port);
}

/** Refuses to run an agent's code as root: the launcher drops to the
 * plane's user before the block ever runs, and a block started as root
 * by hand would run an author's packages with every capability. */
function refuseRoot(facts: GenerationFacts, release: string): void {
  if (asRoot() && !privileged(release, facts))
    throw new Error(
      `${facts.agentId} is not run as root: start it as the plane's user (the launcher does, through its drop)`,
    );
}

/** Serves the materialized folder: the runtime resolved through the
 * artifact's node_modules so the process-wide seams are the instances
 * the agents see, the facts handed first, the substrate open before the
 * agent's code loads, the definition imported, the kernel in charge. */
async function serve(options: {
  machine: MachineFacts;
  folder: string;
  facts: GenerationFacts;
  copy: number;
  attempt: string | undefined;
  placement: Holding | undefined;
  readAgain: () => Promise<Holding | undefined>;
  /** The host this process runs on, read from the machine at the ask:
   * a resume holds the copy's record to it, as the boot did. */
  hostNow: () => string;
  /** What to run beside the served agent once it serves, handed the
   * runtime's own `invoke`: the host job's ring. */
  beside?: (invoke: Invoke) => void;
  /** The release's own agents, the ids of the release's packages, read
   * off the release for every launch: the traces charge and skip by
   * them, and no record of the plane carries them. */
  releaseAgents?: readonly string[];
}): Promise<void> {
  const { machine, folder, facts, copy, attempt, placement } = options;
  // A copy runs in its generation's folder: the agent reads its root
  // and the block's mark from its working folder, and whoever started
  // this process (a unit, the dev verb, a proof) may have started it
  // from anywhere.
  process.chdir(folder);
  // A rejection nobody awaits must not take the whole process down: a
  // generation serves many calls at once, and node's default
  // exits on the first unobserved rejection. The rejection is logged in
  // full; the call it belonged to already answered or failed on
  // its own path.
  process.on('unhandledRejection', (reason) => {
    console.error(
      `unhandled rejection kept off the process: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  });
  const agentDir = join(folder, 'work', 'agent');
  const requireFromArtifact = createRequire(join(agentDir, 'package.json'));
  const runtimeUrl = pathToFileURL(requireFromArtifact.resolve('@cernanto/runtime-lib/serve')).href;
  const runtime = (await import(runtimeUrl)) as {
    serveAgent: ServeAgent;
    openSubstrate: OpenSubstrate;
    setProcessFacts: (facts: ProcessFacts) => void;
    installCommandOwnership: (serving: boolean) => void;
    installTransparentGlobals: () => void;
    installListenerObserver: () => void;
    learnPortSharing: () => Promise<void>;
  };
  // The command line stays as the table shows it: the host job reads the
  // block's program off it for the release, and a title would hide it.
  // The facts come first: a module-scope call at an agent's load finds
  // the substrate named.
  // The launch's nonce in this copy's environment: the kernel hands it
  // to every command the copy runs, and whoever ends the copy ends the
  // groups that carry it.
  process.env[LAUNCH_WORD] = attempt ?? freshAttempt();
  runtime.setProcessFacts({
    substrateUrl: machine.substrate,
    // The copy's call server binds the host's address on a server (the
    // machine file's), the loopback on a laptop.
    ...(machine.address === undefined ? {} : { callAddress: machine.address }),
    agentId: facts.agentId,
    generationPort: facts.port,
    ...(facts.artifact === undefined ? {} : { artifact: facts.artifact }),
    ...(facts.composition === undefined ? {} : { composition: facts.composition }),
    ...(facts.slots === undefined ? {} : { slots: facts.slots }),
    copy,
    // A test form calls out as the agent it is the form of.
    ...(facts.form === 'test' && facts.testOf !== undefined ? { callsAs: facts.testOf } : {}),
    // Both verification forms state the agent they stand for on every
    // call they make, beside the caller's id; a tester knows its test
    // form's id, so a module's form linked into it calls as the target.
    ...(facts.form === undefined ? {} : { form: facts.form }),
    ...(facts.testOf === undefined ? {} : { testOf: facts.testOf }),
    ...(facts.target === undefined ? {} : { target: facts.target }),
    ...(placement === undefined ? {} : { holder: placement.holder }),
    host: placement?.holder.host ?? machine.id,
    ...(attempt === undefined ? {} : { attempt }),
    ...(placement?.process?.launch === undefined ? {} : { launch: placement.process.launch }),
    ...(facts.life === undefined ? {} : { life: facts.life }),
    ...(facts.lives === undefined ? {} : { lives: facts.lives }),
    ...(options.releaseAgents === undefined ? {} : { releaseAgents: options.releaseAgents }),
    implements: stampsOf(agentDir),
  });
  // The commands the served agent will spawn are the calls' own
  // (kernel/commands.ts), owned before the agent's code loads.
  runtime.installCommandOwnership(true);
  // The transparent globals (kernel/globals.ts) are in place before the
  // agent's code loads: a module-scope alias of a global captures the
  // patched one.
  runtime.installTransparentGlobals();
  // The listeners the agent opens are observed from before its code
  // loads (kernel/listeners.ts): a server opened at the agent's load is
  // a listener too.
  runtime.installListenerObserver();
  // Whether two generations may share a fixed port here is learned
  // before the agent's code can open a listener.
  await runtime.learnPortSharing();
  // The substrate is open before the agent's code loads: a module-scope
  // call at its load finds it open.
  await within('the plane', PLANE_PATIENCE_MS, runtime.openSubstrate());
  // Generated artifacts wire their definition in dist/main.js (the
  // compiler-emitted entry); staged and hand-built artifacts export it
  // from dist/index.js.
  const entryFile = existsSync(join(agentDir, 'dist', 'main.js')) ? 'main.js' : 'index.js';
  const moduleUrl = pathToFileURL(join(agentDir, 'dist', entryFile)).href;
  const loaded = (await import(moduleUrl)) as { agent?: Definition };
  if (loaded.agent === undefined)
    throw new Error(`artifact exports no agent definition: ${facts.agentId}`);
  // What runs beside the agent (the host job's ring) calls through the
  // runtime the agent itself is served by, so the call rides this
  // process's connection and lands in this copy's own lane.
  if (options.beside !== undefined) {
    const languageUrl = pathToFileURL(requireFromArtifact.resolve('@cernanto/runtime-lib')).href;
    const language = (await import(languageUrl)) as { invoke: Invoke };
    options.beside(language.invoke);
  }
  // A process the plane runs writes its traces into the store under its
  // life, says it serves in its entry on the plane, and starts a
  // worker's run itself when its facts name one. The host job writes
  // none: its one call lasts as long as the machine runs, so what it
  // says goes to its log, which is its record.
  await runtime.serveAgent(loaded.agent, {
    ...(facts.agentId === HOST_AGENT ? {} : { traces: 'substrate' as const }),
    workingDir: folder,
    holding: options.readAgain,
    hostNow: options.hostNow,
    ...(facts.run === undefined ? {} : { run: facts.run }),
  });
}

/** Runs a copy of a generation on the plane: its record names the rest. */
export async function runCopy(generation: number, copy: number, attempt: string): Promise<void> {
  const release = ownRelease();
  const machine = machineFacts(release);
  const place = (): Promise<Holding | undefined> =>
    readHolding(machine.substrate, generation, copy);
  const placement = await askingAgain('the plane', PLANE_PATIENCE_MS, () => place());
  if (placement === undefined)
    throw new Error(
      `no slot record stands for ${String(generation)}/${String(copy)}: this copy has no place on the plane`,
    );
  const facts = parseGenerationFacts(placement.record['launch']);
  if (facts.port !== generation)
    throw new Error(
      `the slot record of ${String(generation)} carries the facts of generation ${String(facts.port)}`,
    );
  // The record must name this host: a launcher that stalled past the
  // slot's move would otherwise serve another host's copy from here.
  if (placement.holder.host !== machine.id)
    throw new Error(
      `the slot ${String(generation)}/${String(copy)} is ${placement.holder.host}'s now, not this host's (${machine.id}); this copy does not serve`,
    );
  // The attempt the launcher handed this copy against the record's: a
  // child that stalled past its launcher's replacement finds the newer
  // attempt and exits before it serves.
  const launched = placement.process?.attempt;
  if (launched !== undefined && launched !== attempt && placement.process?.restores !== attempt)
    throw new Error(
      `the slot ${String(generation)}/${String(copy)} runs the attempt ${launched} now, not this copy's ${attempt}; this copy does not serve`,
    );
  refuseRoot(facts, release);
  const folder = folderOf(machine, release, facts);
  const mark = await ensureMaterialized({
    release,
    machine,
    folder,
    facts,
    keepsPrivileges: asRoot() && privileged(release, facts),
  });
  linkSecrets(release, machine, folder, facts.agentId);
  await serve({
    machine,
    folder,
    facts: servedFacts(facts, mark),
    copy,
    attempt,
    placement,
    readAgain: place,
    hostNow: () => machineFacts(release).id,
    releaseAgents: [...releasePackages(release).keys()].sort(),
  });
}

/** Runs the host job, the release's own package of it, which a server's
 * unit and a laptop's `cernanto dev` start and which serves for the
 * life of the host. The copy places itself: a record of its own at the
 * lowest free copy index of its generation, this process as its
 * process, taken over from a host job that left (whose process is
 * fenced by the attempt if it still runs). */
export async function runHostJob(): Promise<void> {
  const release = ownRelease();
  const machine = machineFacts(release);
  const facts = hostJobFacts(release);
  const folder = folderOf(machine, release, facts);
  const keepsPrivileges = asRoot() && privileged(release, facts);
  const mark = await ensureMaterialized({ release, machine, folder, facts, keepsPrivileges });
  linkSecrets(release, machine, folder, facts.agentId);
  const attempt = freshAttempt();
  const placement = await askingAgain('the plane', PLANE_PATIENCE_MS, async () =>
    placeHostJob({ machine, release, facts, identity: await ownIdentity(), attempt }),
  );
  const copy = Number(placement.holder.slot.split('/')[1] ?? '0');
  // The host job writes its host's heartbeat itself: its kernel reads
  // its record and its host's word, never the beat it writes.
  const own = (found: Holding): Holding => ({ ...found, holder: { ...found.holder, beats: true } });
  const place = async (): Promise<Holding | undefined> => {
    const found = await readHolding(machine.substrate, facts.port, copy).catch(() => undefined);
    return found === undefined ? undefined : own(found);
  };
  await serve({
    machine,
    folder,
    facts: servedFacts(facts, mark),
    copy,
    attempt,
    placement: own(placement),
    readAgain: place,
    hostNow: () => machineFacts(release).id,
    beside: (invoke: Invoke) => void ringServe(invoke, machine),
    releaseAgents: [...releasePackages(release).keys()].sort(),
  });
}

/** Rings the host job's `serve` for the life of the host: one call with the
 * host named, awaited for as long as it runs; rung again five seconds
 * after it ends for any reason but the host's own end, `stopped` (the
 * host's stop word obeyed) or `upgraded` (the host ends for its unit to
 * start it again under the highest release installed), on which this
 * process exits. The call rides the plane like any call. */
async function ringServe(invoke: Invoke, machine: MachineFacts): Promise<void> {
  const started = wallElapsedMs();
  const { agentId, handler } = SEAM.host.serve;
  const sends: SendsOf<typeof SEAM.host.serve> = {};
  for (;;) {
    let ended: string;
    try {
      const answer = (await invoke(agentId, handler, sends, { host: machine.id })) as {
        result?: Partial<ReadsOf<typeof SEAM.host.serve>> | null;
      };
      ended = typeof answer.result?.ended === 'string' ? answer.result.ended : 'answered';
    } catch (error) {
      ended = `failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    // The first ring may beat the host job's own heartbeat, or the entry of
    // the host job the bring-up lands on a fresh plane: a call that
    // fails in the first minute is rung again at once, without a word.
    if (ended.startsWith('failed: ') && wallElapsedMs() - started < 60_000) {
      await pause(1_000);
      continue;
    }
    say(`the host job's serve ended: ${ended}`);
    if (ended === 'stopped' || ended === 'upgraded') {
      // A moment for the last traces to leave, then the exit the unit
      // reads: the host's stop, or its restart under the highest release.
      await pause(1_000);
      process.exit(0);
    }
    await pause(RING_PAUSE_MS);
  }
}

/** A copy's record as the stop reads it: the process the launcher
 * wrote, as far as it wrote it, and the launch's word its commands
 * carry. */
function recordedOf(record: CopyRead): { recorded: Recorded; word: string } | undefined {
  const written = record.process;
  if (written?.pid === undefined) return undefined;
  return {
    recorded: { pid: written.pid, started: written.started, boot: written.boot },
    word: written.attempt === undefined ? '' : `${LAUNCH_WORD}=${written.attempt}`,
  };
}

/** The stop word to a copy, as the host job says it: written on the
 * copy's record for the attempt its process runs, then posted to the
 * copy's call server where its entry names one. A copy that cannot be
 * reached reads the word on its record. The post is given up when
 * `cut` says so: whoever says the word waits for the copy's process,
 * never for its answer. */
async function sayStop(
  machine: MachineFacts,
  copy: { key: string; record: CopyRead },
  why: string,
  cut: AbortSignal,
): Promise<void> {
  const { key, record } = copy;
  await updateRecord(machine.substrate, key, (current) =>
    current === undefined
      ? undefined
      : { ...current, stop: { attempt: record.process?.attempt, at: Date.now() } },
  );
  const address = record.address;
  if (address === undefined) return;
  const host = address.host.includes(':') ? `[${address.host}]` : address.host;
  await postWord(
    `http://${host}:${String(address.port)}${COPY_ROADS.stop}`,
    { 'x-cernanto-key': key, 'x-cernanto-epoch': String(record.epoch ?? 0) },
    why,
    cut,
  );
}

/** The host's stop: everything of this plane on this host leaves.
 *
 * THE HOST JOB FIRST, BY ITS PROCESS AND NEVER BY ITS SILENCE
 * (stop.ts). A call that was not answered does not say the host job is
 * gone, and a host job that lives starts again every copy it finds
 * missing. So the process its record names is asked about. The same:
 * it is given its stop word, one call of its `stopAll` with the grace,
 * which it carries out on the copies here and ends its own serve with;
 * one whose serve does not run, that does not take the word or that
 * does not leave is ended. Unknown: nothing is stopped, since a host
 * job that lives cannot be told from one that is gone. Another or
 * gone: the host job is dead. Then its end is asked whatever became of
 * its process, as every copy's is: what its own launch left is ended,
 * a launcher under way among it.
 *
 * THEN THE COPIES, once the host job is gone (stop.ts): each record
 * naming this host whose process may still run gets its stop word, all
 * of them at once, and the one grace; then the end is asked for every
 * copy, of its process where it is still the record's and of what its
 * launch left whether the process left or not. The stop waits for a
 * copy's process and never for its answer to the word. A copy the read
 * cannot vouch for gets the word and no signal, and the stop fails
 * naming it.
 *
 * A GRACE OF 0 ends at once, with no term first: the host job that did
 * not take its word, and every copy. The one answer such a stop still
 * waits for is the host job's taking of its own word, a quarter of a
 * minute at most: a host job that lives holds its launches from the
 * word on and ends its own commands as it leaves, where one ended in
 * the middle of a launch may leave a copy that no record names yet. */
export async function stopHost(graceMs: number): Promise<void> {
  const release = ownRelease();
  const machine = machineFacts(release);
  setProcessFacts({ ...processFacts(), substrateUrl: machine.substrate });
  const all = await askingAgain('the plane', WORD_PATIENCE_MS, () =>
    copiesOnHost(machine.substrate, machine.id),
  );
  const hostJobs = all
    .filter(({ record }) => agentOfCopy(record) === HOST_AGENT)
    .flatMap(({ key, record }) => {
      const read = recordedOf(record);
      return read === undefined ? [] : [{ key, ...read }];
    });
  for (const hostJob of hostJobs)
    await stopHostJob(hostJob, machine.id, graceMs, {
      read: () => sample(),
      end: (recorded, word, how) => endRecorded(recorded, word, how),
      present,
      stopWord: async (grace) => {
        const answer = await within(
          'the host job',
          WORD_PATIENCE_MS,
          hostCall(SEAM.host.stopAll, grace, machine.id),
        );
        return answer.asked;
      },
      leaveMs: HOST_LEAVE_MS,
      say,
    });
  // The copies, read again now that no host job writes their records.
  const copies = (await copiesOnHost(machine.substrate, machine.id)).flatMap(({ key, record }) => {
    const read = agentOfCopy(record) === HOST_AGENT ? undefined : recordedOf(record);
    return read === undefined ? [] : [{ key, record, ...read }];
  });
  await stopCopies(copies, graceMs, {
    read: () => sample(),
    end: (recorded, word, how) => endRecorded(recorded, word, how),
    present,
    stopWord: (copy, cut) => sayStop(machine, copy, `the host ${machine.id} is stopped`, cut),
    say,
  });
}

/** Starts a copy as its own process and exits: the detached start. */
export async function detach(words: string[]): Promise<void> {
  const release = ownRelease();
  const machine = machineFacts(release);
  const [first, second] = words;
  if (first === undefined) throw new Error('--detach names what to run');
  if (second !== undefined) {
    // A copy on a plane: the attempt reserved on the record before the
    // spawn, the pid with its identity written after.
    const generation = Number(first);
    const copy = Number(second);
    if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(copy))
      throw new Error(`--detach takes <generation> <copy>, or ${HOST_AGENT}`);
    const placement = await askingAgain('the plane', PLANE_PATIENCE_MS, () =>
      readHolding(machine.substrate, generation, copy),
    );
    if (placement === undefined)
      throw new Error(
        `no slot record stands for ${String(generation)}/${String(copy)}: this copy has no place on the plane`,
      );
    const facts = parseGenerationFacts(placement.record['launch']);
    const folder = folderOf(machine, release, facts);
    const attempt = freshAttempt();
    const launch = await issueGrant(machine.substrate, facts.agentId, generation, copy, facts.life);
    await reserveAttempt(
      machine.substrate,
      generation,
      copy,
      attempt,
      { host: machine.id, epoch: placement.holder.epoch },
      undefined,
      launch,
    );
    const pid = await spawnDetached({
      release,
      machine,
      facts,
      slot: { copy, attempt },
      folder,
      words: [String(generation), String(copy), attempt],
    });
    // The pid first, by itself: the start identity is read off the
    // system's table, which takes seconds where a tool is asked for it
    // and many copies start together, and a record that named this
    // attempt with no pid meanwhile would be launched again beside the
    // copy that runs.
    await recordProcess(machine.substrate, generation, copy, attempt, { pid });
    const identity = await identityOf(pid);
    await recordProcess(machine.substrate, generation, copy, attempt, { pid, ...identity });
    say(
      `started ${facts.agentId} ${String(generation)}/${String(copy)} as pid ${String(pid)} under the attempt ${attempt}`,
    );
    return;
  }
  hostJobAlone(first);
  const facts = hostJobFacts(release);
  const folder = folderOf(machine, release, facts);
  // The host job started places itself (`runHostJob`): a record of its
  // own at the lowest free index.
  const pid = await spawnDetached({ release, machine, facts, folder, words: [facts.agentId] });
  say(`started ${facts.agentId} as pid ${String(pid)}`);
}

/** Lays a generation's folder out for a CRIU restore and reserves the
 * restore's attempt, naming the life the image holds; runs nothing. As
 * root, the same under the drop, since the materialize runs the
 * closure's install scripts. */
export async function prepare(generation: number, copy: number): Promise<void> {
  const release = ownRelease();
  const machine = machineFacts(release);
  if (asRoot()) {
    const rule = machineRule(machine.root);
    const command = commandLineOf(
      'dropped',
      [process.execPath, join(release, AGENT_BIN), '--prepare', String(generation), String(copy)],
      rule,
    );
    await execute(command.file, command.args, {
      // The agents' user works from the agents' root: the launcher's
      // own home is root's and not its to write.
      env: { ...process.env, TZ: 'UTC', HOME: machine.root },
      timeout: MATERIALIZE_PATIENCE_MS + 60_000,
      maxBuffer: 4 * 1024 * 1024,
    }).then(
      ({ stderr }) => {
        if (stderr !== '') process.stderr.write(stderr);
      },
      (error: unknown) => {
        const said = (error as { stderr?: unknown }).stderr;
        throw new Error(
          typeof said === 'string' && said.trim() !== '' ? said.trim() : String(error),
        );
      },
    );
    return;
  }
  const placement = await askingAgain('the plane', PLANE_PATIENCE_MS, () =>
    readHolding(machine.substrate, generation, copy),
  );
  if (placement === undefined)
    throw new Error(
      `no slot record stands for ${String(generation)}/${String(copy)}: this copy has no place on the plane`,
    );
  const facts = parseGenerationFacts(placement.record['launch']);
  const folder = generationFolder(machine.root, facts.agentId, facts.port);
  const attempt = freshAttempt();
  const launch = await issueGrant(machine.substrate, facts.agentId, generation, copy, facts.life);
  await reserveAttempt(
    machine.substrate,
    generation,
    copy,
    attempt,
    { host: machine.id, epoch: placement.holder.epoch },
    placement.process?.attempt,
    launch,
  );
  await ensureMaterialized({ release, machine, folder, facts, keepsPrivileges: false });
  // The copy's error file, which a restored tree reopens by its path:
  // laid out here as a launch lays it, empty.
  const errorFile = join(folder, errorFileOf(copy));
  mkdirSync(dirname(errorFile), { recursive: true, mode: 0o700 });
  closeSync(openSync(errorFile, 'a', 0o600));
  // The address this host's copies bind: a tree restored here came from
  // an image taken elsewhere, and takes the address at its resume.
  if (machine.address !== undefined)
    writeFileSync(join(folder, wordFileOf(copy, 'address')), `${machine.address}\n`, {
      mode: 0o600,
    });
  say(
    `prepared ${facts.agentId} ${String(generation)}/${String(copy)} at ${folder} under the attempt ${attempt}`,
  );
}

/** The release's own agents read the plane's secrets (the operator
 * token among them) from their working folder: the folder is made when
 * it is not yet, so a token written later is read, and linked into the
 * generation's folder. */
function linkSecrets(
  release: string,
  machine: MachineFacts,
  folder: string,
  agentId: string,
): void {
  let own = false;
  try {
    own = releasePackages(release).has(agentId);
  } catch {
    own = false;
  }
  if (!own) return;
  // The plane's secrets are the host job's: in its home, root's on a
  // server, readable by the agents' group so the release's other agents
  // read them, never writable by an agent. The host job's process makes
  // the folder; a copy under the drop only links it.
  const secrets = join(machine.home, 'secrets');
  if (!existsSync(secrets)) {
    if (asRoot()) {
      mkdirSync(secrets, { recursive: true, mode: 0o750 });
      const user = machineRule(machine.root).user;
      if (user !== undefined) chownSync(secrets, 0, user.gid);
    } else if (machine.home === machine.root) {
      mkdirSync(secrets, { recursive: true, mode: 0o700 });
    }
  }
  linkFolder(secrets, join(folder, 'secrets'));
}
