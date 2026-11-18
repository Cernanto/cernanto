# Compile Gates

Type: module

Uses:
- cernanto/compile/contract
- npm:typescript
- npm:execa
- npm:fs-extra
- file:gates/assets/

Certify a workspace's final state for the compiler: emit the entry,
type-check it with its contract emitted, scan the sources, verify the
declared kind, and hold the emitted contract to the interfaces the
agent implements, to the names that left its surface, to the mocks a
tester lists and to the contract the compile must keep. The results
feed the verdict, the report and the provenance. Every document this
module takes rides in as the path of a file (the spec, the implemented
interfaces' contracts, the contract to keep); it reads them itself,
and a file it cannot read is a terminal failure of the operation, an
error thrown with `<field>: there is no readable file at <path>`. The words of
every finding live in the granted file `gate-words.json`: a catalog by
code of a message and an optional hint with named `{{slots}}`, filled
through the contract module's finding-words function; a finding names
its code, the severity `error`, the agent id, the message, the line
and the hint.

A gate answers its name, whether it passed, its output (a failed
gate's output is the exact report a session is resumed with) and,
when it ran inside the battery, how long it took in milliseconds.

## The battery

The battery (`runCodeGates`) reads no spec: the granted packages (the
scan's import allowlist, by package name) and whether files are
granted are handed in as data, and so is the agent's type. The entry
emission takes the same data.

Step 1, THE ORDER. For an interface: the shape gate, then the
type-check. For every other type: the entry emission (a failure ends
the run), then the type-check, then the determinism scan, which runs whatever the
type-check found (it reads the sources, so a session hears every
refusal at once: a type error and a forbidden import in the same
report), then, only when the type-check passed,
the kind verification; a worker's one program is the plane's entry;
then, when every gate so far passed and the agent implements
interfaces, the coverage gate; then, when every gate so far passed
and removed names were handed in (`removedSurface`: the function
names that left the document or the interfaces the agent implements,
handed in as data like the rest), the surface gate; then, when every
gate so far passed and mocks were handed in (`mocks`: the agents a
tester's target lists under `Mocks:`, each with its contract's
path), the mocks gate; then, when every gate so far passed and a
contract to keep was given, the anchor gate. Each gate of the battery
is stamped with its duration, EXCEPT the anchor gate, which runs
after the timed battery and carries none.

Step 2, THE TYPE-CHECK'S CHILD. THE CHECKER is the typescript this
module is granted and scans with, found by Node's own lookup from this
module's code and handed in by nobody: `import.meta.resolve` of
`typescript/package.json` names that package's own `package.json`, and
its command file is `bin/tsc` in the folder that holds it; found once,
at the first call that needs it, and kept for the life of the process;
a checker that cannot be found fails the call terminal with exactly
`the gates module cannot find its own typescript`. `typescriptVersion`
answers the `version` in that `package.json`, `unknown` when it cannot
be found or read: what the provenance records for the checker. The
type-check runs that command file, under the granted process package, as `node
<that file> -p <the view's configuration path>` with the workspace as
the working directory; its standard output and error, joined and
trimmed, are the gate's output (the child's own failure words when it
left no output and failed), and the gate passes when the command
exits 0. The rest of the battery runs in this process.

## The entry emission

The coder writes plain exported functions; the module wires the
definition in an emitted entry the coder never sees
(`runEntryEmission`).

Step 1, THE INDEX MODULE: `src/index.ts` when it exists, else
`.cern/src/index.ts` (the tester's emitted entry). Missing, the gate
fails: `src/index.ts is missing: it is the agent's public surface,
and the compile wires the definition from its exported functions`.

Step 2, THE HANDLERS: every exported function declaration of the
index that returns a promise (`async`, or annotated `Promise<...>`,
an ambient `declare function` included) and every exported `const`
whose initializer is an async or promise-annotated function
expression or arrow, or whose declared type is a function type
returning a promise, in declaration order, each name once. A
synchronous export is a helper. `handlersFromSource` answers them for
an index file's path, nothing when the file does not exist.

Step 3, THE COUNT RULES:

- a worker exports exactly one function: none fails with `a worker
  is one program: src/index.ts exports exactly one function (any
  name), and the plane runs it`; more than one with `a worker is one
  program: src/index.ts exports exactly one function, and it exports
  <n> (<the names, comma-separated>); keep the program and unexport
  the rest`;
- any other type with no handler fails: `src/index.ts exports no
  functions: every exported function is a handler of this agent, so
  export one per handler the specification names`;
- a service exporting `run` fails: `a service may not export a
  handler named \`run\`: the platform runs the agent as a program
  under that name; pick another name` (a tester is a task, and its
  `run` is its own wire handler);
- an exported function declared with several signatures, one that
  returns a promise and one that does not, fails: `<name> is declared
  both ways, with a promise and with a plain answer: a handler
  answers a promise and a helper a plain value, so make it two
  functions` (the signatures are its overload declarations, the one
  that carries the body left out).

The problems, one per line, are the failed gate's output.

Step 4, THE EMITTED ENTRY, written to `.cern/src/main.ts`, exactly:

- a worker: the header line `// Generated by the platform; wires this
  agent's definition. Do not edit.`, then `import type { Definition }
  from '@cernanto/runtime-lib';`, `import { <program> } from
  './index.js';`, a blank line, `export const agent: Definition = {
  kind: 'worker', handlers: { run: <program> } };`, a final newline;
- any other type: the same header, the Definition type import, then
  `import { <the handlers, comma-separated> } from './index.js';` (or
  `import './index.js';` with none), a blank line, `export const
  agent: Definition = { kind: '<the type>', handlers: { <the handlers,
  comma-separated> } };` (the kind `service`, `task`, `job` or
  `module`), a final newline; the definition carries its handlers and
  nothing else (an agent's retention, recording and effect limits are
  the runtime's rules by kind).

The passed gate's output is `wired <the handlers, comma-separated>`
(a worker: `wired <program> (the program)`).

## The interface shape

An interface compiles to a contract and nothing else
(`runInterfaceShape`). The gate reads the handlers of the index module
as above; none fails: `src/index.ts must declare the functions of this
interface (\`export declare function send(to: string, subject: string,
body: string): Promise<void>;\`, one per function), and nothing else`.
Then every `.ts` under `src` (recursively, `.d.ts` excluded) is held
to declarations only: interface and type alias declarations, function
declarations without a body, `declare` variable statements, `import
type` and `export type` pass; `<file name>` below is the file's own
name (`index.ts`, `x.ts`); a value import fails `<file name>: an
interface may import types only (\`import type ...\`); it has no
runtime to import into`; a value re-export fails `<file name>: an
interface may re-export types only (\`export type ...\`); it ships a
contract, never code`; anything else fails `<file name> line <n>: an
interface is a contract with no body; only ambient function
declarations (\`export declare function ...\`), interfaces, type
aliases and type-only imports/exports belong here (a function body or
a value makes it a module, and helpers belong to implementors)`.
Problems join by newline as the output. Passing removes
`.cern/src/main.ts` (an interface has no entry to type-check) and
answers `declared <the handlers, comma-separated>`.

## The compile view and the type-check

The merged compile view (`prepareBuildView`) is `.cern/compile/src`:
emptied, then the coder's `src` copied whole except the declaration
twins (a `.d.ts` whose executing source exists at the same relative
path under `.cern/src`), then `.cern/src` copied over it; the
workspace's `tsconfig.json` copied to `.cern/compile/tsconfig.json`
with `outDir` `../../dist`, `declarationDir` `../../types` and
`include` `["src", "../platform.d.ts"]` (`["src"]` when
`.cern/platform.d.ts` is absent); the workspace's `dist` and `types`
removed. The coder's imports of granted packages stay exactly as
written. The view's configuration path, relative to the workspace, is
`.cern/compile/tsconfig.json`.

The type-check gate (`runTsc`), named `tsc`, prepares the compile view
from the sources as they are NOW (a view left by an earlier attempt
is replaced), runs the task gate over it first (a refusal is the
type-check's failure with the task gate's words), then the child of
the battery's step 2. Every occurrence of `.cern/compile/src/` in the
output reads `src/`, and `.cern/compile/` disappears, so a diagnostic
names the coder's file.

## The determinism scan

The scan (`runDeterminism`), named `determinism`, walks every `.ts`
under `src` recursively, skipping the `mcp`, `agents` and `openapi`
directories at the top and every declaration twin; each file's
findings are prefixed `<path relative to the workspace>: ` on the
message; the output is one line per finding, `<code> line <n>:
<message>`; the findings ride the gate as its `issues`, ALWAYS
present, an empty list when there are none; and the gate passes with
none. The purity scan answers the same shape. `scanSource` scans one
file for a caller composing its own battery.

Scanning one file (a granted-package list, whether files are
granted, the synchronous names the workspace's generated modules
re-export straight from their packages, and THE LANE HOSTS when
given, `laneHosts`: the hosts of every granted openapi document, the
grant url's host and each of the document's servers' hosts, and of
every granted mcp server's url, each with the relative specifier of
the module the lane generated for it, `./openapi/<name>.js` or
`./mcp/<name>.js`):

- the durable locals: every name imported by name from
  `@cernanto/runtime-lib` that is `call`, `sleep` or `now`, and
  every name imported by name from a
  generated module (a relative specifier ending in `agents/<x>.js`,
  `mcp/<x>.js`, `openapi/<x>.js` or `os.js`), except the os module's
  identity functions (`agentId`, `caller`, `callId`, `substrateUrl`:
  synchronous observations) and except a re-exported synchronous
  helper; the
  names from generated modules are the module locals;
- CE221: inside a `step(...)` call's arguments after the first, a
  durable local used other than as a property name; the words `CE221`
  for a module local, `CE221.2` otherwise, slot `name`;
- CE241: an exported declaration of the index (a type alias, an
  interface, an exported `const`'s declared type, or an exported
  function's parameter or result type) that names an identifier
  imported from a generated agents module (a relative specifier ending
  in `agents/<x>.js`: a dependency's types), DIRECTLY OR THROUGH THE
  UNEXPORTED TYPES IT REACHES (an exported interface naming an
  unexported alias that names the import is the finding, under the
  exported declaration's name), slot `name` the declaration's name and
  slot `imported` the identifier, once per exported declaration; a
  contract stands alone, so the shape is declared again in this
  agent's own sources under a name of its own, and an unexported
  helper function may name the import freely;
- imports and re-exports, every `import`, `export ... from` and
  static `import(...)`: a relative specifier passes; for a task, a
  job or a module, `node:child_process`, `node:fs` and
  `node:fs/promises` pass at once (the asynchronous child commands
  and the local filesystem are theirs; a service's and a worker's
  source may use the granted-file read subset alone); for a job,
  `node:os` passes at once as well (the facts of the machine it runs
  on are a job's to read); `node:crypto`
  (always), `node:sqlite` (always) and `node:fs`/`node:fs/promises`
  (when files are granted) are checked by MEMBER: an opaque form (a
  default or namespace import, a bare `export *`) is `CE202` with the
  words `CE202.opaque.<specifier>`, a bound name outside the subset
  (`node:crypto`: `createHmac`, `createHash`, `timingSafeEqual`,
  `createCipheriv`, `createDecipheriv`; `node:sqlite`: `DatabaseSync`;
  `node:fs`: `readFileSync`, `statSync`, `readdirSync`,
  `createReadStream`; `node:fs/promises`: `readFile`, `stat`,
  `readdir`) is `CE202` with `CE202.member.<specifier>` slot `name`,
  a type-only form passes; the runtime package
  (`@cernanto/runtime-lib`, any `@cernanto/runtime-lib/` subpath) is
  `CE223` unless it is `@cernanto/runtime-lib/tests`; `zod` passes;
  `node:buffer`, `node:events`, `node:path`, `node:querystring`,
  `node:url`, `node:util`, `node:http`, `node:https` pass; in a
  `.test.ts` file `node:test`, `node:assert`, `node:assert/strict`,
  `node:http`, `node:net`, `node:stream` pass too; any other `node:`
  specifier is `CE201` (slot `specifier`; for `node:fs` and
  `node:fs/promises` the code stays `CE201` and the WORDS are the
  catalog's `CE201.2` entry: a finding's code is always the bare
  `CE<number>`, and a dotted catalog key names a wording of it)
  unless type-only; a package whose name (the first segment, two for
  a scope) is granted passes, with ONE exception, `CE235`: a
  NAMESPACE form of it (`import * as x from '<it>'`, `export * as x
  from '<it>'`; a type-only form passes) when the package is COMMONJS
  (a CommonJS namespace carries the names Node finds by reading the
  entry file alone, so a member made at run time reads `undefined`;
  the default import and a named import pass). Whether a granted
  package is CommonJS is read off its installed manifest,
  `node_modules/<the package name>/package.json`, looked for from the
  scanned file's folder upward to the workspace, parsed as JSON: it
  is ESM, and passes, when its `type` is `module`, or its `main` ends
  in `.mjs`, or its `exports` answers an `import` condition for the
  package root (`exports` itself an object carrying the key `import`,
  or its `.` entry an object carrying `import`, looked for through
  nested condition objects); it is CommonJS otherwise; a manifest
  that is absent or does not parse judges nothing and the import
  passes. Slots `specifier` (as written) and `name` (the local name
  the namespace is bound to); anything else is `CE200` (slots
  `specifier` and `specifier2` = the package name);
- CE216: a dynamic import with a computed specifier;
- CE242: a call of a module local (a name imported from a generated dependency module, or a member reached through one) at the top level of a file, outside every function body, arrow function, method and class body: a call outside every handler has no journal and no identity to carry (a module's would run as its consumer); slot `name` (the local's name as written); the finding at the call's line;
- CE214: any `require(...)` call;
- CE232: `debuglog('<section>')` with a section other than `agent`,
  slot `section`;
- CE215: any property access on `process`, but, in a job's source,
  `process.pid` and `process.kill` (a job asks after the processes it
  runs and ends them through Node's own call, on every system alike);
- CE236, when the lane hosts are given: every string literal and
  template literal in the file whose text carries an `http://` or
  `https://` url whose host is one of the lane hosts (the host
  compared case-insensitively, with or without its port, the text's
  first such url the one reported): a granted api is reached through
  its module alone, and a url of it written into the code reaches it
  around the module, unjournaled and unsecured; slots `host` and
  `specifier` (the module's); the finding at the literal's line;
- for the agent's own module (`src/index.ts`): CE233 for every
  exported function declaration without a TSDoc comment (slot `text`
  = the name), and CE234 when the file imports a generated dependency
  module (an `agents/`, `mcp/` or `openapi/` specifier) or a granted
  package by value and never calls `debuglog(`, the finding placed at
  the line of the file's FIRST statement (whatever it is), 1 for an
  empty file;
- THE ORDER of a file's findings is the order the scan meets them:
  the import, call and `process` findings as one walk of the syntax
  tree visits them (source order), then, for the agent's own module,
  CE233 per exported function in declaration order, then CE234 last.

The synchronous names the generated modules re-export are read off
every `.ts` directly under `.cern/src/agents|mcp|openapi` and
`src/agents|mcp|openapi`: the non-type names of every `export { ... }
from '...'` clause.

## The purity scan


## The task gate

A task keeps no state across calls (`runTaskGate`). For any other
type the gate passes with no words, a job among them: a job keeps
memory for the life of its process, by the language. For a task, over
the compile view (`.cern/compile/src`; absent, the gate passes): a
program of every `.ts` under it (the granted typescript, `strict`,
NodeNext, ES2023, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `skipLibCheck`, no emit); the coder's
files are those with no executing source at the same relative path
under `.cern/src` and not `.d.ts` or `.test.ts` (none, the gate
passes). Every module-scope variable declaration of a coder file is
classified by its type:

- plain data (a primitive, null, undefined, a union or intersection
  of plain data, a Map or Set or array of plain data, a plain object
  whose properties and string index are plain data; a class, a
  callable or constructable, a Date, a Promise or a RegExp is live) is
  MEMORY, except a `const` of a primitive type (a constant) and a
  `const` the program only ever READS as a lookup table; `any`,
  `unknown` and a type parameter are process-local and pass; a class
  instance declared by the coder's own files (`class Store { ... }`)
  is refused with the words `task.class` (slot `name`); any other
  live type is process-local when `const`, refused as memory
  otherwise;
- memory is refused with the words `task.constant` for a `const` and
  `task.memory` otherwise (slot `name`), one line per variable, the
  lines joined by newline as the output;
- a lookup table: every reference (in every coder file, through an
  import alias too; the names inside import and export clauses are
  not references) is a pure read: the root of a property or element
  access chain (parentheses and type assertions looked through) that
  is neither assigned, updated with `++`/`--`, nor deleted; a method
  called through the chain on a primitive receiver; a membership
  method called on the table itself (`has`, `includes`, `indexOf`,
  `lastIndexOf`, `join`); a content method on the table itself
  (`get`, `at`, `find`, `findIndex`, `some`, `every`, `forEach`,
  `map`, `filter`, `flatMap`, `slice`, `concat`, `entries`, `keys`,
  `values`) when the contents are frozen data; `Object.keys(table)`;
  `Object.values` and `Object.entries` when every value type is
  frozen; a bare reference when the table's own type is frozen data,
  or when it is spread or iterated with `for...of` and the contents
  are frozen; `typeof TABLE` in type position; a property or element
  read whose value type is frozen data;
- frozen data: a primitive; a readonly tuple or readonly array of
  frozen data; an object type with no signatures, no index
  signature and at least one property, every property a unit type (a
  literal, a literal union, null, undefined) or frozen data; looked
  at two levels deep.

## The kind verification

The gate (`verifyAgentKind`), named `type-verify`, loads the compiled
code in a disposable child: the granted process package runs `node
--input-type=module -e <script>` with the workspace as the working
directory, a timeout (the one handed in, else 30000 milliseconds)
that kills with SIGKILL; the script imports `<workspace>/dist/main.js`
as a file url, prints one line `cernanto-kind:` followed by the JSON
of `{ kind: <the definition's kind, or null when the module exports
no agent> }`, and exits 0 by itself (a standing channel started at
module scope keeps the loop alive otherwise). A run ended by the
signal fails: `the compiled code did not finish loading within
<timeout>ms; suspect top-level work or an endless loop at module
scope`; a non-zero exit fails: `the compiled code could not be
loaded: <the first 1000 characters of the trimmed standard error>`;
the verdict is the LAST marked line of the standard output
(module-scope narration shares it); a missing or null kind fails:
`the compiled code does not export "agent" with a definition`;
otherwise the gate passes when the kind equals the expected type,
with the output `kind <kind>`, and on a mismatch fails with `the
spec says <expected type> but the compiled code defines <kind>`.

## The coverage, the surface, the mocks and the anchor

The coverage gate (`runImplementsCoverage`), named `implements`: the
emitted contract is `types/index.d.ts` (absent, the gate fails: `no
contract declarations were emitted, so the implemented interfaces
cannot be covered`); its siblings are every other `.d.ts` under
`types`, recursively, keyed by the path relative to `types` with `/`
(`readContract` and `contractSiblingsOf` answer the two); for each
implemented interface in id order, the contract module's coverage
gaps of the emitted contract against the interface's contract with
the siblings; a gap list fails with the text `the emitted contract
does not cover the interface <id> this agent implements:` then one
`- <gap>` line each, then `The interface contract to cover,
verbatim:` and the interface contract on the next line; failures join
by a blank line. With no gap the gate passes with an EMPTY output.

The surface gate (`runSurfaceGate`), named `surface`: for each
removed name handed in, in sorted order, an exported function of the
emitted contract bearing it is the line `the function \`<name>\` left
the document or the interfaces this agent implements; remove its
export and its code`; the lines, one per such name, are the gate's
output and the gate fails; with no such export the gate passes with
an EMPTY output.

The mocks gate (`runMocksGate`), named `mocks` (its runs carry that
name as every gate's runs carry theirs), holds a tester's mocks to
the agents they stand for, in the id order of the mocks handed in. A
mock is the file `src/mocks/<the id's stub file name>.ts` (the
contract module's stub file name for the agent id). First the files:
a listed id with no such file is the finding `CE239` (slots
`agentId`, `file`); a `.ts` file directly under `src/mocks` that is
no listed id's file is `CE239` with the words of `CE239.2` (slot
`file`); the failures, one per line, are the gate's output and the
gate fails. Then, with every file in place, the coverage of each
mock: its emitted declarations are `types/mocks/<the stub file
name>.d.ts` (absent, the gate fails with `the mock of <id> emitted no
declarations (types/mocks/<name>.d.ts)`), its siblings every other
`.d.ts` under `types` keyed as the coverage gate keys them, and the
contract module's coverage gaps of the mock's declarations against
the mocked contract's text with those siblings; a gap list fails with
the words of `CE240` (slot `agentId`) followed by one `- <gap>` line
each, then `The contract to cover, verbatim:` and the mocked contract
on the next line; failures join by a blank line. A mock may export
more than the contract (a sync helper the tests read is a helper);
it covers every member of it. With no gap and every file in place
the gate passes with an EMPTY output.

The anchor gate, named `contract`, runs only when a contract to keep
was given, it does not re-export from a relative file (`from './` or
`from '../`), and the emitted contract exists: when the contract
module's same-contract reading (the emitted contract, the kept one,
the siblings, no options) says they match, no gate is answered;
otherwise the gate fails with `the emitted contract drifts from the
previous contract this compile must keep: <the drift lines, their
leading "- " removed, joined by "; ">`, a newline, the drift lines as
given, a newline, `Keep every exported name, property spelling and
optionality exactly as the previous contract states (docs and file
layout are yours): fix the VALUES your code assigns, never the
declarations above. The contract to keep, verbatim:`, a newline, and
the contract module's anchor rendering of the kept contract.

## The functions the coder named

The compile's size rule asks the gates module how many functions a
coder named across the sources it is handed. `namedFunctions` takes
the sources, a list of `{path, text}`, and answers one number: the
function declarations, the methods of classes and of object literals,
and the variables and properties whose value is a function or an
arrow function (looked through parentheses, `as` and `satisfies`), at
any depth, read off the TypeScript syntax tree the scans read; a
function passed unnamed as an argument is left out, and so is
everything in a declaration twin (`.d.ts`).

## Tests

Uses: npm:fs-extra

A source that calls a generated dependency's function at its top level
(`const first = await getMany(['a']);` under the imports) is CE242
naming the local, and the same call inside an exported function passes.
THE FUNCTIONS THE CODER NAMED: a source with a function declaration, a
class with one method, a `const` holding an arrow function and a call
that passes an unnamed arrow counts three.
A JOB'S OWN OF NODE: in a job's source `process.pid`, a call of
`process.kill` and an import of `node:os` pass, and `process.env` is
CE215 there as everywhere; the same three in a task's source are CE215
twice and CE201 naming `node:os`.

Every gate works on a workspace the test writes in a temporary folder
with the granted file package: `src/index.ts` and the other sources,
`.cern/src` for the emitted overlay when a test needs one,
`tsconfig.json` (the compiler's workspace configuration:
`{"compilerOptions": {"strict": true, "module": "nodenext",
"moduleResolution": "nodenext", "target": "es2023", "lib":
["es2023"], "declaration": true, "isolatedDeclarations": true,
"exactOptionalPropertyTypes": true, "noUncheckedIndexedAccess":
true, "verbatimModuleSyntax": true, "skipLibCheck": true, "rootDir":
"src", "outDir": "dist", "declarationDir": "types"}, "include":
["src"]}`), a `package.json` of `{"type": "module"}` (the type-check's
NodeNext resolution reads a `.ts` file as CommonJS otherwise and
refuses its exports) and, for a type-check, `node_modules` links to the
platform libraries the tests' own code runs with, `@cernanto/runtime-lib`,
`zod` and `@types/node`, each found by Node's own lookup from the tests'
code (`import.meta.resolve` of `<the name>/package.json`, the folder
that holds the file) and linked under its name. The type-check runs the
module's own checker; the tests hand it none. The granted packages handed to
a gate are the names the test states; the words of a finding are read
from the granted catalog and compared whole after filling their
slots. An
index fixture that reaches a granted package declares the debug
section (`debuglog('agent')` from node:util), or CE234 is its
finding, by the scan's own rule. A compiled module that never finishes
loading spins synchronously at module scope (`for (;;) {}`): a
pending promise at the top level drains the loop and node exits by
itself, which is the could-not-be-loaded outcome, not the timeout.
A workspace whose source fails the type-check and imports a forbidden
module reports both gates in one battery, the type-check's failure
and the scan's refusal, and runs no kind verification.
An index whose exported interface names a type imported from
`./agents/x.js` (`import type { A } from './agents/x.js'; export
interface B { a: A }`) and one whose exported alias renames one
(`export type C = A;`) are CE241 each, the finding naming the
declaration and the identifier; one that reaches it through an
unexported type (`type Inner = { a: A }; export interface B { inner:
Inner }`) is CE241 under `B`, and two such exported declarations in
one index are two findings of one run; while the same import used by
an unexported helper function alone passes.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
