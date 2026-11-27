// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../../../api/plane.js';
import { readCall, readCallInput, useAgents, useAskAfterCall } from '../../../api/queries.js';
import { partyWord } from '../../../components/party.js';
import { Button, cx, ErrorLine, Menu, MenuItem, MenuLine, Sheet } from '../../../components/ui.js';
import * as gateway from '../../../gateway/sdk.gen.js';
import { linkedFunctionOf, spoken } from '../../../model/agent.js';
import { cliLine } from '../../../model/contract.js';
import { Conversation, callMark, conversationMarkdown } from '../../../model/conversation.js';
import { insideOfLinked, ranInside, useFleet } from '../../../model/fleet.js';
import { exactMoment, timeOfDay } from '../../../model/time.js';
import { useClock } from '../../../state/prefs.js';
import { copyText, saveFile } from '../../../state/save.js';

/** What a call's menu acts on. */
export interface CallTarget {
  callId: string;
  agentId: string;
  handler: string;
  at: string;
  status: 'running' | 'ok' | 'error';
}

/** A file's name for a call: its agent's last part, its function and its mark. */
function fileStem(call: CallTarget): string {
  const agent = call.agentId.split('/').at(-1) ?? 'call';
  return [agent, call.handler, callMark(call.callId)].filter((part) => part !== '').join('-');
}

/**
 * A call's own actions: its id to copy, its cancel while it runs, the
 * call loaded into the send box or copied as the cli's line, and its
 * export. Every one that acts says which call, by its mark and moment.
 */
export function CallMenu({
  call,
  debug,
  onLoad,
  standing = false,
}: {
  call: CallTarget;
  /** Whether the screen the call stands on shows the agent's debug
   * lines: the export reads the call as that screen does. */
  debug: boolean;
  /** Fills the send box with the call's function and what it was asked,
   * once that is read; absent where no box stands. Whether the box
   * still takes it by then is the box's keeper's to say. */
  onLoad?: (handler: string, read: () => Promise<unknown>) => Promise<void>;
  /** Shown always, where the call is the screen's one subject; under the pointer alone in a list. */
  standing?: boolean;
}): ReactNode {
  const [clock] = useClock();
  const askAgain = useAskAfterCall();
  // A module's call ran inside an agent, which the cli's line names:
  // read on the module's own page from the call's id, and on the page
  // of the agent it ran inside from the name the agent answered it
  // under, which is the module's function and no function of its own.
  // A call the module ran by itself names no agent, on either page.
  const fleet = useFleet();
  const shipped = useAgents();
  const linked = linkedFunctionOf(call.handler);
  const line =
    linked === undefined
      ? {
          agentId: call.agentId,
          handler: call.handler,
          inside: ranInside(call, fleet, shipped.data?.generations ?? []),
        }
      : {
          agentId: linked.module,
          handler: linked.fn,
          inside: insideOfLinked(call.agentId, linked.module, fleet),
        };
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);

  /** What the call was asked, read from the plane's own records of it
   * as the list of calls reads them, whichever page says it. */
  const asked = (): Promise<unknown> => readCallInput(call.callId);

  const act = (work: () => Promise<void>): void => {
    setTrouble(undefined);
    void work().catch((error: unknown) => {
      setTrouble(wordsOf(error));
    });
  };

  const exportAs = (form: 'markdown' | 'json'): void => {
    act(async () => {
      const answer = await readCall(call.callId, { utc: clock === 'utc', debug });
      if (form === 'json') {
        saveFile(
          `${fileStem(call)}.json`,
          `${JSON.stringify({ call: answer.call, records: answer.records, children: answer.children }, null, 2)}\n`,
          'application/json',
        );
        return;
      }
      const conversation = new Conversation();
      answer.records.forEach((record, index) =>
        conversation.add(record, answer.lines[index] ?? []),
      );
      const title = `${spoken(call.handler)} · ${call.agentId} · ${exactMoment(call.at, clock)}`;
      saveFile(
        `${fileStem(call)}.md`,
        conversationMarkdown(
          title,
          conversation,
          (at) => timeOfDay(at, clock, true),
          (id) => partyWord(id),
        ),
        'text/markdown',
      );
    });
  };

  const mark = callMark(call.callId);
  const which = mark === '' ? spoken(call.handler) : `${spoken(call.handler)} · ${mark}`;

  return (
    <>
      <Menu
        trigger={
          <button
            type="button"
            aria-label={`Actions of the call ${which}`}
            className={cx(
              'flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink',
              !standing &&
                'opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
            )}
          >
            <Ellipsis size={14} />
          </button>
        }
      >
        <MenuItem
          onSelect={() => {
            void copyText(call.callId);
          }}
          hint={<span className="mono text-[11px]">{mark}</span>}
        >
          Copy the call's ID
        </MenuItem>
        {call.status === 'running' && (
          <MenuItem
            danger
            onSelect={() => {
              setCancelling(true);
            }}
          >
            Cancel {which}
          </MenuItem>
        )}
        <MenuLine />
        {onLoad !== undefined && (
          <MenuItem
            hint="Fills the box and sends nothing"
            onSelect={() => {
              act(() => onLoad(call.handler, asked));
            }}
          >
            Load in send box
          </MenuItem>
        )}
        <MenuItem
          hint="The same call as the cli's line"
          onSelect={() => {
            act(async () => {
              await copyText(cliLine(line.agentId, line.handler, await asked(), line.inside));
            });
          }}
        >
          Copy as cernanto call
        </MenuItem>
        <MenuLine />
        <MenuItem
          hint="The conversation, as Markdown"
          onSelect={() => {
            exportAs('markdown');
          }}
        >
          Export call as it reads
        </MenuItem>
        <MenuItem
          hint="Its records, as JSON"
          onSelect={() => {
            exportAs('json');
          }}
        >
          Export call as it is kept
        </MenuItem>
      </Menu>
      {trouble !== undefined && (
        <Sheet
          open
          onOpenChange={() => {
            setTrouble(undefined);
          }}
          title="That did not work"
          width={420}
        >
          <ErrorLine>{trouble}</ErrorLine>
        </Sheet>
      )}
      <Sheet
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${which}?`}
        description={`The call of ${call.agentId} that began at ${exactMoment(call.at, clock)}. The copy that holds it is asked to end it.`}
        width={440}
      >
        <div className="flex justify-end gap-2">
          <Button
            look="quiet"
            onClick={() => {
              setCancelling(false);
            }}
          >
            Keep it running
          </Button>
          <Button
            look="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              act(async () => {
                try {
                  unwrap(
                    await gateway.cancel({ client: plane, path: { callId: call.callId } }),
                    'the cancel',
                  );
                  setCancelling(false);
                  askAgain();
                } finally {
                  setBusy(false);
                }
              });
            }}
          >
            Cancel the call
          </Button>
        </div>
      </Sheet>
    </>
  );
}
