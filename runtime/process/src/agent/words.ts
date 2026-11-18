// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The block's words about the machine it runs on, for the host job,
// the coders' harnesses and the cli: what a read says of recorded
// processes (`--measure`), the end of a
// recorded process with what its launch left (`--end`), and a coder's
// toolbox (`--toolbox`). This file reads a word's arguments and prints
// its answer, and decides nothing: which processes an answer names and
// which a signal goes to is the runtime's process adapter's, the
// toolbox its maker's. It loads nothing else of the runtime: the host
// job says `--measure` in every sweep.
//
// A pid never crosses this boundary alone: whoever asks hands the pid,
// its start and the boot's identity, and all three are checked against
// a fresh read before anything under the pid is looked at or
// signalled. Every answer is one JSON document on the standard output;
// a failure is its words on the standard error, the last line the
// reason, and an exit of 1.

import {
  BLOCK_WORDS,
  endRecorded,
  makeToolbox,
  measured,
  sample,
} from '@cernanto/runtime-lib/machine';
import type { Recorded, ToolboxAnswer } from '@cernanto/runtime-lib/machine';

export const MACHINE_USAGE: string = `${BLOCK_WORDS.measure} (the recorded processes on its standard input) | ${BLOCK_WORDS.end} [${BLOCK_WORDS.atOnce} | ${BLOCK_WORDS.leftOnly}] <pid> <start> <boot> [<word>] | ${BLOCK_WORDS.toolbox} <folder> <program> ...`;

/** A use of a word that is none of its forms. */
export class WrongUse extends Error {}

function say(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function standardInput(): Promise<string> {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk as string;
  return text;
}

const whole = (word: string | undefined): number | undefined =>
  word !== undefined && /^\d+$/.test(word) ? Number(word) : undefined;

/** The recorded processes an ask names: each a pid, with the start and
 * the boot beside it as far as the record has them. */
function recordedOf(value: unknown): Recorded[] {
  if (!Array.isArray(value)) throw new WrongUse();
  return value.map((one: unknown): Recorded => {
    if (typeof one !== 'object' || one === null) throw new WrongUse();
    const { pid, started, boot } = one as Record<string, unknown>;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1) throw new WrongUse();
    return {
      pid,
      ...(typeof started === 'string' && started !== '' ? { started } : {}),
      ...(typeof boot === 'string' && boot !== '' ? { boot } : {}),
    };
  });
}

/** `--measure`: what one read says of each recorded process on the
 * standard input, by the adapter's measure. */
async function measure(): Promise<void> {
  let asked: Recorded[];
  try {
    asked = recordedOf(JSON.parse(await standardInput()) as unknown);
  } catch {
    throw new WrongUse();
  }
  say(measured(asked, await sample()));
}

/** `--end`: the end of a recorded process and of what its launch left,
 * by the adapter's end. An end that left something says its answer and
 * then fails, naming what is left: what would not go, and what no read
 * vouches for while the system says it runs. So an end that exits 0
 * left nothing, and whoever runs this word may go by its exit: an end
 * of a process the read could not vouch for sent nothing, and fails. */
async function end(words: string[]): Promise<void> {
  const atOnce = words[0] === BLOCK_WORDS.atOnce;
  const leftOnly = words[0] === BLOCK_WORDS.leftOnly;
  const [pidWord, started = '', boot = '', word = '', more] =
    atOnce || leftOnly ? words.slice(1) : words;
  const pid = whole(pidWord);
  if (pid === undefined || pid < 1 || more !== undefined) throw new WrongUse();
  if (word !== '' && !word.includes('=')) throw new WrongUse();
  const ended = await endRecorded(
    { pid, ...(started === '' ? {} : { started }), ...(boot === '' ? {} : { boot }) },
    word,
    { atOnce, leftOnly },
  );
  say(ended);
  if (ended.left.length === 0) return;
  throw new Error(
    ended.answer === 'unknown' && !leftOnly
      ? `the process ${String(pid)} is there and no read tells whether it is the record's: nothing was sent`
      : `processes that would not go: ${ended.left.join(', ')}`,
  );
}

/** `--toolbox`: the toolbox of a coder's shell for a list of programs
 * in a folder, made when absent and kept current. */
function toolbox(words: string[]): void {
  const [folder, ...programs] = words;
  if (folder === undefined || folder === '' || programs.length === 0) throw new WrongUse();
  const answer: ToolboxAnswer = makeToolbox(folder, programs);
  say(answer);
}

/** Answers one of the machine's words. */
export async function machineWord(words: string[]): Promise<void> {
  const [word, ...rest] = words;
  if (word === BLOCK_WORDS.measure) {
    if (rest.length > 0) throw new WrongUse();
    await measure();
  } else if (word === BLOCK_WORDS.end) {
    await end(rest);
  } else if (word === BLOCK_WORDS.toolbox) {
    toolbox(rest);
  } else {
    throw new WrongUse();
  }
}
