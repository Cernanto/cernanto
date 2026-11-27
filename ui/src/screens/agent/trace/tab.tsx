// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../../../api/plane.js';
import { useAgents, useAskAgain, useAskListing } from '../../../api/queries.js';
import { PlaneMark } from '../../../components/plane.js';
import { AgentName, Avatar, Button, cx, Quiet } from '../../../components/ui.js';
import * as gateway from '../../../gateway/sdk.gen.js';
import { callable, dotOf } from '../../../model/agent.js';
import { functionCards } from '../../../model/contract.js';
import { withHeardEnd } from '../../../model/conversation.js';
import { BY_ITSELF, moduleCalled, runsInside, standaloneOf } from '../../../model/fleet.js';
import type { Fleet, FleetAgent } from '../../../model/fleet.js';
import { useAgentConversation } from '../../../state/live.js';
import { useClock, usePref } from '../../../state/prefs.js';
import { useOwnCalls } from '../../../state/sent.js';
import { sha256Hex } from '../../../state/sha256.js';
import { useSettings } from '../settings/config.js';
import { TracesOffLine } from '../settings/traces.js';
import { CallMenu } from './callmenu.js';
import { ConversationView } from './conversation.js';
import { FOOT_BUTTON, FOOT_FRAME, FOOT_SAID, FOOT_WORDS } from './foot.js';
import { SendBox } from './sendbox.js';
import type { Loaded } from './sendbox.js';
import { useSends } from './sends.js';

/** The agents an agent runs in, or is implemented by, each a way in. */
function Others({ ids, fleet }: { ids: string[]; fleet: Fleet }): ReactNode {
  return (
    <ul className="mx-auto mt-4 flex w-full max-w-md flex-col gap-1">
      {ids.map((id) => {
        const other = fleet.byId.get(id);
        return (
          <li key={id}>
            <Link
              to="/agents/$"
              params={{ _splat: id }}
              className="flex h-11 items-center gap-3 rounded-md px-3 text-left hover:bg-hover"
            >
              <Avatar
                agentId={id}
                size={28}
                dot={other === undefined ? undefined : dotOf(other.ls)}
                status={other?.ls.status}
                ground="var(--ground)"
              />
              <AgentName agentId={id} className="flex-1 text-left" />
              <span className="text-xs text-ink-muted">{other?.ls.status ?? ''}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** A worker is run by the plane and not called by hand: in the box's
 * place stands the one thing a reader does with it, drawn as the box
 * draws a call: the same frame, and at its end the same button in the
 * accent, with its word. */
function WorkerFoot({ agentId }: { agentId: string }): ReactNode {
  const askAgain = useAskAgain();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; words: string } | undefined>(undefined);
  return (
    <div className="shrink-0 px-6 pt-1 pb-4">
      <div className={FOOT_FRAME}>
        <div className="flex items-center gap-2">
          <p className={cx(FOOT_WORDS, 'py-1.5')}>
            The plane runs a worker's program; nobody calls it.
          </p>
          <button
            type="button"
            disabled={busy}
            title={`Runs the program of ${agentId} again, from the top`}
            className={cx(FOOT_BUTTON, 'shrink-0 rounded-md')}
            onClick={() => {
              setBusy(true);
              setSaid(undefined);
              void gateway
                .agentStart({ client: plane, path: { agentId } })
                .then((result) => {
                  const answer = unwrap(result, 'the start');
                  setSaid({
                    ok: true,
                    words:
                      answer.run === undefined
                        ? 'Started again.'
                        : `Run ${String(answer.run)} started.`,
                  });
                  askAgain();
                })
                .catch((error: unknown) => {
                  setSaid({ ok: false, words: wordsOf(error) });
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            Run
            <PlaneMark />
          </button>
        </div>
        {said !== undefined && (
          <p
            role={said.ok ? 'status' : 'alert'}
            className={cx(FOOT_SAID, said.ok ? 'text-ink-secondary' : 'text-bad')}
          >
            {said.words}
          </p>
        )}
      </div>
    </div>
  );
}

/** The Trace tab: what the agent did, as a conversation with the agents
 * it talks to, the newest at the foot and followed as it happens, and
 * at its foot the box that calls one of its functions. A module's box
 * names where a call of it runs: by itself, or the agent it runs
 * inside. */
export function TraceTab({
  agent,
  fleet,
  arriveAt,
  loaded,
  onLoad,
  onLoaded,
  onTouched,
  boxUntouched,
  find,
  onFind,
}: {
  agent: FleetAgent;
  fleet: Fleet;
  arriveAt?: string | undefined;
  /** What the reader asked the box to hold: a function they came to
   * call, or a call with what it was asked. */
  loaded?: Loaded | undefined;
  /** Asks the box to hold a call of this conversation, with what it was
   * asked once that is read. */
  onLoad: (handler: string, read: () => Promise<unknown>) => Promise<void>;
  /** Hears that the box took what it was asked to hold. */
  onLoaded: () => void;
  /** Hears that the reader touched the box, by a key or a press inside it. */
  onTouched: () => void;
  /** Marks a moment, and answers later whether the reader left the box
   * alone since: nothing asked of it, no key and no press inside it. */
  boxUntouched: () => () => boolean;
  /** The text searched in the conversation, while its search is open. */
  find?: string | undefined;
  onFind?: (text: string | undefined) => void;
}): ReactNode {
  const [clock] = useClock();
  const utc = clock === 'utc';
  const [ownCalls, addOwn] = useOwnCalls();
  const row = agent.ls;
  // An agent whose traces stand at debug stores its debug lines to be
  // read: the conversation asks for them and shows them, with no switch
  // of its own.
  const debug = row.traces === 'debug';
  const followed = useAgentConversation(agent.id, {
    utc,
    debug,
    copies: `${String(row.copies)}|${row.ready}|${row.status}`,
  });
  // A module's function is called where the module runs: by itself,
  // the first of its places and always one, or inside one of the agents
  // that link it. An interface is called through the implementor the
  // plane binds to it, its setting `default`, as an agent's code is:
  // where that implementor is a module, the call runs where that module
  // runs.
  const shipped = useAgents();
  const isModule = row.type === 'module';
  const isInterface = row.type === 'interface';
  const settings = useSettings(agent.id, isInterface);
  const bound = settings.data?.['default'];
  const runs = moduleCalled(agent, typeof bound === 'string' ? bound : undefined, fleet);
  const runsIn = useMemo(
    () => (runs === undefined ? [] : runsInside(runs, fleet, shipped.data?.generations ?? [])),
    [runs, fleet, shipped.data],
  );
  // Where a call runs is what the box shows: by itself while the reader
  // left the box alone, and from their first key or press in it the
  // place it showed then, or the one they chose. An agent that left the
  // plane is replaced by the reader's choice alone, and what was typed
  // is sent nowhere before it.
  const [pickedIn, setPickedIn] = useState<string | undefined>(undefined);
  const leftIn = pickedIn !== undefined && !runsIn.includes(pickedIn) ? pickedIn : undefined;
  const chosenIn = leftIn === undefined ? (pickedIn ?? runsIn[0]) : undefined;
  // A module's box always has where to send: by itself, which the plane
  // starts at the call when the module is not started.
  const sendable = callable(row.type) || isModule;
  // The functions the box calls are read from the agent's own row, as
  // the fleet was read last: one reading of the plane, so the box
  // follows what the fleet's next read brings, the agent deployed again
  // under another contract among it. What is typed in the box stays
  // with the contract it was typed against and is sent under it, and
  // the plane refuses a contract the agent has no more.
  const contract = agent.row?.contract;
  // The row's list as one text, so that the cards are read again when
  // it changes and not at every read of the fleet.
  const served = agent.row?.handlers.join('\n');
  const cards = useMemo(() => {
    if (contract === undefined || !sendable) return [];
    // A row that lists no function, an interface's, is read by its
    // contract alone.
    return functionCards(
      contract,
      served === undefined || served === '' ? undefined : served.split('\n'),
    );
  }, [contract, served, sendable]);
  const contractSha = useMemo(
    () => (contract === undefined ? undefined : sha256Hex(new TextEncoder().encode(contract))),
    [contract],
  );
  const askFleet = useAskAgain();
  const { send, extras, heard } = useSends(agent.id, {
    utc,
    debug,
    conversation: followed.conversation,
    feed: followed.feed,
    own: addOwn,
    inside: chosenIn,
    // By itself, where the fleet shows no standalone agent of the
    // module, the call is the one that starts it.
    startsAlone:
      runs !== undefined && chosenIn === BY_ITSELF && standaloneOf(runs, fleet) === undefined,
    answeredBy: isInterface && typeof bound === 'string' ? bound : undefined,
    askFleet,
  });

  // A call that began or ended in the conversation is news of the list
  // too: the listing is asked again a moment after it. What the stream
  // tells in its first moments is what the plane already held, and is none.
  const askListing = useAskListing();
  // Each as its records say, with what the reader's own request heard of its end.
  const calls = [...followed.conversation.calls.values()].map((call) =>
    withHeardEnd(call, heard.get(call.callId)),
  );
  const running = calls.filter((call) => call.status === 'running').length;
  const liveSince = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (followed.state === 'live' && liveSince.current === undefined)
      liveSince.current = Date.now();
  }, [followed.state]);
  useEffect(() => {
    if (liveSince.current === undefined || Date.now() - liveSince.current < 2500) return undefined;
    const timer = window.setTimeout(askListing, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [calls.length, running, askListing]);

  // The newcomer's three steps go with the reader, and leave when the first reply was read.
  const [guide, setGuide] = usePref<string | null>('guide', null);
  const replied = calls.some((call) => ownCalls.has(call.callId) && call.status !== 'running');
  const steps =
    guide === agent.id ? (
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-surface px-6 py-2 text-[13px]">
        <span className="text-ink-muted line-through">1 Install an example</span>
        <span className={replied ? 'text-ink-muted line-through' : 'font-semibold text-ink'}>
          2 Send your first call
        </span>
        <span className={replied ? 'font-semibold text-ink' : 'text-ink-muted'}>
          3 Read its reply{replied && ': it stands below your call'}
        </span>
        <span className="flex-1" />
        {replied && (
          <Button
            small
            look="quiet"
            onClick={() => {
              setGuide(null);
            }}
          >
            Done
          </Button>
        )}
      </div>
    ) : undefined;

  const foot =
    row.type === 'worker' ? (
      <WorkerFoot agentId={agent.id} />
    ) : cards.length > 0 ? (
      <SendBox
        agentId={agent.id}
        kind={row.type}
        contractSha={contractSha}
        cards={cards}
        onSend={send}
        inside={
          runs === undefined
            ? undefined
            : {
                agents: runsIn,
                chosen: chosenIn,
                left: leftIn,
                read: shipped.data !== undefined,
                onChoose: setPickedIn,
                ...(runs === agent.id ? {} : { through: runs }),
              }
        }
        loaded={loaded}
        onLoaded={onLoaded}
        onTouched={() => {
          if (pickedIn === undefined && chosenIn !== undefined) setPickedIn(chosenIn);
          onTouched();
        }}
      />
    ) : null;

  // An interface has neither copies nor records of its own: its tab
  // lists the agents that implement it, each a way in.
  if (row.type === 'interface') {
    const implementors = fleet.agents
      .filter((other) => other.row?.implements?.some((entry) => entry.id === agent.id) === true)
      .map((other) => other.id);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Quiet>
            An interface keeps no records of its own.{' '}
            {settings.data === undefined
              ? 'A call made of it is answered by one of the agents that implement it:'
              : typeof bound === 'string'
                ? `A call made of it is answered by ${bound}, the implementor the plane binds to it. The agents that implement it:`
                : 'The plane binds no implementor to it yet, so a call made of it is refused: choose one under Settings. The agents that implement it:'}
            <Others ids={implementors} fleet={fleet} />
          </Quiet>
        </div>
        {extras.length > 0 && (
          <div className="w-full shrink-0 px-6">
            {extras.map((extra) => (
              <div key={extra.key}>{extra.render()}</div>
            ))}
          </div>
        )}
        {foot}
      </div>
    );
  }

  const linkedInto = fleet.agents
    .filter(
      (other) =>
        other.row?.links?.includes(agent.id) === true ||
        other.row?.uses.includes(agent.id) === true,
    )
    .filter((other) => !other.pair)
    .map((other) => other.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConversationView
        open={agent.id}
        followed={followed}
        ownCalls={ownCalls}
        extras={extras}
        heard={heard}
        arriveAt={arriveAt}
        find={find}
        onFind={onFind}
        boxUntouched={boxUntouched}
        debug={debug}
        callActions={(call) => (
          <CallMenu call={call} debug={debug} {...(cards.length > 0 ? { onLoad } : {})} />
        )}
        empty={
          row.traces === 'off' ? (
            <Quiet>
              <TracesOffLine agentId={agent.id} />
            </Quiet>
          ) : row.type === 'module' ? (
            <Quiet>
              A module runs inside the agents that use it, and nothing of it is recorded here yet.
              <Others ids={linkedInto} fleet={fleet} />
            </Quiet>
          ) : (
            <Quiet>
              No call of this agent is recorded.
              {cards.length > 0 && ' Call one of its functions from the box below.'}
            </Quiet>
          )
        }
        head={
          <>
            {steps}
            {followed.state === 'reconnecting' ? (
              <div className="shrink-0 border-b bg-sunken px-6 py-1.5 text-center text-xs text-ink-muted">
                Reconnecting to this conversation
                {followed.error === undefined ? '' : ` (${followed.error})`}…
              </div>
            ) : followed.dropped > 0 ? (
              <div className="shrink-0 border-b px-6 py-1.5 text-center text-xs text-ink-muted">
                The oldest {followed.dropped} messages were let go. Earlier calls are in the Calls
                tab.
              </div>
            ) : null}
          </>
        }
      />
      {foot}
    </div>
  );
}
