// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// An error's stack names the files a process ran, and a copy runs its
// package's code from its generation's own folder with the types
// blanked in place. So a line of a stack that lies in an agent's own
// code is a line of that package's file, and the folder says which
// generation ran it.

/** A line of an error's stack that lies in an agent's own code. */
export interface OwnFrame {
  /** The plane-wide port of the generation that ran it. */
  port: number;
  /** The package's file the line stands in. */
  file: string;
  line: number;
}

const FRAME = /\/generations\/[^/\s]+-s(\d+)\/work\/agent\/dist\/([^\s:()]+)\.js:(\d+)/;

/**
 * Reads a stack's line that lies in an agent's own code: the generation
 * that ran it, the package's file and the line. A line of the runtime's
 * code, of a library or of Node itself answers undefined.
 *
 * @example
 * ownFrame('    at greet (file:///home/a/.cernanto/dev/generations/ops-bank-s20077/work/agent/dist/index.js:28:26)');
 * // => { port: 20077, file: 'code/index.ts', line: 28 }
 */
export function ownFrame(stackLine: string): OwnFrame | undefined {
  const found = FRAME.exec(stackLine);
  if (found === null) return undefined;
  const line = Number(found[3]);
  if (!Number.isInteger(line) || line < 1) return undefined;
  return { port: Number(found[1]), file: `code/${found[2] ?? ''}.ts`, line };
}

/**
 * Where a stack's line leads: the file and the line, in the generation
 * that ran it. The address names the generation whether or not the
 * agent runs it at that moment: an address is kept and opened again,
 * and a line of generation 2 is no line of the generation the agent
 * has gone on to since.
 *
 * @param gen - The number of the generation whose port the line names.
 */
export function frameAddress(
  frame: OwnFrame,
  gen: number,
): { tab: 'code'; file: string; line: number; gen: number } {
  return { tab: 'code', file: frame.file, line: frame.line, gen };
}
