// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The one word the kernel's books say when they change: a handler
// admitted or released, a record appended, a wait armed or fired. The
// idle report (idle.ts) listens; the books themselves import nothing of
// it, so the admission, the journal and the lifetime stay leaves.

const listeners = new Set<() => void>();

/** Says the books changed. */
export function noteIdleChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener's failure is its own.
    }
  }
}

/** Listens for the books' changes; answers what ends the listening. */
export function onIdleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
