// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { TraceRecord } from '../gateway/types.gen.js';
import { callOfRequest, recordKeyOf, recordsAsTheyHappened } from '../server-client.js';
import type { ServerClient } from '../server-client.js';
import { elapsed } from '../output.js';

// The live follow of a worker's run under `deploy --follow`: opened
// before the ship so the run's first record is on the wire before the
// controller starts it, silent until the deploy's own lines are
// printed, done when the run's handler record ends the story. Each
// record arrives with the lines the plane rendered it as (the trace
// view's reading of one record of a live stream); this file decides
// which records are the run's and when to print.

/** What following a worker's run answered: how it ended, and the run
 * call to read again. `unseen` = the run never began inside the
 * patience window (or the operator detached); the deploy stands. */
export interface WorkerCallOutcome {
  agentId: string;
  outcome: 'ok' | 'failed' | 'unseen';
  error?: string;
  callId?: string;
}

/** A live follow on one deployed worker's run (`deploy --follow`). */
export interface WorkerFollow {
  agentId: string;
  /** The stream is connected (bounded): safe to ship after this. */
  opened: Promise<void>;
  /** Starts printing: the header, whatever buffered, then live. */
  go(): void;
  /** Always resolves: when the run's own handler record closes the
   * story, or when the patience for it to begin runs out. */
  done: Promise<WorkerCallOutcome>;
  /** Detach: stops the streams; the run continues on the plane. */
  stop(): void;
}

/** A record of the stream with the lines the plane rendered it as. */
interface Delivered {
  record: TraceRecord;
  lines: string[] | undefined;
}

/** How far before the deploy's moment a follow reads the agent's
 * records from: room for the plane's clock to run behind this
 * machine's. */
const FOLLOW_SINCE_MARGIN_MS = 5 * 60 * 1000;
/** How long a follow waits for the run to begin before it stands down:
 * a package's first boot under a busy plane takes minutes. */
const START_PATIENCE_MS = 5 * 60 * 1000;
/** A dot this often while the run has not begun. */
const DOT_EVERY_MS = 5000;

/**
 * Follows a worker's program the way `cernanto trace <agent> -f` shows
 * it, for the run-once/inline worker shape: opened before the ship
 * when the deploy names the worker, so the run's first record is on
 * the wire before the controller starts it, silent until `go()` (the
 * deploy's own lines print first), done when the run's handler record
 * ends the story. The run is told apart from an old generation's dying
 * one by its begin: a `run` handler of this agent that began from the
 * deploy's moment on (`since`, else the follow's own creation);
 * everything under that call id (a linked module's `<id>~n` included)
 * belongs to it. A broken stream reopens with a backlog and the dedupe
 * folds what both deliveries carried; `silent` (json mode) only blocks.
 */
export function followWorkerRun(
  client: Pick<ServerClient, 'callsStream' | 'call'>,
  agentId: string,
  options: {
    write: (text: string) => void;
    details?: boolean;
    /** Clocks in utc rather than this machine's zone. */
    utc?: boolean;
    debug?: boolean;
    /** Print nothing: the follow only blocks until the run is done. */
    silent?: boolean;
    /** The moment the deploy began, in epoch milliseconds: a run that
     * began from then on is the deploy's, whenever the follow opened. */
    since?: number;
    /** Patience after `go()` for the run to begin (default 60s). */
    startTimeoutMs?: number;
    reopenMs?: number;
    /** The clock, injectable so tests pin the begin-claim window. */
    now?: () => number;
  },
): WorkerFollow {
  const shippedAt = options.since ?? (options.now ?? Date.now)();
  const silent = options.silent === true;
  const view = {
    view: 'live' as const,
    details: options.details === true,
    debug: options.debug === true,
    ...(options.utc === true ? { utc: true } : {}),
  };
  const shown = new Set<string>();
  const buffered: Delivered[] = [];
  const pending: Delivered[] = [];
  let rootCallId: string | undefined;
  let live = false;
  let closing = false;
  let finished = false;
  let stopStream: () => void = () => undefined;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveDone: (outcome: WorkerCallOutcome) => void = () => undefined;
  const done = new Promise<WorkerCallOutcome>((resolve) => {
    resolveDone = resolve;
  });
  let goResolve: () => void = () => undefined;
  const wentLive = new Promise<void>((resolve) => {
    goResolve = resolve;
  });

  const say = (text: string): void => {
    if (!silent) options.write(text);
  };
  const patience = options.startTimeoutMs ?? START_PATIENCE_MS;
  let dotTimer: ReturnType<typeof setInterval> | undefined;
  let dots = 0;
  /** Ends the dots' line, if any were written, before other words. */
  const closeDots = (): void => {
    if (dotTimer !== undefined) clearInterval(dotTimer);
    dotTimer = undefined;
    if (dots > 0) say('\n');
    dots = 0;
  };
  const render = ({ record, lines }: Delivered): void => {
    const key = recordKeyOf(record);
    if (shown.has(key)) return;
    shown.add(key);
    if (silent) return;
    closeDots();
    if (lines !== undefined && lines.length > 0) options.write(`${lines.join('\n')}\n`);
  };
  const emit = (delivered: Delivered): void => {
    if (live) render(delivered);
    else buffered.push(delivered);
  };
  const finish = (outcome: WorkerCallOutcome): void => {
    if (finished) return;
    finished = true;
    closeDots();
    if (startTimer !== undefined) clearTimeout(startTimer);
    if (reopenTimer !== undefined) clearTimeout(reopenTimer);
    stopStream();
    resolveDone(outcome);
  };
  // The run's own handler record ends the story: wait out the ship's
  // printing, give the stream its tail, read the stored copy (rendered
  // the same way) to close exactly, then the verdict line.
  const close = (error: string | undefined, callId: string): void => {
    if (closing || finished) return;
    closing = true;
    void (async () => {
      await wentLive;
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const answer = await client.call(callId, view);
        for (const index of recordsAsTheyHappened(answer.records)) {
          const record = answer.records[index];
          if (record === undefined) continue;
          // A record names its request; the run's handle names its call.
          const call = callOfRequest(record.callId);
          if ((call.split('~')[0] ?? call) === callOfRequest(callId))
            emit({ record, lines: answer.lines?.[index] });
        }
      } catch {
        // The stored read is a courtesy; the stream told most of it.
      }
      if (error === undefined) {
        say(`\n${agentId} finished   trace: cernanto trace ${callId}\n`);
        finish({ agentId, outcome: 'ok', callId });
      } else {
        say(`\n${agentId} failed: ${error}   trace: cernanto trace ${callId}\n`);
        finish({ agentId, outcome: 'failed', error, callId });
      }
    })();
  };
  const claim = (record: TraceRecord): boolean => {
    const root = record.callId.split('~')[0] ?? record.callId;
    if (rootCallId !== undefined) return root === rootCallId;
    if (
      record.kind === 'begin' &&
      record.of === 'handler' &&
      record.agentId === agentId &&
      record.handler === 'run' &&
      Date.parse(record.at) >= shippedAt - 2000
    ) {
      rootCallId = root;
      if (startTimer !== undefined) clearTimeout(startTimer);
      return true;
    }
    return false;
  };
  const deliverClaimed = (delivered: Delivered): void => {
    emit(delivered);
    const { record } = delivered;
    if (record.kind === 'handler' && record.callId === rootCallId)
      close(record.error, record.callId);
  };
  const deliver = (record: TraceRecord, lines: string[] | undefined): void => {
    const before = rootCallId;
    if (!claim(record)) {
      // Not the run (an old generation's tail, another caller); keep
      // a little memory in case the run's begin travels late.
      if (rootCallId === undefined) {
        pending.push({ record, lines });
        if (pending.length > 200) pending.shift();
      }
      return;
    }
    deliverClaimed({ record, lines });
    if (before === undefined) {
      for (const held of pending.splice(0, pending.length)) {
        if (claim(held.record)) deliverClaimed(held);
      }
    }
  };
  let openResolve: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    openResolve = resolve;
    setTimeout(resolve, 3000).unref();
  });
  // The stream reads from the deploy's own moment (a margin for the
  // plane's clock): an old generation's runs are the past.
  const since = new Date(shippedAt - FOLLOW_SINCE_MARGIN_MS).toISOString();
  const connect = (backlog: number): void => {
    if (finished) return;
    stopStream = client.callsStream(
      agentId,
      {
        backlog,
        since,
        ...view,
        onOpen: openResolve,
        onEnd: () => {
          openResolve();
          if (finished || closing) return;
          reopenTimer = setTimeout(() => {
            connect(500);
          }, options.reopenMs ?? 1000);
          reopenTimer.unref();
        },
      },
      deliver,
    );
  };
  connect(50);
  return {
    agentId,
    opened,
    done,
    go: (): void => {
      if (live) return;
      live = true;
      say(`following ${agentId} live; ctrl-c detaches and the program continues on the plane\n`);
      for (const delivered of buffered.splice(0, buffered.length)) render(delivered);
      goResolve();
      if (rootCallId === undefined && !finished) {
        // A dot every few seconds until the run's first record, so a
        // program the plane is still starting reads as coming.
        dotTimer = setInterval(() => {
          if (rootCallId !== undefined || finished) return;
          dots += 1;
          say('.');
        }, DOT_EVERY_MS);
        dotTimer.unref();
        startTimer = setTimeout(() => {
          if (rootCallId !== undefined || finished) return;
          closeDots();
          say(
            `no run of ${agentId} began within ${elapsed(patience)}; the deploy stands: cernanto trace ${agentId} -f\n`,
          );
          finish({ agentId, outcome: 'unseen' });
        }, patience);
        startTimer.unref();
      }
    },
    stop: (): void => {
      finish({ agentId, outcome: 'unseen' });
    },
  };
}
