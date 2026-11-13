// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The tar reader of the kit: a package file is read back through it
// (the cli's describe, the registry gate, the proofs), so what a writer
// wrote is what every reader sees, on every system. The process package keeps its
// own reader, since the plane runs without this kit.

export interface ReadTarEntry {
  path: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  content?: Buffer;
  target?: string;
  mode: number;
}

function fieldText(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul < 0 ? length : nul).toString('utf8');
}

/** A header's number: octal digits alone, or nothing for zero. Any
 * other text (a sign, a letter) is no archive this reader reads. */
function fieldOctal(block: Buffer, offset: number, length: number): number {
  const text = fieldText(block, offset, length).trim();
  if (!/^[0-7]*$/.test(text)) {
    throw new Error('not a tar archive: a header carries a number that does not read as one');
  }
  return text === '' ? 0 : Number.parseInt(text, 8);
}

function parsePax(content: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let cursor = 0;
  while (cursor < content.length) {
    const space = content.indexOf(0x20, cursor);
    if (space < 0) break;
    const length = Number.parseInt(content.subarray(cursor, space).toString('ascii'), 10);
    if (!Number.isFinite(length) || length <= 0 || cursor + length > content.length) break;
    const record = content.subarray(space + 1, cursor + length);
    const text = record.toString('utf8');
    const equals = text.indexOf('=');
    if (equals > 0) {
      records.set(text.slice(0, equals), text.slice(equals + 1).replace(/\n$/, ''));
    }
    cursor += length;
  }
  return records;
}

/** Parses a tar buffer into entries; pax path/linkpath overrides are
 * applied to the entry that follows them. */
export function readTar(tar: Buffer): ReadTarEntry[] {
  const entries: ReadTarEntry[] = [];
  let pending: Map<string, string> | undefined;
  let cursor = 0;
  while (cursor + 512 <= tar.length) {
    const block = tar.subarray(cursor, cursor + 512);
    cursor += 512;
    if (block.every((byte) => byte === 0)) continue;
    const size = fieldOctal(block, 124, 12);
    const typeflag = String.fromCharCode(block[156] ?? 0x30);
    // An entry's bytes lie whole inside the archive, and the reader
    // moves past them: every entry leaves the cursor further on.
    if (cursor + size > tar.length) {
      throw new Error('not a tar archive: an entry runs past the end of the file');
    }
    const content = tar.subarray(cursor, cursor + size);
    cursor += Math.ceil(size / 512) * 512;
    if (typeflag === 'x') {
      pending = parsePax(Buffer.from(content));
      continue;
    }
    const overrides = pending;
    pending = undefined;
    const rawPath = fieldText(block, 0, 100);
    const path = overrides?.get('path') ?? rawPath;
    const target = overrides?.get('linkpath') ?? fieldText(block, 157, 100);
    const kind =
      typeflag === '0' || typeflag === '\0'
        ? 'file'
        : typeflag === '5'
          ? 'dir'
          : typeflag === '2'
            ? 'symlink'
            : 'other';
    entries.push({
      path: kind === 'dir' ? path.replace(/\/$/, '') : path,
      kind,
      ...(kind === 'file' ? { content: Buffer.from(content) } : {}),
      ...(kind === 'symlink' ? { target } : {}),
      mode: fieldOctal(block, 100, 8),
    });
  }
  return entries;
}
