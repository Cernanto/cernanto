// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import {
  docSections,
  parameterFields,
  parseContract,
  plainTypeOf,
  wordOf,
} from '@cernanto/package-format/browser';
import type { PlainField, PlainType } from '@cernanto/package-format/browser';

import { spoken } from './agent.js';

// An agent's functions as the send box lays them out, read from its
// contract by the client kit's card reader, the one the cli's card and
// `cernanto call` read by. It reads a form's layout and nothing that
// has to be right.

export type { PlainField, PlainType };

/** One function of an agent, ready for a form. */
export interface FunctionCard {
  name: string;
  /** The name as a chat speaks it. */
  spoken: string;
  /** What it does: the first sentence of its words. */
  summary: string;
  /** All of its words. */
  description: string[];
  /** What it takes, a field a parameter. */
  fields: PlainField[];
  /** Whether what it takes was not read from the contract, the plane
   * serving a function the contract declares none of that name for:
   * no field is then not a function that takes nothing. */
  unread: boolean;
  /** What it answers, in plain words. */
  answers: PlainType;
  returns: string[];
}

/** The first sentence of a text. */
function firstSentence(lines: string[]): string {
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  const end = /[.!?](\s|$)/.exec(text);
  return end === null ? text : text.slice(0, end.index + 1);
}

/**
 * The functions of a contract, each with what it takes and answers.
 *
 * @param contract - The contract's declaration text.
 * @param served - The functions the plane serves for the agent, when it names them.
 */
export function functionCards(contract: string, served?: readonly string[]): FunctionCard[] {
  const parsed = parseContract(
    contract,
    served !== undefined && served.length > 0 ? served : undefined,
  );
  return parsed.handlers.map((handler) => {
    const sections = docSections(handler.doc);
    return {
      name: handler.name,
      spoken: spoken(handler.name),
      summary: firstSentence(sections.description),
      description: sections.description,
      fields: parameterFields(handler, parsed.declared),
      unread: handler.unread === true,
      answers: plainTypeOf(handler.resultType, parsed.declared, [], 0),
      returns: sections.returns,
    };
  });
}

/** What a draft of a call was typed against, or is read against now:
 * the kind of the agent, and its contract by the sha256 hex of its
 * text. */
export interface TypedAgainst {
  kind: string;
  contractSha: string | undefined;
}

/**
 * Why what stands in a send box is sent nowhere before the reader chose
 * the function again, or nothing where it is sent as it is. The agent
 * is read again while the reader works, and what was typed for it as it
 * was would be taken wrong by it as it is: the function is `gone`; or
 * the agent became another kind (`rekinded`), a module deployed again
 * as a task or a task as a module, so the call would go another way
 * than the one it was typed for; or the agent was deployed again under
 * a contract of another text (`redeployed`), so a name typed, in a
 * field or in a JSON text alike, may be read under another or not at
 * all, by a function that answers as if all were well. The contract's
 * text is the one judge of that, here as on the plane: what this page
 * reads of a contract is a form's layout, and two contracts that take a
 * call differently can lay out the same form. A box nothing was typed
 * in holds nothing back but a function that is gone: it follows the
 * agent as it is.
 *
 * @param typedAgainst - The kind and the contract the draft was typed against.
 * @param now - The agent's kind and contract now, and whether it has the function.
 * @param typed - Whether anything stands in the box.
 */
export function heldBecause(
  typedAgainst: TypedAgainst,
  now: TypedAgainst & { found: boolean },
  typed: boolean,
): 'gone' | 'rekinded' | 'redeployed' | undefined {
  if (!now.found) return 'gone';
  if (!typed) return undefined;
  if (typedAgainst.kind !== now.kind) return 'rekinded';
  return typedAgainst.contractSha === now.contractSha ? undefined : 'redeployed';
}

/** A plain type in a few words, as the cli's card says it: `text`,
 * `list of number`, `one of: a, b`; a record says `fields`. */
export function typeWord(type: PlainType): string {
  return type.kind === 'fields' ? 'fields' : wordOf(type);
}

/** What a field holds while it is typed: a text as typed, a yes or no,
 * the items of a list, the fields of a record. */
export type Draft = string | boolean | Draft[] | { [name: string]: Draft } | undefined;

/** How a plain type is typed. */
export type Entry =
  'text' | 'number' | 'switch' | 'choice' | 'list' | 'fields' | 'json' | 'nothing';

/** The kind of field a plain type takes. */
export function entryOf(type: PlainType): Entry {
  switch (type.kind) {
    case 'oneOf':
      return 'choice';
    case 'list':
      return 'list';
    case 'fields':
      return 'fields';
    case 'map':
      return 'json';
    case 'word':
      if (type.word === 'text' || type.word === 'a date') return 'text';
      if (type.word === 'number') return 'number';
      if (type.word === 'yes or no') return 'switch';
      if (type.word === 'nothing') return 'nothing';
      return 'json';
  }
}

/** An empty field of a type. */
export function emptyDraft(type: PlainType): Draft {
  switch (entryOf(type)) {
    case 'switch':
      return false;
    case 'list':
      return [];
    case 'fields':
      return {};
    default:
      return '';
  }
}

/** Whether nothing was typed into a field. */
export function isUnset(draft: Draft): boolean {
  if (draft === undefined || draft === '') return true;
  if (Array.isArray(draft)) return draft.length === 0;
  if (typeof draft === 'object') return Object.values(draft).every(isUnset);
  return false;
}

/** A value read from what was typed, or the words of what is wrong with it. */
export type Read = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * The value a field's draft says, by the field's type.
 *
 * @param name - The field as the form labels it, for the words of what is wrong.
 */
export function readDraft(type: PlainType, draft: Draft, name: string): Read {
  const entry = entryOf(type);
  if (entry === 'nothing') return { ok: true, value: undefined };
  if (entry === 'switch') return { ok: true, value: draft === true };
  if (entry === 'text' || entry === 'choice') {
    return { ok: true, value: typeof draft === 'string' ? draft : '' };
  }
  if (entry === 'number') {
    const text = typeof draft === 'string' ? draft.trim() : '';
    const value = Number(text);
    if (text === '' || Number.isNaN(value)) return { ok: false, error: `${name} takes a number.` };
    return { ok: true, value };
  }
  if (entry === 'json') {
    const text = typeof draft === 'string' ? draft.trim() : '';
    if (text === '') return { ok: false, error: `${name} takes a value, as JSON.` };
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, error: `${name} is not JSON.` };
    }
  }
  if (type.kind === 'list') {
    const items = Array.isArray(draft) ? draft : [];
    const out: unknown[] = [];
    for (const [index, item] of items.entries()) {
      const read = readDraft(type.of, item, `${name}, item ${String(index + 1)}`);
      if (!read.ok) return read;
      out.push(read.value);
    }
    return { ok: true, value: out };
  }
  if (type.kind === 'fields') {
    return readFields(type.fields, typeof draft === 'object' && !Array.isArray(draft) ? draft : {});
  }
  return { ok: true, value: draft };
}

/** The record a group of fields says; an optional field with nothing typed is left out. */
export function readFields(fields: PlainField[], drafts: { [name: string]: Draft }): Read {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const draft = drafts[field.name];
    if (field.optional && isUnset(draft)) continue;
    const read = readDraft(field.type, draft, labelOf(field.name));
    if (!read.ok) return read;
    if (read.value !== undefined) out[field.name] = read.value;
  }
  return { ok: true, value: out };
}

/**
 * The arguments of a call as the wire carries them: none for a function
 * that takes nothing, one parameter as itself, several as one record
 * keyed by their names.
 */
export function readArguments(card: FunctionCard, drafts: { [name: string]: Draft }): Read {
  const [only] = card.fields;
  if (only === undefined) return { ok: true, value: undefined };
  if (card.fields.length === 1) {
    const draft = drafts[only.name];
    if (only.optional && isUnset(draft)) return { ok: true, value: undefined };
    return readDraft(only.type, draft, labelOf(only.name));
  }
  return readFields(card.fields, drafts);
}

/**
 * What a field holds for a value, the other way round: a call loaded
 * into the box. A value the call did not carry leaves its field as one
 * nobody typed in, so the call read back from the form carries what the
 * first one carried and no more: a yes or no that was left out is not
 * sent as a no, over the function's own default.
 */
export function draftOf(type: PlainType, value: unknown): Draft {
  if (value === undefined) return undefined;
  if (value === null) return emptyDraft(type);
  const entry = entryOf(type);
  if (entry === 'switch') return value === true;
  if (entry === 'text' || entry === 'choice') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (entry === 'number') return typeof value === 'number' ? String(value) : JSON.stringify(value);
  if (entry === 'json') return JSON.stringify(value, null, 2);
  if (type.kind === 'list') {
    return Array.isArray(value) ? value.map((item) => draftOf(type.of, item)) : [];
  }
  if (type.kind === 'fields') {
    const record = typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return Object.fromEntries(
      type.fields.map((field) => [field.name, draftOf(field.type, record[field.name])]),
    );
  }
  return '';
}

/** The drafts of a function's fields for the arguments of a call. */
export function draftsOf(card: FunctionCard, args: unknown): { [name: string]: Draft } {
  const [only] = card.fields;
  if (only === undefined) return {};
  if (card.fields.length === 1) return { [only.name]: draftOf(only.type, args) };
  const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
  return Object.fromEntries(
    card.fields.map((field) => [field.name, draftOf(field.type, record[field.name])]),
  );
}

/** Whether two values of a call's arguments are the same value: a
 * record's fields in any order, a list's items in theirs. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, at) => sameValue(item, b[at]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const names = Object.keys(left);
  if (names.length !== Object.keys(right).length) return false;
  return names.every((name) => Object.hasOwn(right, name) && sameValue(left[name], right[name]));
}

/**
 * Whether the form says a call's arguments back as they are: laid into
 * the form and read from it again, they are the same value. A form
 * leaves out a field that holds nothing where the function may go
 * without it, and knows no field the function does not name; a recorded
 * call that carried either is not the form's to send again, and is kept
 * as its own JSON.
 */
export function formHolds(card: FunctionCard, args: unknown): boolean {
  const back = readArguments(card, draftsOf(card, args));
  return back.ok && sameValue(back.value, args);
}

/** A name as a label says it: `greeterId` reads `Greeter id`. */
export function labelOf(name: string): string {
  return spoken(name.replace(/^\.\.\./, ''));
}

/** A call's arguments as a few lines, for the message that stands while the call is sent. */
export function previewLines(args: unknown): string[] {
  if (args === undefined) return [];
  if (typeof args !== 'object' || args === null)
    return [typeof args === 'string' ? args : JSON.stringify(args)];
  if (Array.isArray(args)) return [JSON.stringify(args)];
  return Object.entries(args as Record<string, unknown>).map(
    ([key, value]) =>
      `${labelOf(key)}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
  );
}

/** One argument as a shell takes it whole: in single quotes, an apostrophe inside closed, escaped and opened again. */
function shellWord(text: string): string {
  return /^[A-Za-z0-9_.:/+=-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * A call as the cli's line. The line names no plane by itself, so it is
 * written to reach none: it carries `--context` with a name that is no
 * plane's, and the reader writes the one they mean. A module's call
 * names the agent it ran inside, under `--in`: without it the line
 * would run the function in another place, the module started by
 * itself.
 */
export function cliLine(agentId: string, handler: string, args: unknown, inside?: string): string {
  const head = `cernanto --context <the-plane-you-mean> call ${shellWord(agentId)} ${shellWord(handler)}`;
  const placed = inside === undefined ? head : `${head} --in ${shellWord(inside)}`;
  if (args === undefined) return placed;
  return `${placed} --args ${shellWord(JSON.stringify(args))}`;
}
