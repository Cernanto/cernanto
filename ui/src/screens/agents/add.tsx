// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useNavigate } from '@tanstack/react-router';
import { Plus, SquarePen } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../../api/plane.js';
import { standingHere } from '../../app/search.js';
import { useStanding } from '../../app/standing.js';
import { readPackageFile, useAskAgain } from '../../api/queries.js';
import { TypeWord } from '../../components/agent-type.js';
import { FileMark } from '../../components/file-mark.js';
import { KindMark } from '../../components/party.js';
import {
  Button,
  ErrorLine,
  Field,
  IconButton,
  Menu,
  MenuItem,
  Sheet,
} from '../../components/ui.js';
import * as gateway from '../../gateway/sdk.gen.js';
import type { Fleet } from '../../model/fleet.js';
import { MANIFEST } from '../../model/package.js';
import type { PackageManifest } from '../../model/package.js';
import { importStandings, newSource, scanSource, titleFromId, typeOf } from '../../model/source.js';
import { currentDrafts, draftHeld, freeId, useDrafts } from '../../state/drafts.js';
import { packageDigest } from '../../state/sha256.js';
import { RegistrySheet } from './registry.js';

/** A source chosen from the reader's computer, before anything is done with it. */
interface ChosenSource {
  file: string;
  name: string;
  text: string;
  type: string;
  uses: string[];
  issues: number;
  ticked: boolean;
}

/** A package chosen from the reader's computer, stored on the plane and read there. */
interface ChosenPackage {
  file: string;
  digest: string;
  manifest: PackageManifest | undefined;
  trouble: string | undefined;
  ticked: boolean;
}

/** What a line of the sheet says of a source that becomes no draft. */
const STANDING_WORDS: Record<NonNullable<ReturnType<typeof importStandings>[number]>, string> = {
  invalid: 'not an id an agent may take',
  agent: 'exists on this plane',
  draft: 'a draft holds this id',
  twice: 'the same id as a file above',
};

/** The sheet of sources: each becomes a new agent, listed before anything is done. */
function SourcesSheet({
  sources,
  setSources,
  fleet,
  onDone,
}: {
  sources: ChosenSource[];
  setSources: (sources: ChosenSource[]) => void;
  fleet: Fleet;
  onDone: (first: string | undefined) => void;
}): ReactNode {
  const { drafts, create } = useDrafts();
  const [folder, setFolder] = useState('');
  const pressedAt = useStanding(sources.length > 0);
  const idOf = (source: ChosenSource): string => {
    const lead = folder.trim().replace(/^\/+|\/+$/g, '');
    return lead === '' ? source.name : `${lead}/${source.name}`;
  };
  // One reading of the import: what a line shows of its source is what
  // the button does with it, and no source is written over what stands.
  const standings = importStandings(
    sources.map((source) => ({ id: idOf(source), ticked: source.ticked })),
    { agent: (id) => fleet.occupied(id), draft: (id) => draftHeld(drafts, id) },
  );
  const taken = sources.filter((source, at) => source.ticked && standings[at] === undefined);
  return (
    <Sheet
      open={sources.length > 0}
      onOpenChange={() => {
        setSources([]);
      }}
      title="From .cern.md files"
      description="Each source becomes a draft of a new agent, to be read in the editor and deployed from there. Nothing is uploaded yet."
      width={760}
    >
      <label className="mb-3 flex items-center gap-3 text-[13px] text-ink-secondary">
        Put them under
        <Field
          value={folder}
          placeholder="a folder, such as payments"
          aria-label="The folder the agents are put under"
          className="mono max-w-64"
          onChange={(event) => {
            setFolder(event.target.value);
          }}
        />
      </label>
      <ul className="flex flex-col">
        {sources.map((source, index) => {
          const id = idOf(source);
          const standing = standings[index];
          return (
            <li
              key={source.file}
              className="flex min-h-10 items-center gap-3 border-b py-1.5 text-[13px] last:border-b-0"
            >
              <input
                type="checkbox"
                checked={source.ticked && standing === undefined}
                disabled={standing !== undefined}
                aria-label={`Take ${source.file}`}
                onChange={(event) => {
                  setSources(
                    sources.map((held, at) =>
                      at === index ? { ...held, ticked: event.target.checked } : held,
                    ),
                  );
                }}
              />
              <span
                className="mono w-48 shrink-0 truncate text-xs text-ink-muted"
                title={source.file}
              >
                {source.file}
              </span>
              <span className="mono min-w-0 flex-1 truncate text-xs text-ink">{id}</span>
              <TypeWord type={source.type} className="w-20 shrink-0 text-xs text-ink-secondary" />
              <span className="w-44 shrink-0 truncate text-right text-xs text-ink-muted">
                {standing !== undefined
                  ? STANDING_WORDS[standing]
                  : source.issues > 0
                    ? `${String(source.issues)} to look at`
                    : source.uses.length > 0
                      ? `uses ${String(source.uses.length)}`
                      : ''}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          look="quiet"
          onClick={() => {
            setSources([]);
          }}
        >
          Leave them
        </Button>
        <Button
          look="main"
          disabled={taken.length === 0}
          onClick={() => {
            // A draft another window made meanwhile under one of the ids,
            // or makes at this moment, stays as it is. The drafts are
            // made a moment later: a sheet closed by then leads nowhere.
            const still = pressedAt();
            void (async () => {
              const made: string[] = [];
              for (const source of taken) {
                const id = idOf(source);
                if (await create({ id, text: source.text, updatedAt: new Date().toISOString() })) {
                  made.push(id);
                }
              }
              if (!still()) return;
              setSources([]);
              onDone(made[0]);
            })();
          }}
        >
          Open as drafts
        </Button>
      </div>
    </Sheet>
  );
}

/** The sheet of packages: each was stored on the plane and read there;
 * "add" lands the ticked ones in one landing. Nothing is compiled: the
 * bytes that were verified elsewhere run here as they are. */
function PackagesSheet({
  packages,
  setPackages,
  onDone,
}: {
  packages: ChosenPackage[];
  setPackages: (packages: ChosenPackage[]) => void;
  onDone: (first: string | undefined) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const pressedAt = useStanding(packages.length > 0);
  const ticked = packages.filter((entry) => entry.ticked && entry.manifest !== undefined);
  return (
    <Sheet
      open={packages.length > 0}
      onOpenChange={() => {
        setPackages([]);
      }}
      title="From .cern packages"
      description="A package runs here as it is: nothing is compiled. What it needs and the plane lacks is resolved through the registry."
      width={760}
    >
      <ul className="flex flex-col">
        {packages.map((entry, index) => (
          <li
            key={entry.digest}
            className="flex min-h-10 items-center gap-3 border-b py-1.5 text-[13px] last:border-b-0"
          >
            <input
              type="checkbox"
              checked={entry.ticked && entry.manifest !== undefined}
              disabled={entry.manifest === undefined}
              aria-label={`Take ${entry.file}`}
              onChange={(event) => {
                setPackages(
                  packages.map((held, at) =>
                    at === index ? { ...held, ticked: event.target.checked } : held,
                  ),
                );
              }}
            />
            <span className="mono w-44 shrink-0 truncate text-xs text-ink-muted" title={entry.file}>
              {entry.file}
            </span>
            {entry.manifest === undefined ? (
              <span className="min-w-0 flex-1 truncate text-xs text-bad">
                {entry.trouble ?? 'The plane could not read this package.'}
              </span>
            ) : (
              <>
                <span className="mono min-w-0 flex-1 truncate text-xs text-ink">
                  {entry.manifest.name}
                </span>
                <TypeWord
                  type={entry.manifest.type ?? 'task'}
                  className="w-20 shrink-0 text-xs text-ink-secondary"
                />
                <span className="figures w-16 shrink-0 text-xs text-ink-muted">
                  {entry.manifest.version ?? ''}
                </span>
                <span className="w-28 shrink-0 text-right text-xs text-ink-muted">
                  {entry.manifest.provenance?.verified === undefined
                    ? 'not verified'
                    : 'tests proved it'}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {trouble !== undefined && <ErrorLine className="mt-3">{trouble}</ErrorLine>}
      <div className="mt-4 flex justify-end gap-2">
        <Button
          look="quiet"
          onClick={() => {
            setPackages([]);
          }}
        >
          Leave them
        </Button>
        <Button
          look="main"
          disabled={ticked.length === 0 || busy}
          onClick={() => {
            setBusy(true);
            setTrouble(undefined);
            const still = pressedAt();
            void gateway
              .land({
                client: plane,
                body: { targets: ticked.map((entry) => entry.digest), installed: true },
              })
              .then((result) => {
                unwrap(result, 'the landing');
                // A reader who closed the sheet or went elsewhere while the
                // plane took them is led to none of them, and a sheet that
                // shows other packages since is left as it is: the agents
                // are asked again all the same.
                if (!still()) {
                  onDone(undefined);
                  return;
                }
                const first = ticked[0]?.manifest?.name;
                setPackages([]);
                onDone(first);
              })
              .catch((error: unknown) => {
                // What failed of a sheet that was closed is not said in the one opened after it.
                if (still()) setTrouble(wordsOf(error));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {busy ? 'Adding…' : `Add ${String(ticked.length)}`}
        </Button>
      </div>
    </Sheet>
  );
}

/** The measure of the sign before each way to add an agent. */
const SIGN = 20;

/** The `+` button: the ways to add an agent, each behind a sign of its
 * own. Writing one is the pen of a new message; the registry is its box,
 * as wherever the UI names it; and a file from the reader's computer
 * wears the mark of its format. */
export function AddMenu({ fleet }: { fleet: Fleet }): ReactNode {
  const navigate = useNavigate();
  const askAgain = useAskAgain();
  const { create } = useDrafts();
  const sourceInput = useRef<HTMLInputElement>(null);
  const packageInput = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<ChosenSource[]>([]);
  const [packages, setPackages] = useState<ChosenPackage[]>([]);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const [registry, setRegistry] = useState(false);

  const open = (agentId: string | undefined, tab?: 'source'): void => {
    if (agentId === undefined) return;
    void navigate({
      to: '/agents/$',
      params: { _splat: agentId },
      ...(tab === undefined ? {} : { search: { tab } }),
    });
  };

  const newAgent = (): void => {
    void (async () => {
      // An id another window takes for a draft at the same moment is left
      // to it, and the next free one is tried: two windows that each make
      // a new agent at once get two. The draft is made a moment later: a
      // reader who went elsewhere by then finds it in the list.
      const here = standingHere();
      const left = new Set<string>();
      for (let tries = 0; tries < 8; tries += 1) {
        const held = currentDrafts();
        const id = freeId(
          (candidate) =>
            left.has(candidate) || fleet.occupied(candidate) || draftHeld(held, candidate),
        );
        const draft = { id, text: newSource(titleFromId(id)), updatedAt: new Date().toISOString() };
        if (await create(draft)) {
          if (here()) open(id);
          return;
        }
        left.add(id);
      }
    })();
  };

  // Files are read a moment after they were chosen, and packages are
  // sent to the plane first: what is shown is the newest choice, and a
  // reading that ends after a newer one began is let go.
  const choosing = useRef(0);
  const takeSources = (files: FileList): void => {
    choosing.current += 1;
    const mine = choosing.current;
    void Promise.all(
      [...files].map(async (file): Promise<ChosenSource> => {
        const text = await file.text();
        const labels = scanSource(text);
        return {
          file: file.name,
          name: file.name.replace(/\.cern\.md$|\.md$/i, ''),
          text,
          type: typeOf(labels),
          uses: labels.head.uses,
          issues: labels.issues.length,
          ticked: true,
        };
      }),
    ).then((read) => {
      if (choosing.current === mine) setSources(read);
    });
  };

  const takePackages = (files: FileList): void => {
    choosing.current += 1;
    const mine = choosing.current;
    setReading(true);
    setTrouble(undefined);
    void Promise.all(
      [...files].map(async (file): Promise<ChosenPackage> => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const digest = await packageDigest(bytes);
        try {
          const held = unwrap(
            await gateway.packageExists({ client: plane, path: { digest } }),
            'the package',
          ).exists;
          if (!held) {
            unwrap(
              await gateway.packagePut({
                client: plane,
                path: { digest },
                body: new Blob([bytes]),
              }),
              'the package',
            );
          }
          const manifest = JSON.parse(await readPackageFile(digest, MANIFEST)) as PackageManifest;
          return { file: file.name, digest, manifest, trouble: undefined, ticked: true };
        } catch (error) {
          return {
            file: file.name,
            digest,
            manifest: undefined,
            trouble: wordsOf(error),
            ticked: false,
          };
        }
      }),
    )
      .then((read) => {
        if (choosing.current === mine) setPackages(read);
      })
      .catch((error: unknown) => {
        if (choosing.current === mine) setTrouble(wordsOf(error));
      })
      .finally(() => {
        if (choosing.current === mine) setReading(false);
      });
  };

  return (
    <>
      <Menu
        align="start"
        trigger={
          <IconButton label="Add an agent">
            <Plus size={17} />
          </IconButton>
        }
      >
        <MenuItem
          picture={<SquarePen size={SIGN} strokeWidth={1.75} />}
          hint="Write its source here"
          onSelect={newAgent}
        >
          New agent
        </MenuItem>
        <MenuItem
          picture={<KindMark kind="registry" size={SIGN} />}
          hint="A published agent, installed as it is"
          onSelect={() => {
            setRegistry(true);
          }}
        >
          From the registry
        </MenuItem>
        <MenuItem
          picture={<FileMark file="source" size={SIGN} />}
          hint="Sources from your computer, one or many"
          onSelect={() => {
            sourceInput.current?.click();
          }}
        >
          From .cern.md files
        </MenuItem>
        <MenuItem
          picture={<FileMark file="package" size={SIGN} />}
          hint="Compiled agents from your computer, one or many"
          onSelect={() => {
            packageInput.current?.click();
          }}
        >
          From .cern packages
        </MenuItem>
      </Menu>
      <input
        ref={sourceInput}
        type="file"
        multiple
        accept=".md,text/markdown"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files !== null && event.target.files.length > 0)
            takeSources(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={packageInput}
        type="file"
        multiple
        accept=".cern"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files !== null && event.target.files.length > 0)
            takePackages(event.target.files);
          event.target.value = '';
        }}
      />
      <SourcesSheet
        sources={sources}
        setSources={setSources}
        fleet={fleet}
        onDone={(first) => {
          open(first);
        }}
      />
      <PackagesSheet
        packages={packages}
        setPackages={setPackages}
        onDone={(first) => {
          askAgain();
          open(first);
        }}
      />
      <RegistrySheet
        open={registry}
        onOpenChange={setRegistry}
        fleet={fleet}
        onInstalled={(agentId, lead) => {
          askAgain();
          if (!lead) return;
          setRegistry(false);
          open(agentId);
        }}
      />
      <Sheet
        open={reading || trouble !== undefined}
        onOpenChange={() => {
          setTrouble(undefined);
        }}
        title={reading ? 'Storing the packages on the plane…' : 'That did not work'}
        width={420}
      >
        {trouble !== undefined ? (
          <ErrorLine>{trouble}</ErrorLine>
        ) : (
          <p className="text-[13px] text-ink-secondary">
            A package is read on the plane, not in the browser.
          </p>
        )}
      </Sheet>
    </>
  );
}
