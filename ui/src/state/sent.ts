// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useCallback, useMemo } from 'react';

import { usePref } from './prefs.js';

// The calls the reader sent from this browser, by their ids alone. The
// plane names the gateway as the caller of a call an operator sent and
// no record names the operator, so a browser knows its own messages by
// the ids it remembers. Nothing of what was asked or answered is kept.

/** How many ids the browser remembers. */
const MOST = 500;
const NONE: string[] = [];

/** The ids of the calls sent from this browser, and the function that adds one. */
export function useOwnCalls(): [ReadonlySet<string>, (callId: string) => void] {
  const [ids, setIds] = usePref<string[]>('sent', NONE);
  const set = useMemo(() => new Set(ids), [ids]);
  const add = useCallback(
    (callId: string) => {
      setIds((previous) =>
        previous.includes(callId) ? previous : [...previous, callId].slice(-MOST),
      );
    },
    [setIds],
  );
  return [set, add];
}
