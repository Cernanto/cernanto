// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { system } from '@cernanto/system';

import { cardLines, cardText, functionParameters, shellArgument } from './card-view.js';
import { argsOf } from './invoke.js';
// The tables render this machine's time; the proof reads them in utc.
process.env['TZ'] = 'UTC';

// The card view renders a fleet row's certified contract for
// the person who writes .cern.md specs: plain words in place of
// TypeScript. The fixtures are tsc declaration emission verbatim
// (the one producer of every fleet contract) and the goldens pin
// the text to the byte.

const CONTRACT = `/** What a check needs. */
export interface CheckInput {
    /** The fully qualified .com domain name to check. */
    domain: string;
    /** How long to wait, in milliseconds. */
    timeoutMs?: number;
}
export interface CheckResult {
    /** Whether the domain can be registered. */
    available: boolean;
    price?: {
        amount: number;
        currency: string;
    };
}
export type Verdict = 'available' | 'taken' | 'unknown';
/**
 * Checks whether a .com domain is available to register.
 *
 * @param args - The domain to check.
 * @returns The availability verdict with price when known.
 * @example
 * const result = await check({ domain: 'example.com' });
 */
export declare function check(args: CheckInput): Promise<CheckResult>;
/**
 * Classifies the domain into a verdict word.
 */
export declare function classify(args: CheckInput): Promise<Verdict>;
`;

test('the card says what compiled the agent, in one line of plain words', () => {
  const lines = cardLines({
    agentId: 'domains/godaddy-check',
    contract: CONTRACT,
    built: {
      harness: {
        name: 'cernanto/harness/claude-code',
        cli: '2.1.250',
        model: 'claude-opus-5',
        effort: 'medium',
      },
      cernanto: '0.4.0',
      doctrine: '31.0.0',
    },
  });
  assert.ok(
    lines.includes(
      'compiled by  cernanto/harness/claude-code 2.1.250, model claude-opus-5 at medium effort, cernanto 0.4.0, doctrine 31.0.0',
    ),
    lines.join('\n'),
  );
  // A row without a compile stamp shows no line at all.
  const unstamped = cardLines({ agentId: 'domains/godaddy-check', contract: CONTRACT });
  assert.ok(!unstamped.some((line) => line.startsWith('compiled by')));
});

test('the card speaks plain words: takes, answers, and the invoke to paste', () => {
  assert.equal(
    cardText({
      agentId: 'domains/godaddy-check',
      contract: CONTRACT,
      uses: ['openapi:https://api.example.com/domains.json', 'cernanto/auth'],
      verified: { at: '2026-08-20T10:00:00Z' },
    }),
    [
      'Godaddy Check   domains/godaddy-check   stateful   deployed   verified live 2026-08-20 10:00:00',
      'uses  openapi:https://api.example.com/domains.json, cernanto/auth',
      '',
      '',
      'Check',
      '  Checks whether a .com domain is available to register.',
      '',
      '  takes',
      '    domain      text                The fully qualified .com domain name to check.',
      '    timeoutMs   number (optional)   How long to wait, in milliseconds.',
      '',
      '  answers',
      '    The availability verdict with price when known.',
      '    available   yes or no    Whether the domain can be registered.',
      '    price       (optional)',
      '      amount     number',
      '      currency   text',
      '',
      '  call it: cernanto call domains/godaddy-check check domain=...',
      '',
      '',
      'Classify',
      '  Classifies the domain into a verdict word.',
      '',
      '  takes',
      '    domain      text                The fully qualified .com domain name to check.',
      '    timeoutMs   number (optional)   How long to wait, in milliseconds.',
      '',
      '  answers  one of: available, taken, unknown',
      '',
      '  call it: cernanto call domains/godaddy-check classify domain=...',
      '',
    ].join('\n'),
  );
});

test('the card reads a handler with nothing to send, and lists of things', () => {
  const contract = [
    'export interface Snapshot {',
    '    /** The ticker symbol. */',
    '    symbol: string;',
    '    prices: number[];',
    '}',
    '/** Answers the next number in the queue. */',
    'export declare function next(): Promise<number>;',
    '/** Answers every snapshot taken today. */',
    'export declare function today(): Promise<Snapshot[]>;',
    '',
  ].join('\n');
  assert.equal(
    cardText({ agentId: 'ops/ticket-counter', contract }),
    [
      'Ticket Counter   ops/ticket-counter   stateful   deployed',
      '',
      '',
      'Next',
      '  Answers the next number in the queue.',
      '',
      '  answers  number',
      '',
      '  call it: cernanto call ops/ticket-counter next',
      '',
      '',
      'Today',
      '  Answers every snapshot taken today.',
      '',
      '  answers  list of:',
      '    symbol   text             The ticker symbol.',
      '    prices   list of number',
      '',
      '  call it: cernanto call ops/ticket-counter today',
      '',
    ].join('\n'),
  );
});

test('the card shows a worker as the plane-run program it is', () => {
  const contract = [
    '/** Ticks every minute and logs the time. */',
    'export declare function run(): Promise<void>;',
    '',
  ].join('\n');
  assert.equal(
    cardText({ agentId: 'clock/ticker', type: 'worker', contract }),
    [
      'Ticker   clock/ticker   worker   deployed',
      '',
      '',
      'Run',
      '  Ticks every minute and logs the time.',
      '',
      '  the plane starts its run when deployed; it is not invoked by hand',
      '  follow it live:      cernanto trace clock/ticker -f',
      '  read its latest run: cernanto trace clock/ticker',
      '  run it again:        cernanto deploy clock/ticker',
      '  stop and remove it:  cernanto delete clock/ticker',
      '',
    ].join('\n'),
  );
});

test('the card survives no handlers', () => {
  assert.equal(
    cardText({
      agentId: 'ops/router',
      contract: 'export declare const nothing: number;\n',
    }),
    [
      'Router   ops/router   stateful   deployed',
      '',
      '  (no handlers in the recorded contract)',
      '',
    ].join('\n'),
  );
});

test('a handler declared as a constant of a function type reads as the function of its name does', () => {
  const types = `/** What an echo takes. */
export interface EchoInput {
    /** The words to say back. */
    text: string;
    times?: number;
}
`;
  // The declaration of an exported arrow function, on one line and
  // over several, with type parameters of its own, beside a helper
  // that answers no promise and a constant that is no function.
  const asConstants = `${types}/**
 * Says the words back.
 *
 * @param args - The words.
 * @returns The same words.
 */
export declare const echo: (args: EchoInput) => Promise<string>;
/** Counts the words. */
export declare const count: (args: {
    text: string;
    separators: Record<string, Array<string>>;
}) => Promise<{
    words: number;
}>;
export declare const first: <T extends string>(args: { items: T[] }) => Promise<T>;
export declare const ping: () => Promise<void>;
export declare const shout: (text: string) => string;
export declare const limit: number, second: (args: EchoInput) => Promise<string>;
`;
  const asFunctions = `${types}/**
 * Says the words back.
 *
 * @param args - The words.
 * @returns The same words.
 */
export declare function echo(args: EchoInput): Promise<string>;
/** Counts the words. */
export declare function count(args: {
    text: string;
    separators: Record<string, Array<string>>;
}): Promise<{
    words: number;
}>;
export declare function first<T extends string>(args: { items: T[] }): Promise<T>;
export declare function ping(): Promise<void>;
export declare function shout(text: string): string;
export declare const limit: number;
export declare function second(args: EchoInput): Promise<string>;
`;
  const constants = cardText({ agentId: 'ops/echo', contract: asConstants });
  assert.equal(constants, cardText({ agentId: 'ops/echo', contract: asFunctions }));
  assert.doesNotMatch(constants, /no handlers in the recorded contract/);
  for (const handler of ['echo', 'count', 'first', 'ping', 'second']) {
    assert.match(constants, new RegExp(`cernanto call ops/echo ${handler}\\b`), handler);
  }
  assert.doesNotMatch(constants, /shout|limit/, 'a helper and a constant are no handlers');
  assert.match(constants, /Says the words back\./);
});

test('a handler is whatever answers a promise, as the runtime reads it: a PromiseLike, and a promise beside a plain answer', () => {
  // The runtime serves a function whose declared answer is a Promise
  // or a PromiseLike, alone or as one side of a union; the card lists
  // the same functions and says what each promise holds.
  const contract = `/** Says the words back, later. */
export declare const later: (args: { text: string }) => PromiseLike<string>;
export declare function soon(args: { text: string }): PromiseLike<{
    words: number;
}>;
export declare const either: (args: { text: string }) => string | Promise<string>;
export declare function maybe(args: { text: string }): Promise<number> | undefined;
export declare function retry(run: () => Promise<string>, times: number): Promise<string>;
export declare const plain: (text: string) => string;
export declare function label(source: { read(): PromiseLike<string> }): string;
export declare function later2(text: string): () => Promise<string>;
export declare function isValue(x: unknown): x is number | Promise<number>;
export declare function mustBe(x: unknown): asserts x is string | Promise<string>;
export declare function pick<T>(value: T): T extends string ? Promise<string> : number | Promise<number>;
export declare function untyped(source: { read(): Promise<string> });
`;
  const text = cardText({ agentId: 'ops/echo', contract });
  assert.doesNotMatch(text, /no handlers in the recorded contract/);
  const section = (title: string): string => {
    const from = text.indexOf(`\n${title}\n`);
    assert.notEqual(from, -1, `${title}: ${text}`);
    const rest = text.slice(from + 1);
    const next = rest.indexOf('\n\n', rest.indexOf('call it:'));
    return next === -1 ? rest : rest.slice(0, next);
  };
  assert.match(section('Later'), /Says the words back, later\./);
  assert.match(section('Later'), /answers {2}text\n/);
  assert.match(section('Soon'), /answers\n {4}words {3}number\n/);
  assert.match(
    section('Either'),
    /answers {2}text\n/,
    'the same answer on both sides is said once',
  );
  assert.match(section('Maybe'), /answers {2}number/);
  // A parameter that is itself a function hides neither the answer nor
  // the parameter's own type.
  assert.match(section('Retry'), /answers {2}text\n/);
  assert.doesNotMatch(text, /\nPlain\n/, 'a function that answers no promise is a helper');
  // A promise inside a parameter, or behind a function the answer is,
  // is no promise of the function's own, with or without a return
  // type declared; neither is one inside a type guard's or an
  // assertion's type, or in a branch of a conditional type: each holds
  // its union inside it.
  assert.doesNotMatch(text, /invoke ops\/echo (?:label|later2|isValue|mustBe|pick|untyped)\b/);
  for (const handler of ['later', 'soon', 'either', 'maybe', 'retry']) {
    assert.match(text, new RegExp(`cernanto call ops/echo ${handler}\\b`), handler);
  }
});

test("the plane's own list of the functions it serves decides what the card lists for an agent that is called; the contract gives their words", () => {
  const contract = `export type Greeting = (args: { name: string }) => Promise<string>;
/** Says hello. */
export declare function greet(args: { name: string }): Promise<string>;
/** Says goodbye. */
export declare function part(args: { name: string }): Promise<string>;
export declare const wave: Greeting;
export declare function isName(x: unknown): x is string | Promise<string>;
`;
  const listed = (input: { handlers?: string[]; type?: string }): string[] =>
    [
      ...cardText({ agentId: 'ops/greeter', contract, ...input }).matchAll(
        /call it: cernanto call ops\/greeter (\S+)/g,
      ),
    ].map((match) => match[1] ?? '');
  // The row names what the plane serves: a function the contract
  // declares beside them is a helper, and one the contract spells in a
  // way this reader does not follow is listed all the same, by its
  // name. The order is the contract's.
  assert.deepEqual(listed({ handlers: ['wave', 'greet'] }), ['greet', 'wave']);
  const served = cardText({ agentId: 'ops/greeter', contract, handlers: ['wave', 'greet'] });
  assert.match(served, /\nGreet\n {2}Says hello\.\n\n {2}takes\n {4}name {3}text\n/);
  assert.match(
    served,
    /\nWave\n\n {2}answers {2}anything\n\n {2}call it: cernanto call ops\/greeter wave\n/,
  );
  assert.doesNotMatch(served, /Says goodbye/);
  // A row that names none, a module and an interface are read from
  // the contract alone: what answers a promise of its own.
  assert.deepEqual(listed({}), ['greet', 'part']);
  assert.deepEqual(listed({ handlers: [] }), ['greet', 'part']);
  assert.deepEqual(listed({ handlers: ['wave'], type: 'module' }), ['greet', 'part']);
  assert.deepEqual(listed({ handlers: ['wave'], type: 'interface' }), ['greet', 'part']);
  const surface = cardText({
    agentId: 'ops/greeter',
    contract,
    handlers: ['wave'],
    type: 'interface',
  });
  assert.match(surface, /\nGreet\n/);
  assert.match(surface, /\nPart\n/);
  assert.doesNotMatch(surface, /\nWave\n/);
  // An interface's call goes to the implementor the plane binds: its
  // card carries the command to paste like any agent's.
  assert.match(surface, /\n {2}call it: cernanto call ops\/greeter greet name=\.\.\.\n/);
});

test('the card collapses inline objects and unions into plain words', () => {
  const contract = [
    'export declare function greet(args: {',
    '    name: string;',
    '    tone?: "formal" | "casual";',
    '}): Promise<{',
    '    greeting: string;',
    '    characters: number;',
    '}>;',
    '',
  ].join('\n');
  assert.equal(
    cardText({ agentId: 'text/greeter', contract }),
    [
      'Greeter   text/greeter   stateful   deployed',
      '',
      '',
      'Greet',
      '',
      '  takes',
      '    name   text',
      '    tone   one of: formal, casual (optional)',
      '',
      '  answers',
      '    greeting     text',
      '    characters   number',
      '',
      '  call it: cernanto call text/greeter greet name=...',
      '',
    ].join('\n'),
  );
});

test('the card splits the relations: calls, links, platform, and who uses it', () => {
  // The card's idiom: direct relations as labeled facts on
  // the card. The cli computes the split from the fleet (a used id
  // calls over the wire; a link is a module linked inside this agent)
  // and the inverted grants become used by.
  const lines = cardText({
    agentId: 'jira/recent-tickets',
    contract: CONTRACT,
    uses: ['billing/invoicer'],
    links: ['text/summarize'],
    usedBy: ['ops/escalator', 'ops/daily-digest'],
  }).split('\n');
  assert.equal(lines[1], 'uses     billing/invoicer');
  assert.equal(lines[2], 'links    text/summarize');
  assert.equal(lines[3], 'used by  ops/escalator, ops/daily-digest');
});

/** The `call it` line of the one handler a contract declares. */
function callLine(contract: string, shell?: 'posix' | 'windows'): string {
  const lines = cardLines({
    agentId: 'books/catalog',
    contract,
    ...(shell === undefined ? {} : { shell }),
  });
  return lines.find((line) => line.startsWith('  call it: ')) ?? '';
}

test("the pasted command quotes a contract's own text: an apostrophe, or a crafted value, stays one argument", () => {
  const contract = [
    'export declare function find(args: {',
    `    author: "O'Reilly" | "Knuth";`,
    `    note: "'; touch injected; echo '";`,
    '}): Promise<number>;',
    '',
  ].join('\n');
  const author = `author=${shellArgument("O'Reilly", 'posix')}`;
  const note = `note=${shellArgument("'; touch injected; echo '", 'posix')}`;
  assert.equal(callLine(contract), `  call it: cernanto call books/catalog find ${author} ${note}`);
  assert.equal(author, `author='O'\\''Reilly'`);
  assert.equal(note, `note=''\\''; touch injected; echo '\\'''`);
  const json = `{"author":"O'Reilly","note":"'; touch injected; echo '"}`;
  assert.equal(
    shellArgument(json, 'posix'),
    `'{"author":"O'\\''Reilly","note":"'\\''; touch injected; echo '\\''"}'`,
  );
  // A real shell reads each quoted text back as the one argument it was.
  if (system.name !== 'windows') {
    const read = (script: string): string =>
      execFileSync('sh', ['-c', script], { encoding: 'utf8' });
    assert.equal(
      read(`printf '%s\\n' ${author} ${note}`),
      `author=O'Reilly\nnote='; touch injected; echo '\n`,
    );
    assert.equal(read(`printf '%s' ${shellArgument(json, 'posix')}`), json);
  }
});

test('on the Windows command line the arguments ride in double quotes, and text outside the plain characters stays out', () => {
  assert.equal(shellArgument('{"name":"..."}', 'windows'), '"{\\"name\\":\\"...\\"}"');
  assert.equal(shellArgument('a\\"b\\', 'windows'), '"a\\\\\\"b\\\\"');
  const choices = [
    'export declare function find(args: {',
    `    author: "O'Reilly & sons" | "Knuth";`,
    '    shelf: "north" | "south";',
    '}): Promise<number>;',
    '',
  ].join('\n');
  assert.equal(
    callLine(choices, 'windows'),
    '  call it: cernanto call books/catalog find author=... shelf=north',
  );
  const names = [
    `export declare function find(args: { "a & b": string }): Promise<number>;`,
    '',
  ].join('\n');
  assert.equal(
    callLine(names, 'windows'),
    '  call it: cernanto call books/catalog find --args <the arguments as json>',
  );
});

/** A function over one argument type, as a contract declares it. */
function taking(args: string, name = 'find'): string {
  return [`export declare function ${name}(${args}): Promise<number>;`, ''].join('\n');
}

const EVERY_KIND = taking(
  [
    'args: {',
    '        title: string;',
    '        pages: number;',
    '        inPrint: boolean;',
    '        shelf: "north wing" | "south";',
    `        author: "O'Reilly" | "Knuth";`,
    '        tags: string[];',
    '        labels: Record<string, string>;',
    '        publisher: {',
    '            name: string;',
    '            founded: number;',
    '        };',
    '        note?: string;',
    '    }',
  ].join('\n'),
);

test('the pasted command names each argument the way invoke reads it: a text, a number or a yes or no after =, a list or a record as json after :=, and invoke reads it back whole by the declared types', () => {
  const line = callLine(EVERY_KIND);
  const words = [
    'title=...',
    'pages=0',
    'inPrint=true',
    `shelf='north wing'`,
    `author='O'\\''Reilly'`,
    `tags:='[]'`,
    `labels:='{}'`,
    `publisher:='{"name":"...","founded":0}'`,
  ].join(' ');
  assert.equal(line, `  call it: cernanto call books/catalog find ${words}`);
  // The words a real shell hands the command are the arguments the
  // card shows, read by invoke's own reader.
  if (system.name !== 'windows') {
    const handed = execFileSync('sh', ['-c', `printf '%s\\0' ${words}`], { encoding: 'utf8' })
      .split('\0')
      .slice(0, -1);
    assert.deepEqual(argsOf(handed, undefined, functionParameters(EVERY_KIND, 'find'), 'find'), {
      title: '...',
      pages: 0,
      inPrint: true,
      shelf: 'north wing',
      author: "O'Reilly",
      tags: [],
      labels: {},
      publisher: { name: '...', founded: 0 },
    });
  }
  assert.equal(
    callLine(EVERY_KIND, 'windows'),
    '  call it: cernanto call books/catalog find title=... pages=0 inPrint=true shelf="north wing" author=... tags:="[]" labels:="{}" publisher:="{\\"name\\":\\"...\\",\\"founded\\":0}"',
  );
});

test('the pasted command carries one json document where pairs cannot say the arguments, and nothing where none is required', () => {
  // An argument that is not a set of named fields.
  // One value that is not a record rides as the word the invoke reads:
  // text as it is, a list as json.
  assert.equal(
    callLine(taking('text: string', 'shout')),
    '  call it: cernanto call books/catalog shout text=...',
  );
  assert.equal(
    callLine(taking('values: number[]', 'sum')),
    `  call it: cernanto call books/catalog sum values:='[]'`,
  );
  // A name a pair would split in the wrong place.
  assert.equal(
    callLine(taking('args: { "a=b": string; plain: number }')),
    `  call it: cernanto call books/catalog find --args '{"a=b":"...","plain":0}'`,
  );
  assert.deepEqual(argsOf([], '{"a=b":"...","plain":0}'), { 'a=b': '...', plain: 0 });
  // Optional fields alone, or no argument at all: the bare call.
  assert.equal(
    callLine(taking('args: { limit?: number }', 'list')),
    '  call it: cernanto call books/catalog list',
  );
  assert.equal(callLine(taking('', 'next')), '  call it: cernanto call books/catalog next');
  assert.equal(argsOf([], undefined), undefined);
});

test('an input that extends another carries the fields it inherits; one whose parent is unknown keeps its name', () => {
  const contract = [
    'export interface Paged {',
    '    /** The page to read. */',
    '    page: number;',
    '    size?: number;',
    '}',
    'export interface Titled extends Paged {',
    '    title: string;',
    '}',
    'export interface FindInput extends Titled, Dated {',
    '    author: string;',
    '}',
    'export interface Dated {',
    '    year: number;',
    '}',
    'export interface Outer extends Elsewhere<string> {',
    '    inner: string;',
    '}',
    'export declare function find(args: FindInput): Promise<number>;',
    'export declare function wrap(args: Outer): Promise<number>;',
    '',
  ].join('\n');
  const text = cardText({ agentId: 'books/catalog', contract });
  assert.ok(
    text.includes(
      [
        '  takes',
        '    page     number              The page to read.',
        '    size     number (optional)',
        '    title    text',
        '    year     number',
        '    author   text',
        '',
      ].join('\n'),
    ),
    text,
  );
  assert.ok(
    text.includes('  call it: cernanto call books/catalog find page=0 title=... year=0 author=...'),
    text,
  );
  // The parent is a type the contract does not declare: the input is
  // named as written, in place of a partial list of its fields, under
  // the parameter that takes it.
  assert.ok(text.includes('  takes\n    args   Outer\n'), text);
});

test('a function with several parameters shows each in order with its @param words, and is called with pairs naming them', () => {
  const contract = [
    'export interface Tune {',
    '    /** The model to use. */',
    '    model?: string;',
    '}',
    '/**',
    ' * Decides a yes or no question.',
    ' *',
    ' * @param context - The whole of what is known.',
    ' * @param statement - What qualifies as true.',
    ' * @param tune - Model and effort, rarely.',
    ' * @returns The verdict.',
    ' */',
    'export declare function decideIf(context: Record<string, unknown> | null, statement: string, tune?: Tune): Promise<boolean>;',
    'export declare function rank<T>(context: Record<string, unknown> | null, statement: string, items: readonly T[], maxItems?: number): Promise<T[]>;',
    'export declare function tally(...names: string[]): Promise<number>;',
    '',
  ].join('\n');
  const text = cardText({ agentId: 'books/catalog', contract });
  assert.ok(
    text.includes(
      [
        '  takes',
        '    context     map of text to anything   The whole of what is known.',
        '    statement   text                      What qualifies as true.',
        '    tune        (optional)                Model and effort, rarely.',
        '      model   text (optional)   The model to use.',
        '',
      ].join('\n'),
    ),
    text,
  );
  assert.ok(
    text.includes(`  call it: cernanto call books/catalog decideIf context:='{}' statement=...\n`),
    text,
  );
  assert.ok(
    text.includes(
      `  call it: cernanto call books/catalog rank context:='{}' statement=... items:='[]'\n`,
    ),
    text,
  );
  assert.ok(text.includes('    items       list of T\n'), text);
  assert.ok(text.includes('    ...names   list of text\n'), text);
  assert.ok(text.includes('  call it: cernanto call books/catalog tally\n'), text);
});

test('the card of a compiled package says compiled in place of deployed, and not verified without a stamp', () => {
  const unstamped = cardLines({
    agentId: 'domains/godaddy-check',
    contract: CONTRACT,
    state: 'compiled',
  });
  assert.equal(
    unstamped[0],
    'Godaddy Check   domains/godaddy-check   stateful   compiled   not verified',
  );
  const stamped = cardLines({
    agentId: 'domains/godaddy-check',
    contract: CONTRACT,
    state: 'compiled',
    verified: { at: '2026-08-20T10:00:00Z' },
  });
  assert.equal(
    stamped[0],
    'Godaddy Check   domains/godaddy-check   stateful   compiled   verified live 2026-08-20 10:00:00',
  );
  // A deployed row without a stamp keeps its head as it was.
  const deployed = cardLines({ agentId: 'domains/godaddy-check', contract: CONTRACT });
  assert.equal(deployed[0], 'Godaddy Check   domains/godaddy-check   stateful   deployed');
});

test('the card of a registry package says in the registry, and an installed row says its version, publisher and the newer version', () => {
  const published = cardLines({
    agentId: 'domains/godaddy-check',
    contract: CONTRACT,
    state: 'registry',
    verified: { at: '2026-08-20T10:00:00Z' },
  });
  assert.equal(
    published[0],
    'Godaddy Check   domains/godaddy-check   stateful   in the registry   verified live 2026-08-20 10:00:00',
  );
  const unstamped = cardLines({
    agentId: 'domains/godaddy-check',
    contract: CONTRACT,
    state: 'registry',
  });
  assert.equal(
    unstamped[0],
    'Godaddy Check   domains/godaddy-check   stateful   in the registry   not verified',
  );
  const installed = cardLines({
    agentId: 'domains/godaddy-check',
    contract: CONTRACT,
    uses: ['cernanto/auth'],
    installed: { version: '0.0.1', publisher: 'acme', available: '0.0.2' },
  });
  assert.equal(installed[0], 'Godaddy Check   domains/godaddy-check   stateful   deployed');
  assert.equal(
    installed[1],
    'installed  0.0.1, published by acme; 0.0.2 available in the registry',
  );
  assert.equal(installed[2], 'uses       cernanto/auth');
  // A package landed from a file states no publisher, and one without
  // a version is a package all the same.
  const fromFile = cardLines({
    agentId: 'domains/godaddy-check',
    contract: CONTRACT,
    installed: { version: '0.0.1' },
  });
  assert.equal(fromFile[1], 'installed  0.0.1');
  const unversioned = cardLines({
    agentId: 'domains/godaddy-check',
    contract: CONTRACT,
    installed: {},
  });
  assert.equal(unversioned[1], 'installed  from a package');
});
