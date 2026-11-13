// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The contract of the system under the cli and the runtime: what
// differs between macOS, Linux and Windows. What is the same everywhere
// is written once, by the consumers themselves.

/** The name of the system this process runs on. */
export type SystemName = 'macos' | 'linux' | 'windows';

/** The operator's own places and names, as the system names them. */
export interface Operator {
  /** The home folder, where the vendor tools keep their logins. */
  home: string;
  /** The account's name. */
  user: string;
  /** The folder for temporary files. */
  tmpdir: string;
  /** The search path for programs, with the system's own when none is set. */
  path: string;
}

/** A command to run: a file and its arguments. */
export interface Command {
  file: string;
  args: string[];
}

/** A user a child runs as: its ids on this system. */
export interface ProcessUser {
  uid: number;
  gid: number;
}

/** One row of the process table, the same shape on every system; a
 * fact the system does not tell is empty or minus one. */
export interface ProcessRow {
  pid: number;
  /** The parent's pid. */
  parent: number;
  /** The process group the process belongs to; the pid itself where
   * the system has no groups. */
  group: number;
  /** The owner's uid; -1 where the system has none. */
  uid: number;
  /** The state as the system prints it, a zombie's beginning with `Z`;
   * empty where the system tells none. */
  state: string;
  /** The start moment as text, the same at every read of the same
   * process: the kernel's clock ticks from the boot (`ticks <n>`) where
   * /proc exists, which no step of the system clock moves; ps's
   * `lstart` print elsewhere on posix; the creation time on Windows;
   * empty where unknown. */
  started: string;
  /** The executable's path where the system tells it; empty otherwise. */
  executable: string;
  /** The command line as the system prints it. */
  command: string;
  /** The resident memory in KiB, and the processor time so far in
   * seconds, as the system counts them. */
  memoryKiB: number;
  cpuSeconds: number;
  /** The environment as `NAME=value` words, when asked for and the
   * system lets this process read it; macOS lays it into the command
   * line instead (`ps eww`), so a tag is looked for in both. */
  environment?: string[];
}

/** What a read of the process table takes. */
export interface ProcessTableOptions {
  /** One process alone; the table is empty when the pid names none. */
  pid?: number | undefined;
  /** The environment read beside the command line, where the system
   * gives it. */
  environment?: boolean | undefined;
}

export interface System {
  readonly name: SystemName;
  /** The search path for programs when the environment names none. */
  readonly defaultPath: string;
  /** The names of the variables a child process needs on this system,
   * beside what its parent gives it on purpose: handed on as they are
   * set, under the launch's one rule for the basics among them. */
  readonly childEnvironmentNames: readonly string[];
  /** The folders a coder's tool is usually installed in, beside the PATH. */
  usualToolFolders(env: NodeJS.ProcessEnv): string[];
  /** A link at a path to a folder: a symbolic link with the target as
   * given, or a junction with the target made absolute. Kept when it
   * already points there, replaced when it points elsewhere or
   * dangles; an entry at the path that is not a link is somebody's
   * and refused in words. */
  linkFolder(target: string, link: string): void;
  /** A link at a path to a file: a symbolic link, or a copy written
   * again when the file it copies moved. */
  linkFile(target: string, link: string): void;
  /** Whether a folder is this process's user's own; on a system whose
   * folders have no such owner, every folder is. A folder that is not
   * there is nobody's. */
  ownsFolder(folder: string): boolean;
  /** The process table: every process, or one, each with its parent,
   * its group, its owner, its state, its start, its executable and its
   * command line, and its environment when asked. Throws when the
   * table cannot be read at all. */
  processTable(options?: ProcessTableOptions): Promise<ProcessRow[]>;
  /** The words of a command line as the system splits it: by blanks,
   * or by Windows's rules for quotes. */
  commandWords(command: string): string[];
  /** An identity of this boot, which a reboot changes even when the
   * system recycles every pid; a constant where the system keeps none. */
  bootIdentity(): Promise<string>;
  /** The machine's stable name, the one a plane knows this host by:
   * the hostname, or on macOS the local host name, which the network's
   * naming does not move (the kernel's hostname there follows the DHCP
   * lease and the mDNS name). */
  hostName(): string;
  /** The folder a process works in, or nothing when it cannot be read:
   * the process left, or the system keeps another process's folder to
   * itself. */
  workingFolderOf(pid: number): Promise<string | undefined>;
  /** A process and everything it started, theirs too, read off a table
   * of rows: by the rows' parents, and by their starts as well where
   * the system keeps an ended parent's pid on its children and hands
   * the same pid to a later process. The process itself comes first;
   * the answer is empty when the table does not list it. */
  treeOf(rows: readonly ProcessRow[], pid: number): ProcessRow[];
  /** The system's own kill of a process and of everything its parent
   * chain still reaches. A process that already left is taken as
   * killed. */
  killTree(pid: number): Promise<void>;
  /** The command that opens a url in the operator's browser. */
  openerCommand(url: string): Command;
  /** The prefix that runs a child with every capability of this process
   * dropped (the ambient and the inheritable sets), before the child's
   * own command line; empty where the system has no such sets or no
   * tool to drop them. Given a user, the child runs as that user, with
   * no supplementary group and an empty bounding set too: a host job running
   * as root hands every agent process to the plane's agent user. */
  privilegeDrop(as?: ProcessUser): string[];
}
