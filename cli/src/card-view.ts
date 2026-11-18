// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { agentKindName } from './agent-kinds.js';
import { builtByText } from './built-view.js';
import type { BuiltBy } from './built-view.js';
import { agentDisplayName, dateTime, elapsed, spokenHandler } from './output.js';

// The card view: an agent's deployed contract (the certified
// types/index.d.ts on its fleet row) rendered for the person who
// writes .cern.md specs and reads traces, in plain words in place of
// TypeScript signatures. Each handler says what it does, what you send
// (fields in plain words: text, number, yes or no), what comes back,
// and the exact `cernanto call` command to paste. The parser is
// line-oriented over tsc's declaration emission (the one producer of
// every fleet contract); a type it cannot translate is printed as
// written.

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

interface ContractField {
  /** The collapsed member text, one line, no trailing semicolon. */
  raw: string;
  /** The property name with its optional marker, when it parses. */
  name?: string;
  /** The property's type text, when it parses as `name: type`. */
  type?: string;
  doc: string[];
}

interface DeclaredInterface {
  kind: 'interface';
  name: string;
  doc: string[];
  /** The types the interface extends, as written. */
  parents: string[];
  fields: ContractField[];
}

interface DeclaredAlias {
  kind: 'alias';
  name: string;
  doc: string[];
  text: string;
}

type Declared = DeclaredInterface | DeclaredAlias;

/** One parameter of a handler, as its declaration names and types it. */
export interface ParameterView {
  name: string;
  /** The type text as written; empty when the declaration gives none. */
  type: string;
  optional: boolean;
  rest: boolean;
}

/** A parameter with its type read into plain words, for the invoke
 * command's reading of the arguments it is given. */
export interface ParameterReading extends ParameterView {
  plain: PlainType;
}

interface HandlerView {
  name: string;
  /** The parameters in order, as declared; none for a handler that takes nothing. */
  parameters: ParameterView[];
  /** The awaited result type text. */
  resultType: string;
  doc: string[];
}

interface ParsedContract {
  handlers: HandlerView[];
  declared: Map<string, Declared>;
}

/** A field in plain words, ready to render. */
interface PlainField {
  name: string;
  optional: boolean;
  type: PlainType;
  doc: string[];
}

/** A type translated for a person: a word, a choice, a list, a map,
 * or fields. An untranslatable type keeps its own text as the word. */
export type PlainType =
  | { kind: 'word'; word: string }
  | { kind: 'oneOf'; options: string[] }
  | { kind: 'list'; of: PlainType }
  | { kind: 'map'; of: PlainType }
  | { kind: 'fields'; fields: PlainField[] };

/** Quoted strings blanked to spaces of the same length, so depth
 * counting and index-parallel scans skip a literal's own brackets
 * while every index still lines up with the original. */
function stripStrings(line: string): string {
  return line.replace(
    /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
    (match) => `${match[0] ?? ''}${' '.repeat(Math.max(0, match.length - 2))}${match.at(-1) ?? ''}`,
  );
}

/** JSDoc block lines as plain text: markers stripped, blank edges
 * trimmed; tag lines (`@param`, `@example`...) kept as they are for
 * the section split to read. */
function docLines(block: string[]): string[] {
  const inner: string[] = [];
  for (const line of block) {
    let text = line.trim();
    const opening = text.startsWith('/**');
    if (opening) text = text.slice(3);
    if (text.endsWith('*/')) text = text.slice(0, -2);
    text = text.replace(/^\*\s?/, '').trimEnd();
    // The opening line's own text (`/** X */`) keeps no marker
    // indent; continuation lines keep theirs (an example's code).
    if (opening) text = text.trimStart();
    inner.push(text);
  }
  while (inner.length > 0 && inner[0]?.trim() === '') inner.shift();
  while (inner.length > 0 && inner.at(-1)?.trim() === '') inner.pop();
  return inner;
}

/** The doc split for this audience: the description paragraphs, and
 * the `@returns` prose. `@param` lines describe code parameters and
 * `@example` blocks are TypeScript, so both are dropped. */
function docSections(lines: string[]): { description: string[]; returns: string[] } {
  const description: string[] = [];
  const returns: string[] = [];
  let section: 'description' | 'returns' | 'dropped' = 'description';
  for (const line of lines) {
    const tag = /^@(\w+)\s*(?:-\s*)?(.*)$/.exec(line);
    if (tag !== null) {
      if (tag[1] === 'returns' || tag[1] === 'return') {
        section = 'returns';
        if ((tag[2] ?? '') !== '') returns.push(tag[2] ?? '');
      } else {
        section = 'dropped';
      }
      continue;
    }
    if (section === 'description') description.push(line);
    if (section === 'returns' && line.trim() !== '') returns.push(line);
  }
  while (description.length > 0 && description.at(-1)?.trim() === '') description.pop();
  return { description, returns };
}

/** Collects a JSDoc block starting at index; answers the block and
 * the index after it. */
function collectDoc(lines: string[], start: number): { block: string[]; next: number } {
  const block: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    block.push(line);
    if (line.includes('*/')) {
      i++;
      break;
    }
  }
  return { block, next: i };
}

/** Joins consumed lines into one readable member: whitespace
 * normalized, the trailing semicolon gone, `; }` closed as ` }`. */
function collapse(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/;\s*$/, '')
    .replace(/;\s*\}/g, ' }')
    .trim();
}

/** Parses an interface body into members, docs attached. */
function parseMembers(body: string[]): ContractField[] {
  const fields: ContractField[] = [];
  const scan = blankedLines(body);
  let doc: string[] = [];
  let i = 0;
  while (i < body.length) {
    const trimmed = (body[i] ?? '').trim();
    if (trimmed === '') {
      i++;
      continue;
    }
    if (trimmed.startsWith('/**')) {
      const collected = collectDoc(body, i);
      doc = docLines(collected.block);
      i = collected.next;
      continue;
    }
    if (trimmed.startsWith('//')) {
      i++;
      continue;
    }
    const consumed: string[] = [];
    let depth = 0;
    while (i < body.length) {
      const counted = scan[i] ?? '';
      consumed.push(body[i] ?? '');
      depth += depthOf(counted);
      i++;
      if (depth <= 0 && counted.trimEnd().endsWith(';')) break;
    }
    const raw = collapse(consumed);
    if (raw === '') continue;
    const colonAt = raw.indexOf(':');
    const parenAt = raw.indexOf('(');
    const method = /^([\w$]+)(\?)?\s*[(<]/.exec(raw);
    const property = /^(?:readonly\s+)?([\w$]+|'[^']*'|"[^"]*")(\?)?\s*:\s*(.*)$/.exec(raw);
    if (method !== null && parenAt !== -1 && (colonAt === -1 || parenAt < colonAt)) {
      fields.push({ raw, name: method[1] ?? raw, doc });
    } else if (property !== null) {
      fields.push({
        raw,
        name: `${property[1] ?? ''}${property[2] ?? ''}`,
        type: property[3] ?? '',
        doc,
      });
    } else {
      fields.push({ raw, doc });
    }
    doc = [];
  }
  return fields;
}

/** A declaration text with its comments and its quoted strings
 * blanked to spaces, character for character and line for line: their
 * brackets are words, and a scan of the text's own brackets must not
 * count them. */
function opaqueBlanked(text: string): string {
  let out = '';
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? '';
    let end: number;
    if (text.startsWith('/*', at)) {
      const close = text.indexOf('*/', at + 2);
      end = close === -1 ? text.length : close + 2;
    } else if (text.startsWith('//', at)) {
      const close = text.indexOf('\n', at);
      end = close === -1 ? text.length : close;
    } else if (char === "'" || char === '"' || char === '`') {
      end = at + 1;
      while (end < text.length && text[end] !== char) end += text[end] === '\\' ? 2 : 1;
      end = Math.min(end + 1, text.length);
    } else {
      out += char;
      at += 1;
      continue;
    }
    out += text.slice(at, end).replace(/[^\n]/g, ' ');
    at = end;
  }
  return out;
}

/** The lines of a declaration text as a count of brackets reads them:
 * the same lines, their comments and quoted strings blanked. */
function blankedLines(lines: readonly string[]): string[] {
  return opaqueBlanked(lines.join('\n')).split('\n');
}

/** Net brace and paren depth change of a blanked line. */
function depthOf(blanked: string): number {
  let delta = 0;
  for (const char of blanked) {
    if (char === '{' || char === '(') delta += 1;
    if (char === '}' || char === ')') delta -= 1;
  }
  return delta;
}

/** The same with its arrows blanked too, so a scan of its brackets
 * counts the brackets alone: the `>` of an arrow closes nothing. */
function scannable(text: string): string {
  return opaqueBlanked(text).replaceAll('=>', '  ');
}

/** A text split at the separator wherever no bracket is open. */
function splitOutside(text: string, separator: string): string[] {
  const blanked = scannable(text);
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < blanked.length; i++) {
    const char = blanked[i];
    if (char === '(' || char === '{' || char === '<' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === '>' || char === ']') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** Whether a return type holds its unions inside a form that binds
 * looser than a union: a function type (an arrow outside every
 * bracket binds everything after it), a conditional type (a question
 * mark outside every bracket) or a type predicate (`x is T`,
 * `asserts x`). A bar inside one of these parts no union of the
 * function's own answer. */
function bindsLooserThanUnion(type: string): boolean {
  const kept = opaqueBlanked(type);
  if (/^\s*(?:asserts\s+(?:this\b|[\w$]+)|(?:this|[\w$]+)\s+is\s)/.test(kept)) return true;
  let depth = 0;
  for (let i = 0; i < kept.length; i++) {
    if (kept.startsWith('=>', i)) {
      if (depth === 0) return true;
      i += 1;
      continue;
    }
    const char = kept[i];
    if (char === '?' && depth === 0) return true;
    if (char === '(' || char === '{' || char === '<' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === '>' || char === ']') depth -= 1;
  }
  return false;
}

/** What a promise type promises: the type is `Promise<T>` or
 * `PromiseLike<T>`, whole (`unknown` for one that names no argument);
 * undefined for any other type. */
function promised(type: string): string | undefined {
  const blanked = scannable(type);
  if (/^\s*Promise(?:Like)?\s*$/.test(blanked)) return 'unknown';
  const head = /^\s*Promise(?:Like)?\s*</.exec(blanked);
  if (head === null) return undefined;
  const open = head[0].length - 1;
  const close = closingAt(blanked, open);
  return close !== -1 && blanked.slice(close + 1).trim() === ''
    ? type.slice(open + 1, close).trim()
    : undefined;
}

/** A signature's return type as written: what follows the colon after
 * its parameter list. The empty text when it declares none; undefined
 * when the scan cannot tell where its parameters end. */
function returnTypeOf(signature: string): string | undefined {
  const blanked = scannable(signature);
  const open = parametersOpenAt(blanked);
  const close = open === -1 ? -1 : closingAt(blanked, open);
  if (close === -1) return undefined;
  const colon = /^\s*:/.exec(blanked.slice(close + 1));
  return colon === null ? '' : signature.slice(close + 1 + colon[0].length).trim();
}

/** The sides of a return type: one for each side of a union at its
 * outer level, the type alone when it is no union or holds its unions
 * inside a looser form; none for no type. */
function sidesOf(type: string): string[] {
  if (type === '') return [];
  return bindsLooserThanUnion(type) ? [type] : splitOutside(type, '|');
}

/** Whether a signature answers a promise, as the runtime reads it: its
 * own return type is a `Promise` or a `PromiseLike`, or a union with
 * one. Such a function is a handler over the wire; any other is a
 * helper, whatever its parameters hold. Only a signature whose
 * parameters the scan cannot delimit is read by its words. */
function answersPromise(signature: string): boolean {
  const type = returnTypeOf(signature);
  if (type === undefined) return /\)\s*:\s*Promise(?:Like)?\s*</.test(signature);
  return sidesOf(type).some((side) => promised(side) !== undefined);
}

/** The awaited result type of a signature: what its promise promises
 * (each promise of a union opened, the same type named once), or the
 * return type as written. */
function awaitedResult(signature: string): string {
  const sides = sidesOf(returnTypeOf(signature) ?? '');
  if (sides.length === 0) return 'unknown';
  return [...new Set(sides.map((side) => promised(side) ?? side))].join(' | ');
}

/** Where a signature's parameter list opens: the first paren outside
 * the function's own type parameters; -1 when it has none. */
function parametersOpenAt(blanked: string): number {
  let depth = 0;
  for (let i = 0; i < blanked.length; i++) {
    const char = blanked[i];
    if (char === '(' && depth === 0) return i;
    if (char === '<') depth += 1;
    if (char === '>') depth -= 1;
  }
  return -1;
}

/** The parameters a signature declares, in order: each name, its type
 * text as written, whether it is optional and whether it is a rest
 * parameter. The list is split on the commas outside brackets; a
 * colon or a comma inside a comment names nothing. */
export function parametersOf(signature: string): ParameterView[] {
  const blanked = scannable(signature);
  const open = parametersOpenAt(blanked);
  const close = open === -1 ? -1 : closingAt(blanked, open);
  if (close === -1) return [];
  const spans: [number, number][] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const char = blanked[i];
    if (char === '(' || char === '{' || char === '<' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === '>' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, close]);
  const parameters: ParameterView[] = [];
  for (const [from, to] of spans) {
    const part = blanked.slice(from, to);
    if (part.trim() === '') continue;
    const colon = part.indexOf(':');
    const head = (colon === -1 ? part : part.slice(0, colon)).trim();
    const rest = head.startsWith('...');
    const bare = rest ? head.slice(3) : head;
    const optional = bare.endsWith('?');
    const name = (optional ? bare.slice(0, -1) : bare).trim();
    const type = colon === -1 ? '' : signature.slice(from + colon + 1, to).trim();
    parameters.push({ name, type, optional, rest });
  }
  return parameters;
}

/** The parameters of one function of a contract, each with its type
 * in plain words; undefined when the contract declares no such
 * function. The invoke command reads its arguments by them. */
export function functionParameters(contract: string, name: string): ParameterReading[] | undefined {
  const parsed = parseContract(contract);
  const handler = parsed.handlers.find((candidate) => candidate.name === name);
  if (handler === undefined) return undefined;
  return handler.parameters.map((parameter) => ({
    ...parameter,
    plain: plainParameter(parameter, parsed.declared),
  }));
}

/** The index of the bracket that closes the one opened at `open`, in
 * a text blanked for the scan; -1 when none does. */
function closingAt(blanked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    const char = blanked[i];
    if (char === '(' || char === '{' || char === '<' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === '>' || char === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** A declared constant whose type is a function (`name: (args: In) =>
 * Promise<Out>`, the declaration of an exported arrow function), read
 * as the function declaration of the same name (`name(args: In):
 * Promise<Out>`); undefined for a constant of any other type. */
function constantFunction(declarator: string): { name: string; text: string } | undefined {
  const named = /^([\w$]+)\s*:\s*/.exec(declarator);
  if (named === null) return undefined;
  const type = declarator.slice(named[0].length);
  const blanked = scannable(type);
  // The function's own type parameters come before its parameters.
  const generics = blanked.startsWith('<') ? closingAt(blanked, 0) + 1 : 0;
  const open = generics + (/^\s*/.exec(blanked.slice(generics))?.[0].length ?? 0);
  if (blanked[open] !== '(') return undefined;
  const close = closingAt(blanked, open);
  if (close === -1) return undefined;
  const arrow = /^\s*=>\s*/.exec(type.slice(close + 1));
  if (arrow === null) return undefined;
  const result = type.slice(close + 1 + arrow[0].length);
  return { name: named[1] ?? '', text: `${named[1] ?? ''}${type.slice(0, close + 1)}: ${result}` };
}

/** Parses a contract declaration file: every exported function,
 * declared as one or as a constant of a function type, and every
 * exported interface and type alias. The handlers are the functions
 * `served` names, when the plane names them; else the functions that
 * answer a promise. */
function parseContract(dts: string, served?: readonly string[]): ParsedContract {
  const lines = dts.split('\n');
  const scan = blankedLines(lines);
  const declared = new Map<string, Declared>();
  const functionDocs = new Map<string, string[]>();
  // Exports are the API: every exported function the contract
  // declares, with whether it answers a promise (of two declarations
  // of one name, the one that does stands).
  const declaredFunctions = new Map<string, { text: string; promise: boolean }>();
  let pendingDoc: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed.startsWith('/**')) {
      const collected = collectDoc(lines, i);
      pendingDoc = docLines(collected.block);
      i = collected.next;
      continue;
    }
    const interfaceMatch = /^export (?:declare )?interface ([\w$]+)/.exec(trimmed);
    const aliasMatch = /^export (?:declare )?type ([\w$]+)\s*=/.exec(trimmed);
    const functionMatch = /^export declare function ([\w$]+)/.exec(trimmed);
    const constantMatch = /^export declare (?:const|let|var) [\w$]+\s*:/.exec(trimmed);
    if (interfaceMatch !== null) {
      const consumed: string[] = [];
      let depth = 0;
      let opened = false;
      while (i < lines.length) {
        const counted = scan[i] ?? '';
        consumed.push(lines[i] ?? '');
        if (counted.includes('{')) opened = true;
        depth += depthOf(counted);
        i++;
        if (opened && depth <= 0) break;
      }
      const first = consumed[0] ?? '';
      const body =
        consumed.length > 1 && first.trimEnd().endsWith('{')
          ? consumed.slice(1, -1)
          : [
              collapse(consumed)
                .replace(/^[^{]*\{/, '')
                .replace(/\}[^}]*$/, ''),
            ];
      const name = interfaceMatch[1] ?? '';
      // The header up to the body's brace names what the interface extends.
      const header = collapse(consumed);
      const opens = stripStrings(header).indexOf('{');
      const heritage = /\bextends\s+([\s\S]+)$/.exec(
        (opens === -1 ? header : header.slice(0, opens)).trim(),
      );
      declared.set(name, {
        kind: 'interface',
        name,
        doc: pendingDoc,
        parents: heritage === null ? [] : splitTop(heritage[1] ?? '', ','),
        fields: parseMembers(body),
      });
      pendingDoc = [];
      continue;
    }
    if (aliasMatch !== null || functionMatch !== null || constantMatch !== null) {
      const consumed: string[] = [];
      let depth = 0;
      while (i < lines.length) {
        const counted = scan[i] ?? '';
        consumed.push(lines[i] ?? '');
        depth += depthOf(counted);
        i++;
        if (depth <= 0 && counted.trimEnd().endsWith(';')) break;
      }
      if (aliasMatch !== null) {
        const name = aliasMatch[1] ?? '';
        const text = collapse(consumed).replace(/^export (?:declare )?type [\w$]+\s*=\s*/, '');
        declared.set(name, { kind: 'alias', name, doc: pendingDoc, text });
      } else {
        // A function is declared as one, or as a constant whose type
        // is a function; a constant of any other type is no function.
        const functions =
          functionMatch !== null
            ? [
                {
                  name: functionMatch[1] ?? '',
                  text: collapse(consumed)
                    .replace(/^export declare function /, '')
                    .replace(/;\s*$/, ''),
                },
              ]
            : splitOutside(
                collapse(consumed).replace(/^export declare (?:const|let|var) /, ''),
                ',',
              ).flatMap((declarator) => constantFunction(declarator) ?? []);
        for (const { name, text } of functions) {
          functionDocs.set(name, pendingDoc);
          const promise = answersPromise(text);
          if (promise || !declaredFunctions.has(name)) {
            declaredFunctions.set(name, { text, promise });
          }
        }
      }
      pendingDoc = [];
      continue;
    }
    if (trimmed !== '') pendingDoc = [];
    i++;
  }
  // What the plane serves is a handler, and nothing else is. Where the
  // plane names none, a handler answers a promise: a synchronous
  // declared function is a helper consumers call directly.
  const serves = (name: string, promise: boolean): boolean =>
    served === undefined ? promise : served.includes(name);
  const handlers: HandlerView[] = [];
  for (const [name, { text, promise }] of declaredFunctions) {
    if (!serves(name, promise)) continue;
    handlers.push({
      name,
      parameters: parametersOf(text),
      resultType: awaitedResult(text),
      doc: functionDocs.get(name) ?? [],
    });
  }
  // A function the plane serves and this reader finds no declaration
  // of is listed by its name alone.
  for (const name of served ?? []) {
    if (handlers.some((handler) => handler.name === name)) continue;
    handlers.push({ name, parameters: [], resultType: 'unknown', doc: [] });
  }
  return { handlers, declared };
}

/** Splits a type text at top-level occurrences of the separator. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  const blanked = stripStrings(text);
  for (let i = 0; i < text.length; i++) {
    const probe = blanked[i];
    if (probe === '{' || probe === '(' || probe === '<' || probe === '[') depth += 1;
    if (probe === '}' || probe === ')' || probe === '>' || probe === ']') depth -= 1;
    if (depth === 0 && probe === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += text[i] ?? '';
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

const MAX_FIELD_DEPTH = 3;

/** The declared interface a type text names, an alias of one followed;
 * undefined for any other type. */
function interfaceNamed(
  text: string,
  declared: Map<string, Declared>,
  seen: string[] = [],
): DeclaredInterface | undefined {
  const named = declared.get(text.trim());
  if (named === undefined || seen.includes(named.name)) return undefined;
  if (named.kind === 'interface') return named;
  return interfaceNamed(named.text, declared, [...seen, named.name]);
}

/** The members an interface answers with: the ones it inherits first,
 * its own after, an own member standing in the place of an inherited
 * one of its name. Undefined when it extends a type the contract does
 * not declare as an interface: its surface cannot be told whole. */
function membersOf(
  named: DeclaredInterface,
  declared: Map<string, Declared>,
  visiting: string[] = [],
): ContractField[] | undefined {
  const members = new Map<string, ContractField>();
  const keep = (field: ContractField): void => {
    members.set((field.name ?? field.raw).replace(/\?$/, ''), field);
  };
  for (const parentText of named.parents) {
    const parent = interfaceNamed(parentText, declared);
    if (parent === undefined || visiting.includes(parent.name)) return undefined;
    const inherited = membersOf(parent, declared, [...visiting, named.name]);
    if (inherited === undefined) return undefined;
    inherited.forEach(keep);
  }
  named.fields.forEach(keep);
  return [...members.values()];
}

/** Whether the text's bracket depth never dips below zero: true for
 * the inside of one balanced paren group, false for `a) | (b`. */
function depthNeverCloses(text: string): boolean {
  let depth = 0;
  for (const char of stripStrings(text)) {
    if (char === '{' || char === '(' || char === '<' || char === '[') depth += 1;
    if (char === '}' || char === ')' || char === '>' || char === ']') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Translates a type text into plain words, expanding declared
 * interfaces and aliases in place. What it cannot translate keeps
 * its own text. */
function plainTypeOf(
  text: string,
  declared: Map<string, Declared>,
  seen: string[],
  depth: number,
): PlainType {
  let trimmed = text.trim();
  while (
    trimmed.startsWith('(') &&
    trimmed.endsWith(')') &&
    depthNeverCloses(trimmed.slice(1, -1))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  const named = declared.get(trimmed);
  if (named !== undefined) {
    if (seen.includes(trimmed) || depth >= MAX_FIELD_DEPTH) return { kind: 'word', word: trimmed };
    if (named.kind === 'alias') return plainTypeOf(named.text, declared, [...seen, trimmed], depth);
    // An interface whose parents cannot all be read keeps its own name:
    // a partial field list would hide what a call must send.
    const members = membersOf(named, declared);
    if (members === undefined) return { kind: 'word', word: trimmed };
    return {
      kind: 'fields',
      fields: members.map((field) => plainFieldOf(field, declared, [...seen, trimmed], depth)),
    };
  }
  const union = splitTop(trimmed, '|');
  if (union.length > 1) {
    const value = union.filter((part) => part !== 'undefined' && part !== 'null');
    if (value.length === 1) return plainTypeOf(value[0] ?? '', declared, seen, depth);
    if (value.every((part) => /^'[^']*'$/.test(part) || /^"[^"]*"$/.test(part))) {
      return { kind: 'oneOf', options: value.map((part) => part.slice(1, -1)) };
    }
    return {
      kind: 'word',
      word: value.map((part) => wordOf(plainTypeOf(part, declared, seen, depth))).join(' or '),
    };
  }
  if (trimmed.endsWith('[]')) {
    return { kind: 'list', of: plainTypeOf(trimmed.slice(0, -2), declared, seen, depth) };
  }
  const arrayOf = /^(?:Readonly)?Array\s*<([\s\S]*)>$/.exec(trimmed);
  if (arrayOf !== null) {
    return { kind: 'list', of: plainTypeOf(arrayOf[1] ?? '', declared, seen, depth) };
  }
  const recordOf = /^Record\s*<([\s\S]*)>$/.exec(trimmed);
  if (recordOf !== null) {
    const args = splitTop(recordOf[1] ?? '', ',');
    return { kind: 'map', of: plainTypeOf(args[1] ?? 'unknown', declared, seen, depth) };
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    if (depth >= MAX_FIELD_DEPTH) return { kind: 'word', word: trimmed };
    const body = trimmed.slice(1, -1).trim();
    const index = /^\[\s*\w+\s*:\s*string\s*\]\s*:\s*([\s\S]*)$/.exec(body);
    if (index !== null)
      return { kind: 'map', of: plainTypeOf(index[1] ?? '', declared, seen, depth) };
    const fields: PlainField[] = [];
    for (const member of splitTop(body, ';')) {
      const property = /^(?:readonly\s+)?([\w$]+|'[^']*'|"[^"]*")(\?)?\s*:\s*([\s\S]*)$/.exec(
        member,
      );
      if (property === null) return { kind: 'word', word: trimmed };
      fields.push({
        name: (property[1] ?? '').replace(/^['"]|['"]$/g, ''),
        optional: property[2] === '?',
        type: plainTypeOf(property[3] ?? '', declared, seen, depth + 1),
        doc: [],
      });
    }
    return { kind: 'fields', fields };
  }
  const literal = /^'([^']*)'$/.exec(trimmed) ?? /^"([^"]*)"$/.exec(trimmed);
  if (literal !== null) return { kind: 'oneOf', options: [literal[1] ?? ''] };
  const words: Record<string, string> = {
    string: 'text',
    number: 'number',
    boolean: 'yes or no',
    true: 'yes',
    false: 'no',
    void: 'nothing',
    undefined: 'nothing',
    null: 'nothing',
    never: 'nothing',
    unknown: 'anything',
    any: 'anything',
    object: 'an object',
    Date: 'a date',
  };
  return { kind: 'word', word: words[trimmed] ?? trimmed };
}

/** One interface member as a plain field. */
function plainFieldOf(
  field: ContractField,
  declared: Map<string, Declared>,
  seen: string[],
  depth: number,
): PlainField {
  const name = field.name ?? field.raw;
  return {
    name: name.replace(/\?$/, ''),
    optional: name.endsWith('?'),
    type: plainTypeOf(field.type ?? 'unknown', declared, seen, depth + 1),
    doc: docSections(field.doc).description.filter((line) => line.trim() !== ''),
  };
}

/** The inline word for a plain type; fields have none (they render
 * as their own block). */
function wordOf(type: PlainType): string {
  if (type.kind === 'word') return type.word;
  if (type.kind === 'oneOf') return `one of: ${type.options.join(', ')}`;
  if (type.kind === 'list')
    return type.of.kind === 'fields' ? 'list of:' : `list of ${wordOf(type.of)}`;
  if (type.kind === 'map') return `map of text to ${wordOf(type.of)}`;
  return '';
}

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

/** The plain type of a parameter; `unknown` for one declared without a type. */
function plainParameter(parameter: ParameterView, declared: Map<string, Declared>): PlainType {
  const type = parameter.type.replace(/^readonly\s+/, '');
  return plainTypeOf(type === '' ? 'unknown' : type, declared, [], 0);
}

/** The fields of a handler whose one parameter is a record (the
 * input is one thing, a mail, a request, a document); undefined for
 * every other parameter list. */
function recordParameter(
  handler: HandlerView,
  declared: Map<string, Declared>,
): { kind: 'fields'; fields: PlainField[] } | undefined {
  const [only] = handler.parameters;
  if (handler.parameters.length !== 1 || only === undefined || only.rest) return undefined;
  const plain = plainParameter(only, declared);
  return plain.kind === 'fields' ? plain : undefined;
}

/** The `@param name - words` lines of a doc block, by parameter name,
 * each with its continuation lines. */
function paramDocs(lines: string[]): Map<string, string[]> {
  const docs = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines) {
    const tag = /^@(\w+)\s*(.*)$/.exec(line);
    if (tag !== null) {
      current = undefined;
      if (tag[1] === 'param') {
        const named = /^(\w+)\s*(?:-\s*)?(.*)$/.exec(tag[2] ?? '');
        if (named !== null) {
          current = [];
          if ((named[2] ?? '') !== '') current.push(named[2] ?? '');
          docs.set(named[1] ?? '', current);
        }
      }
      continue;
    }
    if (current !== undefined && line.trim() !== '') current.push(line.trim());
  }
  return docs;
}

/** A handler's parameters as fields to render: each by its name, its
 * plain type and the words its `@param` line gives it. */
function parameterFields(handler: HandlerView, declared: Map<string, Declared>): PlainField[] {
  const docs = paramDocs(handler.doc);
  return handler.parameters.map((parameter) => ({
    name: parameter.rest ? `...${parameter.name}` : parameter.name,
    optional: parameter.optional,
    type: plainParameter(parameter, declared),
    doc: docs.get(parameter.name) ?? [],
  }));
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
  // called; a module and an interface are their contract's own surface.
  const served =
    input.handlers !== undefined &&
    input.handlers.length > 0 &&
    input.type !== 'module' &&
    input.type !== 'interface'
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
