// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Terminal } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { patched, TESTS_FOLDER } from '../../../app/search.js';
import type { AgentSearch, Patch } from '../../../app/search.js';
import { wordsOf } from '../../../api/plane.js';
import { usePackageFile } from '../../../api/queries.js';
import { AssistantWord } from '../../../components/assistant.js';
import { Code, languageOfFile } from '../../../components/code.js';
import { cx, IconButton, Moment, Quiet } from '../../../components/ui.js';
import type { FleetAgent } from '../../../model/fleet.js';
import {
  codeWord,
  CONTRACT,
  fileAsked,
  filesUnder,
  MODIFIED_WORDS,
  packageOf,
  useGenerationGone,
  useGenerations,
  usePackage,
  weightWord,
} from '../../../model/package.js';
import { factMoment } from '../../../model/time.js';
import { useClock } from '../../../state/prefs.js';
import { copyText } from '../../../state/save.js';
import { FileBar } from './file-bar.js';
import { GenerationChoice, GenerationGone } from './generation.js';

const route = getRouteApi('/agents/$');

/** The folder of a package's code. */
const CODE_FOLDER = 'code/';

/** A file past this weight is shown to this point, and says so. */
const SHOWN_BYTES = 1024 * 1024;

/** A file's name as its part of the list writes it, without the part's folder. */
function shortName(name: string): string {
  for (const folder of [CODE_FOLDER, TESTS_FOLDER]) {
    if (name.startsWith(folder)) return name.slice(folder.length) || name;
  }
  return name;
}

/** The Compiled tab: what the compile wrote for the agent, to read, its
 * code and its tests in one list of files under a heading each. What a
 * person changes is the source, and the coding assistant writes the
 * code and the tests from it. The tab is named by what it holds beside
 * the source: a source is the code a person writes in this language,
 * and this is what was compiled from it. */
export function CodeTab({ agent }: { agent: FleetAgent }): ReactNode {
  const search = route.useSearch();
  const navigate = useNavigate();
  const [clock] = useClock();
  const generations = useGenerations(agent.id);
  const gone = useGenerationGone(agent.id, search.gen);
  const digest = packageOf(agent, generations, search.gen);
  const pack = usePackage(digest);
  const parts = useMemo(() => {
    const code = filesUnder(pack.manifest, CODE_FOLDER);
    return [
      // An interface has no body: it shows its contract alone.
      { title: 'Code', files: code.length === 0 ? [CONTRACT] : code },
      { title: 'Tests', files: filesUnder(pack.manifest, TESTS_FOLDER) },
    ];
  }, [pack.manifest]);
  const files = useMemo(() => parts.flatMap((part) => part.files), [parts]);
  const chosen = fileAsked(files, search.file);
  const file = usePackageFile(digest, chosen);
  const generation =
    search.gen === undefined
      ? (generations.find((entry) => entry.status === 'active') ?? generations[0])
      : generations.find((entry) => entry.gen === search.gen);

  const go = (next: Patch<AgentSearch>): void => {
    void navigate({ to: '.', search: (previous) => patched(previous, next), replace: true });
  };
  const open = (name: string): void => {
    go({ file: name === files[0] ? undefined : name, line: undefined });
  };

  if (gone && search.gen !== undefined) {
    return (
      <GenerationGone
        gen={search.gen}
        onCurrent={() => {
          // The line an address names was a line of that generation's file.
          go({ gen: undefined, line: undefined });
        }}
      />
    );
  }
  if (digest === undefined) return <Quiet>The plane names no package for this agent.</Quiet>;
  if (pack.error !== null && pack.error !== undefined && pack.manifest === undefined) {
    return (
      <Quiet>
        This package is no longer kept on the plane.
        <span className="mt-1 block text-xs">{wordsOf(pack.error)}</span>
      </Quiet>
    );
  }

  const provenance = pack.manifest?.provenance;
  const modified = codeWord(agent.row?.built?.amendDepth ?? provenance?.amendDepth ?? 0);
  const weight = chosen === undefined ? undefined : pack.manifest?.record?.[chosen]?.size;
  const text = file.data ?? '';
  const cut = text.length > SHOWN_BYTES;
  // The cli's line answers what is shown: the tests' verb for a file of the tests.
  const cliVerb = chosen?.startsWith(TESTS_FOLDER) === true ? 'tests' : 'compiled';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-2 text-xs text-ink-muted">
        {/* The line is read whole: where the column is narrow it takes a second line, between two
            of its facts, and cuts nothing. */}
        <span className="min-w-0">
          {provenance?.harness === undefined ? (
            'The compile left no word of what wrote this code'
          ) : (
            <>
              Coding assistant <AssistantWord harness={provenance.harness.name} />
              {provenance.harness.model !== undefined && ` (${provenance.harness.model})`}
              {modified !== undefined && (
                <>
                  {' · '}
                  <span title={MODIFIED_WORDS}>{modified}</span>
                </>
              )}
            </>
          )}
          {provenance !== undefined && (
            <>
              {' · '}
              <span className="whitespace-nowrap">
                {provenance.verified === undefined ? (
                  'live tests not run on this package'
                ) : (
                  <>
                    live tests passed{' '}
                    <Moment at={provenance.verified.at}>
                      {factMoment(provenance.verified.at, clock)}
                    </Moment>
                  </>
                )}
              </span>
            </>
          )}
        </span>
        <span className="flex-1" />
        {/* The controls keep together: where the line leaves them no room, they go under it as
            one, and on a window narrower than the three they fold onto a line more. */}
        <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
          <GenerationChoice
            generations={generations}
            chosen={generation?.gen}
            label="The generation whose compiled code is shown"
            onChoose={(gen) => {
              go({ gen, file: undefined, line: undefined });
            }}
          />
          {/* Where the window has no room for the list of files, they are chosen from a menu. */}
          {files.length > 1 && (
            <select
              aria-label="The file shown"
              value={chosen ?? ''}
              onChange={(event) => {
                open(event.target.value);
              }}
              className="h-7 max-w-44 rounded-md border border-line-strong bg-transparent px-2 text-xs text-ink-secondary sm:hidden"
            >
              {parts.map(
                (part) =>
                  part.files.length > 0 && (
                    <optgroup key={part.title} label={part.title}>
                      {part.files.map((name) => (
                        <option key={name} value={name}>
                          {shortName(name)}
                        </option>
                      ))}
                    </optgroup>
                  ),
              )}
            </select>
          )}
          <IconButton
            label={`Copy the cli's line: cernanto ${cliVerb} ${agent.id}`}
            onClick={() => {
              void copyText(`cernanto ${cliVerb} ${agent.id}`);
            }}
          >
            <Terminal size={15} />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="The package's files"
          className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r bg-surface py-2 sm:flex"
        >
          {pack.loading ? (
            <span className="px-4 py-2 text-xs text-ink-muted">Reading the package…</span>
          ) : (
            parts.map((part) => (
              <section key={part.title} aria-label={part.title} className="flex flex-col pb-2">
                <h3 className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
                  {part.title}
                </h3>
                {part.files.map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-current={name === chosen ? 'true' : undefined}
                    onClick={() => {
                      open(name);
                    }}
                    title={name}
                    className={cx(
                      'mono flex h-8 shrink-0 items-center px-4 text-left text-xs',
                      name === chosen ? 'bg-chosen text-ink' : 'text-ink-secondary hover:bg-hover',
                    )}
                  >
                    <span className="truncate">{shortName(name)}</span>
                  </button>
                ))}
                {part.files.length === 0 && (
                  <span className="px-4 py-1.5 text-xs text-ink-muted">
                    This package carries no {part.title.toLowerCase()}.
                  </span>
                )}
              </section>
            ))
          )}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {chosen !== undefined && (
            <FileBar
              name={chosen}
              weight={weight === undefined ? undefined : weightWord(weight)}
              text={file.data}
            />
          )}
          <div className="min-h-0 flex-1">
            {chosen === undefined ? (
              <Quiet>Nothing to show.</Quiet>
            ) : file.isPending ? (
              <Quiet>Reading the file…</Quiet>
            ) : file.isError ? (
              <Quiet>{wordsOf(file.error)}</Quiet>
            ) : (
              <Code
                key={`${digest}:${chosen}`}
                text={cut ? text.slice(0, SHOWN_BYTES) : text}
                language={languageOfFile(chosen)}
                label={chosen}
                line={search.file === chosen ? search.line : undefined}
              />
            )}
          </div>
          {cut && (
            <div className="shrink-0 border-t px-4 py-1.5 text-xs text-ink-muted">
              The file is shown to its first mebibyte. Save it to read the rest.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
