// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// macOS and Linux: symbolic links, process groups, the shell's tools,
// the process table through /proc on Linux and through ps on macOS.

import { execFileSync } from 'node:child_process';
import { lstatSync, readlinkSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, readlink, stat } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

import { ExecutionFailure, blankSeparatedWords, execute } from './shared.js';
import type {
  Command,
  ProcessRow,
  ProcessTableOptions,
  ProcessUser,
  System,
  SystemName,
} from './system.js';

/** A system tool run with the machine's own path and the C locale, so
 * that it prints what the parsers read; answers its output, and an
 * empty output where it exited 1 for a pid that names no process. */
async function tool(file: string, args: readonly string[], pidAsked: boolean): Promise<string> {
  try {
    return (
      await execute(file, args, {
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' },
        timeoutMs: 5000,
      })
    ).stdout;
  } catch (error) {
    if (pidAsked && error instanceof ExecutionFailure && error.code === 1) return '';
    throw error;
  }
}

/** `[DD-]HH:MM:SS` or `MM:SS[.CC]` as ps prints a processor time, in
 * seconds. */
function secondsOf(text: string): number {
  const [days, clock] = text.includes('-') ? text.split('-') : ['0', text];
  const parts = (clock ?? '0').split(':').map(Number);
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0];
  return Number(days) * 86400 + (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
}

/** The table as `ps` prints it with `lstart`: pid, parent, group, uid,
 * state, the five fields of the start moment, the resident memory, the
 * processor time, then the command. */
function parsePs(text: string): ProcessRow[] {
  return text.split('\n').flatMap((line) => {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(
        line,
      );
    if (match === null) return [];
    return [
      {
        pid: Number(match[1]),
        parent: Number(match[2]),
        group: Number(match[3]),
        uid: Number(match[4]),
        state: match[5] ?? '',
        started: (match[6] ?? '').replaceAll(/\s+/g, ' '),
        executable: '',
        command: match[9] ?? '',
        memoryKiB: Number(match[7]),
        cpuSeconds: secondsOf(match[8] ?? '0'),
      },
    ];
  });
}

/** The table through `ps`, every process or one: the start is ps's
 * `lstart` print; with `environment`, ps lays each process's
 * environment into its command line (`eww`), where a tag is read. */
async function tableByPs(options: ProcessTableOptions): Promise<ProcessRow[]> {
  const pid = options.pid;
  const text = await tool(
    '/bin/ps',
    [
      ...(options.environment === true ? ['eww'] : []),
      ...(pid === undefined ? ['-ax'] : ['-p', String(pid)]),
      '-o',
      'pid=,ppid=,pgid=,uid=,stat=,lstart=,rss=,time=,args=',
    ],
    pid !== undefined,
  );
  return parsePs(text);
}

/** One process read from /proc: its stat line (the state, the parent,
 * the group, the start in the kernel's ticks), its owner, its command
 * line, its executable where readable, and its environment when asked
 * and readable. Nothing for a process gone between the listing and
 * the read, for a kernel thread, or for one this user may not read. */
async function procRow(pid: number, environment: boolean): Promise<ProcessRow | undefined> {
  const directory = `/proc/${String(pid)}`;
  try {
    const [metadata, status, cmdline, memory] = await Promise.all([
      stat(directory),
      readFile(`${directory}/stat`, 'utf8'),
      readFile(`${directory}/cmdline`, 'utf8'),
      readFile(`${directory}/status`, 'utf8').catch(() => ''),
    ]);
    // The parenthesized command may itself contain spaces and parentheses.
    const fields = status
      .slice(status.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    const group = Number(fields[2]);
    if (!Number.isSafeInteger(group) || group <= 0) return undefined;
    const ticks = fields[19];
    // The user and system times in clock ticks, a hundred to the second.
    const cpuSeconds = (Number(fields[11] ?? 0) + Number(fields[12] ?? 0)) / 100;
    const resident = /^VmRSS:\s*(\d+)\s*kB/m.exec(memory);
    const [executable, environ] = await Promise.all([
      readlink(`${directory}/exe`).catch(() => ''),
      environment
        ? readFile(`${directory}/environ`, 'utf8').catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    return {
      pid,
      parent: Number(fields[1]),
      group,
      uid: metadata.uid,
      state: fields[0] ?? '',
      started: ticks !== undefined && /^\d+$/.test(ticks) ? `ticks ${ticks}` : '',
      executable,
      command: cmdline.replaceAll('\0', ' ').trim(),
      memoryKiB: resident === null ? 0 : Number(resident[1]),
      cpuSeconds,
      ...(environ === undefined
        ? {}
        : { environment: environ.split('\0').filter((word) => word !== '') }),
    };
  } catch (error) {
    if (
      ['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      return undefined;
    throw error;
  }
}

/** The table through /proc, every process or one. */
async function tableByProc(options: ProcessTableOptions): Promise<ProcessRow[]> {
  const pids =
    options.pid === undefined
      ? (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry)).map(Number)
      : [options.pid];
  const rows: ProcessRow[] = [];
  // Bound open descriptors even on a host with many processes.
  for (let offset = 0; offset < pids.length; offset += 32) {
    const batch = await Promise.all(
      pids.slice(offset, offset + 32).map((pid) => procRow(pid, options.environment === true)),
    );
    for (const row of batch) if (row !== undefined) rows.push(row);
  }
  return rows;
}

/** The folder a process works in: its cwd link on Linux, lsof's answer
 * on macOS. */
async function workingFolderOf(name: SystemName, pid: number): Promise<string | undefined> {
  if (name === 'linux') {
    try {
      return await readlink(`/proc/${String(pid)}/cwd`);
    } catch {
      return undefined;
    }
  }
  try {
    const text = await tool('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], true);
    return text
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
  } catch {
    return undefined;
  }
}

/** A boot's identity: the kernel's boot id on Linux, the boot session
 * uuid on macOS. */
async function bootIdentity(name: SystemName): Promise<string> {
  if (name === 'linux') return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const text = (await tool('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], false)).trim();
  if (text !== '') return text;
  throw new Error('the boot identity cannot be read: sysctl kern.bootsessionuuid answered nothing');
}

/** The machine's stable name: on macOS the local host name, which the
 * network's naming does not move (the kernel's hostname follows the
 * DHCP lease and the mDNS name); the hostname on Linux, and on macOS
 * when the local host name cannot be read. */
function hostName(name: SystemName): string {
  if (name !== 'linux') {
    try {
      const local = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (local !== '') return local;
    } catch {
      // The hostname below.
    }
  }
  return hostname();
}

const CHILD_ENVIRONMENT_NAMES: readonly string[] = [
  'PATH',
  'HOME',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'LANG',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
];

/** A symbolic link at `link` to `target`, the target's text kept as
 * given: kept when it already points there, replaced when it points
 * elsewhere or dangles, refused when the entry there is not a link. */
function symbolicLink(target: string, link: string): void {
  try {
    if (!lstatSync(link).isSymbolicLink())
      throw new Error(`${link} is not a link; remove it so the link can be made`);
    if (readlinkSync(link) === target) return;
    unlinkSync(link);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  symlinkSync(target, link);
}

/** A process and what it started, theirs too, by the rows' parents:
 * here a child whose parent ended is handed to another process at
 * once, so the parent a row names is a live one. */
export function posixTreeOf(rows: readonly ProcessRow[], root: number): ProcessRow[] {
  const first = rows.find((row) => row.pid === root);
  if (first === undefined) return [];
  const tree = [first];
  const taken = new Set([root]);
  for (const parent of tree) {
    for (const row of rows) {
      if (row.parent !== parent.pid || taken.has(row.pid)) continue;
      taken.add(row.pid);
      tree.push(row);
    }
  }
  return tree;
}

export function posix(name: Exclude<SystemName, 'windows'>): System {
  return {
    name,
    defaultPath: '/usr/local/bin:/usr/bin:/bin',
    childEnvironmentNames: CHILD_ENVIRONMENT_NAMES,
    usualToolFolders: (): string[] => [
      join(homedir(), '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ],
    linkFolder: symbolicLink,
    linkFile: symbolicLink,
    ownsFolder: (folder: string): boolean => {
      try {
        return statSync(folder).uid === process.getuid?.();
      } catch {
        return false;
      }
    },
    processTable: (options: ProcessTableOptions = {}): Promise<ProcessRow[]> =>
      name === 'linux' ? tableByProc(options) : tableByPs(options),
    commandWords: blankSeparatedWords,
    bootIdentity: (): Promise<string> => bootIdentity(name),
    hostName: (): string => hostName(name),
    workingFolderOf: (pid: number): Promise<string | undefined> => workingFolderOf(name, pid),
    treeOf: posixTreeOf,
    killTree: (pid: number): Promise<void> => {
      // The group of the pid, which a launch of ours leads; the pid
      // alone when it leads none. A process already gone is taken as
      // killed.
      for (const target of [-pid, pid]) {
        try {
          process.kill(target, 'SIGKILL');
          return Promise.resolve();
        } catch {
          // The next target, or nothing left to kill.
        }
      }
      return Promise.resolve();
    },
    openerCommand: (url: string): Command =>
      name === 'macos' ? { file: 'open', args: [url] } : { file: 'xdg-open', args: [url] },
    // Linux's capabilities: a child of a process holding them inherits
    // the ambient set across exec, so a launch drops both sets first,
    // through util-linux's setpriv where the system has it. A named
    // user is taken with the bounding set emptied as well, which takes
    // a capability only a privileged host job holds; a host job that is a plain
    // user runs its children as itself and keeps the bounding set it
    // cannot change.
    privilegeDrop: (as?: ProcessUser): string[] => {
      if (name !== 'linux') return [];
      const setpriv = ['/usr/bin/setpriv', '/bin/setpriv', '/usr/sbin/setpriv'].find((path) =>
        existsSync(path),
      );
      if (setpriv === undefined) return [];
      const user =
        as === undefined
          ? []
          : [
              `--reuid=${String(as.uid)}`,
              `--regid=${String(as.gid)}`,
              '--clear-groups',
              '--bounding-set=-all',
            ];
      return [setpriv, ...user, '--inh-caps=-all', '--ambient-caps=-all', '--'];
    },
  };
}
