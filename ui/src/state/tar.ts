// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A tar of text files, written in the browser: the archive a reader
// saves of their sources. The client kit's own writer makes a package's
// bytes and needs Node's buffers, so a browser writes this small one.

const BLOCK = 512;
const encoder = new TextEncoder();

function put(block: Uint8Array, text: string, at: number, width: number): void {
  block.set(encoder.encode(text).subarray(0, width), at);
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** A path as a header carries it: whole in its name while it fits, else
 * its folders in the header's prefix. */
function placed(path: string): { name: string; prefix: string } {
  if (encoder.encode(path).length <= 100) return { name: path, prefix: '' };
  for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1)) {
    const prefix = path.slice(0, cut);
    const name = path.slice(cut + 1);
    if (encoder.encode(prefix).length <= 155 && encoder.encode(name).length <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`The path "${path}" is too long for the archive.`);
}

/**
 * The files as one tar, in the order given.
 *
 * @example
 * saveFile('sources.tar', writeTar([{ name: 'desk/triage.cern.md', text }]), 'application/x-tar');
 */
export function writeTar(
  files: readonly { name: string; text: string }[],
): Uint8Array<ArrayBuffer> {
  const blocks: Uint8Array[] = [];
  for (const file of files) {
    const content = encoder.encode(file.text);
    const { name, prefix } = placed(file.name);
    const header = new Uint8Array(BLOCK);
    put(header, name, 0, 100);
    put(header, octal(0o644, 8), 100, 8);
    put(header, octal(0, 8), 108, 8);
    put(header, octal(0, 8), 116, 8);
    put(header, octal(content.length, 12), 124, 12);
    put(header, octal(Math.floor(Date.now() / 1000), 12), 136, 12);
    header.fill(0x20, 148, 156);
    put(header, '0', 156, 1);
    put(header, 'ustar\0', 257, 6);
    put(header, '00', 263, 2);
    put(header, prefix, 345, 155);
    let sum = 0;
    for (const byte of header) sum += byte;
    put(header, `${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(header, content);
    const rest = content.length % BLOCK;
    if (rest !== 0) blocks.push(new Uint8Array(BLOCK - rest));
  }
  blocks.push(new Uint8Array(BLOCK * 2));
  const out = new Uint8Array(blocks.reduce((sum, block) => sum + block.length, 0));
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}
