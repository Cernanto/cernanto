// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { resolveAgentSelector } from './deploy/landing.js';
import type { CallSummary, TraceRecord } from './gateway/types.gen.js';
import { dateTime, elapsed, fail, outputOf, render, spokenHandler } from './output.js';
import type { OutputOptions } from './output.js';
import { ServerClient } from './server-client.js';

// `cernanto calls [agent-id]`: the recent calls, newest first, the
// plane's or one agent's, each as an author reads it: the function as
// the card names it, the input in one line, the answer (or the error,
// or `running`) in one line, when, how long, and last the call's id for
// `trace <call-id>` and `cancel <call-id>`.

/** The widest a one-line input or answer reads in the table. */
const ONE_LINE = 60;

/** A value in one line: a string bare, a number or a boolean as it is,
 * an object as `key: value` pairs, anything else as compact JSON; cut
 * to the table's width. */
export function oneLine(value: unknown): string {
  const compact = (one: unknown): string =>
    typeof one === 'string' ? one : one === undefined ? '' : JSON.stringify(one);
  const text =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
          .map(([key, one]) => `${key}: ${compact(one)}`)
          .join(', ')
      : compact(value);
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > ONE_LINE ? `${flat.slice(0, ONE_LINE - 1)}\u2026` : flat;
}

/** What a call's records say of its input and its answer: the input of
 * its handler's begin, the output of its last handler record, and
 * whether a handler record was there at all (a call whose records are
 * beyond the traces' retention has neither). */
export interface CallStory {
  input?: unknown;
  output?: unknown;
  answered: boolean;
  /** The calls this call made, by their begins. */
  callsOut: number;
}

export function storyOf(records: TraceRecord[]): CallStory {
  const story: CallStory = { answered: false, callsOut: 0 };
  for (const record of records) {
    if (record.kind === 'begin' && record.of === 'handler' && 'input' in record) {
      story.input = record.input;
    }
    if (record.kind === 'begin' && record.of === 'call') story.callsOut += 1;
    if (record.kind === 'handler') {
      story.answered = true;
      if ('output' in record) story.output = record.output;
    }
  }
  return story;
}

/** How long a call took, in the table's words: milliseconds under a
 * second, then the elapsed form; a call still running says how long
 * so far. */
function took(row: CallSummary, now: number): string {
  if (row.status === 'running') {
    const began = Date.parse(row.at);
    return Number.isFinite(began) ? `${elapsed(Math.max(0, now - began))} so far` : 'so far';
  }
  return row.durationMs < 1000 ? `${String(row.durationMs)}ms` : elapsed(row.durationMs);
}

function answerOf(row: CallSummary, story: { output?: unknown; answered: boolean }): string {
  if (row.status === 'running') return 'running';
  if (row.status === 'error') return oneLine(`error: ${row.error ?? ''}`);
  if (!story.answered) return '-';
  return story.output === undefined ? 'Done' : oneLine(story.output);
}

export async function getCalls(
  client: Pick<ServerClient, 'calls' | 'call'>,
  filter: { agent?: string; limit?: number },
  options: OutputOptions,
  now: () => number = Date.now,
): Promise<string> {
  const runs = await client.calls(filter);
  // Each call's input and answer come off its own records, read side by
  // side; a call that cannot be read shows neither.
  const stories = await Promise.all(
    runs.map(async (row) => {
      try {
        return storyOf((await client.call(row.callId)).records);
      } catch {
        return { answered: false, callsOut: 0 };
      }
    }),
  );
  const told = runs.map((row, index) => ({
    ...row,
    ...(stories[index]?.input === undefined ? {} : { input: stories[index].input }),
    ...(stories[index]?.output === undefined ? {} : { answer: stories[index].output }),
    ...(stories[index] === undefined
      ? {}
      : {
          callsOut: stories[index].callsOut,
        }),
  }));
  const oneAgent = filter.agent !== undefined;
  return render(
    told,
    {
      headers: [
        'FUNCTION',
        ...(oneAgent ? [] : ['AGENT']),
        'INPUT',
        'ANSWER',
        'AT',
        'TOOK',
        'CALLS OUT',
        'CALL',
      ],
      rows: runs.map((row, index) => [
        spokenHandler(row.handler),
        ...(oneAgent ? [] : [row.agentId]),
        stories[index]?.input === undefined ? '-' : oneLine(stories[index].input),
        answerOf(row, stories[index] ?? { answered: false }),
        dateTime(row.at),
        took(row, now()),
        String(stories[index]?.callsOut ?? 0),
        row.callId,
      ]),
    },
    options,
  );
}

export function registerCalls(program: Command): void {
  program
    .command('calls')
    .argument('[agent-id]', "an agent's calls; none for the plane's")
    .option('--limit <n>', 'row limit', '20')
    .option('-o, --output <format>', 'table or json')
    .option('--no-headers', 'omit the header row')
    .description("the recent calls, newest first: the plane's, or one agent's")
    .action(
      async (
        agentId: string | undefined,
        options: { limit: string; output?: string; headers?: boolean },
      ) => {
        try {
          process.stdout.write(
            await getCalls(
              new ServerClient(),
              {
                limit: Number(options.limit),
                ...(agentId === undefined ? {} : { agent: resolveAgentSelector(agentId) }),
              },
              outputOf(options),
            ),
          );
        } catch (error) {
          fail(error);
        }
      },
    );
}
