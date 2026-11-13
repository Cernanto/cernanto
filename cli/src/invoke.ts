// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { answerOnScreen, watchAsks } from './asks.js';
import { currentPlane } from './gateway-client.js';
import { resolveAgentSelector } from './deploy/landing.js';
import { functionParameters } from './card-view.js';
import type { ParameterReading, PlainType } from './card-view.js';
import type { TraceRecord } from './gateway/types.gen.js';
import { asRefusedCall, fail, interactive, outputOf } from './output.js';
import type { OutputOptions } from './output.js';
import { ServerClient, callOfRequest, recordKeyOf } from './server-client.js';
import { terminalIo } from './terminal.js';
import type { ConnectIo } from './terminal.js';
import type { Plane } from './gateway-client.js';

// `cernanto call <agent> <function> [key=value ...]`: one call of an
// exported function, narrated as it runs on a terminal (what `trace
// -f` shows), then its result. The arguments are `key=value` pairs
// the httpie way (`name=Ada` a string, `count:=3` raw JSON), or one
// whole document under `--args`.

/** One json document, as `--args` or a value gives it. */
function jsonOf(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} is not valid json: ${text}`);
  }
}

/** One record from `key=value` pairs (text) and `key:=<json>` pairs
 * (anything else). */
function recordOf(pairs: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const pair of pairs) {
    const raw = pair.indexOf(':=');
    const plain = pair.indexOf('=');
    if (raw > 0 && (plain === -1 || raw < plain)) {
      args[pair.slice(0, raw)] = jsonOf(pair.slice(raw + 2), pair.slice(0, raw));
      continue;
    }
    if (plain > 0) {
      args[pair.slice(0, plain)] = pair.slice(plain + 1);
      continue;
    }
    throw new Error(
      `"${pair}" is not an argument: write key=value for a string or key:=<json> for a number, a list or an object`,
    );
  }
  return args;
}

/** One value as a parameter's type reads it: text as it is for a
 * text or a choice, a number, yes or no, json for a list, a map or a
 * record, and json when it parses (else the text) for a type the
 * contract leaves open. */
function valueOf(word: string, parameter: ParameterReading): unknown {
  const plain =
    parameter.rest && parameter.plain.kind === 'list' ? parameter.plain.of : parameter.plain;
  if (plain.kind === 'oneOf') return word;
  if (plain.kind === 'list' || plain.kind === 'map' || plain.kind === 'fields') {
    return jsonOf(word, parameter.name);
  }
  if (plain.word === 'number') {
    const value = Number(word);
    if (word.trim() === '' || Number.isNaN(value)) {
      throw new Error(`${parameter.name} is a number: ${word}`);
    }
    return value;
  }
  if (plain.word === 'yes or no') {
    if (word !== 'true' && word !== 'false') {
      throw new Error(`${parameter.name} is yes or no: write true or false`);
    }
    return word === 'true';
  }
  if (plain.word === 'text') return word;
  try {
    return JSON.parse(word) as unknown;
  } catch {
    return word;
  }
}

/** Whether every word is a `key=value` or `key:=json` pair. */
function allPairs(words: string[]): boolean {
  return words.length > 0 && words.every((word) => /^[A-Za-z_$][\w$]*:?=/.test(word));
}

/** The values of several parameters named by pairs or by a json
 * record: each parameter takes the entry of its name (a `key=value`
 * text read by the parameter's type, a `key:=json` value as it is), a
 * name no parameter has is refused, and a required parameter left
 * unnamed is refused. */
/** The arguments named by the parameters they fill, as a call of several
 * parameters rides them: every name the function declares, none it does
 * not, the required ones all given. */
function namedValues(
  record: Record<string, unknown>,
  parameters: ParameterReading[],
  fn: string,
  names: string,
): Record<string, unknown> {
  const known = new Set(parameters.map((p) => p.name));
  const unknown = Object.keys(record).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `${fn} takes ${names}; ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not among them`,
    );
  }
  const missing = parameters.filter((p) => !p.optional && !p.rest && !(p.name in record));
  if (missing.length > 0) {
    throw new Error(`${fn} takes ${names}; ${missing.map((p) => p.name).join(', ')} not given`);
  }
  const named: Record<string, unknown> = {};
  for (const p of parameters) {
    if (p.name in record && record[p.name] !== undefined) named[p.name] = record[p.name];
  }
  return named;
}

/** One record from pairs, each `key=value` text read by the type of
 * the parameter of that name when one is given (`key:=json` stays as
 * written). */
function pairsByType(pairs: string[], parameters: ParameterReading[]): Record<string, unknown> {
  const record = recordOf(pairs);
  for (const parameter of parameters) {
    const given = pairs.some((pair) => pair.startsWith(`${parameter.name}=`));
    const text = record[parameter.name];
    if (given && typeof text === 'string') record[parameter.name] = valueOf(text, parameter);
  }
  return record;
}

/** A pair naming no parameter but a field of exactly one record
 * parameter is that record's field, read by the field's type: the
 * walkthrough's `mentioned:=true` lands in the wait's filter. */
function foldedIntoRecords(
  record: Record<string, unknown>,
  pairs: string[],
  parameters: ParameterReading[],
): Record<string, unknown> {
  const known = new Set(parameters.map((p) => p.name));
  const folded: Record<string, unknown> = { ...record };
  for (const key of Object.keys(record)) {
    if (known.has(key)) continue;
    const owners = parameters.filter(
      (p) => p.plain.kind === 'fields' && p.plain.fields.some((field) => field.name === key),
    );
    const [owner] = owners;
    if (owners.length !== 1 || owner === undefined || owner.plain.kind !== 'fields') continue;
    const field = owner.plain.fields.find((entry) => entry.name === key);
    const given = pairs.find((pair) => pair.startsWith(`${key}=`));
    const value =
      given !== undefined && field !== undefined
        ? valueOf(given.slice(key.length + 1), {
            name: key,
            type: '',
            optional: true,
            rest: false,
            plain: field.type,
          })
        : record[key];
    const inner = folded[owner.name];
    folded[owner.name] = {
      ...(inner !== null && typeof inner === 'object' ? inner : {}),
      [key]: value,
    };
    folded[key] = undefined;
  }
  return Object.fromEntries(Object.entries(folded).filter(([, value]) => value !== undefined));
}

/** One record from pairs for a function that takes one record: each
 * `key=value` text read by the type of the field of that name. */
function fieldsByType(
  pairs: string[],
  fields: readonly { name: string; type: PlainType }[],
): Record<string, unknown> {
  return pairsByType(
    pairs,
    fields.map((field) => ({
      name: field.name,
      type: '',
      optional: true,
      rest: false,
      plain: field.type,
    })),
  );
}

/** The arguments a call carries, read by the function's parameters
 * when the plane could say them: a function that takes one record
 * reads `key=value` pairs (or one json document under `--args`); one
 * that takes one value reads the word as that value; one that takes
 * several reads either pairs naming its parameters (or a json record
 * under `--args`) or the words as its values in order (or a json list
 * under `--args`), the optional ones left out. Without the parameters,
 * the pairs make one record and `--args` is the value. */
export function argsOf(
  pairs: string[],
  document: string | undefined,
  parameters?: ParameterReading[],
  fn = 'the function',
): unknown {
  if (document !== undefined && pairs.length > 0) {
    throw new Error('give the arguments as key=value pairs or as --args, not both');
  }
  if (parameters === undefined) {
    if (document !== undefined) return jsonOf(document, '--args');
    // No pairs are no arguments: an empty record would ride as the one parameter of a
    // function that takes one.
    return pairs.length === 0 ? undefined : recordOf(pairs);
  }
  const names = parameters
    .map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}`)
    .join(', ');
  if (parameters.length === 0) {
    if (pairs.length > 0 || document !== undefined) throw new Error(`${fn} takes no arguments`);
    return undefined;
  }
  const [only] = parameters;
  if (parameters.length === 1 && only !== undefined && !only.rest) {
    if (document !== undefined) return jsonOf(document, '--args');
    if (only.plain.kind === 'fields') return fieldsByType(pairs, only.plain.fields);
    if (only.plain.kind === 'map') return recordOf(pairs);
    if (pairs.length === 0) {
      if (only.optional) return undefined;
      throw new Error(`${fn} takes ${only.name}: give it as a value, or under --args`);
    }
    // One value may still be named, as the card prints it: `text=...`.
    if (allPairs(pairs))
      return namedValues(pairsByType(pairs, parameters), parameters, fn, names)[only.name];
    if (pairs.length > 1) {
      throw new Error(`${fn} takes one argument, ${only.name}; ${String(pairs.length)} were given`);
    }
    return valueOf(pairs[0] ?? '', only);
  }
  const required = parameters.filter((p) => !p.optional && !p.rest).length;
  const rest = parameters.at(-1)?.rest === true;
  if (document !== undefined) {
    const tuple = jsonOf(document, '--args');
    if (tuple !== null && typeof tuple === 'object' && !Array.isArray(tuple)) {
      return namedValues(tuple as Record<string, unknown>, parameters, fn, names);
    }
    if (!Array.isArray(tuple)) {
      throw new Error(
        `${fn} takes ${names}: --args must be a json list of the arguments in order, or a record naming them`,
      );
    }
    if (tuple.length < required || (!rest && tuple.length > parameters.length)) {
      throw new Error(`${fn} takes ${names}; ${String(tuple.length)} were given`);
    }
    return tuple;
  }
  if (allPairs(pairs))
    return namedValues(
      foldedIntoRecords(pairsByType(pairs, parameters), pairs, parameters),
      parameters,
      fn,
      names,
    );
  if (pairs.length < required || (!rest && pairs.length > parameters.length)) {
    throw new Error(
      `${fn} takes ${names}; ${String(pairs.length)} ${pairs.length === 1 ? 'was' : 'were'} given`,
    );
  }
  return pairs.map((word, index) => {
    const parameter = parameters[Math.min(index, parameters.length - 1)];
    return parameter === undefined ? word : valueOf(word, parameter);
  });
}

/** The parameters of the function, read from the agent's recorded
 * contract through the gateway; undefined when the plane cannot say (the
 * agent is not deployed, or carries no contract), so the arguments are
 * read the plain way and the call itself answers. */
export async function parametersOfCall(
  client: Pick<ServerClient, 'describe'>,
  agentId: string,
  fn: string,
): Promise<ParameterReading[] | undefined> {
  try {
    const described = await client.describe(agentId);
    return described.contract === undefined
      ? undefined
      : functionParameters(described.contract, fn);
  } catch {
    return undefined;
  }
}

export async function invokeAgent(
  client: Pick<ServerClient, 'invoke'>,
  input: { agentId: string; handler: string; args: unknown },
  options: OutputOptions,
): Promise<string> {
  const result = await client
    .invoke(input.agentId, input.handler, input.args)
    .catch((error: unknown) => {
      throw asRefusedCall(error, input.agentId, input.handler);
    });
  return resultText(result, options.output === 'json');
}

/** The result line of a call: its answer as json, or nothing at all
 * for a call that answers nothing (a function declared to return
 * void answers `undefined`, which is no text). */
function resultText(result: unknown, pretty: boolean): string {
  if (result === undefined) return '';
  return `${JSON.stringify(result, null, pretty ? 2 : 0)}\n`;
}

/** The answer for a terminal whose call was told without its reply
 * record: a reply line without a time, then the value as json under it,
 * whole; `Done` for a call that answers nothing. The reply record
 * itself, when it comes, reads in the conversation's own words,
 * rendered on the plane. */
export function answerText(result: unknown): string {
  const text =
    result === undefined
      ? 'Done'
      : typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);
  const body = text.split('\n').map((line) => `            ${line}`);
  return `          → reply\n${body.join('\n')}\n`;
}

/**
 * Invokes a function and narrates the run while it goes. The one that
 * makes a call is the one that follows it: the plane makes the call,
 * names it once a copy took it, and tells each of its records as the
 * copy makes them, joined with what the store holds, then the answer.
 * Each record is written once, by its key, in the lines the plane
 * rendered it as (the trace view's live reading); a request that ran
 * again and ended again shows each end.
 */
export async function invokeAgentWatched(
  client: Pick<ServerClient, 'invokeStream'>,
  input: { agentId: string; handler: string; args: unknown },
  options: {
    details?: boolean;
    debug?: boolean;
    write: (text: string) => void;
    /** Answers the asks the run parks on, in this terminal: the log
     * holds while the operator types. Absent, the run's asks stay for
     * `cernanto auth login`. */
    asks?: { plane: Plane; io: ConnectIo };
  },
): Promise<{ result: unknown; callId?: string; replied: boolean }> {
  const shown = new Set<string>();
  // The calls this request runs, each by its call's id before a link's
  // mark: the records name their requests, and a sign-in asked in the
  // middle of a call names the call by the language's id, which the
  // request's id is turned into before the two are matched.
  const followed = new Set<string>();
  const rootOf = (id: string): string => {
    const call = callOfRequest(id);
    return call.split('~')[0] ?? call;
  };
  let request: string | undefined;
  let replied = false;
  // The asks watched: the invoked agent's own, and any raised under a
  // call of this request (a dependency's, a linked module's).
  let held: string[] | undefined;
  const write = (text: string): void => {
    if (held !== undefined) held.push(text);
    else options.write(text);
  };
  const attached = options.asks;
  const asks =
    attached === undefined
      ? undefined
      : watchAsks({
          plane: attached.plane,
          accepts: (ask) => ask.agent === input.agentId || followed.has(rootOf(ask.callId)),
          answer: async (ask) => {
            held = [];
            try {
              await answerOnScreen(attached.plane, attached.io, ask);
            } catch (error) {
              held.push(
                `login failed: ${error instanceof Error ? error.message : String(error)}; run: cernanto auth login ${ask.agent} ${ask.name}\n`,
              );
            }
            const flush = held;
            held = undefined;
            for (const text of flush) options.write(text);
          },
        });
  // A record is written once, by its telling key; the call's own
  // successful end is its reply, after which the answer needs no line
  // of its own.
  const show = (record: TraceRecord, lines: string[] | undefined): void => {
    followed.add(rootOf(record.callId));
    const key = recordKeyOf(record);
    if (shown.has(key)) return;
    shown.add(key);
    if (lines !== undefined && lines.length > 0) write(`${lines.join('\n')}\n`);
    if (record.kind === 'handler' && record.error === undefined && record.callId === request)
      replied = true;
  };
  try {
    const answer = await client
      .invokeStream(input.agentId, input.handler, input.args, {
        view: 'live',
        details: options.details === true,
        debug: options.debug === true,
        onAccepted: (callId) => {
          request = callId;
          followed.add(rootOf(callId));
        },
        onRecord: show,
      })
      .catch((error: unknown) => {
        throw asRefusedCall(error, input.agentId, input.handler);
      });
    return { ...answer, replied };
  } finally {
    asks?.stop();
    await asks?.settled();
  }
}

export function registerInvoke(program: Command): void {
  program
    .command('call')
    .argument('<agent-id>')
    .argument('<function>')
    .argument(
      '[args...]',
      'key=value pairs naming the arguments, each read by its declared type (key:=<json> for a list or a record), or the values in order',
    )
    .option(
      '--args <json>',
      'the arguments as one json document: a record naming them, or a list of them in order',
    )
    .option('-o, --output <format>', 'compact or json')
    .option('-q, --quiet', 'print the result only, without the call as it goes')
    .option('-d, --details', 'expand the details of the call as it goes')
    .option('--debug', "include the agent's own debug lines")
    .description("call one of an agent's functions and watch the call; then its answer")
    .action(
      async (
        agentId: string,
        handler: string,
        pairs: string[],
        options: {
          args?: string;
          output?: string;
          quiet?: boolean;
          details?: boolean;
          debug?: boolean;
        },
      ) => {
        try {
          agentId = resolveAgentSelector(agentId);
          const output = outputOf(options);
          const client = new ServerClient();
          const args = argsOf(
            pairs,
            options.args,
            await parametersOfCall(client, agentId, handler),
            handler,
          );
          // The narrated form is for a person at a terminal; a pipe, -q,
          // or -o json gets the result alone.
          const narrate = options.quiet !== true && output.output !== 'json' && interactive();
          if (!narrate) {
            process.stdout.write(await invokeAgent(client, { agentId, handler, args }, output));
            return;
          }
          const answer = await invokeAgentWatched(
            client,
            { agentId, handler, args },
            {
              ...(options.details === undefined ? {} : { details: options.details }),
              ...(options.debug === undefined ? {} : { debug: options.debug }),
              write: (text) => process.stdout.write(text),
              asks: { plane: currentPlane(), io: terminalIo() },
            },
          );
          // The reply message is the answer, in the conversation's own
          // words; when the stream told no reply record, the answer is
          // printed in the same form. The call was
          // just watched whole, so nothing names it again: `cernanto
          // trace <agent>` reads an agent's latest call.
          if (!answer.replied) process.stdout.write(`\n${answerText(answer.result)}\n`);
        } catch (error) {
          fail(error);
        }
      },
    );
}
