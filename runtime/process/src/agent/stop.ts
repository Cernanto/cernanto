// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The host's stop in its two halves (main.ts reads the records and
// hands them here), apart so that each is proven by itself on every
// system: the host job first, by its process, and then the copies that
// outlived it. Each copy that may still run is given its stop word
// and the grace; then THE END is asked for every copy, whatever became
// of its process: of the process where it is still the record's, and
// of what its launch left whether the process is there or not, since
// what a copy started outlives the copy. The stop says what stays and
// fails on any of it: a copy that the read cannot vouch for was sent
// no signal, and is never counted as stopped.
//
// THE STOP WAITS FOR A COPY'S PROCESS TO LEAVE, NEVER FOR ITS ANSWER.
// The words go out to every copy at once, and the grace is one, every
// copy's, counted from that moment: a copy that answers its word late
// or never costs the stop no time of its own, and under no grace the
// ends begin at once, beside the words.

import { setTimeout as pause } from 'node:timers/promises';

import { answerOf, wallElapsedMs } from '@cernanto/runtime-lib/machine';
import type { EndAnswer, EndHow, Recorded, Sample } from '@cernanto/runtime-lib/machine';

/** A copy as its record names it. */
export interface CopyToStop {
  /** The record's key, for the words. */
  key: string;
  recorded: Recorded;
  /** The word of its launch, whole (`NAME=value`), or empty where the
   * record has none. */
  word: string;
}

/** What the stop asks of the machine and of the plane: the process
 * adapter and the records in the block, a play of them in a proof. */
export interface CopiesStop<Copy extends CopyToStop> {
  /** A read of now. */
  read(): Promise<Sample>;
  /** THE END of a recorded process and of what its launch left. */
  end(recorded: Recorded, word: string, how: EndHow): Promise<EndAnswer>;
  /** Whether the system says a process is at a pid. */
  present(pid: number): boolean;
  /** The stop word, said to one copy: written on its record, then
   * posted to it. The post is given up when `cut` says so. */
  stopWord(copy: Copy, cut: AbortSignal): Promise<void>;
  say(line: string): void;
}

/** How long a word posted to a copy may go unanswered before it is
 * given up: the copy reads the word on its record. */
const POST_PATIENCE_MS = 15_000;

/** Posts a word to a copy's call server. Nothing is made of the answer,
 * and one that does not come is given up after the patience, or at
 * once when `cut` says so. */
export async function postWord(
  url: string,
  headers: Record<string, string>,
  why: string,
  cut: AbortSignal,
): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ why }),
    signal: AbortSignal.any([cut, AbortSignal.timeout(POST_PATIENCE_MS)]),
  }).catch(() => undefined);
}

/** Waits until no process is at a pid, a bounded while; answers whether
 * it left. The while is time that passed, counted on the monotonic
 * clock: a correction of the wall clock neither cuts a grace short nor
 * stretches it. */
export async function goneWithin(
  pid: number,
  ms: number,
  isPresent: (pid: number) => boolean,
): Promise<boolean> {
  const deadline = wallElapsedMs() + ms;
  while (isPresent(pid)) {
    if (wallElapsedMs() >= deadline) return false;
    await pause(250);
  }
  return true;
}

/** A failure's words on one line, as the stop's account carries them. */
const wordsOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s*\n\s*/g, ' ').trim();

/** What the stop asks about the host job, the first half of the host's
 * stop. */
export interface HostJobStop {
  /** A read of now. */
  read(): Promise<Sample>;
  /** THE END of a recorded process and of what its launch left. */
  end(recorded: Recorded, word: string, how: EndHow): Promise<EndAnswer>;
  /** Whether the system says a process is at a pid. */
  present(pid: number): boolean;
  /** The host job's stop word with the grace, one call of it: answers
   * whether a serve took it (a host job whose serve does not run
   * answers that nothing was asked), and fails when it is not answered
   * within its patience. */
  stopWord(graceMs: number): Promise<boolean>;
  /** How long past the grace a host job that took its word has to be
   * gone: its last resorts, and the moment its traces take to leave. */
  leaveMs: number;
  say(line: string): void;
}

/** THE HOST JOB FIRST, BY ITS PROCESS AND NEVER BY ITS SILENCE: a host
 * job that lives starts again every copy it finds missing, so nothing
 * of its copies is stopped while it may live. The same: it is given
 * its stop word and the grace to carry it out and leave in; one whose
 * serve does not run, that does not take the word or that does not
 * leave is ended. Unknown: nothing is stopped, since a host job that
 * lives cannot be told from one that is gone. Then THE END is asked
 * whatever became of its process, as it is of every copy: of the
 * process where it is still the record's, and of what its own launch
 * left, a launcher under way among it, which would start a copy after
 * the stop. Throws when the host job cannot be vouched for or would
 * not end, and no copy is stopped then. */
export async function stopHostJob(
  host: CopyToStop,
  name: string,
  graceMs: number,
  by: HostJobStop,
): Promise<void> {
  const { recorded, word } = host;
  const pid = String(recorded.pid);
  const untold = (): Error =>
    new Error(
      `the host job of ${name} cannot be told from another process (pid ${pid}, whose start the system does not tell): nothing was stopped`,
    );
  const answer = answerOf(recorded, await by.read(), (at) => by.present(at));
  if (answer === 'unknown') throw untold();
  if (answer === 'same') {
    let taken: boolean;
    try {
      taken = await by.stopWord(graceMs);
      by.say(
        taken
          ? `the host ${name} is stopping: every copy here leaves within its grace`
          : `the host job's serve does not run, so it took no stop word; its process ${pid} is ended`,
      );
    } catch (error) {
      taken = false;
      by.say(
        `the host job did not take its stop word (${wordsOf(error)}); its process ${pid} is ended`,
      );
    }
    if (taken && !(await goneWithin(recorded.pid, graceMs + by.leaveMs, (at) => by.present(at))))
      by.say(`the host job did not leave on its stop word; its process ${pid} is ended`);
  }
  // Nothing left is the one answer that says the end is whole: the
  // process is gone, and so is what its launch left.
  const ended = await by.end(recorded, word, { atOnce: graceMs === 0 });
  if (ended.left.length === 0) return;
  if (ended.answer === 'unknown') throw untold();
  throw new Error(
    ended.left.includes(recorded.pid)
      ? `the host job of ${name} would not end (pid ${pid}): no copy was stopped, since a host job that lives starts its copies again`
      : `what the host job of ${name} had started would not end (pid ${ended.left.join(', ')}): no copy was stopped, since a launcher among it starts one`,
  );
}

/** Stops the copies the records name, within the grace; a grace of 0
 * ends each at once, with no term first and with no wait for any
 * answer. Throws with what stays, once every end was made: the
 * processes that would not go, the copies no read vouches for, which
 * were sent no signal, and the ends that could not be made. */
export async function stopCopies<Copy extends CopyToStop>(
  copies: readonly Copy[],
  graceMs: number,
  by: CopiesStop<Copy>,
): Promise<void> {
  if (copies.length === 0) return;
  const atOnce = graceMs === 0;
  const would: string[] = [];
  const unverified: string[] = [];
  const unmade: string[] = [];
  // THE END for one copy. Nothing left is the one answer that says it
  // is whole; anything else stays, and is said for its reason. An end
  // that could not be made is kept for the same account: the other
  // copies get theirs all the same.
  const end = async (copy: Copy): Promise<void> => {
    const named = `${copy.key} (pid ${String(copy.recorded.pid)})`;
    let ended: EndAnswer;
    try {
      ended = await by.end(copy.recorded, copy.word, { atOnce });
    } catch (error) {
      unmade.push(`${named}: ${wordsOf(error)}`);
      return;
    }
    if (ended.left.length === 0) return;
    if (ended.answer === 'unknown') unverified.push(named);
    else would.push(`${copy.key} (pid ${ended.left.join(', ')})`);
  };
  const now = await by.read();
  const died: Copy[] = [];
  const there: Copy[] = [];
  for (const copy of copies) {
    const answer = answerOf(copy.recorded, now, (pid) => by.present(pid));
    if (answer === 'another' || answer === 'gone') died.push(copy);
    else there.push(copy);
  }
  // The word goes to every copy that may run, all of them at once, and
  // nothing waits for it: a copy leaves on it or does not, which its
  // process tells.
  const cut = new AbortController();
  const deadline = wallElapsedMs() + graceMs;
  const words = there.map((copy) =>
    by.stopWord(copy, cut.signal).catch((error: unknown) => {
      by.say(`the stop word of ${copy.key} could not be said: ${wordsOf(error)}`);
    }),
  );
  if (there.length > 0)
    by.say(
      `${String(there.length)} cop${there.length === 1 ? 'y' : 'ies'} outlived the host job and ${there.length === 1 ? 'is' : 'are'} stopped by ${there.length === 1 ? 'its record' : 'their records'}`,
    );
  try {
    await Promise.all([
      // A copy that had died: what its launch left is ended, as the host
      // job would have had it ended at its next look.
      ...died.map(end),
      // A copy that may run: the grace to leave in, and then the end,
      // asked whether it left or not.
      ...there.map(async (copy) => {
        await goneWithin(copy.recorded.pid, Math.max(0, deadline - wallElapsedMs()), (pid) =>
          by.present(pid),
        );
        await end(copy);
      }),
    ]);
  } finally {
    // Every end is made: a word still on its way has nobody to reach,
    // and is given up. Its mark stands on the record.
    cut.abort();
    await Promise.all(words);
  }
  if (would.length === 0 && unverified.length === 0 && unmade.length === 0) return;
  throw new Error(
    [
      ...(would.length === 0 ? [] : [`processes that would not go: ${would.join('; ')}`]),
      ...(unverified.length === 0
        ? []
        : [`could not be verified and were sent no signal: ${unverified.join('; ')}`]),
      ...(unmade.length === 0 ? [] : [`could not be ended: ${unmade.join('; ')}`]),
    ].join('. '),
  );
}
