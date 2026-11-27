// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../../../api/plane.js';
import { keys } from '../../../api/queries.js';
import { AskCard } from '../../../components/ask.js';
import { Button, cx, ErrorLine, Moment } from '../../../components/ui.js';
import * as gateway from '../../../gateway/sdk.gen.js';
import type { AgentAccount, AgentAsk } from '../../../gateway/types.gen.js';
import { factMoment } from '../../../model/time.js';
import { useClock } from '../../../state/prefs.js';
import {
  ACCOUNT_LINE,
  ACTS,
  CELL,
  HEAD,
  NARROW_ONLY,
  TABLE,
  TABLE_BODY,
  TABLE_HEAD,
} from './cells.js';

// AUTH: the accounts an agent is logged in to and what it waits for a
// person to give, the cli's `cernanto auth` for this agent. An agent
// keeps its own accounts alone, and may keep many: a line each, with
// its provider, its kind and when it was logged in, never a value.

/** What is stored of an account: its kind, and the names of its fields. */
function kindWords(account: AgentAccount): string {
  return account.fieldNames.length === 0
    ? account.kind
    : `${account.kind} · ${account.fieldNames.join(', ')}`;
}

/**
 * The agent's part of the plane's accounts: what waits for a person
 * first, each ready to be answered where it stands, and under it the
 * accounts as a table. A login that waits is answered here and nowhere
 * else on the screen.
 */
export function Accounts({
  agentId,
  accounts,
  asks,
  trouble: unread,
}: {
  agentId: string;
  accounts: AgentAccount[];
  asks: AgentAsk[];
  /** Why the accounts could not be read, in words. */
  trouble: string | undefined;
}): ReactNode {
  const client = useQueryClient();
  const [clock] = useClock();
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const forget = (name: string): void => {
    setTrouble(undefined);
    setBusy(name);
    void gateway
      .authLogout({ client: plane, query: { agent: agentId, name } })
      .then((result) => {
        unwrap(result, 'the account');
        return client.invalidateQueries({ queryKey: keys.auth });
      })
      .catch((error: unknown) => {
        setTrouble(wordsOf(error));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };
  return (
    <div className="flex flex-col gap-3">
      {asks.length > 0 && (
        // One under the other, each as wide as the tab, as the table of
        // the accounts under them is: a field then holds a provider's
        // long id whole.
        <div className="flex flex-col gap-2.5">
          {asks.map((ask) => (
            <AskCard key={ask.id} ask={ask} />
          ))}
        </div>
      )}
      {unread !== undefined && <ErrorLine>{unread}</ErrorLine>}
      {accounts.length === 0 ? (
        unread === undefined && (
          <p className="text-[13px] text-ink-muted">This agent is logged in to no account.</p>
        )
      ) : (
        // The table goes by the width this part is given, whatever the
        // window's; a name too long even for that moves it sideways.
        <div className="measured overflow-x-auto">
          <table className={TABLE}>
            <thead className={TABLE_HEAD}>
              <tr>
                <th className={HEAD}>Account</th>
                <th className={HEAD}>Provider</th>
                <th className={HEAD}>Kind</th>
                <th className={HEAD}>Logged in</th>
                <th className={HEAD} />
              </tr>
            </thead>
            <tbody className={TABLE_BODY}>
              {accounts.map((account) => (
                <tr key={account.name} className={ACCOUNT_LINE}>
                  <td
                    className={cx(
                      CELL,
                      'mono whitespace-nowrap text-ink @max-4xl:block @max-4xl:break-all @max-4xl:whitespace-normal',
                    )}
                  >
                    {account.name}
                  </td>
                  <td
                    className={cx(
                      CELL,
                      'whitespace-nowrap text-ink-secondary @max-4xl:inline @max-4xl:text-xs @max-4xl:whitespace-normal',
                    )}
                  >
                    {account.provider}
                  </td>
                  <td className={cx(CELL, 'text-ink-secondary @max-4xl:inline @max-4xl:text-xs')}>
                    <span aria-hidden="true" className={NARROW_ONLY}>
                      {' · '}
                    </span>
                    {kindWords(account)}
                  </td>
                  <td className={cx(CELL, 'text-ink-secondary @max-4xl:block @max-4xl:text-xs')}>
                    {account.loggedInAt !== undefined && (
                      <>
                        <span className={NARROW_ONLY}>Logged in </span>
                        <Moment at={account.loggedInAt}>
                          {factMoment(account.loggedInAt, clock)}
                        </Moment>
                      </>
                    )}
                    {account.loggedInBy !== undefined && ` by ${account.loggedInBy}`}
                  </td>
                  <td className={cx(ACTS, 'text-right')}>
                    <Button
                      small
                      look="quiet"
                      title="The next call that needs it asks again"
                      disabled={busy === account.name}
                      onClick={() => {
                        forget(account.name);
                      }}
                    >
                      Forget
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {trouble !== undefined && <ErrorLine>{trouble}</ErrorLine>}
    </div>
  );
}
