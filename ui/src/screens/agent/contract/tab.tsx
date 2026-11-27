// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Terminal } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { patched } from '../../../app/search.js';
import { wordsOf } from '../../../api/plane.js';
import { usePackageFile } from '../../../api/queries.js';
import { Code } from '../../../components/code.js';
import { cx, IconButton, Quiet } from '../../../components/ui.js';
import { useFileView, ViewSwitch } from '../../../components/view-switch.js';
import { functionCards, typeWord } from '../../../model/contract.js';
import type { FunctionCard, PlainField } from '../../../model/contract.js';
import type { FleetAgent } from '../../../model/fleet.js';
import {
  CONTRACT,
  packageOf,
  useGenerationGone,
  useGenerations,
  usePackage,
} from '../../../model/package.js';
import { copyText } from '../../../state/save.js';
import { FileBar } from '../code/file-bar.js';
import { GenerationChoice, GenerationGone } from '../code/generation.js';
import { CopyButton } from '../trace/body.js';

const route = getRouteApi('/agents/$');

/** The fields a function takes or answers, a line each. */
function FieldList({ fields, depth = 0 }: { fields: PlainField[]; depth?: number }): ReactNode {
  return (
    <ul className={cx('flex flex-col gap-1', depth > 0 && 'mt-1 border-l border-line pl-3')}>
      {fields.map((field) => {
        const nested =
          field.type.kind === 'fields'
            ? field.type.fields
            : field.type.kind === 'list' && field.type.of.kind === 'fields'
              ? field.type.of.fields
              : undefined;
        return (
          <li key={field.name} className="text-[13px]">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="mono text-ink">{field.name}</span>
              <span className="text-ink-secondary">
                {field.type.kind === 'list' && nested !== undefined
                  ? 'list of:'
                  : typeWord(field.type)}
              </span>
              {field.optional && <span className="text-xs text-ink-muted">optional</span>}
              {field.doc.length > 0 && (
                <span className="text-ink-muted">{field.doc.join(' ')}</span>
              )}
            </span>
            {nested !== undefined && <FieldList fields={nested} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

/** One function in plain words: what it does, what it takes and what
 * it answers, and the line that calls it. */
function FunctionReading({ card, agentId }: { card: FunctionCard; agentId: string }): ReactNode {
  const answers =
    card.answers.kind === 'fields'
      ? card.answers.fields
      : card.answers.kind === 'list' && card.answers.of.kind === 'fields'
        ? card.answers.of.fields
        : undefined;
  const line = `cernanto call ${agentId} ${card.name}`;
  return (
    <section className="border-b py-5 last:border-b-0">
      <h3 className="text-[15px] font-semibold text-ink">
        {card.spoken}{' '}
        <span className="mono ml-1 text-xs font-normal text-ink-muted">{card.name}</span>
      </h3>
      {card.description.length > 0 && (
        <p className="mt-1 max-w-[70ch] text-[13px] whitespace-pre-wrap text-ink-secondary">
          {card.description.join('\n')}
        </p>
      )}
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
            Takes
          </div>
          {card.fields.length === 0 ? (
            <span className="text-[13px] text-ink-muted">Nothing.</span>
          ) : (
            <FieldList fields={card.fields} />
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
            Answers
          </div>
          {answers === undefined ? (
            <span className="text-[13px] text-ink-secondary">{typeWord(card.answers)}</span>
          ) : (
            <FieldList fields={answers} />
          )}
          {card.returns.length > 0 && (
            <p className="mt-1 text-[13px] text-ink-muted">{card.returns.join(' ')}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1">
        <code className="mono rounded-md bg-sunken px-2 py-1 text-xs text-ink-secondary">
          {line}
          {card.fields.length > 0 && ` ${card.fields.map((field) => `${field.name}=…`).join(' ')}`}
        </code>
        <CopyButton text={line} label="Copy the command" />
      </div>
    </section>
  );
}

/** The Contract tab: what the agent offers to whoever calls it. Rendered,
 * it is each of its functions in plain words with what it takes and
 * what it answers, which is what `cernanto contract` answers and what
 * the send box is made from. Raw, it is the contract's own file, the
 * declarations a caller is compiled against, with the names of their
 * types and the examples of their comments, to copy or to save. A
 * switch the browser remembers chooses, as on the Source tab. */
export function ContractTab({ agent }: { agent: FleetAgent }): ReactNode {
  const search = route.useSearch();
  const navigate = useNavigate();
  const [view, setView] = useFileView('contract.view');
  const generations = useGenerations(agent.id);
  const gone = useGenerationGone(agent.id, search.gen);
  const digest = packageOf(agent, generations, search.gen);
  const pack = usePackage(digest);
  const contract = usePackageFile(digest, CONTRACT);
  const cards = useMemo(
    () =>
      contract.data === undefined ? [] : functionCards(contract.data, pack.manifest?.handlers),
    [contract.data, pack.manifest],
  );
  const generation =
    search.gen === undefined
      ? (generations.find((entry) => entry.status === 'active') ?? generations[0])
      : generations.find((entry) => entry.gen === search.gen);

  if (gone && search.gen !== undefined) {
    return (
      <GenerationGone
        gen={search.gen}
        onCurrent={() => {
          void navigate({
            to: '.',
            search: (previous) => patched(previous, { gen: undefined }),
            replace: true,
          });
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-2 text-xs text-ink-muted">
        {/* How a file is shown stands first in a tab's strip, the source's as the contract's: found in one place. */}
        <ViewSwitch view={view} onChoose={setView} label="How the contract is shown" />
        <span className="min-w-0">
          What this agent offers to whoever calls it: its functions, what each takes and what it
          answers.
        </span>
        <span className="flex-1" />
        {/* The cli's button stays beside the generation, never on a line by itself. */}
        <div className="flex items-center gap-3">
          <GenerationChoice
            generations={generations}
            chosen={generation?.gen}
            label="The generation whose contract is shown"
            onChoose={(gen) => {
              void navigate({
                to: '.',
                search: (previous) => patched(previous, { gen }),
                replace: true,
              });
            }}
          />
          <IconButton
            label={`Copy the cli's line: cernanto contract ${agent.id}`}
            onClick={() => {
              void copyText(`cernanto contract ${agent.id}`);
            }}
          >
            <Terminal size={15} />
          </IconButton>
        </div>
      </div>
      {view === 'rendered' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <div className="w-full">
            {contract.isPending && <Quiet>Reading the contract…</Quiet>}
            {contract.isError && <Quiet>{wordsOf(contract.error)}</Quiet>}
            {contract.data !== undefined && cards.length === 0 && (
              <Quiet>The contract declares no function.</Quiet>
            )}
            {cards.map((card) => (
              <FunctionReading key={card.name} card={card} agentId={agent.id} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <FileBar name={CONTRACT} text={contract.data} />
          <div className="min-h-0 flex-1">
            {contract.isPending ? (
              <Quiet>Reading the contract…</Quiet>
            ) : contract.isError ? (
              <Quiet>{wordsOf(contract.error)}</Quiet>
            ) : (
              <Code key={digest} text={contract.data} language="typescript" label={CONTRACT} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
