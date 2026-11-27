// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useCallback, useSyncExternalStore } from 'react';

// What this browser keeps for the reader: the clock, the plane's name
// and kind, the favorites, what is folded. Each plane is its own
// address, so each keeps its own. Nothing here is a secret, and
// nothing here is the plane's.

const PREFIX = 'cernanto.';
const listeners = new Map<string, Set<() => void>>();

/** The keys that begin with one word: a family, each of its things kept
 * under a key of its own, so that a write of one rewrites no other. */
interface Family {
  /** Who hears a change of any of its keys. */
  heard: Set<() => void>;
  /** Moves at every change of one of its keys. */
  version: number;
  /** The family read whole, good for as long as its version stands. */
  whole?: { version: number; value: Record<string, unknown> };
}
const families = new Map<string, Family>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
/** The keys whose last write the browser did not keep. */
const unkept = new Set<string>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function familyOf(prefix: string): Family {
  const known = families.get(prefix);
  if (known !== undefined) return known;
  const made: Family = { heard: new Set(), version: 0 };
  families.set(prefix, made);
  return made;
}

function tell(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
  for (const [prefix, family] of families) {
    if (!key.startsWith(prefix)) continue;
    family.version += 1;
    for (const listener of family.heard) listener();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith(PREFIX) === true) tell(event.key.slice(PREFIX.length));
  });
}

/** What the browser keeps under a key, or the fallback. */
export function getPref<T>(key: string, fallback: T): T {
  const raw = read(key);
  const held = cache.get(key);
  if (held?.raw === raw) return held.value as T;
  let value: unknown = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value as T;
}

/**
 * Keeps a value under a key; `undefined` forgets it. Where the browser
 * does not take the write, its storage full or closed to this page, the
 * value lasts as long as the window, and `prefKept` says so to whoever
 * must tell the reader.
 */
export function setPref(key: string, value: unknown): void {
  try {
    if (value === undefined) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    // What the browser took is read from the browser from here on.
    cache.delete(key);
    unkept.delete(key);
  } catch {
    cache.set(key, { raw: read(key), value });
    unkept.add(key);
  }
  tell(key);
}

/** Whether the browser kept what this window last wrote under a key. */
export function prefKept(key: string): boolean {
  return !unkept.has(key);
}

/** Whether the browser itself holds a value under a key, whatever this
 * window holds of it: what a reload would find. */
export function prefStored(key: string): boolean {
  return read(key) !== null;
}

/**
 * The keys kept under a word they all begin with, each by itself: the
 * ones the browser holds, and beside them the ones this window alone
 * holds after a write the browser did not take. One key a thing means
 * that two windows never rewrite one value between them.
 */
export function prefKeys(prefix: string): string[] {
  const keys = new Set<string>();
  try {
    const storage = window.localStorage;
    for (let at = 0; at < storage.length; at += 1) {
      const name = storage.key(at);
      if (name?.startsWith(PREFIX + prefix) === true) keys.add(name.slice(PREFIX.length));
    }
  } catch {
    // No storage for this page: what the window holds is all there is.
  }
  for (const key of unkept) {
    if (!key.startsWith(prefix)) continue;
    if (cache.get(key)?.value === undefined) keys.delete(key);
    else keys.add(key);
  }
  return [...keys].sort();
}

/** Hears a kept value change, by this window and by another of this
 * browser alike. Answers the function that ends the hearing. */
export function onPref(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  listeners.set(key, set);
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** Hears every key that begins with a word change, as `onPref` hears one. */
export function onPrefs(prefix: string, listener: () => void): () => void {
  const family = familyOf(prefix);
  family.heard.add(listener);
  return () => {
    family.heard.delete(listener);
  };
}

/**
 * Everything kept under a family, by what follows the family's word in
 * each key. The same reading is answered until one of its keys changes.
 * It has no names of its own, so a thing kept under any name is found by
 * that name and nothing else is.
 */
export function getPrefs<T>(prefix: string): Record<string, T> {
  const family = familyOf(prefix);
  if (family.whole?.version === family.version) return family.whole.value as Record<string, T>;
  const value = Object.create(null) as Record<string, unknown>;
  for (const key of prefKeys(prefix)) {
    const held = getPref<unknown>(key, undefined);
    if (held !== undefined) value[key.slice(prefix.length)] = held;
  }
  family.whole = { version: family.version, value };
  return value as Record<string, T>;
}

/** Everything kept under a family, heard as any of its keys changes,
 * in this window and in another of this browser alike. */
export function usePrefs<T>(prefix: string): Record<string, T> {
  const subscribe = useCallback((listener: () => void) => onPrefs(prefix, listener), [prefix]);
  return useSyncExternalStore(subscribe, () => getPrefs<T>(prefix));
}

/** Whether the browser kept what this window last wrote under a key, heard as it changes. */
export function usePrefKept(key: string): boolean {
  const subscribe = useCallback((listener: () => void) => onPref(key, listener), [key]);
  return useSyncExternalStore(subscribe, () => prefKept(key));
}

/**
 * A value this browser keeps, with the function that changes it. Every
 * part of the screen that reads the same key hears the change, another
 * tab's among them.
 */
export function usePref<T>(
  key: string,
  fallback: T,
): [T, (next: T | ((previous: T) => T)) => void] {
  const subscribe = useCallback((listener: () => void) => onPref(key, listener), [key]);
  const value = useSyncExternalStore(subscribe, () => getPref(key, fallback));
  const change = useCallback(
    (next: T | ((previous: T) => T)) => {
      const settled =
        typeof next === 'function' ? (next as (previous: T) => T)(getPref(key, fallback)) : next;
      setPref(key, settled);
    },
    [key, fallback],
  );
  return [value, change];
}

/** The clock every moment on the screen follows. */
export type Clock = 'local' | 'utc';

export function useClock(): [Clock, (next: Clock) => void] {
  const [value, change] = usePref<Clock>('clock', 'local');
  return [value === 'utc' ? 'utc' : 'local', change];
}

const NO_IDS: string[] = [];

/** The agents the reader pinned on top of the list, in their order. */
export function useFavorites(): [string[], (agentId: string) => void] {
  const [value, change] = usePref<string[]>('favorites', NO_IDS);
  const toggle = useCallback(
    (agentId: string) => {
      change((previous) =>
        previous.includes(agentId)
          ? previous.filter((id) => id !== agentId)
          : [...previous, agentId],
      );
    },
    [change],
  );
  return [value, toggle];
}
