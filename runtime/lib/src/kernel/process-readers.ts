// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The readers of the machine's processes, one for each system, and the
// one place in the runtime where the code differs by system: /proc on
// Linux, ps on macOS, one PowerShell read on Windows. Each answers the
// same row and says three things of its system: whether it has process
// groups, whether it shows a process's environment, and whether a
// child goes on naming a parent that ended. Whoever asks about
// processes asks the adapter (process-adapter.ts), which reads through
// the reader chosen here and goes by what it answers.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { asRuntimeCommand } from './own-commands.js';

/** One process as a read tells it, the same shape on every system. */
export interface ProcessRow {
  pid: number;
  /** The parent's pid as the system names it. */
  parent: number;
  /** The start as the system's own value, whole, the same at every
   * read of the same process: the kernel's ticks from the boot on
   * Linux (`ticks <n>`), ps's print on macOS, the creation time as a
   * file time on Windows; empty where the read could not tell it. */
  started: string;
  /** The process group, where the system has groups. */
  group: number | undefined;
  /** The user it runs as, where the system names one. */
  user: number | undefined;
  /** Ended and not yet collected: nothing of it is left to stop. */
  zombie: boolean;
  /** The words of its environment, when the read asked for them and
   * the system shows them. */
  environment?: string[];
  /** Whether it is the first process of a pid namespace of its own,
   * where the system has such namespaces and tells it. */
  init?: true;
}

/** What a system does, as its reader says it: the adapter goes by
 * these answers and never by the system's name. */
export interface TableFacts {
  /** Whether processes stand in groups a signal reaches as one. */
  readonly groups: boolean;
  /** Whether a read can show a process's environment. */
  readonly environments: boolean;
  /** Whether a child goes on naming a parent that ended, a pid the
   * system may give again: there a start decides a birth. */
  readonly endedParents: boolean;
  /** Whether a start is told and is not before another, the two
   * compared whole. Asked where a parent's pid may be an ended one's. */
  startedNotBefore(start: string, than: string): boolean;
}

/** What a read takes. */
export interface ReadOptions {
  /** One process alone; no row when the pid names none. */
  pid?: number | undefined;
  /** The environments read too, where the system shows them. */
  environment?: boolean | undefined;
}

/** A system's reader: its rows, this boot's identity and its facts. */
export interface ProcessReader {
  readonly facts: TableFacts;
  /** Every process of the machine, or one. Throws when the list cannot
   * be read at all. */
  read(options?: ReadOptions): Promise<ProcessRow[]>;
  /** An identity of this boot, which a restart of the machine changes;
   * one fixed word where the system keeps none. */
  boot(): Promise<string>;
}

/** What a tool answered: its output, or the code it exited with. */
interface Ran {
  stdout: string;
  code: number;
}

/** A system tool run by its path as the runtime's own command, its
 * output as text. A tool that cannot start, or that does not end in
 * time, is an error; an exit code is the caller's to read. */
function runTool(
  file: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<Ran> {
  return new Promise((done, failed) => {
    asRuntimeCommand(() =>
      execFile(
        file,
        [...args],
        {
          encoding: 'utf8',
          timeout: options.timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
          ...(options.env === undefined ? {} : { env: options.env }),
        },
        (error, stdout) => {
          if (error === null) {
            done({ stdout, code: 0 });
            return;
          }
          const code = (error as { code?: unknown }).code;
          if (typeof code === 'number' && error.killed !== true) {
            done({ stdout, code });
            return;
          }
          failed(new Error(`${file} could not be run: ${error.message}`));
        },
      ),
    );
  });
}

/** The words of a command line split by blanks, as ps prints them. */
function blankSeparatedWords(command: string): string[] {
  return command.split(/\s+/).filter((word) => word !== '');
}

/** A system that hands a child whose parent ended to another process
 * at once: the parent a row names is a live one, and no start is asked
 * to decide a birth. */
const LIVE_PARENTS = {
  endedParents: false,
  startedNotBefore: (): boolean => true,
} as const;

/** The environment a system's tool is run in: its own folders, its
 * plain words, and one time zone that is never this machine's own. A
 * start is written down and compared as the text a tool printed, so
 * it has to be the same text whenever it is asked: a date printed in
 * the machine's own time zone would name another process once that
 * moved, a laptop taken across one. It is spelled so that it needs no
 * file of the system's to be known. */
const POSIX_TOOLS = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', TZ: 'UTC0' } as const;

/** One process read from /proc: its stat line (the state, the parent,
 * the group, the start in the kernel's ticks), its owner, and its
 * environment when asked and readable. Nothing for a process gone
 * between the listing and the read, for a kernel thread, or for one
 * this user may not read. */
async function procRow(pid: number, environment: boolean): Promise<ProcessRow | undefined> {
  const directory = `/proc/${String(pid)}`;
  try {
    const [owner, line, status] = await Promise.all([
      stat(directory),
      readFile(`${directory}/stat`, 'utf8'),
      readFile(`${directory}/status`, 'utf8').catch(() => ''),
    ]);
    // The parenthesized command may itself contain spaces and parentheses.
    const fields = line
      .slice(line.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    const group = Number(fields[2]);
    if (!Number.isSafeInteger(group) || group <= 0) return undefined;
    const ticks = fields[19];
    // A process in a pid namespace of its own carries two numbers
    // there, its pid outside and its pid inside: the first of that
    // namespace is 1 inside.
    const inside = /^NSpid:\s*\d+\s+(\d+)\s*$/m.exec(status);
    const environ = environment
      ? await readFile(`${directory}/environ`, 'utf8').catch(() => undefined)
      : undefined;
    return {
      pid,
      parent: Number(fields[1]),
      started: ticks !== undefined && /^\d+$/.test(ticks) ? `ticks ${ticks}` : '',
      group,
      user: owner.uid,
      zombie: (fields[0] ?? '').startsWith('Z'),
      ...(environ === undefined
        ? {}
        : { environment: environ.split('\0').filter((word) => word !== '') }),
      ...(inside?.[1] === '1' ? { init: true as const } : {}),
    };
  } catch (error) {
    if (
      ['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      return undefined;
    throw error;
  }
}

const linuxReader: ProcessReader = {
  facts: { groups: true, environments: true, ...LIVE_PARENTS },
  read: async (options: ReadOptions = {}): Promise<ProcessRow[]> => {
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
  },
  boot: (): Promise<string> =>
    Promise.resolve(readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()),
};

/** The list as `ps` prints it with `lstart`: pid, parent, group, uid,
 * state and the five fields of the start moment; and, in a read that
 * asked for the environments, the command after them, which holds the
 * environment's words after its own. The command is asked for nothing
 * else, so a read that wants no environment leaves it out. */
export function parsePs(text: string, environment: boolean): ProcessRow[] {
  return text.split('\n').flatMap((line) => {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)(?:\s+(.*))?$/.exec(
        line,
      );
    if (match === null) return [];
    return [
      {
        pid: Number(match[1]),
        parent: Number(match[2]),
        started: (match[6] ?? '').replaceAll(/\s+/g, ' '),
        group: Number(match[3]),
        user: Number(match[4]),
        zombie: (match[5] ?? '').startsWith('Z'),
        ...(environment ? { environment: blankSeparatedWords(match[7] ?? '') } : {}),
      },
    ];
  });
}

const macosReader: ProcessReader = {
  facts: { groups: true, environments: true, ...LIVE_PARENTS },
  read: async (options: ReadOptions = {}): Promise<ProcessRow[]> => {
    const pid = options.pid;
    const environment = options.environment === true;
    // With `eww` ps lays each process's environment into its command
    // line, as far as the system shows it: the one read that asks for
    // the command.
    const ran = await runTool(
      '/bin/ps',
      [
        ...(environment ? ['eww'] : []),
        ...(pid === undefined ? ['-ax'] : ['-p', String(pid)]),
        '-o',
        `pid=,ppid=,pgid=,uid=,stat=,lstart=${environment ? ',args=' : ''}`,
      ],
      { env: POSIX_TOOLS, timeoutMs: 5000 },
    );
    // ps exits 1 for a pid that names no process.
    if (ran.code === 1 && pid !== undefined) return [];
    if (ran.code !== 0) throw new Error(`/bin/ps exited ${String(ran.code)}`);
    return parsePs(ran.stdout, environment);
  },
  boot: async (): Promise<string> => {
    const ran = await runTool('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
      env: POSIX_TOOLS,
      timeoutMs: 5000,
    });
    const text = ran.code === 0 ? ran.stdout.trim() : '';
    if (text !== '') return text;
    throw new Error(
      'the boot identity cannot be read: sysctl kern.bootsessionuuid answered nothing',
    );
  },
};

/** Windows keeps no boot identity a process can read; a restart is
 * told by the processes' creation times instead. */
const WINDOWS_BOOT = 'windows';

/** The read through PowerShell: every process with its parent and its
 * creation time as a file time, tab-separated. The three are all it
 * asks the system for, so the system reads nothing else of a process. */
const WINDOWS_READ =
  '$t=[char]9; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate FILTER | ' +
  'ForEach-Object { @($_.ProcessId,$_.ParentProcessId,' +
  '$(if($_.CreationDate){$_.CreationDate.ToFileTimeUtc()}else{0})) -join $t }';

/** The rows of one PowerShell read. */
export function parseWindowsRead(text: string): ProcessRow[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const [id, parent, started] = line.split('\t');
    if (id === undefined || !/^\d+$/.test(id) || started === undefined) return [];
    return [
      {
        pid: Number(id),
        parent: Number(parent),
        // A creation time the system did not tell is no start.
        started: /^\d+$/.test(started) && !/^0+$/.test(started) ? started : '',
        group: undefined,
        user: undefined,
        zombie: false,
      },
    ];
  });
}

async function windowsRead(pid: number | undefined): Promise<ProcessRow[]> {
  const filter = pid === undefined ? '' : `-Filter 'ProcessId=${String(pid)}'`;
  const powershell = join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const ran = await runTool(
    powershell,
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ.replace('FILTER', filter)],
    { timeoutMs: 30000 },
  );
  if (ran.code !== 0) throw new Error(`the processes cannot be read: exit ${String(ran.code)}`);
  return parseWindowsRead(ran.stdout);
}

/** A read of every process costs half a second there, so the reads
 * asked while one runs share one more read made after it: each asker
 * still gets a read that began after its question. */
let windowsUnderWay: Promise<ProcessRow[]> | undefined;
let windowsNext: Promise<ProcessRow[]> | undefined;

function windowsWhole(): Promise<ProcessRow[]> {
  if (windowsUnderWay === undefined) {
    const read = windowsRead(undefined).finally(() => {
      if (windowsUnderWay === read) windowsUnderWay = undefined;
    });
    windowsUnderWay = read;
    return read;
  }
  windowsNext ??= windowsUnderWay
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      windowsNext = undefined;
      return windowsWhole();
    });
  return windowsNext;
}

/** A creation time as a number: a file time is past what a double
 * holds exactly, and two starts a hundred nanoseconds apart must stay
 * two. Zero where the text is no time. */
function fileTime(text: string): bigint {
  return /^\d+$/.test(text) ? BigInt(text) : 0n;
}

const windowsReader: ProcessReader = {
  facts: {
    groups: false,
    // Windows shows no environment of another process.
    environments: false,
    // It keeps a parent's pid on its children after the parent ended
    // and hands the same pid to a later process, so a child by the pid
    // alone can be an older stranger.
    endedParents: true,
    startedNotBefore: (start: string, than: string): boolean => {
      const started = fileTime(start);
      return started !== 0n && started >= fileTime(than);
    },
  },
  read: (options: ReadOptions = {}): Promise<ProcessRow[]> =>
    options.pid === undefined ? windowsWhole() : windowsRead(options.pid),
  boot: (): Promise<string> => Promise.resolve(WINDOWS_BOOT),
};

/** Every system's reader by its name, for the proofs of one system's
 * rules on another. */
export const readers = {
  linux: linuxReader,
  macos: macosReader,
  windows: windowsReader,
} as const;

function chosen(): ProcessReader {
  if (process.platform === 'win32') return windowsReader;
  return process.platform === 'darwin' ? macosReader : linuxReader;
}

/** The reader of the system this process runs on. */
export const reader: ProcessReader = chosen();
