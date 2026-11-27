// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import type {
  ChildProcess,
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { Option } from 'commander';
import type { Command } from 'commander';

import {
  CernantoError,
  PLATFORM_RELEASE_FILE,
  REGISTRY_GATE_DEFAULT,
  REGISTRY_INDEX_DEFAULT,
} from '@cernanto/package-format';

import { currentContextName, saveContext } from './context.js';
import {
  landPackages,
  landPlatformFolder,
  packageCurrency,
  readPlatformFolder,
  treePackages,
  workspaceAgentIds,
} from './deploy/landing.js';
import { accepted, gatewayClients, unread, unwrap, whenLoopbackDown } from './gateway-client.js';
import type { Plane } from './gateway-client.js';
import * as gateway from './gateway/sdk.gen.js';
import type { HarnessView } from './gateway/types.gen.js';
import { fail, interactive } from './output.js';
import { CLI_VERSION } from './version.js';
import { RegistryClient } from './registry.js';
import {
  NO_RUNTIME_WORDS,
  installRelease,
  installedRelease,
  layOutRelease,
  treeRelease,
  viewVersion,
} from './release.js';
import {
  ExecutionFailure,
  REMOVAL_RETRIES,
  execute as runProgram,
  executeSync,
  renameHeld,
  usualToolFolders,
} from './programs.js';
import { ServerClient } from './server-client.js';
import { terminalIo } from './terminal.js';
import type { ConnectIo } from './terminal.js';
import { uiAddress } from './ui.js';

class NativeDevFault extends Error {
  readonly kind = 'native-dev-unavailable' as const;
}

/** A plane's folder whose record this cli does not read: another
 * version's, or one that does not read as a record. Such a plane takes
 * no word from this cli and nothing of it is carried over; the reset
 * removes it, and the words say so. `fact` is what stands in the
 * folder, without the way out. */
class UnreadPlaneFault extends NativeDevFault {
  readonly fact: string;
  constructor(fact: string) {
    super(`${fact}; run cernanto dev reset to start the plane afresh`);
    this.fact = fact;
  }
}

/** Whether this process is root, who starts no local plane; a system
 * with no such user answers no. */
const runsAsRoot = (): boolean => process.getuid?.() === 0;

/** What root hears from the dev verb. */
export const ROOT_WORDS =
  'cernanto dev runs the local plane as the user who starts it, and an agent never runs as root: start it as a user of your own, any user but root';

// The deployer: the cli is what makes a laptop a plane. It keeps the
// plane's record, mints the operator token, starts the host (the
// release's block running the host job, `cernanto-agent cernanto/host`,
// the one process of the plane: the plane's records, journals and
// inboxes are files under its root, and nothing else runs beside it),
// lands the platform's packages once the gateway answers and waits for
// the plane. The host is the plane's one host: it writes the bring-up
// set's orders as every host does, starts the controller like every
// other copy, and brings every generation the plane ordered back at the
// next start. Nothing starts a host that died: the next command says so
// and starts the plane.

/** The deployer's record of its plane, `dev.json` at the plane's root:
 * the release, the gateway's port, and the host this verb started last:
 * its pid with its start and the boot's identity beside it, the three
 * the block answered when the host was started, so a pid the system
 * gave again, or one of an earlier boot, is nobody's. */
interface DevRecord {
  version: 4;
  id: string;
  release: string;
  /** The gateway's port. */
  ports: { gateway: number };
  pids?: { host?: number | undefined };
  /** The start and the boot of the host's process, as the block told
   * them; absent while they are not told yet. */
  host?: { started: string; boot: string } | undefined;
}
const RECORD_FILE = 'dev.json';
/** The operator token, minted once and kept under the root's secrets;
 * the block links the folder into every platform generation's, where the
 * gateway reads it. */
const OPERATOR_TOKEN_FILE = 'secrets/operator-token';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Publishes a file whole by a rename: a reader sees all of it, or the
 * one before. */
function writeWhole(file: string, value: unknown): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameHeld(temporary, file);
}

async function availablePort(): Promise<number> {
  const listener = createTcpServer();
  return new Promise((resolvePort, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (address === null || typeof address === 'string') {
        listener.close();
        reject(new NativeDevFault('cannot allocate a local listener'));
        return;
      }
      listener.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

/** A new plane's record: its id and the gateway's port, kept from now
 * on. A new plane takes an empty folder. */
async function newRecord(root: string, release: string, gatewayPort: number): Promise<DevRecord> {
  if (readdirSync(root).some((name) => name !== 'logs'))
    throw new NativeDevFault('a new local plane requires an empty data directory');
  const record: DevRecord = {
    version: 4,
    id: randomUUID(),
    release,
    ports: { gateway: gatewayPort === 0 ? await availablePort() : gatewayPort },
  };
  writeWhole(join(root, RECORD_FILE), record);
  return record;
}

/** The operator token: minted once, kept under the root's secrets. */
function mintOperatorToken(root: string): void {
  const file = join(root, OPERATOR_TOKEN_FILE);
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 });
}

function operatorTokenOf(root: string): string {
  return readFileSync(join(root, OPERATOR_TOKEN_FILE), 'utf8').trim();
}

/** The host as the dev verb sees it: the process running the host job
 * on this machine, and the gateway the plane serves. */
interface Health {
  /** The host's own process. */
  pid: number;
  gateway: string;
}

/** Inputs to local lifecycle operations; the existing gateway configures the platform.
 * @example await startNativeDev({say: console.log});
 */
export interface NativeDevIo {
  say: (line: string) => void;
  afterUp?: (plane: Plane) => Promise<void>;
  releaseDir?: string;
  dataDir?: string;
  gatewayPort?: number;
  /** Whether this start may install the release when the machine has
   * none: set by the dev verbs alone. */
  installRuntime?: boolean;
  /** The packages host an install pulls the platform from, the public
   * registry's unless a proof names its own. */
  registry?: string;
}

/** The release a start runs: the tree when the cli runs from its
 * compile there, else the installed release's view, laid out now; a
 * machine without the release gets it installed by the dev verb alone,
 * the runtime from npm and its platform from the registry, and the
 * words otherwise. */
async function releaseFor(io: NativeDevIo): Promise<string> {
  const tree = treeRelease();
  if (tree !== undefined) return tree;
  let prefix = installedRelease();
  if (prefix === undefined) {
    if (io.installRuntime !== true) throw new NativeDevFault(NO_RUNTIME_WORDS);
    const registry = new RegistryClient({
      gateUrl: REGISTRY_GATE_DEFAULT,
      indexUrl: (io.registry ?? REGISTRY_INDEX_DEFAULT).replace(/\/+$/, ''),
    });
    try {
      prefix = await installRelease(io.say, registry);
    } catch (error) {
      throw new NativeDevFault(error instanceof Error ? error.message : String(error));
    }
  }
  return layOutRelease(prefix);
}

function rootOf(io: NativeDevIo): string {
  return resolve(io.dataDir ?? join(homedir(), '.cernanto/dev'));
}

/** The deployer's record of the plane at a root, or nothing when no
 * plane was made there. A folder that holds another version's record,
 * or one that does not read as a record, is a plane this cli does not
 * read: refused in words that name the reset, which removes it. */
function savedPlane(root: string): DevRecord | undefined {
  let text: string;
  try {
    text = readFileSync(join(root, RECORD_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    saved = undefined;
  }
  if (isRecord(saved) && saved['version'] !== 4) {
    const version = saved['version'];
    const theirs =
      typeof version === 'number' || typeof version === 'string'
        ? `its record is version ${String(version)}`
        : 'its record names no version';
    throw new UnreadPlaneFault(
      `the local plane at ${root} was made by another version of cernanto (${theirs}; this one writes version 4) and cannot be carried over`,
    );
  }
  const ports = isRecord(saved) ? saved['ports'] : undefined;
  if (
    !isRecord(saved) ||
    typeof saved['id'] !== 'string' ||
    typeof saved['release'] !== 'string' ||
    !isRecord(ports) ||
    typeof ports['gateway'] !== 'number'
  )
    throw new UnreadPlaneFault(
      `the record of the local plane at ${root} cannot be read (${RECORD_FILE})`,
    );
  const pids = isRecord(saved['pids']) ? saved['pids'] : {};
  const pid = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
  const host = isRecord(saved['host']) ? saved['host'] : {};
  const { started, boot } = host;
  return {
    version: 4,
    id: saved['id'],
    release: saved['release'],
    ports: { gateway: ports['gateway'] },
    pids: {
      ...(pid(pids['host']) === undefined ? {} : { host: pid(pids['host']) }),
    },
    ...(typeof started === 'string' && started !== '' && typeof boot === 'string' && boot !== ''
      ? { host: { started, boot } }
      : {}),
  };
}

/** Writes the record with the host as it stands now: its pid, and the
 * start and the boot beside it once they are told. A record without a
 * host's pid names no host. */
function recordPids(
  root: string,
  saved: DevRecord,
  pids: { host?: number | undefined },
  identity?: { started: string; boot: string },
): DevRecord {
  const merged = { ...saved.pids, ...pids };
  const sameHost = merged.host !== undefined && merged.host === saved.pids?.host;
  const told = identity ?? (sameHost ? saved.host : undefined);
  const next: DevRecord = {
    version: saved.version,
    id: saved.id,
    release: saved.release,
    ports: saved.ports,
    pids: {
      ...(merged.host === undefined ? {} : { host: merged.host }),
    },
    ...(merged.host === undefined || told === undefined ? {} : { host: told }),
  };
  writeWhole(join(root, RECORD_FILE), next);
  return next;
}

/** Whether a process still exists. */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What the block's read says of a recorded process: the same, another,
 * gone or unknown, and the start the read tells of the pid. */
interface Measured {
  answer: 'same' | 'another' | 'gone' | 'unknown';
  started?: string;
  boot: string;
}

/** Asks the release's block about the host this verb recorded: the
 * block's `--measure`, handed the pid with the start and the boot the
 * record has. The pid never goes alone where the record has the three;
 * a record without them is answered unknown while a process is at the
 * pid. */
async function measured(root: string, saved: DevRecord, pid: number): Promise<Measured> {
  let said: { stdout: string };
  try {
    said = await runProgram(process.execPath, [blockProgram(saved.release), '--measure'], {
      cwd: root,
      env: hostEnvironment(root),
      timeoutMs: 60000,
      maxBuffer: 1024 * 1024,
      input: JSON.stringify([{ pid, ...saved.host }]),
    });
  } catch (error) {
    const words =
      error instanceof ExecutionFailure
        ? (error.stderr.trim().split(/\r?\n/).at(-1) ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error);
    throw new NativeDevFault(`the processes of this machine could not be read: ${words}`);
  }
  const answer = JSON.parse(said.stdout) as {
    boot: string;
    processes: { answer: Measured['answer']; started?: string }[];
  };
  const [one] = answer.processes;
  if (one === undefined) throw new NativeDevFault('the block answered no process');
  return {
    answer: one.answer,
    boot: answer.boot,
    ...(one.started === undefined ? {} : { started: one.started }),
  };
}

/** The hosts this verb found to be the ones it recorded. A read of the
 * machine's processes can cost half a second: it is taken once for a
 * host, and between reads the pid's existence is the check. */
const proved = new Set<number>();

/** The host this verb started, when it runs, and the gateway the plane
 * serves; undefined when none runs (none started yet, or it died). A
 * host whose start the system does not tell is taken by its pid while
 * a process is there. */
async function health(root: string, saved: DevRecord | undefined): Promise<Health | undefined> {
  if (saved === undefined) return undefined;
  const pid = saved.pids?.host;
  if (pid === undefined) return undefined;
  const alive: Health = { pid, gateway: `http://127.0.0.1:${String(saved.ports.gateway)}` };
  if (proved.has(pid)) {
    if (processExists(pid)) return alive;
    proved.delete(pid);
    return undefined;
  }
  if (!processExists(pid)) return undefined;
  const { answer } = await measured(root, saved, pid);
  if (answer === 'another' || answer === 'gone') return undefined;
  if (answer === 'same') proved.add(pid);
  return alive;
}

/** Whether the plane's gateway answers: the plane is up. */
async function gatewayAnswers(gateway: string): Promise<boolean> {
  try {
    const response = await fetch(`${gateway}/healthz`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** The one host of a second plane on this machine, by the proofs'
 * convention; the block reads it from the proofs' file. */
const LAPTOP_HOST = 'laptop';

/** The proofs' file of a second plane on this machine, in the plane's
 * own folder: a laptop's one host, its root (the plane's files live
 * under it), its gateway on the loopback at the
 * record's port where the plane has no word of its own yet. The
 * machine's own plane has none: every process of it reads the
 * conventions, and the block is handed nothing. */
const MACHINE_FILE = 'machine.json';
const MACHINE_FILE_ENV = 'CERNANTO_MACHINE';

function ownPlaneOf(root: string): boolean {
  return resolve(root) === resolve(join(homedir(), '.cernanto/dev'));
}

function writeMachineFile(root: string, saved: DevRecord): string | undefined {
  const file = join(root, MACHINE_FILE);
  if (ownPlaneOf(root)) {
    rmSync(file, { force: true });
    return undefined;
  }
  writeWhole(file, {
    id: LAPTOP_HOST,
    root,
    settings: {
      'cernanto/gateway/host': '127.0.0.1',
      'cernanto/gateway/port': saved.ports.gateway,
    },
  });
  return file;
}

/** The host's words: the block's error stream, appended across starts. */
const HOST_LOG = join('logs', 'host.log');

/** The block's program in a release: `cernanto-agent`. */
function blockProgram(release: string): string {
  return join(release, 'runtime/process/dist/agent/bin.js');
}

/** The id of the host job, the agent the block runs as this machine's
 * host. */
const HOST_AGENT = 'cernanto/host';

/** The environment the block runs in: this command's; a second plane's
 * block is handed the proofs' file in the one switch. */
function hostEnvironment(root: string): NodeJS.ProcessEnv {
  // The agent's debug section is a test run's alone (the block turns it
  // on for a compile's verification pair): the host job records no
  // debug line.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (ownPlaneOf(root)) {
    Reflect.deleteProperty(env, MACHINE_FILE_ENV);
    return env;
  }
  return { ...env, [MACHINE_FILE_ENV]: join(root, MACHINE_FILE) };
}

/** Starts the host, detached: the block running the host job, its
 * words into the plane's log file; answers the child, whose early exit
 * says the plane did not come up. */
async function startHost(root: string, saved: DevRecord): Promise<ChildProcess> {
  mkdirSync(join(root, 'logs'), { recursive: true, mode: 0o700 });
  const log = openSync(join(root, HOST_LOG), 'a');
  const child = spawn(process.execPath, [blockProgram(saved.release), HOST_AGENT], {
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
    // The host works in the plane's own folder: a folder a process
    // works in is held on some systems, and the one the command ran
    // from stays free.
    cwd: root,
    env: hostEnvironment(root),
  });
  closeSync(log);
  await new Promise<void>((started, failed) => {
    child.once('spawn', started);
    child.once('error', failed);
  });
  child.unref();
  return child;
}

/** Writes the start and the boot of the host just started beside its
 * pid, as the block reads them while this verb still holds the host by
 * its handle, so the pid asked about is the host's own. A start the
 * system does not tell leaves the record with the pid alone. */
async function recordIdentity(
  root: string,
  saved: DevRecord,
  child: ChildProcess,
): Promise<DevRecord> {
  const pid = child.pid;
  if (pid === undefined) return saved;
  // The record without a start of its own: the block is asked what the
  // read tells of the pid, not whether it is a process written down.
  const bare: DevRecord = { ...saved, host: undefined };
  for (let ask = 0; ask < 10 && child.exitCode === null && child.signalCode === null; ask += 1) {
    const told = await measured(root, bare, pid).catch(() => undefined);
    if (told?.started !== undefined)
      return recordPids(root, saved, { host: pid }, { started: told.started, boot: told.boot });
    await pause(100);
  }
  return saved;
}

/** What the verb says once the plane is up: where it answers, that the
 * address is a screen too, and how the plane is parked. It opens no
 * browser: the verb runs in scripts and over ssh, where there is none.
 * @example upWords({baseUrl: 'http://127.0.0.1:7434', token: undefined})
 */
export function upWords(plane: Plane): string[] {
  return [
    `the local plane is up: ${plane.baseUrl}`,
    `open its UI in a browser: ${uiAddress(plane)} (or: cernanto ui)`,
    'park it with: cernanto dev down',
  ];
}

/** Starts or resumes the local plane and selects its existing public gateway.
 * @param io - Output and optional physical paths.
 * @returns Once the platform and its gateway answer.
 * @example await startNativeDev({say: console.log});
 */
export async function startNativeDev(io: NativeDevIo): Promise<void> {
  if (
    io.gatewayPort !== undefined &&
    (!Number.isSafeInteger(io.gatewayPort) || io.gatewayPort < 0 || io.gatewayPort > 65535)
  )
    throw new NativeDevFault("the local plane's port must be between 0 and 65535");
  // The local plane runs as whoever starts it, and an agent never runs
  // as root: a plane root started would hold a host that can start no
  // agent, and a wait that ends in nothing. Said here, before anything
  // is installed.
  if (runsAsRoot()) throw new NativeDevFault(ROOT_WORDS);
  const root = rootOf(io);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let saved = savedPlane(root);
  // A plane that is up keeps the release it runs; the view is relaid
  // only under a parked plane, so a newer cli says what the running
  // plane is on and how to move it.
  const live = saved !== undefined && (await health(root, saved)) !== undefined;
  const release = resolve(
    io.releaseDir ?? (live && saved !== undefined ? saved.release : await releaseFor(io)),
  );
  if (live && saved !== undefined && io.releaseDir === undefined && treeRelease() === undefined) {
    const running = viewVersion(saved.release);
    const own = CLI_VERSION;
    if (running !== undefined && running !== own)
      io.say(
        `the local plane runs release ${running}; cernanto dev down, then cernanto dev brings it up on ${own}`,
      );
  }
  if (!existsSync(blockProgram(release)) || !existsSync(join(release, 'cernanto', '.cern')))
    throw new NativeDevFault(
      `the release at ${release} is not complete; in a checkout, run pnpm run build first`,
    );
  if (saved !== undefined && saved.release !== release)
    throw new NativeDevFault(
      'this plane belongs to a different release directory; start it with its original release',
    );
  saved ??= await newRecord(root, release, io.gatewayPort ?? 7434);
  // Before the host starts: the token the gateway reads, the proofs'
  // file of a second plane.
  mintOperatorToken(root);
  writeMachineFile(root, saved);
  // A host that died since the last command is said once, with where
  // its log is: nothing of the plane starts it again by itself. The
  // host's own words stay in its log and are never said here.
  const log = join(root, HOST_LOG);
  const died = saved.pids?.host;
  if (died !== undefined && (await health(root, saved)) === undefined) {
    io.say(`the local plane's host (pid ${String(died)}) is not running; its log: ${log}`);
    saved = recordPids(root, saved, { host: undefined });
  }
  let child: ChildProcess | undefined;
  io.say('starting the local plane');
  let deadline = Date.now() + 300000;
  let nextNotice = Date.now() + 15000;
  let last: Health | undefined;
  for (;;) {
    // The host this command started is held by its handle while the
    // command runs, and an end the handle tells is the host's own,
    // whatever stands at its pid since: the record names it no more.
    if (child !== undefined && (child.exitCode !== null || child.signalCode !== null)) {
      recordPids(root, saved, { host: undefined });
      throw new NativeDevFault(
        `the local plane's host exited (${child.signalCode ?? `code ${String(child.exitCode)}`}); its log: ${log}; run cernanto dev again`,
      );
    }
    last = await health(root, saved);
    if (last !== undefined && (await gatewayAnswers(last.gateway))) break;
    if (last === undefined && child === undefined) {
      child = await startHost(root, saved);
      saved = recordPids(root, saved, { host: child.pid });
      saved = await recordIdentity(root, saved, child);
      deadline = Date.now() + 300000;
    }
    if (Date.now() >= deadline)
      throw new NativeDevFault(
        `the local plane did not become ready; its host's log: ${log}; cernanto dev starts it again`,
      );
    if (Date.now() >= nextNotice) {
      io.say(
        last === undefined
          ? "waiting for the local plane's host"
          : "waiting for the plane's gateway",
      );
      nextNotice = Date.now() + 15000;
    }
    await pause(100);
  }

  const token = operatorTokenOf(root);
  const plane: Plane = { baseUrl: last.gateway, token };
  // The gateway's ready word comes a moment before its listener answers:
  // the health read is asked again for a few seconds before the plane
  // is called not ready.
  const healthDeadline = Date.now() + 10000;
  for (;;) {
    try {
      const response = await fetch(`${last.gateway}/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) break;
    } catch {
      // Not answering yet.
    }
    if (Date.now() >= healthDeadline)
      throw new NativeDevFault('the local plane is not ready; run cernanto dev again');
    await pause(50);
  }
  saveContext('local', { server: plane.baseUrl, token });
  // The seed's first processes may still be taking their inboxes when
  // the landing reaches them: a "not deployed yet" refusal in this
  // window is waited out.
  const landingDeadline = Date.now() + 120000;
  for (;;) {
    try {
      await landPlatform(saved.release, plane, io.say);
      break;
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error);
      if (!/is not deployed yet/.test(words) || Date.now() >= landingDeadline) throw error;
      await pause(250);
    }
  }
  await awaitPlatform(plane, io.say);
  for (const line of upWords(plane)) io.say(line);
  await io.afterUp?.(plane);
}

/** The workspace a release's packages are landed from: the real folder
 * behind the release's agent tree, with the marker beside it. The tree
 * is that folder itself; an installed release is a view of links, and
 * the landing walks a workspace by what its folders resolve to, so the
 * view's own root would refuse its linked tree as lying outside. A
 * release without the tree answers its root, for the landing to refuse
 * in its own words. */
export function releaseWorkspace(release: string): string {
  try {
    return dirname(realpathSync(join(release, 'cernanto')));
  } catch {
    return release;
  }
}

/**
 * The release's rows: the release's packages, the workspace at the
 * release's root (its marker names the folder; on an installed release
 * the real folder behind the view's link), are landed into the
 * fleet by the cli's own landing road as they are, dependencies
 * first. On a fresh plane the rows are born and the controller
 * converges every agent the bring-up did not boot; on a warm one the
 * same content keeps every running generation; a package the tree
 * moved rolls its agent. A package that is not current for its spec
 * stops here in words naming the deploy that recompiles it.
 */
async function landPlatform(
  release: string,
  plane: Plane,
  say: (line: string) => void,
): Promise<void> {
  const agentsRoot = releaseWorkspace(release);
  // An installed release carries its platform as a platform folder,
  // which lands by its record: exactly the packages the record names,
  // as the installed packages of the platform's publisher. The tree
  // carries no record: its packages stand beside their specs and land
  // by the workspace road below, as the author's own.
  if (existsSync(join(agentsRoot, PLATFORM_RELEASE_FILE))) {
    const platform = readPlatformFolder(agentsRoot);
    say(
      `landing the platform release ${platform.body.version}: ${String(platform.packages.length)} packages`,
    );
    const landing = await landPlatformFolder(new ServerClient(plane), platform);
    for (const warning of landing.warnings) say(`warning: ${warning}`);
    say(`the platform release ${platform.body.version} is landed; the plane converges it`);
    return;
  }
  const targets = workspaceAgentIds(agentsRoot);
  say(`landing the release's ${String(targets.length)} packages`);
  // The tree's packages land as they are: they are consistent among
  // themselves (every pin held to the tree), whatever a spec under edit
  // says.
  const landing = await landPackages(new ServerClient(plane), targets, {
    agentsRoot,
    asTheyAre: true,
  });
  say(
    `the release's ${String(landing.landed.length)} packages are landed; the plane converges them`,
  );
  for (const one of landing.toCompile)
    say(`${one.agentId}: ${one.reason}; deploy it: cernanto deploy ${one.agentId}`);
  // A spec or a granted file that moved since its package was compiled is
  // named with the deploy that recompiles it.
  const tree = treePackages(agentsRoot);
  for (const agentId of targets) {
    const strict = packageCurrency(agentsRoot, agentId, tree);
    if (!strict.current && packageCurrency(agentsRoot, agentId, tree, { asItIs: true }).current)
      say(`${agentId}: ${strict.reason}; deploy it: cernanto deploy ${agentId}`);
  }
}

/**
 * The platform is up when every runner row of the release (a service,
 * a task, a job, a worker) has an active generation: the bring-up's
 * adopted ones and the ones the controller planned after the landing.
 * The wait reads the fleet through the gateway every two seconds, says
 * what it still waits for every fifteen, and gives up after five
 * minutes naming the agents that never served.
 */
async function awaitPlatform(plane: Plane, say: (line: string) => void): Promise<void> {
  const client = new ServerClient(plane);
  const deadline = Date.now() + 300000;
  let nextNotice = Date.now() + 15000;
  for (;;) {
    let pending: string[] = [];
    try {
      const view = await client.agents();
      const active = new Set(
        view.generations
          .filter((generation) => generation.status === 'active')
          .map((generation) => generation.agentId),
      );
      pending = view.agents
        .filter((row) => row.type !== 'module' && row.type !== 'interface')
        .map((row) => row.agentId)
        .filter((agentId) => !active.has(agentId))
        .sort();
    } catch {
      pending = ['the fleet (not readable yet)'];
    }
    if (pending.length === 0) return;
    if (Date.now() >= deadline)
      throw new NativeDevFault(
        `the platform did not come up within five minutes; still waiting for ${pending.join(', ')}: inspect ${join(rootOf({ say }), 'logs')} and cernanto ls`,
      );
    if (Date.now() >= nextNotice) {
      say(
        `waiting for the platform: ${pending.slice(0, 4).join(', ')}${pending.length > 4 ? ` and ${String(pending.length - 4)} more` : ''}`,
      );
      nextNotice = Date.now() + 15000;
    }
    await pause(250);
  }
}

/** The grace the block's stop gives the copies when none is named. */
const HOST_GRACE_MS = 40000;

/** How long the block's stop may run past twice the grace: the host
 * job's own leaving after its copies, the last resorts, and the end of
 * a host job that would not take its word. */
const STOP_MARGIN_MS = 180000;

/** The words a failed command of the block ended with: the first line
 * of its error stream that is no trace, without the block's own name. */
function blockWords(error: unknown): string {
  const said =
    error instanceof ExecutionFailure ? error.stderr : (error as { stderr?: unknown }).stderr;
  return typeof said === 'string'
    ? (said
        .split(/\r?\n/)
        .map((line) => line.replace(/^cernanto-agent: /, '').trim())
        .filter((line) => line !== '' && !line.startsWith('at '))
        .at(-1)
        ?.replace(/^\w*Error: /, '') ?? '')
    : '';
}

/** Ends the host this verb recorded, while a process is at its pid: the
 * block's `--end`, handed the pid with the start and the boot's
 * identity as far as the record has them, which the block checks
 * before it looks under the pid or signals anything; under a stop with
 * no grace it is asked to end at once, with no term first. What a read
 * tells of a recorded process is the block's to say, whatever the
 * record holds: its word fails when anything is left, a host it cannot
 * vouch for among it (one whose record has the pid alone is such a
 * host), and so does this. A stop that could not say the host is gone
 * is no stop: the record goes on naming the host, and the plane's data
 * stays. */
async function endRecordedHost(root: string, saved: DevRecord, atOnce: boolean): Promise<void> {
  const pid = saved.pids?.host;
  if (pid === undefined || !processExists(pid)) return;
  try {
    await runProgram(
      process.execPath,
      [
        blockProgram(saved.release),
        '--end',
        ...(atOnce ? ['--at-once'] : []),
        String(pid),
        saved.host?.started ?? '',
        saved.host?.boot ?? '',
      ],
      { cwd: root, env: hostEnvironment(root), timeoutMs: 60000, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    const words = blockWords(error);
    // What this command alone knows of the failure: its own record has
    // no start for the host, so no read will ever tell whose the
    // process is, and the stop goes on only once the pid is free.
    const untold =
      saved.host === undefined
        ? ` (this command's record of the host has no start to know it by: the stop goes on once no process is at the pid ${String(pid)})`
        : '';
    throw new NativeDevFault(
      `the local plane's host (pid ${String(pid)}) could not be ended${words === '' ? '' : `: ${words}`}${untold}; the plane's data is kept as it is`,
    );
  }
}

/** Says the host's stop word on the plane by the block's stop mode
 * (`cernanto-agent --stop`), with the grace when one is named; what
 * went wrong is said in the block's words, in place of the command
 * that ran it. */
async function sayStop(root: string, saved: DevRecord, graceMs: number | undefined): Promise<void> {
  try {
    // The block's stop does the whole of it and answers when it is
    // done: the host job by its own process first, its stop word, its
    // leaving or its end, then every recorded copy that outlived it.
    await runProgram(
      process.execPath,
      [
        blockProgram(saved.release),
        '--stop',
        ...(graceMs === undefined ? [] : ['--grace', String(graceMs)]),
      ],
      {
        cwd: root,
        env: hostEnvironment(root),
        timeoutMs: 2 * (graceMs ?? HOST_GRACE_MS) + STOP_MARGIN_MS,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch (error) {
    const words = blockWords(error);
    throw new NativeDevFault(
      words === ''
        ? 'the local plane could not be stopped; run cernanto dev down again'
        : `the local plane did not stop: ${words}; its data is kept as it is`,
    );
  }
}

/** Stops owned local processes while retaining the plane's data and generations.
 * @param io - Output and optional data directory.
 * @param options - `graceMs`: the grace the copies get to drain before
 *   the host's last resort; the host's own, forty seconds, when absent.
 *   A stop with none ends every copy at once: the wipe that follows
 *   keeps nothing a drain would finish. `removes`: the stop is the
 *   reset's, which removes the data after it.
 * @example await stopNativeDev({say: console.log});
 */
export async function stopNativeDev(
  io: NativeDevIo,
  options: { graceMs?: number; removes?: boolean } = {},
): Promise<void> {
  const root = rootOf(io);
  let saved: DevRecord | undefined;
  try {
    saved = savedPlane(root);
  } catch (error) {
    if (!(error instanceof UnreadPlaneFault)) throw error;
    // A plane this cli does not read takes no word from it, and this
    // cli knows none of its processes: nothing of it is ended, and its
    // data is left as it is for the reset that removes it. The reset
    // itself hears what stands there, without being pointed at itself.
    io.say(options.removes === true ? error.fact : error.message);
    io.say(
      'what of that plane still runs is not known to this version and is left as it is; its data is retained',
    );
    return;
  }
  if (saved === undefined) {
    io.say('the local plane is stopped');
    return;
  }
  io.say('stopping the local plane');
  const notice = setInterval(() => {
    io.say('waiting for local processes to stop');
  }, 15000);
  const record = saved;
  // The stop is the block's: the host job is known by its own process,
  // takes its stop word, stops every copy here in order within the
  // grace, ends the stragglers by the last resort and leaves; a host
  // job that is gone left its recorded copies, which the block stops
  // by their records. Answers whether the plane took the word: one
  // written in another shape (an earlier release's format) takes none
  // from this release, which refuses to open it.
  const stopByTheRecords = async (): Promise<boolean> => {
    try {
      await sayStop(root, record, options.graceMs);
      return true;
    } catch (error) {
      if (!(error instanceof NativeDevFault && /written in another shape/.test(error.message)))
        throw error;
      return false;
    }
  };
  let read: boolean;
  try {
    read = await stopByTheRecords();
    // A plane whose records are not read: the host this command
    // recorded is ended below, and what else of that plane runs is not
    // known here, so nothing is said to be stopped.
    if (!read)
      io.say(
        'the local plane was written in another shape and takes no word from this release: the host this command recorded is ended, and what else of that plane still runs is not known here',
      );
    // The host this command started, when it still runs: one the block
    // could not know by the plane's records is known by this command's
    // own record of it. A host that lived through the block's stop may
    // have taken its place on the plane and started copies after it,
    // and copies are stopped by their records only once their host is
    // dead: so the block's stop is asked once more after that host's
    // end.
    if (record.pids?.host !== undefined) {
      proved.delete(record.pids.host);
      if ((await health(root, record)) !== undefined) {
        await endRecordedHost(root, record, options.graceMs === 0);
        if (read) await stopByTheRecords();
      }
    }
    recordPids(root, record, { host: undefined });
  } finally {
    clearInterval(notice);
  }
  io.say(
    read
      ? 'the local plane is stopped; its data is retained'
      : "the local plane's data is retained",
  );
}

/** Removes a stopped local plane's data, optionally starting a fresh plane.
 * The processes are killed at once (nothing they would finish is kept),
 * the data leaves under another name the same moment, and its bytes go
 * while the fresh plane starts.
 * @param io - Output and optional physical paths.
 * @param restart - Start again after removing the existing local data.
 * @example await resetNativeDev({say: console.log}, true);
 */
export async function resetNativeDev(io: NativeDevIo, restart: boolean): Promise<void> {
  const root = rootOf(io);
  await stopNativeDev(io, { graceMs: 0, removes: true });
  const removals: Promise<void>[] = [];
  const asideOf = (name: string): boolean => name.startsWith(`${basename(root)}.removing-`);
  const removal = { recursive: true, force: true, ...REMOVAL_RETRIES };
  try {
    for (const name of readdirSync(dirname(root)))
      if (asideOf(name)) removals.push(rm(join(dirname(root), name), removal));
  } catch {
    // No parent folder yet: nothing was ever there.
  }
  // A plane's data is what its record marks, read by this cli or not:
  // the reset is the one verb that removes a plane another version made.
  if (existsSync(join(root, RECORD_FILE))) {
    const aside = `${root}.removing-${String(process.pid)}`;
    renameHeld(root, aside, 10000);
    removals.push(rm(aside, removal));
  }
  io.say('the local plane data was removed');
  try {
    if (restart) await startNativeDev(io);
  } finally {
    await Promise.all(removals);
  }
}

// The coder: the local plane compiles on this machine's own claude or
// codex login, used where it lies. The chooser runs once, where the plane is
// initialized (`dev`), and again before a compile when the plane still
// has no coder; the gateway writes the plane's harness binding from the
// choice, and a server's operator sets that binding by hand.

/** The coder vendors the plane's selection may name. */
export type CoderVendor = 'claude-code' | 'codex';

/** How the selected vendor is credentialed: `plan` is the machine's own
 * login where it lies (the local plane); `api-key` and `bedrock` are a cluster's
 * keys, secret settings of the plane. */
export type CoderMode = 'plan' | 'api-key' | 'bedrock';

/** A coder the local plane signs in with: the two plan vendors, claude first. */
export type Coder = 'claude-code' | 'codex';

const CODER_WORDS: Record<Coder, string> = { 'claude-code': 'claude', codex: 'codex' };
const LOGIN_WORDS: Record<Coder, string> = {
  'claude-code': "this machine's Claude login",
  codex: "this machine's ChatGPT login",
};
/** The sign-in rows, in the order the screen lists them and the
 * detection prefers them. */
const CODER_ROWS: { coder: Coder; row: string; hint: string }[] = [
  {
    coder: 'claude-code',
    row: 'claude',
    hint: 'sign in to Claude in your browser (a Claude plan)',
  },
  { coder: 'codex', row: 'chatgpt', hint: 'sign in to ChatGPT in your browser (a ChatGPT plan)' },
];
const SIGN_IN_COMMANDS = 'cernanto dev --coder claude   or: cernanto dev --coder codex';

/** The coder's own tool as this machine has it: the command by its word
 * on the machine's PATH (the usual tool folders added, since a launch
 * from a tool or a service may lack them), or the file of that word
 * under a folder handed in (a test's fakes). The login the plane
 * compiles on is the machine's own. */
export function coderCommand(coder: Coder, binDir?: string): string {
  return binDir === undefined ? CODER_WORDS[coder] : join(binDir, CODER_WORDS[coder]);
}

/** The machine's PATH with the folders a coder tool usually lives in,
 * on the system's own delimiter. */
export function pathForCoderTools(path: string | undefined): string {
  const parts = (path ?? '').split(delimiter).filter((part) => part !== '');
  const usual = usualToolFolders(process.env);
  for (const dir of usual) if (!parts.includes(dir) && existsSync(dir)) parts.push(dir);
  return parts.join(delimiter);
}

/** Runs the coder's own tool with its fixed words, by its name on
 * every system (a `.cmd` shim included); the words are constants of
 * this file. */
function runCoderTool(
  coder: Coder,
  words: readonly string[],
  binDir: string | undefined,
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string> {
  const env = { ...process.env, PATH: pathForCoderTools(process.env['PATH']) };
  return executeSync(coderCommand(coder, binDir), words, { ...options, env });
}

/** Makes a vendor the plane's coder in the given mode: what compiles and
 * runtime judgments run on from now (the plane's harness binding,
 * the harness interface's default `cernanto/harness/default`, which the
 * gateway writes). */
export async function setPlaneHarness(
  plane: Plane,
  vendor: CoderVendor,
  mode: CoderMode,
): Promise<void> {
  unwrap(
    await gateway.harnessSet({ client: gatewayClients(plane).client, body: { vendor, mode } }),
    '/v1/harness',
  );
}

/** The plane's coder, or undefined when none was selected. */
export async function planeHarness(plane: Plane): Promise<HarnessView | undefined> {
  const result = await gateway.harnessView({ client: gatewayClients(plane).client });
  // A plane that did not answer at all is the transport's failure, in
  // the plain words every path speaks, and an answer that could not be
  // read is a failure too: what the plane holds is unknown, and a
  // selection is never written over it. A refusal reads as no coder
  // selected.
  if (result.response === undefined && result.error instanceof Error) throw result.error;
  const lost = unread(result, '/v1/harness');
  if (lost !== undefined) throw lost;
  if (!accepted(result) || result.data === undefined) return undefined;
  return result.data.harness ?? undefined;
}

/** Test seams: the plane's selection, the machine-login probes, the
 * local sign-in and the selection write. */
export interface CoderDeps {
  harnessOf?: (plane: Plane) => Promise<HarnessView | undefined>;
  probe?: (coder: Coder) => Promise<boolean>;
  signIn?: (coder: Coder) => Promise<{ ok: boolean; detail: string }>;
  select?: (plane: Plane, coder: Coder) => Promise<void>;
  /** A folder holding the coder tools by their words (a test's fakes);
   * the machine's own PATH otherwise. */
  binDir?: string;
}

type Resolved = Required<Omit<CoderDeps, 'binDir'>>;

/** Asks the machine's own coder tool whether this machine is signed in
 * to the coder: `claude auth status` answers JSON with `loggedIn`,
 * `codex login status` says "Logged in" (on stderr). A missing tool or
 * a command that fails reads as not signed in. The login store itself
 * is left to the tool. */
export function probeMachineLogin(coder: Coder, binDir?: string): boolean {
  const run = runCoderTool(
    coder,
    coder === 'claude-code' ? ['auth', 'status'] : ['login', 'status'],
    binDir,
    { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (run.error !== undefined || run.status !== 0) return false;
  if (coder === 'codex') {
    const text = `${run.stdout}${run.stderr}`;
    return /logged in/i.test(text) && !/not logged in/i.test(text);
  }
  try {
    const status = JSON.parse(run.stdout) as { loggedIn?: unknown };
    return status.loggedIn === true;
  } catch {
    return false;
  }
}

/** Runs the vendor's own sign-in in the user's terminal with the
 * machine's own tool: the vendor opens the browser and serves its own
 * callback, and the login lands in the machine's own store, so the
 * user is signed in for their own tool from then on. */
export function signInLocally(coder: Coder, binDir?: string): { ok: boolean; detail: string } {
  const run = runCoderTool(coder, coder === 'claude-code' ? ['auth', 'login'] : ['login'], binDir, {
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 15 * 60_000,
  });
  if (run.error !== undefined) {
    return {
      ok: false,
      detail: `the ${CODER_WORDS[coder]} sign-in could not start (${run.error.message})`,
    };
  }
  if (!probeMachineLogin(coder, binDir)) {
    const exit = run.status === null || run.status === 0 ? '' : ` (exit ${String(run.status)})`;
    return { ok: false, detail: `the ${CODER_WORDS[coder]} sign-in did not complete${exit}` };
  }
  return { ok: true, detail: `signed in to ${LOGIN_WORDS[coder]}` };
}

function resolveDeps(deps: CoderDeps): Resolved {
  const binDir = deps.binDir;
  return {
    harnessOf: deps.harnessOf ?? planeHarness,
    probe:
      deps.probe ??
      ((coder): Promise<boolean> => Promise.resolve(probeMachineLogin(coder, binDir))),
    signIn:
      deps.signIn ??
      ((coder): Promise<{ ok: boolean; detail: string }> =>
        Promise.resolve(signInLocally(coder, binDir))),
    select: deps.select ?? ((plane, coder): Promise<void> => setPlaneHarness(plane, coder, 'plan')),
  };
}

/** Which machine logins the local plane can compile on: claude first,
 * codex second; `also` names the other when both are signed in. */
export async function detectCoder(
  probe: (coder: Coder) => Promise<boolean>,
): Promise<{ coder?: Coder; also?: Coder }> {
  const claude = await probe('claude-code');
  const codex = await probe('codex');
  if (claude) return codex ? { coder: 'claude-code', also: 'codex' } : { coder: 'claude-code' };
  if (codex) return { coder: 'codex' };
  return {};
}

function foundLine(coder: Coder, also?: Coder): string {
  const line = `ai coder: ${CODER_WORDS[coder]} (${LOGIN_WORDS[coder]})`;
  return also === undefined
    ? line
    : `${line}; ${CODER_WORDS[also]} is available too; switch with: cernanto dev --coder ${CODER_WORDS[also]}`;
}

/** One coder's sign-in in the terminal, then the plane's selection.
 * Throws with the sign-in's own words when it fails. */
async function signInCoder(
  plane: Plane,
  io: ConnectIo,
  deps: Resolved,
  coder: Coder,
): Promise<void> {
  const login = await deps.signIn(coder);
  if (!login.ok) throw new CernantoError({ kind: 'terminal', message: login.detail });
  await deps.select(plane, coder);
  io.write(`${login.detail}; the plane compiles and judges on ${CODER_WORDS[coder]}\n\n`);
}

/** The two-row screen, shown only when nothing is signed in: the
 * vendor's own sign-in runs right here in the terminal, then the
 * plane's selection is written. */
async function signInHere(plane: Plane, io: ConnectIo, deps: Resolved): Promise<void> {
  io.write('ai coder: none yet; a compile needs one to write the code\n');
  CODER_ROWS.forEach((choice, index) => {
    io.write(`  ${String(index + 1)}. ${choice.row.padEnd(11)}${choice.hint}\n`);
  });
  let picked: Coder | undefined;
  while (picked === undefined) {
    const answer = (await io.ask('connect which? [1]', false)).trim().toLowerCase();
    if (answer === '') {
      picked = 'claude-code';
      break;
    }
    picked = CODER_ROWS.find(
      (choice, index) =>
        choice.row === answer ||
        CODER_WORDS[choice.coder] === answer ||
        String(index + 1) === answer,
    )?.coder;
    if (picked === undefined) io.write('  claude or chatgpt (1 or 2)\n');
  }
  await signInCoder(plane, io, deps, picked);
}

/**
 * Makes sure the plane has an ai coder before a compile is submitted. A
 * plane with a selection passes silently. Without one, this machine's
 * own logins decide, claude first, with one printed line and no
 * question; when nothing is signed in, a terminal gets the two-row
 * screen and the vendor's own sign-in right here, and a pipe refuses
 * with the commands to run.
 */
export async function ensureCompileHarness(
  plane: Plane,
  io: ConnectIo | undefined,
  deps: CoderDeps = {},
): Promise<void> {
  const resolved = resolveDeps(deps);
  if ((await resolved.harnessOf(plane)) !== undefined) return;
  const found = await detectCoder(resolved.probe);
  if (found.coder !== undefined) {
    await resolved.select(plane, found.coder);
    io?.write(`${foundLine(found.coder, found.also)}\n`);
    return;
  }
  if (io === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: `no ai coder is signed in on this machine; sign in first: ${SIGN_IN_COMMANDS}`,
    });
  }
  await signInHere(plane, io, resolved);
}

/**
 * The dev bootstrap's coder step (`cernanto dev`): the same resolution
 * the deploy guard runs, asked where the plane is initialized, so the
 * first deploy just compiles. An earlier pick stands: it is probed again
 * and reported. Without one, this machine's logins decide, claude
 * first, in one printed line; nothing signed in gets the screen at a
 * terminal, and off a terminal the dev goes on (the deploy guard stays
 * the backstop). `coder` is the `--coder` flag: the flag answers the
 * question in place of the prompt; a coder that is not signed in signs
 * in at a terminal and prints the command on a pipe.
 */
export async function setupHarness(
  plane: Plane,
  io: ConnectIo | undefined,
  say: (line: string) => void,
  deps: CoderDeps = {},
  options: { coder?: Coder } = {},
): Promise<void> {
  const resolved = resolveDeps(deps);
  let current: HarnessView | undefined;
  try {
    current = await resolved.harnessOf(plane);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    say(`ai coder: could not read the plane's state (${detail}); the first deploy checks again`);
    return;
  }
  const coder = options.coder;
  try {
    if (coder !== undefined) {
      if (await resolved.probe(coder)) {
        if (current?.vendor !== coder || current.mode !== 'plan') {
          await resolved.select(plane, coder);
        }
        say(foundLine(coder));
        return;
      }
      if (io === undefined) {
        say(
          `ai coder: ${CODER_WORDS[coder]} is not signed in on this machine; sign in with: cernanto dev --coder ${CODER_WORDS[coder]}`,
        );
        return;
      }
      await signInCoder(plane, io, resolved, coder);
      return;
    }
    if (current !== undefined) {
      const chosen =
        current.vendor === 'claude-code' || current.vendor === 'codex' ? current.vendor : undefined;
      if (chosen === undefined || current.mode !== 'plan') {
        say(`ai coder: ${current.vendor} (${current.mode})`);
        return;
      }
      say(
        (await resolved.probe(chosen))
          ? foundLine(chosen)
          : `ai coder: ${CODER_WORDS[chosen]} (${LOGIN_WORDS[chosen]} is gone; sign in with: cernanto dev --coder ${CODER_WORDS[chosen]})`,
      );
      return;
    }
    const found = await detectCoder(resolved.probe);
    if (found.coder !== undefined) {
      await resolved.select(plane, found.coder);
      say(foundLine(found.coder, found.also));
      return;
    }
    if (io === undefined) {
      say(`ai coder: none yet; a compile needs one. sign in with: ${SIGN_IN_COMMANDS}`);
      return;
    }
    await signInHere(plane, io, resolved);
  } catch (error) {
    // The plane is up either way; the sign-in can be retried, and the
    // deploy guard asks again before any compile.
    const detail = error instanceof Error ? error.message : String(error);
    say(
      `ai coder: the sign-in did not complete (${detail}); sign in later with: ${SIGN_IN_COMMANDS}`,
    );
  }
}

/** The compile's coder guard: on a real terminal a plane with no ai
 * coder connected offers the chooser and signs one in right here; a
 * pipe refuses with the command to run. */
export async function ensureCoder(plane: Plane): Promise<void> {
  await ensureCompileHarness(plane, interactive() ? terminalIo() : undefined);
}

/** The local plane starts when a command needs it: a command on the
 * loopback plane that finds nothing listening starts the plane (one
 * line printed) and goes on. Registered by the program for every verb;
 * the `dev` verbs manage the plane themselves. */
export function startBoxWhenNeeded(): void {
  whenLoopbackDown(async () => {
    // The local plane is the local context's and no other's: a server
    // whose own plane answers on its loopback, logged in under a name
    // of its own, gets the failed request, never a plane beside its own.
    const context = currentContextName();
    if (context !== undefined && context !== 'local') return false;
    // The plane starts only where a release is, the tree or the runtime
    // the dev verb installed; a machine with neither hears what to do
    // instead of a start that cannot happen (the failed request then
    // says the plane is not running, in the same direction).
    if (treeRelease() === undefined && installedRelease() === undefined) {
      process.stderr.write(`${NO_RUNTIME_WORDS}\n`);
      return false;
    }
    process.stderr.write('starting the local plane\n');
    await startNativeDev({
      say: (line) => {
        if (line !== 'starting the local plane') process.stderr.write(`${line}\n`);
      },
    });
    return true;
  });
}

const CODERS: Record<string, Coder> = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
};

export function registerDev(program: Command): void {
  program
    .command('dev')
    .argument('[verb]', 'up (the default), down or reset')
    .option(
      '--coder <name>',
      "the ai coder this plane compiles on (claude or codex): this machine's own login, signed in right here when it is not",
    )
    // The proofs' knobs: a plane of their own, off the help.
    .addOption(new Option('--data-dir <path>', 'the local plane data directory').hideHelp())
    .addOption(new Option('--release-dir <path>', 'the compiled release directory').hideHelp())
    .addOption(
      new Option('--port <port>', 'the local plane port (0 chooses an available port)').hideHelp(),
    )
    .addOption(
      new Option(
        '--registry <url>',
        'the packages host an install pulls the platform from',
      ).hideHelp(),
    )
    .description('the local plane: start it, park it, or wipe it and start fresh')
    .action(
      async (
        verb: string | undefined,
        options: {
          coder?: string;
          dataDir?: string;
          releaseDir?: string;
          port?: string;
          registry?: string;
        },
      ) => {
        try {
          whenLoopbackDown(undefined);
          const io = {
            installRuntime: true,
            ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
            ...(options.releaseDir === undefined ? {} : { releaseDir: options.releaseDir }),
            ...(options.port === undefined ? {} : { gatewayPort: Number(options.port) }),
            ...(options.registry === undefined ? {} : { registry: options.registry }),
            say: (line: string) => {
              process.stdout.write(`${line}\n`);
            },
          };
          const coder =
            options.coder === undefined ? undefined : CODERS[options.coder.toLowerCase()];
          if (options.coder !== undefined && coder === undefined) {
            throw new Error(`no ai coder "${options.coder}"; claude or codex`);
          }
          if (coder !== undefined && verb !== undefined && verb !== 'up') {
            throw new Error(
              `--coder applies to cernanto dev; run: cernanto dev --coder ${options.coder ?? ''}`,
            );
          }
          const afterUp = async (plane: Plane): Promise<void> => {
            // The plane's one-time question, asked where the plane is
            // initialized instead of at the first deploy: which ai
            // coder, and signed in. Off a terminal it only prints the
            // state; the deploy guard stays the backstop.
            await setupHarness(
              plane,
              interactive() ? terminalIo() : undefined,
              io.say,
              {},
              coder === undefined ? {} : { coder },
            );
          };
          if (verb === undefined || verb === 'up') {
            await startNativeDev({ ...io, afterUp });
            return;
          }
          if (verb === 'down') {
            await stopNativeDev(io);
            return;
          }
          if (verb === 'reset') {
            await resetNativeDev({ ...io, afterUp }, true);
            return;
          }
          throw new Error(`no dev verb "${verb}"; use up, down or reset`);
        } catch (error) {
          fail(error);
        }
      },
    );
}
