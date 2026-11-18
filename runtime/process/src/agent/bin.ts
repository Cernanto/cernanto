#!/usr/bin/env node
// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The block's entry: the arguments and nothing else. It reads its first
// word before it loads anything, so a word about the machine (a
// measure, an end, a toolbox: words.ts) loads the process adapter
// alone and answers in a fraction of what the block's own forms take
// to load: the host job says such a word in every sweep. Every other
// use is one of the block's forms (block.ts).
//
//   cernanto-agent <generation> <copy> <attempt>
//   cernanto-agent cernanto/host
//   cernanto-agent --detach <what to run>
//   cernanto-agent --prepare <generation> <copy>
//   cernanto-agent --stop [--grace <ms>]
//   cernanto-agent --measure
//   cernanto-agent --end [--at-once | --left-only] <pid> <start> <boot> [<word>]
//   cernanto-agent --toolbox <folder> <program> ...
//   cernanto-agent --help

const given = process.argv.slice(2);

/** The words answered by the process adapter alone. */
const MACHINE_WORDS = ['--measure', '--end', '--toolbox'];

if (given[0] !== undefined && MACHINE_WORDS.includes(given[0])) {
  const { MACHINE_USAGE, WrongUse, machineWord } = await import('./words.js');
  machineWord(given).then(
    () => {
      // The answer is written: the exit waits for it, which a pipe may
      // take after this turn.
      process.stdout.write('', () => process.exit(0));
    },
    (error: unknown) => {
      const words =
        error instanceof WrongUse
          ? `usage: cernanto-agent ${MACHINE_USAGE}`
          : error instanceof Error
            ? error.message
            : String(error);
      process.stderr.write(`${words}\n`, () => process.exit(1));
    },
  );
} else {
  const { block } = await import('./block.js');
  block(given);
}
