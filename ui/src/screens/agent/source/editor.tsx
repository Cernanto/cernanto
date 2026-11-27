// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { parsePackageRef } from '@cernanto/package-format/browser';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';

import { readPackageBytes } from '../../../api/queries.js';
import { useRegistry } from '../../../api/registry.js';
import { TypeSign } from '../../../components/agent-type.js';
import { Code } from '../../../components/code.js';
import { FoldHead } from '../../../components/fold-head.js';
import { MarkdownBox } from '../../../components/markdown-box.js';
import { partyKind } from '../../../components/party.js';
import { PlaneMark } from '../../../components/plane.js';
import { Button, cx, Field, Sheet, Tag } from '../../../components/ui.js';
import { useFileView } from '../../../components/view-switch.js';
import {
  entryOf,
  filesTrouble,
  isFileGrantPath,
  MAX_FILE_BYTES,
  nameTrouble,
  offeredPath,
  placeOf,
  withEntryAs,
  withoutEntry,
} from '../../../model/files.js';
import type { FileStanding, WaitingFile } from '../../../model/files.js';
import type { Fleet } from '../../../model/fleet.js';
import { composing } from '../../../model/keys.js';
import { weightWord } from '../../../model/package.js';
import {
  AGENT_TYPES,
  entryLead,
  idRefusal,
  labelEntries,
  lineDiff,
  scanSource,
  sectionText,
  setLabel,
  setSectionText,
  setType,
  typeOf,
  withEntry,
} from '../../../model/source.js';
import type { IdRefusal, LabelName, Scope } from '../../../model/source.js';
import { startCompile, useCompiles, useKeptCompile } from '../../../state/compiles.js';
import type { CompileKind, CompileSwitches } from '../../../state/compiles.js';
import {
  alsoUnder,
  currentDraft,
  draftHeld,
  useDraftKept,
  useDrafts,
} from '../../../state/drafts.js';
import type { Draft, Moved } from '../../../state/drafts.js';
import { drawFileKey, dropBytes, keepBytes } from '../../../state/files.js';
import { copyText } from '../../../state/save.js';
import { gatherUploads } from '../../../state/uploads.js';
import { CompileArea } from './compile.js';
import { carriesFiles, FileSheet, pickedOfDrop, useFileStandings, useLostFiles } from './files.js';
import type { Chosen, Picked } from './files.js';
import { Chip, GrantField } from './grants.js';
import type { GrantKind } from './grants.js';
import { PartHead, Row } from './parts.js';
import { DeployLine, InstalledWords, SourceStrip } from './strip.js';
import { DEPLOY_WAYS, DRY_RUN } from './ways.js';

/** The licenses offered first; any SPDX expression can be typed. */
const LICENSES = ['Apache-2.0', 'MIT', 'BSD-3-Clause', 'MPL-2.0', 'GPL-3.0-only', 'UNLICENSED'];

/** Why a draft cannot stand under the id typed for it, in words. */
const ID_TROUBLE: Record<IdRefusal, string> = {
  invalid:
    'An id is a path of lowercase words and digits, a single dash between two of them, such as payments/recovery. Its last part is never "tests".',
  agent: 'An agent stands under this id on the plane.',
  draft: 'A draft of this browser stands under this id.',
};

/** The six kinds to choose among, each with its sign, its name and the
 * guide's line of when it fits, so that the six are read side by side. */
function TypeMenu({
  type,
  onChoose,
}: {
  type: string;
  onChoose: (type: string) => void;
}): ReactNode {
  const chosen = AGENT_TYPES.some((entry) => entry.type === type) ? type : 'task';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Type: ${chosen}`}
          className="flex h-8 items-center gap-2 rounded-md border border-line-strong bg-sunken pr-1.5 pl-2 text-[13px] text-ink focus:border-ink focus:outline-none data-[state=open]:border-ink"
        >
          <TypeSign type={chosen} size={14} className="text-ink-secondary" />
          <span>{chosen}</span>
          <ChevronDown size={13} className="text-ink-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="sheet z-[60] w-[22rem] max-w-[calc(100vw-2rem)] p-1 text-[13px] text-ink"
        >
          <DropdownMenu.RadioGroup value={chosen} onValueChange={onChoose}>
            {AGENT_TYPES.map((entry) => (
              <DropdownMenu.RadioItem
                key={entry.type}
                value={entry.type}
                className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-chosen text-ink">
                  <TypeSign type={entry.type} size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{entry.type}</span>
                  <span className="text-xs text-ink-muted">{entry.when}</span>
                </span>
                <DropdownMenu.ItemIndicator className="mt-1.5 shrink-0 text-ink-secondary">
                  <Check size={14} aria-label="Chosen" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A label's entries as chips, and after them the field that adds one. */
function Entries({
  entries,
  onChange,
  onAdd,
  kinds,
  fleet,
  self,
  only,
  takes,
  label,
  files,
}: {
  entries: string[];
  /** Takes the entries that are left once one was removed. */
  onChange: (entries: string[]) => void;
  /** Adds one entry. It may be called a while after the entry was
   * chosen, once the registry said what it is. */
  onAdd: (entry: string) => void;
  kinds: GrantKind[];
  fleet: Fleet;
  self: string;
  only?: (agentId: string, type: string) => boolean;
  takes?: string;
  /** The field's name, for a reader who does not see its row. */
  label: string;
  /** The label's files, where it takes files: how each line that names
   * one stands, what opens it, and what takes files chosen for the label. */
  files?: {
    standingOf: (entry: string) => FileStanding | undefined;
    onOpen: (entry: string) => void;
    onPicked: (picked: Picked) => void;
    /** The label takes one document, and no other file. */
    document?: boolean;
    /** Why what was chosen last was not taken, in words. */
    said: string | undefined;
  };
}): ReactNode {
  const [over, setOver] = useState(false);
  return (
    <>
      {/* The field that adds an entry stands in the entries' own row, after
          the last of them, so a label is as tall as it reads; where the row
          leaves it less room than its list needs, it goes under them, and it
          is never wider than the page. Files dropped on the row are the
          label's. */}
      <div
        className={cx(
          'flex flex-wrap items-center gap-1.5 rounded-md',
          over && 'outline-2 outline-offset-4 outline-accent outline-dashed',
        )}
        {...(files === undefined
          ? {}
          : {
              onDragOver: (event: DragEvent<HTMLDivElement>) => {
                if (!carriesFiles(event.dataTransfer)) return;
                event.preventDefault();
                setOver(true);
              },
              onDragLeave: () => {
                setOver(false);
              },
              onDrop: (event: DragEvent<HTMLDivElement>) => {
                if (!carriesFiles(event.dataTransfer)) return;
                event.preventDefault();
                setOver(false);
                void pickedOfDrop(event.dataTransfer).then((all) => {
                  for (const picked of all) files.onPicked(picked);
                });
              },
            })}
      >
        {entries.map((entry) => {
          const standing = files?.standingOf(entry);
          return (
            <Chip
              key={entry}
              entry={entry}
              // Following an entry leaves the page and loses nothing: a draft is kept.
              lead={entryLead(entry, (id) => fleet.byId.has(id))}
              // A file has no page to lead to: its chip opens it.
              onOpen={
                standing === undefined
                  ? undefined
                  : () => {
                      files?.onOpen(entry);
                    }
              }
              trouble={
                standing?.standing === 'missing'
                  ? 'No file is behind this entry: open it to choose its file.'
                  : standing?.standing === 'outside'
                    ? 'This path leaves the workspace.'
                    : undefined
              }
              onRemove={() => {
                onChange(entries.filter((held) => held !== entry));
              }}
            />
          );
        })}
        <div className="min-w-[min(20rem,100%)] flex-1">
          <GrantField
            kinds={kinds}
            entries={entries}
            fleet={fleet}
            self={self}
            label={label}
            {...(only === undefined ? {} : { only })}
            {...(takes === undefined ? {} : { takes })}
            {...(files === undefined
              ? {}
              : { onFiles: files.onPicked, takesDocument: files.document === true })}
            onAdd={onAdd}
          />
        </div>
      </div>
      {files?.said !== undefined && (
        <p role="alert" className="mt-1 text-xs text-bad">
          {files.said}
        </p>
      )}
    </>
  );
}

/** No file waits: one value, so that what reads it is not asked to read again. */
const NO_FILES: WaitingFile[] = [];

/**
 * What the editor says of the agents a source grants that this plane
 * does not run. A deploy installs a published one from the registry by
 * itself, so the line says which of them the registry holds, and names
 * the ones a deploy would refuse: a draft of this browser that was
 * never deployed, and an id nobody published.
 */
function Absent({ ids, drafts }: { ids: string[]; drafts: ReadonlySet<string> }): ReactNode {
  const registry = useRegistry(ids.length > 0);
  if (ids.length === 0) return null;
  const published = new Map((registry.data?.packages ?? []).map((row) => [row.name, row.latest]));
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-ink-muted">
      {ids.map((id) => {
        const latest = published.get(id);
        return (
          <li key={id}>
            <span className="mono text-ink-secondary">{id}</span>{' '}
            {drafts.has(id) ? (
              <span className="text-bad">is a draft of this browser: deploy it first.</span>
            ) : latest !== undefined ? (
              <>
                is not on this plane: a deploy, or a dry run of one, installs it from the registry (
                {latest}).
              </>
            ) : registry.data !== undefined ? (
              <span className="text-bad">
                is not on this plane and the registry holds no package under that name: a deploy
                refuses it.
              </span>
            ) : (
              <>
                is not on this plane: a deploy, or a dry run of one, installs it from the registry,
                where the registry holds it.
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The draft held against the deployed source, line by line: what a
 * person with git reads before a commit, under git's own word for it. */
function DraftDiff({
  open,
  onOpenChange,
  before,
  after,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  before: string;
  after: string;
}): ReactNode {
  const lines = useMemo(() => (open ? lineDiff(before, after) : []), [open, before, after]);
  const changed = lines.some((line) => line.kind !== 'same');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="The draft against the deployed source"
      description={
        changed ? 'What a deploy would change, line by line.' : 'The two are the same text.'
      }
      width={860}
    >
      <pre className="mono overflow-x-auto rounded-md bg-sunken py-2 text-[12.5px] leading-[1.55]">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cx(
              'flex px-3 whitespace-pre-wrap',
              line.kind === 'new' && 'bg-good/15 text-ink',
              line.kind === 'gone' && 'bg-bad/15 text-ink-secondary line-through decoration-bad/50',
              line.kind === 'same' && 'text-ink-muted',
            )}
          >
            <span className="w-4 shrink-0 select-none">
              {line.kind === 'new' ? '+' : line.kind === 'gone' ? '-' : ' '}
            </span>
            <span className="min-w-0 flex-1">{line.text === '' ? ' ' : line.text}</span>
          </div>
        ))}
      </pre>
    </Sheet>
  );
}

/**
 * The page of a source, which is read and written in one place: a
 * source in the parts the scan splits it into, in the order its file
 * holds them, or the whole file as one text. Rendered, the agent's
 * labels stand as fields over the agent's own text, the tests' labels
 * over the tests' text, and the notice last; a field's change rewrites
 * its label's own lines and a text's change its own lines, and no other
 * byte. Raw, the file is one text to write, where a line that is
 * neither a label nor a section's text is seen too. Both are the one
 * `.cern.md`, read again at every change.
 *
 * NOTHING OPENS AN EDIT. The page shows the source an agent runs, and
 * what a reader changes on it is a draft from its first change on: the
 * line under the page comes with the draft, to discard it, to read its
 * diff and to deploy it, and leaves with it. A reader who changes
 * nothing holds no draft and sees no such line. What a deploy would do,
 * asked and not done, is the cli's dry run, and stands among the ways
 * to deploy under the button's own menu.
 */
export function SourceEditor({
  draft,
  held,
  deployed,
  installed,
  fleet,
  onChange,
  onRename,
  onDiscard,
  onRebase,
  onBegin,
  unchecked = false,
}: {
  /** What the page shows: the draft the browser holds, or the source the
   * agent runs, as the draft a first change would make of it. */
  draft: Draft;
  /** Whether the browser holds a draft: something was changed, or the agent is new. */
  held: boolean;
  /** The source the plane runs, and its package; none for an agent never deployed. */
  deployed: { text: string; digest: string } | undefined;
  /** The registry's package the agent was installed from, where it was. */
  installed?: { version?: string | undefined; publisher?: string | undefined } | undefined;
  fleet: Fleet;
  /** Takes the source as it was changed, and with it the files that
   * wait for the deploy where the change is of them; without, they
   * stay as they are. */
  onChange: (text: string, files?: WaitingFile[]) => void;
  /** Gives the draft of a new agent another id, and answers how that
   * came out; absent for a draft opened on a deployed agent, since an
   * id is a path. */
  onRename?: (to: string) => Promise<Moved>;
  onDiscard: () => void;
  /** Takes the source the plane runs now for the draft's ground, once the reader saw it moved. */
  onRebase: () => void;
  /** Hears a deploy begin, or a dry run of one, before it is sent. */
  onBegin?: () => void;
  /** The plane's listing could not be read, so whether an agent stands
   * under the draft's id is not known: the draft is written on, and a
   * plan and a deploy wait for a listing that was read. */
  unchecked?: boolean;
}): ReactNode {
  const compiles = useCompiles();
  const run = compiles.get(draft.id);
  const [diffing, setDiffing] = useState(false);
  const [line, setLine] = useState<number | undefined>(undefined);
  const [view, setView] = useFileView('source.view');
  // A line of the file is one of the whole file's: it is shown where the
  // file stands as one text, with its own numbers.
  const showLine = (at: number | undefined): void => {
    setLine(at);
    if (at !== undefined) setView('raw');
  };
  const [id, setId] = useState(draft.id);
  // The id a move to which was refused where it read as sound and free,
  // and why: the browser did not keep the draft under it, or another
  // window took it for a draft at that moment.
  const [unmoved, setUnmoved] = useState<{ id: string; why: 'unkept' | 'taken' } | undefined>(
    undefined,
  );
  const text = draft.text;
  const labels = useMemo(() => scanSource(text), [text]);
  const agentText = useMemo(() => sectionText(text, 'spec'), [text]);
  const testsText = useMemo(() => sectionText(text, 'tests'), [text]);
  const type = typeOf(labels);
  const isNew = deployed === undefined;
  const changed = isNew || text !== deployed.text;
  // A draft stands on the package it was opened on. Where the agent runs
  // another, the deployed source moved under the draft, and a deploy
  // waits for the reader to have seen it. A draft of a new agent was
  // opened on none: an agent deployed under its id since is not its own.
  const behind = !isNew && draft.base !== deployed.digest;
  const collides = !isNew && draft.base === undefined;
  // A compile of this agent is under way while this window follows one,
  // and while the browser keeps one at all: one that another window
  // started, or that this window stopped reading, still runs, and a
  // second one beside it waits for its end.
  const kept = useKeptCompile(draft.id);
  const followed = run !== undefined && run.endedAt === undefined;
  const compiling = followed || kept;
  const { drafts, save } = useDrafts();
  const stored = useDraftKept(draft.id);
  // The id this draft had, where it was given the one it has on a page
  // the browser offers no lock: it stands under both until the reader
  // discards the one under the old id.
  const had = alsoUnder(draft.id);
  const twin = had !== undefined && draftHeld(drafts, had) ? had : undefined;
  // A new agent's draft whose id an agent already stands under, by any
  // reading of the plane this window holds: it is not deployed as new.
  const taken = isNew && fleet.occupied(draft.id);
  const refusal = idRefusal(id, {
    agent: (held) => (held === draft.id ? collides || taken : fleet.occupied(held)),
    draft: (held) => held !== draft.id && draftHeld(drafts, held),
  });
  const idTrouble = refusal === undefined ? undefined : ID_TROUBLE[refusal];

  // THE FILES THE SOURCE NAMES. Each line that names one stands with the
  // files chosen for it in this browser, which wait for the deploy, or
  // with the ones the package the agent runs carries; a line with
  // neither holds the deploy, said in words under the page.
  const waiting = draft.files ?? NO_FILES;
  const lost = useLostFiles(waiting);
  const atHand = useMemo(
    () => (lost.size === 0 ? waiting : waiting.filter((file) => !lost.has(file.key))),
    [waiting, lost],
  );
  const standings = useFileStandings(text, draft.id, atHand, isNew ? undefined : deployed.digest);
  const filesWait =
    lost.size > 0
      ? `${lost.size === 1 ? 'A file' : `${String(lost.size)} files`} chosen for this draft ${lost.size === 1 ? 'is' : 'are'} no longer kept by this browser: choose ${lost.size === 1 ? 'it' : 'them'} again. Deploy waits.`
      : filesTrouble(standings);
  const [opened, setOpened] = useState<{ scope: Scope; entry: string } | undefined>(undefined);
  const openLine =
    opened === undefined
      ? undefined
      : standings.find(
          (one) => one.named.scope === opened.scope && one.named.entry === opened.entry,
        );
  // Why what was chosen last for a label was not taken, at that label.
  const [said, setSaid] = useState<{ at: string; words: string } | undefined>(undefined);

  /** The waiting files of the lines some entries were: they wait no more once the entries go. */
  const waitedFor = (scope: Scope, entries: readonly string[]): WaitingFile[] =>
    waiting.filter(
      (file) =>
        file.scope === scope &&
        entries.some(
          (entry) =>
            /^(file|openapi):/.test(entry) && entry.slice(entry.indexOf(':') + 1) === file.written,
        ),
    );
  const write = (scope: Scope, name: LabelName, entries: string[]): void => {
    const gone = waitedFor(
      scope,
      labelEntries(text, scope, name).filter((entry) => !entries.includes(entry)),
    );
    onChange(
      setLabel(text, scope, name, entries),
      gone.length === 0 ? undefined : waiting.filter((file) => !gone.includes(file)),
    );
    if (gone.length > 0) void dropBytes(gone.map((file) => file.key));
  };

  /**
   * Takes files chosen on the computer for lines of a label: their
   * bytes are kept by the browser, the lines are written into the
   * source, and what waited for the same lines before waits no more.
   */
  const takeLines = async (
    scope: Scope,
    label: 'Uses' | 'Implements',
    lines: { written: string; files: Chosen[] }[],
  ): Promise<void> => {
    const fresh: WaitingFile[] = [];
    for (const line of lines) {
      for (const one of line.files) {
        const key = drawFileKey();
        await keepBytes(key, one.file);
        fresh.push({
          key,
          scope,
          written: line.written,
          rel: one.rel,
          name: one.file.name,
          size: one.file.size,
          type: one.file.type,
        });
      }
    }
    // The source and its files as the browser holds them now: the bytes
    // took a moment to keep, and what was written meanwhile stays.
    const now = currentDraft(draft.id);
    let next = now?.text ?? text;
    const stood = now?.files ?? waiting;
    const replaced = new Set(lines.map((line) => line.written));
    for (const line of lines) {
      const entry = entryOf(label, line.written);
      // An agent implements one document: another takes the place of the one named.
      const document =
        label === 'Implements'
          ? labelEntries(next, scope, label).find((held) => held.startsWith('openapi:'))
          : undefined;
      if (document !== undefined && document !== entry) {
        replaced.add(document.slice('openapi:'.length));
        next = withEntryAs(next, scope, label, document, entry);
      } else {
        next = withEntry(next, scope, label, entry);
      }
    }
    const gone = stood.filter((file) => file.scope === scope && replaced.has(file.written));
    onChange(next, [...stood.filter((file) => !gone.includes(file)), ...fresh]);
    void dropBytes(gone.map((file) => file.key));
  };
  /** Why some chosen files cannot be taken, in words; none where they can. */
  const refusalOf = (names: string[], files: Chosen[]): string | undefined => {
    const named = names.map(nameTrouble).find((words) => words !== undefined);
    if (named !== undefined) return named;
    const heavy = files.find((one) => one.file.size > MAX_FILE_BYTES);
    return heavy === undefined
      ? undefined
      : `${heavy.file.name} weighs ${weightWord(heavy.file.size)}: a deploy takes a file of ${weightWord(MAX_FILE_BYTES)} at most.`;
  };
  /** Files chosen for a label: each a line of its own, in the agent's own
   * folder under its name; a folder chosen whole is one line. */
  const addPicked = (scope: Scope, label: 'Uses' | 'Implements', picked: Picked): void => {
    const at = `${scope}:${label}`;
    const whole = picked.folder !== undefined && label === 'Uses' ? picked.folder : undefined;
    const files = label === 'Implements' ? picked.files.slice(0, 1) : picked.files;
    if (files.length === 0) {
      setSaid({ at, words: 'The folder holds no file.' });
      return;
    }
    const refused = refusalOf(
      whole === undefined ? files.map((one) => one.file.name) : [whole],
      files,
    );
    if (refused !== undefined) {
      setSaid({ at, words: refused });
      return;
    }
    setSaid(undefined);
    void takeLines(
      scope,
      label,
      whole === undefined
        ? files.map((one) => ({
            written: offeredPath(draft.id, one.file.name),
            files: [{ rel: '', file: one.file }],
          }))
        : [{ written: offeredPath(draft.id, whole, true), files }],
    );
  };
  /** Other files for a line that stands: the line as it is written, its files as they were chosen. */
  const replaceLine = (line: FileStanding, picked: Picked): void => {
    const { scope, label, written } = line.named;
    const whole = picked.folder !== undefined;
    const files = whole
      ? picked.files
      : picked.files.slice(0, 1).map((one) => ({ rel: '', file: one.file }));
    const refused = files.length === 0 ? 'The folder holds no file.' : refusalOf([], files);
    if (refused !== undefined) {
      setSaid({ at: `${scope}:${label}`, words: refused });
      return;
    }
    setSaid(undefined);
    void takeLines(scope, label, [{ written, files }]);
  };
  const removeLine = (line: FileStanding): void => {
    const { scope, label, entry } = line.named;
    const gone = waitedFor(scope, [entry]);
    onChange(
      withoutEntry(text, scope, label, entry),
      gone.length === 0 ? undefined : waiting.filter((file) => !gone.includes(file)),
    );
    if (gone.length > 0) void dropBytes(gone.map((file) => file.key));
    setOpened(undefined);
  };
  /** Gives a line another path, and answers in words why it cannot have it. */
  const moveLine = (line: FileStanding, to: string): string | undefined => {
    const { scope, label, entry, written } = line.named;
    if (to === written) return undefined;
    if (!isFileGrantPath(to)) return 'This is no path a source can name a file by.';
    if (placeOf(draft.id, to) === undefined) return 'This path leaves the workspace.';
    const next = entryOf(label, to);
    if (labelEntries(text, scope, label).includes(next))
      return 'The source names this path already.';
    const mine = waiting.filter((file) => file.scope === scope && file.written === written);
    const lastOf = (path: string): string => path.replace(/\/+$/, '').split('/').at(-1) ?? '';
    if (mine.length > 0 || line.standing !== 'carried' || lastOf(to) === lastOf(written)) {
      // A file that waits goes with its line, and one the package carries
      // is found again wherever a line names it by the same name.
      onChange(
        withEntryAs(text, scope, label, entry, next),
        mine.length === 0
          ? undefined
          : waiting.map((file) => (mine.includes(file) ? { ...file, written: to } : file)),
      );
    } else if (deployed !== undefined) {
      // Under another name the package's file is not found again: its
      // bytes are taken to wait under the new one.
      const from = deployed.digest;
      void (async () => {
        const fresh: WaitingFile[] = [];
        for (const file of line.files) {
          if (!('carried' in file.from)) continue;
          const bytes = await readPackageBytes(from, file.from.carried);
          const key = drawFileKey();
          await keepBytes(key, bytes);
          fresh.push({
            key,
            scope,
            written: to,
            rel: file.rel,
            name: file.name,
            size: file.size,
            type: bytes.type,
          });
        }
        const now = currentDraft(draft.id);
        onChange(withEntryAs(now?.text ?? text, scope, label, entry, next), [
          ...(now?.files ?? waiting),
          ...fresh,
        ]);
      })();
    }
    setOpened({ scope, entry: next });
    return undefined;
  };
  /** What a label's row is handed for its files. */
  const filesOf = (
    scope: Scope,
    label: 'Uses' | 'Implements',
  ): NonNullable<Parameters<typeof Entries>[0]['files']> => ({
    standingOf: (entry) =>
      standings.find((one) => one.named.scope === scope && one.named.entry === entry),
    onOpen: (entry) => {
      setOpened({ scope, entry });
    },
    onPicked: (picked) => {
      addPicked(scope, label, picked);
    },
    document: label === 'Implements',
    said: said?.at === `${scope}:${label}` ? said.words : undefined,
  });
  // An entry may be confirmed a while after it was chosen, the registry
  // asked first for what it is. So it is added to the source as the
  // browser holds it at that moment: what was written meanwhile stays.
  // Where the browser holds no draft, the entry is the first change of
  // the source the agent runs; a new agent's draft that was discarded
  // meanwhile is not brought back.
  const addEntry = (scope: Scope, name: LabelName, entry: string): void => {
    const now = currentDraft(draft.id);
    const stood = now?.text ?? deployed?.text;
    if (stood === undefined) return;
    const next = withEntry(stood, scope, name, entry);
    if (next === stood) return;
    const updatedAt = new Date().toISOString();
    if (now !== undefined) save({ ...now, text: next, updatedAt });
    else if (deployed !== undefined) {
      save({
        id: draft.id,
        text: next,
        base: deployed.digest,
        baseText: deployed.text,
        updatedAt,
      });
    }
  };
  const begin = (kind: CompileKind, switches: CompileSwitches = {}): void => {
    onBegin?.();
    const base = isNew ? undefined : deployed.digest;
    startCompile({
      agentId: draft.id,
      text,
      base,
      kind,
      switches,
      // The source goes up with every file it names.
      uploads: () => gatherUploads({ agentId: draft.id, text, waiting: atHand, base }),
    });
  };
  const headUses = labels.head.uses.filter((entry) => !/^(npm|mcp|openapi|file):/.test(entry));
  // The agents a label grants that this plane does not run, by their
  // ids: an entry may carry the version wanted after an `@`.
  const draftIds = useMemo(
    () => new Set(Object.keys(drafts).filter((held) => held !== draft.id)),
    [drafts, draft.id],
  );
  const absent = (entries: string[]): string[] =>
    entries
      .filter((entry) => partyKind(entry) === 'agent')
      .map((entry) => parsePackageRef(entry)?.name ?? entry)
      .filter((agentId) => agentId !== draft.id && !fleet.byId.has(agentId));
  // The id typed becomes the draft's when its field is left, or at Enter.
  // The move is answered a moment later; until then, and after a move
  // that was refused, the field shows an id that is not the draft's, and
  // a plan and a deploy wait.
  // One move is asked at a time: Enter and then leaving the field ask it once.
  const moving = useRef(false);
  const keepId = (): void => {
    if (onRename === undefined || id === draft.id || idTrouble !== undefined) return;
    if (moving.current) return;
    moving.current = true;
    const asked = id;
    void onRename(asked)
      .then((moved) => {
        if (moved === 'unkept' || moved === 'taken') setUnmoved({ id: asked, why: moved });
      })
      .finally(() => {
        moving.current = false;
      });
  };
  // A plan and a deploy send the draft under the id the browser keeps it
  // under. While the Id field shows another, one being typed, one that
  // is refused or one the browser did not keep the draft under, a press
  // would send it under an id the reader does not see: they wait until
  // the field shows the draft's own.
  const idApart = onRename !== undefined && id !== draft.id;
  const blocked =
    compiling ||
    unchecked ||
    idApart ||
    (isNew && idTrouble !== undefined) ||
    behind ||
    filesWait !== undefined ||
    text.trim() === '';
  // The tests' part and the notice's open and close at their heads. Each
  // stands open where the source says something of it when the editor
  // opens, and closed where it says nothing, as most sources do: their
  // tests come from their sentences. The writer's press decides from
  // there on, and hides or shows a part without changing the source;
  // only something that comes to stand in a closed part opens it, so
  // what a source holds is not hidden unless the writer hid it.
  const testsHeld =
    (labels.tests?.uses.length ?? 0) + (labels.tests?.mocks.length ?? 0) > 0 ||
    testsText.trim() !== '';
  const [testsOpen, setTestsOpen] = useState(testsHeld);
  const [testsStood, setTestsStood] = useState(testsHeld);
  if (testsHeld !== testsStood) {
    setTestsStood(testsHeld);
    if (testsHeld) setTestsOpen(true);
  }
  const copyright = [...labels.head.copyright, ...(labels.tests?.copyright ?? [])].join(', ');
  const license = [...labels.head.license, ...(labels.tests?.license ?? [])].join(', ');
  const noticeHeld = copyright !== '' || license !== '';
  const [noticeOpen, setNoticeOpen] = useState(noticeHeld);
  const [noticeStood, setNoticeStood] = useState(noticeHeld);
  if (noticeHeld !== noticeStood) {
    setNoticeStood(noticeHeld);
    if (noticeHeld) setNoticeOpen(true);
  }

  const problems = labels.issues.length > 0 && (
    <ul className="flex flex-col gap-1 rounded-md border border-bad/50 p-2.5">
      {labels.issues.map((issue, index) => (
        <li key={index}>
          <button
            type="button"
            className="text-left text-[13px] text-bad hover:underline"
            onClick={() => {
              showLine(issue.line);
            }}
          >
            {issue.line !== undefined && (
              <span className="figures mr-2 text-xs">line {issue.line}</span>
            )}
            {issue.message}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The strip says where the source comes from, never whether it was
          changed: a first change moves nothing in it, and the line under
          the page says a draft is held. What is copied and saved from it
          is the text as it stands here. */}
      <SourceStrip
        agentId={draft.id}
        view={view}
        onView={setView}
        text={text}
        actions={!isNew && installed === undefined && <DeployLine agentId={draft.id} />}
      >
        {installed !== undefined && <InstalledWords installed={installed} />}
      </SourceStrip>
      {view === 'raw' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {problems !== false && <div className="shrink-0 border-b px-5 py-2.5">{problems}</div>}
          <div className="min-h-0 flex-1">
            <Code
              text={text}
              language="markdown"
              wrap
              labels
              line={line}
              label={`The source of ${draft.id}`}
              onChange={onChange}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex w-full flex-col gap-3 px-6 pt-5 pb-5">
            {/* An id is a field while it can still be given: for the draft of a
                new agent. An agent that exists is named in the screen's head
                and in the file's name over this page, and its id is a path. */}
            {onRename !== undefined && (
              <Row
                name="Id"
                // The line under the field says what keeps the id typed from
                // the draft, and nothing while nothing does.
                hint={
                  idTrouble !== undefined ? (
                    <span className="text-bad">{idTrouble}</span>
                  ) : unmoved?.id === id ? (
                    <span className="text-bad">
                      {unmoved.why === 'unkept'
                        ? 'This browser did not keep the draft under this id: its storage is full.'
                        : 'Another window took this id for a draft at the same moment.'}{' '}
                      The draft stays under <span className="mono">{draft.id}</span>.{' '}
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => {
                          setId(draft.id);
                          setUnmoved(undefined);
                        }}
                      >
                        Go on with that id
                      </button>
                    </span>
                  ) : undefined
                }
              >
                <Field
                  value={id}
                  aria-label="Id"
                  className="mono"
                  onChange={(event) => {
                    setId(event.target.value);
                    setUnmoved(undefined);
                  }}
                  onBlur={keepId}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !composing(event)) keepId();
                  }}
                />
              </Row>
            )}
            <Row name="Type">
              <TypeMenu
                type={type}
                onChoose={(chosen) => {
                  onChange(setType(text, chosen));
                }}
              />
            </Row>
            <Row name="Uses">
              <Entries
                entries={labels.head.uses}
                kinds={['agent', 'registry', 'npm', 'mcp', 'openapi', 'file']}
                fleet={fleet}
                self={draft.id}
                label="Add what it works with"
                files={filesOf('spec', 'Uses')}
                onChange={(entries) => {
                  write('spec', 'Uses', entries);
                }}
                onAdd={(entry) => {
                  addEntry('spec', 'Uses', entry);
                }}
              />
              <Absent ids={absent(labels.head.uses)} drafts={draftIds} />
            </Row>
            <Row name="Implements">
              <Entries
                entries={labels.head.implements}
                kinds={['agent', 'registry', 'openapi']}
                fleet={fleet}
                self={draft.id}
                only={(_id, kind) => kind === 'interface'}
                takes="an interface"
                label="Add an interface or an OpenAPI document"
                files={filesOf('spec', 'Implements')}
                onChange={(entries) => {
                  write('spec', 'Implements', entries);
                }}
                onAdd={(entry) => {
                  addEntry('spec', 'Implements', entry);
                }}
              />
              <Absent ids={absent(labels.head.implements)} drafts={draftIds} />
            </Row>
            {problems}
            <div className="mt-1">
              <MarkdownBox
                text={agentText}
                label={`What ${draft.id} does`}
                // A text that is being written from nothing is given room to be.
                rows={isNew ? 8 : 4}
                onChange={(written) => {
                  onChange(setSectionText(text, 'spec', written));
                }}
              />
            </div>
            {type === 'worker' ? (
              <PartHead word="Tests">A worker that never ends carries no tests.</PartHead>
            ) : (
              <FoldHead
                word="Tests"
                open={testsOpen}
                onToggle={() => {
                  setTestsOpen(!testsOpen);
                }}
              />
            )}
            {type !== 'worker' && testsOpen && (
              <>
                <Row name="Uses">
                  <Entries
                    entries={labels.tests?.uses ?? []}
                    kinds={['agent', 'registry', 'npm', 'mcp', 'openapi', 'file']}
                    fleet={fleet}
                    self={draft.id}
                    label="Add a tool only the tests use"
                    files={filesOf('tests', 'Uses')}
                    onChange={(entries) => {
                      write('tests', 'Uses', entries);
                    }}
                    onAdd={(entry) => {
                      addEntry('tests', 'Uses', entry);
                    }}
                  />
                  <Absent ids={absent(labels.tests?.uses ?? [])} drafts={draftIds} />
                </Row>
                <Row name="Mocks">
                  <Entries
                    entries={labels.tests?.mocks ?? []}
                    kinds={['agent']}
                    fleet={fleet}
                    self={draft.id}
                    only={(agentId) => headUses.includes(agentId)}
                    takes="an agent this source uses"
                    label="Add an agent the tests replace"
                    onChange={(entries) => {
                      write('tests', 'Mocks', entries);
                    }}
                    onAdd={(entry) => {
                      addEntry('tests', 'Mocks', entry);
                    }}
                  />
                </Row>
                <MarkdownBox
                  text={testsText}
                  label={`What the tests of ${draft.id} cannot know`}
                  rows={3}
                  onChange={(written) => {
                    onChange(setSectionText(text, 'tests', written));
                  }}
                />
              </>
            )}
            <FoldHead
              word="License"
              open={noticeOpen}
              onToggle={() => {
                setNoticeOpen(!noticeOpen);
              }}
            />
            {noticeOpen && (
              <>
                <Row name="Copyright">
                  <Field
                    value={copyright}
                    aria-label="Copyright"
                    onChange={(event) => {
                      write(
                        'spec',
                        'Copyright',
                        event.target.value === '' ? [] : [event.target.value],
                      );
                    }}
                  />
                </Row>
                <Row name="License">
                  <Field
                    value={license}
                    aria-label="License"
                    list="spdx-licenses"
                    onChange={(event) => {
                      write(
                        'spec',
                        'License',
                        event.target.value === '' ? [] : [event.target.value],
                      );
                    }}
                  />
                  <datalist id="spdx-licenses">
                    {LICENSES.map((offered) => (
                      <option key={offered} value={offered} />
                    ))}
                  </datalist>
                </Row>
              </>
            )}
          </div>
        </div>
      )}
      {behind && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-sunken px-5 py-2 text-[13px] text-ink">
          <span className="min-w-0 flex-1">
            {collides
              ? "An agent was deployed under this id after this draft was written. A deploy of the draft would replace that agent's source: give the draft another id, or read the diff of the two first."
              : 'This agent was deployed again since the draft was opened. A deploy of the draft would replace that change.'}
          </span>
          <Button
            small
            onClick={() => {
              setDiffing(true);
            }}
          >
            Diff against it
          </Button>
          <Button small look="quiet" onClick={onRebase}>
            I have seen it: deploy over it
          </Button>
        </div>
      )}
      {twin !== undefined && (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-sunken px-5 py-2 text-[13px] text-ink"
        >
          <span className="min-w-0 flex-1">
            This draft is also kept under <span className="mono">{twin}</span>, the id it had. This
            page is not served securely, so the browser cannot hold an id for one window alone, and
            a draft that takes another id is not removed from its old one. Look at that one on its
            own screen, and discard it there.
          </span>
          <Link
            to="/agents/$"
            params={{ _splat: twin }}
            className="shrink-0 underline underline-offset-2"
          >
            Open {twin}
          </Link>
        </div>
      )}
      {held && !stored && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-sunken px-5 py-2 text-[13px] text-ink"
        >
          <span className="min-w-0 flex-1">
            This browser did not keep the draft: its storage is full, or closed to this page. What
            is written here lasts only while this window stays open.
          </span>
          <Button
            small
            onClick={() => {
              void copyText(text);
            }}
          >
            Copy the source
          </Button>
        </div>
      )}
      {/* What a deploy of a change does to an installed package is said
          where the change is made, by the line that deploys it. */}
      {held && !isNew && installed !== undefined && (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-sunken px-5 py-2 text-[13px] text-ink"
        >
          <span className="min-w-0 flex-1">
            This agent is installed from the registry. A deploy of the draft makes it an agent
            deployed here from its source: a newer version of the registry no longer installs over
            it.
          </span>
        </div>
      )}
      {/* The line of a draft: it comes with the first change and leaves with the last. */}
      {held && (
        <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-t bg-surface px-5 py-2">
          <Tag>Draft</Tag>
          <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
            {kept && !followed
              ? 'A compile of this agent is under way and is not followed in this window: Deploy waits for its end.'
              : unchecked
                ? "The plane's agents could not be read: Deploy waits."
                : idApart
                  ? `The draft is kept under ${draft.id}, not under the id in its field: Deploy waits.`
                  : taken
                    ? 'An agent stands under this id on the plane: Deploy waits.'
                    : filesWait !== undefined
                      ? filesWait
                      : isNew
                        ? 'Not deployed. Nothing of a draft is on the plane, and it is kept in this browser alone.'
                        : collides
                          ? 'Written as a new agent, not as this one.'
                          : changed
                            ? 'Changed since the deployed source. The agent goes on serving its deployed source.'
                            : waiting.length > 0
                              ? 'The same text as the deployed source, with files chosen here that go up with the deploy.'
                              : 'The same text as the deployed source.'}
          </span>
          <Button look="quiet" small onClick={onDiscard}>
            {isNew || collides ? 'Discard the draft' : 'Discard changes'}
          </Button>
          {!isNew && (
            <Button
              small
              disabled={!changed}
              onClick={() => {
                setDiffing(true);
              }}
            >
              Diff
            </Button>
          )}
          <div className="flex items-stretch">
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                begin('deploy');
              }}
              className="flex h-7 items-center gap-1.5 rounded-l-md bg-accent px-3 text-xs font-semibold text-on-accent hover:brightness-105 disabled:opacity-50"
            >
              Deploy
              <PlaneMark />
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  disabled={blocked}
                  aria-label="More ways to deploy"
                  className="flex h-7 w-6 items-center justify-center rounded-r-md border-l border-on-accent/25 bg-accent text-on-accent hover:brightness-105 disabled:opacity-50"
                >
                  <ChevronDown size={13} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  side="top"
                  sideOffset={6}
                  className="sheet z-[60] w-80 p-1 text-[13px] text-ink"
                >
                  {DEPLOY_WAYS.map((way) => (
                    <DropdownMenu.Item
                      key={way.word}
                      onSelect={() => {
                        begin(way.kind, way.switches);
                      }}
                      className="flex cursor-pointer flex-col rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
                    >
                      <span>{way.word}</span>
                      <span className="text-xs text-ink-muted">{way.hint}</span>
                    </DropdownMenu.Item>
                  ))}
                  {/* Not a way to deploy: what a deploy would do, asked and not done. */}
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  <DropdownMenu.Item
                    title={DRY_RUN.more}
                    onSelect={() => {
                      begin('plan');
                    }}
                    className="flex cursor-pointer flex-col rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
                  >
                    <span>{DRY_RUN.word}</span>
                    <span className="text-xs text-ink-muted">{DRY_RUN.hint}</span>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      )}
      {run !== undefined && <CompileArea run={run} onLine={showLine} />}
      {!isNew && (
        <DraftDiff open={diffing} onOpenChange={setDiffing} before={deployed.text} after={text} />
      )}
      <FileSheet
        line={openLine}
        digest={isNew ? undefined : deployed.digest}
        onClose={() => {
          setOpened(undefined);
        }}
        {...(openLine === undefined
          ? {}
          : {
              onReplace: (picked: Picked) => {
                replaceLine(openLine, picked);
              },
              onRemove: () => {
                removeLine(openLine);
              },
              onMove: (written: string) => moveLine(openLine, written),
            })}
      />
    </div>
  );
}
