// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The program of one service generation: its one log, its queue of
// requests, and the loop that takes them and serves them side by side,
// each in a lane of the log named by its request. A request a post
// hands over is this version's once the program takes it, and its take
// is the log's `request ack`: the log holds no take the version does
// not hold. The program's memory is rebuilt at every boot by running
// every take's body in the one order the records have, each answered
// from its pairs: the bodies share the memory, so one scope replays
// them all. A call that fails retryably runs again in its lane after a
// backoff, under new requests for its commands; a call cancelled ends
// with the cancelled answer, and a replay ends it at the same record.
// At the drain, a call that waits on this version's memory is answered
// that the version is replaced, so its caller asks the newer one.

import { holdDrain, holdInFlight, isDraining } from './admission.js';
import { CernantoError, failureForRecord, markSecretFailure } from '../language/errors.js';
import { runUnrecorded, traceCounter } from './execution.js';
import { openHandlerRecords, runUnderExecution } from './handler-run.js';
import { isSecretHandler } from '../language/core.js';
import { callHandle, repeatsAttempt } from './connection.js';
import { CallLifetime, retireProcess, sleepMs } from './lifetime.js';
import { PROGRAM_HANDLER } from '../language/program.js';
import { durableBackend } from './durable-backend.js';
import { ROOT_LANE, newerHolderOwns } from './journal.js';
import type { CommandJournal, Journal } from './journal.js';
import { closeListeners } from './listeners.js';
import {
  callIdOfRequest,
  destinationOfLog,
  logNameOf,
  lostImageWords,
  replacedWords,
  storyOfLog,
} from './log.js';
import { countTotals } from '../traces/trace.js';
import { stateOver, storyOfRun } from './stories.js';
import type { Entry, Outcome, RecordedError, RequestAck, ResponseSent } from './log.js';
import {
  chooseDestination,
  considerResend,
  postOwedNow,
  postRequest,
  postResponse,
} from './transport.js';
import type { CallMessage } from './call-server.js';
import { requestIdFor } from './log.js';
import type { RequestSent } from './log.js';
import { ownEntryKey } from './copy-entry.js';
import { recordedImage } from './image.js';
import { sleepMs as pauseMs } from './lifetime.js';
import { callerAgentOf, parentCallOf } from './envelope.js';
import type { CallEnvelope } from './envelope.js';
import { ackOf, answerInPlace, refusalOf, takeOrForward, wireOutcomeOf } from './serve.js';
import { failureRecord, processLeaves, backoffMs, ServedUnit, callParentField } from './units.js';
import type { PostedCall } from './units.js';
import type { CallContext } from './execution.js';
import type { HandlerFn } from '../language/handler-types.js';
import { kernelSay } from '../traces/observe.js';

/** How many calls a service serves side by side at most: a large
 * number, because a service that exports a wait function holds many
 * calls that do nothing but wait. */
const SERVICE_CALLS_IN_HAND = 1024;

/** The end of a process another process fenced: its listeners closed,
 * the reason said, and the exit at once. */
function exitFenced(service: string, error: unknown): never {
  kernelSay(
    `program ${service}: ${error instanceof Error ? error.message : String(error)}; the process exits\n`,
  );
  closeListeners();
  process.exit(2);
}

/** A request in the program's queue: the ack it is taken under once
 * the loop reaches it, its post, and the arguments as the wire carried
 * them. */
interface Queued {
  ack: RequestAck;
  args: unknown;
  posted: PostedCall;
  taken: () => void;
}

/** What a take settles with: one request's ack, or at a drain the
 * drain's own word, which records nothing. */
type TakeOutcome = { ack: RequestAck; args: unknown } | { handed: true };

/** One call being served: its lane, the arguments in memory, what lets
 * it go before it returns, and whether its body still runs. */
interface Serving {
  ack: RequestAck;
  args: unknown;
  release: () => void;
  end: (reason?: Error) => void;
  running: () => boolean;
  /** Resolves once the call's answer is recorded, or the call let go. */
  done: Promise<void>;
}

export class ProgramUnit {
  readonly unit: ServedUnit;
  readonly handlers: Record<string, HandlerFn>;
  journal: Journal | undefined;
  /** The requests the program has not taken yet. */
  private readonly queue: Queued[] = [];
  private waiting: (() => void) | undefined;
  private serving = false;
  private readonly servingWaiters: (() => void)[] = [];
  /** The calls being served, side by side, by request. */
  private readonly inHand = new Map<string, Serving>();
  /** The requests the drain ended as replaced: their bodies end on
   * their own signal, and the catch answers them so. */
  private readonly replaced = new Set<string>();
  /** The requests a replay ended with the answer the log holds, when
   * the body reached a command left open past that answer: the body
   * was cut off there in the life that answered (a cancel), and the
   * record is its outcome here too. */
  private readonly endedByHistory = new Map<string, Outcome>();
  /** The requests arriving now, their logs being resolved: one arrival
   * of a request at a time. */
  private readonly arriving = new Set<string>();
  /** How many answers are being recorded: a body that ended leaves the
   * calls in hand before its answer lands, and the drain's settling
   * waits for the record. */
  private answering = 0;
  private readonly roomWaiters: (() => void)[] = [];
  /** What ended the attempt from inside one served call (a fence): the
   * loop that takes calls hears it here. */
  private loopFailure: { error: unknown } | undefined;

  constructor(unit: ServedUnit, handlers: Record<string, HandlerFn>) {
    this.unit = unit;
    this.handlers = handlers;
  }

  /** Ends a call this program holds, asked from outside by the call's
   * id: the call's lifetime ends with the cancellation's words, its
   * caller is answered that it was cancelled, and the record says so,
   * so a replay ends the call at the same place. Answers whether a call
   * whose body still runs was reached. */
  cancel(callId: string): boolean {
    // Every body of the call: a call asked under one id rides as many
    // requests as its caller's attempts, and the cancellation ends them
    // all.
    let reached = false;
    for (const [request, serving] of [...this.inHand]) {
      if (callIdOfRequest(request) !== callId || !serving.running()) continue;
      this.unit.cancelled.add(request);
      serving.end(cancelledError(request, this.unit.service, serving.ack.handler));
      reached = true;
    }
    return reached;
  }

  /** How many requests wait in the queue for the program to take them,
   * the machine's own aside: calls this copy holds and has not begun. A
   * request whose ack just landed is the log's to count. */
  queuedCalls(): number {
    let waiting = 0;
    for (const queued of this.queue) {
      if (queued.ack.observation === true) continue;
      if (this.journal?.takenOf(queued.ack.request) !== undefined) continue;
      waiting += 1;
    }
    return waiting;
  }

  /** Wakes the loop for the drain. */
  wakeForDrain(): void {
    const wake = this.waiting;
    this.waiting = undefined;
    wake?.();
  }

  /** Resolves once the program takes calls. */
  whenServing(): Promise<void> {
    if (this.serving) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.servingWaiters.push(resolve);
    });
  }

  private setServing(on: boolean): void {
    this.serving = on;
    if (on) for (const wake of this.servingWaiters.splice(0)) wake();
  }

  /** A request a post handed over: refused, answered from the log when
   * the log holds it, or queued for the program's take. Resolves when
   * the lane may be asked for its next request: once the program has
   * taken it, or answered it. */
  async arrive(posted: PostedCall, envelope: CallEnvelope): Promise<void> {
    const journal = this.journal;
    if (journal === undefined || !this.serving) {
      posted.giveBack(1000);
      return;
    }
    // One arrival of a request at a time: a second post of it while the
    // first resolves its logs is given back, so the decision to queue
    // it is made once, over a view no other arrival moved.
    if (this.arriving.has(envelope.request)) {
      posted.giveBack(500);
      return;
    }
    this.arriving.add(envelope.request);
    try {
      await this.arriveOnce(posted, envelope, journal);
    } finally {
      this.arriving.delete(envelope.request);
    }
  }

  private async arriveOnce(
    posted: PostedCall,
    envelope: CallEnvelope,
    journal: Journal,
  ): Promise<void> {
    // A request pinned to a sibling's log (its copy gone, the request
    // posted here on the sibling road) is answered from that log when
    // it was answered there, answered as replaced when the sibling took
    // it and never answered (its memory is gone with it), and taken
    // here as this copy's own when the sibling never took it.
    const to = logNameOf(envelope.to);
    if (to !== journal.log && !(await this.arriveForSibling(posted, envelope, to))) return;
    const standing = journal.takenOf(envelope.request);
    if (standing !== undefined) {
      // A pointer in this copy's own log: a sibling took the request as
      // its own while this slot was gone, and the slot came back. The
      // taker's log answers; nothing of it runs here.
      if (standing.response === undefined && standing.ack?.takenBy !== undefined) {
        if (!(await this.resolveTaker(posted, envelope, journal, standing.ack.takenBy))) return;
      } else {
        posted.confirm(
          standing.response === undefined ? undefined : wireOutcomeOf(standing.response),
        );
        return;
      }
    }
    // The logs resolved, the own log is read again: an acceptance that
    // landed meanwhile (a body of this request already running or
    // answered) is answered from it, never queued beside.
    const landed = journal.takenOf(envelope.request);
    if (
      landed !== undefined &&
      (landed.response !== undefined || landed.ack?.takenBy === undefined)
    ) {
      posted.confirm(landed.response === undefined ? undefined : wireOutcomeOf(landed.response));
      return;
    }
    if (this.queue.some((queued) => queued.ack.request === envelope.request)) {
      // Posted again while it waits in the queue: taken with the first.
      posted.giveBack(500);
      return;
    }
    // New work alone is held to the contract this generation serves: a
    // request a log knows is answered from it whatever the handler is
    // here now.
    const words =
      envelope.handler === PROGRAM_HANDLER
        ? `agent "${this.unit.agentId}" has no handler "${envelope.handler}"`
        : refusalOf(this.unit.agentId, this.handlers, envelope);
    if (words !== undefined) {
      posted.refuse({ kind: 'contract-violation', message: words });
      return;
    }
    const ack = ackOf(envelope);
    const taken = new Promise<void>((resolve) => {
      this.queue.push({ ack, args: envelope.args, posted, taken: resolve });
    });
    const wake = this.waiting;
    this.waiting = undefined;
    wake?.();
    await taken;
  }

  /** A request named to a sibling's log: the dead log taken over (or
   * handed to the live sibling that holds it), and the request answered
   * from it, as replaced when the sibling took it and never answered,
   * or from the log of the sibling that took it as its own, which a
   * pointer in the dead log names. Answers whether the request is
   * nobody's there, so this copy takes it as its own, the dead log
   * pointed at this copy's log for whoever answers for it next. */
  private async arriveForSibling(
    posted: PostedCall,
    envelope: CallEnvelope,
    log: string,
  ): Promise<boolean> {
    const own = this.journal;
    if (own === undefined) {
      posted.giveBack(1000);
      return false;
    }
    const message: CallMessage = {
      id: envelope.request,
      kind: 'call',
      call: envelope.callId,
      from: posted.from,
      body: envelope,
    };
    const dead = await takeOrForward(this.unit, posted, message, log);
    if (dead === undefined) return false;
    const standing = dead.takenOf(envelope.request);
    if (standing?.response !== undefined) {
      posted.confirm(wireOutcomeOf(standing.response));
      return false;
    }
    const ack = standing?.ack;
    if (ack === undefined) return this.pointAt(posted, dead, envelope);
    if (ack.takenBy === undefined) {
      // Taken by the dead sibling and never answered: the memory it ran
      // in is gone, and the takeover answers it as replaced; the post is
      // answered with the same words, the record written once.
      const outcome: Outcome = {
        error: { kind: 'retryable', message: replacedWords(this.unit.service, ack.request) },
      };
      await answerInPlace(this.unit, dead, ack, outcome);
      posted.confirm({ outcome });
      return false;
    }
    // A pointer: a sibling took the request as its own, and its log
    // answers.
    return this.resolveTaker(posted, envelope, dead, ack.takenBy);
  }

  /** Follows a pointer to the taker's log and answers the post from
   * there: this copy's own log answers below when the pointer names it;
   * another's is reached as a request named to it, handed to the taker
   * when it lives and read when it is dead, a pointer found there
   * followed on, never twice to one log. Answers whether the request is
   * nobody's at the chain's end (the taker died between its pointer and
   * its own take), so this copy takes it as its own, the named log
   * pointed at this copy's log anew. */
  private async resolveTaker(
    posted: PostedCall,
    envelope: CallEnvelope,
    named: Journal,
    takenBy: string,
  ): Promise<boolean> {
    const own = this.journal;
    if (own === undefined) {
      posted.giveBack(1000);
      return false;
    }
    const visited = new Set<string>([named.log]);
    let next = takenBy;
    for (;;) {
      if (next === own.log) {
        // This copy is the taker: its own ack and answer stand in its
        // log, or it died between the pointer and its take and takes
        // the request anew.
        const mine = own.takenOf(envelope.request);
        if (
          mine?.response !== undefined ||
          (mine?.ack !== undefined && mine.ack.takenBy === undefined)
        )
          return true;
        break;
      }
      if (visited.has(next)) break;
      visited.add(next);
      const taker = destinationOfLog(next);
      if (taker === undefined) break;
      const theirs = await takeOrForward(
        this.unit,
        posted,
        {
          id: envelope.request,
          kind: 'call',
          call: envelope.callId,
          from: posted.from,
          body: { ...envelope, to: taker },
        },
        next,
      );
      if (theirs === undefined) return false;
      const there = theirs.takenOf(envelope.request);
      if (there?.response !== undefined) {
        posted.confirm(wireOutcomeOf(there.response));
        return false;
      }
      if (there?.ack === undefined) break;
      if (there.ack.takenBy === undefined) {
        const outcome: Outcome = {
          error: {
            kind: 'retryable',
            message: replacedWords(this.unit.service, there.ack.request),
          },
        };
        await answerInPlace(this.unit, theirs, there.ack, outcome);
        posted.confirm({ outcome });
        return false;
      }
      next = there.ack.takenBy;
    }
    return named.log === own.log ? true : this.pointAt(posted, named, envelope);
  }

  /** Points a dead log at this copy's: a pointer ack for the request
   * there, so the sibling that answers for the log next finds this
   * copy's log, where the request's own ack and its answer stand.
   * Answers whether the pointer stands; the post is given back when the
   * dead log moved under this copy. */
  private async pointAt(
    posted: PostedCall,
    dead: Journal,
    envelope: CallEnvelope,
  ): Promise<boolean> {
    const own = this.journal;
    if (own === undefined) {
      posted.giveBack(1000);
      return false;
    }
    try {
      await dead.take({ ...ackOf(envelope), takenBy: own.log });
    } catch (error) {
      kernelSay(
        `${this.unit.service}: the log ${dead.log} could not be pointed at this copy's: ${failureForRecord(error).error}\n`,
      );
      posted.giveBack(1000);
      return false;
    }
    return true;
  }

  /** The next queued request, when one arrives; at the drain, the
   * drain's own word, the queue let go. */
  private next(signal: AbortSignal): Promise<Queued | { handed: true }> {
    return new Promise<Queued | { handed: true }>((resolve, reject) => {
      const take = (): boolean => {
        if (this.loopFailure !== undefined) {
          const failure = this.loopFailure.error;
          reject(failure instanceof Error ? failure : new Error(String(failure)));
          return true;
        }
        if (isDraining()) {
          for (const item of this.queue.splice(0)) {
            item.posted.giveBack();
            item.taken();
          }
          resolve({ handed: true });
          return true;
        }
        const item = this.queue[0];
        if (item === undefined) return false;
        resolve(item);
        return true;
      };
      if (take()) return;
      const onAbort = (): void => {
        this.waiting = undefined;
        reject(
          new CernantoError({
            kind: 'retryable',
            message: 'the program stopped taking calls',
          }),
        );
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiting = () => {
        signal.removeEventListener('abort', onAbort);
        if (!take()) this.waiting = undefined;
      };
    });
  }

  /** Runs the program for the generation's life: replaying the takes
   * its log holds, then serving the live ones. The loop holds the
   * drain: a draining process finishes the calls in flight before the
   * process exits. */
  async run(): Promise<void> {
    const running = holdDrain();
    try {
      const journal = this.unit.journal;
      if (journal === undefined) {
        kernelSay(`program ${this.unit.service} has no log; the program does not run\n`);
        return;
      }
      this.journal = journal;
      journal.onAnsweredInHistory = (entry) => this.answeredInHistory(entry);
      journal.onOpenCommandPastAnswer = (entry) => this.openCommandPastAnswer(entry);
      // A log whose newest mark names an image the record no longer
      // names (the record made anew after the copy was gone) is
      // continued by nothing below the mark: the program begins anew
      // over what stands past it, and says so, since the memory that
      // was in the image is gone.
      const done = journal.entries.find((entry) => entry.type === 'checkpoint done');
      if (
        done?.type === 'checkpoint done' &&
        done.data.image !== undefined &&
        journal.state.mark !== undefined &&
        (await recordedImage().catch(() => undefined)) === undefined
      ) {
        kernelSay(
          `program ${this.unit.service}: the log is continued by the image ${done.data.image} and the record names no image, so the program begins anew over the records past the mark\n`,
        );
        // The memory that was in the image is gone: every request the
        // log holds taken and not answered ran over it, and is answered
        // in words; the records past the mark are kept and replayed by
        // nothing, the program's memory starting empty.
        for (const taken of [...journal.state.taken.values()]) {
          const ack = taken.ack;
          if (ack === undefined || taken.response !== undefined) continue;
          const response: ResponseSent = {
            request: ack.request,
            outcome: {
              error: {
                kind: 'terminal',
                message: lostImageWords(this.unit.service, ack.handler, ack.request),
              },
            },
            ...(ack.replyTo === undefined ? {} : { replyTo: ack.replyTo }),
            at: Date.now(),
          };
          kernelSay(
            `${this.unit.service}/${ack.handler} ${callIdOfRequest(ack.request)}: ${lostImageWords(this.unit.service, ack.handler, ack.request)}\n`,
          );
          await journal.answer(response);
          stateOver(this.unit, journal.log, ack, response.outcome);
          if (ack.replyTo !== undefined) {
            const acked = await postResponse(response).catch(() => false);
            if (acked) journal.noteResponseAcked(ack.request);
            else considerResend();
          }
        }
        journal.scope(ROOT_LANE).liveFromStart = true;
      }
      try {
        await this.serveJournal(journal);
      } catch (error) {
        if (newerHolderOwns(error)) exitFenced(this.unit.service, error);
        throw error;
      } finally {
        this.setServing(false);
      }
    } finally {
      running();
    }
  }

  /** A body's answer met in the history while its body still runs on
   * this attempt, where the answer came from outside the body: a
   * cancellation's record, or the drain's, which answered a call that
   * only waited on the memory that the version is replaced. Either
   * ends the body here, as it was ended live, and the record stands as
   * its answer: a body that waits on the memory would never reach it,
   * and the replay would wait for it for good, the program taking no
   * call again. Any other answer waits for the body. */
  private answeredInHistory(entry: Entry): boolean {
    if (entry.type !== 'response sent') return false;
    const { request } = entry.data;
    const serving = this.inHand.get(request);
    if (serving === undefined || !serving.running()) return false;
    const outcome = entry.data.outcome;
    if (!('error' in outcome)) return false;
    if (outcome.error.cancelled === true) {
      serving.end(cancelledError(request, this.unit.service, serving.ack.handler));
      return true;
    }
    // The drain's ending is known by its words, which name the call.
    const replaced = replacedWords(this.unit.service, request);
    if (outcome.error.kind !== 'retryable' || outcome.error.message !== replaced) return false;
    this.replaced.add(request);
    serving.end(new CernantoError({ kind: 'retryable', message: replaced }));
    return true;
  }

  /** A replayed body reaching a command the log holds open (armed,
   * sent, never completed) past the body's own answer: the life that
   * answered cut the body off there (a cancel, an end from outside),
   * so the body ends here too, with the recorded answer as its own,
   * and the open command never runs live. */
  private openCommandPastAnswer(entry: Entry): boolean {
    if (entry.type !== 'response sent') return false;
    const serving = this.inHand.get(entry.data.request);
    if (serving === undefined || !serving.running()) return false;
    const outcome = entry.data.outcome;
    this.endedByHistory.set(entry.data.request, outcome);
    serving.end(
      new CernantoError({
        kind: 'terminal',
        message: `the call ${callIdOfRequest(entry.data.request)} of ${this.unit.service}/${serving.ack.handler} ended in the life that answered it: the record is its answer`,
      }),
    );
    return true;
  }

  /** The attempts over the loaded log: until the program stops, its
   * replay diverges, or another process fences it. */
  private async serveJournal(journal: Journal): Promise<void> {
    const scope = journal.scope(ROOT_LANE);
    for (let attempt = 1; ; attempt += 1) {
      const owner = new CallLifetime();
      await scope.nextAttempt(owner.signal, (error) => {
        owner.abandon(error);
      });
      this.letAllGo();
      this.loopFailure = undefined;
      try {
        for (;;) {
          await this.room();
          const settled = await scope.command<TakeOutcome>(
            {
              kind: 'take',
              // The wait ends with the signal the command hands it: the
              // attempt's end, or a take of another life (the first life's
              // after the freeze, taken in at the resume), which the
              // command then settles from, the body run here.
              run: (_creation, signal) => this.take(signal),
              completion: (done) =>
                'handed' in done ? undefined : { type: 'request ack', data: done.ack },
              settle: (entry) => {
                if (entry.type !== 'request ack') throw new Error('a request ack was expected');
                return { ack: entry.data, args: entry.data.args };
              },
              recorded: () => {
                this.settleTaken();
              },
            },
            ROOT_LANE,
          );
          if ('handed' in settled.done) {
            if (isDraining()) {
              await this.settleInHand(scope);
              await owner.close();
              return;
            }
            continue;
          }
          const { ack, args } = settled.done;
          void this.serve(scope, ack, args, owner.signal, settled.replayed).catch(
            (error: unknown) => {
              this.loopFailure ??= { error };
              const wake = this.waiting;
              this.waiting = undefined;
              wake?.();
            },
          );
        }
      } catch (error) {
        await owner.close().catch(() => undefined);
        if (processLeaves()) return;
        if (scope.diverged !== undefined) {
          kernelSay(`program ${this.unit.service} stopped: ${scope.diverged.message}\n`);
          return;
        }
        const fenced = error instanceof CernantoError && error.details?.['fenced'] === true;
        if (fenced) exitFenced(this.unit.service, error);
        // A program's attempt that failed cannot be run again in this
        // heap: a replay rebuilds the memory from the log over a fresh
        // instance, and the bodies already run here would run again over
        // a populated one. The process retires, and whoever runs it
        // starts it again, its replay from the top in a fresh heap.
        kernelSay(
          `program ${this.unit.service} attempt ${String(attempt)} failed: ${failureForRecord(error).error}; the process retires, and its replay starts afresh\n`,
        );
        retireProcess(
          `the program of ${this.unit.service} failed: ${failureForRecord(error).error}`,
        );
        return;
      }
    }
  }

  /** The queued request the take under way settled with: its post is
   * acked once the ack is recorded. */
  private taking: Queued | undefined;

  private settleTaken(): void {
    const queued = this.taking;
    this.taking = undefined;
    if (queued === undefined) return;
    const index = this.queue.indexOf(queued);
    if (index !== -1) this.queue.splice(index, 1);
    queued.posted.confirm();
    // A call in is counted the moment it is first taken.
    if (queued.ack.observation !== true) countTotals({ callsIn: 1 });
    queued.taken();
  }

  /** Resolves once the program may take one more call. */
  private room(): Promise<void> {
    if (this.inHand.size < SERVICE_CALLS_IN_HAND) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.roomWaiters.push(resolve);
    });
  }

  /** A call in flight is over, or was let go. */
  private out(request: string, mine?: object): void {
    const entry = this.inHand.get(request);
    if (entry === undefined || (mine !== undefined && entry !== mine)) return;
    this.inHand.delete(request);
    entry.release();
    if (this.inHand.size < SERVICE_CALLS_IN_HAND) {
      for (const wake of this.roomWaiters.splice(0)) wake();
    }
  }

  /** Lets every call in flight go: their holds come back, their
   * lifetimes end. What they were is in the log. */
  private letAllGo(): void {
    for (const [request, entry] of [...this.inHand]) {
      entry.end();
      this.out(request);
    }
  }

  /** The drain: a call with durable work outstanding finishes it; a
   * call that waits on the agent's own memory is let go at once,
   * because the process that serves this version next brings it back
   * from the log exactly as it was. */
  private async settleInHand(scope: ReturnType<Journal['scope']>): Promise<void> {
    for (;;) {
      const working = [...this.inHand.values()].filter(
        (entry) => scope.outstanding(entry.ack.request) > 0,
      );
      if (working.length === 0 && this.answering === 0) break;
      await sleepMs(100);
    }
    this.letAllGo();
  }

  /** A newer version answers the service now: a call that can no longer
   * finish by itself here, because it waits on this version's memory
   * and whatever would wake it now arrives at the newer one, is
   * answered that the version is replaced, so its caller asks the
   * newer one, which takes it as a new call. A call nobody waits for
   * has no caller to ask again: it is posted to another copy as a new
   * request, which takes it from its first line. A call with durable
   * work outstanding finishes here. */
  async answerWaitingReplaced(): Promise<void> {
    const journal = this.journal;
    if (journal === undefined) return;
    const scope = journal.scope(ROOT_LANE);
    if (scope.isReplaying()) return;
    const handing = holdInFlight();
    const ended: Promise<void>[] = [];
    try {
      for (const [request, entry] of [...this.inHand]) {
        if (scope.outstanding(request) > 0 || !entry.running()) continue;
        ended.push(entry.done);
        if (entry.ack.replyTo === undefined) await this.handOn(entry.ack, entry.args);
        // The ending is the call's answer here, retryable for the
        // caller, never an attempt this version runs again: the body
        // ends on its own signal, and the catch reads the mark.
        this.replaced.add(request);
        kernelSay(
          `${this.unit.service}/${entry.ack.handler} ${callIdOfRequest(request)}: ended at the drain as replaced; the caller asks the newer version\n`,
        );
        entry.end(
          new CernantoError({
            kind: 'retryable',
            message: replacedWords(this.unit.service, request),
          }),
        );
      }
      // The ended calls' answers land and are posted before the drain
      // goes on: the program's attempt closes only once they are
      // recorded, and the process leaves only once its callers were
      // told (a caller away hears it from the log, by the resend).
      await Promise.race([Promise.all(ended), sleepMs(30_000)]);
      await postOwedNow().catch(() => undefined);
    } finally {
      handing();
    }
  }

  /** Posts a request nobody waits for to another copy of the service,
   * as a new request of the same call, until a copy acks it. */
  private async handOn(ack: RequestAck, args: unknown): Promise<void> {
    const callId = callIdOfRequest(ack.request);
    try {
      const to = await chooseDestination(this.unit.agentId, { except: ownEntryKey() });
      const sent: RequestSent = {
        request: requestIdFor(callId),
        parent: 'handed',
        ordinal: 0,
        to,
        handler: ack.handler,
        args,
        ...(ack.caller === undefined ? {} : { caller: ack.caller }),
        at: Date.now(),
      };
      for (let round = 1; round <= 60; round += 1) {
        const posted = await postRequest(sent);
        if (posted.acked) return;
        if (posted.refused !== undefined) return;
        await pauseMs(Math.min(posted.retryInMs ?? 500, 2000));
      }
    } catch (error) {
      kernelSay(
        `${this.unit.service}/${ack.handler} ${callId}: the call nobody waits for could not be handed on: ${failureForRecord(error).error}\n`,
      );
    }
  }

  /** The next request to take: the queue's first, its ack. */
  private async take(signal: AbortSignal): Promise<TakeOutcome> {
    this.setServing(true);
    const item = await this.next(signal);
    if ('handed' in item) return item;
    this.taking = item;
    return { ack: item.ack, args: item.args };
  }

  /** One request served inside the program, in its lane: its body run
   * with its attempts, its answer recorded and posted. */
  private async serve(
    scope: ReturnType<Journal['scope']>,
    ack: RequestAck,
    args: unknown,
    signal: AbortSignal,
    replayedTake: boolean,
  ): Promise<void> {
    let settle: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      await this.serveUntilRecorded(scope, ack, args, signal, replayedTake, done);
    } finally {
      settle();
    }
  }

  /** The body of `serve`: the attempts, then the answer's record. */
  private async serveUntilRecorded(
    scope: ReturnType<Journal['scope']>,
    ack: RequestAck,
    args: unknown,
    signal: AbortSignal,
    replayedTake: boolean,
    done: Promise<void>,
  ): Promise<void> {
    const { request } = ack;
    const lane = scope.lane(request);
    const journal = this.journal;
    if (journal === undefined) return;
    const fn = this.handlers[ack.handler];
    const secret = isSecretHandler(fn);
    let outcome: Outcome | undefined;
    if (fn === undefined) {
      outcome = {
        error: {
          kind: 'contract-violation',
          message: `agent "${this.unit.agentId}" has no handler "${ack.handler}"`,
        },
      };
    }
    // The story the request is in the traces, each attempt a run of it.
    const storyId = storyOfLog(journal.log, request);
    for (let attempt = 1; outcome === undefined; attempt += 1) {
      const attemptNumber = scope.attemptUnderWay;
      const lifetime = new CallLifetime(signal);
      const run = { storyId, runOf: journal.nextRun() };
      let running = true;
      const serving: Serving = {
        ack,
        args,
        release: holdInFlight(),
        end: (reason) => {
          if (reason === undefined) lifetime.abort();
          else lifetime.abandon(reason);
        },
        running: () => running,
        done,
      };
      this.inHand.set(request, serving);
      try {
        // A secret handler's run (the contract's mark) is dark like an
        // observation's: the calls it makes inside carry its secrets,
        // so they leave no record either.
        const body =
          ack.observation !== true && !isSecretHandler(fn)
            ? this.runTask(lane, fn as HandlerFn, ack, args, lifetime, replayedTake, run)
            : runUnrecorded(() =>
                this.runTask(lane, fn as HandlerFn, ack, args, lifetime, replayedTake, run),
              );
        const output = await body.finally(() => {
          running = false;
        });
        outcome = { result: output };
      } catch (thrown) {
        running = false;
        const error = secret ? markSecretFailure(thrown) : thrown;
        if (error instanceof CernantoError && error.details?.['fenced'] === true) throw error;
        const recorded = this.endedByHistory.get(request);
        if (recorded !== undefined) {
          this.endedByHistory.delete(request);
          outcome = recorded;
        } else if (this.unit.cancelled.has(request)) {
          this.unit.cancelled.delete(request);
          outcome = { error: cancelledOutcome(request, this.unit.service, ack.handler) };
        } else if (this.replaced.has(request)) {
          // The drain ended the call: answered so, and the caller asks
          // the newer version.
          this.replaced.delete(request);
          outcome = {
            error: { kind: 'retryable', message: replacedWords(this.unit.service, request) },
          };
        } else if (signal.aborted) {
          // The program's attempt ended under the call: the next attempt
          // brings the call back from the log.
          this.out(request, serving);
          return;
        } else if (repeatsAttempt(error)) {
          // A transient failure is asked again after a backoff, in the
          // same lane: the lane's commands start anew, each under a new
          // request, and the caller keeps waiting on its reply.
          const wait = backoffMs(attempt);
          kernelSay(
            `${this.unit.service}/${ack.handler} ${callIdOfRequest(request)} attempt ${String(attempt)} failed: ${failureForRecord(error).error}; asking again in ${String(wait)}ms\n`,
          );
          this.out(request, serving);
          await sleepMs(wait, signal).catch(() => undefined);
          if (aborted(signal)) return;
          scope.letGo(request, attemptNumber, true);
          continue;
        } else {
          outcome = { error: failureRecord(error) };
        }
      } finally {
        this.out(request, serving);
      }
    }
    // The answer's record is the call's end: the process's drain and
    // the program's settling wait for it as they wait for the body.
    const recording = holdInFlight();
    this.answering += 1;
    try {
      await this.recordAnswer(scope, lane, ack, outcome);
    } finally {
      this.answering -= 1;
      recording();
    }
  }

  /** The answer of a served call: the `response sent` record in the
   * call's lane, then the post; a replay that finds the record posts
   * nothing. */
  private async recordAnswer(
    scope: ReturnType<Journal['scope']>,
    lane: CommandJournal,
    ack: RequestAck,
    outcome: Outcome,
  ): Promise<void> {
    await scope.command<ResponseSent>(
      {
        kind: 'answered',
        run: () =>
          Promise.resolve({
            request: ack.request,
            outcome,
            ...(ack.replyTo === undefined ? {} : { replyTo: ack.replyTo }),
            at: Date.now(),
          }),
        completion: (done) => ({ type: 'response sent', data: done }),
        settle: (entry) => {
          if (entry.type !== 'response sent') throw new Error('a response record was expected');
          return entry.data;
        },
        recorded: (entry) => {
          if (entry.type !== 'response sent' || this.journal === undefined) return;
          const journal = this.journal;
          stateOver(this.unit, journal.log, ack, entry.data.outcome);
          void postResponse(entry.data).then(
            (acked) => {
              if (acked) journal.noteResponseAcked(entry.data.request);
              else considerResend();
            },
            () => {
              considerResend();
            },
          );
        },
      },
      lane.lane,
    );
  }

  /** The task body: the per-call wrapper's own sequence, driven from
   * the program's log in the call's lane. */
  private async runTask(
    journal: CommandJournal,
    fn: HandlerFn,
    ack: RequestAck,
    args: unknown,
    owner: CallLifetime,
    replayedTake: boolean,
    run: { storyId: string; runOf: () => string },
  ): Promise<unknown> {
    const callId = callHandle(
      this.unit.service,
      callIdOfRequest(ack.request),
      this.unit.generation,
    );
    const callerAgentId = callerAgentOf(ack);
    const callerCallId = parentCallOf(ack);
    const parentStoryId = ack.caller?.story;
    const context: CallContext = {
      agentId: this.unit.agentId,
      ...(ack.observation === undefined ? {} : { observation: ack.observation }),
      callId,
      handle: callId,
      ...(callerAgentId === undefined ? {} : { callerAgentId }),
      ...(ack.caller?.target === undefined ? {} : { callerTarget: ack.caller.target }),
      ...(callerCallId === undefined ? {} : { callerCallId }),
      ...callParentField(ack),
      storyId: run.storyId,
      ...(parentStoryId === undefined ? {} : { parentStoryId }),
      childParentStory: run.storyId,
      runOf: run.runOf,
      ...(ack.caller?.charge === undefined ? {} : { charge: ack.caller.charge }),
    };
    const backend = durableBackend({ journal, context, signal: owner.signal });
    // A secret handler's run (the contract's mark) writes no record of
    // its own: the traces carry neither its input nor its output.
    const secret = isSecretHandler(fn);
    const trace = traceCounter();
    const records = openHandlerRecords(
      {
        agentId: this.unit.agentId,
        callId,
        handler: ack.handler,
        input: args,
        credentials: ack.credentials,
        parentCallId: callerCallId,
        callerAgentId,
        ...(secret || ack.observation === true ? {} : { story: storyOfRun(ack, run) }),
      },
      trace,
      { begin: !replayedTake && !secret },
    );
    let output: unknown;
    let failure: unknown;
    let failed = false;
    try {
      output = await runUnderExecution(
        { backend, context, kind: 'service', owner, trace },
        owner,
        () => fn(args),
      );
    } catch (error) {
      failure = error;
      failed = true;
    } finally {
      await owner.close();
    }
    if (!journal.isReplaying() && !secret) {
      if (failed) records.failed(failure);
      else records.ended(output);
    }
    if (failed) throw failure;
    return output;
  }
}

/** Whether a signal ended, read after an await the checker cannot see
 * past. */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** The error a cancelled call ends with. */
function cancelledError(request: string, service: string, handler: string): CernantoError {
  return new CernantoError({
    kind: 'terminal',
    message: `the call ${callIdOfRequest(request)} of ${service}/${handler} was cancelled`,
  });
}

/** The cancelled outcome as the record carries it. */
function cancelledOutcome(request: string, service: string, handler: string): RecordedError {
  return {
    kind: 'terminal',
    message: `the call ${callIdOfRequest(request)} of ${service}/${handler} was cancelled`,
    cancelled: true,
  };
}
