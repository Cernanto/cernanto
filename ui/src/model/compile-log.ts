// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { CompileStepRecord } from '../gateway/types.gen.js';

// THE COMPILE'S LOG, AS THE CLI PRINTS IT. A deploy made from the screen
// is read as one made from a terminal is: one line per thing that
// happened (its time, the agent, the step, what was said, how long it
// took), and at the end one line per agent under the table's heads, and
// the verdict. Every line is of one kind. The words and the rules are
// the cli's own (`cli/src/deploy/compile-view.ts`), said again here
// because the two are separate packages: what changes in one changes
// in the other, so the two say the same, line for line.

/** One narrated step of a compile, as the gateway answers it. */
export type ProgressRecord = CompileStepRecord;

export type CompileStep = CompileStepRecord['step'];

export type CompileColumn = 'code' | 'tests' | 'run' | 'result';

/** One agent's line of a compile as its steps said so far. */
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

/** How the compile's log tells time. */
export interface CompileViewOptions {
  utc?: boolean;
  now?: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseTime(at: string): number | undefined {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? undefined : ms;
}

/** `HH:MM:SS`, local or utc; eight spaces for a text that is not a time. */
export function timeOfDay(at: string, utc?: boolean): string {
  const ms = parseTime(at);
  if (ms === undefined) return '        ';
  const date = new Date(ms);
  return utc === true
    ? `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
    : `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** An elapsed span as the tables show it: whole seconds, then minutes
 * and seconds, then hours and minutes; never below zero. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m${pad2(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h${pad2(minutes % 60)}m`;
}

/** The steps deduplicated on (attempt, seq), first wins, in the order
 * of attempts (by their earliest time) then sequence. */
export function orderedRecords(records: ProgressRecord[]): ProgressRecord[] {
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

/** Whether a progress record earns a log line: every record that is
 * not a begin, and the begin of a long step. */
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
 * Folds progress records into the compile's state: the agents' lines,
 * the plan, the times, the retries and the done record when it came.
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
      // agents: no line of the table and no count of the verdict.
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
      row.beganAt ??= record.at;
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

/** The table's heads, in order. */
export const BUILD_TABLE_HEADERS: string[] = [
  'AGENT',
  'WRITE CODE',
  'WRITE TESTS',
  'RUN TESTS',
  'RESULT',
  'TIME',
];

/** Lines laid out under heads, the columns aligned. */
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

/** The cells of one agent's line after its id: code, tests, run, result, time. */
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

/** The table of a compile's agents, cell by cell: each agent's id and its five cells. */
export function compileRows(state: CompileState, options: CompileViewOptions = {}): string[][] {
  return state.agents.map((row) => [row.agentId, ...rowCells(row, options)]);
}

/** The table as the cli prints it: the heads' line and one line per agent. */
export function compileTable(state: CompileState, options: CompileViewOptions = {}): string[] {
  return tableLines(BUILD_TABLE_HEADERS, compileRows(state, options));
}

/** The width of the step column. */
export const BUILD_STEP_WIDTH = 11;

function oneLine(text: string): string {
  return text.replace(/[^\S\n]*\n\s*/g, ' ').trim();
}

/** What one record says, in the words its line carries. */
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

/** The step word a line shows: `done` for an agent's end, else the record's step. */
export function stepWord(record: ProgressRecord): string {
  return record.step === 'agent' && record.state === 'end' ? 'done' : record.step;
}

/** Whether a record's line says how long its step took: a step's end that
 * was timed, the compile's own last line aside. */
export function tookOf(record: ProgressRecord): number | undefined {
  return record.state === 'end' && record.step !== 'done' ? record.durationMs : undefined;
}

/**
 * One record as one log line, as the cli prints it.
 *
 * @param options - How the line tells time, the agent column's width, and the
 *   words of a span: the cli's whole seconds where none are given.
 */
export function progressLine(
  record: ProgressRecord,
  options: CompileViewOptions & { agentWidth?: number; span?: (ms: number) => string } = {},
): string {
  const agent = record.subject ?? 'compile';
  const width = options.agentWidth;
  const agentText = width === undefined ? agent : agent.padEnd(width);
  const step = stepWord(record).padEnd(BUILD_STEP_WIDTH);
  const prefix = `${timeOfDay(record.at, options.utc)}  ${agentText}  ${step}  `;
  const [first = '', ...rest] = recordMessage(record).split('\n');
  let line = `${prefix}${first}`;
  const took = tookOf(record);
  if (took !== undefined) line += `  ${(options.span ?? elapsed)(took)}`;
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

/** A compile's total time as its records tell it: from the first record
 * to the last, never below zero. */
export function compileDurationMs(state: CompileState): number | undefined {
  const span = spanMs(state.startedAt, state.lastAt);
  return span === undefined ? undefined : Math.max(0, span);
}

/** The count of findings by their level word: `1 error`, `2 warnings`,
 * `1 error, 2 warnings`. */
export function findingsCount(errors: number, warnings: number): string {
  const parts: string[] = [];
  if (errors > 0) parts.push(`${String(errors)} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${String(warnings)} warning${warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/**
 * The closing line of a compile: the verdict, the counts and the total time.
 *
 * @param options - `running` says the compile still runs, `totalMs` the time it
 *   took, `findings` the count of what the compile found in the sources, in words.
 */
export function doneLine(
  state: CompileState,
  options: { totalMs?: number; running?: boolean; findings?: string } = {},
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
  // A compile that ended with nothing failed and an agent's tests
  // waiting for a person is waiting, not failed.
  const waiting =
    state.agents.some((row) => row.verification === 'waiting') &&
    !state.agents.some((row) => row.result === 'failed' || row.result === undefined);
  const verdict =
    done === undefined
      ? running
        ? 'running'
        : 'stopped'
      : done.ok
        ? 'done'
        : waiting
          ? 'waiting'
          : 'failed';
  const total = options.totalMs ?? compileDurationMs(state) ?? 0;
  const found =
    options.findings === undefined || options.findings === '' ? '' : `, ${options.findings}`;
  return [verdict, `${counts === '' ? 'no agents' : counts}${found}`, elapsed(total)].join('   ');
}

// WHAT THE SCREEN ADDS, and it is little: a line is laid in the log's
// own four columns, so a long one folds under its own words; the word
// the cli opens a line with for how a step ended is told apart, to be
// drawn in its colour; and the line of a long step that still runs is
// known, to carry a ring and its time.

/** How a line's first word says its step ended, where it says so. */
export type LineTone = 'ok' | 'failed' | undefined;

/** One line of the log, in its parts. */
export interface LogLine {
  key: string;
  /** The moment the line was said. */
  at: string;
  agent: string;
  step: string;
  /** What the line says, as the cli prints it. */
  message: string;
  /** The word the message opens with for how the step ended, drawn in its colour. */
  tone: LineTone;
  /** The failed tests the line's own words count and do not name. */
  more: { name: string; message: string }[];
  /** How long the step took, where the line says it. */
  took: number | undefined;
  /** Whether this is the begin of a long step that has not ended. */
  running: boolean;
}

/** The word a message opens with for how its step ended. */
export function toneOf(message: string): LineTone {
  if (/^ok(\s|$)/.test(message)) return 'ok';
  if (/^FAIL(ED)?(\s|$)/.test(message)) return 'failed';
  return undefined;
}

/**
 * A compile's log, line by line, as the cli prints it: the records in
 * their order, each that earns a line.
 *
 * @param open - Whether the compile still runs: a step that began and did
 *   not end is running only while it does.
 */
export function logLines(records: ProgressRecord[], open: boolean): LogLine[] {
  const ordered = orderedRecords(records);
  const lastAttempt = ordered[ordered.length - 1]?.attemptId;
  // The steps that ended, by attempt, agent and step: a begin with none after it still runs.
  const ended = new Map<string, number>();
  for (const record of ordered) {
    if (record.state !== 'end') continue;
    ended.set(`${record.attemptId}|${record.subject ?? ''}|${record.step}`, record.seq);
  }
  return ordered.filter(showsInLog).map((record) => {
    const message = recordMessage(record);
    const closed = ended.get(`${record.attemptId}|${record.subject ?? ''}|${record.step}`);
    return {
      key: `${record.attemptId}:${String(record.seq)}`,
      at: record.at,
      agent: record.subject ?? 'compile',
      step: stepWord(record),
      message,
      tone: toneOf(message),
      more: record.ok === false ? (record.failures ?? []).slice(1) : [],
      took: tookOf(record),
      running:
        open &&
        record.state === 'begin' &&
        record.attemptId === lastAttempt &&
        (closed === undefined || closed < record.seq),
    };
  });
}
