// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { CernantoError } from '@cernanto/package-format';

import { openInBrowser } from './open-url.js';

// The terminal a person types into: what the account screens and the
// coder chooser need from it, the one implementation over stdin (masked
// input for secrets), and the io of a run with no person at it. Tests
// hand in their own.

export interface ConnectIo {
  write(line: string): void;
  /** Prompts for one field; masked input when secret. A secret is
   * answered as it was typed, to the character; any other answer is
   * trimmed. */
  ask(label: string, secret: boolean): Promise<string>;
  sleep(ms: number): Promise<void>;
  /** Opens a url in the operator's browser; absent in tests. */
  open?: (url: string) => void;
  /** Picks one of several listed things by number (zero-based
   * answer); absent on a pipe, which names one instead. */
  pick?: (label: string, count: number) => Promise<number>;
}

/** What the prompts read and draw on: the process's own terminal, or
 * the streams a test hands in. */
export interface TerminalStreams {
  input: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };
  output: { write(text: string): unknown };
  /** How the process ends at an interrupt nobody listens for
   * (`process.exit` by default). */
  exit?: (code: number) => void;
}

/**
 * The interactive io: plain prompts, masked for secrets. What is read
 * beyond one answer waits for the next ask, so a paste of several
 * lines answers several prompts; Ctrl-D, like the input closing, ends
 * the ask in words. Ctrl-C at a prompt is the process's interrupt: the
 * terminal is restored and whoever listens for the interrupt hears it,
 * as for one typed at any other moment.
 *
 * @param streams - The input and output; the process's own by default.
 * @returns The io the account screens and the choosers draw on.
 * @example
 * const io = terminalIo();
 * const key = await io.ask('api key', true);
 */
export function terminalIo(
  streams: TerminalStreams = { input: process.stdin, output: process.stdout },
): ConnectIo {
  const { input, output } = streams;
  // The text read and not yet asked for.
  let pending = '';
  // A carriage return ended the last answer: the line feed of the same
  // line ending is no answer of its own.
  let afterReturn = false;
  // The input closed: an ask after it has nothing to wait for.
  let closed = false;
  // A character may arrive split across two chunks.
  const decoder = new StringDecoder('utf8');
  const raw = (mode: boolean): void => {
    if (input.isTTY === true) input.setRawMode?.(mode);
  };
  const io: ConnectIo = {
    write: (line: string): void => {
      output.write(line);
    },
    open: (url: string): void => {
      openInBrowser(url);
    },
    pick: async (label: string, count: number): Promise<number> => {
      for (;;) {
        const answer = await io.ask(`? ${label} (1-${String(count)})`, false);
        const index = Number(answer);
        if (Number.isInteger(index) && index >= 1 && index <= count) return index - 1;
        output.write(`a number from 1 to ${String(count)}\n`);
      }
    },
    ask: async (label: string, secret: boolean): Promise<string> => {
      output.write(`${label}: `);
      return new Promise((resolve, reject) => {
        let value = '';
        // An escape sequence (an arrow key, a function key) arrives as
        // ESC followed by its bytes; none of it is typed text.
        let escaping = false;
        let listening = false;
        const release = (): void => {
          if (listening) {
            input.off('data', onData);
            input.off('end', onClosed);
            input.off('error', onClosed);
            raw(false);
            input.pause();
          }
          output.write('\n');
        };
        // The input ended under the question: the ask ends in words.
        const onEnd = (): void => {
          release();
          reject(
            new CernantoError({
              kind: 'terminal',
              message: `the input ended before "${label}" was answered`,
            }),
          );
        };
        const onClosed = (): void => {
          closed = true;
          onEnd();
        };
        /** Reads the pending text up to the end of this answer; true
         * once the ask is settled. */
        const take = (): boolean => {
          let taken = 0;
          for (const char of pending) {
            taken += char.length;
            if (afterReturn) {
              afterReturn = false;
              if (char === '\n') continue;
            }
            if (escaping) {
              // A CSI sequence ends at its final byte (0x40 to 0x7e); a
              // lone ESC pair ends at once.
              const code = char.charCodeAt(0);
              if (char !== '[' && code >= 0x40 && code <= 0x7e) escaping = false;
              continue;
            }
            if (char === '\u001b') {
              escaping = true;
              continue;
            }
            if (char === '\n' || char === '\r') {
              afterReturn = char === '\r';
              pending = pending.slice(taken);
              release();
              resolve(secret ? value : value.trim());
              return true;
            }
            if (char === '\u0003') {
              // Ctrl-C: raw mode hands the key over as a character, so
              // the interrupt is passed on from here, the terminal
              // restored first (raw mode left on leaves the shell
              // unable to echo). Whoever listens for the process's
              // interrupt hears it, a watch with its last words to say
              // among them; with nobody listening the process ends as
              // an interrupt ends it.
              pending = '';
              release();
              if (!process.emit('SIGINT', 'SIGINT')) (streams.exit ?? process.exit)(130);
              reject(
                new CernantoError({ kind: 'terminal', message: `"${label}" was interrupted` }),
              );
              return true;
            }
            if (char === '\u0004') {
              // Ctrl-D: the operator ended the input; raw mode hands the
              // key over as a character.
              pending = '';
              onEnd();
              return true;
            }
            if (char === '\u007f' || char === '\b') {
              // Raw mode leaves the echo to this code, so the deletion
              // is drawn here: back, blank, back.
              if (value.length > 0) {
                value = Array.from(value).slice(0, -1).join('');
                output.write('\b \b');
              }
              continue;
            }
            if (char < ' ') continue;
            value += char;
            output.write(secret ? '*' : char);
          }
          pending = '';
          return false;
        };
        const onData = (chunk: Buffer | string): void => {
          pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
          take();
        };
        if (take()) return;
        if (closed) {
          onEnd();
          return;
        }
        listening = true;
        raw(true);
        input.resume();
        input.on('data', onData);
        input.once('end', onClosed);
        input.once('error', onClosed);
      });
    },
    sleep: (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
  return io;
}

/** The io of a run with no person at it (a pipe, a scheduled job):
 * lines are written and a url is printed for the operator to open; a
 * question is refused in words that name the file road, and several
 * waiting asks are named in place of a pick. */
export function pipeIo(): ConnectIo {
  return {
    write: (line: string): void => {
      process.stdout.write(line);
    },
    ask: (label: string): Promise<string> =>
      Promise.reject(
        new CernantoError({
          kind: 'terminal',
          message: `"${label}" needs an answer and no terminal is attached; give the answers in a file: cernanto auth login <agent> <name> --from <file>`,
        }),
      ),
    sleep: (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}
