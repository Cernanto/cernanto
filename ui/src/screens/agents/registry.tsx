// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { parsePackageRef } from '@cernanto/package-format/browser';
import type { SummaryRow } from '@cernanto/package-format/browser';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../../api/plane.js';
import { useStanding } from '../../app/standing.js';
import { REGISTRY_HOST, useRegistry, useRegistryPackage } from '../../api/registry.js';
import { TypeWord } from '../../components/agent-type.js';
import { PlaneMark } from '../../components/plane.js';
import {
  AgentName,
  Avatar,
  Button,
  Chip,
  cx,
  ErrorLine,
  Moment,
  Quiet,
  Sheet,
  Tag,
} from '../../components/ui.js';
import * as gateway from '../../gateway/sdk.gen.js';
import type { LandResult } from '../../gateway/types.gen.js';
import { countWord } from '../../model/figures.js';
import type { Fleet } from '../../model/fleet.js';
import { weightWord } from '../../model/package.js';
import { listed, newestOf, standingOf } from '../../model/registry.js';
import type { Standing } from '../../model/registry.js';
import { factMoment } from '../../model/time.js';
import { useClock } from '../../state/prefs.js';
import { CopyButton } from '../agent/trace/body.js';

/** How a package stands on this plane, as a small word on its line. */
function StandingTag({ standing }: { standing: Standing }): ReactNode {
  if (standing.state === 'absent') return null;
  if (standing.state === 'own')
    return <Tag title="Deployed here from its source">On this plane</Tag>;
  return (
    <Tag
      title={
        standing.newer
          ? 'The registry holds a newer version'
          : 'Installed on this plane from the registry'
      }
    >
      {standing.version === undefined ? 'Installed' : `Installed ${standing.version}`}
    </Tag>
  );
}

/** One fact of a package: its name and what the registry says of it. */
function Fact({ name, children }: { name: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-baseline gap-3 py-0.5 text-[13px]">
      <span className="w-20 shrink-0 text-ink-muted">{name}</span>
      <span className="min-w-0 flex-1 text-ink">{children}</span>
    </div>
  );
}

/** What stands beside the list: the package the reader chose, what the
 * registry says of it, what an install brings, and the install itself. */
function Chosen({
  name,
  row,
  fleet,
  unread,
  onInstalled,
}: {
  name: string;
  /** The package's line of the summary; none for a name typed that the list does not hold. */
  row: SummaryRow | undefined;
  fleet: Fleet;
  /** The registry could not be read at all, which the list beside this already says. */
  unread: boolean;
  onInstalled: (agentId: string, lead: boolean) => void;
}): ReactNode {
  const [clock] = useClock();
  const reference = parsePackageRef(name);
  const id = reference?.name ?? name;
  const index = useRegistryPackage(reference === undefined ? undefined : id);
  // What is shown is the version the install lands: the one a name with
  // a version after its `@` asks for, and the newest for a name alone.
  const range = reference?.range ?? 'latest';
  const newest = index.data === undefined ? undefined : newestOf(index.data, range);
  const held = fleet.byId.get(id);
  const standing = standingOf(newest?.version ?? row?.latest ?? '0.0.0', held?.row);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const [landed, setLanded] = useState<LandResult | undefined>(undefined);
  const line = `cernanto deploy ${name}`;
  // This part stands for one package while the sheet is open on it: it
  // is gone once the sheet is closed, and once another package is chosen.
  const pressedAt = useStanding();

  const install = (): void => {
    setBusy(true);
    setTrouble(undefined);
    const still = pressedAt();
    void gateway
      .land({ client: plane, body: { target: name } })
      .then((result) => {
        const answer = unwrap(result, 'the install');
        // The agents are asked again whatever the reader did meanwhile.
        // What the plane warned of is read before they are taken on; and
        // a reader who closed the sheet, chose another package or went
        // elsewhere while the plane installed it is taken nowhere.
        if (answer.warnings.length > 0) {
          setLanded(answer);
          onInstalled(id, false);
        } else onInstalled(id, still());
      })
      .catch((error: unknown) => {
        setTrouble(wordsOf(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  // What an install needs and the plane lacks comes with it: the agents
  // it uses, and the interfaces it implements, a document's aside.
  const comes = [
    ...(newest?.uses ?? []),
    ...(newest?.implements ?? []).filter((entry) => !entry.startsWith('openapi:')),
  ].filter((needed) => !fleet.byId.has(needed));
  const installs =
    standing.state === 'absent' || (standing.state === 'installed' && standing.newer);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar agentId={id} size={36} ground="var(--ui-message)" />
        <div className="min-w-0 flex-1">
          <AgentName agentId={id} className="block text-left text-[15px]" />
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            {newest === undefined ? (
              (row?.latest ?? '')
            ) : (
              <>
                <TypeWord type={newest.type} />
                <span aria-hidden="true">·</span>
                <span>{newest.version}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {row?.description !== undefined && (
        <p className="text-[13px] break-words text-ink-secondary">
          {row.description}
          {/* The registry keeps the first of a package's words: one cut short says so. */}
          {/[.!?:)"'`\]]$/.test(row.description.trim()) ? '' : '…'}
        </p>
      )}
      {index.isPending && reference !== undefined && (
        <p className="text-xs text-ink-muted">Reading the package…</p>
      )}
      {index.isError && !unread && <ErrorLine>{index.error.message}</ErrorLine>}
      {unread && installs && (
        <p className="text-[13px] text-ink-secondary">
          Install takes this name as it is typed: the plane asks the registry for it by itself.
        </p>
      )}
      {index.data !== undefined && newest === undefined && (
        <ErrorLine>
          The registry holds no version of {id}{' '}
          {range === 'latest' || range === '*' ? 'to install' : `that fits ${range}`}.
        </ErrorLine>
      )}
      {newest !== undefined && (
        <div>
          {newest.license !== undefined && <Fact name="License">{newest.license}</Fact>}
          <Fact name="Published">
            <Moment at={newest.publishedAt}>{factMoment(newest.publishedAt, clock)}</Moment>
            <span className="text-ink-muted"> · {weightWord(newest.size)}</span>
          </Fact>
          {row !== undefined && row.downloads > 0 && (
            <Fact name="Installs">{countWord(row.downloads)}</Fact>
          )}
          {/* The registry's own count of who starred it, as the cli's search prints it. */}
          {row !== undefined && row.stars > 0 && <Fact name="Stars">{countWord(row.stars)}</Fact>}
          {newest.implements.length > 0 && (
            <Fact name="Implements">
              <span className="mono text-xs break-all">{newest.implements.join(', ')}</span>
            </Fact>
          )}
          {newest.uses.length > 0 && (
            <Fact name="Uses">
              <span className="mono text-xs break-all">{newest.uses.join(', ')}</span>
            </Fact>
          )}
          {comes.length > 0 && (
            <p className="mt-1.5 text-xs text-ink-muted">
              Not on this plane, and installed with it:{' '}
              <span className="mono break-all text-ink-secondary">{comes.join(', ')}</span>.
            </p>
          )}
          {newest.deprecated !== undefined && (
            <p className="mt-2 text-[13px] text-bad">Deprecated: {newest.deprecated}</p>
          )}
        </div>
      )}

      {landed !== undefined ? (
        <div className="rounded-md border px-3 py-2.5 text-[13px]">
          <p className="font-medium text-ink">
            Installed{' '}
            {landed.landed.map((entry) => `${entry.agentId} ${entry.version}`).join(', ') || id}.
          </p>
          {landed.resolved.length > 0 && (
            <p className="mt-1 text-ink-secondary">
              With it: {landed.resolved.map((entry) => entry.agentId).join(', ')}.
            </p>
          )}
          <ul className="mt-1.5 flex flex-col gap-0.5 text-ink-secondary">
            {landed.warnings.map((warning, at) => (
              <li key={at} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
          <Button
            look="main"
            className="mt-2.5"
            onClick={() => {
              onInstalled(id, true);
            }}
          >
            Open it
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {standing.state === 'own' && (
            <p className="text-[13px] text-ink-secondary">
              An agent under this id was deployed here from its source. It is its author's own, and
              an install does not land over it.
            </p>
          )}
          {standing.state === 'installed' && (
            <p className="text-[13px] text-ink-secondary">
              On this plane{standing.version === undefined ? '' : `, at ${standing.version}`}.
              {standing.newer && newest !== undefined && ` The registry holds ${newest.version}.`}
            </p>
          )}
          {installs && (
            <p className="text-xs text-ink-muted">
              Nothing is compiled: the package runs as its publisher's tests proved it.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {installs && (
              <Button
                look="main"
                disabled={
                  busy ||
                  reference === undefined ||
                  (index.data !== undefined && newest === undefined)
                }
                onClick={install}
              >
                {busy
                  ? 'Installing…'
                  : standing.state === 'installed' && newest !== undefined
                    ? `Install ${newest.version}`
                    : 'Install'}
                {!busy && <PlaneMark />}
              </Button>
            )}
            {standing.state !== 'absent' && (
              <Button
                onClick={() => {
                  onInstalled(id, true);
                }}
              >
                Open it
              </Button>
            )}
          </div>
          {trouble !== undefined && <ErrorLine className="break-words">{trouble}</ErrorLine>}
        </div>
      )}

      <div className="mt-auto flex items-center gap-1 pt-1">
        <code className="mono min-w-0 flex-1 truncate rounded-md bg-sunken px-2 py-1 text-xs text-ink-secondary">
          {line}
        </code>
        <CopyButton text={line} label="Copy the command" />
      </div>
    </div>
  );
}

/**
 * The registry's sheet: the agents published in the registry, searched
 * as `cernanto registry search` searches them, and one of them
 * installed on this plane as it is. The browser reads the registry's
 * list itself; the plane installs by the package's name, through its
 * own road to the registry.
 */
export function RegistrySheet({
  open,
  onOpenChange,
  fleet,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fleet: Fleet;
  /** Told the agent that stands on the plane now, and whether the reader
   * is to be led to it: they are, unless they went elsewhere while the
   * plane installed it. */
  onInstalled: (agentId: string, lead: boolean) => void;
}): ReactNode {
  const registry = useRegistry(open);
  const [text, setText] = useState('');
  const [platform, setPlatform] = useState(false);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const rows = useMemo(
    () => (registry.data === undefined ? [] : listed(registry.data, text, platform)),
    [registry.data, text, platform],
  );
  // A name typed whole installs as typed too: one the list does not
  // hold, or one with the version wanted after an `@`.
  const typed = text.trim();
  const asTyped =
    typed !== '' && parsePackageRef(typed) !== undefined && !rows.some((row) => row.name === typed)
      ? typed
      : undefined;
  // What the reader picked stands. With nothing picked, a name typed
  // whole with the version wanted is the one meant, whatever the search
  // finds beside it: its line stands first, and an install of it takes
  // that version. Otherwise the search's first, and what was typed where
  // the search finds nothing.
  const versioned = asTyped !== undefined && asTyped.includes('@') ? asTyped : undefined;
  const chosen = picked ?? versioned ?? rows[0]?.name ?? asTyped;
  const chosenRow = rows.find((row) => row.name === chosen);
  const own = (registry.data?.packages ?? []).filter((row) => row.name.startsWith('cernanto/'));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="From the registry"
      description={`The agents published at ${REGISTRY_HOST}. One is installed on this plane as it is, with what it needs.`}
      width={920}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 basis-64 items-center gap-2 rounded-md border border-line-strong bg-sunken px-2.5 focus-within:border-ink">
          <Search size={14} className="shrink-0 text-ink-muted" />
          <input
            type="text"
            value={text}
            spellCheck={false}
            aria-label="Search the registry"
            placeholder="Search the registry, or type a name"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
            onChange={(event) => {
              setText(event.target.value);
              setPicked(undefined);
            }}
          />
        </label>
        {own.length > 0 && (
          <Chip
            active={platform}
            count={own.length}
            onClick={() => {
              setPlatform(!platform);
              setPicked(undefined);
            }}
          >
            The platform's own
          </Chip>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-4 md:h-[min(58vh,520px)] md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-0 min-w-0 flex-col">
          {registry.isPending && <Quiet>Reading the registry…</Quiet>}
          {registry.isError && (
            <div className="rounded-md border px-3 py-2.5">
              <ErrorLine>{registry.error.message}</ErrorLine>
              <p className="mt-1 text-xs text-ink-muted">
                A package is installed by its name all the same: type it whole above, such as
                examples/basics/counter.
              </p>
            </div>
          )}
          {registry.data !== undefined && rows.length === 0 && asTyped === undefined && (
            <Quiet>
              {typed === '' ? 'The registry lists no package.' : 'No package matches.'}
              {!platform && own.length > 0 && typed !== '' && (
                <span className="mt-1 block text-xs">
                  The platform's own {String(own.length)} packages are left out.
                </span>
              )}
            </Quiet>
          )}
          <ul
            className="flex max-h-[52vh] min-h-0 flex-col overflow-y-auto md:max-h-none md:flex-1"
            aria-label="The registry's packages"
          >
            {asTyped !== undefined && (
              <li>
                <button
                  type="button"
                  aria-current={chosen === asTyped ? 'true' : undefined}
                  onClick={() => {
                    setPicked(asTyped);
                  }}
                  className={cx(
                    'flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover',
                    chosen === asTyped && 'bg-chosen',
                  )}
                >
                  <Avatar agentId={asTyped.split('@')[0] ?? asTyped} size={28} faded />
                  <span className="mono min-w-0 flex-1 truncate text-xs text-ink">{asTyped}</span>
                  <span className="shrink-0 text-xs text-ink-muted">as typed</span>
                </button>
              </li>
            )}
            {rows.map((row) => {
              const standing = standingOf(row.latest, fleet.byId.get(row.name)?.row);
              return (
                <li key={row.name}>
                  <button
                    type="button"
                    aria-current={chosen === row.name ? 'true' : undefined}
                    onClick={() => {
                      setPicked(row.name);
                    }}
                    className={cx(
                      'flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover',
                      chosen === row.name && 'bg-chosen',
                    )}
                  >
                    <Avatar agentId={row.name} size={28} ground="var(--ui-message)" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <AgentName agentId={row.name} className="text-left text-[13px]" />
                        <StandingTag standing={standing} />
                      </span>
                      {row.description !== undefined && (
                        <span className="truncate text-xs text-ink-muted">{row.description}</span>
                      )}
                    </span>
                    <span className="figures shrink-0 text-xs text-ink-muted">{row.latest}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="min-h-0 min-w-0 overflow-y-auto border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-5">
          {chosen === undefined ? (
            <p className="text-[13px] text-ink-muted">
              Choose a package to read what it is and what comes with it.
            </p>
          ) : (
            <Chosen
              key={chosen}
              name={chosen}
              row={chosenRow}
              fleet={fleet}
              unread={registry.isError}
              onInstalled={onInstalled}
            />
          )}
        </div>
      </div>
    </Sheet>
  );
}
