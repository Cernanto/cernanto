// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// Windows: junctions and copies, the process table through PowerShell,
// the system's own tree kill, the shell for a tool's `.cmd` shim.

import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';

import { copyWhenMoved, realOrSelf } from './shared.js';
import type { Command, ProcessRow, ProcessTableOptions, System } from './system.js';

/** Windows keeps no boot identity a process can read; a reboot is told
 * by the processes' creation times instead. */
const WINDOWS_BOOT = 'windows';

/** The table read through PowerShell: every process with its parent,
 * its creation time as a file time, its executable and its command
 * line, tab-separated. */
const TABLE_COMMAND =
  '$t=[char]9; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
  'Get-CimInstance Win32_Process FILTER | ForEach-Object { @($_.ProcessId,$_.ParentProcessId,' +
  '$(if($_.CreationDate){$_.CreationDate.ToFileTimeUtc()}else{0}),' +
  '$_.WorkingSetSize,($_.UserModeTime+$_.KernelModeTime),' +
  '$_.ExecutablePath,$_.CommandLine) -join $t }';

function readTable(pid: number | undefined): Promise<ProcessRow[]> {
  const filter = pid === undefined ? '' : `-Filter 'ProcessId=${String(pid)}'`;
  return new Promise((done, failed) => {
    execFile(
      tool('WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', TABLE_COMMAND.replace('FILTER', filter)],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          failed(new Error(`the process table cannot be read: ${error.message}`));
          return;
        }
        done(
          stdout.split(/\r?\n/).flatMap((line) => {
            const [id, parent, started, working, times, executable, ...command] = line.split('\t');
            if (id === undefined || !/^\d+$/.test(id) || started === undefined) return [];
            const number = Number(id);
            return [
              {
                pid: number,
                parent: Number(parent),
                group: number,
                uid: -1,
                state: '',
                started,
                executable: executable ?? '',
                command: command.join('\t'),
                memoryKiB: Math.floor(Number(working ?? 0) / 1024),
                // The times are in units of a hundred nanoseconds.
                cpuSeconds: Number(times ?? 0) / 1e7,
              },
            ];
          }),
        );
      },
    );
  });
}

/** A read of the whole table costs half a second, so the reads asked
 * while one runs share it, and the ones asked meanwhile share one more
 * read after it, as fresh as their question. */
let tableUnderWay: Promise<ProcessRow[]> | undefined;
let tableNext: Promise<ProcessRow[]> | undefined;

function wholeTable(): Promise<ProcessRow[]> {
  if (tableUnderWay === undefined) {
    const read = readTable(undefined).finally(() => {
      if (tableUnderWay === read) tableUnderWay = undefined;
    });
    tableUnderWay = read;
    return read;
  }
  tableNext ??= tableUnderWay
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      tableNext = undefined;
      return wholeTable();
    });
  return tableNext;
}

/** The processes of a tree in the table, the root first, each after
 * its parent. A process is another's child when the table names that
 * one as its parent and it started no earlier than the parent did:
 * Windows keeps a parent's pid on its children after the parent ended
 * and hands the same pid to a later process, so a child by the pid
 * alone can be an older stranger. A start the table could not name
 * reads as the earliest, and such a process is nobody's child. */
export function windowsTreeOf(rows: readonly ProcessRow[], root: number): ProcessRow[] {
  const startOf = (row: ProcessRow): bigint =>
    /^\d+$/.test(row.started) ? BigInt(row.started) : 0n;
  const first = rows.find((row) => row.pid === root);
  if (first === undefined) return [];
  const tree = [first];
  const taken = new Set([root]);
  for (const parent of tree) {
    for (const row of rows) {
      if (row.parent !== parent.pid || taken.has(row.pid)) continue;
      const started = startOf(row);
      if (started === 0n || started < startOf(parent)) continue;
      taken.add(row.pid);
      tree.push(row);
    }
  }
  return tree;
}

/** A Windows command line as its words: an argument with a space rides
 * in double quotes, a quote inside one behind a backslash. */
export function windowsCommandWords(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let quoted = false;
  let any = false;
  for (let at = 0; at < command.length; at += 1) {
    const char = command.charAt(at);
    if (char === '\\') {
      let slashes = 1;
      while (command.charAt(at + slashes) === '\\') slashes += 1;
      if (command.charAt(at + slashes) === '"') {
        word += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2 === 1) {
          word += '"';
          at += slashes;
        } else {
          at += slashes - 1;
        }
      } else {
        word += '\\'.repeat(slashes);
        at += slashes - 1;
      }
      any = true;
    } else if (char === '"') {
      quoted = !quoted;
      any = true;
    } else if (!quoted && (char === ' ' || char === '\t')) {
      if (any) words.push(word);
      word = '';
      any = false;
    } else {
      word += char;
      any = true;
    }
  }
  if (any) words.push(word);
  return words;
}

/** The variables a Windows program stands on, beside the ones every
 * system's child needs. */
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
  'SystemRoot',
  'windir',
  'SystemDrive',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'USERNAME',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
];

/** Windows' own folder, where its tools live. */
function systemRoot(): string {
  return process.env['SystemRoot'] ?? 'C:\\Windows';
}

function tool(...path: string[]): string {
  return join(systemRoot(), 'System32', ...path);
}

/** Two paths name one file when they resolve to the same text, read
 * without regard to case or to the direction of a separator. */
function samePath(one: string, other: string): boolean {
  return realOrSelf(resolve(one)).toLowerCase() === realOrSelf(resolve(other)).toLowerCase();
}

/** A junction at `link` to the folder `target`: a symbolic link needs a
 * privilege an ordinary account lacks, a junction needs none, takes an
 * absolute target and is read back in the system's own spelling. */
function junction(target: string, link: string): void {
  try {
    if (!lstatSync(link).isSymbolicLink())
      throw new Error(`${link} is not a link; remove it so the link can be made`);
    if (samePath(readlinkSync(link), target)) return;
    unlinkSync(link);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  symlinkSync(resolve(target), link, 'junction');
}

export function windows(): System {
  return {
    name: 'windows',
    defaultPath: `${tool()};${systemRoot()}`,
    childEnvironmentNames: CHILD_ENVIRONMENT_NAMES,
    usualToolFolders: (env: NodeJS.ProcessEnv): string[] => [
      join(homedir(), '.local', 'bin'),
      join(env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'npm'),
    ],
    linkFolder: junction,
    linkFile: copyWhenMoved,
    // A folder's access here is its list, not one owning user.
    ownsFolder: (folder: string): boolean => existsSync(folder),
    // Windows gives no environment of another process to read and no
    // folder it works in.
    processTable: (options: ProcessTableOptions = {}): Promise<ProcessRow[]> =>
      options.pid === undefined ? wholeTable() : readTable(options.pid),
    commandWords: windowsCommandWords,
    bootIdentity: (): Promise<string> => Promise.resolve(WINDOWS_BOOT),
    hostName: (): string => hostname(),
    workingFolderOf: (): Promise<string | undefined> => Promise.resolve(undefined),
    // The tree is read off the table by parents and starts, never by
    // the system's own tree kill, which follows the parent's pid alone
    // and so ends a stranger that an earlier process under the same pid
    // left behind. Each process is ended by its own pid, the leaves
    // first; with no table the root alone is ended.
    treeOf: windowsTreeOf,
    killTree: async (pid: number): Promise<void> => {
      let rows: ProcessRow[] = [];
      try {
        rows = await wholeTable();
      } catch {
        // The root is ended without its tree.
      }
      const tree = windowsTreeOf(rows, pid).map((row) => row.pid);
      for (const one of tree.length === 0 ? [pid] : tree.reverse()) {
        try {
          process.kill(one, 'SIGKILL');
        } catch {
          // A process that already left answers an error; it is gone.
        }
      }
    },
    // The url is handed to the system's own handler of an address, with
    // no shell between: a shell reads a url's `&` as the end of a
    // command, cuts the address there and runs the rest.
    openerCommand: (url: string): Command => ({
      file: 'rundll32',
      args: ['url.dll,FileProtocolHandler', url],
    }),
    privilegeDrop: (): string[] => [],
  };
}
