// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The process adapter: every question about the machine's processes is
// answered here, once, for the runtime, the host job and the cli. What
// runs under a process, whether a pid is still the process that was
// written down, and every end of processes: of what a command started,
// and of a recorded process with what its launch left. How much a
// process uses is no question for a read: a process counts its own
// memory and processor time (idle.ts). The rows come from the reader
// of this system
// (process-readers.ts); the rules below are the same on every system
// and go by what the reader says its system does.
//
// The contract, each clause held by a proof of the shared suite:
//  1. A fresh read: every answer comes from a read made after the ask.
//  2. A sample or a failure: a sample holds this process itself; a
//     read that does not, an empty one among them, is a failure. A row
//     that is absent says nothing by itself: that a process is gone is
//     the system's own answer for its pid. A process the system says
//     is there while the read shows no row for it, or tells no start
//     for it, is unverified: it is sent nothing, nothing is taken
//     under it, and it is never counted as gone.
//  3. Owned by birth, by group and by the word: a command owns its
//     process, what descends from it, the group it leads where the
//     system has groups, and whatever carries the word laid into its
//     environment where the read shows environments.
//  4. Ownership is kept, in order: what was once owned stays owned
//     until it is gone, remembered by its pid and its start; every
//     read first checks the remembered and only then grows.
//  5. A written pid carries its boot: it is honored while the read
//     answers the same start under the same boot.
//  6. One stop: every end of processes is THE STOP below. Whoever asks
//     hands it what is owned and how the end is made (the grace, the
//     program's own word, an end at once) and takes its result: a
//     return when nothing owned is left, a failure that says what is
//     left otherwise. Nobody signals in its place.
//
// A check and the signal after it are two calls: the proof stands
// before every signal, and the moment between them stays.

import { setTimeout as realDelay } from 'node:timers/promises';

import { wallElapsedMs } from './clock.js';
import { reader } from './process-readers.js';
import type { ProcessReader, ProcessRow, TableFacts } from './process-readers.js';
import type { EndAnswer, MeasureAnswer } from './seam.js';

export type { ProcessRow, TableFacts } from './process-readers.js';

/** A read of now: the rows, this boot's identity, and what the reader
 * says of its system. */
export interface Sample {
  rows: ProcessRow[];
  boot: string;
  facts: TableFacts;
}

/** A read that failed, or that is no sample of this machine. */
export class ProcessReadFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessReadFailure';
  }
}

/** A stop that may signal nothing: a group it would reach holds a
 * process of another user. */
export class OwnershipRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnershipRefused';
  }
}

const unshownWords = (pids: readonly number[]): string =>
  `processes the read does not vouch for while the system says they run: ${pids.join(', ')}; what became of them is not known`;

/** A stop after which something owned still runs. */
export class StopLeftRunning extends Error {
  /** What a read still shows after the kill. */
  readonly pids: number[];
  /** What no read vouches for beside them, while the system says it
   * runs. */
  readonly unverified: number[];
  /** Every process a signal went to. */
  readonly signalled: number[];
  constructor(pids: number[], unverified: number[] = [], signalled: number[] = []) {
    super(
      [
        `processes that would not end: ${pids.join(', ')}`,
        ...(unverified.length === 0 ? [] : [unshownWords(unverified)]),
      ].join('; '),
    );
    this.name = 'StopLeftRunning';
    this.pids = pids;
    this.unverified = unverified;
    this.signalled = signalled;
  }
}

/** A stop that cannot say what became of something it owned. The
 * system says a process is at a pid and no read vouches for it, so it
 * was neither proven the owned one nor proven gone; or a command ended
 * before any read showed it, so what it had started was never looked
 * for. Such a stop sent those pids nothing, and is no success. */
export class StopUnverified extends Error {
  /** What no read vouches for while the system says it runs. */
  readonly pids: number[];
  /** The commands that ended before any read showed them. */
  readonly unseen: number[];
  /** Every process a signal went to. */
  readonly signalled: number[];
  constructor(pids: number[], unseen: number[] = [], signalled: number[] = []) {
    super(
      [
        ...(pids.length === 0 ? [] : [unshownWords(pids)]),
        ...(unseen.length === 0
          ? []
          : [
              `commands that ended before any read showed them: ${unseen.join(', ')}; what they had started was not looked for`,
            ]),
      ].join('; '),
    );
    this.name = 'StopUnverified';
    this.pids = pids;
    this.unseen = unseen;
    this.signalled = signalled;
  }
}

/** A fresh read of the machine's processes, held to be a sample: it
 * names this process, or it is a failure said as one. */
export async function sample(
  options: { environment?: boolean | undefined } = {},
  from: ProcessReader = reader,
): Promise<Sample> {
  let rows: ProcessRow[];
  let boot: string;
  try {
    [rows, boot] = await Promise.all([
      from.read({ environment: options.environment === true }),
      from.boot(),
    ]);
  } catch (error) {
    throw new ProcessReadFailure(
      `the processes cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (rows.length === 0) throw new ProcessReadFailure('the read of the processes brought nothing');
  if (!rows.some((row) => row.pid === process.pid))
    throw new ProcessReadFailure('the read of the processes does not hold this process');
  return { rows, boot, facts: from.facts };
}

/** Whether a process is at a pid, by Node's own answer: a signal the
 * system refuses for another user's process says one is there. */
export function present(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What a pid is written down with: this boot's identity, and the
 * process's start where the read tells one. The one lookup of it: a
 * start the read does not tell is left out, never written as an empty
 * one, which would read as another process's to whoever compares it
 * with a read's. */
export interface Identity {
  started?: string;
  boot: string;
}

export async function identityOf(pid: number, from: ProcessReader = reader): Promise<Identity> {
  const [rows, boot] = await Promise.all([from.read({ pid }), from.boot()]);
  const row = rows.find((one) => one.pid === pid);
  return row === undefined || row.started === '' ? { boot } : { started: row.started, boot };
}

/** Whether a row that names a parent's pid is that process's child:
 * by the pid where a named parent is a live one, and by the starts as
 * well where a child goes on naming a parent that ended. */
function childOf(row: ProcessRow, parent: ProcessRow, facts: TableFacts): boolean {
  return (
    row.parent === parent.pid &&
    (!facts.endedParents || facts.startedNotBefore(row.started, parent.started))
  );
}

/** The seeds and everything that descends from them, each after its
 * parent, as far as `may` lets a row be taken. */
function descentFrom(
  rows: readonly ProcessRow[],
  seeds: readonly ProcessRow[],
  facts: TableFacts,
  may: (row: ProcessRow) => boolean = () => true,
): ProcessRow[] {
  const tree: ProcessRow[] = [];
  const taken = new Set<number>();
  for (const seed of seeds) {
    if (taken.has(seed.pid)) continue;
    taken.add(seed.pid);
    tree.push(seed);
  }
  for (const parent of tree) {
    for (const row of rows) {
      if (taken.has(row.pid) || !childOf(row, parent, facts) || !may(row)) continue;
      taken.add(row.pid);
      tree.push(row);
    }
  }
  return tree;
}

/** A process and everything it started, theirs too, read off the rows:
 * the process itself first, each after its parent. Empty when the rows
 * do not list it. */
export function treeUnder(
  rows: readonly ProcessRow[],
  root: number,
  facts: TableFacts,
): ProcessRow[] {
  const first = rows.find((row) => row.pid === root);
  return first === undefined ? [] : descentFrom(rows, [first], facts);
}

/** A process that was written down: its pid, and the start and the
 * boot beside it as far as the record has them. */
export interface Recorded {
  pid: number;
  started?: string | undefined;
  boot?: string | undefined;
}

/** What a read says of a recorded process. THE SAME: a process is at
 * the pid with the record's start, under the record's boot. ANOTHER:
 * the read tells a start or a boot that is not the record's. GONE: no
 * process is at the pid, by Node's own answer and never by an absent
 * row. UNKNOWN: a process is there and the read tells no start for it,
 * or the record is not whole yet. */
export type Answer = 'same' | 'another' | 'gone' | 'unknown';

export function answerOf(
  recorded: Recorded,
  now: Sample,
  isPresent: (pid: number) => boolean = present,
): Answer {
  if (!isPresent(recorded.pid)) return 'gone';
  const whole =
    recorded.started !== undefined &&
    recorded.started !== '' &&
    recorded.boot !== undefined &&
    recorded.boot !== '';
  if (!whole) return 'unknown';
  if (now.boot !== recorded.boot) return 'another';
  const row = now.rows.find((one) => one.pid === recorded.pid);
  if (row === undefined || row.started === '') return 'unknown';
  return row.started === recorded.started ? 'same' : 'another';
}

/** The words of an environment a row is found by. */
function carries(row: ProcessRow, words: readonly string[]): boolean {
  const environment = row.environment;
  return environment !== undefined && words.some((word) => environment.includes(word));
}

/** What is owned at one read: the rows, the groups among them that are
 * owned whole, and why nothing may be signalled when a group holds a
 * process of another user. */
export interface OwnedNow {
  /** What the read shows and proves owned: what a signal may go to. */
  rows: ProcessRow[];
  groups: number[];
  /** What is owned and that the read does not vouch for, while the
   * system says a process is at the pid: the read shows no row for it,
   * or tells no start for it. Neither proven the owned one nor proven
   * gone: nothing is sent to such a pid, nothing is taken under it,
   * and it is never counted as gone. */
  unverified: number[];
  /** The commands that ended before any read showed them, said once:
   * what they had started was never looked for. */
  lost: number[];
  refused?: string;
}

/** What an ownership is made of. */
export interface OwnershipOptions {
  /** The pids of the commands that still run, each one held by its
   * handle at the moment it is asked. */
  roots?: (() => number[]) | undefined;
  /** The words (`NAME=value`) laid into the environment of what is
   * owned. */
  words?: readonly string[] | undefined;
  /** Whether what runs as another user is left alone: the commands of
   * a call. A recorded copy's tree is taken whoever runs it. */
  sameUser?: boolean | undefined;
  /** The user whose processes are this owner's: this process's own,
   * where the system names users, when none is given. */
  user?: number | undefined;
  /** Pids that are never taken, with their groups: the asker's own. */
  spare?: readonly number[] | undefined;
  /** Groups taken as owned whole at the first read alone, by their
   * keeper's own knowledge: the group a command led, read at the
   * moment the command left, while a process of it is listed. After
   * that read a group is kept by its remembered members like any
   * other. */
  groups?: readonly number[] | undefined;
  /** A recorded process whose launch this owner ends. Where a child
   * goes on naming a parent that ended, what descends from it is owned
   * while its pid is free or is still that process, for a record of
   * this boot alone: a record of another boot, or of none, names no
   * process of this one. The process itself is owned only when it is
   * remembered. */
  under?: Recorded | undefined;
}

/** What is remembered of an owned process: its start, empty when no
 * read told one, and the group it was taken with when that group is
 * owned whole. */
interface Remembered {
  started: string;
  group: number | undefined;
}

/** What a command, or a recorded process, owns over the reads of its
 * stop, however often that stop is asked: clause 3 at each read, kept
 * by clause 4 between them. */
export class Ownership {
  private readonly roots: () => number[];
  private readonly words: readonly string[];
  private readonly sameUser: boolean;
  private readonly user: number | undefined;
  private readonly spare: readonly number[];
  private readonly under: Recorded | undefined;
  private firstGroups: readonly number[];
  /** What was found owned, by pid. */
  private remembered = new Map<number, Remembered>();
  /** The commands no read has shown yet while their handles said they
   * ran. */
  private unseen = new Set<number>();

  constructor(options: OwnershipOptions = {}) {
    this.roots = options.roots ?? ((): number[] => []);
    this.words = options.words ?? [];
    this.sameUser = options.sameUser === true;
    this.user = options.user ?? process.getuid?.();
    this.spare = options.spare ?? [];
    this.under = options.under;
    this.firstGroups = options.groups ?? [];
  }

  /** Whether the reads this ownership takes ask for environments. */
  get wantsEnvironment(): boolean {
    return this.words.length > 0;
  }

  /** A process owned from the start by what was written of it: its pid
   * and its start, checked like everything remembered. */
  remember(pid: number, started: string): void {
    this.remembered.set(pid, { started, group: undefined });
  }

  /** A read that failed. What a keeper knows of a group holds for the
   * read made at the moment it was handed over alone, and is as old as
   * that moment: it is not carried to a later read. */
  missed(): void {
    this.firstGroups = [];
  }

  /** One read used in two steps. First the remembered are checked, and
   * each is one of three things. THERE: the read shows it with its
   * start, and it stays owned. ENDED: the read shows it ended, or
   * shows another start at its pid, or shows no row and the system
   * says no process is at the pid; it is forgotten, and nothing under
   * it or in its group is taken. UNVERIFIED: the system says a process
   * is at the pid and the read shows no row for it, or tells no start
   * for it; that is no word that it ended, so it stays remembered, is
   * answered apart, and nothing is taken under it or by its group in
   * this read. Then ownership grows, by birth and by group only from
   * the commands' own processes and from the remembered that are
   * there, and by the word wherever the read shows it. A command whose
   * handle says it runs and that the read does not show is unverified
   * too, and one that ends before any read showed it is said once as
   * lost. WHAT RUNS AS ANOTHER USER IS LEFT ALONE AT EVERY READ, where
   * the owner leaves such processes alone: one that was owned and that
   * this read shows under another user is sent nothing and nothing is
   * taken through it, exactly as one found that way at first, and it
   * is owned again only when a read shows it as this user's. A group
   * that holds another user's process is refused whole; what was found
   * of this user's is remembered all the same, since it is owned and
   * only the signal is withheld. */
  take(now: Sample, isPresent: (pid: number) => boolean = present): OwnedNow {
    const facts = now.facts;
    const shown = new Map(now.rows.map((row) => [row.pid, row]));
    const living = now.rows.filter((row) => !row.zombie);
    const byPid = new Map(living.map((row) => [row.pid, row]));
    const mine = this.user;
    const others = (row: ProcessRow): boolean =>
      mine !== undefined && row.user !== undefined && row.user !== mine;
    const spared = new Set(this.spare);
    /** Whether a row may be owned at this read: never a pid to spare,
     * and never what runs as another user where that is left alone.
     * One rule for everything a read brings, by whatever road: what is
     * remembered, a command's own process, a carrier of the word, a
     * member of a group, and what descends from any of them. */
    const mayOwn = (row: ProcessRow): boolean =>
      !spared.has(row.pid) && !(this.sameUser && others(row));
    /** What this read says of a process held by its pid and its start:
     * its row; that it ended; that another holds its pid; or nothing,
     * when the system says a process is there and the read shows no
     * row for it, or no start to know it by. */
    const at = (pid: number, started: string): ProcessRow | 'ended' | 'another' | 'untold' => {
      const row = shown.get(pid);
      if (row === undefined) return isPresent(pid) ? 'untold' : 'ended';
      if (row.zombie) return 'ended';
      if (row.started === '' || started === '') return 'untold';
      return row.started === started ? row : 'another';
    };

    const passed: ProcessRow[] = [];
    /** What stays remembered as it was, owned or not at this read. */
    const kept = new Map<number, Remembered>();
    const unverified = new Set<number>();
    const groups = new Set<number>();
    for (const [pid, was] of this.remembered) {
      const row = at(pid, was.started);
      if (row === 'untold') {
        kept.set(pid, was);
        unverified.add(pid);
      }
      if (typeof row === 'string') continue;
      // It runs as another user now, or is to be spared: left alone
      // from this read on. Nothing is sent to it and nothing is taken
      // through it or by its group, and it is owned again only when a
      // read shows it as this owner's.
      if (!mayOwn(row)) {
        kept.set(pid, was);
        continue;
      }
      passed.push(row);
      // A group stays owned whole while one of its remembered members
      // is still in it.
      if (facts.groups && was.group !== undefined && row.group === was.group) groups.add(was.group);
    }

    const commands: ProcessRow[] = [];
    const unshown = new Set<number>();
    for (const pid of this.roots()) {
      const row = shown.get(pid);
      if (row === undefined) {
        // Its handle says it runs: a row that shows it ended is
        // believed, a missing one is not.
        if (isPresent(pid)) unshown.add(pid);
        continue;
      }
      if (row.zombie) continue;
      this.unseen.delete(pid);
      commands.push(row);
    }
    // A command that was not shown while it ran and is no longer there
    // to be shown ended unseen.
    const lost = [...this.unseen].filter((pid) => !unshown.has(pid));
    this.unseen = unshown;
    for (const pid of unshown) unverified.add(pid);

    // What descends from a recorded process whose launch is ended,
    // where a child goes on naming a parent that ended.
    const under: ProcessRow[] = [];
    const recorded = this.under;
    if (
      recorded?.started !== undefined &&
      recorded.started !== '' &&
      recorded.boot !== undefined &&
      recorded.boot === now.boot &&
      facts.endedParents
    ) {
      const row = at(recorded.pid, recorded.started);
      // Whose pid it is now the read does not tell: nothing descends
      // from it until a read does.
      if (row === 'untold') unverified.add(recorded.pid);
      // Another start at the pid: the system gave it to another
      // process, and nothing under it is the launch's.
      else if (row !== 'another') {
        const root: ProcessRow =
          row === 'ended'
            ? {
                pid: recorded.pid,
                parent: -1,
                started: recorded.started,
                group: undefined,
                user: undefined,
                zombie: false,
              }
            : row;
        for (const one of descentFrom(living, [root], facts))
          if (one.pid !== recorded.pid) under.push(one);
      }
    }

    // The group a command leads is owned whole.
    if (facts.groups) for (const row of commands) if (row.group === row.pid) groups.add(row.pid);
    if (facts.groups) for (const group of this.firstGroups) groups.add(group);
    this.firstGroups = [];

    // A pid to spare is no carrier, whatever its own command line
    // says: where a system shows the environment's words in a command
    // line, the asker that was handed the word shows it too, and what
    // the asker itself starts is not the word's.
    const carriers =
      facts.environments && this.words.length > 0
        ? living.filter((row) => !spared.has(row.pid) && carries(row, this.words))
        : [];
    if (facts.groups)
      for (const row of carriers) if (row.group !== undefined) groups.add(row.group);

    for (const pid of spared) {
      const group = byPid.get(pid)?.group;
      if (group !== undefined) groups.delete(group);
    }
    const members = living.filter(
      (row) => !spared.has(row.pid) && row.group !== undefined && groups.has(row.group),
    );
    const refused = this.sameUser && [...carriers, ...members].some(others);

    const rows = descentFrom(
      living,
      [...commands, ...passed, ...carriers, ...members, ...under].filter(mayOwn),
      facts,
      mayOwn,
    );

    // What the read could not vouch for, and what it shows under
    // another user, is kept as it was remembered, for a later read to
    // settle; what is owned is remembered by the start the read tells.
    // A start once known is never given up for a read that tells none.
    const remembered = new Map(kept);
    for (const row of rows) {
      const was = remembered.get(row.pid);
      if (was !== undefined && was.started !== '' && row.started === '') continue;
      remembered.set(row.pid, {
        started: row.started,
        group: row.group !== undefined && groups.has(row.group) ? row.group : undefined,
      });
    }
    this.remembered = remembered;
    const apart = { unverified: [...unverified], lost };
    if (refused)
      return {
        rows: [],
        groups: [],
        ...apart,
        refused: 'a group that would be signalled holds a process of another user',
      };
    return { rows, groups: [...groups], ...apart };
  }
}

/** What a stop asks of the machine, each replaceable by a proof. */
export interface StopMachine {
  /** A fresh sample, with environments when asked. */
  read(environment: boolean): Promise<Sample>;
  /** A signal to a pid, or to a whole group as its negative number; a
   * target that is gone is no error, and neither is one the system
   * refuses because the number is another user's now. */
  signal(target: number, name: NodeJS.Signals): void;
  /** Whether the system says a process is at a pid: the one word that
   * something is gone, which a row missing from a read never is. */
  present(pid: number): boolean;
  pause(ms: number): Promise<void>;
  /** Milliseconds of time that passed, for the graces: the monotonic
   * clock, which no correction of the wall clock moves. */
  now(): number;
}

/** A signal to processes or whole groups: one that is already gone is
 * no error, and neither is one whose number another user's process
 * holds now, which the system says as EPERM. The sender is the
 * system's own; a proof hands its own, so that no proof signals a
 * process it did not start. */
export function signalQuietly(
  target: number,
  name: NodeJS.Signals,
  send: (target: number, name: NodeJS.Signals) => unknown = process.kill.bind(process),
): void {
  try {
    send(target, name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') throw error;
  }
}

/** The system's own machine: what a stop asks of when its asker hands
 * none. A proof replaces a part of it. */
export const MACHINE: StopMachine = {
  read: (environment) => sample({ environment }),
  signal: signalQuietly,
  present,
  pause: async (ms) => {
    await realDelay(ms);
  },
  now: () => wallElapsedMs(),
};

/** How a stop is made: what its asker decides, and nothing of which
 * processes it reaches. */
export interface StopOptions {
  /** The word the program itself understands, said before any signal
   * (a server's input closed). */
  say?: (() => void | Promise<void>) | undefined;
  /** The same signal through the handles of the commands themselves. */
  also?: ((name: NodeJS.Signals) => void) | undefined;
  /** How long what is owned has to leave on the term. */
  graceMs: number;
  /** How long it has to be gone after the kill. */
  killWaitMs?: number | undefined;
  /** An end at once: no word and no term first, the kill at the first
   * read, for what has nothing to finish. */
  atOnce?: boolean | undefined;
}

/** What a stop that left nothing owned did. */
export interface Stopped {
  /** Every process a signal went to, by its pid. */
  signalled: number[];
}

/** How long what was killed has to be gone when the asker names no
 * time. */
const KILL_WAIT_MS = 5_000;

/** A group that is owned whole is signalled as a group, which reaches
 * a member born after the read; every other owned process by its pid,
 * the youngest first. */
function signalOwned(
  owned: OwnedNow,
  name: NodeJS.Signals,
  machine: StopMachine,
  signalled: Set<number>,
): void {
  const whole = new Set(owned.groups);
  for (const group of whole) machine.signal(-group, name);
  for (const row of [...owned.rows].reverse()) {
    signalled.add(row.pid);
    if (row.group !== undefined && whole.has(row.group)) continue;
    machine.signal(row.pid, name);
  }
}

/** One read, taken: what it proves owned, and what it could not vouch
 * for. A group that would be signalled and holds another user's
 * process is refused here, for every step of the stop alike. */
async function look(ownership: Ownership, machine: StopMachine): Promise<OwnedNow> {
  let now: Sample;
  try {
    now = await machine.read(ownership.wantsEnvironment);
  } catch (error) {
    ownership.missed();
    throw error;
  }
  const owned = ownership.take(now, (pid) => machine.present(pid));
  if (owned.refused !== undefined) throw new OwnershipRefused(owned.refused);
  return owned;
}

/** Whether a read left nothing to wait for: nothing owned is shown,
 * and nothing owned is missing from it while the system says it runs.
 * Only this is "gone". */
function nothingLeft(owned: OwnedNow): boolean {
  return owned.rows.length === 0 && owned.unverified.length === 0;
}

/** Reads until nothing is left or the moment has passed; answers what
 * is left then, from the read just made. `each` is given every read
 * that still shows something, before the next wait. */
async function untilGone(
  see: () => Promise<OwnedNow>,
  machine: StopMachine,
  deadline: number,
  each?: (owned: OwnedNow) => void,
): Promise<OwnedNow | undefined> {
  let wait = 50;
  for (;;) {
    const left = Math.max(0, deadline - machine.now());
    await machine.pause(Math.min(wait, left));
    const owned = await see();
    if (nothingLeft(owned)) return undefined;
    if (machine.now() >= deadline) return owned;
    each?.(owned);
    wait = Math.min(wait * 2, 500);
  }
}

/** THE STOP, the same on every system and the one end of processes
 * there is: what is owned is read before anything is said or sent;
 * then the program's own word, and a read after it; then the term to
 * everything owned; then the grace; then a read and the kill to
 * everything still owned, sent again at every look to what a read
 * shows again; then a look until nothing is left. An end at once
 * begins at the kill.
 *
 * IT ENDS IN ONE OF THREE WAYS AND SAYS WHICH. Nothing owned is left:
 * it returns what it signalled. Something owned still runs after the
 * kill: it throws `StopLeftRunning`. Something owned could not be
 * vouched for, by a read that never showed it again while the system
 * says it runs or by a command that ended before any read showed it:
 * it throws `StopUnverified`, having sent such a pid nothing, since a
 * signal needs a read that proves its target. A row missing from a
 * read is never taken for a process that ended, and a command the read
 * does not show is still ended by its own handle. A read that fails
 * ends the commands by their handles alone and is thrown; a group that
 * holds another user's process is refused before anything is sent.
 * Whoever asked does nothing in the stop's place after a failure: no
 * caller signals what the stop would not. */
export async function stopOwned(
  ownership: Ownership,
  options: StopOptions,
  machine: StopMachine = MACHINE,
): Promise<Stopped> {
  const signalled = new Set<number>();
  const lost = new Set<number>();
  const see = async (): Promise<OwnedNow> => {
    const owned = await look(ownership, machine);
    for (const pid of owned.lost) lost.add(pid);
    return owned;
  };
  /** Nothing is left: the stop is over, and whole unless a command
   * ended that no read had shown. */
  const over = (): Stopped => {
    if (lost.size > 0) throw new StopUnverified([], [...lost], [...signalled]);
    return { signalled: [...signalled] };
  };
  const send = (owned: OwnedNow, name: NodeJS.Signals): void => {
    signalOwned(owned, name, machine, signalled);
    options.also?.(name);
  };
  try {
    let owned = await see();
    if (nothingLeft(owned)) return over();
    if (options.atOnce !== true) {
      if (options.say !== undefined) {
        await options.say();
        owned = await see();
        if (nothingLeft(owned)) return over();
      }
      send(owned, 'SIGTERM');
      const after = await untilGone(see, machine, machine.now() + options.graceMs);
      if (after === undefined) return over();
      owned = after;
    }
    const kill = (now: OwnedNow): void => {
      send(now, 'SIGKILL');
    };
    kill(owned);
    const left = await untilGone(
      see,
      machine,
      machine.now() + (options.killWaitMs ?? KILL_WAIT_MS),
      kill,
    );
    if (left === undefined) return over();
    if (left.rows.length > 0)
      throw new StopLeftRunning(
        left.rows.map((row) => row.pid),
        left.unverified,
        [...signalled],
      );
    throw new StopUnverified(left.unverified, [...lost], [...signalled]);
  } catch (error) {
    if (error instanceof ProcessReadFailure) options.also?.('SIGKILL');
    throw error;
  }
}

/** How long a recorded process has to leave on the term before the
 * kill, and how long what was killed has to be gone. */
const LEAVE_MS = 5_000;

/** How the end of a recorded process is made. `atOnce`: no term first,
 * for a stop that has no grace. `leftOnly`: the process the record
 * names is left as it is, whoever holds it, and what its launch left
 * is ended alone: the cleaning before a copy is started again, where
 * the record may name a process that another host started and that
 * still runs. */
export interface EndHow {
  atOnce?: boolean | undefined;
  leftOnly?: boolean | undefined;
}

/** THE END OF A RECORDED PROCESS and of what its launch left, by THE
 * STOP: the last resort for a process a record names, and the cleaning
 * after one that died. THE SAME: the process, what is under it and
 * what its launch left are sent a term, the youngest first, so the
 * first process of a namespace of its own before its holder, and a
 * kill to what is still there five seconds later. ANOTHER or GONE:
 * what its launch left is killed at once, having nothing to finish.
 * UNKNOWN: nothing is sent, and the process is named among what is
 * left. What a launch left is what carries the launch's
 * word, with the group of each carrier, what was under the process
 * while it lived, and, where a child goes on naming a parent that
 * ended, what still descends from it while no other process holds its
 * pid. The asker's own process and its parent's are never among what
 * is ended. `word` is the launch's word whole (`NAME=value`), or empty
 * when the asker has none.
 *
 * The answer says what the read told of the process, every pid a
 * signal went to, and what is left: what would not go, and what no
 * read vouches for while the system says it runs, the process itself
 * among it when the answer is unknown. Nothing left is the one answer
 * that says the end is whole; whoever must answer for a stop asks
 * that, and need not know of the cases. */
export async function endRecorded(
  recorded: Recorded,
  word: string,
  how: EndHow = {},
  machine: StopMachine = MACHINE,
): Promise<EndAnswer> {
  const leftOnly = how.leftOnly === true;
  const environment = word !== '';
  let first: Sample | undefined = await machine.read(environment);
  const answer = answerOf(recorded, first, (pid) => machine.present(pid));
  // A process the read cannot vouch for is sent nothing, and it is
  // named as left: a process is at the pid, and whoever asked for its
  // end may not count it as ended. What the read cannot tell of the
  // process decides nothing of what carries its launch's word: a
  // cleaning goes on, the process left.
  if (answer === 'unknown' && !leftOnly) return { answer, ended: [], left: [recorded.pid] };
  const ends = answer === 'same' && !leftOnly;
  const ownership = new Ownership({
    ...(environment ? { words: [word] } : {}),
    spare: [process.pid, process.ppid, ...(leftOnly ? [recorded.pid] : [])],
    under: recorded,
  });
  if (ends && recorded.started !== undefined) ownership.remember(recorded.pid, recorded.started);
  // The read that answered is the stop's first.
  const from: StopMachine = {
    read: (wanted) => {
      const now = first;
      first = undefined;
      return now === undefined ? machine.read(wanted) : Promise.resolve(now);
    },
    signal: (target, name) => {
      machine.signal(target, name);
    },
    present: (pid) => machine.present(pid),
    pause: (ms) => machine.pause(ms),
    now: () => machine.now(),
  };
  try {
    const stopped = await stopOwned(
      ownership,
      { graceMs: LEAVE_MS, killWaitMs: LEAVE_MS, atOnce: how.atOnce === true || !ends },
      from,
    );
    return { answer, ended: stopped.signalled, left: [] };
  } catch (error) {
    if (error instanceof StopLeftRunning)
      return { answer, ended: error.signalled, left: [...error.pids, ...error.unverified] };
    if (error instanceof StopUnverified)
      return { answer, ended: error.signalled, left: [...error.pids, ...error.unseen] };
    throw error;
  }
}

/** THE MEASURE: of each recorded process one of the four answers and
 * the start the read tells of the process at its pid; and for one that
 * is the same, the pids of its tree and the first process of a
 * namespace of its own among them where it has one. One read answers
 * every one of them, and none tells what a process uses. */
export function measured(
  asked: readonly Recorded[],
  now: Sample,
  isPresent: (pid: number) => boolean = present,
): MeasureAnswer {
  return {
    boot: now.boot,
    processes: asked.map((recorded) => {
      const answer = answerOf(recorded, now, isPresent);
      // The start the read tells of the process at the pid, whatever
      // the record says: whoever started a process learns it here.
      const told = now.rows.find((row) => row.pid === recorded.pid)?.started;
      const started = told === undefined || told === '' ? {} : { started: told };
      if (answer !== 'same') return { pid: recorded.pid, answer, ...started };
      const tree = treeUnder(now.rows, recorded.pid, now.facts);
      const init = tree.find((row) => row.init === true);
      return {
        pid: recorded.pid,
        answer,
        ...started,
        tree: tree.map((row) => row.pid),
        ...(init === undefined ? {} : { init: init.pid }),
      };
    }),
  };
}
