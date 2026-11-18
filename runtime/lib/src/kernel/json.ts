// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The runtime writes JSON at every boundary a value crosses: the
// envelope of a call, its reply, the journal's records, the traces.
// JSON spells no bytes, and a Buffer's own toJSON spells them as an
// array of numbers, four times the size; so wherever the runtime writes
// JSON, bytes leave as base64 text, by their type alone, and the
// contract on the receiving side says where to turn the text back
// (language/shapes.ts).

/** The JSON text of a value, bytes as base64; everything else is
 * JSON.stringify's own, a value with nothing to spell answering
 * undefined as it does. The bytes are spelled before the stringify
 * walks the value: JSON.stringify asks a Buffer's own toJSON first,
 * which lays a large buffer out as an array of numbers and ends the
 * process on tens of megabytes (V8's table size), so a replacer alone
 * comes too late. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(spelled(value, new Map()), bytesAsBase64);
}

/** The value with every Uint8Array, at any depth, as its base64 text:
 * a plain object or array copied as far as it holds one, everything
 * else (a value of its own class, a Date, a function) as it is, so a
 * toJSON of its own still speaks. A value met twice answers the same
 * copy, so a cycle ends where JSON.stringify would see it. */
function spelled(value: unknown, seen: Map<object, unknown>): unknown {
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  }
  if (typeof value !== 'object' || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const copy: unknown[] = new Array<unknown>(value.length);
    seen.set(value, copy);
    for (let index = 0; index < value.length; index += 1) copy[index] = spelled(value[index], seen);
    return copy;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, inner] of Object.entries(value as Record<string, unknown>))
    copy[key] = spelled(inner, seen);
  return copy;
}

/** A value JSON read, as a reading of its own: every array and every
 * plain object copied down to its leaves, so whoever is handed the
 * copy holds nothing of the value it was made from, and may change it.
 * A value of another class (JSON reads none) is handed as it is. */
export function readingOf<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    const copy: unknown[] = new Array<unknown>(items.length);
    for (let index = 0; index < items.length; index += 1) copy[index] = readingOf(items[index]);
    return copy as T;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const members = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(members)) {
    const inner = readingOf(members[key]);
    // A member named `__proto__` is a member of the copy as it is of
    // the reading: defined, since an assignment would set a prototype.
    if (key === '__proto__') {
      Object.defineProperty(copy, key, {
        value: inner,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else copy[key] = inner;
  }
  return copy as T;
}

/** The replacer: a Uint8Array, a Buffer included, read from its holder
 * before the Buffer's own toJSON spoke, leaves as base64 text (the
 * walk above spelled every one a plain value holds; this catches one
 * inside a value of another class). */
function bytesAsBase64(this: unknown, key: string, value: unknown): unknown {
  const holder = this as Record<string, unknown> | null | undefined;
  const raw = holder === null || holder === undefined ? undefined : holder[key];
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('base64');
  }
  return value;
}
