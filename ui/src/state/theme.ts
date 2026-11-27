// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useSyncExternalStore } from 'react';

// The look follows the system unless the reader chose the other one.
// The choice is kept under `theme`, as the site keeps it, and dropped
// again when it equals the system's.

export type Look = 'light' | 'dark';

const listeners = new Set<() => void>();
const media: MediaQueryList | undefined =
  typeof window === 'undefined' ? undefined : window.matchMedia('(prefers-color-scheme: dark)');

function system(): Look {
  return media?.matches === true ? 'dark' : 'light';
}

function current(): Look {
  const chosen = document.documentElement.dataset['theme'];
  return chosen === 'dark' || chosen === 'light' ? chosen : system();
}

function tell(): void {
  for (const listener of listeners) listener();
}

media?.addEventListener('change', tell);

/** Sets the look; one that equals the system's is no choice. */
export function setLook(next: Look): void {
  const root = document.documentElement;
  if (next === system()) delete root.dataset['theme'];
  else root.dataset['theme'] = next;
  try {
    if (next === system()) window.localStorage.removeItem('theme');
    else window.localStorage.setItem('theme', next);
  } catch {
    // The browser keeps no storage for this page: the choice lasts the tab.
  }
  tell();
}

/** The look that stands, and the function that turns to the other one. */
export function useLook(): [Look, () => void] {
  const look = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, current);
  return [
    look,
    () => {
      setLook(look === 'dark' ? 'light' : 'dark');
    },
  ];
}
