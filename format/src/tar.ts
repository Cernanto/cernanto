// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// A deterministic tar writer: a package file must hash identically
// on every machine and every run, so the same content is always the
// same package digest. Fixed epoch mtime, zero uid/gid, empty owner
// names, caller-ordered entries, and pax extended headers only where
// a field genuinely does not fit.

export interface TarEntry {
  /** Posix-style relative path inside the archive, no leading slash. */
  path: string;
  kind: 'file' | 'dir' | 'symlink';
  /** File content; required when kind is `file`. */
  content?: Buffer;
  /** Link target; required when kind is `symlink`. */
  target?: string;
  /** Files only: mode 755 instead of 644. */
  executable?: boolean;
}

const BLOCK = 512;

function octal(value: number, width: number): Buffer {
  const text = value.toString(8).padStart(width - 1, '0');
  if (text.length > width - 1) {
    throw new Error(`tar field overflow: ${String(value)} does not fit ${String(width)} octal`);
  }
  return Buffer.from(`${text}\0`, 'ascii');
}

function padded(buffer: Buffer): Buffer {
  const remainder = buffer.length % BLOCK;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(BLOCK - remainder)]);
}

function header(options: {
  name: string;
  mode: number;
  size: number;
  typeflag: string;
  linkname?: string;
}): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(options.name, 0, 100, 'utf8');
  octal(options.mode, 8).copy(block, 100);
  octal(0, 8).copy(block, 108);
  octal(0, 8).copy(block, 116);
  octal(options.size, 12).copy(block, 124);
  octal(0, 12).copy(block, 136);
  block.fill(' ', 148, 156);
  block.write(options.typeflag, 156, 1, 'ascii');
  if (options.linkname !== undefined) block.write(options.linkname, 157, 100, 'utf8');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  const checksum = Buffer.from(`${sum.toString(8).padStart(6, '0')}\0 `, 'ascii');
  checksum.copy(block, 148);
  return block;
}

function paxRecord(key: string, value: string): string {
  // The length prefix counts the whole record in bytes including
  // itself; the fixed point is found by trying successive widths.
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body, 'utf8') + 1;
  while (Buffer.byteLength(`${String(length)}${body}`, 'utf8') !== length) {
    length = Buffer.byteLength(`${String(length)}${body}`, 'utf8');
  }
  return `${String(length)}${body}`;
}

/** True when the string fits a 100-byte header field in utf8. */
function fits(value: string): boolean {
  return Buffer.byteLength(value, 'utf8') <= 100;
}

function entryBlocks(entry: TarEntry): Buffer[] {
  const blocks: Buffer[] = [];
  const isDir = entry.kind === 'dir';
  const name = isDir && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path;
  const target = entry.kind === 'symlink' ? (entry.target ?? '') : undefined;
  if (entry.kind === 'symlink' && (target === undefined || target === '')) {
    throw new Error(`symlink entry without a target: ${entry.path}`);
  }
  if (entry.kind === 'file' && entry.content === undefined) {
    throw new Error(`file entry without content: ${entry.path}`);
  }
  const needsPax = !fits(name) || (target !== undefined && !fits(target));
  if (needsPax) {
    let pax = '';
    if (!fits(name)) pax += paxRecord('path', name);
    if (target !== undefined && !fits(target)) pax += paxRecord('linkpath', target);
    const content = Buffer.from(pax, 'utf8');
    blocks.push(
      header({
        name: `PaxHeaders/${name.slice(0, 88)}`,
        mode: 0o644,
        size: content.length,
        typeflag: 'x',
      }),
      padded(content),
    );
  }
  const shortName = fits(name) ? name : name.slice(0, 100);
  const shortTarget = target === undefined ? undefined : fits(target) ? target : '';
  const content = entry.kind === 'file' ? (entry.content ?? Buffer.alloc(0)) : Buffer.alloc(0);
  blocks.push(
    header({
      name: shortName,
      mode: isDir || entry.executable === true ? 0o755 : entry.kind === 'symlink' ? 0o777 : 0o644,
      size: content.length,
      typeflag: entry.kind === 'file' ? '0' : isDir ? '5' : '2',
      ...(shortTarget === undefined ? {} : { linkname: shortTarget }),
    }),
  );
  if (content.length > 0) blocks.push(padded(content));
  return blocks;
}

/** Serializes the entries, in the order given, into one tar buffer. */
export function writeTar(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) blocks.push(...entryBlocks(entry));
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}
