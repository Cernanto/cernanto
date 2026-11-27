// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import {
  docSections,
  parameterFields,
  parseContract,
  plainParameter,
  plainTypeOf,
  recordParameter,
  wordOf,
} from '@cernanto/package-format';
import type { Declared, HandlerView, PlainField, PlainType } from '@cernanto/package-format';

import { agentKindName } from './agent-kinds.js';
import { builtByText } from './built-view.js';
import type { BuiltBy } from './built-view.js';
import { agentDisplayName, dateTime, elapsed, spokenHandler } from './output.js';

// The card view: an agent's deployed contract (the certified
// types/index.d.ts on its fleet row) rendered for the person who
// writes .cern.md specs and reads traces, in plain words in place of
// TypeScript signatures. Each handler says what it does, what you send
// (fields in plain words: text, number, yes or no), what comes back,
// and the exact `cernanto call` command to paste. The contract is read
// by the client kit's card reader, the one reader the cli and the web
// UI share; a type it cannot translate is printed as written.

export { functionParameters, parametersOf } from '@cernanto/package-format';
export type { ParameterReading, ParameterView, PlainType } from '@cernanto/package-format';

/** What a card is rendered from: the fleet row's fields beside the
 * contract text. */
export interface CardInput {
  agentId: string;
  /** The certified contract declaration (types/index.d.ts). */
  contract: string;
  /** The fleet row's type; absent means a service. */
  type?: string;
  /** The interfaces this agent's compile was stamped as implementing: the
   * family memberships an operator reads off the card. */
  implements?: string[];
  uses?: string[];
  /** Module agents linked inside this agent's own process. */
  links?: string[];
  /** The functions the plane serves for this agent, off its row. For
   * an agent that is called they are its handlers, whatever way the
   * contract spells them, and the contract gives their words; a module
   * and an interface, and a row that names none, are read from the
   * contract alone. */
  handlers?: string[];
  /** The deployed agents stamped as implementing this interface. */
  implementedBy?: string[];
  /** The deployed agents whose generations compose this module. */
  composedInto?: string[];
  /** Deployed agents whose specs grant this one (its own tester left
   * out). */
  usedBy?: string[];
  verified?: { at: string };
  /** When the running version started, ISO. */
  deployedAt?: string;
  /** The agent's state: `deployed`, a row of the fleet, when absent;
   * `compiled`, a package in the tree the plane does not run;
   * `registry`, a package read off the registry. The head says it in
   * place of `deployed`, and `not verified` for a package without a
   * stamp. */
  state?: 'deployed' | 'compiled' | 'registry';
  /** The package mark of a third party's row: a package landed from
   * its file or the registry, with the version and the publisher its
   * manifest states, and the registry's newer version when one is. */
  installed?: { version?: string; publisher?: string; available?: string };
  /** How long the compile that verified it took, when the card ends that
   * compile: the head then says `verified live in 28s` in place of the
   * stamp. */
  took?: number;
  /** The tests the compile that verified it passed, beside `took`. */
  tests?: number;
  /** What compiled the agent, off its row: the coder, the release
   * and the doctrine, read as one `compiled by` line. */
  built?: BuiltBy;
  /** The agent's accounts in the plane's safe, and the asks it is
   * parked on: one line each, the values withheld. */
  accounts?: string[];
  /** The shell the `call it` line is pasted into: POSIX shells when
   * absent, the Windows command line when the cli runs there. */
  shell?: CommandShell;
}

/** The two ways a pasted command quotes an argument. */
export type CommandShell = 'posix' | 'windows';

/** Fields rendered as aligned `name  type  doc` lines, nesting
 * object fields beneath their parent. */
function fieldBlock(fields: PlainField[], indent: string): string[] {
  const lines: string[] = [];
  const heads = fields.map((field) => {
    const word = wordOf(field.type);
    const optional = field.optional ? '(optional)' : '';
    return [word, optional].filter((part) => part !== '').join(' ');
  });
  const nameWidth = Math.max(0, ...fields.map((field) => field.name.length));
  const typeWidth = Math.max(0, ...heads.map((head) => head.length));
  fields.forEach((field, index) => {
    const head = heads[index] ?? '';
    const doc = field.doc.join(' ');
    const columns = [field.name.padEnd(nameWidth), head.padEnd(typeWidth), doc]
      .join('   ')
      .trimEnd();
    lines.push(`${indent}${columns}`);
    const nested =
      field.type.kind === 'fields'
        ? field.type.fields
        : field.type.kind === 'list' && field.type.of.kind === 'fields'
          ? field.type.of.fields
          : undefined;
    if (nested !== undefined) lines.push(...fieldBlock(nested, `${indent}  `));
  });
  return lines;
}

/** The characters a value may carry into a command for the Windows
 * command line, where no quoting holds in every shell: a value with any
 * other reads as the placeholder. */
const PLAIN_VALUE = /^[A-Za-z0-9 _.:/@+,=-]*$/;
const PLAIN_NAME = /^[A-Za-z0-9_.-]+$/;

/** Whether every required field's name is plain enough to ride a
 * Windows command line as it is. */
function namesArePlain(type: PlainType): boolean {
  if (type.kind !== 'fields') return true;
  return type.fields
    .filter((field) => !field.optional)
    .every((field) => PLAIN_NAME.test(field.name) && namesArePlain(field.type));
}

/**
 * One argument as a shell takes it whole, whatever it holds. A POSIX
 * shell reads it in single quotes, an apostrophe inside closed, escaped
 * and opened again; the Windows command line reads it in double quotes,
 * each quote inside behind a backslash and the backslashes before a
 * quote doubled.
 *
 * @param text - The argument's text.
 * @param shell - The shell the command is pasted into.
 * @returns The quoted argument.
 * @example
 * shellArgument(`{"name":"O'Reilly"}`, 'posix'); // => `'{"name":"O'\\''Reilly"}'`
 */
export function shellArgument(text: string, shell: CommandShell): string {
  if (shell === 'posix') return `'${text.replaceAll("'", `'\\''`)}'`;
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/** A skeleton value for the invoke command's arguments. For the
 * Windows command line a choice outside the plain characters reads as
 * the placeholder. */
function skeletonOf(type: PlainType, shell: CommandShell): unknown {
  if (type.kind === 'oneOf') {
    const first = type.options[0] ?? '...';
    return shell === 'windows' && !PLAIN_VALUE.test(first) ? '...' : first;
  }
  if (type.kind === 'list') return [];
  if (type.kind === 'map') return {};
  if (type.kind === 'fields') {
    const value: Record<string, unknown> = {};
    for (const field of type.fields) {
      if (field.optional) continue;
      value[field.name] = skeletonOf(field.type, shell);
    }
    return value;
  }
  if (type.word === 'number') return 0;
  if (type.word === 'yes or no') return true;
  if (type.word === 'yes') return true;
  if (type.word === 'no') return false;
  if (type.word === 'nothing') return null;
  return '...';
}

/** The characters a pair's value carries into either shell as they
 * are; a value with any other is quoted. */
const BARE_VALUE = /^[A-Za-z0-9_.:/+=-]+$/;

/** One named argument as `invoke` reads a pair: a text, a number or
 * a yes or no after `=`, read by the declared type; a list or a record
 * as json after `:=`. */
function pairOf(name: string, value: unknown, shell: CommandShell): string {
  const json = typeof value === 'object' && value !== null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const word = BARE_VALUE.test(text) ? text : shellArgument(text, shell);
  return `${name}${json ? ':=' : '='}${word}`;
}

/** The arguments of the invoke command. A function that takes one
 * record reads its required fields as pairs, one each; one other
 * argument, and a field whose name a pair cannot carry, rides as one
 * json document under `--args`; several parameters ride as pairs
 * naming the required ones (values in order are read as well). */
function argumentWords(
  handler: HandlerView,
  declared: Map<string, Declared>,
  shell: CommandShell,
): string[] {
  // What the function takes was not read from the contract: the
  // arguments go as they are, under `--args`.
  if (handler.unread === true) return ['--args <the arguments as json>'];
  const parameters = handler.parameters;
  const [only] = parameters;
  if (parameters.length === 0 || only === undefined) return [];
  if (parameters.length === 1 && !only.rest) {
    const args = plainParameter(only, declared);
    if (shell === 'windows' && !namesArePlain(args)) return ['--args <the arguments as json>'];
    if (args.kind === 'fields') {
      const required = args.fields.filter((field) => !field.optional);
      if (required.every((field) => PLAIN_NAME.test(field.name))) {
        return required.map((field) => pairOf(field.name, skeletonOf(field.type, shell), shell));
      }
      return [`--args ${shellArgument(JSON.stringify(skeletonOf(args, shell)), shell)}`];
    }
    if (only.optional) return [];
    // One value, named as the invoke reads a pair.
    if (shell === 'windows' && !PLAIN_NAME.test(only.name))
      return ['--args <the argument as json>'];
    return [pairOf(only.name, skeletonOf(args, shell), shell)];
  }
  // Several: pairs naming the required ones, as the invoke reads them.
  const required = parameters.filter((parameter) => !parameter.optional && !parameter.rest);
  if (shell === 'windows' && !required.every((parameter) => PLAIN_NAME.test(parameter.name))) {
    return ['--args <the arguments as json>'];
  }
  return required.map((parameter) =>
    pairOf(parameter.name, skeletonOf(plainParameter(parameter, declared), shell), shell),
  );
}

/** The installed line's words: the version and the publisher the
 * package states, and the registry's newer version when one is. */
function installedWords(installed: NonNullable<CardInput['installed']>): string {
  const words = [
    installed.version === undefined ? 'from a package' : installed.version,
    ...(installed.publisher === undefined ? [] : [`published by ${installed.publisher}`]),
  ].join(', ');
  return installed.available === undefined
    ? words
    : `${words}; ${installed.available} available in the registry`;
}

export function cardLines(input: CardInput): string[] {
  // The plane says which functions it serves for an agent that is
  // called, and for a module, whose functions an agent that links it
  // answers by that same list; an interface is its contract's own
  // surface.
  const served =
    input.handlers !== undefined && input.handlers.length > 0 && input.type !== 'interface'
      ? input.handlers
      : undefined;
  const parsed = parseContract(input.contract, served);
  const lines: string[] = [];
  const head = [agentDisplayName(input.agentId), input.agentId, agentKindName(input.type)];
  const compiled = input.state === 'compiled' || input.state === 'registry';
  head.push(
    input.state === 'registry'
      ? 'in the registry'
      : input.state === 'compiled'
        ? 'compiled'
        : input.deployedAt === undefined
          ? 'deployed'
          : `deployed ${dateTime(input.deployedAt)}`,
  );
  if (input.verified !== undefined) {
    head.push(
      input.took === undefined
        ? `verified live ${dateTime(input.verified.at)}`
        : `verified live in ${elapsed(input.took)}${
            input.tests === undefined
              ? ''
              : `, ${String(input.tests)} test${input.tests === 1 ? '' : 's'}`
          }`,
    );
  } else if (compiled) {
    head.push('not verified');
  }
  lines.push(head.join('   '));
  const facts: [string, string][] = [];
  if (input.installed !== undefined) facts.push(['installed', installedWords(input.installed)]);
  if (input.implements !== undefined && input.implements.length > 0)
    facts.push(['implements', input.implements.join(', ')]);
  if (input.uses !== undefined && input.uses.length > 0)
    facts.push(['uses', input.uses.join(', ')]);
  if (input.links !== undefined && input.links.length > 0)
    facts.push(['links', input.links.join(', ')]);
  if (input.implementedBy !== undefined)
    facts.push([
      'implemented by',
      input.implementedBy.length === 0 ? 'nothing yet' : input.implementedBy.join(', '),
    ]);
  if (input.composedInto !== undefined)
    facts.push([
      'composed into',
      input.composedInto.length === 0 ? 'nothing yet' : input.composedInto.join(', '),
    ]);
  if (input.usedBy !== undefined && input.usedBy.length > 0)
    facts.push(['used by', input.usedBy.join(', ')]);
  const builtBy = input.built === undefined ? undefined : builtByText(input.built);
  if (builtBy !== undefined) facts.push(['compiled by', builtBy]);
  for (const account of input.accounts ?? []) facts.push(['account', account]);
  const factWidth = Math.max(0, ...facts.map(([label]) => label.length));
  for (const [label, value] of facts) lines.push(`${label.padEnd(factWidth + 2)}${value}`);
  const worker = input.type === 'worker';
  for (const handler of parsed.handlers) {
    // Two blank lines before a function: its own sections stand one apart.
    lines.push('', '');
    lines.push(spokenHandler(handler.name));
    const sections = docSections(handler.doc);
    for (const docLine of sections.description) {
      lines.push(docLine.trim() === '' ? '' : `  ${docLine}`);
    }
    if (worker) continue;
    const record = recordParameter(handler, parsed.declared);
    if (record !== undefined) {
      // One record: its fields are what the call takes.
      lines.push('');
      lines.push('  takes');
      lines.push(...fieldBlock(record.fields, '    '));
    } else if (handler.parameters.length > 0) {
      // Parameters in order, each by its name, its type and its @param words.
      lines.push('');
      lines.push('  takes');
      lines.push(...fieldBlock(parameterFields(handler, parsed.declared), '    '));
    }
    const result = plainTypeOf(handler.resultType, parsed.declared, [], 0);
    lines.push('');
    if (result.kind === 'fields') {
      lines.push('  answers');
      for (const docLine of sections.returns) lines.push(`    ${docLine}`);
      lines.push(...fieldBlock(result.fields, '    '));
    } else {
      lines.push(`  answers  ${wordOf(result)}`);
      for (const docLine of sections.returns) lines.push(`    ${docLine}`);
      if (result.kind === 'list' && result.of.kind === 'fields')
        lines.push(...fieldBlock(result.of.fields, '    '));
    }
    lines.push('');
    // An interface's call goes to the implementor the plane binds, so
    // its card carries the command to paste like any agent's.
    // The line is pasted into a shell: its words are quoted for that
    // shell, so a contract's own text arrives as one argument.
    const shell = input.shell ?? 'posix';
    const word = /^[\w-]+$/.test(handler.name) ? handler.name : shellArgument(handler.name, shell);
    const invoke = [`cernanto call ${input.agentId} ${word}`];
    invoke.push(...argumentWords(handler, parsed.declared, shell));
    lines.push(`  call it: ${invoke.join(' ')}`);
  }
  if (worker && parsed.handlers.length > 0) {
    lines.push('');
    lines.push('  the plane starts its run when deployed; it is not invoked by hand');
    lines.push(`  follow it live:      cernanto trace ${input.agentId} -f`);
    lines.push(`  read its latest run: cernanto trace ${input.agentId}`);
    lines.push(`  run it again:        cernanto deploy ${input.agentId}`);
    lines.push(`  stop and remove it:  cernanto delete ${input.agentId}`);
  }
  if (parsed.handlers.length === 0) {
    lines.push('');
    lines.push('  (no handlers in the recorded contract)');
  }
  return lines;
}

/** The card as the text a command prints. */
export function cardText(input: CardInput): string {
  return `${cardLines(input).join('\n')}\n`;
}
