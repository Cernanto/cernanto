// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { wordsOf } from '../../api/plane.js';
import { Quiet } from '../../components/ui.js';
import { agentToOpen, useFleet } from '../../model/fleet.js';
import { BESIDE } from '../../model/layout.js';
import { useDrafts } from '../../state/drafts.js';
import { useMedia } from '../../state/media.js';
import { usePref } from '../../state/prefs.js';
import { FirstSteps } from './first-steps.js';

const route = getRouteApi('/agents/');

/**
 * The Agents screen where the address names no agent. Beside the list
 * it never stands empty: it opens the agent the reader had open last,
 * as a chat opens on its last conversation, or else the first of their
 * own; and a plane that holds none of theirs shows the three steps to a
 * first reply. On a narrow window the list is the screen, so nothing is
 * opened for the reader. An address of the table of agents made while
 * the table stood here still leads to it, on the Overview.
 */
export function NoAgent(): ReactNode {
  const fleet = useFleet();
  const search = route.useSearch();
  const navigate = useNavigate();
  const beside = useMedia(BESIDE);
  const { drafts } = useDrafts();
  const [last] = usePref<string | null>('list.last', null);
  // The table's own words in an address: its view, its order, a state it is narrowed to.
  const table =
    search.view !== undefined || search.sort !== undefined || search.status !== undefined;
  // The one open last is opened as soon as the plane's agents are read. Without one, the
  // choice is by the agents' newest calls, and waits until each was read: it is made once.
  const kept =
    last !== null && (drafts[last] !== undefined || fleet.byId.has(last)) ? last : undefined;
  const asking = fleet.loading || (kept === undefined && !fleet.callsRead);
  const open = asking ? undefined : (kept ?? agentToOpen(fleet, null));

  useEffect(() => {
    if (table) {
      void navigate({ to: '/overview', search, replace: true });
    } else if (beside && open !== undefined) {
      void navigate({ to: '/agents/$', params: { _splat: open }, search, replace: true });
    }
  }, [table, beside, open, search, navigate]);

  if (fleet.error !== null && fleet.error !== undefined) {
    return (
      <Quiet>
        The plane does not answer.
        <span className="mt-1 block text-xs">{wordsOf(fleet.error)}</span>
      </Quiet>
    );
  }
  if (table || asking) return <Quiet>Asking the plane…</Quiet>;
  // An agent is being opened; for the moment before it stands, nothing does.
  if (open !== undefined) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 py-10">
        <FirstSteps />
      </div>
    </div>
  );
}
