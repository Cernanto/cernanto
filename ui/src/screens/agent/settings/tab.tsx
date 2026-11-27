// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { wordsOf } from '../../../api/plane.js';
import { useAuth } from '../../../api/queries.js';
import { FoldHead } from '../../../components/fold-head.js';
import type { Fleet, FleetAgent } from '../../../model/fleet.js';
import { usePref } from '../../../state/prefs.js';
import { Accounts } from './auth.js';
import { ConfigPart, useSettings } from './config.js';
import { TracesPart } from './traces.js';

// SETTINGS: what a person sets for one agent, in parts named as the
// cli's verbs name them. CONFIG holds what is set for the agent and for
// its tests, each name with its value, AUTH its accounts and the
// logins that wait, and TRACES what its traces stand at. They are a tab
// and no part of the side panel because each needs the width: a value
// may be a folder, a bucket or an address, read whole and typed whole,
// and an agent may keep an account for each of ten mailboxes. Each part
// folds under its head, so a long one never stands between the reader
// and the others.

const PARTS = ['config', 'auth', 'traces'] as const;
type PartName = (typeof PARTS)[number];

/** Which parts are folded, as the reader left them. */
type Folds = Partial<Record<PartName, boolean>>;
const NO_FOLDS: Folds = {};

/** The name a link leads to a part by. */
const partId = (part: PartName): string => `settings-${part}`;

/** An agent's Settings tab: its Config, its Auth and its Traces. */
export function SettingsTab({ agent, fleet }: { agent: FleetAgent; fleet: Fleet }): ReactNode {
  const navigate = useNavigate();
  const [folds, setFolds] = usePref<Folds>('agent.settings.folds', NO_FOLDS);
  const contract = agent.ls.type === 'interface';
  // An interface runs no code and keeps no traces, and a compile's own
  // pair is always traced in debug: neither has a choice to make.
  const traced = agent.ls.traces !== undefined && !agent.pair;
  const own = useSettings(agent.id);
  const tests = useSettings(`${agent.id}/tests`, !contract);
  const auth = useAuth();
  const accounts = (auth.data?.accounts ?? []).filter((account) => account.agent === agent.id);
  const implementors = fleet.agents
    .filter((other) => other.row?.implements?.some((entry) => entry.id === agent.id) === true)
    .map((other) => other.id);
  // How many things are set, once both places were read.
  const set =
    own.data === undefined || (!contract && tests.data === undefined)
      ? undefined
      : Object.keys(own.data).length + Object.keys(tests.data ?? {}).length;
  const read = set !== undefined;

  // A link that leads to one part opens it and brings it into sight. The
  // mark is said once and leaves the address, so the reader folds the
  // part and moves the page as they like after it; the part is brought
  // into sight again once what stands above it was read and has its
  // height.
  const mark = useRouterState({ select: (state) => state.location.hash });
  const led = PARTS.find((part) => part === mark);
  const [goal, setGoal] = useState<PartName | undefined>(undefined);
  useEffect(() => {
    if (led === undefined) return;
    setGoal(led);
    setFolds((previous) => ({ ...previous, [led]: false }));
    void navigate({ to: '.', search: (previous) => previous, replace: true });
  }, [led, navigate, setFolds]);
  useEffect(() => {
    if (goal === undefined) return;
    document.getElementById(partId(goal))?.scrollIntoView({ block: 'start' });
    if (read) setGoal(undefined);
  }, [goal, read]);

  const toggle = (part: PartName): void => {
    setFolds({ ...folds, [part]: folds[part] !== true });
  };
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="flex w-full flex-col gap-3 px-6 pt-4 pb-6">
        <FoldHead
          first
          id={partId('config')}
          word="Config"
          count={set}
          open={folds.config !== true}
          onToggle={() => {
            toggle('config');
          }}
        />
        {folds.config !== true && (
          <ConfigPart agentId={agent.id} contract={contract} implementors={implementors} />
        )}
        <FoldHead
          id={partId('auth')}
          word="Auth"
          count={accounts.length}
          waiting={agent.asks.length}
          open={folds.auth !== true}
          onToggle={() => {
            toggle('auth');
          }}
        />
        {folds.auth !== true && (
          <Accounts
            agentId={agent.id}
            accounts={accounts}
            asks={agent.asks}
            trouble={auth.isError ? wordsOf(auth.error) : undefined}
          />
        )}
        {traced && (
          <>
            <FoldHead
              id={partId('traces')}
              word="Traces"
              open={folds.traces !== true}
              onToggle={() => {
                toggle('traces');
              }}
            />
            {folds.traces !== true && <TracesPart agent={agent} />}
          </>
        )}
      </div>
    </div>
  );
}
