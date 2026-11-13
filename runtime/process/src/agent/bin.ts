#!/usr/bin/env node
// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The block's entry: the arguments and nothing else. A failure is loud
// and terminal: whoever started the copy reads the reason in the
// copy's error stream, the host job in the command's words, which are
// THE LAST LINE of that stream. So a failure writes where it failed
// first, for the one who reads the stream, and its words alone after
// that, for the host job, which takes the last line for the reason. A
// use that is
// none of the forms below is answered with them in one line, and
// `--help` with them on the standard output.
//
//   cernanto-agent <generation> <copy> <attempt>
//   cernanto-agent <package.cern>
//   cernanto-agent <agent id>
//   cernanto-agent --detach <what to run>
//   cernanto-agent --prepare <generation> <copy>
//   cernanto-agent --stop [--grace <ms>]
//   cernanto-agent --help

import { detach, prepare, runCopy, runRelease, runStandalone, stopHost } from './main.js';

const USAGE =
  'cernanto-agent <generation> <copy> <attempt> | <package.cern> | <agent id> | --detach <what to run> | --prepare <generation> <copy> | --stop [--grace <ms>]';

const HELP = `cernanto-agent: runs one package as one process

  cernanto-agent <generation> <copy> <attempt>   a copy on a plane, by its slot record
  cernanto-agent <package.cern>                  a package by itself
  cernanto-agent <agent id>                      the release's own package of that agent
  cernanto-agent --detach <what to run>          any of the three, started as a process of its own
  cernanto-agent --prepare <generation> <copy>   a copy's folder laid out for a restore
  cernanto-agent --stop [--grace <ms>]           the host's stop word
`;

/** A use that is none of the forms: answered with them, in one line. */
class WrongUse extends Error {}

/** The grace a stop gives the copies before the last resort: the host
 * job's own, forty seconds, when none is named. */
const STOP_GRACE_MS = 40_000;

const whole = (word: string | undefined): number | undefined =>
  word !== undefined && /^\d+$/.test(word) ? Number(word) : undefined;

async function main(words: string[]): Promise<void> {
  const [first, second, third, fourth] = words;
  if (first === undefined) throw new WrongUse();
  if (first === '--stop') {
    let grace = STOP_GRACE_MS;
    if (second !== undefined) {
      const named = whole(third);
      if (second !== '--grace' || named === undefined || fourth !== undefined) throw new WrongUse();
      grace = named;
    }
    await stopHost(grace);
    // The word is said and nothing of this command outlives it: what the
    // wire still holds open would keep the process waiting past the
    // caller's patience.
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    process.exit(0);
  }
  if (first === '--detach') {
    if (second === undefined || fourth !== undefined) throw new WrongUse();
    await detach(words.slice(1));
    return;
  }
  if (first === '--prepare') {
    const generation = whole(second);
    const copy = whole(third);
    if (generation === undefined || copy === undefined || fourth !== undefined)
      throw new WrongUse();
    await prepare(generation, copy);
    return;
  }
  if (first.startsWith('-')) throw new WrongUse();
  const generation = whole(first);
  if (generation !== undefined) {
    const copy = whole(second);
    if (copy === undefined || third === undefined || third === '' || fourth !== undefined)
      throw new WrongUse();
    await runCopy(generation, copy, third);
    return;
  }
  if (second !== undefined) throw new WrongUse();
  if (first.endsWith('.cern')) {
    await runStandalone(first);
    return;
  }
  await runRelease(first);
}

/** The last line of a failure's words: what the host job takes for the
 * reason, off the end of this command's error stream. */
function wordsOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message.split('\n').filter((line) => line.trim() !== '');
  return lines.at(-1)?.trim() ?? (error instanceof Error ? error.name : 'failed');
}

const given = process.argv.slice(2);
if (given[0] === '--help' || given[0] === '-h') {
  // The help is the whole answer: nothing of the block runs for it. The
  // exit waits for the write, which a pipe may take after this turn.
  process.stdout.write(HELP, () => process.exit(0));
} else {
  main(given).catch((error: unknown) => {
    if (error instanceof WrongUse) {
      process.stderr.write(`usage: ${USAGE}\n`, () => process.exit(1));
      return;
    }
    const trace = error instanceof Error && error.stack !== undefined ? `${error.stack}\n` : '';
    process.stderr.write(`${trace}${wordsOf(error)}\n`, () => process.exit(1));
  });
}
