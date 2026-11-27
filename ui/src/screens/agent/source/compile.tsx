// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { wordsOf } from '../../../api/plane.js';
import { Button, cx, ErrorLine, Moment } from '../../../components/ui.js';
import type { CompileAgentReport } from '../../../gateway/types.gen.js';
import {
  BUILD_TABLE_HEADERS,
  compileRows,
  doneLine,
  findingsCount,
  foldCompile,
  logLines,
} from '../../../model/compile-log.js';
import type { LineTone, LogLine } from '../../../model/compile-log.js';
import { humanMs } from '../../../model/figures.js';
import { codeCameWords } from '../../../model/package.js';
import { timeOfDay } from '../../../model/time.js';
import {
  cancelCompile,
  dismissCompile,
  followAgain,
  installedOnTheWay,
  shipped,
  useKeptCompile,
} from '../../../state/compiles.js';
import type { CompileRun } from '../../../state/compiles.js';
import { useClock } from '../../../state/prefs.js';
import { Running } from '../trace/message.js';

/** What the area says it shows. A plan-only compile goes by the cli's name for it, the dry run. */
const KIND_WORDS: Record<CompileRun['kind'], string> = {
  plan: 'Dry run',
  deploy: 'Deploy',
  compile: 'Compile',
};

// THE LOG IS THE CLI'S, line for line (`model/compile-log.ts`): a time,
// the agent, the step, what was said and how long it took, every line
// of one kind, in the fixed-width face a terminal prints it in, and at
// the end the cli's own table of the agents and its verdict. The screen
// adds little to it: "ok" is green and "FAIL" red, the line of a long
// step that still runs carries a ring with its time, and a long line
// folds under its own words.

/** Whether a word says a step held or failed, by the cli's own words for it. */
const HELD = 'text-good';
const FAILED = 'font-semibold text-bad';

/** A line's words, the word that says how its step ended in its colour. */
function Said({ message, tone }: { message: string; tone: LineTone }): ReactNode {
  if (tone === undefined) return message;
  const word = /^\S+/.exec(message)?.[0] ?? '';
  return (
    <>
      <span className={tone === 'ok' ? HELD : FAILED}>{word}</span>
      {message.slice(word.length)}
    </>
  );
}

/** The log: one line per thing the compile said, in the cli's columns.
 * A column too narrow for the four leaves the agent's out. */
function Log({ lines }: { lines: LogLine[] }): ReactNode {
  const [clock] = useClock();
  return (
    <div
      role="log"
      aria-label="The compile's log"
      className="mono grid grid-cols-[max-content_max-content_minmax(0,1fr)] gap-x-[2ch] leading-5 text-ink-secondary @lg:grid-cols-[max-content_max-content_max-content_minmax(0,1fr)]"
    >
      {lines.map((line) => (
        <div key={line.key} className="contents">
          <span>{timeOfDay(line.at, clock, true)}</span>
          <span className="hidden @lg:inline">{line.agent}</span>
          <span>{line.step}</span>
          <span className="min-w-0 break-words whitespace-pre-wrap">
            <Said message={line.message} tone={line.tone} />
            {line.took !== undefined && `  ${humanMs(line.took)}`}
            {line.running && (
              <span className="ml-[2ch] inline-flex items-center gap-[1ch] align-baseline">
                <span className="ring text-[10px]" aria-label="Running" />
                <Running since={line.at} />
              </span>
            )}
            {/* The failed tests the line counts and does not name, each on a line of its own. */}
            {line.more.map((failure, index) => (
              <span key={index} className="block">
                <span className={FAILED}>FAIL</span> {failure.name}
                {failure.message === '' ? '' : `: ${failure.message}`}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The table the cli ends a compile on: a line per agent under its heads. */
function Summary({ rows }: { rows: string[][] }): ReactNode {
  return (
    // A narrow column reads the table by moving it sideways, as a terminal does.
    <div className="mt-5 overflow-x-auto">
      <div className="mono grid w-max grid-cols-[repeat(6,max-content)] gap-x-[2ch] leading-5 text-ink-secondary">
        {BUILD_TABLE_HEADERS.map((head) => (
          <span key={head}>{head}</span>
        ))}
        {rows.flatMap((cells, at) =>
          cells.map((cell, column) => (
            <span
              key={`${String(at)}:${String(column)}`}
              className={cx(/FAIL/.test(cell) && FAILED, /(^| )ok$/.test(cell) && HELD)}
            >
              {cell}
            </span>
          )),
        )}
      </div>
    </div>
  );
}

/** The cli's closing line: the verdict, the counts and the whole time. */
function Verdict({ line }: { line: string }): ReactNode {
  const word = /^\S+/.exec(line)?.[0] ?? '';
  return (
    <div className="mono mt-5 leading-5 break-words whitespace-pre-wrap text-ink-secondary">
      <span className={cx(word === 'done' && HELD, word === 'failed' && FAILED)}>{word}</span>
      {line.slice(word.length)}
    </div>
  );
}

/** What a compile says of one agent at its end, in words. */
function reportWords(report: CompileAgentReport, plan: boolean): string {
  const parts: string[] = [];
  const result: Record<CompileAgentReport['status'], string> = {
    compiled: plan ? 'would compile' : 'compiled',
    current: 'current: nothing to compile',
    failed: 'failed',
    skipped: 'skipped',
  };
  parts.push(result[report.status]);
  const code = report.code === undefined ? undefined : codeCameWords(report.code);
  if (code !== undefined) parts.push(code);
  if (report.contractChange !== undefined) {
    const moved: Record<NonNullable<CompileAgentReport['contractChange']>, string> = {
      none: 'its contract does not move',
      compatible: 'its contract moves in a way its users can live with',
      breaking: 'its contract moves in a way that breaks its users',
    };
    parts.push(plan ? `expected: ${moved[report.contractChange]}` : moved[report.contractChange]);
  }
  if (report.verification === 'live') parts.push('its tests proved it');
  if (report.verification === 'none' && !plan) parts.push('not verified');
  if (report.verification === 'waiting') {
    parts.push(`its tests wait for ${(report.waitingFor ?? []).join(', ') || 'a person'}`);
  }
  return parts.join(' · ');
}

/**
 * The compile area: a compile's narration whole, as it is written. It
 * is the cli's deploy log with a face, and it keeps the log's own rule:
 * no code, no cost, no tokens.
 */
export function CompileArea({
  run,
  onLine,
}: {
  run: CompileRun;
  /** Leads to a line of the source a finding names. */
  onLine?: (line: number) => void;
}): ReactNode {
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const kept = useKeptCompile(run.agentId);
  const ended = run.endedAt !== undefined;
  const plan = run.kind === 'plan';
  const answer = run.answer;
  const failed =
    run.status === 'failed' ||
    (answer !== undefined && answer.status !== 'ok') ||
    run.error !== undefined;
  const lines = logLines(run.steps, !ended);
  const installed = installedOnTheWay(run.steps);
  // What the cli ends a compile on, once this one ended: its agents' table and its verdict.
  const state = ended && lines.length > 0 ? foldCompile(run.steps) : undefined;
  const issues = answer?.issues ?? [];
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const verdict =
    state === undefined || run.endedAt === undefined
      ? undefined
      : doneLine(state, {
          totalMs: Date.parse(run.endedAt) - Date.parse(run.startedAt),
          findings: findingsCount(errors, issues.length - errors),
        });

  // THE AREA FOLLOWS ITS NEWEST LINE while the reader leaves it at its
  // foot: a line that is told and the compile's last words each come
  // into sight as they are written. A reader who moved it up to read is
  // left where they are, and is followed again once they are back at
  // the foot. A compile that begins is followed anew.
  const log = useRef<HTMLDivElement>(null);
  const atFoot = useRef(true);
  const told =
    lines.reduce((sum, line) => sum + 1 + line.more.length, 0) +
    (answer === undefined ? 0 : 1) +
    (run.error === undefined ? 0 : 1);
  useLayoutEffect(() => {
    atFoot.current = true;
  }, [run.compileId]);
  useLayoutEffect(() => {
    const made = log.current;
    if (made !== null && atFoot.current) made.scrollTop = made.scrollHeight;
  }, [told, ended, run.compileId]);

  return (
    // The area is as high as what it holds, to two fifths of the tab: past
    // that it moves inside itself, and the source keeps the rest.
    <section
      aria-label="The compile"
      className="flex max-h-[40%] min-h-40 shrink-0 flex-col border-t bg-surface"
    >
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-5 text-[13px]">
        <span className="font-semibold text-ink">{KIND_WORDS[run.kind]}</span>
        <span
          className={cx(
            'min-w-0 flex-1 truncate',
            failed ? 'font-semibold text-bad' : 'text-ink-secondary',
          )}
        >
          {!ended ? (
            run.status === 'starting' ? (
              'Sending the source…'
            ) : run.status === 'waiting' ? (
              <>
                Waiting for the compiler <Running since={run.startedAt} />
              </>
            ) : (
              // The one state that is live says so in the accent.
              <>
                <span className="text-accent-text">Running</span> <Running since={run.startedAt} />
              </>
            )
          ) : run.unread === true ? (
            // The compile did not fail: this window stopped reading it.
            'Not followed in this window'
          ) : failed ? (
            plan ? (
              'The dry run failed'
            ) : run.kind === 'deploy' ? (
              'Deploy failed'
            ) : (
              'The compile failed'
            )
          ) : plan ? (
            installed.length === 0 ? (
              'Nothing was written, verified or shipped'
            ) : (
              `Installed from the registry on the way: ${installed
                .map((entry) => `${entry.agentId} ${entry.version}`)
                .join(', ')}. Nothing else was written, verified or shipped`
            )
          ) : shipped(run) ? (
            'Shipped'
          ) : (
            'Done'
          )}
          {ended && run.endedAt !== undefined && (
            <span className="ml-2 font-normal text-ink-muted">
              {humanMs(Date.parse(run.endedAt) - Date.parse(run.startedAt))}
            </span>
          )}
        </span>
        <span className="text-xs text-ink-muted">
          started <Moment at={run.startedAt} seconds />
        </span>
        {!ended && run.callId !== undefined && (
          <Button
            small
            look="quiet"
            onClick={() => {
              setTrouble(undefined);
              void cancelCompile(run.agentId).catch((error: unknown) => {
                setTrouble(wordsOf(error));
              });
            }}
          >
            Cancel
          </Button>
        )}
        {/* A compile this window stopped reading still runs while the browser
            keeps it: the way on is to follow it again, and its report is
            closed once it is over. */}
        {ended && run.unread === true && kept ? (
          <Button
            small
            onClick={() => {
              followAgain(run.agentId);
            }}
          >
            Follow it again
          </Button>
        ) : (
          ended && (
            <Button
              small
              look="quiet"
              onClick={() => {
                dismissCompile(run.agentId);
              }}
            >
              Close
            </Button>
          )
        )}
      </div>
      {/* The log's columns go by the width this area is given, whatever the window's. */}
      <div
        ref={log}
        className="measured min-h-0 flex-1 overflow-y-auto px-5 py-2"
        onScroll={(event) => {
          const made = event.currentTarget;
          atFoot.current = made.scrollHeight - made.scrollTop - made.clientHeight < 24;
        }}
      >
        {trouble !== undefined && <ErrorLine>{trouble}</ErrorLine>}
        {/* The plane runs a compile the browser kept no note of: said while
            it runs, with the call that names it to the cli. */}
        {run.unkept === true && !ended && (
          <p role="alert" className="py-1 text-[13px] text-ink">
            This browser kept no note of this compile: its storage is full, or closed to this page.
            This window follows it. Once this window is loaded again, and in any other window,
            nothing will show that it runs, and Deploy will be offered while it does.
            {run.callId !== undefined && (
              <>
                {' '}
                Its call is <span className="mono text-xs break-all">{run.callId}</span>.
              </>
            )}
          </p>
        )}
        {lines.length === 0 && !ended && (
          <p className="py-2 text-[13px] text-ink-muted">The compile has said nothing yet.</p>
        )}
        <Log lines={lines} />
        {run.error !== undefined && <ErrorLine className="mt-2">{run.error}</ErrorLine>}
        {state !== undefined && state.agents.length > 0 && <Summary rows={compileRows(state)} />}
        {verdict !== undefined && <Verdict line={verdict} />}
        {answer !== undefined && (
          <div className="mt-3 flex flex-col gap-2 border-t pt-3">
            {answer.issues.map((issue, index) => (
              <button
                key={index}
                type="button"
                disabled={issue.line === undefined || onLine === undefined}
                onClick={() => {
                  if (issue.line !== undefined) onLine?.(issue.line);
                }}
                className="flex flex-col items-start rounded-md border border-line-strong px-2.5 py-1.5 text-left text-[13px] enabled:hover:bg-hover"
              >
                <span
                  className={cx(
                    'font-medium',
                    issue.severity === 'error' ? 'text-bad' : 'text-ink',
                  )}
                >
                  <span className="mono mr-2 text-xs">{issue.code}</span>
                  {issue.message}
                  {issue.line !== undefined && (
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      line {issue.line}
                    </span>
                  )}
                </span>
                {issue.hint !== undefined && (
                  <span className="text-xs text-ink-muted">{issue.hint}</span>
                )}
              </button>
            ))}
            {answer.agents.map((report) => (
              <div key={report.agentId} className="text-[13px]">
                <span className="mono mr-2 text-xs text-ink">{report.agentId}</span>
                <span className={report.status === 'failed' ? 'text-bad' : 'text-ink-secondary'}>
                  {reportWords(report, plan)}
                </span>
                {report.detail !== undefined && report.detail !== '' && (
                  <div className="text-xs break-words whitespace-pre-wrap text-ink-muted">
                    {report.detail}
                  </div>
                )}
              </div>
            ))}
            {(answer.shipped?.notes ?? []).map((note, index) => (
              <div key={index} className="text-xs text-ink-muted">
                {note}
              </div>
            ))}
            {answer.shipped !== undefined && !answer.shipped.converged && (
              <div className="text-xs text-ink-muted">
                The new generation was shipped and had not begun to serve when the deploy answered.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
