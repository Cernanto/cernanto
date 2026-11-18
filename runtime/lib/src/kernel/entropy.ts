// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The kernel's own randomness, fresh in every life of a process. An
// image carries the process's memory whole, OpenSSL's generator state
// with it, so two lives restored from one image draw the same bytes
// from node:crypto (its UUID cache, every refill of the cache, every
// `randomBytes`) until OpenSSL reseeds itself hours later: the same
// request tokens, claim names, write nonces and ids. Every draw here is
// keyed by a key read from the system's own entropy device at the
// process's start and again at every resume, past every generator in
// the process's memory, so no two lives of one image draw alike.

import { closeSync, openSync, readSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';

/** The system's entropy device, where the system has one. */
const DEVICE = '/dev/urandom';

/** Bytes from the system's entropy device, read past every generator
 * in the process's memory; node:crypto's where the system offers no
 * device. */
function systemBytes(size: number): Buffer {
  let handle: number | undefined;
  try {
    handle = openSync(DEVICE, 'r');
    const out = Buffer.alloc(size);
    for (let read = 0; read < size;) {
      const got = readSync(handle, out, read, size - read, null);
      if (got <= 0) throw new Error(`${DEVICE} gave nothing`);
      read += got;
    }
    return out;
  } catch {
    return randomBytes(size);
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

let key = systemBytes(32);
let drawn = 0;

/** Takes a fresh key from the system: every resume takes one before
 * anything of the process draws again. */
export function refreshEntropy(): void {
  key = systemBytes(32);
  drawn = 0;
}

/** Random bytes no other life of this process's image draws: blocks of
 * HMAC-SHA256 under the life's key over a running count. */
export function freshBytes(size: number): Buffer {
  const out = Buffer.alloc(size);
  for (let filled = 0; filled < size; filled += 32) {
    drawn += 1;
    createHmac('sha256', key).update(String(drawn)).digest().copy(out, filled);
  }
  return out;
}

/** A version 4 UUID no other life of this process's image draws. */
export function freshUUID(): string {
  const bytes = freshBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
