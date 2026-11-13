// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The launch rule: how a copy is started on a server, by machine facts
// and nothing anyone states. A launcher running as root starts the copy
// as the owner of the plane's root with its capabilities dropped, since
// the code it starts is an author's with its npm packages; with CRIU
// present a copy with a journal (a service, a task, a worker) runs as
// the init of pid and mount namespaces of its own under a holder, since
// CRIU dumps and restores a process reliably in no other form, and a
// job, which keeps no journal, takes no image; the release's host job
// alone keeps the launcher's privileges, when the package it runs is
// the release's own by digest.
// On a laptop nobody is root and none of this runs. The words are
// security-critical and stay hand-written here, never a spec's prose.
//
// `--detach` starts the copy as its own process and exits: the host job
// starts copies from inside a call, and the kernel ends a call's
// commands when the call ends. For a copy on a plane the launcher
// writes the attempt on the record before the spawn, hands it to the
// copy on its command line, and writes the pid with its start and boot
// identities after. `--prepare` lays a generation's folder out for a
// CRIU restore and reserves the restore's attempt, naming the life the
// image holds.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import {
  copyKey,
  issueLaunch,
  lifeOnPlane,
  logNameOf,
  readHolding,
  serviceNameOf,
  updateRecord,
} from '@cernanto/runtime-lib/serve';
import type { Holding, ProcessRecord } from '@cernanto/runtime-lib/serve';
import { childEnvironment, system } from '@cernanto/system';

import { agentUserOf, rootsAloneFolder } from '../agent-user.js';
import type { AgentUser } from '../agent-user.js';
import type { GenerationFacts } from '../generation.js';
import { blobDigestOf, releaseVersionOf } from '../materialize/platform.js';
import { releasePackages } from '../materialize/release-packages.js';
import { AGENT_BIN, PRIVILEGED_AGENT } from '../release-layout.js';
import { errorFileOf, proofsEnvironment } from './place.js';
import type { MachineFacts } from './place.js';

/** The mounts the agent's namespace keeps, by their mountpoints. */
export const KEPT_MOUNTS: readonly string[] = ['/', '/proc', '/dev', '/run'];

/** The program the namespace holder runs as the init of the new
 * namespaces, as root, before the drop and the agent's command line:
 * every mount but the kept ones leaves, the proc last since the tools
 * read it, and a proc of this pid namespace takes the old one's place.
 * It opens nothing: the copy's streams are opened after the drop, by
 * the agents' user, inside the namespace (a descriptor opened outside
 * names a mount the image does not hold, and CRIU refuses it, whatever
 * it is told). */
export const NAMESPACE_PROGRAM: string = [
  'set -e',
  `keep='${KEPT_MOUNTS.join(' ')}'`,
  "for m in $(awk '{ print $5 }' /proc/self/mountinfo | sort -r); do",
  '  case " $keep " in *" $m "*) continue;; esac',
  '  umount -l "$m" 2>/dev/null || true',
  'done',
  'umount -l /proc',
  'mount -t proc -o nosuid,nodev,noexec proc /proc',
  'exec "$@"',
].join('\n');

/** The program the agents' user runs after the drop, before the copy's
 * command line, its first two words the copy's folder and its error
 * file: the user makes the folder and the error file's folder, moves
 * into the folder, empties the error file and runs the command line
 * with its standard input closed and its output and error appended to
 * that file. The launcher, root, opens and makes nothing in a folder
 * the agents' user can write: a link planted there leads only where
 * that user could write anyway. In a namespace the mounts that stayed
 * are said first, since a mount CRIU does not know refuses the dump. */
export function copyProgram(namespaced: boolean): string {
  return [
    'set -e',
    'folder="$1"',
    'log="$2"',
    'shift 2',
    'umask 077',
    'mkdir -p "$folder" "${log%/*}"',
    'cd "$folder"',
    ': >"$log"',
    ...(namespaced
      ? [
          `keep='${KEPT_MOUNTS.join(' ')}'`,
          "for m in $(awk '{ print $5 }' /proc/self/mountinfo); do",
          '  case " $keep " in *" $m "*) ;; *) echo "namespace: $m stays" >>"$log";; esac',
          'done',
        ]
      : []),
    'exec "$@" </dev/null >>"$log" 2>&1',
  ].join('\n');
}

/** Where util-linux's `unshare` is on this machine, an absolute path;
 * nothing where the machine has none. */
export function unsharePath(): string | undefined {
  return ['/usr/bin/unshare', '/bin/unshare'].find((path) => existsSync(path));
}

/** Whether CRIU is on this machine: by its binary's presence, the way
 * the host job reads it. */
export function criuPresent(): boolean {
  return ['/usr/sbin/criu', '/usr/bin/criu', '/usr/local/sbin/criu', '/usr/local/bin/criu'].some(
    (path) => existsSync(path),
  );
}

/** Whether this process is root on a system that has users. */
export function asRoot(): boolean {
  return system.name !== 'windows' && process.getuid?.() === 0;
}

/** The form a copy is started in. */
export type LaunchForm = 'plain' | 'dropped' | 'namespaced' | 'privileged';

/** What the rule reads off the machine; a proof hands its own. */
export interface MachineRule {
  root: boolean;
  user: AgentUser | undefined;
  /** The words that run a command as the agents' user with nothing of
   * root's left, before the command; none where the machine has no way
   * to drop. */
  drop: readonly string[];
  criu: boolean;
  unshare: string | undefined;
  linux: boolean;
}

/** The machine as it is. */
export function machineRule(root: string): MachineRule {
  const user = agentUserOf(root);
  return {
    root: asRoot(),
    user,
    drop: user === undefined ? [] : system.privilegeDrop(user),
    criu: criuPresent(),
    unshare: unsharePath(),
    linux: system.name === 'linux',
  };
}

/** Whether a copy keeps the launcher's privileges: the release's host
 * job, when the package it runs is the release's own by digest. */
export function privileged(release: string, facts: GenerationFacts): boolean {
  if (facts.agentId !== PRIVILEGED_AGENT) return false;
  if (facts.artifact === undefined) return true;
  try {
    const own = releasePackages(release).get(PRIVILEGED_AGENT);
    return own !== undefined && blobDigestOf(own) === facts.artifact;
  } catch {
    return false;
  }
}

/** The form the rule gives a copy. */
export function formOf(facts: GenerationFacts, release: string, machine: MachineRule): LaunchForm {
  if (!machine.root) return 'plain';
  if (privileged(release, facts)) return 'privileged';
  if (facts.type !== 'job' && machine.linux && machine.criu && machine.unshare !== undefined)
    return 'namespaced';
  return 'dropped';
}

/** Where a copy's streams go: its folder and its error file there. */
export interface CopyPlace {
  folder: string;
  errorFile: string;
}

/** The command line that starts `command` in the form given: the
 * holder, the mount program, a session of its own, the drop and the
 * copy program before the command for a namespaced copy; the drop and
 * the copy program for a dropped one, the drop alone when no place is
 * given (the block's own work under the drop, its streams the
 * caller's); the command itself otherwise. A form that drops refuses
 * when it cannot: an agent never runs as root, so a plane whose root
 * folder is root's own, or a machine without the drop's tool, starts
 * no agent. */
export function commandLineOf(
  form: LaunchForm,
  command: readonly string[],
  machine: MachineRule,
  place?: CopyPlace,
): { file: string; args: string[] } {
  const [file, ...rest] = command;
  if (file === undefined) throw new Error('a launch names a program');
  if (form === 'plain' || form === 'privileged') return { file, args: rest };
  if (machine.user === undefined)
    throw new Error(
      "the plane's root folder is root's own, so no agents' user is known and an agent never runs as root: give the root folder to the agents' user",
    );
  const { drop } = machine;
  if (drop.length === 0)
    throw new Error(
      'this machine has no setpriv to drop root before an agent runs, and an agent never runs as root',
    );
  const copy =
    place === undefined
      ? []
      : [
          '/bin/sh',
          '-c',
          copyProgram(form === 'namespaced'),
          'cernanto-copy',
          place.folder,
          place.errorFile,
        ];
  if (form === 'dropped') {
    const [first, ...tail] = drop;
    if (first === undefined) throw new Error('the drop names no program');
    return { file: first, args: [...tail, ...copy, file, ...rest] };
  }
  if (machine.unshare === undefined)
    throw new Error('the copy parks into images and this machine has no unshare command');
  if (place === undefined) throw new Error('a namespaced copy names its folder and its error file');
  return {
    file: machine.unshare,
    args: [
      '--pid',
      '--fork',
      '--mount',
      '--propagation',
      'private',
      '--',
      '/bin/sh',
      '-c',
      NAMESPACE_PROGRAM,
      'cernanto-namespace',
      'setsid',
      ...drop,
      ...copy,
      file,
      ...rest,
    ],
  };
}

/** The environment a copy starts with: the machine's basics every
 * process of the plane gets, made by the system's one rule (a home, a
 * user and a temp folder even where the launcher's environment names
 * none, a proxy from either spelling), the clock and the locale the
 * same on every machine, the proofs' one switch when it is set, and the agent's
 * debug section for a copy of a compile's verification pair alone (its
 * generation's launch carries a form), so the coder's debug lines reach
 * the trace of a test run and nothing of a normal run. Nothing of the
 * launcher's own environment beyond that. A copy handed to another
 * user is given `home`, that user's folder, for its home: the
 * launcher's own home is root's and no agent's to write. */
export function copyEnvironment(
  facts?: { form?: string | undefined },
  home?: string,
): Record<string, string> {
  return {
    ...childEnvironment(),
    ...proofsEnvironment(),
    TZ: 'UTC',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    ...(facts?.form === undefined ? {} : { NODE_DEBUG: 'agent' }),
    ...(home === undefined ? {} : { HOME: home }),
  };
}

/** A fresh attempt: eight hex digits, the name of one launch. */
export function freshAttempt(): string {
  return randomBytes(4).toString('hex');
}

/** What a detached start is asked. */
export interface DetachAsk {
  release: string;
  machine: MachineFacts;
  facts: GenerationFacts;
  /** The copy and its attempt, for a copy on a plane whose record is
   * written; none for a copy of the release's own package at boot. */
  slot?: { copy: number; attempt: string } | undefined;
  folder: string;
  /** The block's own words after the program: the generation, the copy
   * and the attempt, or the agent id. */
  words: string[];
}

/** Whether a link stands at a path. */
function linkAt(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Opens a copy's error file for its launch, created or truncated, in
 * a folder of the launcher's own (a laptop's, or the host job's home): never
 * through a link, and what is opened must be a regular file. The open
 * itself refuses a link where the system has a flag for it; where it
 * has none, the path is looked at first. */
export function openErrorFile(path: string): number {
  const { O_WRONLY, O_CREAT, O_TRUNC } = constants;
  const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  if (noFollow === undefined && linkAt(path))
    throw new Error(`${path} is not a regular file; the copy's error file is refused`);
  const descriptor = openSync(path, O_WRONLY | O_CREAT | O_TRUNC | (noFollow ?? 0), 0o600);
  if (!fstatSync(descriptor).isFile()) {
    closeSync(descriptor);
    throw new Error(`${path} is not a regular file; the copy's error file is refused`);
  }
  return descriptor;
}

/** Starts the copy detached in the form the rule gives it, its error
 * stream into its folder's control file, with a fresh environment, and
 * answers its pid: the pid of the holder for a namespaced copy, which
 * is what a kill, a dump or an adoption addresses. A copy the drop
 * hands to the agents' user makes its folder and opens its error file
 * itself, after the drop: the launcher, root, touches nothing in the
 * agents' folders, and the copy's home is the agents' root, never the
 * launcher's own. The privileged copy's folder is in the host job's
 * home, checked root's alone before anything is made there. */
export async function spawnDetached(ask: DetachAsk): Promise<number> {
  const rule = machineRule(ask.machine.root);
  const form = formOf(ask.facts, ask.release, rule);
  const copy = ask.slot?.copy ?? 0;
  const errorFile = join(ask.folder, errorFileOf(copy));
  const program = [process.execPath, join(ask.release, AGENT_BIN), ...ask.words];
  let child;
  if (form === 'dropped' || form === 'namespaced') {
    const command = commandLineOf(form, program, rule, { folder: ask.folder, errorFile });
    child = spawn(command.file, command.args, {
      cwd: '/',
      detached: true,
      stdio: 'ignore',
      env: copyEnvironment(ask.facts, ask.machine.root),
      windowsHide: true,
    });
  } else {
    if (form === 'privileged') rootsAloneFolder(ask.machine.home);
    mkdirSync(dirname(errorFile), { recursive: true, mode: 0o700 });
    const descriptor = openErrorFile(errorFile);
    const command = commandLineOf(form, program, rule);
    try {
      child = spawn(command.file, command.args, {
        cwd: ask.folder,
        detached: true,
        stdio: ['ignore', descriptor, descriptor],
        env: copyEnvironment(ask.facts),
        windowsHide: true,
      });
    } finally {
      closeSync(descriptor);
    }
  }
  await new Promise<void>((started, failed) => {
    child.once('spawn', started);
    child.once('error', failed);
  });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error(`the copy of ${ask.facts.agentId} did not start`);
  return pid;
}

/** The identity of a process as a record carries it: this boot's, and
 * the process's start where the system's table named one. */
export interface ProcessIdentity {
  started?: string;
  boot: string;
}

/** The identity of a process just started, read off the table: its
 * start as the system tells it and this boot's identity. Read again a
 * few times when the table does not list the pid yet. A start the table
 * never named is left out, and the record then knows its process by the
 * pid alone: an empty start written in its place would read as another
 * process's to whoever compares it with the table's. */
export async function identityOf(pid: number): Promise<ProcessIdentity> {
  const boot = await system.bootIdentity();
  for (let ask = 1; ask <= 10; ask += 1) {
    try {
      const [row] = await system.processTable({ pid });
      if (row !== undefined && row.started !== '') return { started: row.started, boot };
    } catch {
      // The table could not be read: asked again.
    }
    await pause(50);
  }
  return { boot };
}

/** Issues the grant of a copy's log for a launch or a restore, under
 * the life the launch names, or the life the agent's name stands under
 * when it names none (the copy's boot asks the same record). */
export async function issueGrant(
  substrateUrl: string,
  agentId: string,
  generation: number,
  copy: number,
  life?: string,
): Promise<number> {
  const service = serviceNameOf(agentId);
  return issueLaunch(
    substrateUrl,
    logNameOf({ service, generation: String(generation), copy }),
    life ?? (await lifeOnPlane(substrateUrl, service)),
  );
}

/** Writes the attempt on a copy's record before its spawn: the record's
 * process field anew, the pid to come. A record that is gone is a copy
 * with no place on the plane, refused in words. */
export async function reserveAttempt(
  substrateUrl: string,
  generation: number,
  copy: number,
  attempt: string,
  /** The holder this launch acts for: the record must name this host at
   * this epoch still, or the slot is another host's now and the launch
   * is refused in words, never written over the newer holder's. */
  holder: { host: string; epoch: number },
  restores?: string,
  /** The grant issued from the copy's log for this launch, which the
   * copy owns its log by. */
  launch?: number,
): Promise<void> {
  const key = copyKey(generation, copy);
  let moved: string | undefined;
  const written = await updateRecord(substrateUrl, key, (current) => {
    if (current === undefined) return undefined;
    if (current['host'] !== holder.host || current['epoch'] !== holder.epoch) {
      moved = `the slot ${key} is ${String(current['host'])}'s at epoch ${String(current['epoch'])} now, not ${holder.host}'s at ${String(holder.epoch)}; this launch is not its holder's`;
      return undefined;
    }
    return {
      ...current,
      process: {
        attempt,
        at: Date.now(),
        ...(restores === undefined ? {} : { restores }),
        ...(launch === undefined ? {} : { launch }),
      },
    };
  });
  if (moved !== undefined) throw new Error(moved);
  if (written === undefined)
    throw new Error(`no slot record stands for ${key}: this copy has no place on the plane`);
}

/** Writes the pid of the process started under the attempt, with its
 * identity where it is known already; a record that moved on to another
 * attempt meanwhile is left as it is, and the copy, which compares the
 * attempts, leaves. The pid is written the moment the process is
 * started and the identity when the table answered: a record that named
 * an attempt with no pid for long reads as a launch that failed, and is
 * launched again beside the copy that runs. */
export async function recordProcess(
  substrateUrl: string,
  generation: number,
  copy: number,
  attempt: string,
  identity: { pid: number } & Partial<ProcessIdentity>,
): Promise<void> {
  await updateRecord(substrateUrl, copyKey(generation, copy), (current) => {
    const standing = current?.['process'];
    if (
      current === undefined ||
      typeof standing !== 'object' ||
      standing === null ||
      (standing as { attempt?: unknown }).attempt !== attempt
    )
      return undefined;
    return { ...current, process: { ...(standing as Record<string, unknown>), ...identity } };
  });
}

/** Whether the process a record names is alive on this machine as the
 * record says: the pid answers a signal of zero, and its start identity
 * and the boot identity are the record's where the record carries
 * them. */
export async function aliveAsRecorded(recorded: ProcessRecord | undefined): Promise<boolean> {
  if (recorded?.pid === undefined) return false;
  const pid = recorded.pid;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
  }
  try {
    if (recorded.boot !== undefined && recorded.boot !== (await system.bootIdentity()))
      return false;
    if (recorded.started !== undefined && recorded.started !== '') {
      const [row] = await system.processTable({ pid });
      return row !== undefined && row.started === recorded.started;
    }
    return true;
  } catch {
    return true;
  }
}

/** The seed's place: a copy of the release's own package the host job
 * starts, placed as the host job would place it, at the lowest copy index
 * of its generation no record holds, by an exclusive create of the
 * record with this process as its process (the host job is the
 * block's child and names its own pid; the controller's launcher names
 * the pid it started). A record of this host whose process is dead is
 * taken over as this process's. Answers the placement, or nothing when
 * a record of this host already runs a live copy of the generation,
 * which is then the copy and this start is not needed. */
export async function placeSeed(options: {
  machine: MachineFacts;
  release: string;
  facts: GenerationFacts;
  identity: { pid: number } & ProcessIdentity;
  attempt: string;
  /** The host job takes over a live copy's record too: the one that
   * comes back keeps its own child, and the copy of an earlier one is
   * fenced by the attempt and leaves. */
  takeOver?: boolean;
}): Promise<Holding | undefined> {
  const { machine, release, facts, identity, attempt } = options;
  const version = releaseVersionOf(release);
  const service = serviceNameOf(facts.agentId);
  // The seed runs under the life its name stands under, made when none
  // stands: the launch names it, so the rows that land later are
  // answered the same life.
  const life = facts.life ?? (await lifeOnPlane(machine.substrate, service));
  for (let copy = 0; copy < 64; copy += 1) {
    const key = copyKey(facts.port, copy);
    const standing = await readHolding(machine.substrate, facts.port, copy).catch(() => undefined);
    if (standing !== undefined && standing.holder.host === machine.id) {
      if (options.takeOver !== true && (await aliveAsRecorded(standing.process))) return undefined;
    } else if (standing !== undefined) continue;
    // The grant of the copy's log, issued before the record names the
    // process: the host job owns its log by it.
    const grant = await issueLaunch(
      machine.substrate,
      logNameOf({ service, generation: String(facts.port), copy }),
      life,
    );
    const written = await updateRecord(machine.substrate, key, (current) => {
      const now = Date.now();
      const launched = { attempt, at: now + 1, launch: grant, ...identity };
      if (current === undefined)
        return {
          host: machine.id,
          epoch: 1,
          since: now,
          launch: { ...facts, life, release: version },
          release: version,
          checkpoint: false,
          process: launched,
        };
      if (current['host'] !== machine.id) return undefined;
      // A copy of the release's own package runs the release it was
      // started under: a host job that comes back under a newer release
      // names it on its record, which rolls by no other road.
      const launch = current['launch'];
      return {
        ...current,
        release: version,
        ...(typeof launch === 'object' && launch !== null
          ? { launch: { ...(launch as Record<string, unknown>), release: version } }
          : {}),
        process: launched,
      };
    });
    if (written === undefined) continue;
    return readHolding(machine.substrate, facts.port, copy);
  }
  throw new Error(`no copy index of ${facts.agentId} is free for this host`);
}

/** This process's own identity, as the launcher records a child's. */
export async function ownIdentity(): Promise<{ pid: number } & ProcessIdentity> {
  return { pid: process.pid, ...(await identityOf(process.pid)) };
}
