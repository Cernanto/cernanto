// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../../api/plane.js';
import { standingHere } from '../../app/search.js';
import { useAskAgain } from '../../api/queries.js';
import { Button, ErrorLine } from '../../components/ui.js';
import * as gateway from '../../gateway/sdk.gen.js';
import { usePref } from '../../state/prefs.js';

/** The example a newcomer installs first: it answers the next number to whoever calls it. */
const FIRST_EXAMPLE = 'examples/basics/counter';

/** A plane with no agent but the platform's own opens on three steps to
 * a first reply, where an agent's conversation would stand. */
export function FirstSteps(): ReactNode {
  const navigate = useNavigate();
  const askAgain = useAskAgain();
  const [, setGuide] = usePref<string | null>('guide', null);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  return (
    <div className="rounded-lg border bg-surface p-6">
      <h2 className="text-[17px] font-semibold text-ink">This plane holds no agent of yours yet</h2>
      <p className="mt-1 text-[13px] text-ink-secondary">Three steps to a first reply.</p>
      <ol className="mt-4 flex flex-col gap-3 text-[14px]">
        <li className="flex items-start gap-3">
          <span className="figures flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">
            1
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-ink">Install an example</div>
            <p className="text-[13px] text-ink-secondary">
              <span className="mono text-xs">{FIRST_EXAMPLE}</span> answers the next number to
              whoever calls it. It is installed from the registry as it is: nothing is compiled.
            </p>
            <Button
              look="main"
              className="mt-2"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setTrouble(undefined);
                const here = standingHere();
                void gateway
                  .land({ client: plane, body: { target: FIRST_EXAMPLE } })
                  .then((result) => {
                    unwrap(result, 'the install');
                    setGuide(FIRST_EXAMPLE);
                    askAgain();
                    // A reader who went elsewhere while the plane installed it stays there.
                    if (!here()) return;
                    void navigate({
                      to: '/agents/$',
                      params: { _splat: FIRST_EXAMPLE },
                      hash: 'send:next',
                    });
                  })
                  .catch((error: unknown) => {
                    setTrouble(wordsOf(error));
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {busy ? 'Installing…' : 'Install the counter'}
            </Button>
            {trouble !== undefined && <ErrorLine className="mt-2">{trouble}</ErrorLine>}
          </div>
        </li>
        <li className="flex items-start gap-3 text-ink-muted">
          <span className="figures flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs">
            2
          </span>
          <div>Send it your first call, from the box at the foot of its conversation.</div>
        </li>
        <li className="flex items-start gap-3 text-ink-muted">
          <span className="figures flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs">
            3
          </span>
          <div>Read its reply.</div>
        </li>
      </ol>
      <p className="mt-5 border-t pt-4 text-[13px] text-ink-muted">
        From a terminal it is one line:{' '}
        <code className="mono rounded-sm bg-sunken px-1.5 py-0.5 text-xs text-ink-secondary">
          cernanto deploy {FIRST_EXAMPLE}
        </code>
      </p>
    </div>
  );
}
