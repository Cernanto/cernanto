// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** How far past the window's edges a thing counts as in sight, so what
 * is about to be scrolled to is read before it is reached. */
const AHEAD = '240px';

/**
 * Whether a thing on the screen has come into sight, or near it, once.
 * A list of many lines reads what a line costs to read only for the
 * lines a reader reaches, and keeps what it read.
 */
export function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (seen || element === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: AHEAD },
    );
    watch.observe(element);
    return () => {
      watch.disconnect();
    };
  }, [seen]);
  return [ref, seen];
}
