// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// Booting a served process: the commands owned, the console captured,
// the substrate opened before the agent's code loads, the copy's log
// owned by its grant (the launcher's, or one issued here when none was
// handed), the agent named in the directory, the one served agent of
// the process on its call server, the words to it taken, every request
// the log took and never answered met by its type, a worker's own run
// started, the copy's record said on the plane, the idle file written,
// the drain armed, the dead logs of the service swept.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { installGracefulShutdown, isDraining } from './admission.js';
import {
  askingAgain,
  dueWaitMoments,
  endWithProcess,
  rearmDueWaits,
  retireProcess,
  sleepMs,
  setRetireHook,
} from './lifetime.js';
import { CernantoError, failureForRecord } from '../language/errors.js';
import { setTraceSink } from '../traces/trace.js';
import { outsideExecution } from './execution.js';
import { serviceNameOf } from '../language/naming.js';
import {
  closeSubstrate,
  openSubstrate,
  releaseSubstrate,
  reopenSubstrate,
  substrate,
  substrateSuspended,
  suspendSubstrate,
} from './connection.js';
import { installCommandOwnership } from './commands.js';
import { installTransparentGlobals } from './globals.js';
import { closeBootCall, openBootCall } from '../traces/boot-call.js';
import { installConsoleCapture, installStreamCapture } from '../traces/observe.js';
import { traceSink } from '../traces/sink.js';
import type { TraceSink } from '../traces/trace.js';
import { HAND_ON_HANDLER, PROGRAM_HANDLER } from '../language/program.js';
import { callIdOfKey } from './durable-backend.js';
import {
  HOST_AGENT,
  hostLaneInbox,
  onWord,
  openDesk,
  registerJournal,
  resendNow,
  tellController,
  tellHostJob,
} from './transport.js';
import { RUN_CUT_EXIT, processFacts, processIdentity, setProcessFacts } from './facts.js';
import { writeTracePart } from '../traces/delivery.js';
import {
  isReleaseAgent,
  ownLife,
  resolveTraceFacts,
  retentionMs,
  setOwnLog,
  writerNow,
} from './trace-facts.js';
import { workerRunKey } from './status.js';
import { entrySaid, forgetEntry, ownEntryKey, sayEntry } from './copy-entry.js';
import { closeCallServer, openCallServer, setTraceFollow, setWorkload } from './call-server.js';
import { workloadOf } from './workload.js';
import { closeListeners } from './listeners.js';
import { CallLane, ServedUnit } from './units.js';
import { meetTaken, serveRequest } from './serve.js';
import { ProgramUnit } from './program.js';
import { dropTakenLog, serveHandOn, sweepDeadLogs } from './resume.js';
import { asksLifeWord, serveLifeWord } from './life-words.js';
import type { CallEnvelope } from './envelope.js';
import { CONTROL_FOLDER } from './control.js';
import { drainAdapter } from './drain.js';
import { drainRandomness, installPause } from './pause.js';
import { installIdleFile } from './idle.js';
import { installImageBound, refuseStartOverImage } from './image.js';
import { announceListeners, installListenerObserver } from './listeners.js';
import { fence, installWords, readWordsAtBoot } from './fence.js';
import { Journal, newerHolderOwns, onUnsureWrite } from './journal.js';
import { callEnvelopeOf } from './envelope.js';
import { agentKey } from './substrate.js';
import type { Substrate } from './substrate.js';
import type { Holding } from './plane.js';
import type { Definition } from '../language/core.js';
import { kernelSay } from '../traces/observe.js';

/** How often the dead logs of the service are swept. */
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/** The sink the process's traces go through: the calls of the release's
 * own modules (an agent among the release's, a linked call) are left out
 * of the traces before the write, and counted in the totals all the
 * same. */
function keptOutOfTheRelease(sink: TraceSink): TraceSink {
  const leftOut = (agentId: string, story: string): boolean =>
    story.includes('~') && isReleaseAgent(agentId);
  return {
    record: (record) => {
      if (!leftOut(record.agentId, record.callId)) sink.record(record);
    },
    fact: (fact, under) => {
      if (!leftOut(fact.agentId, fact.story)) sink.fact?.(fact, under);
    },
    pointer: (pointer) => {
      if (!leftOut(pointer.agentId, pointer.child)) sink.pointer?.(pointer);
    },
    count: (delta, under) => {
      sink.count?.(delta, under);
    },
  };
}

/** Whether a request names a life other than this copy's: a request on
 * its way to a copy of a life that ended is taken by no copy of a new
 * life, whatever address it reached. A request that names no life is
 * anyone's. */
function otherLife(envelope: CallEnvelope): boolean {
  const named = envelope.to.life;
  const own = processFacts().life;
  return named !== undefined && own !== undefined && named !== own;
}

/** Answers a request named to another life as a deleted agent's call is
 * answered: the life it was sent to has ended, for good, so no caller
 * asks it again of the life that took the name since. */
function refuseOtherLife(
  posted: { refuse: (error: { kind: string; message: string }) => void },
  envelope: CallEnvelope,
): void {
  posted.refuse({
    kind: 'terminal',
    message: `the life ${envelope.to.life ?? ''} of ${envelope.to.service} this call was sent to has ended: the agent was deleted, and the call that waited for it is over`,
  });
}

/** The journals of a resume, run with every reach held and the
 * identity installed: the own log is owned anew under the new grant
 * when the life changed (a restore), and the rows it gained past what
 * this process knows are taken in (a restored life reads what the
 * first life wrote after the freeze); a log taken over is let go under
 * a new life (the sibling road takes it again on demand) and taken in
 * otherwise. Answers how many records came in. */
async function resumeJournals(
  unit: ServedUnit,
  handles: Substrate,
  attemptChanged: boolean,
): Promise<number> {
  let records = 0;
  const own = unit.journal;
  if (own !== undefined) {
    own.useHandles(handles);
    if (attemptChanged) {
      const facts = processFacts();
      const attempt = facts.attempt ?? processIdentity();
      const launch = facts.launch ?? (await handles.logsOf(own.life).issue(own.log));
      try {
        await askingAgain(`the ownership of ${own.log}`, () => own.reown(handles, attempt, launch));
      } catch (error) {
        if (newerHolderOwns(error)) {
          closeListeners();
          kernelSay(`fenced: ${failureForRecord(error).error}; the process exits\n`);
          process.exit(2);
        }
        throw error;
      }
    }
    records += await askingAgain(`the tail of ${own.log}`, () => own.takeInTail(handles));
    own.useHandles(undefined);
    // A request the tail shows answered (by the first life after the
    // freeze) whose body runs here still: the body ends, its work
    // stopped, and the standing answer is the call's.
    for (const taken of own.state.taken.values()) {
      const request = taken.ack?.request;
      if (request === undefined || taken.response === undefined) continue;
      const body = unit.bodies.get(request);
      if (body === undefined) continue;
      kernelSay(
        `${unit.service}: the request ${request} was answered in another life; its work here is stopped\n`,
      );
      body.end();
    }
  }
  for (const [log, journal] of [...unit.taken]) {
    if (attemptChanged) {
      dropTakenLog(unit, log);
      continue;
    }
    journal.useHandles(handles);
    records += await askingAgain(`the tail of ${log}`, () => journal.takeInTail(handles));
    journal.useHandles(undefined);
  }
  // What the tail left owed (a response the first life recorded and
  // never posted, a request it never heard the ack of) is posted now,
  // not at the loop's next tick.
  resendNow();
  return records;
}

export interface ServeOptions {
  /** A proof's own sink: one file of records per served agent. */
  traceDir?: string;
  /** Where traces go when no file is named: `substrate` writes them
   * into the plane's store under the agent's life, the road of a process
   * the plane runs; absent, nothing is kept. */
  traces?: 'substrate';
  /** A worker's run number: the process starts that run itself once it
   * serves. */
  run?: number;
  /** The working folder: the pause's words land under its control
   * folder, the idle file beside them. */
  workingDir?: string;
  /** The copy's holding, read anew after a pause: the block's read of
   * its record. None in a process the plane does not run. */
  holding?: () => Promise<Holding | undefined>;
}

/**
 * Serves the one agent of this process on the substrate, the agent its
 * facts name. The returned promise resolves once the agent takes its
 * calls.
 */
export async function serveAgent(definition: Definition, options: ServeOptions): Promise<void> {
  const agentId = processFacts().agentId;
  if (agentId === undefined || agentId === '') {
    throw new CernantoError({
      kind: 'terminal',
      message: 'a served process names its agent in its facts before it serves',
    });
  }
  installCommandOwnership();
  // A write of unknown outcome on any log of this process (a take, an
  // answer, a caller's ack, an observation) retires it: the next life
  // reads the log as it stands, where this one can neither read nor
  // write it and a landed answer would otherwise reach nobody.
  onUnsureWrite((log, cause) => {
    retireProcess(
      `the log ${log} has a write of unknown outcome (${cause}); the next life reads it as it stands`,
    );
  });
  installTransparentGlobals();
  installListenerObserver();
  installConsoleCapture();
  installStreamCapture();
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => undefined);
  const closers: (() => Promise<void>)[] = [];
  let flushTraces: (() => Promise<void>) | undefined;
  if (options.traceDir !== undefined) {
    const traceDir = options.traceDir;
    mkdirSync(traceDir, { recursive: true });
    setTraceSink({
      record(record) {
        appendFileSync(
          join(traceDir, `${serviceNameOf(record.agentId)}.jsonl`),
          `${JSON.stringify(record)}\n`,
          { mode: 0o600 },
        );
      },
    });
  } else if (options.traces === 'substrate') {
    const sink = traceSink({
      write: writeTracePart,
      own: ownLife,
      writer: writerNow,
      retentionMs,
    });
    closers.push(() => sink.close());
    // Before an image is taken, what is counted is formed into numbered
    // saves: the image keeps the number its first life gave each, so a
    // save counts once whichever life sends it.
    flushTraces = () => {
      sink.formSaves();
      return sink.flush();
    };
    setTraceFollow((story, send, done) => sink.follow(story, send, done));
    closers.push(() => {
      setTraceFollow(undefined);
      return Promise.resolve();
    });
    setTraceSink(keptOutOfTheRelease(sink.sink));
  }
  drainRandomness();
  const handles = await openSubstrate();
  // The lives the traces and the journal are kept under, before the
  // journal opens: the launch's, else the names'.
  await resolveTraceFacts(handles);
  await openDesk();
  const generation = String(processFacts().generationPort ?? 0);
  const unit = new ServedUnit(agentId, definition, generation, {
    workingDir: options.workingDir,
  });
  // The copy's log, owned by its grant: a record that names an image is
  // restored by the host job, never booted afresh over the log.
  await refuseStartOverImage();
  const facts = processFacts();
  const life = facts.life;
  if (life === undefined)
    throw new Error(`${agentId} runs under no life: its name's record was not read`);
  let journal: Journal;
  try {
    journal = await Journal.open(unit.inbox, {
      attempt: facts.attempt ?? processIdentity(),
      life,
      launch: facts.launch,
    });
  } catch (error) {
    if (newerHolderOwns(error)) {
      fence(failureForRecord(error).error);
      await sleepMs(60_000);
      process.exit(2);
    }
    throw error;
  }
  unit.journal = journal;
  // The totals name this copy by its life and its log, and a save is
  // numbered by the grant this process owns the log by now.
  setOwnLog(journal.log, () => journal.launch);
  const unregisterJournal = registerJournal(journal);
  closers.unshift(() => {
    unregisterJournal();
    return Promise.resolve();
  });
  // The directory names the agent from here.
  const entry = await handles.records.read(agentKey(agentId));
  if (entry.value === null) {
    await handles.records
      .write(
        agentKey(agentId),
        JSON.stringify({
          service: unit.service,
          agentId,
          type: definition.kind,
          since: Date.now(),
        }),
        null,
      )
      .catch(() => undefined);
  }
  const ownHost = processFacts().holder?.host ?? processFacts().host;
  const lanes = (
    room: ConstructorParameters<typeof CallLane>[1],
    handle: ConstructorParameters<typeof CallLane>[2],
  ): void => {
    unit.lane = new CallLane(unit.service, room, handle);
    if (ownHost !== undefined)
      unit.hostLane = new CallLane(hostLaneInbox(unit.service, ownHost), room, handle);
  };
  const notACall = (
    posted: { refuse: (error: { kind: string; message: string }) => void },
    id: string,
  ): void => {
    posted.refuse({
      kind: 'contract-violation',
      message: `the message ${id} is no call of ${unit.service}`,
    });
  };
  if (definition.kind === 'service') {
    const program = new ProgramUnit(unit, unit.handlers);
    unit.program = program;
    lanes({ has: () => true, holds: (id) => unit.holdsRequest(id) }, (posted, handed) => {
      const envelope = callEnvelopeOf(handed.body);
      if (envelope === undefined) {
        notACall(posted, handed.id);
        return;
      }
      if (envelope.handler === HAND_ON_HANDLER) return serveHandOn(unit, posted, envelope);
      if (asksLifeWord(envelope.handler)) return serveLifeWord(posted, envelope);
      if (otherLife(envelope)) {
        refuseOtherLife(posted, envelope);
        return;
      }
      return program.arrive(posted, envelope);
    });
  } else if (definition.kind !== 'worker') {
    lanes(
      { has: (pending) => unit.hasRoom(pending), holds: (id) => unit.holdsRequest(id) },
      (posted, handed) => {
        const envelope = callEnvelopeOf(handed.body);
        if (envelope === undefined) {
          notACall(posted, handed.id);
          return;
        }
        if (envelope.handler === HAND_ON_HANDLER) return serveHandOn(unit, posted, envelope);
        if (asksLifeWord(envelope.handler)) return serveLifeWord(posted, envelope);
        if (otherLife(envelope)) {
          refuseOtherLife(posted, envelope);
          return;
        }
        return serveRequest(unit, posted, handed, envelope);
      },
    );
  } else {
    lanes(
      { has: (pending) => unit.hasRoom(pending), holds: (id) => unit.holdsRequest(id) },
      (posted, handed) => {
        const envelope = callEnvelopeOf(handed.body);
        if (envelope === undefined) {
          notACall(posted, handed.id);
          return;
        }
        if (envelope.handler === HAND_ON_HANDLER) return serveHandOn(unit, posted, envelope);
        if (asksLifeWord(envelope.handler)) return serveLifeWord(posted, envelope);
        if (otherLife(envelope)) {
          refuseOtherLife(posted, envelope);
          return;
        }
        return serveRequest(unit, posted, handed, envelope);
      },
    );
  }
  // Cancellation keeps its road: a word posted to this copy; the copy
  // that holds a call ends its attempt and answers the cancellation.
  onWord((word) => {
    const request = word.body as { operation?: unknown; callId?: string } | undefined;
    const callId = request?.callId ?? '';
    if (request?.operation !== 'cancel' && request?.operation !== 'kill') {
      word.answer({ done: false });
      return;
    }
    if (unit.program !== undefined) {
      word.answer({ done: unit.program.cancel(callId) });
      return;
    }
    let reached = false;
    for (const [held, owner] of [...unit.owners]) {
      if (held.slice(0, held.lastIndexOf(':')) !== callId) continue;
      unit.cancelled.add(held);
      owner.abort();
      reached = true;
    }
    word.answer({ done: reached });
  });
  closers.unshift(() => {
    onWord(undefined);
    return Promise.resolve();
  });
  // A worker's own run: a process whose launch names its run starts it
  // here at boot; a process that came back continues the same run, or
  // finds it answered and leaves it so.
  const ownRun = options.run;
  const startOwnRun = (): void => {
    if (ownRun === undefined || unit.definition.kind !== 'worker') return;
    const callId = callIdOfKey(workerRunKey(unit.agentId, generation, ownRun));
    const request = `${callId}:run`;
    const handler =
      PROGRAM_HANDLER in unit.definition.handlers
        ? PROGRAM_HANDLER
        : Object.keys(unit.definition.handlers)[0];
    if (handler === undefined) return;
    unit.runRequest = request;
    void untilServed(`the run of ${unit.service}`, async () => {
      const taken = journal.takenOf(request);
      if (taken?.response !== undefined) {
        // Answered in an earlier life: the process ends with the run's
        // code, as the first life's did.
        if (!unit.runsEnded.has(request)) {
          const outcome = taken.response.outcome;
          const code = unit.runEnded(
            request,
            'error' in outcome
              ? { error: { kind: 'terminal', message: 'the run failed' } }
              : { result: outcome.result },
          );
          unit.endProcess?.(code);
        }
        return;
      }
      if (taken !== undefined || unit.bodies.has(request)) return;
      await journal.take({ request, from: '', handler, args: {}, at: Date.now() });
      meetTaken(
        unit,
        journal,
        journal.takenOf(request) as NonNullable<ReturnType<Journal['takenOf']>>,
      );
    });
  };
  // The copy answers for its own workload: the calls its logs hold now.
  setWorkload(() => workloadOf(unit));
  closers.unshift(() => {
    setWorkload(undefined);
    return Promise.resolve();
  });
  const address = await openCallServer({
    lanes: () => [unit.lane, unit.hostLane].filter((lane) => lane !== undefined),
  });
  closers.unshift(() => closeCallServer());
  unit.setServing(true);
  sayEntry({ ready: true, ...(address === undefined ? {} : { address }) });
  const copyFacts = (): {
    agentId: string;
    port: number | undefined;
    copy: number | undefined;
    host: string | undefined;
  } => {
    const now = processFacts();
    return {
      agentId,
      port: now.generationPort,
      copy: now.copy,
      host: now.holder?.host ?? now.host,
    };
  };
  closers.push(() => forgetEntry());
  closers.push(async () => {
    if (ownEntryKey() === undefined) return;
    await tellController('copyExited', { ...copyFacts(), why: leaving }).catch(() => undefined);
  });
  closers.push(closeSubstrate);
  let leaving = 'signal';
  openBootCall(agentId, definition.kind, generation);
  closers.unshift(() => {
    closeBootCall(leaving);
    return Promise.resolve();
  });
  const stopIntake = drainAdapter(unit);
  const shutdown = installGracefulShutdown(stopIntake, closers, {
    signalCode: definition.kind === 'worker' ? RUN_CUT_EXIT : 0,
  });
  setRetireHook(() => {
    leaving = 'retired';
    shutdown(1);
  });
  const endWords = installWords({
    drain: (why, code) => {
      leaving = why;
      shutdown(code);
    },
    word: (word, why) => {
      leaving = `${word} word: ${why}`;
      shutdown(definition.kind === 'worker' ? RUN_CUT_EXIT : 0);
    },
  });
  const endIdleFile = installIdleFile(unit, options.workingDir);
  closers.unshift(() => {
    endIdleFile();
    return Promise.resolve();
  });
  const endImageBound = installImageBound(unit);
  closers.unshift(() => {
    endImageBound();
    return Promise.resolve();
  });
  const copy = processFacts().copy;
  const unpause = installPause({
    unit,
    holding: options.holding ?? (() => Promise.resolve(undefined)),
    ...(unit.workingDir === undefined
      ? {}
      : { workingDir: unit.workingDir, controlDir: join(unit.workingDir, CONTROL_FOLDER) }),
    ...(copy === undefined ? {} : { copy }),
    flushTraces: () => flushTraces?.() ?? Promise.resolve(),
    releaseWatches: () => undefined,
    reopenWatches: () => undefined,
    resumeUnfinished: () => {
      for (const taken of journal.state.taken.values()) meetTaken(unit, journal, taken);
      return Promise.resolve();
    },
    suspendSubstrate: () => suspendSubstrate(),
    reopenSubstrate: () => reopenSubstrate(),
    resumeJournals: (reopened, attemptChanged) => resumeJournals(unit, reopened, attemptChanged),
    releaseSubstrate: () => {
      releaseSubstrate();
      void openDesk().catch(() => undefined);
    },
    substrateSuspended,
    dueWaitMoments,
    rearmDueWaits,
    markReady: () => {
      sayEntry({ ready: true, resumedAt: Date.now() });
    },
    announceListeners,
    identityChanged: (holder, attempt, launch) => {
      setProcessFacts({ ...processFacts(), holder, attempt, launch });
    },
  });
  closers.unshift(() => {
    unpause();
    return Promise.resolve();
  });
  await readWordsAtBoot();
  closers.unshift(() => {
    endWords();
    return Promise.resolve();
  });
  closers.unshift(endWithProcess);
  unit.endProcess = (code) => {
    leaving = `run over, exit ${String(code)}`;
    shutdown(code);
  };
  // The program's loop is the kernel's own, outside any execution. A
  // task, a job or a worker meets every request its log took and never
  // answered, once, at boot.
  if (unit.program !== undefined) void outsideExecution(() => unit.program?.run());
  else {
    outsideExecution(() => {
      for (const taken of journal.state.taken.values()) meetTaken(unit, journal, taken);
    });
    startOwnRun();
  }
  // The dead logs of the service: swept once the copy serves, and every
  // hour after.
  const sweep = (): void => {
    void sweepDeadLogs(unit).catch((error: unknown) => {
      kernelSay(
        `the sweep of ${unit.service}'s dead logs failed: ${failureForRecord(error).error}\n`,
      );
    });
  };
  const sweeping = setInterval(sweep, SWEEP_EVERY_MS);
  sweeping.unref();
  closers.unshift(() => {
    clearInterval(sweeping);
    return Promise.resolve();
  });
  setTimeout(sweep, 5000).unref();
  await entrySaid();
  if (ownEntryKey() !== undefined) {
    void tellController('copyReady', copyFacts()).catch(() => undefined);
    const ready = copyFacts();
    if (
      agentId !== HOST_AGENT &&
      ready.port !== undefined &&
      ready.copy !== undefined &&
      ready.host !== undefined
    )
      void tellHostJob(ready.host, 'start', { port: ready.port, copy: ready.copy }).catch(
        () => undefined,
      );
  }
  await substrate();
}

/** Runs a boot-time ask until it settles: a substrate away at boot only
 * delays it, and a draining process lets it go. */
async function untilServed(what: string, ask: () => Promise<void>): Promise<void> {
  for (let attempt = 1; !isDraining(); attempt += 1) {
    try {
      await ask();
      return;
    } catch (error) {
      kernelSay(
        `${what}: ${error instanceof Error ? error.message : String(error)}; asking again\n`,
      );
    }
    await sleepMs(Math.min(1000 * 2 ** (attempt - 1), 30_000));
  }
}
