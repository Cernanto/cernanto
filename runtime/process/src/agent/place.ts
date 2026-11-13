// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// Where a plane's processes live on this machine, by convention alone:
// the plane's place is the files under the root, the root follows the place the
// release is installed at (never the user a process runs as, since a
// copy on a server runs as the plane's user and must agree with the
// host job), the host's name is the machine's. No file carries a fact
// and no variable is read, with one exception that is the proofs' own:
// a tier running several planes on one machine (three hosts of a local
// plane, a native plane per proof) names a file of its own in
// `CERNANTO_MACHINE`, beside the proofs' two keep switches, and the
// launcher hands it on. A plane an operator runs reads none.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { system } from '@cernanto/system';
import { z } from 'zod';

/** The plane's place as the kernel is handed it: a `file:` url to the
 * root of the files substrate, the laptop's and a single server's store
 * until the machine file names a cloud store. */
export function placeOfRoot(root: string): string {
  return pathToFileURL(root).href;
}

/** The proofs' one switch: the file a plane that is not the machine's
 * own reads its place from. */
export const PROOFS_MACHINE_ENV = 'CERNANTO_MACHINE';

/** The host job's home on a server, root's alone: the release's host
 * job runs with the launcher's privileges kept, so what it runs and
 * writes lives where no agent can write. */
export const SYSTEM_HOME = '/var/lib/cernanto';

/** The system's plane root, a server's: the one folder of the home that
 * is the agents' user's. */
export const SYSTEM_ROOT = '/var/lib/cernanto/agents';

/** Where a release lies on a server. */
export const SYSTEM_RELEASES = '/opt/cernanto/';

/** This machine's facts for the plane's processes. */
export interface MachineFacts {
  /** The host's name, its key on the plane. */
  id: string;
  /** The plane's place: a `file:` url to the root the files substrate
   * works under, or the `dynamodb:` url of the cloud stores. */
  substrate: string;
  /** Where the plane's data lives: the generations' folders, the
   * closure store, the copies' folders. */
  root: string;
  /** Where the release's host job keeps what is its own: its folder,
   * its closure store, the plane's secrets, the images it makes and
   * takes. A server's is root's alone, the root a folder inside it;
   * elsewhere, where nothing runs as root, the root itself. */
  home: string;
  /** The address the copies' call servers bind on this machine: the
   * host's private address on a server (the machine file's), the
   * loopback when none is named. */
  address?: string | undefined;
  /** The settings a proofs' file starts the plane with: settings of
   * agents, which the plane's config agent sets before it answers an
   * ask. */
  settings: Record<string, unknown>;
  /** The host job's own start, where a proofs' file names it: whether
   * the gateway runs on every host, and the host job's lease. They are
   * read by the host job before any agent serves and are no settings. */
  everyHost?: boolean | undefined;
  leaseMs?: number | undefined;
}

/** A server's machine file, the one fact a server cannot read off
 * itself: the plane's place (a `dynamodb:` url for a plane on the cloud
 * store), beside the host's private address, written by the installer,
 * root's and readable by every process. The reader takes the keys it
 * knows and passes over the rest. A server without the file runs the
 * files substrate under the system's root. */
export const SYSTEM_MACHINE_FILE = '/etc/cernanto/machine.json';

const machineFile = z.object({
  substrate: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
});

/** The server's machine file, when one stands; a file that is not of
 * the shape is refused in words, since a server whose place is misread
 * would start a plane of its own on its disk. */
function systemMachine(): z.infer<typeof machineFile> | undefined {
  if (!existsSync(SYSTEM_MACHINE_FILE)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(SYSTEM_MACHINE_FILE, 'utf8'));
  } catch (error) {
    throw new Error(
      `the machine file ${SYSTEM_MACHINE_FILE} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const read = machineFile.safeParse(parsed);
  if (!read.success) {
    const words = read.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || 'the file'}: ${issue.message}`)
      .join('; ');
    throw new Error(`the machine file ${SYSTEM_MACHINE_FILE} is refused: ${words}`);
  }
  return read.data;
}

const proofsFile = z.strictObject({
  id: z.string().min(1),
  substrate: z.string().min(1).optional(),
  root: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  everyHost: z.boolean().optional(),
  leaseMs: z.number().positive().optional(),
});

/** The laptop's plane folder: the user's own. */
export function laptopRoot(): string {
  return join(process.env['HOME'] ?? homedir(), '.cernanto', 'dev');
}

/** The root by the release's place: a release under the system's
 * folder means the system's root, any other place the laptop's. */
export function rootOfRelease(release: string): string {
  return release.startsWith(SYSTEM_RELEASES) ? SYSTEM_ROOT : laptopRoot();
}

/** The host job's home by the release's place: a server's, which holds
 * its root, the laptop's root itself anywhere else. */
export function homeOfRelease(release: string): string {
  return release.startsWith(SYSTEM_RELEASES) ? SYSTEM_HOME : laptopRoot();
}

/** The machine's facts: the conventions by the release's place, or the
 * proofs' file where a proof names one. */
export function machineFacts(release: string): MachineFacts {
  const named = process.env[PROOFS_MACHINE_ENV];
  if (named === undefined || named === '') {
    // A server's machine file names the plane's place and the host's
    // address; a laptop has none, and a server without one runs the
    // files substrate under the system's root.
    const machine = release.startsWith(SYSTEM_RELEASES) ? systemMachine() : undefined;
    return {
      id: system.hostName(),
      substrate: machine?.substrate ?? placeOfRoot(rootOfRelease(release)),
      root: rootOfRelease(release),
      home: homeOfRelease(release),
      ...(machine?.address === undefined ? {} : { address: machine.address }),
      settings: {},
    };
  }
  if (!existsSync(named)) throw new Error(`the proofs' machine file ${named} does not exist`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(named, 'utf8'));
  } catch (error) {
    throw new Error(
      `the proofs' machine file ${named} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const read = proofsFile.safeParse(parsed);
  if (!read.success) {
    const words = read.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || 'the file'}: ${issue.message}`)
      .join('; ');
    throw new Error(`the proofs' machine file ${named} is refused: ${words}`);
  }
  // A proofs' plane never runs as root: the host job keeps its own in
  // the root the file names.
  const root = read.data.root ?? rootOfRelease(release);
  return {
    id: read.data.id,
    substrate: read.data.substrate ?? placeOfRoot(root),
    root,
    home: read.data.root ?? homeOfRelease(release),
    ...(read.data.address === undefined ? {} : { address: read.data.address }),
    settings: read.data.settings ?? {},
    ...(read.data.everyHost === undefined ? {} : { everyHost: read.data.everyHost }),
    ...(read.data.leaseMs === undefined ? {} : { leaseMs: read.data.leaseMs }),
  };
}

/** The proofs' switch as a child's environment carries it: the one
 * variable the launcher hands on, when it is set. */
export function proofsEnvironment(): Record<string, string> {
  const named = process.env[PROOFS_MACHINE_ENV];
  return named === undefined || named === '' ? {} : { [PROOFS_MACHINE_ENV]: named };
}

/** A generation's name, the controller's spelling: the agent's id as a
 * slug and the generation's id.
 * @example generationName('cernanto/packages', 19990); // 'cernanto-packages-s19990'
 */
export function generationName(agentId: string, port: number): string {
  const slug = agentId.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-');
  return `${slug}-s${String(port)}`;
}

/** The folder a generation's copies boot from. */
export function generationFolder(root: string, agentId: string, port: number): string {
  return join(root, 'generations', generationName(agentId, port));
}

/** The file a copy's error stream goes to, under the generation
 * folder's control folder: the first copy's is the plain file, a later
 * copy's carries its number. */
export function errorFileOf(copy: number): string {
  return join('control', copy === 0 ? 'stderr' : `stderr-c${String(copy)}`);
}

/** The path, under a generation's folder, of one of a copy's words in
 * the control folder (`prepared`, `address`): the first copy's is the
 * plain file, a later copy's carries its number, as its error file. */
export function wordFileOf(copy: number, name: string): string {
  return join('control', copy === 0 ? name : `${name}-c${String(copy)}`);
}
