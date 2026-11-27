// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useSyncExternalStore } from 'react';

import { plane, unwrap, wordsOf } from '../api/plane.js';
import { keys, queryClient } from '../api/queries.js';
import * as gateway from '../gateway/sdk.gen.js';
import type {
  CompileRequest,
  CompileStepRecord,
  PlaneCompileResponse,
} from '../gateway/types.gen.js';
import { settleDraft } from './drafts.js';
import { getPref, onPrefs, prefKept, prefKeys, setPref, usePrefs } from './prefs.js';

// A compile started from this browser, and its narration as it goes.
// The browser uploads the source it edited as a workspace of one file,
// beside the package the agent runs, exactly as the cli uploads a
// workspace of one agent; the plane compiles, proves and ships. The
// narration is read from the compile's own progress, asked again while
// it runs, as the cli's deploy follows it.
//
// The plane lists no compiles under way, so the browser keeps the ones
// it started, each under a key of its own for as long as it runs. Every
// window of the browser follows what is kept: the one that started a
// compile, one that was reloaded meanwhile, and one that stood open
// beside it.

/** What the reader asked for. */
export type CompileKind = 'plan' | 'deploy' | 'compile';

/** The cli's own switches of a deploy, and nothing more. */
export interface CompileSwitches {
  /** Ship without running the tests on the plane. */
  noVerify?: boolean;
  /** Write the code again from the source. */
  recompile?: boolean;
  /** Let the session write a new contract. */
  newContract?: boolean;
  /** Stop at the first failed round of tests. */
  failFast?: boolean;
}

/** One compile this browser started. */
export interface CompileRun {
  compileId: string;
  /** The compile's own call, which a cancel takes; absent until the plane stored the compile. */
  callId?: string;
  agentId: string;
  kind: CompileKind;
  /** The source that was sent: what compiles is what was sent. */
  text: string;
  /** The keys of the files chosen in the browser that went up with it:
   * they wait no more once it ships. */
  sent?: string[];
  startedAt: string;
  status: 'starting' | 'waiting' | 'running' | 'done' | 'failed';
  steps: CompileStepRecord[];
  answer?: PlaneCompileResponse;
  /** The words of what failed, when it failed before or beside its answer. */
  error?: string;
  /** This window stopped reading the compile before its end: how the
   * compile ended is not known here, and it is said so, not as a
   * failure of the compile. */
  unread?: boolean;
  /** The browser did not keep the compile, its storage full or closed
   * to this page: this window follows it, and no window opened anew
   * will know of it. It is said while the compile runs. */
  unkept?: boolean;
  endedAt?: string;
}

/** How often the narration is asked for while a compile runs. */
const ASK_EVERY_MS = 1000;
/** How long after a compile's end its progress is removed from the plane. */
const TAKE_AFTER_MS = 4 * ASK_EVERY_MS;
/** How long a read the gateway cannot answer is asked again for. */
const PATIENCE_MS = 120_000;
/** The word every kept compile's key begins with. A compile has a key
 * of its own, written once when the plane took the compile and removed
 * once at its end: no two windows rewrite one value between them. */
const KEPT = 'compile.';
/** The one list every window rewrote, before a compile had a key of its own. */
const KEPT_AS_ONE_LIST = 'compiles';

/** What the browser keeps of a compile under way: its ids and the
 * source that was sent, by which a window takes it up. */
export interface KeptCompile {
  compileId: string;
  /** The compile's own call, which its progress is asked by. */
  callId: string;
  agentId: string;
  kind: CompileKind;
  text: string;
  /** The keys of the files chosen in the browser that went up with it. */
  sent?: string[];
  startedAt: string;
}

/** The compile a kept value names; undefined for what is no compile. */
export function keptCompile(held: unknown): KeptCompile | undefined {
  if (typeof held !== 'object' || held === null) return undefined;
  const { compileId, callId, agentId, kind, text, sent, startedAt } = held as Partial<
    Record<keyof KeptCompile, unknown>
  >;
  if (typeof compileId !== 'string' || typeof callId !== 'string') return undefined;
  if (typeof agentId !== 'string') return undefined;
  if (kind !== 'plan' && kind !== 'deploy' && kind !== 'compile') return undefined;
  const keys = Array.isArray(sent)
    ? (sent as unknown[]).filter((key): key is string => typeof key === 'string')
    : [];
  return {
    compileId,
    callId,
    agentId,
    kind,
    text: typeof text === 'string' ? text : '',
    ...(keys.length === 0 ? {} : { sent: keys }),
    startedAt: typeof startedAt === 'string' ? startedAt : new Date().toISOString(),
  };
}

/**
 * The compiles of a list kept as one value that are to be kept under a
 * key each: every compile the list names that no key holds yet. What is
 * no list, and what in it is no compile, gives none.
 */
export function carriedOver(list: unknown, held: (compileId: string) => boolean): KeptCompile[] {
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).flatMap((entry) => {
    const run = keptCompile(entry);
    return run === undefined || held(run.compileId) ? [] : [run];
  });
}

/**
 * The kept compiles a window takes up: each whose agent has no compile
 * under way there, one an agent. A compile that runs in the window
 * keeps its place, and the report of one that ended gives its place to
 * the next.
 */
export function toTakeUp(
  kept: KeptCompile[],
  held: ReadonlyMap<string, Pick<CompileRun, 'compileId' | 'endedAt'>>,
): KeptCompile[] {
  const taken = new Set<string>();
  return kept.filter((entry) => {
    if (taken.has(entry.agentId)) return false;
    const run = held.get(entry.agentId);
    if (run !== undefined && (run.endedAt === undefined || run.compileId === entry.compileId)) {
      return false;
    }
    taken.add(entry.agentId);
    return true;
  });
}

const runs = new Map<string, CompileRun>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, CompileRun> = new Map();

function tell(): void {
  snapshot = new Map(runs);
  for (const listener of listeners) listener();
}

/** Changes a compile where it still stands at its agent's place. */
function change(agentId: string, compileId: string, patch: Partial<CompileRun>): void {
  const run = runs.get(agentId);
  if (run === undefined || run.compileId !== compileId) return;
  runs.set(agentId, { ...run, ...patch });
  tell();
}

/** The compiles under way that the browser keeps, every window's, the first started first. */
function kept(): KeptCompile[] {
  return prefKeys(KEPT)
    .flatMap((key) => {
      const run = keptCompile(getPref<unknown>(key, undefined));
      return run === undefined ? [] : [run];
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Whether the browser still keeps a compile: it does until a window read its end. */
function isKept(compileId: string): boolean {
  return keptCompile(getPref<unknown>(KEPT + compileId, undefined)) !== undefined;
}

/** Keeps a compile for as long as it runs, so that a reloaded window
 * and another window of this browser take it up. */
function keep(run: KeptCompile): void {
  setPref(KEPT + run.compileId, run);
}

/** Lets a compile go from what the browser keeps, once its end was read. */
function letGo(compileId: string): void {
  setPref(KEPT + compileId, undefined);
}

/** Asks the plane again for what a compile of an agent may have
 * changed: the fleet's rows carry each agent's contract, so the box
 * that calls its functions follows this one read. */
function askAfter(): void {
  void queryClient.invalidateQueries({ queryKey: keys.ls });
  void queryClient.invalidateQueries({ queryKey: keys.agents });
  void queryClient.invalidateQueries({ queryKey: ['history'] });
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function drawId(): string {
  const bytes = new Uint8Array(8);
  window.crypto.getRandomValues(bytes);
  return `compile-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Whether a deploy shipped its agent: the plane answered ok and named it among what it shipped. */
export function shipped(run: CompileRun): boolean {
  return (
    run.kind === 'deploy' &&
    run.status === 'done' &&
    run.answer?.status === 'ok' &&
    run.answer.shipped?.agents.includes(run.agentId) === true
  );
}

/** The package a deploy shipped its agent as, where the plane's answer names it. */
function shippedPackage(run: CompileRun): string | undefined {
  return run.answer?.rows.find((row) => row.agentId === run.agentId)?.artifact;
}

/**
 * Whether what a read of a compile's progress came to says the compile
 * is over for every window that follows it, or for the window that
 * asked alone. The plane's own word that it holds no such compile is
 * the first: it holds none for any window. A read that was not
 * answered, or that the plane failed, is the second: it says nothing of
 * the compile, which another window may be reading, so the window that
 * gives up leaves the compile kept for the others and for itself when
 * it is opened anew.
 */
export function endsForAll(error: unknown, compileId: string): boolean {
  return error instanceof Error && error.message.includes(`no compile "${compileId}"`);
}

/** Reads a compile's narration until it ends. */
async function follow(agentId: string, compileId: string, callId: string): Promise<void> {
  let troubleSince: number | undefined;
  for (;;) {
    const run = runs.get(agentId);
    if (run === undefined || run.compileId !== compileId) return;
    try {
      const progress = unwrap(
        await gateway.compileProgress({
          client: plane,
          path: { compileId },
          query: { call: callId },
        }),
        'the compile',
      );
      troubleSince = undefined;
      if (progress.status === 'done' || progress.status === 'failed') {
        change(agentId, compileId, {
          status: progress.status,
          steps: progress.steps,
          ...(progress.answer === undefined ? {} : { answer: progress.answer }),
          ...(progress.error === undefined ? {} : { error: progress.error.message }),
          endedAt: new Date().toISOString(),
        });
        letGo(compileId);
        // The last read removes an ended compile's progress, as the cli's
        // does. It is made a few askings later, so that every window
        // that follows the compile reads its end before it is removed.
        void wait(TAKE_AFTER_MS)
          .then(() =>
            gateway.compileProgress({
              client: plane,
              path: { compileId },
              query: { take: 'true' },
            }),
          )
          .catch(() => undefined);
        const ended = runs.get(agentId);
        if (ended !== undefined && ended.compileId === compileId && shipped(ended)) {
          settleDraft(agentId, ended.text, shippedPackage(ended), ended.sent);
        }
        askAfter();
        return;
      }
      change(agentId, compileId, { status: progress.status, steps: progress.steps });
    } catch (error) {
      // A compile the browser keeps no more was read to its end in
      // another window, and its progress was removed from the plane
      // before this window asked again (a window out of sight asks
      // seldom): it leaves this window too, and what it did shows on
      // the agent.
      if (!isKept(compileId)) {
        if (runs.get(agentId)?.compileId === compileId) {
          runs.delete(agentId);
          tell();
        }
        askAfter();
        return;
      }
      troubleSince ??= Date.now();
      if (Date.now() - troubleSince > PATIENCE_MS) {
        const over = endsForAll(error, compileId);
        change(agentId, compileId, {
          status: 'failed',
          ...(over ? {} : { unread: true }),
          error: over
            ? `The compile's progress could not be read: ${wordsOf(error)} The compile is the plane's from here; its outcome shows on the agent.`
            : `The compile's progress could not be read: ${wordsOf(error)} This window stopped asking. The compile is the plane's: its outcome shows on the agent, and a window opened anew follows it again.`,
          endedAt: new Date().toISOString(),
        });
        if (over) letGo(compileId);
        return;
      }
    }
    await wait(ASK_EVERY_MS);
  }
}

/** The files a source names, as a deploy sends them: each at its place
 * in a workspace, and the keys of the ones that waited in the browser. */
export interface Uploads {
  /** A file's place in a workspace to its bytes, as the request carries them. */
  files: Record<string, string>;
  sent: string[];
}

/**
 * Starts a compile of one agent from the source the reader edited.
 *
 * A COMPILE TAKES THE FILES A SOURCE NAMES FROM WHAT IS SENT, as it
 * takes them from a workspace the cli sends. So the source goes up with
 * every file it names, gathered when the compile starts: a failure to
 * gather one fails the compile here, in words, before anything is sent.
 *
 * @param base - The package the agent runs, which the compile amends; none for a new agent.
 * @param uploads - Gathers the files the source names; none for a source that names no file.
 */
export function startCompile(options: {
  agentId: string;
  text: string;
  base: string | undefined;
  kind: CompileKind;
  switches?: CompileSwitches;
  uploads?: () => Promise<Uploads>;
}): void {
  const { agentId, text, base, kind, switches = {}, uploads } = options;
  // A compile of the agent that the browser keeps still runs: a second
  // one is not started beside it, whatever this window shows of the first.
  if (keptFor(kept(), agentId)) return;
  const compileId = drawId();
  const startedAt = new Date().toISOString();
  runs.set(agentId, { compileId, agentId, kind, text, startedAt, status: 'starting', steps: [] });
  tell();
  void (async () => {
    try {
      const carried = uploads === undefined ? { files: {}, sent: [] } : await uploads();
      const sent = carried.sent.length === 0 ? {} : { sent: carried.sent };
      change(agentId, compileId, sent);
      const request: CompileRequest = {
        protocol: 0,
        op: 'compile.run',
        compileId,
        targets: [agentId],
        // The source last: no file a source names takes the source's own place.
        files: { ...carried.files, [`${agentId}.cern.md`]: base64(text) },
        ...(base === undefined ? {} : { packages: { [agentId]: base } }),
        ...(kind === 'plan' ? { planOnly: true } : {}),
        ...(kind === 'deploy' && switches.noVerify !== true ? { verify: true } : {}),
        ...(switches.recompile === true ? { recompile: true } : {}),
        ...(switches.newContract === true ? { newContract: true } : {}),
        ...(switches.failFast === true ? { maxLiveCycles: 0 } : {}),
      };
      const started = unwrap(
        kind === 'deploy'
          ? await gateway.deploy({ client: plane, body: request })
          : await gateway.compile({ client: plane, body: request }),
        'the compile',
      );
      // From here the plane holds the compile, and the browser keeps it.
      // Where the browser did not take it, this window alone knows of
      // the compile, and says so for as long as it runs.
      keep({ compileId, callId: started.callId, agentId, kind, text, ...sent, startedAt });
      change(agentId, compileId, {
        callId: started.callId,
        status: 'waiting',
        ...(prefKept(KEPT + compileId) ? {} : { unkept: true }),
      });
      await follow(agentId, compileId, started.callId);
    } catch (error) {
      change(agentId, compileId, {
        status: 'failed',
        error: wordsOf(error),
        endedAt: new Date().toISOString(),
      });
    }
  })();
}

/** Ends a compile's call, as the cli's `cancel` does. */
export async function cancelCompile(agentId: string): Promise<void> {
  const run = runs.get(agentId);
  if (run?.callId === undefined) return;
  unwrap(await gateway.cancel({ client: plane, path: { callId: run.callId } }), 'the cancel');
}

/** Lets an ended compile go from the screen. */
export function dismissCompile(agentId: string): void {
  const run = runs.get(agentId);
  if (run === undefined || run.endedAt === undefined) return;
  runs.delete(agentId);
  tell();
}

/** Takes up again, in this window, a compile it stopped reading while
 * the browser still keeps it. */
export function followAgain(agentId: string): void {
  const run = runs.get(agentId);
  if (run?.unread !== true) return;
  runs.delete(agentId);
  tell();
  takeUp();
}

/** Whether a compile of an agent is among what the browser keeps. */
export function keptFor(kept: Iterable<unknown>, agentId: string): boolean {
  for (const held of kept) {
    if (keptCompile(held)?.agentId === agentId) return true;
  }
  return false;
}

/**
 * Whether the browser keeps a compile of an agent: one runs, started in
 * this window or in another, until a window reads its end. A second one
 * of the same agent waits for it in every window, the window that
 * stopped reading it among them: that it cannot be read from one window
 * does not say it is over.
 */
export function useKeptCompile(agentId: string): boolean {
  return keptFor(Object.values(usePrefs<unknown>(KEPT)), agentId);
}

/** Takes up the compiles the browser keeps and this window does not
 * follow yet: what a reloaded window left under way, and what another
 * window of this browser started. */
function takeUp(): void {
  const fresh = toTakeUp(kept(), runs);
  if (fresh.length === 0) return;
  for (const entry of fresh) runs.set(entry.agentId, { ...entry, status: 'waiting', steps: [] });
  tell();
  for (const entry of fresh) void follow(entry.agentId, entry.compileId, entry.callId);
}

/**
 * Carries the compiles a window kept as one list under a key each, and
 * forgets the list once the browser took every one of them. A compile
 * that ended meanwhile is let go at the plane's word that it holds none
 * such, as any compile is.
 */
function carryOver(): void {
  const list = getPref<unknown>(KEPT_AS_ONE_LIST, undefined);
  if (list === undefined) return;
  let taken = true;
  for (const run of carriedOver(list, isKept)) {
    keep(run);
    taken &&= prefKept(KEPT + run.compileId);
  }
  if (taken) setPref(KEPT_AS_ONE_LIST, undefined);
}

if (typeof window !== 'undefined') {
  carryOver();
  takeUp();
  onPrefs(KEPT, takeUp);
}

/** The compiles this browser started, by agent id. */
export function useCompiles(): ReadonlyMap<string, CompileRun> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
  );
}

/** One row of a compile's narration: a step, begun and maybe ended. */
export interface StepRow {
  key: string;
  subject: string | undefined;
  step: string;
  detail: string;
  state: 'running' | 'ok' | 'failed' | 'note';
  durationMs: number | undefined;
  attempt: number | undefined;
  failures: { name: string; message: string }[];
  notes: string[];
  at: string;
}

/** An agent a compile installed from the registry on its way. */
export interface InstalledOnTheWay {
  agentId: string;
  /** The version the landing named; "unknown" where it named none. */
  version: string;
}

/**
 * The agents a compile installed from the registry on its way, as its
 * own narration notes them. A source that grants a published agent the
 * plane does not run has it installed before anything else, and a plan
 * does so as a deploy does: so a plan that says nothing was written
 * still says what was installed. The sentence read is the compiler's
 * own; a narration that says it otherwise answers none here, and the
 * note still stands among the steps.
 */
export function installedOnTheWay(steps: CompileStepRecord[]): InstalledOnTheWay[] {
  const found = new Map<string, string>();
  for (const record of steps) {
    const told = /^(\S+): not in the workspace; installed from the registry at (\S+)/.exec(
      record.detail,
    );
    if (told !== null) found.set(told[1] ?? '', told[2] ?? 'unknown');
  }
  return [...found].map(([agentId, version]) => ({ agentId, version }));
}

/** The step a compile is at: the last that runs. An agent's own line
 * holds the steps and is none of them, so it is never the step named. */
export function stepAt(rows: StepRow[]): string | undefined {
  return rows.findLast((row) => row.state === 'running' && row.step !== 'agent')?.step;
}

/** A compile's steps as rows: a step's end closes the row its begin
 * opened, and a note stands under the step it speaks of. */
export function stepRows(steps: CompileStepRecord[]): StepRow[] {
  const rows: StepRow[] = [];
  const open = new Map<string, StepRow>();
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  for (const record of ordered) {
    const slot = `${record.subject ?? ''}|${record.step}`;
    if (record.state === 'begin') {
      const row: StepRow = {
        key: `${record.attemptId}:${String(record.seq)}`,
        subject: record.subject,
        step: record.step,
        detail: record.detail,
        state: 'running',
        durationMs: undefined,
        attempt: record.attempt,
        failures: [],
        notes: [],
        at: record.at,
      };
      rows.push(row);
      open.set(slot, row);
      continue;
    }
    if (record.state === 'end') {
      const row = open.get(slot);
      const failed = record.ok === false || record.result === 'failed';
      if (row !== undefined) {
        row.state = failed ? 'failed' : 'ok';
        row.durationMs = record.durationMs;
        if (record.detail !== '') row.detail = record.detail;
        row.failures = record.failures ?? [];
        open.delete(slot);
      } else {
        rows.push({
          key: `${record.attemptId}:${String(record.seq)}`,
          subject: record.subject,
          step: record.step,
          detail: record.detail,
          state: failed ? 'failed' : 'ok',
          durationMs: record.durationMs,
          attempt: record.attempt,
          failures: record.failures ?? [],
          notes: [],
          at: record.at,
        });
      }
      continue;
    }
    const row = open.get(slot);
    if (row !== undefined) {
      row.notes.push(record.detail);
    } else {
      rows.push({
        key: `${record.attemptId}:${String(record.seq)}`,
        subject: record.subject,
        step: record.step,
        detail: record.detail,
        state: 'note',
        durationMs: record.durationMs,
        attempt: record.attempt,
        failures: record.failures ?? [],
        notes: [],
        at: record.at,
      });
    }
  }
  return rows;
}
