// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { bootCallOpen, bootLine } from './boot-call.js';
import { emitTrace, traceSinkInstalled } from './trace.js';
import { failureForRecord, isSecretFailure } from '../language/errors.js';
import { currentExecution, nextTraceSequence } from '../kernel/execution.js';
import { wallNowIso } from '../kernel/clock.js';

// Console capture and the active-call gauge: the small observability
// pieces the serve wrapper and the test world share.
//
// A line written inside a running call, by the console or straight to a
// stream, becomes a record of that call. A line written outside any
// call in a process whose boot call is open (the kernel's words, code
// that runs outside any call) is a record of the boot call
// (boot-call.ts), except the agent's debug lines, which are dropped
// there. An unrecorded call's line is dropped; a process with no sink,
// or none serving yet, keeps its streams.

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

const LEVEL_OF: Record<ConsoleMethod, 'info' | 'warn' | 'error'> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

let consoleInstalled = false;
let streamsInstalled = false;
// True while a patched console method is writing, so the stream
// capture does not record the same output twice.
let consoleWriting = false;

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** The section name generated code logs under; the launcher enables it
 * with NODE_DEBUG for a compile's verification pair alone. */
const AGENT_DEBUG_SECTION = 'agent';
const DEBUGLOG_LINE = new RegExp(`^${AGENT_DEBUG_SECTION.toUpperCase()} \\d+: ([\\s\\S]*)$`);
const DEBUGLOG_HEAD = new RegExp(`^${AGENT_DEBUG_SECTION.toUpperCase()} \\d+: `);

/** Whether a write is one of the agent's debug lines, told by its
 * first characters alone: such a line can be a whole document long. */
function isDebugLine(chunk: Uint8Array | string): boolean {
  const head =
    typeof chunk === 'string'
      ? chunk.slice(0, 32)
      : Buffer.from(chunk.buffer, chunk.byteOffset, Math.min(chunk.byteLength, 32)).toString();
  return DEBUGLOG_HEAD.test(head);
}

function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_PATTERN, '');
}

function renderConsoleArgs(args: unknown[]): string {
  return args
    .map((value) => {
      if (typeof value === 'string') return value;
      // A failure that came out of a secret call is written as every
      // record writes it: its kind alone.
      if (isSecretFailure(value)) return failureForRecord(value).error;
      if (value instanceof Error) return value.stack ?? value.message;
      try {
        return JSON.stringify(value);
      } catch {
        return '[unserializable]';
      }
    })
    .join(' ');
}

/**
 * Routes console output produced inside a running handler into the
 * call's trace. Installed once per process; output outside any call,
 * and all output of a process with no sink, passes through to the
 * process streams untouched.
 */
export function installConsoleCapture(): void {
  if (consoleInstalled) return;
  consoleInstalled = true;
  for (const method of ['log', 'info', 'warn', 'error'] as ConsoleMethod[]) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]): void => {
      const execution = currentExecution();
      if (execution !== undefined && traceSinkInstalled()) {
        const { context } = execution;
        emitTrace({
          agentId: context.agentId,
          callId: context.callId,
          seq: nextTraceSequence(execution.trace),
          at: wallNowIso(),
          kind: 'log',
          level: LEVEL_OF[method],
          message: stripAnsi(renderConsoleArgs(args)),
        });
        // What the agent says through console.error or console.warn
        // inside a call is its word to whoever reads the process too
        // (the launcher's error file, a laptop's host log), beside the
        // trace; the rest of the console stays the trace's.
        if (method === 'error' || method === 'warn') {
          consoleWriting = true;
          try {
            original(...args);
          } finally {
            consoleWriting = false;
          }
        }
        return;
      }
      if (traceSinkInstalled() && bootCallOpen()) {
        bootLine(LEVEL_OF[method], stripAnsi(renderConsoleArgs(args)));
        return;
      }
      consoleWriting = true;
      try {
        original(...args);
      } finally {
        consoleWriting = false;
      }
    };
  }
}

/**
 * Routes raw stream writes made inside a running handler into the
 * call's trace, the way console methods already are. This is what
 * catches npm dependencies that bypass console and write to
 * process.stdout or process.stderr directly (debug loggers, library
 * banners), whose output would otherwise live only in the worker's
 * process streams, invisible to the traces. A write inside a call is
 * recorded in place of the stream write: its callback is still called,
 * and it answers as a write that was taken. The agent's debug lines
 * exist for the traces, so one written outside any call, where no
 * trace holds it, is dropped. Every other write outside a call, the
 * writes the patched console itself performs and all output of a
 * process with no sink pass through untouched. Installed by the serve
 * wrapper only: hermetic test runners own their process streams.
 */
/** The error stream's own write, as it was before the capture took it:
 * the kernel's words about itself ride it, past the capture. */
let originalStderr: ((chunk: string, written?: () => void) => boolean) | undefined;

/** Says a word of the kernel's own (the copy's rest, a park, a resume,
 * an ask made again) on the process's error stream, past the trace
 * capture, so it reaches whoever reads the process (an instance's log,
 * a laptop's host log); the boot call's trace keeps it too. */
export function kernelSay(text: string, written?: () => void): void {
  if (streamsInstalled && traceSinkInstalled() && bootCallOpen() && !consoleWriting) {
    const line = stripAnsi(text).trimEnd();
    if (line.length > 0) bootLine('error', line);
  }
  (
    originalStderr ??
    ((chunk: string, done?: () => void): boolean => process.stderr.write(chunk, done))
  )(text, written);
}

export function installStreamCapture(): void {
  if (streamsInstalled) return;
  streamsInstalled = true;
  for (const [stream, level] of [
    [process.stdout, 'info'],
    [process.stderr, 'error'],
  ] as const) {
    const original = stream.write.bind(stream);
    if (level === 'error')
      originalStderr = (chunk: string, written?: () => void): boolean =>
        written === undefined ? original(chunk) : original(chunk, written);
    const patched: typeof stream.write = (
      chunk: Uint8Array | string,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const taken = (): boolean => {
        const written = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
        if (written !== undefined) process.nextTick(written);
        return true;
      };
      const execution = consoleWriting ? undefined : currentExecution();
      if (execution !== undefined && traceSinkInstalled()) {
        const { context } = execution;
        const text = stripAnsi(
          typeof chunk === 'string'
            ? chunk
            : Buffer.from(chunk).toString(
                typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8',
              ),
        ).trimEnd();
        if (text.length > 0) {
          // The agent's own debuglog('agent') lines (node:util, on
          // when NODE_DEBUG names the section, which a verification
          // pair's copies do) arrive as `AGENT <pid>: <message>`: they
          // record at debug level, prefix stripped, and stay hidden
          // until an operator asks for them.
          const debug = DEBUGLOG_LINE.exec(text);
          emitTrace({
            agentId: context.agentId,
            callId: context.callId,
            seq: nextTraceSequence(execution.trace),
            at: wallNowIso(),
            kind: 'log',
            level: debug === null ? level : 'debug',
            message: debug?.[1] ?? text,
          });
          // A line the agent writes on its error stream is its word to
          // whoever reads the process (the launcher's error file, a
          // laptop's host log), beside the trace: it passes through,
          // where a debug line and anything on stdout stay the trace's.
          if (level === 'error' && debug === null) {
            if (typeof encodingOrCallback === 'function')
              return original(chunk, encodingOrCallback);
            return original(chunk, encodingOrCallback, callback);
          }
        }
        return taken();
      }
      if (execution === undefined && !consoleWriting && traceSinkInstalled()) {
        if (isDebugLine(chunk)) return taken();
        if (bootCallOpen()) {
          const text = stripAnsi(
            typeof chunk === 'string'
              ? chunk
              : Buffer.from(chunk).toString(
                  typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8',
                ),
          ).trimEnd();
          if (text.length > 0) bootLine(level, text);
          return taken();
        }
      }
      if (typeof encodingOrCallback === 'function') {
        return original(chunk, encodingOrCallback);
      }
      return original(chunk, encodingOrCallback, callback);
    };
    stream.write = patched;
  }
}
