// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import type { ChildProcess } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { CHILD_ENVIRONMENT_NAMES, defaultPath, setUnder } from '../../kernel/child-environment.js';
import { currentExecution, outsideExecution } from '../../kernel/execution.js';
import { CHILD_GRACE_MS } from '../../kernel/facts.js';
import { onProcessEnd, retireProcess, untilAborted } from '../../kernel/lifetime.js';
import { asRuntimeCommand } from '../../kernel/own-commands.js';
import { onPause } from '../../kernel/pause.js';
import {
  Ownership,
  OwnershipRefused,
  ProcessReadFailure,
  stopOwned,
} from '../../kernel/process-adapter.js';
import type { StopMachine } from '../../kernel/process-adapter.js';
import { reader } from '../../kernel/process-readers.js';
import { spawnProgram } from '../../kernel/programs.js';
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
//
// A SERVER'S END IS THE PROCESS ADAPTER'S STOP, AND ITS RESULT STANDS.
// The lane hands the stop what the child owns and how the end is made
// (the grace, the child's input closed first) and takes what comes
// back: an end that could not prove what it ended fails in the
// adapter's words, and the lane signals nothing in its place. A server
// is ended only once a stop said so: until then its keeper holds it
// and starts no other beside it. An end that failed is an incomplete
// cleanup: the process retires, and its keeper starts no server from
// then on.

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
  /** Whether an end was asked: from then on the server takes no ask. */
  private asked = false;
  /** The end under way; a failed one is let go of, so that the next
   * ask tries again. */
  private ending: Promise<void> | undefined;
  /** The end of what is left of the child's group, under way. */
  private clearing: Promise<void> | undefined;
  private listing: Promise<string> | undefined;
  private readonly left: Promise<void>;
  private readonly spawned: Promise<void>;
  private readonly over: Promise<void>;
  private proven: () => void = () => undefined;
  private readonly machine: StopMachine | undefined;
  /** What the child owns, over every attempt at its end: what one
   * attempt could not end or vouch for is the next one's to settle. */
  private readonly owned: Ownership;
  /** What is left of the group the child led, taken as the child
   * left. */
  private leftovers: Ownership | undefined;
  /** The words of the last end that failed, said once each. */
  private toldUnfinished: string | undefined;
  /** Told every end that failed: its keeper's, which has the process
   * leave. */
  private readonly unproven: (words: string) => void;

  constructor(
    child: ChildProcess,
    command: McpCommand,
    say: (line: string) => void,
    requestMs: number,
    startMs: number,
    graceMs: number = CHILD_GRACE_MS,
    machine?: StopMachine,
    unproven: (words: string) => void = () => undefined,
  ) {
    this.child = child;
    this.machine = machine;
    this.unproven = unproven;
    this.label = commandLabelOf(command);
    this.program = command.program;
    this.say = say;
    this.requestMs = requestMs;
    this.budgetMs = startMs;
    this.graceMs = graceMs;
    this.owned = new Ownership({
      roots: () => (child.pid !== undefined && this.running() ? [child.pid] : []),
      sameUser: true,
    });
    let leave: () => void = () => undefined;
    this.left = new Promise((done) => {
      leave = done;
    });
    this.over = new Promise((done) => {
      this.proven = done;
    });
    // The child's group outlives it while a process it started runs:
    // what is left of it is ended as the child leaves, asked or not. A
    // server that left on its own is ended once that is done; one whose
    // end was asked, once that end says so.
    void this.left
      .then(async () => {
        await this.clearLeft();
        if (!this.asked) this.proven();
      })
      .catch((error: unknown) => {
        if (!this.asked) this.unfinished(error);
      });
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

  /** Whether the server takes asks: its child is there, and no end was
   * asked of it. */
  serves(): boolean {
    return this.gone === undefined && !this.asked;
  }

  /** Resolves once the child left. */
  leaving(): Promise<void> {
    return this.left;
  }

  /** Resolves once the server is ended: the child left, and a stop
   * said that nothing it owned is left. An end that could not say so
   * leaves this waiting, for a later end to settle. */
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
        // A server that stops answering is ended, and the next call
        // starts another once it is. An end that fails says so on the
        // server's own line, and the next call asks it again.
        void this.end().catch(() => undefined);
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

  /** Ends the child and what it started by the process adapter's stop:
   * what the child owns is read while it lives; its stdin is closed
   * and it has a moment to leave on its own; then a term to everything
   * owned, the grace, a kill. What the child had started stays owned
   * after the child left, and what is left of the group it led is
   * ended after it. One end runs at a time, however often it is asked.
   *
   * AN END THAT COULD NOT PROVE WHAT IT ENDED FAILS, in the adapter's
   * own words, and nothing is signalled in the stop's place: a group
   * the adapter refused is signalled by nobody, a read that failed
   * ended the child by its own handle and nothing wider, and what
   * would not end or could not be vouched for is said. Such an end may
   * be asked again, and takes up what the last one left. */
  end(graceMs: number = this.graceMs): Promise<void> {
    this.asked = true;
    if (this.ending === undefined) {
      const ending = this.stop(graceMs);
      this.ending = ending;
      ending.catch(() => {
        if (this.ending === ending) this.ending = undefined;
      });
    }
    return this.ending;
  }

  /** Whether the child's own process still runs, its pid its own. */
  private running(): boolean {
    return (
      this.child.pid !== undefined && this.child.exitCode === null && this.child.signalCode === null
    );
  }

  /** Kills the child's own process at once, by its handle: the last
   * resort of a process that leaves, which reads nothing and so
   * signals nothing wider. What the child had started is ended with
   * what this process's launch left, by whoever ends that. */
  killNow(): void {
    if (this.running()) this.child.kill('SIGKILL');
  }

  /** The failure of an end that could not prove what it ended, in the
   * adapter's own words; said on the server's own line, the same
   * words once. */
  private unfinished(error: unknown): Error {
    const why = error instanceof Error ? error.message : String(error);
    const done =
      error instanceof OwnershipRefused
        ? '; nothing was signalled'
        : error instanceof ProcessReadFailure
          ? '; its own process was ended and nothing else'
          : '';
    const words = `${this.label} could not be ended whole: ${why}${done}`;
    if (this.toldUnfinished !== words) {
      this.toldUnfinished = words;
      this.say(words);
    }
    this.unproven(words);
    return new Error(words, { cause: error });
  }

  private async stop(graceMs: number): Promise<void> {
    this.graceMs = graceMs;
    try {
      await stopOwned(
        this.owned,
        {
          say: async () => {
            try {
              this.child.stdin?.end();
            } catch {
              // The pipe is gone with the child.
            }
            await this.leftWithin(STDIN_GRACE_MS);
          },
          also: (name) => {
            if (this.running()) this.child.kill(name);
          },
          graceMs,
        },
        this.machine,
      );
      // Nothing the child owned is left, the child itself among it:
      // its exit is heard, and what is left of its group is ended.
      await this.left;
      await this.clearLeft();
    } catch (error) {
      // The stop could not prove what it ended, and nothing is sent in
      // its place.
      throw this.unfinished(error);
    }
    this.proven();
  }

  /** Ends what is left of the child's group, one end at a time; one
   * that failed is let go of, for the next ask to try again. */
  private clearLeft(): Promise<void> {
    if (this.clearing === undefined) {
      const clearing = this.endLeft();
      this.clearing = clearing;
      clearing.catch(() => {
        if (this.clearing === clearing) this.clearing = undefined;
      });
    }
    return this.clearing;
  }

  /** What is left of the child's group once the child left: taken at
   * that moment, while a process of the group is listed, and ended by
   * the adapter's stop. What one attempt found stays owned for the
   * next. */
  private async endLeft(): Promise<void> {
    const group = this.child.pid;
    if (group === undefined || !reader.facts.groups) return;
    this.leftovers ??= new Ownership({ groups: [group], sameUser: true });
    await stopOwned(this.leftovers, { graceMs: this.graceMs }, this.machine);
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

/** The environment a server starts with: what this process's own
 * environment sets under the names every child of the plane is handed
 * (the one choice, child-environment.ts), and the lane's own on top:
 * the node that runs this process first on the PATH (so npx and npm
 * are the plane's own), a home of this process's own folder when the
 * inherited one is not its to write (a package runner keeps its cache
 * there), the attempt's tag, and the command's own environment words
 * over all of it. */
export function localServerEnvironment(command: McpCommand): Record<string, string> {
  const basics = setUnder(process.env, CHILD_ENVIRONMENT_NAMES);
  basics['PATH'] = [dirname(process.execPath), basics['PATH'] ?? defaultPath()].join(delimiter);
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
    detached: reader.facts.groups,
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
  /** What a server's end reads and signals through; the system's own
   * by default. A proof hands its own, to say what a read may. */
  machine?: StopMachine;
  /** What has the process leave after a server's end that could not
   * prove what it ended: the kernel's retirement by default, the one
   * an incomplete cleanup of a call's commands asks. A proof hands its
   * own. */
  retire?: (why: string) => void;
}

function sayOnStderr(module: string, line: string): void {
  process.stderr.write(`mcp ${module}: ${line}\n`);
}

/** The local servers a process keeps, one per command: started on the
 * first ask, kept while they live, started again once they are ended,
 * held back while the process is paused. A server is held until a stop
 * said it is ended, and while one of a command is held no other of
 * that command is started.
 *
 * AN END THAT COULD NOT PROVE WHAT IT ENDED IS AN INCOMPLETE CLEANUP,
 * and the process answers it as it answers one of a call's commands:
 * it retires. From that moment the keeper starts no server at all, so
 * nothing is ever started beside what could not be ended, and what was
 * left is ended with what the process's launch left, by whoever ends
 * that with a read that proves it. */
export class LocalMcpKeeper {
  private readonly servers = new Map<string, Promise<LocalServer>>();
  /** Every server from its spawn until it is ended, by its command. */
  private readonly living = new Map<LocalServer, string>();
  private held: { resumed: Promise<void>; release: () => void } | undefined;
  private hooked = false;
  /** Why this process leaves: the words of the first end that could
   * not prove what it ended. */
  private leaving: string | undefined;
  private readonly options: LocalMcpKeeperOptions;

  constructor(options: LocalMcpKeeperOptions = {}) {
    this.options = options;
  }

  /** A server's end failed: the process retires, once, and no server
   * is started in it from now on. */
  private leave(words: string): void {
    if (this.leaving !== undefined) return;
    this.leaving = words;
    (this.options.retire ?? retireProcess)(words);
  }

  /** The server this process keeps for the lane's command, started
   * when there is none and held to the lane's pin; while the process is
   * paused, the ask waits for its resume, a start the pause came
   * during included. A server that was asked to end takes no ask, and
   * the one after it is started once that end said the server is
   * ended: an ask that finds it unended waits for its end, and fails
   * in the end's words when the end fails. After an end that failed no
   * server is started here at all, and an ask that needs one fails as
   * one to try again, where the process that comes after serves it. */
  async session(lane: LocalMcpLane, signal?: AbortSignal): Promise<LocalServer> {
    for (;;) {
      const held = this.held;
      if (held !== undefined) {
        await (signal === undefined ? held.resumed : untilAborted(held.resumed, signal));
        continue;
      }
      const kept = this.servers.get(lane.command);
      if (kept === undefined) {
        const before = this.unended(lane.command);
        if (before.length > 0) {
          const ended = this.endBefore(before);
          await (signal === undefined ? ended : untilAborted(ended, signal));
          continue;
        }
        if (this.leaving !== undefined)
          throw retryable(`${this.leaving}; this process leaves, and starts no server`);
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
        if (this.held === undefined && server.serves() && lane.schemaHash !== undefined) {
          await this.holdToPin(server, lane);
        }
      } catch (error) {
        if (this.held !== undefined && signal?.aborted !== true) continue;
        throw error;
      }
      if (this.held !== undefined) continue;
      if (server.serves()) return server;
      if (this.servers.get(lane.command) === kept) this.servers.delete(lane.command);
    }
  }

  /** The servers of a command this keeper still holds: not ended yet. */
  private unended(command: string): LocalServer[] {
    return [...this.living].flatMap(([server, its]) => (its === command ? [server] : []));
  }

  /** Waits for the end of servers that stand before a start, asking it
   * again of one whose last end failed, since a later read may prove
   * what an earlier one could not; one that cannot be ended fails the
   * ask, and nothing is started beside it. */
  private async endBefore(servers: readonly LocalServer[]): Promise<void> {
    for (const server of servers) {
      try {
        await server.end();
      } catch (error) {
        throw retryable(
          `${error instanceof Error ? error.message : String(error)}; no other is started beside it`,
        );
      }
      this.living.delete(server);
    }
  }

  /** Ends every server this keeper holds, side by side; each is held
   * until a stop said it is ended, so the last resort of a process
   * that leaves meanwhile still reaches it. Every server is asked and
   * waited for; an end that could not prove what it ended then fails
   * this, in its words. */
  async endAll(graceMs: number | undefined = this.options.graceMs): Promise<void> {
    this.servers.clear();
    const ends = await Promise.allSettled(
      [...this.living.keys()].map((server) => server.end(graceMs)),
    );
    const failed = ends.find((end): end is PromiseRejectedResult => end.status === 'rejected');
    if (failed !== undefined) throw failed.reason;
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
      for (const server of this.living.keys()) server.killNow();
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
            this.options.machine,
            (words) => {
              this.leave(words);
            },
          ),
      ),
    );
    // Kept from its spawn until it is ended, so a pause or an end that
    // comes during its start ends it too, and no other of its command
    // is started while it is not.
    this.living.set(server, lane.command);
    void server.finished().then(() => {
      this.living.delete(server);
    });
    try {
      await server.started();
      await handshakeOver(server);
    } catch (error) {
      // The start's own failure is the one to tell; an end that failed
      // said so on the server's line, and the next ask tries it again.
      await server.end().catch(() => undefined);
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
