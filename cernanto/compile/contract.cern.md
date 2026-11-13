# cernanto/compile/contract

Type: module

Uses:

- npm:typescript
- npm:fs-extra

Read, compare and generate contracts for the compiler. A contract is a
TypeScript declaration text: the exported functions of an agent with
their argument and result types and the TSDoc that teaches them,
beside the exported interfaces, type aliases and enums those
signatures name. Given such texts, read their handlers and helpers,
compare two of them structurally, flatten a root that re-exports from
sibling files into one self-contained text, and generate the modules
a consumer's workspace holds for its grants: the dependency stub of a
service or a module, the bind module of an interface, the os module
of an agent type and the assets module of a set of granted files.
Everything is text in and text out, and every text is parsed with the
TypeScript compiler's own parser (the granted package); the two
readers that use a pattern are named below.

## Reading a contract

A contract's HANDLERS are its exported functions that return a
promise: an `export declare function` whose return type is
`Promise<...>`, and an exported const whose type is a function type
returning one. A declaration with no return annotation at all is read
as a promise-returning one. A synchronous exported function is a
HELPER: consumers call it directly. Each handler is answered with its name, its signature text verbatim (type
parameters included), the name of its first parameter when it has
one, its argument type text (`unknown` when it takes none), its
awaited result type text (the type argument of `Promise<...>`, else
the declared type as written, `unknown` when absent), the names of the
types the signature references that the contract itself declares at
top level or re-exports (sorted, the handler's own type parameters
excluded), and its documentation, the exported function's JSDoc.
Handlers are answered
in declaration order, a name once (`parseHandlersFromContract`).

A JSDoc block is read as the last `/** ... */` comment immediately
before a declaration, re-indented to top level: the first line
trimmed, every following line that starts with `*` prefixed with one
space, any other line trimmed.

`contractFunctions` answers the functions a contract declares as a
plain list, each with its name, its documentation when it has one,
and whether it returns a promise (the same lenient rule), in
declaration order. `exportedFunctionNames` answers the names of a
contract's callable exports, once each in declaration order, read
with the pattern of an `export`, optionally `declare`, optionally
`async`, `function` and an identifier at a line's start;
`exportsIndexLine` is the one-line index a prompt prints above a
contract: `exports: ` followed by those names joined with `, ` and a
newline, or the empty string when the contract declares no function.

## Comparing contracts

Two contracts promise the same surface when their comparable texts
are equal (`sameContract`; `contractTextOf` answers the comparable
text). The comparable text of a contract has three lines. The first
is its named TYPES: every exported interface, type alias and enum the
root declares, plus the ones its `export ... from './x.js'` lines pull
from sibling declaration files (a specifier names its file by its
path with the leading `./` removed and a `.js`, `.ts` or `.d.ts`
suffix replaced by `.d.ts`, a path with no such suffix gaining
`.d.ts`, so `./agents/x.js` names `agents/x.d.ts` and `./helpers`
names `helpers.d.ts`, and the siblings are keyed by exactly that;
`export *` pulls every type the sibling declares; a named re-export
pulls that type; a re-exported name the sibling declares as a
function or a value belongs to the surface lines below and is no
type; a name the sibling does not declare at all, a renamed
re-export, or a sibling the caller did not provide stays in the
comparison as the raw export line); the texts sorted by name and joined, every `/** ... */` comment
removed, and every run of whitespace, semicolons and commas removed.
The second line is the HANDLER surface: each handler's name and
canonical signature joined as `name=canonical`, sorted by name and
separated by `|` (`contractHandlers` answers the handlers by name,
each with its readable signature and its canonical form). The third
line is the HELPER surface, the synchronous exported functions the
same way and the declared constants as `<name>: <type>` (a
function-typed constant excluded; the type is the annotation as
written, or, for a constant declared by an initializer, `export
declare const PROTOCOL = 0;`, the initializer's text, so `PROTOCOL:
0`; `contractHelpers` answers them by name). A function declared with
several signatures has as its canonical signature each overload's
canonical form, in declaration order, joined by ` | `, so a removed,
added or changed overload moves it (a removal breaking, an addition
compatible, as the classifier reads them). A canonical signature
keeps the name, the type parameters as written, the parameters with
their NAMES erased (`p0`, `p1`, a `?` kept for an optional one) and
their type texts verbatim (`unknown` for an untyped one), and the
return type as written (`void` when absent), then folds whitespace,
semicolons and commas away; a signature the parser cannot read falls
back to its text with comments removed and the same folding, so
`send(input: SendArgs)` and `send(args: SendArgs)` cover each other.
The handler and helper surfaces are read through the sibling files
as well: when siblings are given, the root is flattened with them
first.

The DRIFT between an emitted contract and the one it must keep
(`contractDrift`) is one readable line per difference, in this order
and with exactly these words, a type or signature shown with its
comments removed and its whitespace folded to single spaces:

- `- the function "<name>" is missing from the emitted contract; the
  previous contract declares it as: <signature>`
- `- the function "<name>" differs: the emitted contract declares
  <emitted signature> where the previous contract declares <previous
  signature>`
- `- the function "<name>" is exported but the previous contract has
  no such function`
- the same three for a helper, with the word `helper` in place of
  `function`
- `- "<name>" is missing from the emitted contract; the previous
  contract declares it as: <declaration>`
- `- "<name>" differs: the emitted contract declares <emitted
  declaration> where the previous contract declares <previous
  declaration>` (a declaration compared with its comments removed and
  whitespace, semicolons and commas folded away, and the members of an
  interface or an object type taken as a set, in any order: two
  declarations whose members agree member for member are the same
  whatever their order)
- `- "<name>" is exported but the previous contract has no such
  declaration`

The functions come first, then the helpers, then the types, each
group in the kept contract's order followed by the emitted contract's
extras. Two contracts that compare the same have no drift lines.

The CHANGE CLASS between a previous and a next contract
(`contractChange`, and `diffContracts` the same answer at once) is
`none` when their texts are identical, byte for byte; `breaking` when
a previous handler is missing from the next, or its argument or
result type text differs, or any exported interface or type alias a
previous handler's argument or result type names, transitively by
name through the declarations' texts, changed its folded text or
disappeared (a text is folded with every comment, block and line,
removed and whitespace folded to single spaces, and the members of an
interface or an object type sorted by name, so a member's order
counts for nothing); and `compatible` otherwise: additions, and a
change of the comments or the whitespace alone, are compatible.

## Coverage, clashes and the anchor

An implementor's COVERAGE of an interface (`coverageGaps`, the family
gate's question) answers one sentence per gap, in this order: for
every handler the interface declares, `the interface declares the
function \`<signature>\` and the emitted contract does not export it;
export it exactly as declared` when the implementor has no handler of
that name, or `the function \`<name>\` drifts from the interface: the
interface declares \`<interface signature>\` and the emitted contract
declares \`<emitted signature>\`` when the canonical signatures
differ; then for every type the interface declares, `the interface
contract re-exports from a file
this compile cannot see (<the export line>); an interface contract
must be self-contained` for an unresolved re-export, `the interface
declares the type \`<name>\` and the emitted contract does not;
declare it exactly as the interface does` when the implementor lacks
it, and, when the declarations differ, one sentence per difference,
decided member by member: a member is read by its name, its
optionality and its folded type, the members of an interface or an
object type are a set, so the same members in any order are no
difference and no gap, and a declaration that is no object, a union
or an alias, differs by its folded text; `the type \`<name>\` drifts
from the interface's declaration: the member \`<member>\` is missing;
declare it as the interface does` for a member the interface declares
and the emitted contract lacks, `the type \`<name>\` drifts from the
interface's declaration: the member \`<member>\` is extra; the
interface does not declare it` for one the emitted contract adds,
`the type \`<name>\` drifts from the interface's declaration: the
member \`<member>\` is \`<emitted>\` where the interface declares
\`<declared>\`; keep its spelling, optionality and type as the
interface declares them` for one that differs, and `the type
\`<name>\` drifts from the interface's declaration: \`<emitted>\`
where the interface declares \`<declared>\`` for a declaration that
is no object. Extras beyond the interface count for nothing.

The CLASHES between several interfaces one agent implements
(`interfaceDeclarationClashes`), taken in id order, name every type
two interfaces declare with different folded declarations (`the
interfaces <a> and <b> both declare the type \`<name>\` with
different shapes; one flat contract cannot cover both`) and every
handler two declare with different folded signatures (`the interfaces
<a> and <b> both declare the function \`<name>\` with different
signatures; one flat contract cannot cover both`); identical
declarations agree.

The ANCHOR a coder is handed for a previous contract
(`anchorContractOf`) is the contract as written.

## Flattening

Flattening a root with its sibling files (`flattenContract`) inlines
every re-export once into one self-contained text, ONCE ACROSS THE
WHOLE TEXT (a declaration two siblings both re-export, one shared type
reached by two roads, appears a single time, by its name): for each `export
... from './x.js'` whose sibling the caller provided, the named
declarations replace the line IN PLACE (with their docs; the
declarations' own lines stand exactly where the import or export line
stood, joined by single newlines, with no blank line added before or
after them: a blank line of the root stays, the text gains none; a
name the sibling lacks, or a renamed re-export, stays in a residual
`export { ... } from` line, `export type` kept when the original was
type-only), an `export *` inlines every declaration the sibling
exports (functions, consts, classes and types alike), and an `import {
... } from './x.js'` of a provided sibling is dropped, each imported
name that the root does not itself re-export inlined PRIVATELY, its
`export` keyword removed (a renamed import, `{ helper as h }`, inlined
under its local name, the declaration's own name replaced by it),
EXCEPT a name that an exported declaration of the root itself names
(in a function's parameter or result type, or inside an exported
type), which is inlined EXPORTED: a consumer must be able to name
every type the surface names, so the text resolves every reference
while its surface stays the root's own plus what that surface names.
A DEPENDENCY'S TYPE IS NEVER INLINED: an import or re-export from a
generated agents module (a path under `./agents/`, a dependency's
types) whose local name THE ROOT'S EXPORTED SURFACE REACHES (an
exported declaration names it directly, or names an unexported
declaration of the root that names it, through any depth) fails the
flatten, whatever siblings the caller provided, with `the contract
names <local>, imported from '<path>': a contract stands alone, so
the shape is declared again under the agent's own name`; an imported
name the flatten cannot inline from any other path (a name the
provided sibling lacks, or a path the caller provided no sibling for)
that the exported surface reaches fails the same way, naming that
path; an import the exported surface does not reach is dropped. Everything else is kept with its attached doc, and the
result ends with a newline. `readContractClosure` reads a contract's closure from
a FILE on the same idea, line by line: an `import` or `export` line
ending in `from '<relative path>'` is replaced by the text of that
sibling read the same way (the relative path with a `.js` or `.ts`
suffix read as `.d.ts`, resolved against the file's own folder and
then against its `types/` folder, `./helpers.js` beside `dir/x.d.ts`
naming `dir/helpers.d.ts` and then `dir/types/helpers.d.ts`, each
file inlined once, a missing one contributing nothing; a path under
`./agents/` is a dependency's module, never a sibling, and its line
fails the read in the flatten's words whether the file is there or
not), and any other line is kept; an absent file is the empty text.

## The dependency stub

`generateAgentStubModule` generates the typed module a consumer's
workspace holds for a dependency agent from the dependency's
contract. Its file name (`agentStubFileName`) is the agent id with
every `/` replaced by `-`; the npm package an agent's artifact
publishes under (`artifactPackageName`) is `cernanto-agent-` followed
by the same.

THE NAMES A GENERATED MODULE HOLDS. What a generated module imports
is written under the name this specification gives it while nothing
the module declares carries that name: in a stub, no handler and no
parameter of a handler; in a bind module, the accessor and no
parameter of a method; in the assets module, no export. One that is
carried is held under a LOCAL, the name with `$` appended, in its
import (`<the imported name> as <local>`) and in every place the
module's text calls it or names it. The accessor's own parameter and
variables (`agentId`, `load`, `namespace`) are held the same way when
a parameter of a method carries their name. A handler of a stub whose
name is a RESERVED WORD (the words the asset export name's rule
names) is declared under a local of its own, the name with `$`
appended: its documentation, then `async function <local>` followed
by its signature after the name, in place of `export async function`
and the signature, and after its closing brace the line `export {
<local> as <name> };`.

For a SERVICE dependency the module carries one exported async
function per handler with the contract's signature verbatim, whose
body answers `(await wireCall(wireStub("<agent id>", "<handler>"),
<the arguments>)) as <result type>`, where the arguments are the one
parameter's name when the handler declares one, `undefined` when it
declares none, and an array of the parameter names in order when it
declares several (a rest parameter spread in last), the form the
runtime's materialize gives every stub, so one parameter rides a call
as itself and several ride as one tuple; the two verbs imported as
`import { call as wireCall, stub as wireStub } from
'@cernanto/runtime-lib/calls';`. Each function carries the handler's
documentation, or `/** Calls <agent id>.<handler> as a durable
request. */` when the contract has none. The file starts with the
four lines `// Generated by the Cernanto compiler from the <agent id>
contract.`, `// Do not edit: regenerate by recompiling the agent.`,
`// <agent id> is a service: every call below rides the wire as a`,
`// durable journaled request to the service's own call.`, then
the import line. With types sourced from the PACKAGE (the default)
the module imports the contract's exported type names (every declared
interface, alias and enum and every name its export clauses carry,
less the declared functions, sorted) with
`import type { ... } from '<package name>';`, the package being the
artifact package name unless the caller names another, and re-exports
the same names on the next line (`export type { ... };`): a consumer
imports a dependency's types from the module it imports the functions
from. With INLINE types the contract must be self-contained (a
contract that imports anything is refused with `the <agent id>
contract imports other modules; an inline-types stub requires a
self-contained contract`); the module then embeds, after the import
line and a blank line, every type declaration of the contract
verbatim with its doc, the
exported ones and the private ones alike (a flattened root inlines a
sibling's declaration privately when the root imported it without
re-exporting it, and an exported signature may still name it),
separated by blank lines, then the functions.

For a MODULE dependency the stub is the compile's stand-in for code
that links on the plane, and it holds the module's contract alone:
its types INLINE as any dependency's (the contract self-contained,
as the inline rule asks), one exported async function per handler
with the contract's complete TypeScript parameter list and signature
(the one-wire-input rule applying to served agents alone), whose body
throws `new Error('<agent id>.<handler> links on the plane; a compile
holds the module's contract alone')`, so a consumer type-checks and
loads against the contract and no module's code runs in a compile
(the runtime writes the linked module's real stub when it
materializes the consumer's package); every helper (a synchronous
exported function) is written the same way below the functions, with
its signature, under its documentation or `/** <agent id>'s <name>.
*/`, and a helper the contract declares with several signatures
keeps every signature as an overload, verbatim and in order, followed
by one implementation `export function <name>(...args: unknown[]):
never { throw new Error('<the same words>'); }`, so a consumer calling
any of them type-checks; a declared constant is written after the functions, under its
documentation, as `export const <name> = <the initializer>;` when the
contract declares it by an initializer, and otherwise as `export
const <name> = linkedOnThePlane('<agent id>', '<name>') as unknown as
<the type>;`, `linkedOnThePlane` a local function of the stub that
answers a proxy whose every property read throws `new Error('<agent
id>.<name> links on the plane; a compile holds the module's contract
alone')`, so a module-scope read of a module's value fails the load
with its name; a handler without documentation gets `/** <agent
id>.<handler>, linked on the plane. */`. The header is `// Generated
by the Cernanto compiler from the <agent id> contract.`, `// Do not
edit: regenerate by recompiling the agent.`, `// <agent id> is a
module: its code links in-process on the plane and runs as`, `// this
agent; this file holds its contract alone.`, then the type lines, a
blank line, and the functions and helpers separated by blank lines;
the stub imports nothing from the module's package, which a compile
never holds.

## The interface bind module

An interface id derives its names by splitting the FULL id on `/`,
`.` and `-` and camel-casing the words: `email/client` answers the
accessor `emailClient` (`interfaceAccessorName`) and the type
`EmailClient` (`interfaceTypeName`, the accessor with its first letter
upper-cased; the full id, so `email/client` and `db/client` differ).
An accessor that is not a valid TypeScript identifier (the first
segment starting with a digit, as in `2fa/client`) is refused: the
generator fails with `the interface id "<id>" derives the accessor
name "<accessor>", which is not a valid TypeScript identifier; rename
the interface so its full id camelizes into one`, and
`interfaceNameProblem` answers the same words to a consumer that asks
before compiling, nothing for a usable id.

`generateInterfaceBindModule` generates the bind module from the
interface's contract, which must be self-contained (an importing
contract is refused: `the <id> interface contract imports other
modules; an interface contract must be self-contained`). Its header
is `// Generated by the Cernanto compiler from the <id> interface.`,
`// Do not edit: regenerate by recompiling the agent.`, `// <id> is an
interface: a shared contract many agents`, `// implement. Nothing
serves the interface itself; each implementor is`, `// an ordinary
agent whose exported surface is pinned to exactly these`, `//
declarations.`. For an IMPLEMENTOR (no accessor asked) the module
continues with `// This agent IMPLEMENTS the interface: the types
below are the`, `// surface its exported functions must carry,
exactly.`, a blank line, and every exported type declaration verbatim
with its doc, separated by blank lines, and ends with a newline. For a
CONSUMER it continues with `// <accessor>(agentId) binds one
implementor by its agent id at`, `// run time; each method rides the
wire as a durable journaled request`, `// to that agent, exactly as a
direct dependency call does.`, the imports `import { boundInterface,
call as wireCall, linkedCall, linkedFunction, stub as wireStub } from
'@cernanto/runtime-lib/calls';` and `import { linked } from
'../linked.js';` (the generation's table of composed modules, which
the runtime writes beside the glue when it materializes a package;
the workspace declares it for the type-check in `linked.d.ts` at its
root as `export declare const linked: Record<string, () =>
Promise<Record<string, unknown>>>;`), the type declarations, then the
object type: `/** The <id> interface: every implementor answers
exactly this surface. */`, then
`export interface <Type> {` with one member per handler, its doc
indented under two spaces when it has one, `  <signature>;`, and `}`.
Then the accessor: documented as binding the implementor named by
the given agent id, or, given none, the implementor the plane binds
for the interface (the plane's setting `<id>/default`), or, when the
plane binds none, the `fallback` id when one is given, else failing in
words that name the setting to set (an id is passed only when the
specification names an implementor or the id arrives as data, from
the request; a module implementor composed into this process answers
in process; any other id rides the wire, fails in words when the agent
exists but does not implement the interface or implements it at a
different contract, and waits, like any call, for a service that does
not serve yet), `export async function <accessor>(agentId?: string,
fallback?: string): Promise<<Type>>` whose body first resolves the id,
`const bound = agentId ?? (await boundImplementor("<id>", fallback));`
(`boundImplementor` imported from `@cernanto/runtime-lib/calls` beside
the others; `bound` stands wherever the body below says `agentId`),
then looks it up in the table (`const load = linked[agentId];`) and,
when a loader is there, loads the module's namespace (`const namespace
= await load();`) and answers an object whose every method is `async
<signature> { return (await linkedCall(agentId, "<handler>", <first
parameter or undefined>, linkedFunction(agentId, namespace,
"<handler>")<secret>)) as <result type>; }`; otherwise it awaits
`boundInterface({ interface: "<id>", sha: "<the contract sha the
caller gave>", agent: agentId })` and answers an object whose every
method is `async <signature> { return (await wireCall(wireStub(agentId,
"<handler>"<secret>), <first parameter or undefined>)) as <result
type>; }`, where `<secret>` is `, { secret: true }` for a handler
whose parameters or answer carry the os module's `Secret<T>` mark in
the interface's contract and is empty for every other handler (the
mark keeps a secret's call out of the records at both ends). Method
shorthand with the contract's verbatim signature is used throughout,
so the emission type-checks under strict options for any signature
the interface declares. THE OBJECT IS ONE LITERAL: its methods are
the literal's members, each member followed by a comma (`{ async a():
Promise<A> { ... }, async b(): Promise<B> { ... }, }`), so the text
parses before it type-checks.

## The os module

The os module (`osModuleSource`) is the one capability module a
workspace gets: the platform vocabulary that is not plain Node. Its
header line is `// Generated by the platform; this agent's durable
powers. Do not edit.`; every function it declares carries a
documentation block above it, written by this module in its own words
to teach what 'The os documentation' below lists for that function,
one `@example` each. An INTERFACE gets the empty text. A MODULE gets
`usage` and the two call functions ALONE (`invoke` and `cancel`: a
module calls an agent and ends a call through its host's execution,
exactly as it calls a granted agent), without `caller` and without
`agentId`. A SERVICE or a TASK gets `agentId`, `artifact`,
`composition`, `caller`, `usage` and the two call functions; a WORKER
gets `agentId`, `artifact`, `composition`, `usage` and the two call
functions, without `caller`. The text
is the header, then the runtime import: for the agents with `caller`
the line `import { agentId as agentIdImpl, artifact as artifactImpl,
callId as callIdImpl, caller as callerImpl, cancel as cancelImpl,
composition as compositionImpl, invoke as invokeImpl, substrateUrl as
substrateUrlImpl, usage as usageImpl } from '@cernanto/runtime-lib';`, for a worker the
same line without `caller`, for a module the same line without
`caller`, `agentId`, `artifact` and `composition`, a blank line, THE
SECRET MARK every os module declares for the whole workspace, a type
alone and global so a contract names it bare, a dependency's copied
twin included: `declare global { type Secret<T> = T; }` under its
documentation, a blank line, THE LIFETIME BLOCK every executable os
module carries, modules included (the call id stays stable through
linked traces): `export function callId(): string { return
callIdImpl(); }` under its documentation, a blank line, THE SUBSTRATE
every executable os module carries, modules included: `export function
substrateUrl(): string { return substrateUrlImpl(); }` under its
documentation, a blank line, THE USAGE every executable os module
carries, modules included: `export function usage(report: {
inputTokens?: number; outputTokens?: number; costUsd?: number }):
void { usageImpl(report); }` under its documentation, a blank line,
THE IDENTITY every executable os module
but a module's carries: `export function agentId(): string { return
agentIdImpl(); }` under its documentation, a blank line, `export
function artifact(): string { return artifactImpl(); }` under its
documentation, a blank line, `export function composition():
Record<string, string> { return compositionImpl(); }` under its
documentation, a blank line, the caller declaration `export const
caller: () => { agentId?: string; callId?: string; target?: string } = callerImpl;`
under its documentation, followed by a blank line, for the agents
that have it, then the two call declarations in that order, `export
const invoke: { (agentId: string, handler: string, args: unknown):
Promise<unknown>; (agentId: string, handler: string, args: unknown,
options: { idempotencyKey?: string; wait?: boolean; host?: string;
accepted?: (call: { callId: string; requestId: string; copy: { key:
string; epoch?: number; address: { host: string; port: number } } })
=> void }): Promise<{ callId: string; requestId?: string; result?:
unknown }> } = invokeImpl;` (one declaration with two call signatures,
spelled on one line) and
`export const cancel: (callId: string) => Promise<boolean> =
cancelImpl;`, each under its documentation; each function's
documentation above it, the functions separated by blank lines. A
module's text is the header, its runtime import, a blank line, the
secret mark, the lifetime block, the substrate, the usage and the two
call declarations.

## The os documentation

Every function of the os module is documented above its declaration
in a TSDoc block this module writes: a description in plain words,
one `@param` per parameter, `@returns` where the answer needs
explaining, and one `@example` in valid TypeScript, in that order.
The reader is the coder of the agent, who has no other manual of
these powers; the block teaches, for each function, these facts:

- `Secret`: the mark of a value that stays out of every trace: a
  parameter or an answer typed `Secret<T>` in a contract makes the
  runtime record neither the arguments nor the result of that
  function's calls, on the caller's side and on the served side, the
  whole call dark; the coder writes it bare in the contract
  where the specification says a value is a secret (a credential, a
  token); the example marks a function that answers a stored
  credential.
- `agentId`: this agent's own id, the name it is deployed under on
  this plane, for a value the platform must recognize as this agent
  (a webhook source, the target of a call to itself, a configuration
  key of its own); the code reads it from here rather than writing a
  literal, because the agent runs under another name while it is
  verified and a literal names the live agent instead; the example
  asks the webhook agent for the url of `agentId()`.
- `artifact`: this process's own package digest, `sha256:<hex>`, as
  the fleet names the generation's artifact: what a process stamps
  when it says which bytes it is (the compiler stamps its own identity
  on a compile with it); a fact of the process, read from nowhere; the
  example records it beside a result.
- `composition`: the modules this process composes, each linked
  module's id to the package digest it runs, an empty map when it
  composes none; a fact of the process, the generation's composition
  as the fleet planned it; the example lists the ids.
- `substrateUrl`: the substrate's client url this process was booted
  with, the server the runtime's own calls ride, a fact of the process
  rather than a configuration read, so a platform agent that opens a
  connection of its own to the substrate (a stream, a bucket) asks
  nobody and journals nothing for it; the same url for the process's
  life; the example reads it once at a handler's start.
- `callId`: the current wire call's stable id, shared by linked
  modules, the same through every linked trace, and the call's own
  id as `cancel` takes it; the id to deduplicate business work by;
  the example keys an idempotent write on it.
- `caller`: the agent and call that called this handler, when one
  did (an operator's direct call or a plain wire call arrives with
  neither); the code narrows before use, throwing in
  words when the handler needs a calling agent; the example narrows
  and keeps both ids.
- `invoke`: calls an exported function of an agent the code learns
  only when it runs (an agent id read from data, a consumer a delivery
  names, `agentId()` when it must call itself) and answers what the
  function answered, the same durable journaled call a granted
  dependency's stub makes, awaited like any call; a refused or failed
  call throws in the callee's words; a target known when the code is
  written is a granted dependency imported from `./agents/`; the
  parameters are the agent's id, the exported function and its one
  argument. WITH A FOURTH ARGUMENT, the options, the answer is the
  call itself, `{ callId, result }`: `callId` the call's id, the id
  `cancel` takes and the plane files the call's records under, and
  `result` what the function answered. `idempotencyKey` names the
  call: repeated requests under one key (a retry, a relayed copy) are
  ONE call while it runs and until its answer is delivered. `wait:
  false` starts the call and answers as soon as the plane has stored
  it, with its `callId` alone (an id that names no version yet): the
  call runs on when this handler returns, its answer goes to nobody
  and nothing of it is kept for a later question, so work whose end
  others must learn writes that end itself where they read it (a
  document of its own); it is the road for work that outlives this
  request (a compile someone follows rather than waits for), and a
  caller that needs the answer waits. `host` names the server the
  call goes to: the plane delivers it to the copy of the agent on that
  host (a job's copies take their host's lane beside the agent's shared
  one), for an act that is one server's own (the plane's controller
  asks the host job of one server to dump or restore a copy there);
  without it, whichever copy takes the call serves it. `accepted` is
  told the moment a copy took the call, before its answer, with the
  call's `callId`, its `requestId` (the id of the request the call's
  records are kept under: the call's id with its request in it) and the
  `copy` that took it (its record's key, its epoch and its address), for
  a caller that follows the call while it runs; the answer still comes
  when it comes. A waited call's answer carries its `requestId` beside
  its `callId`. The
  one example calls a tester by the id a round gave it and then starts
  a compile under its compile id without waiting.
- `usage`: says what one request to a model cost, right after the
  model answered: its input and output tokens and its cost in US
  dollars when the provider prices it; the plane adds it to the
  running totals of the agent the call is charged to (the last agent
  of the call's chain that is not one of the plane's own), which `ls`
  shows; it is written once at each place the code itself makes a
  request to a model, for every request made, a request made again
  included, and an agent called for an answer reports its own; the
  example reports a model answer's usage.
- `cancel`: asks for a call to end, by its id (the `callId` an
  `invoke` with options answered, or the `callId()` a running call
  handed over): the process that holds the call ends the attempt in
  hand, and whoever waits for the call hears that it was cancelled; a
  call the plane has stored that no process has taken yet and that
  nobody waits for is removed before it starts; the answer is whether
  the call was reached, true when it was, false for a call that
  already ended or that nobody runs; the road for stopping work the
  caller started (a compile the operator gave up on, a long run whose
  request was withdrawn); the example starts a call without waiting
  for it and cancels it by the id that start answered.

## The assets module

A `file:` grant hands the code its PATH. A grant comes with its files,
each carrying `path` (the file's path under the artifact's `assets`
folder, the granted folder's own path included for a folder grant),
`source` (where the file lives on disk, which is what the text check
below reads) and `size` in bytes. The generated module
(`assetsModuleSource`; its file name under src is `assets.ts`; the
granted bytes ride under the artifact's `assets` folder beside dist)
starts with `// Generated by the platform: the paths of the files this
agent's specification grants. Do not edit.`, `import { dirname, join }
from 'node:path';`, `import { fileURLToPath } from 'node:url';`, a
blank line, `// The granted files ship under assets/ beside dist/,
wherever the`, `// artifact lives; every path below anchors on this
module's location.`, `const ASSETS_ROOT: string =
join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');` (a
string), a blank line, then per grant. A granted FILE gets a doc
block `/**`, ` * The path of assets/<file path> (<text or binary>,
<size>), a file this agent's`, ` * specification grants as file:<the
grant as written>.`, three read lines ` * Read it with node's fs reads
(\`readFileSync(path, 'utf8')\`, \`readFile\` from`, ` *
node:fs/promises, \`createReadStream\`) or hand the path to a library
that takes`, ` * one. The file is read-only: it is part of the
certified artifact.`, ` */`, then `export const <name>: string =
join(ASSETS_ROOT, "<file path>");` and a blank line. A granted FOLDER
gets `/**`, ` * The paths of the <n> file(s) under assets/<folder
path>/, a folder this`, ` * agent's specification grants as
file:<grant>, keyed by each file's path inside the folder:`, ` * <the
first twelve keys joined by ", ", then ", ..." when there are more>.`,
the same three read lines with `The file is` read as `The files are`,
` */`, `export const <name>: Readonly<Record<<the keys as string
literals joined by " | ", or `string` when the folder holds no
file>, string>> = {`, one line per file `  "<key>": join(ASSETS_ROOT,
"<file path>"),`, `};` and a blank line; a key is the file's path
inside the folder (its `path` with the folder's path and the slash
after it removed), and the value joins the assets root with the
file's `path`. The lines are joined with newlines. A file's
description (`describeFile`) reads the file at its `source` path:
`text` when its first 8192 bytes hold no NUL byte and decode as valid
utf-8 (`isTextFile`), else `binary`, followed by `, ` and its size
(`humanSize`): bytes under 1024 as `<n> B`, under a mebibyte as
kibibytes with one decimal and ` KB`, else mebibytes with one decimal
and ` MB`. A granted path's export name (`assetExportName`) is its
file or folder name split on every run of characters that are not
letters or digits, a word entirely upper-case lower-cased, the words
camel-cased with the first lower-cased (`session-coder.md` reads
`sessionCoderMd`, `doctrine/` reads `doctrine`); an empty result reads
`asset`, a name starting with a digit is prefixed with `_`, and a
JavaScript reserved word or `arguments`, `eval`, `await` and `yield`
gets `Asset` appended.

## The words of a finding

A gate finding's words (`findingWords`) come from a catalog: a map
from a code (or a numbered variant of it) to a message and an
optional hint, each with named slots written `{{name}}`. Filling is
strict both ways: a slot the given values do not fill fails with `the
words of <code> name a slot "<name>" the values do not fill`, a value
no slot of the message or the hint takes fails with `the words of
<code> take no slot "<name>"`, and a code the catalog lacks fails
with `no words are recorded for <code>`. The answer is the message
and, when the entry has one, the hint, both filled.

## The constants and the four traced operations

The artifact folder that keeps granted files is `assets`
(`ASSETS_DIR`); the assets module's file name is `assets.ts`
(`ASSETS_MODULE`); the line a tester's derived prose carries before
the tested agent's own specification is `What the agent under test
should do:` (`TESTER_PROSE_MARKER`). `sha256` answers the hex digest
of a text.

Four operations are traced: `compareContracts` compares an emitted
contract with the one it must keep and answers whether they are the
same surface and, when they are not, the drift lines (empty when the
same); each side may bring its sibling files, and the emitted side
may bring the contracts of the dependencies the compile served: a type
declaration that differs is no drift when the emitted declaration is
the same, folded, as a dependency contract's declaration of that name,
since the type moved with its dependency. `interfaceCoverage` holds an
implementor's contract to the interfaces it implements and answers the
gaps per interface id (the ids in sorted order, an empty list for a
covered interface) and the clashes between the interfaces.
`flattenContract` answers the one self-contained text.
`contractChange` answers the change class. Each answers on its own
tick, so a refusal thrown inside rejects the promise instead of
escaping the call.

## Tests

Uses: npm:fs-extra, npm:typescript

Reading a contract's closure from disk and telling a text file from a
binary one need real files: the tests write them into a temporary
folder with the granted package and point the functions at them. The
names a generated module holds are proved on texts of the tests' own:
a contract whose `Handlers` interface carries the handlers `delete`
and `wireCall`, an interface whose id is `linked` and whose method
takes a parameter named `namespace`, and a granted file named `join`.
EVERY GENERATED TEXT PARSES: each module the tests ask the generators
for is parsed with TypeScript's own parser and carries no syntax
diagnostic: a stub of each dependency type with inline types, a
module stub with helpers and constants (one helper declared with two
signatures keeps both as overloads over one throwing implementation,
and a consumer calling each type-checks; the comparison reads the
same helper with one of its two signatures removed as another
contract), a bind module with its
accessor over an interface of several methods and one without, the os
module of each type and an assets module over a folder grant.
A root whose two siblings both re-export one shared type flattens it
once; a root whose exported interface names a type imported from
`./agents/x.js` fails the flatten in those words, with a sibling
provided for it and without one, and so does one that reaches it
through an unexported alias (`type Inner = { a: A }; export interface
B { inner: Inner }`); a root whose import from
`./helpers.js` names something no provided sibling declares fails
naming that path, while such an import no exported declaration names
is dropped; and `readContractClosure` fails the same way on a file
importing from `./agents/x.js`.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
