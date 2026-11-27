// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { TypeWord } from '../../../components/agent-type.js';
import { MarkdownBox } from '../../../components/markdown-box.js';
import type { FileStanding, WaitingFile } from '../../../model/files.js';
import type { Fleet } from '../../../model/fleet.js';
import { entryLead, scanSource, sectionText, typeOf } from '../../../model/source.js';
import type { Scope } from '../../../model/source.js';
import { FileSheet, useFileStandings } from './files.js';
import { Chip } from './grants.js';

// A source is shown in the parts the scan splits it into, in the order
// its file holds them: the agent's labels, the agent's own text, the
// tests' labels and their text, and the notice. The source an agent
// runs is read and written on one page, the editor's, whose rows hold
// fields and whose boxes take typing. What is read alone, the source of
// a generation the agent no longer runs, is the same page with nothing
// to type in, drawn here from the same rows, chips and boxes. The
// agent's own labels and text open the page under no head: they are the
// source's body, and a text stands in its box unnamed, the agent's and
// the tests' alike. A part that follows has its name for a head and no
// more, and a field shows nothing but what it holds.

/** A row of the page: a label's name, and what it holds. */
export function Row({
  name,
  hint,
  children,
}: {
  name: string;
  hint?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="grid grid-cols-1 items-start gap-x-4 gap-y-1 sm:grid-cols-[104px_minmax(0,1fr)]">
      <div className="pt-1.5 text-[13px] text-ink">{name}</div>
      <div className="min-w-0">
        {children}
        {hint !== undefined && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      </div>
    </div>
  );
}

/** The small head of a part of the page, with what the part says of
 * itself beside it where it holds nothing else. */
export function PartHead({ word, children }: { word: string; children?: ReactNode }): ReactNode {
  return (
    <div className="mt-1 border-t pt-3 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
      {word}
      {children !== undefined && (
        <span className="ml-2 font-normal tracking-normal normal-case">{children}</span>
      )}
    </div>
  );
}

/** No file waits for a source that is read alone. */
const NO_FILES: WaitingFile[] = [];

/** A label's entries, each as the chip a writer adds it as: a link
 * where it leads somewhere, and a file's opening its file. */
function Entries({
  entries,
  fleet,
  standingOf,
  onOpen,
}: {
  entries: string[];
  fleet: Fleet;
  standingOf: (entry: string) => FileStanding | undefined;
  onOpen: (entry: string) => void;
}): ReactNode {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5">
      {entries.map((entry) => (
        <Chip
          key={entry}
          entry={entry}
          lead={entryLead(entry, (id) => fleet.byId.has(id))}
          onOpen={
            standingOf(entry) === undefined
              ? undefined
              : () => {
                  onOpen(entry);
                }
          }
        />
      ))}
    </div>
  );
}

/**
 * A source read alone, in its parts. It shows what the source states
 * and no more: a label the source lacks has no row, and a source with
 * no Tests section has no tests part.
 */
export function SourceParts({
  text,
  fleet,
  agentId,
  digest,
}: {
  text: string;
  fleet: Fleet;
  agentId: string;
  /** The package the source is read from, which carries the files it names. */
  digest: string | undefined;
}): ReactNode {
  const labels = useMemo(() => scanSource(text), [text]);
  // The files the source names are the package's own: each is opened from its chip.
  const standings = useFileStandings(text, agentId, NO_FILES, digest);
  const [opened, setOpened] = useState<{ scope: Scope; entry: string } | undefined>(undefined);
  const row = (scope: Scope): Pick<Parameters<typeof Entries>[0], 'standingOf' | 'onOpen'> => ({
    standingOf: (entry) =>
      standings.find((one) => one.named.scope === scope && one.named.entry === entry),
    onOpen: (entry) => {
      setOpened({ scope, entry });
    },
  });
  const agent = useMemo(() => sectionText(text, 'spec'), [text]);
  const tests = useMemo(() => sectionText(text, 'tests'), [text]);
  const type = typeOf(labels);
  const testsUses = labels.tests?.uses ?? [];
  const testsMocks = labels.tests?.mocks ?? [];
  const copyright = [...labels.head.copyright, ...(labels.tests?.copyright ?? [])].join(', ');
  const license = [...labels.head.license, ...(labels.tests?.license ?? [])].join(', ');
  const tested = testsUses.length > 0 || testsMocks.length > 0 || tests.trim() !== '';
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="flex w-full flex-col gap-3 px-6 pt-5 pb-6">
        <Row name="Type">
          <div className="flex h-8 items-center text-[13px] text-ink">
            <TypeWord type={type} size={14} className="gap-2" />
          </div>
        </Row>
        {labels.head.uses.length > 0 && (
          <Row name="Uses">
            <Entries entries={labels.head.uses} fleet={fleet} {...row('spec')} />
          </Row>
        )}
        {labels.head.implements.length > 0 && (
          <Row name="Implements">
            <Entries entries={labels.head.implements} fleet={fleet} {...row('spec')} />
          </Row>
        )}
        {agent.trim() !== '' && (
          <div className="mt-1">
            <MarkdownBox text={agent} label={`What ${agentId} does`} />
          </div>
        )}
        {tested && (
          <>
            <PartHead word="Tests" />
            {testsUses.length > 0 && (
              <Row name="Uses">
                <Entries entries={testsUses} fleet={fleet} {...row('tests')} />
              </Row>
            )}
            {testsMocks.length > 0 && (
              <Row name="Mocks">
                <Entries entries={testsMocks} fleet={fleet} {...row('tests')} />
              </Row>
            )}
            {tests.trim() !== '' && (
              <MarkdownBox text={tests} label={`What the tests of ${agentId} cannot know`} />
            )}
          </>
        )}
        {(copyright !== '' || license !== '') && (
          <>
            <PartHead word="License" />
            <p className="text-[13px] text-ink-secondary">
              {copyright !== '' && <>Copyright {copyright}</>}
              {copyright !== '' && license !== '' && <span className="mx-2 text-ink-muted">·</span>}
              {license !== '' && <span className="mono text-xs">{license}</span>}
            </p>
          </>
        )}
      </div>
      {/* Read alone, a file is read and downloaded: nothing of it is changed from here. */}
      <FileSheet
        line={
          opened === undefined
            ? undefined
            : standings.find(
                (one) => one.named.scope === opened.scope && one.named.entry === opened.entry,
              )
        }
        digest={digest}
        onClose={() => {
          setOpened(undefined);
        }}
      />
    </div>
  );
}
