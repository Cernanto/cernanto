// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The glue a running agent imports beside the code the coder wrote: the
// entry that wires the definition, the os module, the stubs of its
// dependencies, the binds of its interfaces, the assets module, the
// tester's entry and the mock stubs a shadow carries. Every file is
// JavaScript over names read from the packages, calling into
// runtime-lib; the compiler documents the same surface for the coder
// through its `.d.ts` twins, and the two agree name for name.

import { AGENT_ID_PATTERN } from './manifest.js';
import type { AgentType } from './manifest.js';
import type {
  DeclaredFunction,
  DeclaredSurface,
  WireParameters,
  WireShapes,
} from './declarations.js';

/** An agent id that names a file or a folder: checked against the id
 * rule first, so the name it becomes stays inside where it is written. */
function agentIdOf(agentId: string): string {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new Error(`${JSON.stringify(agentId)} is no agent id: nothing is written under its name`);
  }
  return agentId;
}

/** The stub file name of an agent: its id with every `/` as `-`. */
export function stubFileName(agentId: string): string {
  return agentIdOf(agentId).replaceAll('/', '-');
}

/** Two ids among these that read as one name. An id's `/` is a `-` in
 * the file of its stub and in the folder of its composed module, so
 * `a-b/c` and `a/b-c` are both `a-b-c`, and what is written for one
 * would be written over the other's. */
function sharedName(agentIds: readonly string[]): [string, string] | undefined {
  const byName = new Map<string, string>();
  for (const agentId of new Set(agentIds)) {
    const name = stubFileName(agentId);
    const other = byName.get(name);
    if (other !== undefined) return [other, agentId];
    byName.set(name, agentId);
  }
  return undefined;
}

/** Refuses a package that names two dependencies whose stubs are one
 * file, before a file of it is written.
 * @param agentIds - The ids the package's stubs are written for.
 * @example refuseStubCollisions(Object.keys(manifest.uses));
 */
export function refuseStubCollisions(agentIds: readonly string[]): void {
  const shared = sharedName(agentIds);
  if (shared === undefined) return;
  throw new Error(
    `${shared[0]} and ${shared[1]} both read as the stub agents/${stubFileName(shared[0])}.js: one package cannot name both as dependencies`,
  );
}

/** Refuses a composition that holds two modules whose packages are one
 * folder, before either is placed.
 * @param agentIds - The ids of the modules one generation composes.
 * @example refuseComposedCollisions(Object.keys(composition));
 */
export function refuseComposedCollisions(agentIds: readonly string[]): void {
  const shared = sharedName(agentIds);
  if (shared === undefined) return;
  throw new Error(
    `${shared[0]} and ${shared[1]} both read as the package ${composedPackageNameOf(shared[0])}: one generation cannot compose both`,
  );
}

function upperFirst(word: string): string {
  return word === '' ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

function lowerFirst(word: string): string {
  return word === '' ? word : `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
}

/** The accessor an interface's bind module exports: the full id split
 * on `/`, `.` and `-` and camel-cased (`email/client` reads
 * `emailClient`). */
export function accessorName(interfaceId: string): string {
  const words = interfaceId.split(/[/.\-]+/).filter((word) => word !== '');
  return words.map((word, index) => (index === 0 ? lowerFirst(word) : upperFirst(word))).join('');
}

const RESERVED = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/** A JavaScript name: what an export, a parameter or a local may be
 * called. */
const NAME = /^[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*$/u;

/** A name the generated code writes into source, checked first: a text
 * that is no name would be code of its own.
 * @param name - The name a package, a contract or a document gave.
 * @param what - What the name is, for the refusal's words.
 * @returns The name.
 * @example assertName(handler, 'a handler of ops/greeter');
 */
export function assertName(name: string, what: string): string {
  if (!NAME.test(name)) {
    throw new Error(`${what} reads as ${JSON.stringify(name)}, which is no JavaScript name`);
  }
  return name;
}

/** The locals of one generated module. A name is given as asked while
 * it is free, and with `$` after it until it is: what the platform
 * imports and declares never meets a name the application exports, and
 * a reserved word is never a local.
 * @param taken - The names the module exports and the names its
 *   functions take as parameters.
 * @returns The local for a wanted name.
 * @example const local = localsOf(handlers); const call = local('wireCall');
 */
export function localsOf(taken: Iterable<string>): (wanted: string) => string {
  const used = new Set<string>([...RESERVED, ...taken]);
  return (wanted) => {
    let name = wanted;
    while (used.has(name)) name += '$';
    used.add(name);
    return name;
  };
}

/** An import clause's entry: the name itself, or the name under its
 * local.
 * @param name - The name the other module exports.
 * @param local - The local it is held under here.
 * @returns The entry as written between the braces.
 * @example imported('login', 'login$'); // 'login as login$'
 */
export function imported(name: string, local: string): string {
  return name === local ? name : `${name} as ${local}`;
}

/** An async function exported under a name the application chose:
 * declared under the name where it can be a local, else under a local
 * of its own and exported by the name (`delete`, `new`).
 * @param name - The exported name.
 * @param local - The locals of the module.
 * @param parameters - The parameter list as written.
 * @param body - The function's lines.
 * @returns The lines of the declaration.
 * @example exportedFunction('delete', local, 'args', ['  return 1;']);
 */
export function exportedFunction(
  name: string,
  local: (wanted: string) => string,
  parameters: string,
  body: readonly string[],
): string[] {
  if (!RESERVED.has(name)) return [`export async function ${name}(${parameters}) {`, ...body, '}'];
  const declared = local(name);
  return [
    `async function ${declared}(${parameters}) {`,
    ...body,
    '}',
    `export { ${declared} as ${name} };`,
  ];
}

/** The names of a list, each once, in their first order. */
function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}

/** A wrapper's parameters as declared and as handed on: a reserved
 * word, a text that is no name and a name already taken read
 * `arg<n>`, and a rest parameter keeps its dots on both sides. `one`
 * is the single plain parameter of a function that takes one argument,
 * which rides a call as itself. */
function parametersOf(entry: Pick<DeclaredFunction, 'parameters' | 'rest'>): {
  declared: string;
  sent: string;
  /** The wire keys: the contract's parameter names, as every road keys
   * the record it sends and reads; the generated function takes each
   * under the same name (a reserved word or a name taken twice, which
   * no declaration carries, is held under another local). */
  keys: string[];
  rest: boolean;
  one?: string;
} {
  const given = entry.parameters.length === 0 ? ['input'] : entry.parameters;
  const taken = new Set<string>();
  const names = given.map((name, index) => {
    let own =
      RESERVED.has(name) || !NAME.test(name) || taken.has(name) ? `arg${String(index)}` : name;
    while (taken.has(own) || given.includes(own, index + 1)) own += '$';
    taken.add(own);
    return own;
  });
  const rest = entry.rest === true;
  const written = names.map((name, index) =>
    rest && index === names.length - 1 ? `...${name}` : name,
  );
  const only = names[0];
  return {
    declared: written.join(', '),
    // Several parameters ride as one record keyed by their names, a rest
    // parameter's list under its name: json has no undefined, and a
    // member left out is a parameter left out, wherever it stands. The
    // key is the contract's name whatever local holds the value.
    sent: `{ ${given.map((key, index) => (key === names[index] ? key : `${JSON.stringify(key)}: ${names[index] ?? key}`)).join(', ')} }`,
    keys: [...given],
    rest,
    ...(names.length === 1 && !rest && only !== undefined ? { one: only } : {}),
  };
}

/** The arguments a handler is called with from the record that rode:
 * each declared name read off it, a rest parameter's list spread. */
function pickedFrom(record: string, keys: string[], rest: boolean): string {
  const read = (key: string): string =>
    NAME.test(key) ? `${record}.${key}` : `${record}[${JSON.stringify(key)}]`;
  return keys
    .map((key, index) =>
      rest && index === keys.length - 1 ? `...(${read(key)} ?? [])` : read(key),
    )
    .join(', ');
}

/** The entry's spread: a record keyed by the declared names, or a list
 * in their order, becomes the handler's arguments, each revived by its
 * own shape when it has one (a parameter with none is left as it came,
 * its place in the shapes `null` in the generated JSON), the rest
 * parameter's items by the items' shape on both roads. */
const SPREAD_LINE = (name: string): string =>
  [
    `const ${name} = (fn, keys, rest, shapes, revive) => {`,
    'const shapeOf = (index) => (shapes === undefined ? undefined : (shapes[index] ?? undefined));',
    'const lift = (value, index) => (shapes === undefined ? value : revive(value, shapeOf(index)));',
    'const last = keys.length - 1;',
    "const items = () => { const shape = shapeOf(last); return shape !== undefined && typeof shape === 'object' && 'items' in shape ? shape.items : undefined; };",
    'return (wire) => {',
    'if (Array.isArray(wire)) {',
    'if (!rest) return fn(...wire.map(lift));',
    'const each = items();',
    'return fn(...wire.slice(0, last).map(lift), ...wire.slice(last).map((value) => (shapes === undefined ? value : revive(value, each))));',
    '}',
    'const values = keys.map((key, index) => lift(wire?.[key], index));',
    'return rest ? fn(...values.slice(0, -1), ...(values.at(-1) ?? [])) : fn(...values);',
    '};',
    '};',
  ].join(' ');

/** The export name a granted path takes in the assets module. */
export function assetExportName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  const words = base
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => (word === word.toUpperCase() ? word.toLowerCase() : word));
  let name = words
    .map((word, index) => (index === 0 ? lowerFirst(word) : upperFirst(word)))
    .join('');
  if (name === '') name = 'asset';
  if (/^[0-9]/.test(name)) name = `_${name}`;
  if (RESERVED.has(name)) name = `${name}Asset`;
  return name;
}

const HEADER = "// Generated by the platform; wires this agent's definition. Do not edit.";

/** The entry `dist/main.js`: the exported handlers wired into the
 * definition of the agent's type; a worker's one program. */
export function entryModule(
  type: AgentType,
  handlers: readonly string[],
  secrets: readonly string[] = [],
  shapes: Readonly<Record<string, WireShapes>> = {},
  declared: WireParameters = {},
): string {
  if (type === 'interface') throw new Error('an interface has no entry: nothing serves it');
  // The entry exports `agent` alone: a handler of that name, or of a
  // name the entry imports for itself, is imported under a local.
  const local = localsOf(['agent']);
  if (type === 'worker') {
    const program = handlers[0];
    if (program === undefined || handlers.length !== 1) {
      throw new Error(
        `a worker is one program: expected one exported function, got ${String(handlers.length)}`,
      );
    }
    const run = local(assertName(program, "the worker's program"));
    return [
      HEADER,
      `import { ${imported(program, run)} } from './index.js';`,
      '',
      `export const agent = { kind: 'worker', handlers: { run: ${run} } };`,
      '',
    ].join('\n');
  }
  const served = unique(handlers).map((handler) => assertName(handler, 'a handler'));
  // A handler whose arguments or answer are secrets serves unrecorded
  // (the contract's mark, honored on the served side too).
  const marked = served.filter((handler) => secrets.includes(handler));
  // A handler whose argument carries dates or bytes (the contract's
  // shape) is handed the call's json revived.
  const wired = served.filter((handler) => shapes[handler]?.argument !== undefined);
  const secretHandler = marked.length === 0 ? undefined : local('secretHandler');
  const wiredHandler = wired.length === 0 ? undefined : local('wiredHandler');
  // A handler whose arguments ride as one array (several parameters, or
  // a rest parameter) is handed the wire's one value and spreads it
  // back into its declared parameters; the runtime hands every handler
  // one value.
  const arrayed = served.filter((handler) => ridesAsArray(declared[handler]));
  const spread = arrayed.length === 0 ? undefined : local('spread');
  // A parameter of several that carries dates or bytes is revived by its
  // own shape before the spread.
  const shaped = arrayed.filter((handler) => shapes[handler]?.parameters !== undefined);
  const reviveLocal = shaped.length === 0 ? undefined : local('reviveWire');
  const locals = new Map(served.map((handler) => [handler, local(handler)]));
  const entries = served
    .map((handler) => {
      const own = locals.get(handler) ?? handler;
      const argument = shapes[handler]?.argument;
      const spreading = spread !== undefined && arrayed.includes(handler);
      const known = declared[handler];
      const form = known === undefined ? undefined : parametersOf(known);
      const parameterShapes = shapes[handler]?.parameters;
      const base =
        spreading && form !== undefined
          ? `${spread}(${own}, ${JSON.stringify(form.keys)}, ${String(form.rest)}, ${parameterShapes === undefined || reviveLocal === undefined ? 'undefined, undefined' : `${JSON.stringify(parameterShapes)}, ${reviveLocal}`})`
          : own;
      const revived =
        argument === undefined || wiredHandler === undefined || spreading
          ? base
          : `${wiredHandler}(${own}, ${JSON.stringify(argument)})`;
      const value =
        marked.includes(handler) && secretHandler !== undefined
          ? `${secretHandler}(${revived})`
          : revived;
      return value === handler ? handler : `${handler}: ${value}`;
    })
    .join(', ');
  const runtime = [
    ...(secretHandler === undefined ? [] : [imported('secretHandler', secretHandler)]),
    ...(wiredHandler === undefined ? [] : [imported('wiredHandler', wiredHandler)]),
    ...(reviveLocal === undefined ? [] : [imported('reviveWire', reviveLocal)]),
  ];
  const own = served.map((handler) => imported(handler, locals.get(handler) ?? handler));
  return [
    HEADER,
    ...(runtime.length === 0
      ? []
      : [`import { ${runtime.join(', ')} } from '@cernanto/runtime-lib';`]),
    own.length === 0 ? "import './index.js';" : `import { ${own.join(', ')} } from './index.js';`,
    '',
    ...(spread === undefined ? [] : [SPREAD_LINE(spread), '']),
    `export const agent = { kind: '${type}', handlers: { ${entries} } };`,
    '',
  ].join('\n');
}

/** The os module `dist/os.js`: the platform vocabulary that cannot be
 * plain Node, composed by type. A service, a task and a job know their
 * caller; a worker and a module have no identity of their own. An
 * interface gets none. */
export function osModule(type: AgentType): string | undefined {
  if (type === 'interface') return undefined;
  const hasCaller = type === 'service' || type === 'task' || type === 'job';
  // An executable agent has a name of its own; a module runs inside
  // its host and has none.
  const hasIdentity = hasCaller || type === 'worker';
  const names = [
    'callId as callIdImpl',
    'cancel as cancelImpl',
    'invoke as invokeImpl',
    'substrateUrl as substrateUrlImpl',
    'usage as usageImpl',
    ...(hasCaller ? ['caller as callerImpl'] : []),
    ...(hasIdentity
      ? ['agentId as agentIdImpl', 'artifact as artifactImpl', 'composition as compositionImpl']
      : []),
  ];
  // The same surface the declaration twin the coder sees offers:
  // callId, caller for the agents with an identity, cancel, invoke for
  // a target the code learns only when it runs (the same durable call a
  // granted dependency's stub makes, waited for or not), and usage, the
  // cost of a model request the code made, for every type.
  return [
    "// Generated by the platform; this agent's durable powers. Do not edit.",
    `import { ${names.join(', ')} } from '@cernanto/runtime-lib';`,
    '',
    ...(hasCaller ? ['export const caller = callerImpl;'] : []),
    ...(hasIdentity
      ? [
          'export function agentId() { return agentIdImpl(); }',
          'export function artifact() { return artifactImpl(); }',
          'export function composition() { return compositionImpl(); }',
        ]
      : []),
    'export function callId() { return callIdImpl(); }',
    'export function substrateUrl() { return substrateUrlImpl(); }',
    'export const cancel = cancelImpl;',
    'export const invoke = invokeImpl;',
    'export function usage(report) { return usageImpl(report); }',
    '',
  ].join('\n');
}

/** Whether a declared handler's arguments ride as one array: several
 * parameters, or a rest parameter. */
function ridesAsArray(known: Pick<DeclaredFunction, 'parameters' | 'rest'> | undefined): boolean {
  return known !== undefined && (known.parameters.length > 1 || known.rest === true);
}

/** What a stub declares for a handler and what it sends: the declared
 * parameters when the contract is known (one rides as itself, several
 * or a rest parameter as one array), else one argument as it is. */
function wireFormOf(known: Pick<DeclaredFunction, 'parameters' | 'rest'> | undefined): {
  declared: string;
  sent: string;
} {
  if (known === undefined) return { declared: 'args', sent: 'args' };
  const parameters = parametersOf(known);
  return parameters.one === undefined
    ? { declared: parameters.declared, sent: parameters.sent }
    : { declared: parameters.declared, sent: parameters.one };
}

/** The stub of a task, service or job dependency: every handler rides
 * the wire as a durable request, its arguments as the contract
 * declares them when the contract is known. */
export function wireStubModule(
  agentId: string,
  handlers: readonly string[],
  secrets: readonly string[] = [],
  shapes: Readonly<Record<string, WireShapes>> = {},
  declared: WireParameters = {},
): string {
  const exported = unique(handlers).map((handler) =>
    assertName(handler, `a handler of ${agentId}`),
  );
  const revives = exported.some((handler) => shapes[handler]?.result !== undefined);
  // The handlers' own parameter names are taken: what the stub imports
  // for itself goes under other names.
  const local = localsOf([
    ...exported,
    'args',
    ...exported.flatMap((handler) => declared[handler]?.parameters ?? []),
  ]);
  const wireCall = local('wireCall');
  const reviveWire = revives ? local('reviveWire') : 'reviveWire';
  const wireStub = local('wireStub');
  const lines = [
    `// Generated by the platform from the ${agentId} contract. Do not edit.`,
    `// ${agentId} answers over the wire: every call below is a durable`,
    "// journaled request to the agent's own call.",
    revives
      ? `import { call as ${wireCall}, ${imported('reviveWire', reviveWire)}, stub as ${wireStub} } from '@cernanto/runtime-lib/calls';`
      : `import { call as ${wireCall}, stub as ${wireStub} } from '@cernanto/runtime-lib/calls';`,
    '',
  ];
  for (const handler of exported) {
    // A call whose arguments or answer are secrets records neither and
    // asks the callee to do the same (the contract's mark).
    const options = secrets.includes(handler) ? ', { secret: true }' : '';
    const form = wireFormOf(declared[handler]);
    lines.push(
      ...exportedFunction(handler, local, form.declared, [
        `  return ${revived(`await ${wireCall}(${wireStub}(${JSON.stringify(agentId)}, ${JSON.stringify(handler)}${options}), ${form.sent})`, shapes[handler]?.result, reviveWire)};`,
      ]),
      '',
    );
  }
  return lines.join('\n');
}

/** Refuses a contract that declares a function both ways, with a
 * promise for its answer and with a plain one, where its functions are
 * linked in process: as a traced call the function would answer a
 * promise for every call, and passed straight through it would run
 * outside the module's own call. The contract is refused in words
 * before a stub of it is written. */
function refuseMixed(agentId: string, surface: DeclaredSurface): void {
  const both = surface.functions.find((entry) => entry.mixed === true);
  if (both === undefined) return;
  throw new Error(
    `${agentId} declares ${both.name} both with a promise for its answer and with a plain one: a function linked in process is a traced call or a helper, so its contract declares it one way`,
  );
}

/** An answer expression revived by the contract's shape (its dates
 * and bytes), or the expression itself when the answer carries none. */
function revived(
  expression: string,
  shape: WireShapes['result'],
  reviveWire = 'reviveWire',
): string {
  if (shape === undefined) return expression;
  return `${reviveWire}(await ${expression.replace(/^await /, '')}, ${JSON.stringify(shape)})`;
}

/** The stub of a linked module: each handler runs in process, traced
 * as the module's own call; helpers and constants pass straight
 * through from the composed package. */
export function linkedStubModule(agentId: string, surface: DeclaredSurface): string {
  refuseMixed(agentId, surface);
  const alias = composedPackageNameOf(agentId);
  const handlers = surface.functions.filter((entry) => entry.async);
  const helpers = surface.functions.filter((entry) => !entry.async).map((entry) => entry.name);
  const passed = [...helpers, ...surface.constants];
  for (const name of [...handlers.map((entry) => entry.name), ...passed]) {
    assertName(name, `an export of ${agentId}`);
  }
  const revives = handlers.some((entry) => entry.shapes?.result !== undefined);
  // The module's own exports and its functions' parameters are taken:
  // what the stub imports for itself goes under other names.
  const local = localsOf([
    ...handlers.map((entry) => entry.name),
    ...passed,
    ...handlers.flatMap((entry) => entry.parameters),
    'input',
  ]);
  const linkedCall = local('linkedCall');
  const reviveWire = revives ? local('reviveWire') : 'reviveWire';
  const impls = new Map(handlers.map((entry) => [entry.name, local(`${entry.name}Impl`)]));
  const lines = [
    `// Generated by the platform from the ${agentId} contract. Do not edit.`,
    `// ${agentId} is a module: its code links in-process and runs as this`,
    '// agent; each call is traced with its arguments and result.',
    revives
      ? `import { ${imported('linkedCall', linkedCall)}, ${imported('reviveWire', reviveWire)} } from '@cernanto/runtime-lib/calls';`
      : `import { ${imported('linkedCall', linkedCall)} } from '@cernanto/runtime-lib/calls';`,
  ];
  if (handlers.length > 0) {
    lines.push(
      `import { ${handlers.map((entry) => `${entry.name} as ${impls.get(entry.name) ?? ''}`).join(', ')} } from ${JSON.stringify(alias)};`,
    );
  }
  lines.push('');
  for (const entry of handlers) {
    const handler = entry.name;
    const impl = impls.get(handler) ?? '';
    const parameters = parametersOf(entry);
    const options = entry.secret ? ', { secret: true }' : '';
    // One plain parameter rides the traced call as itself. Several, or
    // a rest parameter, ride it as one record keyed by their names, read
    // back into the module's declared parameters.
    const call =
      parameters.one === undefined
        ? `${linkedCall}(${JSON.stringify(agentId)}, ${JSON.stringify(handler)}, ${parameters.sent}, (input) => ${impl}(${pickedFrom('input', parameters.keys, parameters.rest)})${options})`
        : `${linkedCall}(${JSON.stringify(agentId)}, ${JSON.stringify(handler)}, ${parameters.one}, ${impl}${options})`;
    lines.push(
      ...exportedFunction(handler, local, parameters.declared, [
        `  return ${revived(call, entry.shapes?.result, reviveWire)};`,
      ]),
      '',
    );
  }
  if (passed.length > 0) {
    lines.push(`export { ${passed.join(', ')} } from ${JSON.stringify(alias)};`, '');
  }
  return lines.join('\n');
}

/** The bind module of an interface a consumer grants: the accessor
 * binds one implementor by its agent id, in process when a module
 * implementor is composed here (the generation's table names it),
 * over the wire otherwise. */
export function bindModule(
  interfaceId: string,
  sha: string,
  methods: readonly string[],
  secrets: readonly string[] = [],
  shapes: Readonly<Record<string, WireShapes>> = {},
  declared: WireParameters = {},
): string {
  const accessor = assertName(accessorName(interfaceId), `the accessor of ${interfaceId}`);
  const members = unique(methods).map((name) => assertName(name, `a method of ${interfaceId}`));
  const revives = members.some((name) => shapes[name]?.result !== undefined);
  // The accessor is the module's one export and the methods keep the
  // interface's parameter names: what the module holds for itself (the
  // bound agent's id, the linked load and its namespace, the imports)
  // goes under other names.
  const local = localsOf([
    accessor,
    ...members.flatMap((name) => declared[name]?.parameters ?? []),
  ]);
  const agent = local('agentId');
  const given = local('given');
  const fallback = local('fallback');
  const boundImplementor = local('boundImplementor');
  const load = local('load');
  const namespace = local('namespace');
  const boundInterface = local('boundInterface');
  const wireCall = local('wireCall');
  const linkedCall = local('linkedCall');
  const linkedFunction = local('linkedFunction');
  const reviveWire = revives ? local('reviveWire') : 'reviveWire';
  const wireStub = local('wireStub');
  const linked = local('linked');
  // Every call over the wire names the interface it is bound through and
  // its contract's hash: the implementor answers only when it implements
  // it there, and a name that is not an implementor is refused in words
  // at its first use.
  const binding = local('binding');
  const conformance = local('conformance');
  const stamp = local('stamp');
  // A method whose arguments or answer are secrets records neither, on
  // either road (the contract's mark).
  // A method's arguments ride as the interface declares them: one as
  // itself, several or a rest parameter as one array, spread back into
  // the composed implementor's function on the in-process road.
  const formOf = (
    name: string,
  ): { declared: string; sent: string; arrayed: boolean; picked: string } => {
    const known = declared[name];
    if (known === undefined)
      return { declared: 'input', sent: 'input', arrayed: false, picked: '' };
    const parameters = parametersOf(known);
    return {
      declared: parameters.declared,
      sent: parameters.one ?? parameters.sent,
      arrayed: ridesAsArray(known),
      picked: pickedFrom('wire', parameters.keys, parameters.rest),
    };
  };
  const inProcess = members
    .map((name) => {
      const form = formOf(name);
      const options = secrets.includes(name) ? ', { secret: true }' : '';
      const target = `${linkedFunction}(${agent}, ${namespace}, ${JSON.stringify(name)})`;
      const run = form.arrayed ? `(wire) => ${target}(${form.picked})` : target;
      return `      async ${name}(${form.declared}) { return ${revived(`await ${linkedCall}(${agent}, ${JSON.stringify(name)}, ${form.sent}, ${run}${options})`, shapes[name]?.result, reviveWire)}; },`;
    })
    .join('\n');
  const wired = members
    .map((name) => {
      const form = formOf(name);
      return `    async ${name}(${form.declared}) { return ${revived(`await ${wireCall}(${wireStub}(${agent}, ${JSON.stringify(name)}, ${secrets.includes(name) ? `{ secret: true, bound: ${binding} }` : `{ bound: ${binding} }`}), ${form.sent})`, shapes[name]?.result, reviveWire)}; },`;
    })
    .join('\n');
  const runtime = [
    imported('boundImplementor', boundImplementor),
    imported('boundInterface', boundInterface),
    `call as ${wireCall}`,
    imported('linkedCall', linkedCall),
    imported('linkedFunction', linkedFunction),
    ...(revives ? [imported('reviveWire', reviveWire)] : []),
    `stub as ${wireStub}`,
  ];
  return [
    `// Generated by the platform from the ${interfaceId} interface. Do not edit.`,
    `// ${interfaceId} is an interface: a shared contract many agents implement.`,
    `// ${accessor}(agentId?, fallback?) binds the implementor named, else the one`,
    `// the plane binds as the interface's default, ${interfaceId}/default, else the fallback given.`,
    `import { ${runtime.join(', ')} } from '@cernanto/runtime-lib/calls';`,
    `import { ${imported('linked', linked)}, ${imported('conformance', conformance)} } from '../linked.js';`,
    '',
    `const ${binding} = ${JSON.stringify({ interface: interfaceId, sha })};`,
    '',
    ...exportedFunction(accessor, local, `${given}, ${fallback}`, [
      // The id the caller gave; else the plane's binding for the
      // interface, or the caller's fallback when the plane binds none.
      // The bind is told the implementors of the interface linked into
      // this process, by the table of what each composed module
      // implements: where the plane itself decides the interface, what
      // is installed is what is used.
      `  const ${agent} = ${given} ?? (await ${boundImplementor}(${JSON.stringify(interfaceId)}, ${fallback}, Object.keys(${conformance}).filter((id) => (${conformance}[id] ?? []).some((entry) => entry.id === ${binding}.interface))));`,
      `  const ${load} = ${linked}[${agent}];`,
      `  if (${load} !== undefined) {`,
      // A composed module answers in process only when it implements
      // the interface at the contract this agent binds: the same words
      // the wire's implementor would refuse in.
      `    const ${stamp} = (${conformance}[${agent}] ?? []).find((entry) => entry.id === ${binding}.interface);`,
      `    if (${stamp} === undefined) throw new Error(\`agent "\${${agent}}" does not implement \${${binding}.interface}: a binding through \${${binding}.interface} reaches its implementors alone\`);`,
      `    if (${binding}.sha !== '' && ${stamp}.contractSha !== ${binding}.sha) throw new Error(\`agent "\${${agent}}" implements \${${binding}.interface} at its contract \${${stamp}.contractSha.slice(0, 12)}, not at \${${binding}.sha.slice(0, 12)}, the one its caller binds: a deploy recompiles the agent behind\`);`,
      `    const ${namespace} = await ${load}();`,
      '    return {',
      inProcess,
      '    };',
      '  }',
      `  await ${boundInterface}({ interface: ${JSON.stringify(interfaceId)}, sha: ${JSON.stringify(sha)}, agent: ${agent} });`,
      '  return {',
      wired,
      '  };',
    ]),
    '',
  ].join('\n');
}

/** The assets module: the path of every granted file under `assets/`
 * beside `dist/`, a file grant as one constant, a folder grant as a
 * record keyed by the paths inside it. A granted path is the file's
 * own name; a folder's files carry the folder's name first. */
export function assetsModule(files: readonly string[]): string {
  // The module's exports are named from the granted paths: two grants
  // that read as one export are refused, and what the module imports
  // and holds for itself goes under names none of them takes.
  const grants = new Map<string, string>();
  for (const file of [...files].sort()) {
    const slash = file.indexOf('/');
    const grant = slash === -1 ? file : file.slice(0, slash);
    const name = assetExportName(grant);
    const other = grants.get(name);
    if (other !== undefined && other !== grant) {
      throw new Error(
        `the granted files ${JSON.stringify(other)} and ${JSON.stringify(grant)} both read as the export ${name}`,
      );
    }
    grants.set(name, grant);
  }
  const local = localsOf(grants.keys());
  const dirname = local('dirname');
  const join = local('join');
  const fileURLToPath = local('fileURLToPath');
  const root = local('ASSETS_ROOT');
  const lines = [
    "// Generated by the platform: the paths of the files this agent's specification grants. Do not edit.",
    `import { ${imported('dirname', dirname)}, ${imported('join', join)} } from 'node:path';`,
    `import { ${imported('fileURLToPath', fileURLToPath)} } from 'node:url';`,
    '',
    `const ${root} = ${join}(${dirname}(${fileURLToPath}(import.meta.url)), '..', 'assets');`,
    '',
  ];
  const folders = new Map<string, string[]>();
  for (const file of [...files].sort()) {
    const slash = file.indexOf('/');
    if (slash === -1) {
      lines.push(
        `export const ${assetExportName(file)} = ${join}(${root}, ${JSON.stringify(file)});`,
        '',
      );
      continue;
    }
    const folder = file.slice(0, slash);
    const inner = folders.get(folder) ?? [];
    inner.push(file.slice(slash + 1));
    folders.set(folder, inner);
  }
  for (const [folder, inner] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`export const ${assetExportName(folder)} = {`);
    for (const key of inner) {
      lines.push(
        `  ${JSON.stringify(key)}: ${join}(${root}, ${JSON.stringify(`${folder}/${key}`)}),`,
      );
    }
    lines.push('};', '');
  }
  return lines.join('\n');
}

// The tester task and the test form: the tester's one function runs the
// suite as a child of its call; a test form's mocked edges import
// the mock the tests wrote, statically, beside the stub they replace.

/** The tester task's `dist/index.js`: one function `run` over the
 * runtime's once-only suite. */
export function testerTaskEntryModule(): string {
  return [
    '// Generated by the platform: the tester runs the tests beside it in a child. Do not edit.',
    "import { runSuiteOnce } from '@cernanto/runtime-lib/tests';",
    '',
    'export async function run(input) {',
    '  void input;',
    "  return runSuiteOnce(new URL('.', import.meta.url));",
    '}',
    '',
  ].join('\n');
}

/** The suite runner `dist/suite.js` the tester spawns: the child's
 * whole life is the runtime's, handed the directory and the facts. */
export function suiteRunnerModule(): string {
  return [
    '// Generated by the platform: the suite as a child of the tester. Do not edit.',
    "import { runSuiteChild } from '@cernanto/runtime-lib/tests';",
    '',
    "await runSuiteChild(new URL('.', import.meta.url), JSON.parse(process.argv[2] ?? '{}'));",
    '',
  ].join('\n');
}

/** The stub of a mocked agent in a test form: the mock the tests
 * wrote, compiled to `dist/mocks/<file>.js` beside it, stands in for
 * the agent; each call is traced as a linked call marked mocked, a
 * helper or constant passes straight through. */
export function staticMockStub(
  agentId: string,
  surface: DeclaredSurface,
  mockFile: string,
): string {
  refuseMixed(agentId, surface);
  for (const name of [...surface.functions.map((entry) => entry.name), ...surface.constants]) {
    assertName(name, `an export of ${agentId}`);
  }
  const revives = surface.functions.some(
    (entry) => entry.async && entry.shapes?.result !== undefined,
  );
  const local = localsOf([
    ...surface.functions.map((entry) => entry.name),
    ...surface.constants,
    ...surface.functions.flatMap((entry) => entry.parameters),
    'input',
    'args',
  ]);
  const linkedCall = local('linkedCall');
  const reviveWire = revives ? local('reviveWire') : 'reviveWire';
  const mock = local('mock');
  const lines = [
    `// Generated by the platform: the mock the tests wrote stands in for ${agentId} here. Do not edit.`,
    revives
      ? `import { ${imported('linkedCall', linkedCall)}, ${imported('reviveWire', reviveWire)} } from '@cernanto/runtime-lib/calls';`
      : `import { ${imported('linkedCall', linkedCall)} } from '@cernanto/runtime-lib/calls';`,
    `import * as ${mock} from ${JSON.stringify(`../mocks/${mockFile}.js`)};`,
    '',
  ];
  for (const entry of surface.functions) {
    if (entry.async) {
      // The mock keeps the contract's signature: one plain parameter
      // rides the traced call as itself, several or a rest parameter as
      // one record read back into the mock, and a secret function runs
      // unrecorded.
      const parameters = parametersOf(entry);
      const options = entry.secret ? '{ mocked: true, secret: true }' : '{ mocked: true }';
      const call =
        parameters.one === undefined
          ? `${linkedCall}(${JSON.stringify(agentId)}, ${JSON.stringify(entry.name)}, ${parameters.sent}, (args) => ${mock}.${entry.name}(${pickedFrom('args', parameters.keys, parameters.rest)}), ${options})`
          : `${linkedCall}(${JSON.stringify(agentId)}, ${JSON.stringify(entry.name)}, ${parameters.one}, (args) => ${mock}.${entry.name}(args), ${options})`;
      lines.push(
        ...exportedFunction(entry.name, local, parameters.declared, [
          `  return ${revived(call, entry.shapes?.result, reviveWire)};`,
        ]),
      );
    } else if (RESERVED.has(entry.name)) {
      const declared = local(entry.name);
      lines.push(
        `function ${declared}(...args) { return ${mock}.${entry.name}(...args); }`,
        `export { ${declared} as ${entry.name} };`,
      );
    } else {
      lines.push(
        `export function ${entry.name}(...args) { return ${mock}.${entry.name}(...args); }`,
      );
    }
  }
  for (const constant of surface.constants) {
    if (RESERVED.has(constant)) {
      const declared = local(constant);
      lines.push(
        `const ${declared} = ${mock}.${constant};`,
        `export { ${declared} as ${constant} };`,
      );
    } else {
      lines.push(`export const ${constant} = ${mock}.${constant};`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** The bind of a mocked interface in a test form: every implementor
 * answers with the mock the tests wrote. */
export function staticMockBind(
  interfaceId: string,
  methods: readonly string[],
  mockFile: string,
  secrets: readonly string[] = [],
  shapes: Readonly<Record<string, WireShapes>> = {},
  declared: WireParameters = {},
): string {
  const accessor = assertName(accessorName(interfaceId), `the accessor of ${interfaceId}`);
  const names = unique(methods).map((name) => assertName(name, `a method of ${interfaceId}`));
  const revives = names.some((name) => shapes[name]?.result !== undefined);
  // The methods keep the interface's parameter names: the bound agent's
  // id and the imports go under other names.
  const local = localsOf([accessor, ...names.flatMap((name) => declared[name]?.parameters ?? [])]);
  const agent = local('agentId');
  const given = local('given');
  const fallback = local('fallback');
  const linkedCall = local('linkedCall');
  const reviveWire = revives ? local('reviveWire') : 'reviveWire';
  const mock = local('mock');
  // A method takes the arguments the interface declares, as the bind
  // does: one as itself, several as the record keyed by their names,
  // spread back into the mock's function, so the tests exercise the
  // road the implementor is called on.
  const members = names
    .map((name) => {
      const known = declared[name];
      const parameters = known === undefined ? undefined : parametersOf(known);
      const declaredForm = parameters?.declared ?? 'input';
      const sent = parameters === undefined ? 'input' : (parameters.one ?? parameters.sent);
      const run =
        parameters !== undefined && ridesAsArray(known)
          ? `(wire) => ${mock}.${name}(${pickedFrom('wire', parameters.keys, parameters.rest)})`
          : `(wire) => ${mock}.${name}(wire)`;
      return `${name}: async (${declaredForm}) => ${revived(`${linkedCall}(${agent}, ${JSON.stringify(name)}, ${sent}, ${run}, ${secrets.includes(name) ? '{ mocked: true, secret: true }' : '{ mocked: true }'})`, shapes[name]?.result, reviveWire)}`;
    })
    .join(', ');
  return [
    `// Generated by the platform: the mock the tests wrote stands in for ${interfaceId} here. Do not edit.`,
    revives
      ? `import { ${imported('linkedCall', linkedCall)}, ${imported('reviveWire', reviveWire)} } from '@cernanto/runtime-lib/calls';`
      : `import { ${imported('linkedCall', linkedCall)} } from '@cernanto/runtime-lib/calls';`,
    `import * as ${mock} from ${JSON.stringify(`../mocks/${mockFile}.js`)};`,
    '',
    // A call without an id runs the mock as well, recorded under the id
    // given, else the fallback, else the interface's own id.
    ...exportedFunction(accessor, local, `${given}, ${fallback}`, [
      `  const ${agent} = ${given} ?? ${fallback} ?? ${JSON.stringify(interfaceId)};`,
      `  return { ${members} };`,
    ]),
    '',
  ].join('\n');
}

/** The package name a module's bytes are placed under inside a
 * carrier's node_modules: the artifact package name of its id, the
 * name the compiler links a module's siblings under as well. */
export function composedPackageNameOf(agentId: string): string {
  return `cernanto-agent-${stubFileName(agentId)}`;
}

/** A composed module's conformance stamps: each interface it
 * implements with the contract hash its compile stamped. */
export type ConformanceStamps = Readonly<
  Record<string, readonly { id: string; contractSha: string }[]>
>;

/** The table of the modules composed into a generation: each id with
 * a lazy import of its package, and beside it what each implements
 * with the contract hash its compile stamped, so a bind answers in
 * process only for an implementor of its interface. Written empty when
 * a package is materialized and rewritten with the ids once its modules
 * are placed (materialize-package.ts, finishComposition). */
export function linkedTableModule(ids: readonly string[], stamps: ConformanceStamps = {}): string {
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  const rows = sorted.map(
    (id) => `  ${JSON.stringify(id)}: () => import(${JSON.stringify(composedPackageNameOf(id))}),`,
  );
  const conformance = sorted.map(
    (id) => `  ${JSON.stringify(id)}: ${JSON.stringify(stamps[id] ?? [])},`,
  );
  refuseComposedCollisions(ids);
  return [
    '// Generated by the platform: the modules composed into this generation. Do not edit.',
    'export const linked = {',
    ...rows,
    '};',
    'export const conformance = {',
    ...conformance,
    '};',
    '',
  ].join('\n');
}
