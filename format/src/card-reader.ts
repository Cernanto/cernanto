// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The card's reader: an agent's contract (the certified declaration on
// its fleet row) read into its functions, what each takes and answers,
// and every type in plain words (text, number, yes or no, one of, a
// list, fields). The cli renders a card from it and reads a call's
// arguments by it; the web UI lays a form out from it. The parser is
// line-oriented over tsc's declaration emission, the one producer of
// every fleet contract; a type it cannot translate keeps its own text.
// It reads a form's layout and nothing that has to be right: it stops
// at three levels of a type, so what is secret is never its to say.

export interface ContractField {
  /** The collapsed member text, one line, no trailing semicolon. */
  raw: string;
  /** The property name with its optional marker, when it parses. */
  name?: string;
  /** The property's type text, when it parses as `name: type`. */
  type?: string;
  doc: string[];
}

export interface DeclaredInterface {
  kind: 'interface';
  name: string;
  doc: string[];
  /** The types the interface extends, as written. */
  parents: string[];
  fields: ContractField[];
}

export interface DeclaredAlias {
  kind: 'alias';
  name: string;
  doc: string[];
  text: string;
}

export type Declared = DeclaredInterface | DeclaredAlias;

/** One parameter of a handler, as its declaration names and types it. */
export interface ParameterView {
  name: string;
  /** The type text as written; empty when the declaration gives none. */
  type: string;
  optional: boolean;
  rest: boolean;
}

/** A parameter with its type read into plain words, for the `call`
 * command's reading of the arguments it is given. */
export interface ParameterReading extends ParameterView {
  plain: PlainType;
}

export interface HandlerView {
  name: string;
  /** The parameters in order, as declared; none for a handler that takes nothing. */
  parameters: ParameterView[];
  /** Set where the plane serves the function and the contract declares
   * no function of its name (a constant of a function type, say): what
   * it takes is not read, which is not the same as nothing. */
  unread?: true;
  /** The awaited result type text. */
  resultType: string;
  doc: string[];
}

export interface ParsedContract {
  handlers: HandlerView[];
  declared: Map<string, Declared>;
}

/** A field in plain words, ready to render. */
export interface PlainField {
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
export function docSections(lines: string[]): { description: string[]; returns: string[] } {
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
 * in plain words; undefined when the function is none of the agent's:
 * none of the functions `served` names, when the plane names them, else
 * none the contract declares with a promise for its answer. Undefined
 * as well for a function the plane serves whose declaration was not
 * read: its parameters are not known, and no parameters would say it
 * takes nothing. The `call` command reads its arguments by them, and
 * the plain way where there are none to read by. */
export function functionParameters(
  contract: string,
  name: string,
  served?: readonly string[],
): ParameterReading[] | undefined {
  const parsed = parseContract(
    contract,
    served !== undefined && served.length > 0 ? served : undefined,
  );
  const handler = parsed.handlers.find((candidate) => candidate.name === name);
  if (handler === undefined || handler.unread === true) return undefined;
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
export function parseContract(dts: string, served?: readonly string[]): ParsedContract {
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
  // of is listed by its name alone, and marked: what it takes is not
  // read.
  for (const name of served ?? []) {
    if (handlers.some((handler) => handler.name === name)) continue;
    handlers.push({ name, parameters: [], unread: true, resultType: 'unknown', doc: [] });
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
export function plainTypeOf(
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
export function wordOf(type: PlainType): string {
  if (type.kind === 'word') return type.word;
  if (type.kind === 'oneOf') return `one of: ${type.options.join(', ')}`;
  if (type.kind === 'list')
    return type.of.kind === 'fields' ? 'list of:' : `list of ${wordOf(type.of)}`;
  if (type.kind === 'map') return `map of text to ${wordOf(type.of)}`;
  return '';
}

/** The plain type of a parameter; `unknown` for one declared without a type. */
export function plainParameter(
  parameter: ParameterView,
  declared: Map<string, Declared>,
): PlainType {
  const type = parameter.type.replace(/^readonly\s+/, '');
  return plainTypeOf(type === '' ? 'unknown' : type, declared, [], 0);
}

/** The fields of a handler whose one parameter is a record (the
 * input is one thing, a mail, a request, a document); undefined for
 * every other parameter list. */
export function recordParameter(
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
export function parameterFields(
  handler: HandlerView,
  declared: Map<string, Declared>,
): PlainField[] {
  const docs = paramDocs(handler.doc);
  return handler.parameters.map((parameter) => ({
    name: parameter.rest ? `...${parameter.name}` : parameter.name,
    optional: parameter.optional,
    type: plainParameter(parameter, declared),
    doc: docs.get(parameter.name) ?? [],
  }));
}
