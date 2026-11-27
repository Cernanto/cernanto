// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Outlet, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useFleet } from '../../model/fleet.js';
import { usePref } from '../../state/prefs.js';
import { AgentList } from './list.js';

/** The list's width, and how far it is pulled. */
const WIDTH = { at: 320, least: 260, most: 420 };

/** Agents: the list on the left, and beside it the agent that is open.
 * Where the address names none, the one open last is opened, and a
 * plane with none of the reader's shows a newcomer's first steps. On a
 * narrow window the two become one at a time, the list and then the
 * agent, with back between them. */
export function AgentsLayout(): ReactNode {
  const fleet = useFleet();
  const params = useParams({ strict: false });
  const chosen =
    typeof params._splat === 'string' && params._splat !== '' ? params._splat : undefined;
  const [width, setWidth] = usePref<number>('list.width', WIDTH.at);
  const [, setLast] = usePref<string | null>('list.last', null);
  const dragging = useRef(false);

  useEffect(() => {
    if (chosen !== undefined) setLast(chosen);
  }, [chosen, setLast]);

  const onMove = useCallback(
    (event: PointerEvent) => {
      if (!dragging.current) return;
      // The rail stands at the list's left, 56 wide.
      setWidth(Math.min(WIDTH.most, Math.max(WIDTH.least, event.clientX - 56)));
    },
    [setWidth],
  );
  useEffect(() => {
    const stop = (): void => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [onMove]);

  const clamped = Math.min(WIDTH.most, Math.max(WIDTH.least, width));
  return (
    <div className="flex h-full min-w-0 flex-1">
      <aside
        aria-label="The agents"
        style={{ '--list-width': `${String(clamped)}px` } as React.CSSProperties}
        className={
          chosen === undefined
            ? 'relative w-full shrink-0 border-r md:w-[var(--list-width)]'
            : 'relative hidden w-[var(--list-width)] shrink-0 border-r md:block'
        }
      >
        <AgentList fleet={fleet} chosen={chosen} />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Pull to change the list's width"
          className="absolute top-0 right-[-3px] z-10 hidden h-full w-[6px] cursor-col-resize hover:bg-line-strong md:block"
          onPointerDown={() => {
            dragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          onDoubleClick={() => {
            setWidth(WIDTH.at);
          }}
        />
      </aside>
      <section
        className={chosen === undefined ? 'hidden min-w-0 flex-1 md:flex' : 'flex min-w-0 flex-1'}
      >
        <Outlet />
      </section>
    </div>
  );
}
