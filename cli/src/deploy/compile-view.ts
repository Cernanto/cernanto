// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { CompileStepRecord } from '../gateway/types.gen.js';
import { dateTime, elapsed, timeOfDay } from '../output.js';
import { diagnosticsCount } from '../diagnostics.js';

// The compile face: the deploy log as a person reads it, folded from the
// steps a compile narrates into its document (the gateway's compile progress
// operation). One timestamped line per thing that happened, the summary
// table with one row per agent, the done line and the header.

/** One narrated step of a compile, as the gateway answers it. */
export type ProgressRecord = CompileStepRecord;

export type CompileStep = CompileStepRecord['step'];

export type CompileColumn = 'code' | 'tests' | 'run' | 'result';

/** One agent's row of a compile as its steps said so far. */
export interface CompileAgentRow {
  agentId: string;
  beganAt?: string;
  endedAt?: string;
  durationMs?: number;
  codeAttempts: number;
  testsAttempts: number;
  testsReused?: boolean;
  codeCheck?: boolean;
  testsCheck?: boolean;
  run?: { ok: boolean; total?: number; failing?: number; waitingFor?: string[] };
  deployed?: boolean;
  running?: { step: CompileStep; since: string };
  failedStep?: CompileStep;
  result?: 'compiled' | 'current' | 'failed' | 'skipped';
  resultWords?: string;
  verification?: 'live' | 'none' | 'waiting';
  waitingFor?: string[];
}

/** The compile as its steps describe it so far. */
export interface CompileState {
  agents: CompileAgentRow[];
  plan?: string;
  startedAt?: string;
  lastAt?: string;
  done?: { ok: boolean; detail: string; at: string };
  retries: number;
}

/** How the compile view tells time. */
export interface CompileViewOptions {
  utc?: boolean;
  now?: number;
}

/** The steps deduplicated on (attempt, seq), first wins, in the order
 * of attempts (by their earliest time) then sequence. */
function orderedRecords(records: ProgressRecord[]): ProgressRecord[] {
  const unique = new Map<string, ProgressRecord>();
  for (const record of records) {
    const key = JSON.stringify([record.attemptId, record.seq]);
    if (!unique.has(key)) unique.set(key, record);
  }
  const groups = new Map<string, { first: string; records: ProgressRecord[] }>();
  for (const record of unique.values()) {
    const group = groups.get(record.attemptId);
    if (group === undefined) groups.set(record.attemptId, { first: record.at, records: [record] });
    else {
      group.records.push(record);
      if (record.at < group.first) group.first = record.at;
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.first.localeCompare(b.first))
    .flatMap((group) => group.records.sort((a, b) => a.seq - b.seq));
}

function parseTime(at: string): number | undefined {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? undefined : ms;
}

function spanMs(from: string | undefined, to: string | undefined): number | undefined {
  if (from === undefined || to === undefined) return undefined;
  const a = parseTime(from);
  const b = parseTime(to);
  if (a === undefined || b === undefined) return undefined;
  return b - a;
}

const COLUMN_OF: Record<CompileStep, CompileColumn> = {
  plan: 'result',
  agent: 'result',
  store: 'result',
  triage: 'result',
  retry: 'result',
  done: 'result',
  prepare: 'code',
  change: 'code',
  'write code': 'code',
  'check code': 'code',
  'fix code': 'code',
  'write tests': 'tests',
  'check tests': 'tests',
  'fix tests': 'tests',
  deploy: 'run',
  verify: 'run',
  declare: 'run',
};

const RUNNING_WORD: Record<CompileStep, string> = {
  plan: 'planning',
  agent: 'running',
  prepare: 'preparing',
  change: 'reading',
  'write code': 'writing',
  'check code': 'checking',
  'write tests': 'writing',
  'check tests': 'checking',
  store: 'storing',
  deploy: 'deploying',
  verify: 'running',
  declare: 'declaring',
  triage: 'triage',
  'fix code': 'fixing',
  'fix tests': 'fixing',
  retry: 'retrying',
  done: 'done',
};

const LONG_STEPS: CompileStep[] = [
  'change',
  'write code',
  'write tests',
  'fix code',
  'fix tests',
  'deploy',
  'verify',
  'declare',
  'triage',
];

/**
 * Whether a progress record earns a log line by default.
 *
 * @param record - The progress record.
 * @returns True for every record that is not a begin, and for the begin
 *   of a long step.
 * @example
 * showsInLog(record); // => true
 */
export function showsInLog(record: ProgressRecord): boolean {
  return record.state !== 'begin' || LONG_STEPS.includes(record.step);
}

function testCounts(detail: string): { total?: number; failing?: number } {
  const passed = /(\d+)\s+tests?\s+passed/.exec(detail);
  const failed = /(\d+)\s+failed/.exec(detail);
  const failing = failed === null ? undefined : Number(failed[1]);
  const counts: { total?: number; failing?: number } = {};
  if (passed !== null) counts.total = Number(passed[1]) + (failing ?? 0);
  if (failing !== undefined) counts.failing = failing;
  return counts;
}

/**
 * Folds progress records into the compile's state.
 *
 * @param records - The compile's progress records, in any order.
 * @returns The state the records describe: the agents' rows, the plan,
 *   the times, the retries and the done record when it came.
 * @example
 * const state = foldCompile(records);
 */
export function foldCompile(records: ProgressRecord[]): CompileState {
  const sorted = orderedRecords(records);
  const state: CompileState = { agents: [], retries: 0 };
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first !== undefined) state.startedAt = first.at;
  if (last !== undefined) state.lastAt = last.at;
  const rows = new Map<string, CompileAgentRow>();

  let activeAttempt = sorted[0]?.attemptId;
  for (const record of sorted) {
    if (record.attemptId !== activeAttempt) {
      activeAttempt = record.attemptId;
      state.retries += 1;
      delete state.done;
      for (const row of state.agents) delete row.running;
    }
    if (record.step === 'retry') {
      state.retries += 1;
      for (const row of state.agents) if (row.result === undefined) delete row.running;
      continue;
    }
    if (record.step === 'plan') {
      if (record.state === 'end') state.plan = record.detail;
      continue;
    }
    if (record.step === 'done') {
      state.done = { ok: record.ok === true, detail: record.detail, at: record.at };
      for (const row of state.agents) delete row.running;
      continue;
    }
    const subject = record.subject;
    if (subject === undefined) continue;
    let row = rows.get(subject);
    if (row === undefined) {
      // An agent the compile only reads, a package it prepares for the
      // ones it compiles and never begins, is none of the compile's
      // agents: no row of the table and no count of the verdict.
      if (record.step === 'prepare' && record.state !== 'begin') continue;
      row = { agentId: subject, codeAttempts: 0, testsAttempts: 0 };
      rows.set(subject, row);
      state.agents.push(row);
    }

    if (record.step === 'agent') {
      if (record.state === 'begin') {
        delete row.failedStep;
        delete row.codeCheck;
        delete row.testsCheck;
        delete row.run;
        row.beganAt = record.at;
        delete row.endedAt;
        delete row.result;
        delete row.resultWords;
        row.running = { step: 'agent', since: record.at };
      } else if (record.state === 'end') {
        row.endedAt = record.at;
        if (record.durationMs !== undefined) row.durationMs = record.durationMs;
        const result = record.result ?? (record.ok === false ? 'failed' : 'compiled');
        row.result = result;
        const running = row.running;
        if (result === 'failed' && running !== undefined && running.step !== 'agent') {
          row.failedStep = running.step;
        }
        row.resultWords = record.detail;
        if (record.verification !== undefined) row.verification = record.verification;
        if (record.waitingFor !== undefined) row.waitingFor = record.waitingFor;
        delete row.running;
      }
      continue;
    }

    if (record.state === 'begin') {
      if (row.beganAt === undefined) row.beganAt = record.at;
      row.running = { step: record.step, since: record.at };
      continue;
    }
    if (record.state === 'note') {
      if (record.step === 'write tests' && record.tests === 'reused') row.testsReused = true;
      continue;
    }

    const running = row.running;
    if (running !== undefined && (running.step === record.step || running.step === 'agent')) {
      delete row.running;
    }
    switch (record.step) {
      case 'write code':
      case 'fix code':
        row.codeAttempts += 1;
        break;
      case 'check code':
        row.codeCheck = record.ok !== false;
        break;
      case 'write tests':
      case 'fix tests':
        row.testsAttempts += 1;
        break;
      case 'check tests':
        row.testsCheck = record.ok !== false;
        break;
      case 'deploy':
        row.deployed = record.ok !== false;
        break;
      case 'verify': {
        const counts = testCounts(record.detail);
        row.run = {
          ok: record.ok === true,
          ...(counts.total === undefined ? {} : { total: counts.total }),
          ...(counts.failing === undefined ? {} : { failing: counts.failing }),
          ...(record.waitingFor !== undefined && record.waitingFor.length > 0
            ? { waitingFor: record.waitingFor }
            : {}),
        };
        break;
      }
      default:
        break;
    }
  }
  return state;
}

/** The table's headers, in order. */
export const BUILD_TABLE_HEADERS: string[] = [
  'AGENT',
  'WRITE CODE',
  'WRITE TESTS',
  'RUN TESTS',
  'RESULT',
  'TIME',
];

/**
 * Rows laid out under headers.
 *
 * @param headers - The column headers, in order.
 * @param rows - One array of cells per row.
 * @returns The header line and one line per row, columns aligned.
 * @example
 * tableLines(['A', 'B'], [['one', 'two']]);
 */
export function tableLines(headers: string[], rows: string[][]): string[] {
  let columns = headers.length;
  for (const row of rows) if (row.length > columns) columns = row.length;
  const widths: number[] = [];
  for (let index = 0; index < columns; index += 1) {
    let width = (headers[index] ?? '').length;
    for (const row of rows) {
      const cell = row[index] ?? '';
      if (cell.length > width) width = cell.length;
    }
    widths.push(width);
  }
  const lay = (cells: string[]): string => {
    const parts: string[] = [];
    for (let index = 0; index < columns; index += 1) {
      const cell = cells[index] ?? '';
      parts.push(index === columns - 1 ? cell : cell.padEnd(widths[index] ?? 0));
    }
    return parts.join('  ').replace(/\s+$/, '');
  };
  return [lay(headers), ...rows.map(lay)];
}

function cut(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function firstNonBlank(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
}

function runningCell(row: CompileAgentRow, column: CompileColumn, now: number): string | undefined {
  const running = row.running;
  if (running === undefined) return undefined;
  if (running.step === 'agent' || COLUMN_OF[running.step] !== column) return undefined;
  const since = parseTime(running.since);
  const ms = since === undefined ? 0 : Math.max(0, now - since);
  return `${RUNNING_WORD[running.step]} ${elapsed(ms)}`;
}

/**
 * The cells of one row, in column order.
 *
 * @param row - One agent's row of the compile.
 * @param options - How the view tells time; `now` anchors a running step.
 * @returns The five cells after the agent id: code, tests, run, result, time.
 * @example
 * rowCells(row, { now: Date.now() });
 */
export function rowCells(row: CompileAgentRow, options: CompileViewOptions = {}): string[] {
  const now = options.now ?? Date.now();
  if (row.result === 'current') {
    return [
      '-',
      '-',
      '-',
      'current',
      row.durationMs === undefined ? '0s' : elapsed(row.durationMs),
    ];
  }
  const failedColumn = row.failedStep === undefined ? undefined : COLUMN_OF[row.failedStep];

  const codeSettled = ((): string => {
    if ((row.codeCheck === false && row.result === 'failed') || failedColumn === 'code') {
      return 'FAIL';
    }
    if (row.codeAttempts === 0) return '-';
    return `${String(row.codeAttempts)} attempt${row.codeAttempts === 1 ? '' : 's'}`;
  })();
  const code = runningCell(row, 'code', now) ?? codeSettled;

  const testsSettled = ((): string => {
    if ((row.testsCheck === false && row.result === 'failed') || failedColumn === 'tests') {
      return 'FAIL';
    }
    if (row.testsAttempts === 0) return row.testsReused === true ? 'reused' : '-';
    return `${String(row.testsAttempts)} attempt${row.testsAttempts === 1 ? '' : 's'}`;
  })();
  const tests = runningCell(row, 'tests', now) ?? testsSettled;

  const runSettled = ((): string => {
    const run = row.run;
    if (run === undefined) {
      if (failedColumn === 'run') return 'FAIL';
      return row.deployed === true ? 'deployed' : '-';
    }
    if (run.waitingFor !== undefined && run.waitingFor.length > 0) return 'waiting';
    if (run.ok) return run.total === undefined ? 'ok' : `${String(run.total)} ok`;
    if (run.total === undefined || run.failing === undefined) return 'FAIL';
    return `${String(run.failing)}/${String(run.total)} FAIL`;
  })();
  const runTests = runningCell(row, 'run', now) ?? runSettled;

  const result = ((): string => {
    if (row.running !== undefined) return runningCell(row, 'result', now) ?? '';
    if (row.result === 'failed') {
      return cut(`FAILED ${firstNonBlank(row.resultWords ?? '')}`.trim());
    }
    if (row.resultWords !== undefined && row.resultWords !== '') return cut(row.resultWords);
    return cut(row.result ?? '');
  })();

  const time = ((): string => {
    if (row.endedAt !== undefined || row.result !== undefined) {
      if (row.durationMs !== undefined) return elapsed(row.durationMs);
      return elapsed(spanMs(row.beganAt, row.endedAt) ?? 0);
    }
    if (row.beganAt === undefined) return '';
    const began = parseTime(row.beganAt);
    return elapsed(began === undefined ? 0 : Math.max(0, now - began));
  })();

  return [code, tests, runTests, result, time];
}

/**
 * The state table: a header row and one row per agent.
 *
 * @param state - The folded compile state.
 * @param options - How the view tells time.
 * @returns The table's lines.
 * @example
 * const table = compileTable(state, { utc: true });
 */
export function compileTable(state: CompileState, options: CompileViewOptions = {}): string[] {
  const rows = state.agents.map((row) => [row.agentId, ...rowCells(row, options)]);
  return tableLines(BUILD_TABLE_HEADERS, rows);
}

/** The width of the step column. */
export const BUILD_STEP_WIDTH: number = 11;

function oneLine(text: string): string {
  return text.replace(/[^\S\n]*\n\s*/g, ' ').trim();
}

/**
 * What one record says, in the words its line carries.
 *
 * @param record - The progress record.
 * @returns The message its log line shows, as one line.
 * @example
 * recordMessage(record); // => 'ok 12 tests passed'
 */
export function recordMessage(record: ProgressRecord): string {
  const isEnd = record.state === 'end';
  if (record.step === 'agent' && isEnd) {
    if (record.result === 'failed' || record.ok === false) {
      return oneLine(`FAILED ${firstNonBlank(record.detail)}`.trim());
    }
    return oneLine(record.detail);
  }
  if (record.step === 'done' || record.step === 'retry') return oneLine(record.detail);
  if ((record.step === 'fix code' || record.step === 'fix tests') && isEnd) {
    const text =
      record.ok === false ? `FAIL ${record.detail}` : `fixed ${record.detail}`.replace(/\s+$/, '');
    return oneLine(text);
  }
  if (record.ok === false) {
    const failures = record.failures;
    const first = failures?.[0];
    if (failures !== undefined && first !== undefined) {
      const text =
        first.message === '' ? `FAIL ${first.name}` : `FAIL ${first.name}: ${first.message}`;
      const more = failures.length > 1 ? ` (+${String(failures.length - 1)} more)` : '';
      return oneLine(text) + more;
    }
    return oneLine(`FAIL ${record.detail}`.trim());
  }
  if (isEnd && record.ok === true) {
    return oneLine(record.detail === '' ? 'ok' : `ok ${record.detail}`);
  }
  return oneLine(record.detail);
}

/**
 * The step word a line shows.
 *
 * @param record - The progress record.
 * @returns `done` for an agent's end, else the record's step.
 * @example
 * stepWord(record); // => 'done'
 */
export function stepWord(record: ProgressRecord): string {
  return record.step === 'agent' && record.state === 'end' ? 'done' : record.step;
}

/**
 * One record as one log line.
 *
 * @param record - The progress record.
 * @param options - How the view tells time, and the agent column's width.
 * @returns The line the deploy log prints.
 * @example
 * progressLine(record, { utc: true, agentWidth: 12 });
 */
export function progressLine(
  record: ProgressRecord,
  options: CompileViewOptions & { agentWidth?: number } = {},
): string {
  const agent = record.subject ?? 'compile';
  const width = options.agentWidth;
  const agentText = width === undefined ? agent : agent.padEnd(width);
  const step = stepWord(record).padEnd(BUILD_STEP_WIDTH);
  const prefix = `${timeOfDay(record.at, options.utc)}  ${agentText}  ${step}  `;
  const [first = '', ...rest] = recordMessage(record).split('\n');
  let line = `${prefix}${first}`;
  if (record.state === 'end' && record.durationMs !== undefined && record.step !== 'done') {
    line += `  ${elapsed(record.durationMs)}`;
  }
  const blank = ' '.repeat(prefix.length);
  return [line, ...rest.map((text) => `${blank}${text}`)]
    .map((text) => text.replace(/\s+$/, ''))
    .join('\n');
}

function rowWords(row: CompileAgentRow, running: boolean): string {
  if (row.result === 'current') return 'current';
  if (row.result === 'failed') return 'FAILED';
  if (row.result === undefined) return running ? 'running' : 'unfinished';
  if (row.resultWords !== undefined && row.resultWords !== '') return row.resultWords;
  return row.result;
}

function rankWords(words: string): number {
  if (words.startsWith('verified')) return 0;
  if (words.startsWith('compiled, waiting')) return 2;
  if (words.startsWith('compiled')) return 1;
  if (words.startsWith('waiting')) return 2;
  if (words.startsWith('FAILED')) return 3;
  if (words.startsWith('current')) return 4;
  return 5;
}

/**
 * A compile's total time as its records tell it.
 *
 * @param state - The folded compile state.
 * @returns The span from the first record to the last, never below zero,
 *   nothing when either time is missing.
 * @example
 * compileDurationMs(state); // => 84000
 */
export function compileDurationMs(state: CompileState): number | undefined {
  const span = spanMs(state.startedAt, state.lastAt);
  return span === undefined ? undefined : Math.max(0, span);
}

/**
 * The closing line of a compile.
 *
 * @param state - The folded compile state.
 * @param options - `running` says the compile still runs, `totalMs` the
 *   time it took, `traceHandle` the handle to read the trace by.
 * @returns The verdict, the counts, the total time and the trace hint.
 * @example
 * doneLine(state, { totalMs: 84000, traceHandle: 'compile-7' });
 */
export function doneLine(
  state: CompileState,
  options: CompileViewOptions & {
    traceHandle?: string;
    totalMs?: number;
    running?: boolean;
    /** The diagnostics' lines, the size warning's and the spec issues',
     * counted on the line (`, 1 warning`, `, 1 error, 2 warnings`). */
    diagnostics?: string[];
  } = {},
): string {
  const running = options.running === true;
  const groups: { words: string; count: number; order: number }[] = [];
  for (const row of state.agents) {
    const words = rowWords(row, running);
    const group = groups.find((other) => other.words === words);
    if (group === undefined) groups.push({ words, count: 1, order: groups.length });
    else group.count += 1;
  }
  groups.sort((a, b) => rankWords(a.words) - rankWords(b.words) || a.order - b.order);
  const counts = groups
    .map((group, index) =>
      index === 0
        ? `${String(group.count)} agent${group.count === 1 ? '' : 's'} ${group.words}`
        : `${String(group.count)} ${group.words}`,
    )
    .join(', ');
  const done = state.done;
  const verdict =
    done === undefined ? (running ? 'running' : 'stopped') : done.ok ? 'done' : 'failed';
  const total = options.totalMs ?? compileDurationMs(state) ?? 0;
  const diagnostics = options.diagnostics ?? [];
  const found = diagnostics.length === 0 ? '' : `, ${diagnosticsCount(diagnostics)}`;
  const parts = [
    verdict,
    `${counts === '' ? 'no agents' : counts}${found}`,
    elapsed(total),
    ...(options.traceHandle === undefined ? [] : [`trace: cernanto trace ${options.traceHandle}`]),
  ];
  return parts.join('   ');
}

/**
 * The header above the table.
 *
 * @param input - The compile's id, its verification, the
 *   number of agents, when it started and whether to read time in utc.
 * @returns The header line.
 * @example
 * compileHeader({ compileId: 'compile-7', startedAt: at, utc: true });
 */
export function compileHeader(input: {
  compileId: string;
  verify?: boolean;
  startedAt: string;
  utc?: boolean;
  agents?: number;
}): string {
  const parts = [`compile ${input.compileId}`];
  if (input.verify !== undefined) parts.push(input.verify ? 'verify on' : 'verify off');
  if (input.agents !== undefined) {
    parts.push(`${String(input.agents)} agent${input.agents === 1 ? '' : 's'}`);
  }
  parts.push(`started ${dateTime(input.startedAt, input.utc)}`);
  return parts.join('   ');
}
