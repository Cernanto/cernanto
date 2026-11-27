// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Count, cx } from './ui.js';

/**
 * The head of a part of a page that opens and closes, as the parts of
 * the side panel do: a press shows the part, a second hides it, and
 * neither changes what the part holds. Its mark stands in the page's
 * margin, so the head's word starts where every other head's does.
 */
export function FoldHead({
  word,
  open,
  onToggle,
  count,
  waiting = 0,
  first = false,
  id,
}: {
  word: string;
  open: boolean;
  onToggle: () => void;
  /** How many things the part holds, said where it holds any. */
  count?: number | undefined;
  /** How many things in the part wait for a person. */
  waiting?: number;
  /** The first head of a page stands under no line. */
  first?: boolean;
  /** The name a link leads to the part by. */
  id?: string;
}): ReactNode {
  return (
    <div id={id} className={cx(!first && 'mt-1 border-t pt-1.5')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="-ml-[19px] flex h-7 items-center gap-1.5 text-[11px] font-semibold tracking-wider text-ink-muted uppercase hover:text-ink"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {word}
        {count !== undefined && count > 0 && (
          <span className="figures font-normal tracking-normal">{count}</span>
        )}
        {waiting > 0 && <Count value={waiting} label={`${String(waiting)} waiting for a person`} />}
      </button>
    </div>
  );
}
