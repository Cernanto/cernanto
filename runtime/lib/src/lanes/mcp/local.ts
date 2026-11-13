// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import type { ChildProcess } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { spawnProgram, system } from '@cernanto/system';
import type { ProcessRow } from '@cernanto/system';

import { asRuntimeCommand } from '../../kernel/commands.js';
import { currentExecution, outsideExecution } from '../../kernel/execution.js';
import { CHILD_GRACE_MS } from '../../kernel/facts.js';
import { onProcessEnd, untilAborted } from '../../kernel/lifetime.js';
import { onPause } from '../../kernel/pause.js';
import { CernantoError, errorKindOf } from '../../language/errors.js';
import type { OutsideOutcome } from '../../language/outside.js';
import { McpRpcError, handshakeOver, listToolsOver, toolCallResultOf } from './protocol.js';
import type { McpWire } from './protocol.js';
import { keptMcpToolOf, mcpSchemaHashOf } from './schema.js';
import type { LocalMcpLane, McpCallResult } from './schema.js';

// The local lane: an MCP server this process runs as its own child,
// spoken to over the child's stdin and stdout, one JSON message to a
// line (the protocol's stdio transport). A grant's command is read by
// one rule (parseMcpCommand): the environment words in front, set on
// the child's environment, then the program and its arguments, started
// directly as a program and its argument list. The child belongs to
// the process: started by the first call the journal does not answer,
// kept while the process serves, started again by the next call once
// it left, and ended when the process stops serving or prepares for a
// pause. Each tool call is one record of the calling agent's journal,
// as a remote server's is (ladder.ts), and a replay answers it from
// that record.

/** How long a server may take to answer the handshake once started, a
 * first download of its package included. */
const LOCAL_START_MS = 120_000;
/** How long one request may wait for its answer before the server is
 * taken for hung and replaced. */
const LOCAL_REQUEST_MS = 120_000;
/** How long a server whose stdin closed has to leave on its own. */
const STDIN_GRACE_MS = 2_000;
/** The term's grace at the process's end: short, so a server that
 * keeps on is killed inside the closers' budget and the trace's last
 * words still ship after it. */
const PROCESS_END_GRACE_MS = 1_000;
/** How often an end looks again for what is left of a server's group. */
const GROUP_LOOK_MS = 100;
/** How long a server that left has for its streams to drain, so its
 * last words reach a failure's. */
const DRAIN_MS = 500;
/** The lines of a server's stderr a failure's words carry. */
const TAIL_LINES = 20;
/** The tag every command of a copy carries in its environment: the
 * host job ends what a dead copy left by it. */
const ATTEMPT_TAG = 'CERNANTO_PROCESS_GROUP_NONCE';
/** The folder a child's home falls back to, in this process's own
 * folder, when the home it inherited is not this process's to write. */
const OWN_HOME = '.mcp-home';

/** A local server's command as the rule reads it: the environment
 * words in front, then the program and its arguments. */
interface McpCommand {
  environment: Record<string, string>;
  program: string;
  arguments: string[];
}

interface Word {
  text: string;
  /** How much of the word's text was written bare, before its first
   * quoted or escaped part. */
  bare: number;
}

function terminal(message: string): CernantoError {
  return new CernantoError({ kind: 'terminal', message });
}

function retryable(message: string): CernantoError {
  return new CernantoError({ kind: 'retryable', message });
}

/** Whether a start's error says the program is not there. */
function notThere(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** A start the host refused for good, in words: a program that is not
 * there, or one this host does not let run. Nothing for any other
 * failure, which a fresh start may mend. */
function refusedStart(program: string, error: Error): CernantoError | undefined {
  if (notThere(error)) {
    return terminal(
      /[\\/]/.test(program)
        ? `${program} does not exist on this host`
        : `${program} is not on this host's PATH`,
    );
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EACCES' ? terminal(`${program} cannot be run on this host: ${code}`) : undefined;
}

/** A command's words, split as a POSIX shell splits a command line: on
 * whitespace; a part between single quotes verbatim; a part between
 * double quotes with `\"` and `\\` as its two escapes; a backslash
 * outside quotes keeping the character after it; a word made of every
 * part written without whitespace between them. */
function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  let current = '';
  let inWord = false;
  let bare = -1;
  let quote: "'" | '"' | undefined;
  const finish = (): void => {
    if (!inWord) return;
    words.push({ text: current, bare: bare < 0 ? current.length : bare });
    current = '';
    inWord = false;
    bare = -1;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === '\\' && (next === '"' || next === '\\')) {
        current += next;
        index += 1;
      } else current += char;
      continue;
    }
    if (/\s/.test(char)) {
      finish();
      continue;
    }
    inWord = true;
    if (char === "'" || char === '"') {
      if (bare < 0) bare = current.length;
      quote = char;
      continue;
    }
    if (char === '\\' && next !== '') {
      if (bare < 0) bare = current.length;
      current += next;
      index += 1;
      continue;
    }
    current += char;
  }
  if (quote !== undefined) {
    throw terminal(
      'an mcp command leaves a quote open: close it, or write the quote after a backslash',
    );
  }
  finish();
  return words;
}

const ENVIRONMENT_WORD = /^([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * Reads a local server's command: its leading words of the form
 * `NAME=value` (the name written bare, a letter or `_` first, and the
 * `=` the first of the word) are its environment, a later word of a
 * name replacing an earlier one; the first other word is its program
 * and the rest, in order, its arguments.
 *
 * @throws When the command leaves a quote open, or names no program
 *   after its environment words.
 * @example
 * parseMcpCommand('TG_APP_ID=1 npx -y @chaindead/telegram-mcp');
 * // => { environment: { TG_APP_ID: '1' }, program: 'npx', arguments: ['-y', '@chaindead/telegram-mcp'] }
 */
export function parseMcpCommand(text: string): McpCommand {
  const words = wordsOf(text);
  const environment: Record<string, string> = {};
  let index = 0;
  for (; index < words.length; index += 1) {
    const word = words[index];
    const match = word === undefined ? null : ENVIRONMENT_WORD.exec(word.text);
    if (word === undefined || match === null || match[0].length > word.bare) break;
    environment[match[1] ?? ''] = word.text.slice(match[0].length);
  }
  const program = words[index]?.text;
  if (program === undefined || program === '') {
    const names = Object.keys(environment);
    throw terminal(
      names.length === 0
        ? 'an mcp command names no program'
        : `an mcp command names no program after its environment words (${names.join(', ')})`,
    );
  }
  return {
    environment,
    program,
    arguments: words.slice(index + 1).map((word) => word.text),
  };
}

/** A command by its program and arguments alone: what the failures and
 * the trace name a server by, its environment's values kept to the
 * child's environment. */
export function commandLabelOf(command: McpCommand): string {
  return [command.program, ...command.arguments]
    .map((word) => (word === '' || /[\s'"\\]/.test(word) ? JSON.stringify(word) : word))
    .join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a stream line by line, a trailing `\r` dropped; a last line
 * without its line break is read at the stream's end. */
function readLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (stream === null) return;
  stream.setEncoding('utf8');
  let buffer = '';
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      onLine(line);
    }
  });
  stream.on('end', () => {
    if (buffer !== '') onLine(buffer.replace(/\r$/, ''));
    buffer = '';
  });
  stream.on('error', () => undefined);
}

interface Waiting {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface Gone {
  code: number | null;
  signal: string | null;
  error?: Error;
}

function delayed(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms).unref();
  });
}

/** How many processes of a group the table lists, its zombies apart. */
async function groupMembers(group: number): Promise<number> {
  const table = await asRuntimeCommand(() => system.processTable()).catch((): ProcessRow[] => []);
  return table.filter((row) => row.group === group && !row.state.startsWith('Z')).length;
}

/** Whether a group's last process left within the time. The look's
 * timer holds the process: no child of its own is left to. */
async function groupGoneWithin(group: number, ms: number): Promise<boolean> {
  for (let waited = 0; ; waited += GROUP_LOOK_MS) {
    if ((await groupMembers(group)) === 0) return true;
    if (waited >= ms) return false;
    await new Promise((done) => setTimeout(done, GROUP_LOOK_MS));
  }
}

function signalGroup(group: number, name: NodeJS.Signals): void {
  try {
    process.kill(-group, name);
  } catch {
    // The group left between the look and the signal.
  }
}

/** One running server: its child, the requests waiting on it, the last
 * lines it wrote on its stderr. */
class LocalServer implements McpWire {
  readonly label: string;
  private readonly program: string;
  private readonly child: ChildProcess;
  private readonly say: (line: string) => void;
  private readonly requestMs: number;
  private readonly waiting = new Map<number, Waiting>();
  private nextId = 1;
  private readonly tail: string[] = [];
  private gone: Gone | undefined;
  private serving = false;
  private budgetMs: number;
  private graceMs: number;
  private termed = false;
  private ending: Promise<void> | undefined;
  private listing: Promise<string> | undefined;
  private readonly left: Promise<void>;
  private readonly spawned: Promise<void>;
  private readonly over: Promise<void>;

  constructor(
    child: ChildProcess,
    command: McpCommand,
    say: (line: string) => void,
    requestMs: number,
    startMs: number,
    graceMs: number = CHILD_GRACE_MS,
  ) {
    this.child = child;
    this.label = commandLabelOf(command);
    this.program = command.program;
    this.say = say;
    this.requestMs = requestMs;
    this.budgetMs = startMs;
    this.graceMs = graceMs;
    let leave: () => void = () => undefined;
    this.left = new Promise((done) => {
      leave = done;
    });
    // The child's group outlives it while a process it started runs:
    // what is left of it is ended once the child left.
    this.over = this.left.then(() => this.endGroup());
    let running = false;
    this.spawned = new Promise((started, failed) => {
      child.once('spawn', () => {
        running = true;
        started();
      });
      child.once('error', (error) => {
        failed(error);
      });
    });
    this.spawned.catch(() => undefined);
    readLines(child.stdout, (line) => {
      this.heard(line);
    });
    readLines(child.stderr, (line) => {
      this.said(line);
    });
    child.stdin?.on('error', () => undefined);
    // A start that failed leaves nothing running; an error of a child
    // that runs (a signal that could not be sent) leaves it running,
    // and its exit says when it is gone. A program started through the
    // system's shell (a `.cmd` shim on Windows) is known to be missing
    // only once the shell answered: that error comes after the spawn
    // and in the exit's place, and it too leaves nothing running.
    child.on('error', (error) => {
      if (running && !notThere(error)) return;
      this.ended({ code: null, signal: null, error });
      leave();
    });
    child.once('exit', (code, signal) => {
      // The streams may still carry the last words: they are given a
      // moment to drain before the waiting requests hear why.
      let drained = false;
      const finish = (): void => {
        if (drained) return;
        drained = true;
        this.ended({ code, signal });
        leave();
      };
      child.once('close', finish);
      setTimeout(finish, DRAIN_MS).unref();
    });
  }

  /** Whether the child is still there to ask. */
  alive(): boolean {
    return this.gone === undefined;
  }

  /** Resolves once the child left. */
  leaving(): Promise<void> {
    return this.left;
  }

  /** Resolves once the child and every process of its group left. */
  finished(): Promise<void> {
    return this.over;
  }

  /** The hash of the tools the server lists, read once for every
   * caller that holds it to a pin. */
  schemaHash(): Promise<string> {
    if (this.listing === undefined) {
      const listing = listToolsOver(this).then((tools) =>
        mcpSchemaHashOf(tools.map((tool) => keptMcpToolOf(tool, this.label))),
      );
      listing.catch(() => {
        if (this.listing === listing) this.listing = undefined;
      });
      this.listing = listing;
    }
    return this.listing;
  }

  /** The child's pid, while it lives. */
  pid(): number | undefined {
    return this.gone === undefined ? this.child.pid : undefined;
  }

  /** Waits for the child to have started; a program that is not there
   * is refused in words. */
  async started(): Promise<void> {
    try {
      await this.spawned;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      throw (
        refusedStart(this.program, failure) ??
        retryable(`${this.label} did not start: ${failure.message}`)
      );
    }
  }

  /** The handshake answered: the requests from here have the request
   * budget. */
  markServing(): void {
    this.serving = true;
    this.budgetMs = this.requestMs;
  }

  request(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.gone !== undefined) return Promise.reject(this.goneError(this.gone));
    if (signal?.aborted === true) return Promise.reject(signal.reason as Error);
    const id = this.nextId;
    this.nextId += 1;
    const budgetMs = this.budgetMs;
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        settle();
        reject(signal?.reason as Error);
      };
      const timer = setTimeout(() => {
        settle();
        reject(
          retryable(
            this.serving
              ? `${this.label} answered nothing to ${method} within ${String(budgetMs / 1000)} seconds`
              : `${this.label} answered nothing within ${String(budgetMs / 1000)} seconds of its start`,
          ),
        );
        // A server that stops answering is replaced: the next call
        // starts another.
        void this.end();
      }, budgetMs);
      timer.unref();
      const settle = (): void => {
        clearTimeout(timer);
        this.waiting.delete(id);
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.set(id, {
        method,
        resolve: (value) => {
          settle();
          resolve(value);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      });
      this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string): Promise<void> {
    if (this.gone !== undefined) return Promise.reject(this.goneError(this.gone));
    this.write({ jsonrpc: '2.0', method });
    return Promise.resolve();
  }

  /** Ends the child and what it started, once however often it is
   * asked: its stdin closed and a moment to leave on its own, then a
   * term to its group, the grace, a kill; the processes left of its
   * group after it are ended the same way. Where the system has no
   * groups, the processes the child started are read before it is
   * asked to leave, and those still there after it are ended. */
  end(graceMs: number = this.graceMs): Promise<void> {
    this.ending ??= this.stop(graceMs);
    return this.ending;
  }

  /** Kills the child's group at once, outside any wait: the last resort
   * of a process that leaves. A server is kept until its group is
   * gone, so the group is still the server's. */
  killNow(): void {
    const pid = this.child.pid;
    if (pid === undefined) return;
    try {
      if (system.name !== 'windows') process.kill(-pid, 'SIGKILL');
      else if (this.gone === undefined) this.child.kill('SIGKILL');
    } catch {
      // It left meanwhile.
    }
  }

  private async stop(graceMs: number): Promise<void> {
    this.graceMs = graceMs;
    const tree = system.name === 'windows' ? await this.descendants() : [];
    if (this.gone === undefined) {
      try {
        this.child.stdin?.end();
      } catch {
        // The pipe is gone with the child.
      }
      if (!(await this.leftWithin(STDIN_GRACE_MS))) {
        await this.signal('SIGTERM');
        if (!(await this.leftWithin(graceMs))) {
          await this.signal('SIGKILL');
          await this.leftWithin(5_000);
        }
      }
    }
    await this.over;
    for (const row of tree) {
      const [now] = await asRuntimeCommand(() => system.processTable({ pid: row.pid })).catch(
        (): ProcessRow[] => [],
      );
      if (now?.started === row.started) {
        await asRuntimeCommand(() => system.killTree(row.pid)).catch(() => undefined);
      }
    }
  }

  /** What is left of the child's group once it left: a term to the
   * group (none when the child's own term reached it already), the
   * grace, a kill. The group is signalled only while a process of it
   * is listed, so its id is still the group's. */
  private async endGroup(): Promise<void> {
    const group = this.child.pid;
    if (group === undefined || system.name === 'windows') return;
    if (!this.termed) {
      if ((await groupMembers(group)) === 0) return;
      signalGroup(group, 'SIGTERM');
    }
    if (await groupGoneWithin(group, this.graceMs)) return;
    signalGroup(group, 'SIGKILL');
    await groupGoneWithin(group, 5_000);
  }

  /** The processes the child started and theirs, read off the system's
   * table while it lives. */
  private async descendants(): Promise<ProcessRow[]> {
    const root = this.pid();
    if (root === undefined) return [];
    const table = await asRuntimeCommand(() => system.processTable()).catch((): ProcessRow[] => []);
    return system.treeOf(table, root).filter((row) => row.pid !== root);
  }

  private async signal(name: NodeJS.Signals): Promise<void> {
    const pid = this.pid();
    if (pid === undefined) return;
    if (system.name === 'windows') {
      await asRuntimeCommand(() => system.killTree(pid)).catch(() => undefined);
      return;
    }
    this.termed = true;
    try {
      process.kill(-pid, name);
    } catch {
      // The group left between the look and the signal.
    }
  }

  private async leftWithin(ms: number): Promise<boolean> {
    if (this.gone !== undefined) return true;
    return Promise.race([this.left.then(() => true), delayed(ms).then(() => false)]);
  }

  private write(message: Record<string, unknown>): void {
    try {
      this.child.stdin?.write(`${JSON.stringify(message)}\n`);
    } catch {
      // A child that left answers its waiting requests on its exit.
    }
  }

  private said(line: string): void {
    if (line.trim() === '') return;
    this.tail.push(line);
    if (this.tail.length > TAIL_LINES) this.tail.shift();
    this.say(line);
  }

  private heard(line: string): void {
    if (line.trim() === '') return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // A line that is no message is the server's words, as its stderr
      // is: kept for the trace and skipped.
      this.said(line);
      return;
    }
    for (const one of Array.isArray(message) ? (message as unknown[]) : [message]) {
      this.dispatch(one);
    }
  }

  private dispatch(message: unknown): void {
    if (!isRecord(message)) return;
    const id = message['id'];
    if (typeof message['method'] === 'string') {
      // A request of the server's own: a ping is answered, anything
      // else refused, since this client declared no capability. A
      // notification needs no answer.
      if (id === undefined || id === null) return;
      this.write(
        message['method'] === 'ping'
          ? { jsonrpc: '2.0', id, result: {} }
          : {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `this client serves no ${message['method']}` },
            },
      );
      return;
    }
    if (typeof id !== 'number') return;
    const waiting = this.waiting.get(id);
    if (waiting === undefined) return;
    const error = message['error'];
    if (isRecord(error)) {
      waiting.reject(
        new McpRpcError(
          waiting.method,
          typeof error['code'] === 'number' ? error['code'] : 0,
          typeof error['message'] === 'string' ? error['message'] : 'no message',
          error['data'],
        ),
      );
      return;
    }
    waiting.resolve(message['result']);
  }

  private ended(gone: Gone): void {
    if (this.gone !== undefined) return;
    this.gone = gone;
    const error = this.goneError(gone);
    for (const waiting of [...this.waiting.values()]) waiting.reject(error);
  }

  private goneError(gone: Gone): CernantoError {
    // A start the host refused for good is said as one, whenever the
    // system told of it.
    if (gone.error !== undefined && !this.serving) {
      const refused = refusedStart(this.program, gone.error);
      if (refused !== undefined) return refused;
    }
    const how =
      gone.error !== undefined
        ? gone.error.message
        : gone.signal !== null
          ? `on ${gone.signal}`
          : `exit ${String(gone.code)}`;
    const words = this.tail.length === 0 ? '' : `: ${this.tail.join('\n')}`;
    return retryable(
      this.serving
        ? `the local MCP server ${this.label} died, ${how}${words}`
        : `${this.label} ended at its start, ${how}${words}`,
    );
  }
}

/** Whether a folder is this process's to write. */
function writable(folder: string): boolean {
  try {
    accessSync(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The environment a server starts with: the machine's basics every
 * child of this process gets, the node that runs this process first on
 * the PATH (so npx and npm are the plane's own), a home of this
 * process's own folder when the inherited one is not its to write (a
 * package runner keeps its cache there), the attempt's tag, and the
 * command's own environment words over all of it. */
export function localServerEnvironment(command: McpCommand): Record<string, string> {
  const basics: Record<string, string> = {};
  for (const name of system.childEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined && value !== '') basics[name] = value;
  }
  basics['PATH'] = [dirname(process.execPath), basics['PATH'] ?? system.defaultPath].join(
    delimiter,
  );
  const home = basics['HOME'];
  if (home !== undefined && !writable(home)) {
    const own = join(process.cwd(), OWN_HOME);
    mkdirSync(own, { recursive: true, mode: 0o700 });
    basics['HOME'] = own;
  }
  const tag = process.env[ATTEMPT_TAG];
  return {
    ...basics,
    ...(tag === undefined || tag === '' ? {} : { [ATTEMPT_TAG]: tag }),
    ...command.environment,
  };
}

/** How a keeper starts a server's process: the system's own start of a
 * program by its name, in a process group of its own where the system
 * has groups. */
function startProgram(command: McpCommand, environment: Record<string, string>): ChildProcess {
  return spawnProgram(command.program, command.arguments, {
    env: environment,
    detached: system.name !== 'windows',
  });
}

interface LocalMcpKeeperOptions {
  /** How a server's process is started; the system's own start by
   * default. */
  start?: (command: McpCommand, environment: Record<string, string>) => ChildProcess;
  /** Where a server's own words go; this process's standard error by
   * default, which the trace capture records. */
  say?: (module: string, line: string) => void;
  startMs?: number;
  requestMs?: number;
  graceMs?: number;
  /** Whether the keeper's servers end with the process and for a pause;
   * a proof that owns its keeper ends them itself. */
  hooks?: boolean;
}

function sayOnStderr(module: string, line: string): void {
  process.stderr.write(`mcp ${module}: ${line}\n`);
}

/** The local servers a process keeps, one per command: started on the
 * first ask, kept while they live, started again once they left, held
 * back while the process is paused. */
export class LocalMcpKeeper {
  private readonly servers = new Map<string, Promise<LocalServer>>();
  private readonly living = new Set<LocalServer>();
  private held: { resumed: Promise<void>; release: () => void } | undefined;
  private hooked = false;
  private readonly options: LocalMcpKeeperOptions;

  constructor(options: LocalMcpKeeperOptions = {}) {
    this.options = options;
  }

  /** The server this process keeps for the lane's command, started
   * when there is none and held to the lane's pin; while the process is
   * paused, the ask waits for its resume, a start the pause came
   * during included. */
  async session(lane: LocalMcpLane, signal?: AbortSignal): Promise<LocalServer> {
    for (;;) {
      const held = this.held;
      if (held !== undefined) {
        await (signal === undefined ? held.resumed : untilAborted(held.resumed, signal));
        continue;
      }
      const kept = this.servers.get(lane.command);
      if (kept === undefined) {
        const starting = this.start(lane);
        this.servers.set(lane.command, starting);
        starting.catch(() => {
          if (this.servers.get(lane.command) === starting) this.servers.delete(lane.command);
        });
        continue;
      }
      let server: LocalServer;
      try {
        server = await (signal === undefined ? kept : untilAborted(kept, signal));
        if (this.held === undefined && server.alive() && lane.schemaHash !== undefined) {
          await this.holdToPin(server, lane);
        }
      } catch (error) {
        if (this.held !== undefined && signal?.aborted !== true) continue;
        throw error;
      }
      if (this.held !== undefined) continue;
      if (server.alive()) return server;
      if (this.servers.get(lane.command) === kept) this.servers.delete(lane.command);
    }
  }

  /** Ends every server this keeper holds, side by side; each is held
   * until it and its group are gone, so the last resort of a process
   * that leaves meanwhile still reaches it. */
  async endAll(graceMs: number | undefined = this.options.graceMs): Promise<void> {
    this.servers.clear();
    await Promise.all([...this.living].map((server) => server.end(graceMs)));
  }

  /** Ends every server and holds new asks back until `release`. */
  async hold(): Promise<void> {
    if (this.held === undefined) {
      let release: () => void = () => undefined;
      const resumed = new Promise<void>((done) => {
        release = done;
      });
      this.held = { resumed, release };
    }
    await this.endAll();
  }

  /** Lets the asks a hold kept back go on. */
  release(): void {
    const held = this.held;
    this.held = undefined;
    held?.release();
  }

  private hook(): void {
    if (this.hooked || this.options.hooks === false) return;
    this.hooked = true;
    onPause({
      prepare: () => this.hold(),
      resume: () => {
        this.release();
      },
    });
    onProcessEnd(() => this.endAll(PROCESS_END_GRACE_MS));
    process.on('exit', () => {
      for (const server of this.living) server.killNow();
    });
  }

  private async start(lane: LocalMcpLane): Promise<LocalServer> {
    const command = parseMcpCommand(lane.command);
    this.hook();
    const environment = localServerEnvironment(command);
    const say = this.options.say ?? sayOnStderr;
    const start = this.options.start ?? startProgram;
    // The child and everything that listens to it belong to the
    // process: its words are the process's record, and its keeper alone
    // ends it.
    const server = outsideExecution(() =>
      asRuntimeCommand(
        () =>
          new LocalServer(
            start(command, environment),
            command,
            (line) => {
              say(lane.module, line);
            },
            this.options.requestMs ?? LOCAL_REQUEST_MS,
            this.options.startMs ?? LOCAL_START_MS,
            this.options.graceMs,
          ),
      ),
    );
    // Kept from its spawn until it and its group are gone, so a pause or
    // an end that comes during its start ends it too.
    this.living.add(server);
    void server.finished().then(() => {
      this.living.delete(server);
    });
    try {
      await server.started();
      await handshakeOver(server);
    } catch (error) {
      await server.end();
      throw error;
    }
    server.markServing();
    return server;
  }

  /** The tools the server lists, read once per server, held to the
   * listing the caller's package carries: tools that moved since that
   * compile are refused, in words, rather than by every call in the
   * server's. */
  private async holdToPin(server: LocalServer, lane: LocalMcpLane): Promise<void> {
    let hash: string;
    try {
      hash = await server.schemaHash();
    } catch (error) {
      if (errorKindOf(error) !== undefined || error instanceof McpRpcError) throw error;
      throw terminal(error instanceof Error ? error.message : String(error));
    }
    if (hash === lane.schemaHash) return;
    const agent = currentExecution()?.context.agentId ?? 'this agent';
    throw terminal(
      `the tools of ${server.label} moved since ${agent} was compiled; compile it again`,
    );
  }
}

/** The local servers this process keeps for its generated modules. */
export const localMcpServers: LocalMcpKeeper = new LocalMcpKeeper();

/**
 * One attempt at a tool call of a local server, as the ladder's record
 * runs it: the server this process keeps for the command (started when
 * there is none), the tool called, the outcome a journal value. A
 * refusal that will not change (the server's own, a program this host
 * lacks, a command that names none, tools that moved since the compile)
 * is a terminal value; trouble a fresh start may mend (a server that
 * died, hung or failed its start) throws retryable for the retry.
 */
export async function attemptLocalMcpCall(
  lane: LocalMcpLane,
  tool: string,
  args: Record<string, unknown>,
  keeper: LocalMcpKeeper = localMcpServers,
  signal?: AbortSignal,
): Promise<OutsideOutcome<McpCallResult>> {
  try {
    const server = await keeper.session(lane, signal);
    const answer = await server.request('tools/call', { name: tool, arguments: args }, signal);
    return { ok: toolCallResultOf(answer) };
  } catch (error) {
    if (signal?.aborted === true) throw signal.reason;
    const words = `mcp ${lane.module}.${tool}: ${error instanceof Error ? error.message : String(error)}`;
    if (error instanceof McpRpcError || errorKindOf(error) === 'terminal') {
      return { failed: { kind: 'terminal', message: words } };
    }
    throw retryable(words);
  }
}
