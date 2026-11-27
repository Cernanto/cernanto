// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { PLANE_ADDRESS, PLANE_ORIGIN, plane, unwrap, wordsOf } from '../api/plane.js';
import { useStanding } from '../app/standing.js';
import {
  keys,
  readPackageFile,
  useAgents,
  useAuth,
  useHarness,
  useTokens,
} from '../api/queries.js';
import { AssistantWord } from '../components/assistant.js';
import { PlaneKinds, PlaneNameField, WhatAKindDecides } from '../components/plane.js';
import {
  AgentName,
  Avatar,
  Button,
  cx,
  ErrorLine,
  Field,
  Moment,
  Sheet,
  Tag,
} from '../components/ui.js';
import * as gateway from '../gateway/sdk.gen.js';
import { useFleet } from '../model/fleet.js';
import { packageOf, SOURCE } from '../model/package.js';
import { isPlayground, ownMachine, planeLabel, planeWhere } from '../model/plane.js';
import { factMoment, tableMoment } from '../model/time.js';
import { usePlane } from '../state/plane.js';
import { useClock, usePref } from '../state/prefs.js';
import { saveFile } from '../state/save.js';
import { useLook } from '../state/theme.js';
import { writeTar } from '../state/tar.js';
import { CopyButton } from './agent/trace/body.js';

// The two parts that gather what every agent holds go by the names the
// cli's verbs and an agent's Settings tab give those things, Config and
// Auth; what each lists is still a setting and an account.
const PARTS = [
  ['plane', 'This plane'],
  ['you', 'You'],
  ['assistant', 'Coding assistant'],
  ['tokens', 'Operator tokens'],
  ['settings', 'All config'],
  ['accounts', 'All auth'],
  ['export', 'Export'],
  ['planes', 'Other planes'],
  ['about', 'About'],
] as const;
type PartName = (typeof PARTS)[number][0];

/** A part's heading and its words. */
function Part({
  title,
  words,
  children,
}: {
  title: string;
  words?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="max-w-[720px]">
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      {words !== undefined && <p className="mt-1 text-[13px] text-ink-muted">{words}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A named line of a part; a tall one holds more than a line and keeps
 * its name at its top. */
function Line({
  name,
  tall = false,
  children,
}: {
  name: string;
  tall?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      className={cx(
        'flex min-h-10 flex-wrap gap-x-4 gap-y-1 border-b py-2 text-[13px] last:border-b-0',
        tall ? 'items-start' : 'items-center',
      )}
    >
      <span className={cx('w-40 shrink-0 text-ink-muted', tall && 'pt-1.5')}>{name}</span>
      <div className="min-w-0 flex-1 text-ink">{children}</div>
    </div>
  );
}

/** Which plane this is: its address, the kind the reader chose for it
 * and their own name for it, and the fleet's own judgments. */
function ThisPlane(): ReactNode {
  const [standing] = usePlane();
  const shipped = useAgents();
  return (
    <Part
      title="This plane"
      words="Its kind and its name stand at the top of every screen, so a call or a delete is never made on the wrong plane. They are kept in this browser, under this address."
    >
      <Line name="Address">
        <span className="mono text-xs">{PLANE_ADDRESS}</span>
      </Line>
      <Line name="Kind" tall>
        <div className="flex flex-col gap-3 py-1">
          <PlaneKinds />
          {!standing.chosen && (
            <p className="text-xs text-ink-secondary">
              {ownMachine(PLANE_ADDRESS)
                ? "It was reached at this machine's own address, so it starts as LOCAL."
                : 'It was reached at another address, so it is handled as PRODUCTION until you choose.'}
            </p>
          )}
          <WhatAKindDecides />
        </div>
      </Line>
      <Line name="Name" tall>
        <div className="flex flex-col gap-1.5 py-1">
          <PlaneNameField className="max-w-72" />
          <span className="text-xs text-ink-muted">
            Optional. A word of your own, shown at the top in place of the address.
          </span>
        </div>
      </Line>
      <h3 className="mt-8 mb-1 text-[13px] font-semibold text-ink">The plane's health</h3>
      {shipped.isError && <ErrorLine>{wordsOf(shipped.error)}</ErrorLine>}
      {(shipped.data?.conditions ?? []).map((condition) => (
        <Line key={condition.type} name={condition.type.replace(/([a-z])([A-Z])/g, '$1 $2')}>
          <span
            className={cx(
              condition.status === 'True' ? 'text-ink-secondary' : 'font-semibold text-bad',
            )}
          >
            {condition.message}
          </span>
        </Line>
      ))}
    </Part>
  );
}

/** Who the reader is, and what this browser keeps for them. */
function You(): ReactNode {
  const [clock, setClock] = useClock();
  const [look, turnLook] = useLook();
  return (
    <Part
      title="You"
      words="On the machine itself the plane asks for no token: you are its operator."
    >
      <Line name="Signed in as">
        The operator of this machine, <span className="mono text-xs">local</span>
      </Line>
      <Line name="Clock">
        <span className="flex gap-1.5">
          {(['local', 'utc'] as const).map((option) => (
            <Button
              key={option}
              small
              look={clock === option ? 'plain' : 'quiet'}
              aria-pressed={clock === option}
              className={clock === option ? 'border-ink' : ''}
              onClick={() => {
                setClock(option);
              }}
            >
              {option === 'local' ? 'Local time' : 'UTC'}
            </Button>
          ))}
        </span>
      </Line>
      <Line name="Look">
        <Button small onClick={turnLook}>
          {look === 'dark' ? 'Dark, turn to light' : 'Light, turn to dark'}
        </Button>
      </Line>
    </Part>
  );
}

/** The coding assistant that compiles on this plane, and how it is credentialed. */
function Assistant(): ReactNode {
  const client = useQueryClient();
  const harness = useHarness();
  const [vendor, setVendor] = useState<'claude-code' | 'codex' | undefined>(undefined);
  const [mode, setMode] = useState<'plan' | 'api-key' | 'bedrock' | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const current = harness.data;
  const chosenVendor = vendor ?? (current?.vendor === 'codex' ? 'codex' : 'claude-code');
  const chosenMode =
    mode ?? (current?.mode === 'api-key' || current?.mode === 'bedrock' ? current.mode : 'plan');
  const changed =
    current === null ||
    current === undefined ||
    chosenVendor !== current.vendor ||
    chosenMode !== current.mode;
  return (
    <Part
      title="Coding assistant"
      words="The coding assistant writes an agent's code and tests from its source at every compile."
    >
      {harness.isError && <ErrorLine>{wordsOf(harness.error)}</ErrorLine>}
      <Line name="Compiles with">
        {current === undefined ? (
          '…'
        ) : current === null ? (
          'None is connected'
        ) : (
          <>
            <AssistantWord harness={current.vendor} />
            {` · ${current.mode} · ${current.source}`}
          </>
        )}
      </Line>
      <Line name="Assistant">
        <span className="flex gap-1.5">
          {(['claude-code', 'codex'] as const).map((option) => (
            <Button
              key={option}
              small
              look={chosenVendor === option ? 'plain' : 'quiet'}
              aria-pressed={chosenVendor === option}
              className={chosenVendor === option ? 'border-ink' : ''}
              onClick={() => {
                setVendor(option);
              }}
            >
              <AssistantWord harness={option} />
            </Button>
          ))}
        </span>
      </Line>
      <Line name="Credentialed by">
        <span className="flex flex-wrap gap-1.5">
          {(
            [
              ['plan', "The machine's own login"],
              ['api-key', 'An API key'],
              ['bedrock', 'Bedrock'],
            ] as const
          ).map(([option, word]) => (
            <Button
              key={option}
              small
              look={chosenMode === option ? 'plain' : 'quiet'}
              aria-pressed={chosenMode === option}
              className={chosenMode === option ? 'border-ink' : ''}
              onClick={() => {
                setMode(option);
              }}
            >
              {word}
            </Button>
          ))}
        </span>
      </Line>
      <div className="mt-3 flex items-center gap-3">
        <Button
          look="main"
          disabled={!changed || busy}
          onClick={() => {
            setBusy(true);
            setTrouble(undefined);
            void gateway
              .harnessSet({ client: plane, body: { vendor: chosenVendor, mode: chosenMode } })
              .then((result) => {
                unwrap(result, 'the coding assistant');
                setVendor(undefined);
                setMode(undefined);
                return client.invalidateQueries({ queryKey: keys.harness });
              })
              .catch((error: unknown) => {
                setTrouble(wordsOf(error));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          Use it
        </Button>
        {trouble !== undefined && <ErrorLine>{trouble}</ErrorLine>}
      </div>
    </Part>
  );
}

/** The operators' tokens: each one's name and when it was made, a
 * button to revoke it, and a new one, shown once. */
function Tokens(): ReactNode {
  const client = useQueryClient();
  const tokens = useTokens();
  const [clock] = useClock();
  const [standing] = usePlane();
  const careful = !isPlayground(standing);
  const [name, setName] = useState('');
  const [minted, setMinted] = useState<{ name: string; token: string } | undefined>(undefined);
  const [revoking, setRevoking] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const refresh = (): Promise<void> => client.invalidateQueries({ queryKey: keys.tokens });
  const pressedAt = useStanding(revoking !== undefined);
  return (
    <Part
      title="Operator tokens"
      words="From another machine every request carries an operator's token. Mint one for each person and each browser, under a name of its own, so it can be revoked alone."
    >
      {tokens.isError && <ErrorLine>{wordsOf(tokens.error)}</ErrorLine>}
      {tokens.data !== undefined && tokens.data.length === 0 && (
        <p className="text-[13px] text-ink-muted">No token was minted on this plane.</p>
      )}
      {(tokens.data ?? []).map((token) => (
        <div
          key={token.name}
          className="flex min-h-10 items-center gap-3 border-b py-2 text-[13px]"
        >
          <span className="mono min-w-0 flex-1 truncate text-ink">{token.name}</span>
          <span className="text-xs text-ink-muted">
            made <Moment at={token.createdAt}>{factMoment(token.createdAt, clock)}</Moment>
          </span>
          {token.revokedAt !== undefined ? (
            <span className="text-xs text-ink-muted">
              revoked <Moment at={token.revokedAt}>{factMoment(token.revokedAt, clock)}</Moment>
            </span>
          ) : (
            <Button
              small
              look="quiet"
              onClick={() => {
                setRevoking(token.name);
                setTyped('');
                setTrouble(undefined);
              }}
            >
              Revoke
            </Button>
          )}
        </div>
      ))}
      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setTrouble(undefined);
          void gateway
            .tokenCreate({ client: plane, body: { name: name.trim() } })
            .then((result) => {
              const made = unwrap(result, 'the token');
              setMinted({ name: made.name, token: made.token });
              setName('');
              return refresh();
            })
            .catch((error: unknown) => {
              setTrouble(wordsOf(error));
            });
        }}
      >
        <Field
          value={name}
          placeholder="A name, such as dana-laptop"
          aria-label="The new token's name"
          className="mono max-w-72"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Button look="plain" type="submit" disabled={name.trim() === ''}>
          New token
        </Button>
      </form>
      {trouble !== undefined && revoking === undefined && (
        <ErrorLine className="mt-2">{trouble}</ErrorLine>
      )}
      <Sheet
        open={minted !== undefined}
        onOpenChange={() => {
          setMinted(undefined);
        }}
        title={`The token ${minted?.name ?? ''}`}
        description="It is shown once: the plane keeps only its hash. Copy it now."
        width={520}
      >
        <div className="flex items-center gap-2 rounded-md bg-sunken p-3">
          <code className="mono min-w-0 flex-1 text-xs break-all text-ink">{minted?.token}</code>
          <CopyButton text={minted?.token ?? ''} label="Copy the token" />
        </div>
        <p className="mt-3 text-[13px] text-ink-muted">
          The cli takes it with{' '}
          <code className="mono text-xs">
            cernanto login {PLANE_ORIGIN} --token &lt;the token&gt;
          </code>
          .
        </p>
      </Sheet>
      <Sheet
        open={revoking !== undefined}
        onOpenChange={() => {
          setRevoking(undefined);
        }}
        title={`Revoke the token ${revoking ?? ''}?`}
        description={`On ${planeWhere(standing, PLANE_ADDRESS)}. It admits nothing new from that moment, and it cannot be undone.`}
        width={460}
      >
        <div className="flex flex-col gap-3">
          {careful && (
            <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
              Type the token's name to confirm
              <Field
                autoFocus
                value={typed}
                placeholder={revoking ?? ''}
                className="mono"
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
              />
            </label>
          )}
          {trouble !== undefined && <ErrorLine>{trouble}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <Button
              look="quiet"
              onClick={() => {
                setRevoking(undefined);
              }}
            >
              Keep it
            </Button>
            <Button
              look="danger"
              disabled={careful && typed !== revoking}
              onClick={() => {
                if (revoking === undefined) return;
                setTrouble(undefined);
                // The dialog may be closed, and opened on another token,
                // before the plane answers: the answer closes the dialog
                // it was pressed in and no other, and the tokens are
                // asked again either way.
                const still = pressedAt();
                void gateway
                  .tokenRevoke({ client: plane, path: { name: revoking } })
                  .then((result) => {
                    unwrap(result, 'the token');
                    if (still()) setRevoking(undefined);
                    return refresh();
                  })
                  .catch((error: unknown) => {
                    if (still()) setTrouble(wordsOf(error));
                  });
              }}
            >
              Revoke the token
            </Button>
          </div>
        </div>
      </Sheet>
    </Part>
  );
}

/** The agents that hold settings, each a jump to that agent's Settings
 * tab, at Config. No value is kept here. */
function AllSettings(): ReactNode {
  const places = useQuery({
    queryKey: ['config-places'],
    queryFn: async () => {
      const answer = unwrap(await gateway.configList({ client: plane }), 'the settings');
      // The plane's listing answers the values too. Only the places and the names are kept.
      return Object.entries(answer.configuration)
        .map(([place, mapping]) => ({
          place,
          names: typeof mapping === 'object' && mapping !== null ? Object.keys(mapping).sort() : [],
        }))
        .sort((a, b) => a.place.localeCompare(b.place));
    },
    staleTime: 15_000,
  });
  const fleet = useFleet();
  return (
    <Part
      title="All config"
      words="Config lives under the agent that reads it. Its values are read and written in that agent's Settings tab."
    >
      {places.isError && <ErrorLine>{wordsOf(places.error)}</ErrorLine>}
      {places.data !== undefined && places.data.length === 0 && (
        <p className="text-[13px] text-ink-muted">Nothing is set on this plane.</p>
      )}
      {(places.data ?? []).map(({ place, names }) => {
        const agentId = fleet.byId.has(place) ? place : place.replace(/\/tests$/, '');
        const known = fleet.byId.has(agentId);
        const inner = (
          <>
            <Avatar agentId={agentId} size={22} ground="var(--ground)" />
            <span className="mono min-w-0 shrink truncate text-xs text-ink">{place}</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-ink-muted">
              {names.join(', ')}
            </span>
          </>
        );
        const className = 'flex h-10 items-center gap-3 border-b px-1 text-[13px] last:border-b-0';
        return known ? (
          <Link
            key={place}
            to="/agents/$"
            params={{ _splat: agentId }}
            search={{ tab: 'settings' }}
            hash="config"
            className={cx(className, 'hover:bg-hover')}
          >
            {inner}
          </Link>
        ) : (
          <div key={place} className={className}>
            {inner}
          </div>
        );
      })}
    </Part>
  );
}

/** Every agent's accounts in one list: the provider, who logged each in
 * and when, never a value. */
function AllAccounts(): ReactNode {
  const auth = useAuth();
  const [clock] = useClock();
  return (
    <Part
      title="All auth"
      words="An agent keeps its own accounts alone. One is forgotten in its agent's Settings tab."
    >
      {auth.isError && <ErrorLine>{wordsOf(auth.error)}</ErrorLine>}
      {auth.data !== undefined && auth.data.accounts.length === 0 && (
        <p className="text-[13px] text-ink-muted">No agent is logged in to an account.</p>
      )}
      {(auth.data?.accounts ?? []).map((account) => (
        <Link
          key={`${account.agent}:${account.name}`}
          to="/agents/$"
          params={{ _splat: account.agent }}
          search={{ tab: 'settings' }}
          hash="auth"
          className="flex min-h-10 items-center gap-3 border-b px-1 py-1.5 text-[13px] last:border-b-0 hover:bg-hover"
        >
          <Avatar agentId={account.agent} size={22} ground="var(--ground)" />
          <AgentName agentId={account.agent} className="w-56 shrink-0 text-left" />
          <span className="mono min-w-0 flex-1 truncate text-xs text-ink-secondary">
            {account.name} · {account.provider} · {account.kind}
          </span>
          {account.loggedInAt !== undefined && (
            <span className="shrink-0 text-xs text-ink-muted">
              <Moment at={account.loggedInAt}>{factMoment(account.loggedInAt, clock)}</Moment>
              {account.loggedInBy !== undefined && ` by ${account.loggedInBy}`}
            </span>
          )}
        </Link>
      ))}
    </Part>
  );
}

/** One archive of every source the plane runs, each at the path its id
 * names: a workspace ready for git. */
function ExportAll(): ReactNode {
  const fleet = useFleet();
  const shipped = useAgents();
  const [state, setState] = useState<{ done: number; of: number } | undefined>(undefined);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const own = fleet.agents.filter((agent) => !agent.platform && !agent.pair);
  return (
    <Part
      title="Export"
      words="Saves one archive of every source of your agents, each at the path its id names, with the workspace's marker: a folder ready for git init. The platform's own agents are left out."
    >
      <div className="flex items-center gap-3">
        <Button
          look="plain"
          // Which package an agent runs is read from the plane's agents as shipped.
          disabled={state !== undefined || own.length === 0 || shipped.data === undefined}
          onClick={() => {
            setTrouble(undefined);
            setState({ done: 0, of: own.length });
            void (async () => {
              // The archive is every source or it is not made: one that
              // leaves an agent out reads as a whole one.
              const packages = own.map((agent) => ({
                id: agent.id,
                digest: packageOf(
                  agent,
                  (shipped.data?.generations ?? [])
                    .filter((entry) => entry.agentId === agent.id)
                    .sort((a, b) => b.gen - a.gen),
                ),
              }));
              const unnamed = packages.filter((entry) => entry.digest === undefined);
              if (unnamed.length > 0) {
                throw new Error(
                  `The plane names no package for ${unnamed.map((entry) => entry.id).join(', ')}: nothing was saved.`,
                );
              }
              const entries: { name: string; text: string }[] = [
                { name: 'cernanto.json', text: '{ "version": 1 }\n' },
              ];
              let done = 0;
              for (const { id, digest } of packages) {
                if (digest === undefined) continue;
                entries.push({
                  name: `${id}.cern.md`,
                  text: await readPackageFile(digest, SOURCE),
                });
                done += 1;
                setState({ done, of: own.length });
              }
              saveFile('cernanto-sources.tar', writeTar(entries), 'application/x-tar');
            })()
              .catch((error: unknown) => {
                setTrouble(wordsOf(error));
              })
              .finally(() => {
                setState(undefined);
              });
          }}
        >
          {state === undefined
            ? `Export all sources (${String(own.length)})`
            : `Reading ${String(state.done)} of ${String(state.of)}…`}
        </Button>
        {trouble !== undefined ? (
          <ErrorLine>{trouble}</ErrorLine>
        ) : (
          shipped.data === undefined &&
          shipped.isError && <ErrorLine>{wordsOf(shipped.error)}</ErrorLine>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        A source that names files of its own (a prompt, a table, a document it implements) is not
        whole without them: its package carries them, and the agent's menu exports the package.
      </p>
    </Part>
  );
}

interface OtherPlane {
  name: string;
  address: string;
}
const NO_PLANES: OtherPlane[] = [];

/** Links to the other planes this reader named, kept in this browser.
 * Each plane serves its own UI at its own address. */
function OtherPlanes(): ReactNode {
  const [planes, setPlanes] = usePref<OtherPlane[]>('planes', NO_PLANES);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const valid = name.trim() !== '' && /^https?:\/\/\S+$/i.test(address.trim());
  return (
    <Part
      title="Other planes"
      words="A laptop's, staging, production: each plane serves its own UI at its own address. These are links, kept in this browser."
    >
      {planes.length === 0 && (
        <p className="text-[13px] text-ink-muted">No other plane is named.</p>
      )}
      {planes.map((entry) => (
        <div key={entry.address} className="flex h-10 items-center gap-3 border-b text-[13px]">
          <a
            href={entry.address}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 flex-1 truncate font-medium text-ink hover:underline"
          >
            {entry.name}
          </a>
          <span className="mono min-w-0 shrink truncate text-xs text-ink-muted">
            {entry.address}
          </span>
          <Button
            small
            look="quiet"
            onClick={() => {
              setPlanes(planes.filter((other) => other.address !== entry.address));
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          setPlanes([
            ...planes.filter((other) => other.address !== address.trim()),
            { name: name.trim(), address: address.trim() },
          ]);
          setName('');
          setAddress('');
        }}
      >
        <Field
          value={name}
          placeholder="Its name"
          aria-label="The other plane's name"
          className="max-w-44"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Field
          value={address}
          placeholder="https://plane.example.com"
          aria-label="The other plane's address"
          className="mono max-w-80"
          onChange={(event) => {
            setAddress(event.target.value);
          }}
        />
        <Button type="submit" disabled={!valid}>
          Add
        </Button>
      </form>
    </Part>
  );
}

/** What this is, and where to read more. */
function About(): ReactNode {
  const fleet = useFleet();
  const [clock] = useClock();
  const guides: [string, string][] = [
    ['Writing agents', 'https://cernanto.com/docs/writing-agents'],
    ['How it works', 'https://cernanto.com/docs/how-it-works'],
    ['Running a plane', 'https://cernanto.com/docs/running-a-plane'],
  ];
  return (
    <Part title="About" words="A console for the plane, served by the plane's own gateway.">
      <Line name="Agents">
        {fleet.agents.filter((agent) => !agent.platform).length} of yours,{' '}
        {fleet.agents.filter((agent) => agent.platform).length} of the platform's own
      </Line>
      {fleet.usageSince !== undefined && (
        <Line name="Counting since">
          <Moment at={fleet.usageSince}>{tableMoment(fleet.usageSince, clock)}</Moment>
        </Line>
      )}
      <Line name="The API">
        <a
          href={`${PLANE_ORIGIN}/v1/openapi.json`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent-text underline underline-offset-2"
        >
          This plane's OpenAPI document
        </a>
      </Line>
      <Line name="Guides">
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {guides.map(([word, address]) => (
            <a
              key={address}
              href={address}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent-text underline underline-offset-2"
            >
              {word}
            </a>
          ))}
        </span>
      </Line>
      <Line name="Keys">
        <span className="text-ink-secondary">
          <kbd className="mono text-xs">⌘K</kbd> or <kbd className="mono text-xs">Ctrl K</kbd> goes
          to an agent or a function · <kbd className="mono text-xs">/</kbd> filters the list ·{' '}
          <kbd className="mono text-xs">Esc</kbd> closes
        </span>
      </Line>
      <p className="mt-6 text-xs text-ink-muted">
        The web UI carries React, TanStack Query and Router, Radix, Tailwind CSS, CodeMirror, Lucide
        and react-virtuoso, each under its own open license, and JetBrains Mono under the SIL Open
        Font License 1.1. The marks of npm, OpenAPI and MCP belong to their projects.
      </p>
    </Part>
  );
}

/** Settings: what belongs to the plane as a whole and to no one agent,
 * its parts listed at the left as a console lists them. */
export function Settings(): ReactNode {
  const [part, setPart] = usePref<PartName>('settings.part', 'plane');
  const [standing] = usePlane();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 max-md:flex-col">
      <nav
        aria-label="Settings"
        className="flex w-56 shrink-0 flex-col gap-0.5 border-r bg-surface p-3 max-md:w-full max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b"
      >
        <h1 className="px-2 pt-1 pb-3 text-[17px] font-bold tracking-tight text-ink max-md:hidden">
          Settings
        </h1>
        {PARTS.map(([name, word]) => (
          <button
            key={name}
            type="button"
            aria-current={part === name ? 'page' : undefined}
            onClick={() => {
              setPart(name);
            }}
            className={cx(
              'flex h-8 shrink-0 items-center rounded-md px-2 text-left text-[13px] whitespace-nowrap',
              part === name
                ? 'bg-chosen font-semibold text-ink'
                : 'text-ink-secondary hover:bg-hover',
            )}
          >
            {word}
          </button>
        ))}
        <span className="flex-1" />
        <div className="px-2 pt-3 text-xs text-ink-muted max-md:hidden">
          {planeLabel(standing, PLANE_ADDRESS)}{' '}
          <Tag filled={standing.kind === 'PRODUCTION'}>{standing.kind}</Tag>
        </div>
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-7">
        {part === 'plane' && <ThisPlane />}
        {part === 'you' && <You />}
        {part === 'assistant' && <Assistant />}
        {part === 'tokens' && <Tokens />}
        {part === 'settings' && <AllSettings />}
        {part === 'accounts' && <AllAccounts />}
        {part === 'export' && <ExportAll />}
        {part === 'planes' && <OtherPlanes />}
        {part === 'about' && <About />}
      </div>
    </div>
  );
}
