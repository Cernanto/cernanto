// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { run } from 'node:test';
import { fileURLToPath } from 'node:url';

import { processFacts, setProcessFacts } from './kernel/facts.js';
import type { ProcessFacts } from './kernel/facts.js';
import { closeSubstrate } from './kernel/connection.js';
import { currentExecution, nextTraceSequence } from './kernel/execution.js';
import { encodeJson } from './kernel/json.js';
import { boundedRecord } from './traces/sink.js';
import { emitTrace, setTraceSink, traceRecordSchema } from './traces/trace.js';
import type { TraceRecord } from './traces/trace.js';

/** The verdict a tester agent answers: how many tests passed and the
 * failures, each with the test's name and a message saying what was
 * expected and what came back. */
export interface TesterResult {
  passed: number;
  failures: { name: string; message: string }[];
}

/** One test runner event as node:test streams it: the fields the
 * verdict reads. */
interface TestEvent {
  type: string;
  data: {
    name?: string;
    file?: string;
    nesting?: number;
    details?: { type?: string; error?: unknown; duration_ms?: number };
    /** Set on a test node skipped or marked todo, the reason when one was given. */
    skip?: boolean | string;
    todo?: boolean | string;
  };
}

/** Why node marked a test skipped or todo, or nothing for a test that ran. */
function skipReasonOf(data: {
  skip?: boolean | string;
  todo?: boolean | string;
}): string | undefined {
  if (data.skip !== undefined && data.skip !== false) {
    return typeof data.skip === 'string' ? data.skip : 'no reason given';
  }
  if (data.todo !== undefined && data.todo !== false) {
    return typeof data.todo === 'string' ? `todo: ${data.todo}` : 'todo';
  }
  return undefined;
}

function tookOf(details: { duration_ms?: number } | undefined): string {
  const ms = details?.duration_ms;
  if (ms === undefined || !Number.isFinite(ms)) return '';
  return ms < 1000 ? `  ${String(Math.round(ms))}ms` : `  ${(ms / 1000).toFixed(1)}s`;
}

function messageOf(error: unknown): string {
  // node:test wraps an assertion in a TestError whose cause is the
  // assertion itself; the cause carries the words the test wrote.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

// The suite as a child: the tester of a package is a task whose one
// function `run` spawns node's test runner as a child process; the
// tests' calls of the target ride the plain wire from outside any
// call as the tester's run (the child's facts carry the run's
// call id: the callee's records name the run, the call's boundary is
// recorded under it and rides the child's pipe up to the tester, which
// files it in the run's own sequence), unjournaled and unretried, so a
// call that fails fails the test. The suite runs once for each attempt
// of the tester's call: an attempt that is retried runs it again, under
// ids of its own.

/** The line the child prints last: its verdict, as JSON after it. */
const VERDICT_PREFIX = 'VERDICT ';
/** A line the child prints for each record it writes, the record as
 * JSON after it: the parent files it under the run. */
const RECORD_PREFIX = 'RECORD ';

/**
 * Runs the suite beside the given directory url once per call: the
 * tester's generated `run` calls this. A retried attempt runs the
 * suite again, with fresh ids.
 */
export function runSuiteOnce(directory: URL | string): Promise<TesterResult> {
  return runSuiteInChild(directory);
}

/**
 * Spawns the suite runner the materialize wrote beside the tests
 * (`suite.js`) as a child of this call, hands it this process's
 * facts, forwards its lines to this console (the tester's console is
 * the record of its run: whoever watches sees the tests pass one by
 * one) and answers the verdict it prints last. A child that ends
 * without a verdict is one failure carrying its exit and its last
 * words.
 */
export async function runSuiteInChild(directory: URL | string): Promise<TesterResult> {
  const dir = directory instanceof URL ? fileURLToPath(directory) : directory;
  const script = join(dir, 'suite.js');
  const facts = JSON.stringify(processFactsForChild());
  const child = spawn(process.execPath, [script, facts], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let verdict: TesterResult | undefined;
  const stderr: string[] = [];
  // The records the child writes ride its pipe up here and are filed
  // under this run in this process's own sequence (a call's begin and
  // its end keep one number); every other line is the tests' console,
  // forwarded as it is.
  const execution = currentExecution();
  const seqs = new Map<number, number>();
  const lines = lineReader((line) => {
    if (line.startsWith(VERDICT_PREFIX)) {
      verdict = parseVerdict(line.slice(VERDICT_PREFIX.length));
      return;
    }
    if (line.startsWith(RECORD_PREFIX)) {
      const record = parseRecord(line.slice(RECORD_PREFIX.length));
      if (record !== undefined) {
        emitTrace(
          execution === undefined
            ? record
            : childRecordForwarded(record, seqs, () => nextTraceSequence(execution.trace)),
        );
        return;
      }
    }
    console.log(line);
  });
  child.stdout.on('data', (data: Buffer) => {
    lines.feed(data.toString('utf8'));
  });
  child.stderr.on('data', (data: Buffer) => {
    const text = data.toString('utf8');
    stderr.push(text);
    if (stderr.length > 200) stderr.shift();
    process.stderr.write(text);
  });
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => {
        lines.end();
        resolve({ code, signal });
      });
    },
  );
  if (verdict !== undefined) return verdict;
  const tail = stderr.join('').trim().split('\n').slice(-12).join('\n');
  return {
    passed: 0,
    failures: [
      {
        name: 'suite',
        message:
          `the suite ended without a verdict (exit ${exit.code === null ? String(exit.signal) : String(exit.code)})` +
          (tail === '' ? '' : `\n${tail}`),
      },
    ],
  };
}

/** A record the suite child handed up, renumbered into the parent's
 * sequence: the child's numbers pair a call's begin with its end, and
 * each maps to one of the parent's, taken at first sight. */
export function childRecordForwarded(
  record: TraceRecord,
  seqs: Map<number, number>,
  next: () => number,
): TraceRecord {
  let seq = seqs.get(record.seq);
  if (seq === undefined) {
    seq = next();
    seqs.set(record.seq, seq);
  }
  return { ...record, seq };
}

/** The record a child's line carries, or nothing for a line that is
 * not one (the tests' own console, whatever it printed). */
function parseRecord(text: string): TraceRecord | undefined {
  try {
    const parsed = traceRecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The facts the child needs: its reach and its identity. */
function processFactsForChild(): ProcessFacts {
  const facts = processFacts();
  // The run this child belongs to: its calls carry the run as their
  // caller and record their boundary under it.
  const run = currentExecution()?.context.callId;
  return {
    ...(run === undefined ? {} : { callId: run }),
    ...(facts.substrate === undefined ? {} : { substrate: facts.substrate }),
    ...(facts.root === undefined ? {} : { root: facts.root }),
    ...(facts.plane === undefined ? {} : { plane: facts.plane }),
    ...(facts.substrateUrl === undefined ? {} : { substrateUrl: facts.substrateUrl }),
    ...(facts.agentId === undefined ? {} : { agentId: facts.agentId }),
    ...(facts.generationPort === undefined ? {} : { generationPort: facts.generationPort }),
    // A verification form's identity: the suite's calls state the agent
    // the tester stands for, as the tester's own do, so a callee that
    // keeps a place per agent reads the tester's place for them.
    ...(facts.form === undefined ? {} : { form: facts.form }),
    ...(facts.testOf === undefined ? {} : { testOf: facts.testOf }),
    ...(facts.target === undefined ? {} : { target: facts.target }),
  };
}

function parseVerdict(text: string): TesterResult {
  const parsed = JSON.parse(text) as { passed?: unknown; failures?: unknown };
  const failures = Array.isArray(parsed.failures)
    ? parsed.failures.map((entry) => {
        const failure = entry as { name?: unknown; message?: unknown };
        return {
          name: typeof failure.name === 'string' ? failure.name : 'unnamed check',
          message: typeof failure.message === 'string' ? failure.message : JSON.stringify(entry),
        };
      })
    : [];
  return { passed: typeof parsed.passed === 'number' ? parsed.passed : 0, failures };
}

/** Splits a stream into lines, the last partial line delivered at the end. */
function lineReader(onLine: (line: string) => void): {
  feed: (text: string) => void;
  end: () => void;
} {
  let rest = '';
  return {
    feed(text) {
      rest += text;
      let at = rest.indexOf('\n');
      while (at !== -1) {
        onLine(rest.slice(0, at));
        rest = rest.slice(at + 1);
        at = rest.indexOf('\n');
      }
    },
    end() {
      if (rest !== '') onLine(rest);
      rest = '';
    },
  };
}

/**
 * The child's whole life: the suite runner the materialize wrote calls
 * this with its own directory and the facts its parent handed it. It
 * joins the plane with those facts (a stub's call outside any
 * call takes the plain wire when the substrate is known), runs
 * every test file beside it in this process, prints each verdict as
 * it lands, prints the verdict line last, and exits.
 */
export async function runSuiteChild(directory: URL | string, facts: ProcessFacts): Promise<never> {
  setProcessFacts(facts);
  // What the tests' calls record rides the pipe to the parent, one line
  // per record, and the parent files it under the run. A record is
  // bounded here as the sink bounds it, so the pipe carries lines of a
  // bounded size.
  setTraceSink({
    record(record) {
      process.stdout.write(`${RECORD_PREFIX}${encodeJson(boundedRecord(record))}\n`);
    },
  });
  const dir = directory instanceof URL ? fileURLToPath(directory) : directory;
  let result: TesterResult;
  try {
    result = await runFiles(dir, dir);
  } catch (error) {
    result = {
      passed: 0,
      failures: [
        { name: 'suite', message: error instanceof Error ? error.message : String(error) },
      ],
    };
  }
  console.log(`${VERDICT_PREFIX}${JSON.stringify(result)}`);
  await closeSubstrate().catch(() => undefined);
  // Everything written to the pipe reaches the parent before the exit:
  // a pipe's writes are queued, and an exit with the queue still full
  // would cut a record short and lose the verdict behind it.
  await new Promise<void>((resolve) => {
    process.stdout.write('', () => {
      resolve();
    });
  });
  process.exit(0);
}

/** The file run after the suite's own, whose teardown says that every
 * teardown before it has run (suite-end.ts). The runner hands it to
 * node by its path and never imports it: a hook registered from the
 * runner's own module would be a test of this process. */
const SUITE_END_FILE = fileURLToPath(new URL('./suite-end.js', import.meta.url));
/** The name the last file finds the runner's signal under. */
const SUITE_END_SIGNAL = Symbol.for('cernanto.suite-end');

/** How long the files' teardowns are waited for once every test is
 * over. One that is still running then fails the suite: nobody knows
 * what it would have said. */
const TEARDOWN_PATIENCE_MS = 30_000;

/** Why node failed a test or a suite: its own code, a hook of it, or
 * the tests inside it. */
function failureTypeOf(error: unknown): string | undefined {
  const type = (error as { failureType?: unknown } | null)?.failureType;
  return typeof type === 'string' ? type : undefined;
}

/** Runs every test file in `root` in this process through node's test
 * runner, printing each verdict as it lands; `original` names the
 * directory in the words of an empty run. A hook that fails counts as
 * a failure of its suite, or of its file when it stands at the file's
 * top level: the teardowns run once every test is over, and the verdict
 * waits for them. A teardown that has not ended when the patience is
 * over is a failure too. */
async function runFiles(root: string, original: string): Promise<TesterResult> {
  const files = readdirSync(root)
    .filter((name) => name.endsWith('.test.js') || name.endsWith('.test.mjs'))
    .sort()
    .map((name) => join(root, name));
  const result: TesterResult = { passed: 0, failures: [] };
  if (files.length === 0) {
    result.failures.push({ name: 'tests', message: `no test files found in ${original}` });
    return result;
  }
  const signals = globalThis as Record<symbol, unknown>;
  const tornDown = new Promise<'torn down'>((resolve) => {
    signals[SUITE_END_SIGNAL] = (): void => {
      resolve('torn down');
    };
  });
  const stream = run({
    files: [...files, SUITE_END_FILE],
    isolation: 'none',
    concurrency: 1,
  }) as AsyncIterable<TestEvent>;
  const events = stream[Symbol.asyncIterator]();
  let topLevel = 0;
  let topLevelDone = 0;
  let testsOver = false;
  let patience: Promise<'patience'> | undefined;
  let patienceTimer: NodeJS.Timeout | undefined;
  for (;;) {
    // Once every test is over, the runner says nothing more unless a
    // teardown fails: the last file's own teardown says they all ran.
    const step = testsOver
      ? await Promise.race([events.next(), tornDown, patience])
      : await events.next();
    if (step === 'torn down' || step === undefined) break;
    if (step === 'patience') {
      const message = `the suite's teardown was still running ${String(TEARDOWN_PATIENCE_MS / 1000)}s after its last test ended; a teardown that does not end fails the suite`;
      result.failures.push({ name: 'teardown', message });
      console.log(`✖ teardown: ${message}`);
      break;
    }
    if (step.done === true) break;
    const event = step.value;
    // The last file is the runner's own: it holds no test.
    if (event.data.file === SUITE_END_FILE || event.data.name === SUITE_END_FILE) continue;
    const top = event.data.nesting === 0;
    if (top && event.type === 'test:enqueue') topLevel += 1;
    // Suites report the tally of their children; only the tests
    // count (a file that failed to import reports as a test named
    // after the file, carrying the import error).
    const suite = event.data.details?.type === 'suite';
    // Each test's verdict prints the moment it lands: the tester's
    // console is a log record of its run, so whoever watches the run (a
    // deploy, `cernanto trace -f`) sees the tests pass one by one
    // instead of one verdict at the end.
    if (event.type === 'test:pass') {
      if (!suite) {
        const name = event.data.name ?? event.data.file ?? 'test';
        const skipped = skipReasonOf(event.data);
        // A skipped or todo test reports as passed to node; here it is
        // a failure: a scenario the tests could not drive is a finding
        // the compile must hear.
        if (skipped !== undefined) {
          const message = `skipped: ${skipped}; a test never skips, a scenario the tests cannot drive fails with what is missing`;
          result.failures.push({ name, message });
          console.log(`✖ ${name}: skipped: ${skipped}${tookOf(event.data.details)}`);
        } else {
          result.passed += 1;
          console.log(`✔ ${name}${tookOf(event.data.details)}`);
        }
      }
      if (top) topLevelDone += 1;
    } else if (event.type === 'test:fail') {
      const failed = failureTypeOf(event.data.details?.error);
      // A suite that failed for the tests inside it says what they
      // already said; one that failed by itself (a hook of it, its own
      // body) is a failure of its own.
      if (!suite || failed !== 'subtestsFailed') {
        const named = event.data.name ?? event.data.file ?? 'test';
        // A hook at a file's top level fails under the file's path.
        const name = files.includes(named) ? basename(named) : named;
        const message = messageOf(event.data.details?.error);
        result.failures.push({ name, message });
        console.log(`✖ ${name}: ${message.split('\n')[0] ?? ''}${tookOf(event.data.details)}`);
      }
      if (top && event.data.details?.type !== undefined) topLevelDone += 1;
      // A teardown at a file's top level that fails ends the teardowns:
      // the ones after it do not run, and nothing more is said.
      if (testsOver && failed === 'hookFailed' && event.data.details?.type === undefined) break;
    }
    if (!testsOver && topLevel > 0 && topLevelDone >= topLevel) {
      testsOver = true;
      patience = new Promise<'patience'>((resolve) => {
        patienceTimer = setTimeout(() => {
          resolve('patience');
        }, TEARDOWN_PATIENCE_MS);
      });
    }
  }
  if (patienceTimer !== undefined) clearTimeout(patienceTimer);
  signals[SUITE_END_SIGNAL] = undefined;
  return result;
}
