// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The pure spelling of a safe token, with nothing behind it.

/** Escapes every character outside `safe` as `=` and four hex digits,
 * `=` itself as `==`. The marker is `=` because `~` and `:` carry
 * meanings of their own: a linked module's call id is its host's id,
 * `~` and an ordinal, and every reader of the traces roots a record on
 * the first `~` of its call id; a handle is service, generation and
 * call id joined by `:`. */
export function escaped(text: string, safe: RegExp): string {
  return text.replaceAll(safe, (char) => {
    if (char === '=') return '==';
    const code = char.codePointAt(0) ?? 0;
    return `=${code.toString(16).padStart(4, '0')}`;
  });
}

/** A token of the runtime's safe alphabet: a call id or an idempotency
 * key of any spelling still names one token in a key, a file name or a
 * handle. Every other character is escaped (`escaped` above). */
export function subjectToken(text: string): string {
  return escaped(text, /[^A-Za-z0-9_-]/g);
}
