// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// THE BYTES OF A FILE THAT WAITS FOR A DEPLOY. A file chosen in the
// browser for a source goes to the plane with the next deploy and not
// before: the plane takes files with a deploy and keeps no loose one.
// Until then the browser keeps it, in its own database and not among
// its small settings, which take a few megabytes in all. A draft holds
// what it knows of each file, its name and its weight and the key its
// bytes are kept under; the bytes are here.
//
// Like a draft, a file kept here is this browser's alone. Where the
// browser keeps nothing for the page, the bytes last as long as the
// window, and whoever holds them is told so.

const NAME = 'cernanto.files';
const STORE = 'waiting';

/** What is kept of a file: its bytes, its kind, and when it was chosen. */
interface Kept {
  bytes: ArrayBuffer;
  type: string;
  at: number;
}

/** The files this window holds that the browser did not keep. */
const held = new Map<string, Blob>();

let opening: Promise<IDBDatabase | undefined> | undefined;

/** The browser's database of waiting files, or none where it offers this page no database. */
function database(): Promise<IDBDatabase | undefined> {
  opening ??= new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        resolve(undefined);
      };
      request.onblocked = () => {
        resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
  return opening;
}

/** One act on the store, answered when the browser has done it. */
function act<Answer>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  ask: (store: IDBObjectStore) => IDBRequest<Answer>,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = ask(transaction.objectStore(STORE));
    transaction.oncomplete = () => {
      resolve(request.result);
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('the browser refused the write'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('the browser refused the write'));
    };
  });
}

/** A key no file is kept under yet. */
export function drawFileKey(): string {
  const random = new Uint8Array(12);
  window.crypto.getRandomValues(random);
  return `f${[...random].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Keeps a file's bytes under a key. Answers whether the browser kept
 * them: where it did not, its database full or closed to this page,
 * this window holds them for as long as it stays open.
 */
export async function keepBytes(key: string, file: Blob): Promise<boolean> {
  const db = await database();
  if (db !== undefined) {
    try {
      const kept: Kept = { bytes: await file.arrayBuffer(), type: file.type, at: Date.now() };
      await act(db, 'readwrite', (store) => store.put(kept, key));
      held.delete(key);
      return true;
    } catch {
      // The browser did not take it: the window holds it, below.
    }
  }
  held.set(key, file);
  return false;
}

/** The bytes kept under a key, or none where neither the browser nor this window holds them. */
export async function readBytes(key: string): Promise<Blob | undefined> {
  const mine = held.get(key);
  if (mine !== undefined) return mine;
  const db = await database();
  if (db === undefined) return undefined;
  try {
    const kept = (await act(db, 'readonly', (store) => store.get(key))) as Kept | undefined;
    return kept === undefined ? undefined : new Blob([kept.bytes], { type: kept.type });
  } catch {
    return undefined;
  }
}

/** Lets go of the bytes kept under some keys. */
export async function dropBytes(keys: readonly string[]): Promise<void> {
  for (const key of keys) held.delete(key);
  if (keys.length === 0) return;
  const db = await database();
  if (db === undefined) return;
  try {
    await Promise.all(keys.map((key) => act(db, 'readwrite', (store) => store.delete(key))));
  } catch {
    // What the browser would not remove stays until it is swept.
  }
}

/** How long a file no draft names is left alone: a draft written in
 * another window names its file a moment after the file is kept. */
const LEFT_ALONE_MS = 10 * 60 * 1000;

/**
 * Lets go of every file no draft names any more: a draft discarded in a
 * window that closed, or kept by a browser whose settings were cleared.
 *
 * @param named - The keys the drafts of this browser name.
 */
export async function sweepBytes(named: ReadonlySet<string>): Promise<void> {
  const db = await database();
  if (db === undefined) return;
  try {
    const keys = (await act(db, 'readonly', (store) => store.getAllKeys())) as string[];
    const old: string[] = [];
    for (const key of keys) {
      if (named.has(key)) continue;
      const kept = (await act(db, 'readonly', (store) => store.get(key))) as Kept | undefined;
      if (kept !== undefined && Date.now() - kept.at > LEFT_ALONE_MS) old.push(key);
    }
    await dropBytes(old);
  } catch {
    // A sweep that could not be made is made at the next opening.
  }
}

/** The bytes of a file as the text a deploy carries them in. */
export async function base64Of(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // A long text is put together in pieces: one call takes only so many characters.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return window.btoa(binary);
}
