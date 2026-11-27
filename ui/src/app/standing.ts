// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useCallback, useEffect, useRef } from 'react';

import { standingHere } from './search.js';

/**
 * Marks where the reader stood when they asked for something, for the
 * answer that comes a while later: the address, and the part of the
 * screen they pressed in. The mark says whether they still stand there:
 * at the same address, before the same part, and, where the part is a
 * sheet, with the sheet open as it was. A sheet that was closed is one
 * the reader left: what they pressed in it still takes its course on
 * the plane, and its answer takes them nowhere, and writes nothing into
 * a sheet opened after it.
 *
 * @param open - Whether the sheet the part stands in is open; left out for a part that is no sheet.
 */
export function useStanding(open = true): () => () => boolean {
  const mounted = useRef(false);
  const opening = useRef(0);
  const was = useRef(open);
  if (was.current !== open) {
    was.current = open;
    opening.current += 1;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => {
    const here = standingHere();
    const asked = opening.current;
    return () => mounted.current && opening.current === asked && here();
  }, []);
}
