// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { pipeIo, terminalIo } from './terminal.js';
import type { ConnectIo } from './terminal.js';

/** The interactive io over streams of the test's own: what is written
 * to `input` is what a person typed or pasted, `drawn` is the screen. */
function terminal(): { io: ConnectIo; input: PassThrough; drawn: () => string } {
  const input = new PassThrough();
  let screen = '';
  const io = terminalIo({
    input,
    output: {
      write: (text: string): boolean => {
        screen += text;
        return true;
      },
    },
  });
  return { io, input, drawn: () => screen };
}

/** The same over an input that is a terminal: the modes it was put in
 * are kept, and so are the codes the process would have ended with. */
function tty(): {
  io: ConnectIo;
  input: PassThrough;
  modes: boolean[];
  exits: number[];
} {
  const input = new PassThrough();
  const modes: boolean[] = [];
  const exits: number[] = [];
  const io = terminalIo({
    input: Object.assign(input, {
      isTTY: true,
      setRawMode: (mode: boolean): void => {
        modes.push(mode);
      },
    }),
    output: { write: (): boolean => true },
    exit: (code: number): void => {
      exits.push(code);
    },
  });
  return { io, input, modes, exits };
}

test('a secret is answered as it was typed, to the character, and drawn masked; any other answer is trimmed', async () => {
  const { io, input, drawn } = terminal();
  const user = io.ask('user', false);
  input.write('  alice  \n');
  assert.equal(await user, 'alice');
  const password = io.ask('password', true);
  input.write('  exact secret  \n');
  assert.equal(await password, '  exact secret  ');
  assert.doesNotMatch(drawn(), /exact secret/);
  assert.ok(drawn().includes(`password: ${'*'.repeat(16)}\n`));
});

test('a paste that carries several answers answers each ask with its own line', async () => {
  const { io, input } = terminal();
  input.write('alice\rhunter2\r');
  assert.equal(await io.ask('user', false), 'alice');
  assert.equal(await io.ask('password', true), 'hunter2');
  // A line ending of two characters ends one answer: the line feed
  // after the return is no empty answer to the next ask.
  input.write('one\r\ntwo\r\n');
  assert.equal(await io.ask('first', false), 'one');
  assert.equal(await io.ask('second', false), 'two');
  const third = io.ask('third', false);
  input.write('three\n');
  assert.equal(await third, 'three');
});

test('an answer typed across several chunks is one answer, its deletions and escape sequences left out', async () => {
  const { io, input } = terminal();
  const answer = io.ask('name', false);
  input.write('ab');
  input.write('\u007fc');
  // An arrow key, then a character of two code units and its deletion.
  input.write('\u001b[Ad\u{1f600}\u007f\n');
  assert.equal(await answer, 'acd');
  // A character split across two chunks arrives whole.
  const split = io.ask('city', false);
  const bytes = Buffer.from('é\n', 'utf8');
  input.write(bytes.subarray(0, 1));
  input.write(bytes.subarray(1));
  assert.equal(await split, 'é');
});

test('Ctrl-D ends the ask in words, and so does the input closing, for the ask it closes under and the ones after', async () => {
  const { io, input } = terminal();
  const empty = io.ask('token', true);
  input.write('\u0004');
  await assert.rejects(empty, /the input ended before "token" was answered/);
  const typed = io.ask('token', true);
  input.write('abc\u0004');
  await assert.rejects(typed, /the input ended before "token" was answered/);
  // The terminal is still there: the next ask reads on.
  const next = io.ask('name', false);
  input.write('ok\n');
  assert.equal(await next, 'ok');
  const under = io.ask('key', true);
  input.end();
  await assert.rejects(under, /the input ended before "key" was answered/);
  await assert.rejects(io.ask('other', false), /the input ended before "other" was answered/);
});

test("Ctrl-C at a prompt is the process's interrupt: the terminal is restored, whoever listens hears it, and with nobody listening the process ends as an interrupt ends it", async () => {
  // A watch that listens for the interrupt hears the one typed at a
  // prompt, where the terminal reads the keys itself.
  const watched = tty();
  const heard: string[] = [];
  const listener = (): void => {
    heard.push(`interrupt, the terminal ${watched.modes.at(-1) === false ? 'restored' : 'raw'}`);
  };
  process.once('SIGINT', listener);
  try {
    const password = watched.io.ask('password', true);
    watched.input.write('hunt\u0003');
    await assert.rejects(password, /"password" was interrupted/);
    assert.deepEqual(heard, ['interrupt, the terminal restored']);
    assert.deepEqual(watched.modes, [true, false]);
    assert.deepEqual(watched.exits, [], 'the listener has the last word');
  } finally {
    process.removeListener('SIGINT', listener);
  }
  // With nobody listening the process ends with the interrupt's code.
  const alone = tty();
  const answer = alone.io.ask('user', false);
  alone.input.write('\u0003');
  await assert.rejects(answer, /"user" was interrupted/);
  assert.deepEqual(alone.exits, [130]);
  assert.deepEqual(alone.modes, [true, false]);
});

test('with no terminal attached a question is refused in words that name the file road, and nothing is picked', async () => {
  const io = pipeIo();
  await assert.rejects(
    io.ask('api key', true),
    /"api key" needs an answer and no terminal is attached; give the answers in a file: cernanto auth login <agent> <name> --from <file>/,
  );
  // Several waiting asks are named by the caller: the io offers no pick,
  // and no browser to open.
  assert.equal(io.pick, undefined);
  assert.equal(io.open, undefined);
});
