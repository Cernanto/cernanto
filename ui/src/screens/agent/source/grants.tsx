// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { parsePackageRef } from '@cernanto/package-format/browser';

import { readRegistryPackage, useRegistry } from '../../../api/registry.js';
import { TypeWord } from '../../../components/agent-type.js';
import { KindMark, partyKind, PartyPicture } from '../../../components/party.js';
import type { PartyKind } from '../../../components/party.js';
import { cx } from '../../../components/ui.js';
import type { Fleet } from '../../../model/fleet.js';
import { composing } from '../../../model/keys.js';
import { grantRefusal, listed, newestOf, typedGrantRefusal } from '../../../model/registry.js';
import type { EntryLead } from '../../../model/source.js';
import { ChooseFiles } from './files.js';
import type { Picked } from './files.js';

/** The kinds of entry a grant field offers. An agent is granted by its
 * id wherever it stands: `agent` lists the ones on the plane, and
 * `registry` the ones published, which a deploy installs. */
export type GrantKind = 'agent' | 'registry' | 'npm' | 'mcp' | 'openapi' | 'file';

const KIND_WORDS: Record<GrantKind, string> = {
  agent: 'Agents',
  registry: 'Registry',
  npm: 'npm',
  mcp: 'MCP',
  openapi: 'OpenAPI',
  file: 'File',
};

/** How many of the registry's packages the dropdown lays at once. */
const REGISTRY_SHOWN = 40;

/** The platform's agents a source grants by name, each with what it gives. */
const BUILT_IN: [string, string][] = [
  ['cernanto/llm', 'A language model, for a judgment in words'],
  ['cernanto/decision', 'A typed decision: a class, a number, a yes or no'],
  ['cernanto/search', 'A search of the web'],
  ['cernanto/auth', 'An account logged in to by a person'],
  ['cernanto/webhook', 'A delivery from a provider'],
  ['cernanto/config', 'A setting an operator writes'],
];

/** The kind an entry's spelling says. */
export function entryKind(entry: string): PartyKind {
  return partyKind(entry);
}

/** An entry's short name: an npm package without its range's prefix, a server's host. */
function shortName(entry: string): string {
  if (entry.startsWith('npm:')) return entry.slice(4);
  if (entry.startsWith('mcp:') || entry.startsWith('openapi:')) {
    const rest = entry.slice(entry.indexOf(':') + 1);
    try {
      return /^https?:\/\//.test(rest) ? new URL(rest).host : rest;
    } catch {
      return rest;
    }
  }
  if (entry.startsWith('file:')) return entry.slice(5);
  return entry;
}

/**
 * One entry of a label: the picture of its kind and a short name, with
 * the button that removes it where it can be removed. Where the entry
 * leads somewhere, its picture and name are the link: an agent the
 * plane runs to its own page, on its source, since a reader who follows
 * what a source uses is reading sources; an npm package to its page at
 * npm, in a tab of its own.
 */
export function Chip({
  entry,
  onRemove,
  lead,
  onOpen,
  trouble,
}: {
  entry: string;
  onRemove?: () => void;
  lead?: EntryLead | undefined;
  /** Opens what the entry names where it has no page to lead to: a file. */
  onOpen?: (() => void) | undefined;
  /** What is wrong with the entry, in words: it is marked, and says so under the pointer. */
  trouble?: string | undefined;
}): ReactNode {
  const kind = entryKind(entry);
  const shown = (
    <>
      {kind === 'agent' ? (
        <PartyPicture id={entry} size={20} />
      ) : (
        <KindMark kind={kind} size={20} />
      )}
      <span className={cx('min-w-0 truncate', kind !== 'agent' && 'mono text-xs')}>
        {shortName(entry)}
      </span>
    </>
  );
  // A link is told by the pointer over it, and by nothing drawn under its name.
  const linked = 'flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full';
  return (
    <span
      className={cx(
        'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border bg-surface text-[13px] text-ink',
        trouble === undefined ? 'border-line-strong' : 'border-bad',
        // A circle sits against the chip's round end; a mark that is no circle keeps off it.
        kind === 'agent' ? 'pl-0.5' : 'pl-1.5',
        onRemove === undefined ? 'pr-2.5' : 'pr-1',
      )}
      // An entry that is marked still says which entry it is.
      title={trouble === undefined ? entry : `${entry}: ${trouble}`}
    >
      {onOpen !== undefined ? (
        <button type="button" onClick={onOpen} className={linked}>
          {shown}
        </button>
      ) : lead === undefined ? (
        shown
      ) : 'agent' in lead ? (
        <Link
          to="/agents/$"
          params={{ _splat: lead.agent }}
          search={{ tab: 'source' }}
          className={linked}
        >
          {shown}
        </Link>
      ) : (
        <a href={lead.href} target="_blank" rel="noreferrer noopener" className={linked}>
          {shown}
        </a>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`Remove ${entry}`}
          onClick={onRemove}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover hover:text-ink"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

interface NpmPackage {
  name: string;
  version: string;
  description?: string;
}

/** A search of npm's registry, made by the browser itself: what is
 * typed in this kind goes to npm, as any search of npm does, and
 * nothing of the plane goes with it. */
function useNpmSearch(
  text: string,
  enabled: boolean,
): { packages: NpmPackage[]; searching: boolean } {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    // The search runs 200 milliseconds after the last key.
    const timer = window.setTimeout(() => {
      setSettled(text);
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text]);
  const query = useQuery({
    queryKey: ['npm-search', settled],
    queryFn: async ({ signal }): Promise<NpmPackage[]> => {
      const response = await fetch(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(settled)}&size=10`,
        { signal },
      );
      if (!response.ok) return [];
      const body = (await response.json()) as {
        objects?: { package?: { name?: string; version?: string; description?: string } }[];
      };
      const found: NpmPackage[] = [];
      for (const object of body.objects ?? []) {
        const pack = object.package;
        if (pack?.name === undefined || pack.version === undefined) continue;
        found.push({
          name: pack.name,
          version: pack.version,
          ...(pack.description === undefined ? {} : { description: pack.description }),
        });
      }
      // An exact name first; the registry orders the rest.
      return found.sort((a, b) => Number(b.name === settled) - Number(a.name === settled));
    },
    enabled: enabled && settled.trim().length >= 2,
    staleTime: 60_000,
    retry: false,
  });
  return { packages: query.data ?? [], searching: query.isFetching };
}

interface Option {
  key: string;
  entry: string;
  render: () => ReactNode;
  heading?: string;
  /** A package of the registry the plane does not run: its kind is read from the registry before it is granted. */
  published?: boolean;
  /** Why the label does not take this one, in words; it is listed, and says so when chosen. */
  refused?: string;
}

/**
 * The grant field: one field whose dropdown changes with the kind. It
 * lists the agents that can be granted, searches the registry and npm
 * from the browser, and takes a server's or a document's address as
 * typed.
 */
export function GrantField({
  kinds,
  entries,
  onAdd,
  fleet,
  self,
  only,
  takes = 'an agent',
  label,
  onFiles,
  takesDocument = false,
}: {
  kinds: GrantKind[];
  /** What the label already holds. */
  entries: string[];
  onAdd: (entry: string) => void;
  fleet: Fleet;
  /** The agent being edited, which is not offered to itself. */
  self: string;
  /** The agents alone that may be offered, when the label takes a few. */
  only?: (agentId: string, type: string) => boolean;
  /** What the label takes, for the words that refuse another kind: "an interface". */
  takes?: string;
  /** The field's name, for a reader who does not see the row it stands
   * in. The field itself shows no words of its own: what is written in
   * a box reads as what the box holds. */
  label: string;
  /** Takes files chosen on the computer for the label, where it takes files. */
  onFiles?: ((picked: Picked) => void) | undefined;
  /** The label takes one document chosen on the computer, and no other file. */
  takesDocument?: boolean;
}): ReactNode {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<GrantKind>(kinds[0] ?? 'agent');
  const [at, setAt] = useState(0);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState<string | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // Typing a kind's own word turns to it: `npm:`, `mcp:`, `openapi:`, `file:`.
  const prefixed = /^(npm|mcp|openapi|file):/.exec(text);
  const typedKind = prefixed === null ? undefined : (prefixed[1] as GrantKind);
  const active = typedKind !== undefined && kinds.includes(typedKind) ? typedKind : kind;
  const bare = typedKind === undefined ? text.trim() : text.slice(text.indexOf(':') + 1).trim();
  const npm = useNpmSearch(bare, open && active === 'npm');
  const registry = useRegistry(open && active === 'registry');

  const options = useMemo<Option[]>(() => {
    const out: Option[] = [];
    const held = new Set(entries);
    /** Why an entry typed whole is not granted here, as far as this plane knows what it is. */
    const typedRefusal = (entry: string): string | undefined =>
      typedGrantRefusal(entry, self, (id) => fleet.byId.get(id)?.ls.type, only, takes);
    if (active === 'agent') {
      const wanted = bare.toLowerCase();
      const matches = (id: string): boolean => wanted === '' || id.toLowerCase().includes(wanted);
      const offered = (id: string, type: string): boolean =>
        id !== self && type !== 'worker' && (only === undefined || only(id, type));
      for (const [id, gives] of BUILT_IN) {
        const row = fleet.byId.get(id);
        if (!matches(id) || !offered(id, row?.ls.type ?? 'task')) continue;
        out.push({
          key: `agent:${id}`,
          entry: id,
          heading: 'Of the platform',
          render: () => (
            <>
              <PartyPicture id={id} size={22} />
              <span className="min-w-0 shrink truncate text-ink">{id}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{gives}</span>
              {held.has(id) && <span className="text-xs text-ink-muted">granted</span>}
            </>
          ),
        });
      }
      for (const agent of fleet.agents) {
        if (agent.pair || BUILT_IN.some(([id]) => id === agent.id)) continue;
        if (agent.platform && wanted === '') continue;
        if (!matches(agent.id) || !offered(agent.id, agent.ls.type)) continue;
        out.push({
          key: `agent:${agent.id}`,
          entry: agent.id,
          heading: 'On this plane',
          render: () => (
            <>
              <PartyPicture id={agent.id} size={22} />
              <span className="min-w-0 flex-1 truncate text-ink">{agent.id}</span>
              <TypeWord type={agent.ls.type} className="text-xs text-ink-muted" />
              {held.has(agent.id) && <span className="text-xs text-ink-muted">granted</span>}
            </>
          ),
        });
      }
      if (bare !== '' && !out.some((option) => option.entry === bare)) {
        // What is typed is held to the rules the list above keeps.
        const refused = typedRefusal(bare);
        out.push({
          key: `typed:${bare}`,
          entry: bare,
          heading: 'As typed',
          ...(refused === undefined ? {} : { refused }),
          render: () => (
            <>
              <PartyPicture id={bare} size={22} />
              <span className="min-w-0 flex-1 truncate text-ink">{bare}</span>
              <span className="text-xs text-ink-muted">an agent or a package of the registry</span>
            </>
          ),
        });
      }
      return out;
    }
    if (active === 'registry') {
      const rows = registry.data === undefined ? [] : listed(registry.data, bare);
      for (const row of rows.slice(0, REGISTRY_SHOWN)) {
        if (row.name === self) continue;
        const running = fleet.byId.get(row.name);
        // One the plane runs is held to the plane's own word of its
        // kind, and says so on its line where the label does not take it.
        const refused =
          running === undefined ? undefined : grantRefusal(row.name, running.ls.type, only, takes);
        out.push({
          key: `registry:${row.name}`,
          entry: row.name,
          heading: 'In the registry',
          published: running === undefined,
          ...(refused === undefined ? {} : { refused }),
          render: () => (
            <>
              <PartyPicture id={row.name} size={22} />
              <span className="min-w-0 shrink truncate text-ink">{row.name}</span>
              <span className="figures shrink-0 text-xs text-ink-muted">{row.latest}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                {row.description ?? ''}
              </span>
              {held.has(row.name) ? (
                <span className="shrink-0 text-xs text-ink-muted">granted</span>
              ) : refused !== undefined ? (
                <span className="shrink-0 text-xs text-ink-muted">
                  a {running?.ls.type}, not granted here
                </span>
              ) : running !== undefined ? (
                <span className="shrink-0 text-xs text-ink-muted">on this plane</span>
              ) : null}
            </>
          ),
        });
      }
      // A name typed whole is granted as typed: one the list does not
      // hold, or one with the version wanted after an `@`.
      if (
        bare !== '' &&
        parsePackageRef(bare) !== undefined &&
        !out.some((option) => option.entry === bare)
      ) {
        const refused = typedRefusal(bare);
        out.push({
          key: `typed:registry:${bare}`,
          entry: bare,
          heading: 'As typed',
          published: !fleet.byId.has(parsePackageRef(bare)?.name ?? bare),
          ...(refused === undefined ? {} : { refused }),
          render: () => (
            <>
              <KindMark kind="registry" size={22} />
              <span className="mono min-w-0 flex-1 truncate text-xs text-ink">{bare}</span>
              <span className="text-xs text-ink-muted">
                a name, or a name and the version wanted
              </span>
            </>
          ),
        });
      }
      return out;
    }
    if (active === 'npm') {
      for (const pack of npm.packages) {
        // The guide says to say the major: the range is taken from the newest version.
        const major = pack.version.split('.')[0] ?? '0';
        const entry = `npm:${pack.name}@^${major}`;
        out.push({
          key: entry,
          entry,
          heading: 'On npm',
          render: () => (
            <>
              <KindMark kind="npm" size={22} />
              <span className="mono min-w-0 shrink truncate text-xs text-ink">{pack.name}</span>
              <span className="figures text-xs text-ink-muted">{pack.version}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                {pack.description ?? ''}
              </span>
            </>
          ),
        });
      }
      if (bare !== '') {
        out.push({
          key: `typed:npm:${bare}`,
          entry: `npm:${bare}`,
          heading: 'As typed',
          render: () => (
            <>
              <KindMark kind="npm" size={22} />
              <span className="mono min-w-0 flex-1 truncate text-xs text-ink">npm:{bare}</span>
              <span className="text-xs text-ink-muted">
                for a private registry, or a range of your own
              </span>
            </>
          ),
        });
      }
      return out;
    }
    if (bare !== '') {
      const entry = `${active}:${bare}`;
      const address = active !== 'file' && !/^https?:\/\/\S+$/.test(bare);
      out.push({
        key: entry,
        entry,
        heading: 'As typed',
        render: () => (
          <>
            <KindMark kind={active} size={22} />
            <span className="mono min-w-0 flex-1 truncate text-xs text-ink">{entry}</span>
            <span className="text-xs text-ink-muted">
              {active === 'mcp'
                ? address
                  ? 'a local server, by the command that runs it'
                  : "a server's address"
                : active === 'openapi'
                  ? address
                    ? 'a document of the workspace'
                    : "a document's address"
                  : 'a path from the agent’s own folder'}
            </span>
          </>
        ),
      });
    }
    return out;
  }, [active, bare, entries, fleet, npm.packages, only, registry.data, self, takes]);

  const chosen = Math.min(at, Math.max(0, options.length - 1));
  const add = (entry: string, late = false): void => {
    if (entry === '' || entries.includes(entry)) return;
    onAdd(entry);
    // A package confirmed after the reader went on to another field
    // leaves the keyboard, and this field, as they are.
    if (late && box.current?.contains(document.activeElement) !== true) return;
    setText('');
    setAt(0);
    field.current?.focus();
  };

  /** Grants an option. A package the plane does not run is asked of the
   * registry first, for its kind: a worker is never granted, and a
   * label that takes a few kinds takes those alone. */
  const grant = (option: Option): void => {
    setRefusal(option.refused);
    if (option.refused !== undefined) return;
    if (option.published !== true) {
      add(option.entry);
      return;
    }
    if (entries.includes(option.entry)) return;
    const reference = parsePackageRef(option.entry);
    const name = reference?.name ?? option.entry;
    const range = reference?.range ?? 'latest';
    setChecking(option.entry);
    void readRegistryPackage(name)
      .then((index) => {
        // The kind is read of the version the entry asks for.
        const newest = newestOf(index, range);
        const refused =
          newest === undefined
            ? `The registry holds no version of ${name} ${range === 'latest' || range === '*' ? 'to install' : `that fits ${range}`}.`
            : grantRefusal(name, newest.type, only, takes);
        if (refused === undefined) add(option.entry, true);
        else setRefusal(refused);
      })
      .catch((error: unknown) => {
        setRefusal(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setChecking(undefined);
      });
  };

  // The kind under the keyboard is one whose entry is a file chosen on
  // the computer: the presses that choose it say what the kind takes.
  const chooses =
    onFiles !== undefined && (takesDocument ? active === 'openapi' : active === 'file');

  // What a kind that offers no list takes, said in the dropdown while
  // nothing is typed for it.
  const hints: Record<'mcp' | 'openapi' | 'file', string> = {
    mcp: "A server's address, or the command that runs a local one",
    openapi: "The document's address",
    file: 'A path in the agent’s own folder, such as prompts/judge.md',
  };

  return (
    <div
      ref={box}
      className="relative"
      onBlur={(event) => {
        if (box.current?.contains(event.relatedTarget) !== true) setOpen(false);
      }}
    >
      <input
        ref={field}
        value={text}
        aria-label={label}
        spellCheck={false}
        onFocus={() => {
          setOpen(true);
        }}
        onChange={(event) => {
          setText(event.target.value);
          setAt(0);
          setRefusal(undefined);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          // A key an input method takes while it composes grants nothing.
          if (composing(event)) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setAt(Math.min(chosen + 1, options.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setAt(Math.max(chosen - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const option = options[chosen];
            if (option !== undefined) grant(option);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-8 w-full min-w-0 rounded-md border border-line-strong bg-sunken px-2.5 text-[13px] text-ink focus:border-ink focus:outline-none"
      />
      {open && (
        <div className="sheet absolute top-9 left-0 z-40 max-h-80 w-full min-w-80 overflow-y-auto p-1">
          {kinds.length > 1 && (
            <div className="flex flex-wrap gap-1 border-b px-1 pt-1 pb-2">
              {kinds.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active === name}
                  // A press leaves the keyboard in the field, so the reader goes on
                  // typing; the button acts at its click, a pointer's or a key's alike,
                  // and a key that reached it by the tab key is put back in the field.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    setKind(name);
                    setText('');
                    setAt(0);
                    setRefusal(undefined);
                    field.current?.focus();
                  }}
                  className={cx(
                    'flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px]',
                    active === name
                      ? 'bg-chosen font-semibold text-ink'
                      : 'text-ink-secondary hover:bg-hover',
                  )}
                >
                  {name === 'agent' ? (
                    <PartyPicture id="agents" size={18} />
                  ) : (
                    <KindMark kind={name} size={18} />
                  )}
                  {KIND_WORDS[name]}
                </button>
              ))}
            </div>
          )}
          {/* A file is added by choosing it: a browser reads no path off a disk. */}
          {onFiles !== undefined && chooses && (
            <ChooseFiles
              takesDocument={takesDocument}
              onPicked={(picked) => {
                onFiles(picked);
                setText('');
                setOpen(false);
              }}
            />
          )}
          {active === 'registry' && (
            <div className="px-2 pt-2 text-xs text-ink-muted">
              An agent granted from here is installed from the registry when the source is deployed,
              or at a dry run of its deploy.
            </div>
          )}
          {refusal !== undefined && (
            <div role="alert" className="px-2 pt-2 text-xs text-bad">
              {refusal}
            </div>
          )}
          {options.length === 0 && !chooses && (
            <div className="px-3 py-4 text-center text-xs text-ink-muted">
              {active === 'npm'
                ? npm.searching
                  ? 'Searching npm…'
                  : bare.length < 2
                    ? 'Type a package to search npm for.'
                    : 'npm answered nothing.'
                : active === 'registry'
                  ? registry.isPending
                    ? 'Reading the registry…'
                    : registry.isError
                      ? `${registry.error.message} A name typed whole is granted all the same.`
                      : 'No published agent matches.'
                  : active === 'agent'
                    ? 'No agent to offer.'
                    : hints[active]}
            </div>
          )}
          {options.map((option, index) => (
            <div key={option.key}>
              {option.heading !== undefined && options[index - 1]?.heading !== option.heading && (
                <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                  {option.heading}
                </div>
              )}
              <button
                type="button"
                disabled={checking !== undefined}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  grant(option);
                }}
                onMouseMove={() => {
                  setAt(index);
                }}
                className={cx(
                  'flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px]',
                  index === chosen && 'bg-hover',
                  (entries.includes(option.entry) ||
                    checking === option.entry ||
                    option.refused !== undefined) &&
                    'opacity-55',
                )}
              >
                {option.render()}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
