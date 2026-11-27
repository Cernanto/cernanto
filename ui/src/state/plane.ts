// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useCallback, useMemo } from 'react';

import { PLANE_ADDRESS } from '../api/plane.js';
import { planeOf } from '../model/plane.js';
import type { Plane, PlaneSaid } from '../model/plane.js';
import { usePref } from './prefs.js';

// What this browser keeps of the plane a screen stands on: the kind
// the reader chose and their own name for it, under the address the
// browser reached the plane at.

const NOTHING_SAID: unknown = null;

/**
 * The plane this screen stands on, with the function that keeps what
 * the reader says of it: a kind, a name, or both. What they leave out
 * stays as it was, and an empty name forgets the name.
 */
export function usePlane(): [Plane, (next: PlaneSaid) => void] {
  const [kept, change] = usePref<unknown>('plane', NOTHING_SAID);
  const plane = useMemo(() => planeOf(kept, PLANE_ADDRESS), [kept]);
  const say = useCallback(
    (next: PlaneSaid) => {
      change((previous: unknown) => {
        const held = planeOf(previous, PLANE_ADDRESS);
        const kind = next.kind ?? (held.chosen ? held.kind : undefined);
        const name = (next.name ?? held.name).trim();
        const said: PlaneSaid = {
          ...(kind === undefined ? {} : { kind }),
          ...(name === '' ? {} : { name }),
        };
        return said;
      });
    },
    [change],
  );
  return [plane, say];
}
