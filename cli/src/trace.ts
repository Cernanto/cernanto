// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { AGENT_PATH_PATTERN, CernantoError } from '@cernanto/package-format';

import { answerOnScreen, watchAsks } from './asks.js';
import { currentPlane } from './gateway-client.js';
import { resolveAgentSelector } from './deploy/landing.js';
import { asNotDeployed, fail, interactive, outputOf } from './output.js';
import type { OutputOptions } from './output.js';
import { ServerClient, callOfRequest, recordKeyOf } from './server-client.js';
import type { CallStreamEvent, CallSummary, LsRow, TraceRecord } from './gateway/types.gen.js';
import { terminalIo } from './terminal.js';

// `cernanto trace`: one agent's conversation as a chat. A run id reads
// that run; an agent id reads its latest run; `-f` follows the agent
// live, the way `logs -f` follows a process.

/** Whether a trace's target names an agent: an agent id is its spec's
 * path, kebab-case segments joined by `/`, one segment for a spec at
 * the workspace's root. A call id spells its service, its generation
 * and its key with colons between them, which an agent id never
 * carries. */
export function isAgentId(target: string): boolean {
  return AGENT_PATH_PATTERN.test(target);
}

/** The civilian trace: the run read as the conversation it was, in
 * agent vocabulary, rendered on the plane by the trace view and
 * streamed by the gateway (`callStream`, `view=conversation`), written
 * as it comes; `--details` expands the folded details (contexts,
 * reasoning, whole values), `--debug` adds the agent's own debug
 * lines, `--raw` writes the records as json instead (an array, each
 * record as it arrives), `-o json` the call tree (the walk assembled
 * here). */
export async function traceRun(
  client: Pick<ServerClient, 'callStream' | 'calls' | 'describe'>,
  callIdOrAgent: string,
  options: OutputOptions & {
    raw?: boolean;
    details?: boolean;
    debug?: boolean;
    /** The wait between asks for a young running call; the proofs hand a quick one. */
    pause?: (ms: number) => Promise<void>;
    /** The quiet after the last event that ends the read of a call still running; the proofs hand a short one. */
    quietMs?: number;
  },
  write: (text: string) => void,
): Promise<void> {
  // An agent id instead of a run id reads the agent's latest run: what
  // a worker's deploy prints, and the natural question after it ("what
  // did text/word-count do?").
  const callId = isAgentId(callIdOrAgent)
    ? await latestCallOf(client, callIdOrAgent, options.pause)
    : callIdOrAgent;
  // A read ends at the records that stand: a call still running keeps
  // its stream open for the records to come, so a quiet after the last
  // event lets the stream go and the read ends; a follow is `-f`.
  const quietMs = options.quietMs ?? READ_QUIET_MS;
  const stream = (
    asked: { tree?: boolean; view?: 'conversation'; details?: boolean; debug?: boolean },
    onEvent: (event: CallStreamEvent) => void,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      let failed: Error | undefined;
      let settled = false;
      let quiet: NodeJS.Timeout | undefined;
      const settle = (end: () => void): void => {
        if (settled) return;
        settled = true;
        if (quiet !== undefined) clearTimeout(quiet);
        end();
      };
      const stop = client.callStream(
        callId,
        {
          ...asked,
          onEnd: (error) => {
            settle(() => {
              if (error !== undefined)
                reject(error instanceof Error ? error : new Error('the call stream broke'));
              else if (failed !== undefined) reject(failed);
              else resolve();
            });
          },
        },
        (event) => {
          if (failed !== undefined) return;
          if (event.error !== undefined) {
            failed = new CernantoError({ kind: 'terminal', message: event.error });
            return;
          }
          onEvent(event);
          if (quiet !== undefined) clearTimeout(quiet);
          quiet = setTimeout(() => {
            settle(() => {
              stop();
              resolve();
            });
          }, quietMs);
        },
      );
    });
  if (options.raw === true) {
    // The records as one json array, written as they arrive: the text
    // JSON.stringify would make of the whole array with two spaces.
    let count = 0;
    await stream({}, (event) => {
      if (event.record === undefined) return;
      const body = JSON.stringify(event.record, null, 2)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      write(`${count === 0 ? '[' : ','}\n${body}`);
      count += 1;
    });
    write(count === 0 ? '[]\n' : '\n]\n');
    return;
  }
  if (options.output === 'json') {
    // The tree written as the walk tells it, piece by piece, in the
    // text JSON.stringify(tree, null, 2) would make of the whole: a
    // call entered at a depth opens a child of the call one level up,
    // after that call's records.
    const pad = (count: number): string => ' '.repeat(count);
    const indented = (value: unknown, indent: number): string =>
      JSON.stringify(value, null, 2)
        .split('\n')
        .map((line, index) => (index === 0 ? line : pad(indent) + line))
        .join('\n');
    interface Open {
      indent: number;
      records: number;
      recordsOpen: boolean;
      children: number;
      childrenOpen: boolean;
    }
    const open: Open[] = [];
    const closeRecords = (node: Open): void => {
      if (!node.recordsOpen) return;
      write(node.records === 0 ? ']' : `\n${pad(node.indent + 2)}]`);
      node.recordsOpen = false;
    };
    const close = (): void => {
      const node = open.pop();
      if (node === undefined) return;
      closeRecords(node);
      if (!node.childrenOpen) write(`,\n${pad(node.indent + 2)}"children": []`);
      else write(node.children === 0 ? ']' : `\n${pad(node.indent + 2)}]`);
      write(`\n${pad(node.indent)}}`);
    };
    const enter = (call: CallSummary, depth: number): void => {
      while (open.length > depth) close();
      const parent = open[depth - 1];
      let indent = 0;
      if (depth > 0 && parent !== undefined) {
        closeRecords(parent);
        if (!parent.childrenOpen) {
          write(`,\n${pad(parent.indent + 2)}"children": [`);
          parent.childrenOpen = true;
        }
        write(`${parent.children === 0 ? '' : ','}\n${pad(parent.indent + 4)}`);
        parent.children += 1;
        indent = parent.indent + 4;
      }
      write(
        `{\n${pad(indent + 2)}"call": ${indented(call, indent + 2)},\n${pad(indent + 2)}"records": [`,
      );
      open.push({ indent, records: 0, recordsOpen: true, children: 0, childrenOpen: false });
    };
    await stream({ tree: true }, (event) => {
      if (event.call !== undefined) {
        enter(event.call, event.depth ?? 0);
        return;
      }
      const node = open[open.length - 1];
      if (event.record === undefined || node === undefined) return;
      write(
        `${node.records === 0 ? '' : ','}\n${pad(node.indent + 4)}${indented(event.record, node.indent + 4)}`,
      );
      node.records += 1;
    });
    if (open.length === 0) {
      throw new CernantoError({ kind: 'terminal', message: `the call "${callId}" told no call` });
    }
    while (open.length > 0) close();
    write('\n');
    return;
  }
  await stream(
    { view: 'conversation', details: options.details === true, debug: options.debug === true },
    (event) => {
      if (event.lines === undefined) return;
      for (const line of event.lines) write(`${line}\n`);
    },
  );
}

/** The quiet after a stream's last event that ends a read: a call that
 * answered sends its records at once and its stream ends by itself; one
 * still running keeps its stream open, and the read lets it go after
 * this long with nothing new. */
const READ_QUIET_MS = 1500;

/** How young a still-running latest call is before it is asked again,
 * and how long the asks wait between them: the trace sinks ship by
 * their tick, so a call that answered a moment ago reads as running
 * with its last records still on their way. */
const YOUNG_MS = 5000;
const PATIENCE_MS = 1000;
const ASKS = 3;

/** The latest run of an agent, by when it began; a plain error when
 * it has none yet. A latest call still running and younger than a few
 * seconds is asked again a moment later, up to three asks, so the
 * story read right after an invoke is the whole story and not the
 * part the sinks had shipped by then; a call that keeps running is
 * read as it stands. */
async function latestCallOf(
  client: Pick<ServerClient, 'calls' | 'describe'>,
  agentId: string,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<string> {
  for (let ask = 1; ; ask += 1) {
    const runs = await client.calls({ agent: agentId, limit: 1 });
    const latest = runs[0];
    if (latest === undefined) {
      // A copy stores its records a moment after its call answers: a
      // trace asked right after an invoke waits for them before saying
      // there is no call at all.
      if (ask < ASKS) {
        await pause(PATIENCE_MS);
        continue;
      }
      await deployedToFollow(client, agentId);
      throw new CernantoError({
        kind: 'terminal',
        message: `no calls of "${agentId}" yet; a worker starts once its generation serves, follow it with cernanto trace ${agentId} -f`,
      });
    }
    const young = latest.status === 'running' && Date.now() - Date.parse(latest.at) < YOUNG_MS;
    if (!young || ask >= ASKS) return latest.callId;
    await pause(PATIENCE_MS);
  }
}

/**
 * Refuses an id nothing is deployed as, in words: its calls would be
 * waited for with nothing to bring them. Any other failure of the ask
 * is left for the read that follows to say.
 *
 * @param client - The plane's description of an agent.
 * @param agentId - The agent a follow or a latest call is asked of.
 * @example
 * await deployedToFollow(client, 'text/word-count');
 */
export async function deployedToFollow(
  client: Pick<ServerClient, 'describe'>,
  agentId: string,
): Promise<void> {
  try {
    await client.describe(agentId);
  } catch (error) {
    const words = asNotDeployed(error, agentId);
    if (words !== error) throw words;
  }
}

/** How a follow keeps its stream: the wait before a reopening, doubled
 * at each one that fails, and how many may fail in a row. */
const REOPEN_MS = 1000;
const REOPENINGS = 5;

/** The words of whatever ended a stream. */
function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A live follow of an agent's calls: `stop` ends it, and `ended`
 * settles when it is over, rejecting when the stream is lost. */
/** How a follow ended: the program it watched ended, nothing began
 * within its patience, or it was stopped. */
export type AgentFollowEnd = 'program' | 'nothing-began' | 'stopped';

export interface AgentFollow {
  stop(): void;
  ended: Promise<AgentFollowEnd>;
}

/**
 * Follows an agent's calls live until stopped. A stream the plane
 * refuses at the start (an agent it does not know, a plane out of
 * reach) ends the follow with the plane's words. A stream that opened
 * and then ended, or broke, is opened again from the last record it
 * told, each record written once; reopenings that keep failing end the
 * follow with the last failure.
 *
 * @param client - The plane's stream of an agent's calls.
 * @param agentId - The agent to follow.
 * @param options - `backlog`: how many recent records come first;
 *   `raw`, `details`, `debug`: the view asked of the plane; `reopenMs`:
 *   the wait before a reopening.
 * @param onRecord - Told each record once, with its rendered lines.
 * @param say - Told a line when the stream is being reopened.
 * @returns The follow's stop and its end.
 * @example
 * const follow = followAgent(client, 'text/word-count', { backlog: 10 }, show, console.error);
 */
/** How long a worker's follow waits for a run when the plane says the
 * program has finished: a restart's run begins within this. */
const FINISHED_PATIENCE_MS = 30_000;

/** What `-f` says of a worker whose program has already ended. */
export function finishedWorkerWords(agentId: string): string {
  return `\n${agentId} finished; run it again: cernanto deploy ${agentId}\n`;
}

export function followAgent(
  client: Pick<ServerClient, 'callsStream'>,
  agentId: string,
  options: {
    backlog: number;
    raw?: boolean;
    details?: boolean;
    debug?: boolean;
    reopenMs?: number;
    /** The agent is a program (a worker): the follow ends by itself
     * when the program it watched ends, which the runtime records as
     * the close of the program's run call, or of the process's boot
     * call when the process goes. A close is the watched program's
     * when the follow saw its begin, or when it came after the follow
     * began; an older run's close in the backlog ends nothing. */
    endsWithProgram?: boolean;
    /** The program was not running when the follow opened: when no run
     * of it begins within this long, the follow ends as `nothing-began`
     * (a dot every few seconds meanwhile), so a program that has ended
     * is read as ended, and one a restart is about to run is caught. */
    startPatienceMs?: number;
  },
  onRecord: (record: TraceRecord, lines?: string[]) => void,
  say: (line: string) => void,
): AgentFollow {
  let stopped = false;
  let everOpened = false;
  const startedAt = Date.now();
  const programs = new Set<string>();
  let failures = 0;
  let lastAt: string | undefined;
  let stopStream: () => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The records told, by their key, so a record a reopened stream tells
  // again is written once.
  const told = new Set<string>();
  const order: string[] = [];
  let finish: (how: AgentFollowEnd) => void = () => undefined;
  let lose: (error: unknown) => void = () => undefined;
  const ended = new Promise<AgentFollowEnd>((resolve, reject) => {
    finish = resolve;
    lose = reject;
  });
  // The patience for a run to begin, and the dots that pass the time.
  let began = false;
  let dots = 0;
  let dotTimer: ReturnType<typeof setInterval> | undefined;
  let patience: ReturnType<typeof setTimeout> | undefined;
  const closeDots = (): void => {
    if (dotTimer !== undefined) clearInterval(dotTimer);
    dotTimer = undefined;
    if (dots > 0) say('\n');
    dots = 0;
  };
  if (options.startPatienceMs !== undefined) {
    dotTimer = setInterval(() => {
      dots += 1;
      say('.');
    }, 5000);
    dotTimer.unref();
    patience = setTimeout(() => {
      if (began || stopped) return;
      stopped = true;
      closeDots();
      if (timer !== undefined) clearTimeout(timer);
      stopStream();
      finish('nothing-began');
    }, options.startPatienceMs);
    patience.unref();
  }
  const view =
    options.raw === true
      ? {}
      : {
          view: 'live' as const,
          details: options.details === true,
          debug: options.debug === true,
        };
  const open = (first: boolean): void => {
    let opened = false;
    stopStream = client.callsStream(
      agentId,
      {
        ...(first
          ? { backlog: options.backlog }
          : lastAt === undefined
            ? { backlog: 0 }
            : { since: lastAt }),
        ...view,
        onOpen: () => {
          opened = true;
          everOpened = true;
          failures = 0;
        },
        onEnd: (error) => {
          if (stopped) return;
          if (!everOpened) {
            lose(
              error ??
                new CernantoError({
                  kind: 'terminal',
                  message: `the stream of ${agentId} ended before it opened`,
                }),
            );
            return;
          }
          if (!opened) failures += 1;
          if (failures >= REOPENINGS) {
            lose(
              new CernantoError({
                kind: 'retryable',
                message: `the stream of ${agentId} could not be reopened: ${wordsOf(error)}; follow it again with: cernanto trace ${agentId} -f`,
              }),
            );
            return;
          }
          say(
            `the stream of ${agentId} ${error === undefined ? 'ended' : `broke (${wordsOf(error)})`}; reopening it\n`,
          );
          timer = setTimeout(
            () => {
              open(false);
            },
            (options.reopenMs ?? REOPEN_MS) * 2 ** failures,
          );
        },
      },
      (record, lines) => {
        const key = recordKeyOf(record);
        if (told.has(key)) return;
        told.add(key);
        order.push(key);
        if (order.length > 5000) {
          const oldest = order.shift();
          if (oldest !== undefined) told.delete(oldest);
        }
        lastAt = record.at;
        onRecord(record, lines);
        if (options.endsWithProgram !== true) return;
        const handler = 'handler' in record ? record.handler : undefined;
        const program = handler === 'run' || handler === 'boot';
        // Only a begin from the follow's own moment on is the watched
        // program's: the backlog carries the last run whole, its begin
        // and its close, and that run is over.
        const live = Date.parse(record.at) >= startedAt - 1000;
        if (record.kind === 'begin' && record.of === 'handler' && program && live) {
          programs.add(record.callId);
          began = true;
          closeDots();
          if (patience !== undefined) clearTimeout(patience);
        }
        if (record.kind === 'handler' && program && (programs.has(record.callId) || live)) {
          // The program ended: the follow is over.
          stopped = true;
          if (timer !== undefined) clearTimeout(timer);
          stopStream();
          finish('program');
        }
      },
    );
  };
  open(true);
  return {
    stop: (): void => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      stopStream();
      closeDots();
      if (patience !== undefined) clearTimeout(patience);
      finish('stopped');
    },
    ended,
  };
}

export function registerTrace(program: Command): void {
  program
    .command('trace')
    .argument(
      '<call-id-or-agent>',
      "the call to explain, or an agent id for the agent's latest call",
    )
    .option(
      '-f, --follow',
      "follow the agent's calls live; ctrl-c stops, and a worker's follow ends when its program ends",
    )
    .option('--backlog <n>', 'with --follow: recent records first', '10')
    .option('--raw', 'the raw records instead of the civilian view')
    .option('-d, --details', 'expand the details: contexts, reasoning, whole values')
    .option('--debug', "include the agent's own debug lines")
    .option('-o, --output <format>', 'text or json')
    .description("an agent's conversation, or one call's; -f follows it live")
    .action(
      async (
        target: string,
        options: {
          follow?: boolean;
          backlog: string;
          raw?: boolean;
          details?: boolean;
          debug?: boolean;
          output?: string;
        },
      ) => {
        const client = new ServerClient();
        if (options.follow !== true) {
          void traceRun(
            client,
            resolveAgentSelector(target),
            { ...outputOf(options), ...options },
            (text) => process.stdout.write(text),
          ).catch(fail);
          return;
        }
        const agentId = resolveAgentSelector(target);
        if (!isAgentId(agentId)) {
          fail(
            new Error(
              `--follow takes an agent id, not a call id; cernanto trace ${target} reads the call`,
            ),
          );
        }
        await deployedToFollow(client, agentId).catch(fail);
        // A worker's follow ends with its program; any other agent's
        // follows until ctrl-c. A worker whose program has already
        // ended has nothing live to follow: its last run reads as the
        // plain trace, with the way to run it again.
        const fleet = await client.ls(agentId).catch((): { agents: LsRow[] } => ({ agents: [] }));
        const standing = fleet.agents.find((row) => row.agentId === agentId);
        const worker = standing?.type === 'worker';
        const finished = worker && standing.status.toLowerCase() === 'finished';
        // The calls followed: the agent's own and their children, so a
        // dependency's ask under one of them is answered here too. A
        // record names its request; an ask names its call by the
        // language's id, so a request's id is turned into its call's
        // first.
        const followed = new Set<string>();
        const rootOf = (id: string): string => {
          const call = callOfRequest(id);
          return call.split('~')[0] ?? call;
        };
        let held: string[] | undefined;
        const write = (text: string): void => {
          if (held !== undefined) held.push(text);
          else process.stdout.write(text);
        };
        const asks = interactive()
          ? watchAsks({
              plane: currentPlane(),
              accepts: (ask) => ask.agent === agentId || followed.has(rootOf(ask.callId)),
              answer: async (ask) => {
                held = [];
                try {
                  await answerOnScreen(currentPlane(), terminalIo(), ask);
                } catch (error) {
                  held.push(
                    `login failed: ${error instanceof Error ? error.message : String(error)}; run: cernanto auth login ${ask.agent} ${ask.name}\n`,
                  );
                }
                const flush = held;
                held = undefined;
                for (const text of flush) process.stdout.write(text);
              },
            })
          : undefined;
        // The plane renders each record as the agent's live stream
        // shows it (the open requests remembered for the stream's life,
        // so a reply quotes its request); `--raw` asks for the records.
        const follow = followAgent(
          client,
          agentId,
          {
            backlog: Number(options.backlog),
            endsWithProgram: worker,
            ...(finished ? { startPatienceMs: FINISHED_PATIENCE_MS } : {}),
            ...(options.raw === undefined ? {} : { raw: options.raw }),
            ...(options.details === undefined ? {} : { details: options.details }),
            ...(options.debug === undefined ? {} : { debug: options.debug }),
          },
          (record, lines) => {
            followed.add(rootOf(record.callId));
            if ('parentCallId' in record && typeof record.parentCallId === 'string') {
              followed.add(rootOf(record.parentCallId));
            }
            if (options.raw === true) {
              write(`${JSON.stringify(record)}\n`);
              return;
            }
            if (lines !== undefined && lines.length > 0) write(`${lines.join('\n')}\n`);
          },
          (line) => process.stderr.write(line),
        );
        // What ended the follow, once its stream is lost.
        const lost: { error?: unknown } = {};
        process.on('SIGINT', () => {
          follow.stop();
          asks?.stop();
          if ('error' in lost) fail(lost.error);
          process.exit(0);
        });
        // A stream that is lost ends the follow in words, as a failure;
        // a program that ended ends it in silence.
        follow.ended.then(
          (how) => {
            asks?.stop();
            if (how === 'nothing-began') {
              process.stdout.write(finishedWorkerWords(agentId), () => process.exit(0));
              return;
            }
            process.exit(0);
          },
          (error: unknown) => {
            lost.error = error;
            void endLostFollow(asks, error, fail);
          },
        );
      },
    );
}

/** How a follow ends when its stream is lost: no answer begins from
 * there, the one that holds the terminal runs to its end, and then the
 * failure is said.
 * @param asks - The follow's watch on the waiting asks, when it keeps one.
 * @param error - What ended the stream.
 * @param say - Says the failure and ends the session.
 * @example
 * follow.ended.catch((error) => void endLostFollow(asks, error, fail));
 */
export async function endLostFollow(
  asks: { stop: () => void; settled: () => Promise<void> } | undefined,
  error: unknown,
  say: (error: unknown) => void,
): Promise<void> {
  asks?.stop();
  await asks?.settled();
  say(error);
}
