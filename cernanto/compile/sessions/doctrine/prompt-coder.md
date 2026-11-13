# The code prompt

The fixed paragraphs of the code session's first prompt, one section
per slot. The compile fills each `{{name}}` with its own data (an agent
id, a module name, a list of packages) and never adds a word of its
own; the contracts, declarations and specification it quotes ride
between these paragraphs verbatim. A section is one paragraph, and a
line break inside it is the formatter's, read as a space.

## interface-opening

Write the interface "{{agentId}}" (an interface spec): a contract with no
body. Declare every function of the surface as an ambient declaration
(`export declare function send(to: string, subject: string, body: string): Promise<void>;`),
its parameters named and typed in the declaration, beside the exported
record and result types, with full TSDoc on every
function and type: the semantics you write here are what every
implementor is held to and every consumer reads. Declarations only: no
implementations, no runtime code.

## agent-opening

Implement the agent "{{agentId}}", a {{type}}.

## specification

Specification:

## implements-one

This agent IMPLEMENTS an interface: its exported surface must carry
every function the contract below declares, exactly as declared: the
names, parameters, types and referenced type declarations verbatim (the
docs ride with them). Export more beyond the interface only where the
specification asks for it; never rename or reshape what the interface
declares. The types are importable from './agents/<interface>.js'.

## implements-many

This agent IMPLEMENTS interfaces: its exported surface must carry every
function each contract below declares, exactly as declared: the names,
parameters, types and referenced type declarations verbatim (the docs
ride with them). Export more beyond the interface only where the
specification asks for it; never rename or reshape what the interface
declares. The types are importable from './agents/<interface>.js'.

## implements-document

This agent IMPLEMENTS the OpenAPI document {{target}} and serves it on
a listener of its own. Its operations are already in src/index.ts,
seeded by the compile as typed, documented, empty functions: fill each
body and change nothing of its signature; the types are importable
from './openapi/{{name}}.types.js'. The listener at the top of
src/index.ts is yours, standard node http or https on the port, the
protocol and the admission the specification names (the seed leaves
the port as a name to replace: write the port the specification
names, a number or a setting read from the configuration): it hands every
request to the handler from './openapi/{{name}}.server.js' first,
which answers the document's paths and leaves every other path to
you, and takes `admit` when the specification says who is admitted
(answer the principal to admit, nothing to refuse). A declared error
answer is a thrown Error carrying that status and the declared body.
Export more only where the specification asks for it. The contract
below is what the document declares; the seeded functions already
match it.

## dependency-contracts

Dependency contracts (their generated modules already exist under
src/agents/; these declarations are the exact API those modules expose,
so there is no need to read the files again). A contract whose words
ask you to write what an operator will follow, the steps of an account
ask and the page it points to, gives you a research task before the
code: search the web for the provider's own console documentation,
fetch that page, and write the steps from what it says today, naming
its menus, buttons and values as it names them; the web search and
fetch tools are open to you for this, and steps from memory are
refused by the operator who follows them.

## dependency-contract

{{agentId}} (import it from './agents/{{file}}.js'):

## granted-interfaces

Granted interfaces, each generated as a BIND module under src/agents/.
An interface is a shared contract several agents implement; you never
import its functions. Each module exports ONE async accessor that answers the typed surface
(its generated declaration file beside it shows the exact accessor,
object type and types). CALL IT WITH NO ARGUMENT: the plane binds the
implementor that serves (the operator's setting for the interface);
never read a setting to pick one and never hardcode one. Pass an
implementor's agent id only when the specification names one, or when
the id arrives as data in the request; pass a fallback id as the second
argument only when the specification names one for a plane that binds
none. A name that is not an implementor fails in plain words at the
first use. The declarations
below are what every implementor answers THROUGH the accessor:

## granted-interface

{{agentId}} (import { {{accessor}} } from './agents/{{file}}.js'; const
client = await {{accessor}}(); an implementor's agent id as the
argument only when the specification names one or the request carries
it; a fallback id as the second argument only when the specification
names one for a plane that binds none).

## mcp

Granted MCP servers, each generated as a typed module under src/mcp/:
{{modules}}. Import the tool functions from "./mcp/<module>.js" and
call them like any dependency; never resolve or pass credentials for
an MCP server yourself. Read the generated file for the exact tool
names, argument fields, and result types before calling one; never
guess a field the types do not declare. A tool without a declared
output schema answers unknown: a json answer arrives parsed and prose
arrives as a string, so validate the shape with your own zod schema
(never JSON.parse it) and judge prose with cernanto/decision or
cernanto/llm when granted. Reach the server through its module alone: a client of your
own with the server's url written into the code is refused by the gate
(CE236).

## openapi

Granted OpenAPI services, each generated as a typed module under
src/openapi/: {{modules}}. Import the operations from
"./openapi/<module>.js" and call them like any dependency. Read the
generated file for the exact operation signatures before using one;
never guess a field the types do not declare. Reach the api through
its module alone: the module holds the account, and a fetch of your
own with the api's url written into the code is refused by the gate
(CE236).

## openapi-auth

The "{{module}}" api authenticates with {{auth}}; the generated module
holds that credential and asks the operator for it when it is missing
or refused, so write no onboarding code unless the specification asks
for a richer experience.

## npm

Granted npm packages, already installed in node_modules at their locked
versions: {{packages}}. Before using one, read its type declarations
inside node_modules for the exported functions and their signatures.
Never guess an API from memory; the type-check gate checks against exactly
what is installed.

## npm-entries

Granted npm packages, already installed in node_modules at their locked
versions: {{packages}}. The entry declaration of each typed package
follows verbatim, the file tsc resolves for its import: read it HERE
first and code against it. Below it, the map of the declaration files
the entry reaches, each with what it exports: when the specification
needs a type or a function the entry only names, open THAT file, once,
with one `sed -n` (never ls, grep or the README), and never guess an
API from memory: the type-check gate checks against exactly what is
installed.

## npm-entry

Entry declaration of {{name}} ({{path}}{{notes}}):

## npm-entry-truncated

, the first 24 KB

## npm-entry-root

; the package exports its root alone

## npm-entry-subpaths

; its exports map also allows the subpaths {{subpaths}}

## npm-declaration-map

Declaration files of {{name}}, under node_modules/{{name}}/, each name
with the line its declaration starts on (read the one you need with a
single `sed -n <from>,<to>p`, never the whole file):

## npm-declaration-map-more

- ... and more files past the map's cap

## npm-typeless-one

The package {{packages}} ships no type declarations and the registry
has none: before importing it, declare only the surface you actually
call in src/<name>.d.ts (declare module '<package>' { ... }); the
doctrine's typeless-package rule says how.

## npm-typeless-many

The packages {{packages}} ship no type declarations and the registry
has none: before importing one, declare only the surface you actually
call in src/<name>.d.ts (declare module '<package>' { ... }); the
doctrine's typeless-package rule says how.

## assets

Granted files, placed under {{dir}}/ in this workspace by their own
names (a granted folder keeps its inner layout), and exported as PATHS
by the generated module src/assets.js: {{grants}}. Read each granted
file before writing the code that uses it (they are readable here). In
{{reader}}, import the path constants from './assets.js' and read the
file with node:fs (readFileSync(path, 'utf8'), readFile from
node:fs/promises, createReadStream) or hand the path to a library that
takes one. Never copy a file's content into code, never write a path
literal, and never write to a file. Text read at module scope lands in
a string constant; read binary where it is used, because module
variables hold plain data, never Buffers.

## ambient-surface

The ambient surface, verbatim (`platform.d.ts` in your root): every
global and every built-in module that exists; what it does not declare
does not exist, and nothing in it needs opening:

## os-surface

The os module `./os.js` (import it as `import { caller,
invoke } from './os.js'`), its declaration verbatim with each
function's docs; nothing in it needs opening:

## preserve-contract

A previous version of this agent is deployed and its contract still
satisfies the specification (when the change record names an amend,
its code is in this workspace and the anchor-contract section's words
govern: modify it; otherwise write src/index.ts anew), so keep this
exact public contract, spelled as it
is spelled below: an inline parameter type stays inline and a named
one keeps its name and fields, whatever the shape's rules would have
you declare afresh, because dependents compile against it and the compile
refuses any drift:

## anchor-contract

A previous version of this agent is deployed with the contract below,
and the specification changed in a way it cannot fully keep. Start from
it: keep every exported function, its name and parameters, and every
input and result field and type that the specification does not force
you to change, and change only what it does. Dependents are compiled
against these names; an unforced rename or reshaping is a defect:

## new-contract

A new contract is asked for this agent: the previous contract is no
anchor, and this ask comes before the notes below that say to change
nothing the change does not force, even when the specification did
not change. Do two things. First, hold every exported function,
parameter, type and field to the specification as it reads now: keep
what it still calls for, change what it forces. Second, read every
name and every line of the docs in src/ against the specification's
own words: where the code calls a thing by a word the specification
does not use for it, write the specification's word, in the docs, the
names and the messages alike, whatever the previous compile wrote.
End your final message with the words you replaced, or that no word
differed.

## amend-opening

A previous version of the agent "{{agentId}}", a {{type}}, exists in
src/: it was compiled from the previous specification, which lies whole in
{{previousDir}}/spec.md, and the specification changed. Modify it, do
not rewrite it: change what the change below forces and nothing else,
keep every export, name, field and behaviour the change does not touch,
and leave an untouched function as it is; a word the specification no
longer uses is not left in a comment, a name or a message, so the docs
follow the specification's words as it reads now.

The doctrine you read is the current one, and it may be newer than the
code: the change record names the doctrine version the previous compile
was written under. Where the previous compile breaks a rule of the
current doctrine, bring it to the rule as part of this change, keeping
the behaviour; that is forced by the change as much as a moved
sentence is, and keeping every export does not mean keeping a shape
the rule refuses. The one such shape that older compiles carry
everywhere, brought to the rule only where the contract is not
preserved (a preserved contract keeps its shape as spelled, since the
dependents compile against it): a function whose parameters were
gathered into one object
with a type declared for that function alone (`send(args: SendInput)`
for what the rule declares as `send(to: string, subject: string, body:
string)`). Every such function is brought to the rule, its parameters
named and typed in its declaration, its first statements parsing each,
the type declared for its parameter list removed, and the tests that
call it rewritten to the new declaration; a record stays only where
the input is one thing the specification names. A dependency is
called as ITS contract declares it, in the generated module beside
yours, whatever shape that contract has: the rule governs what you
declare, never what you call.

## previous-compile

The previous compile's folder {{previousDir}} is yours to read and never
to write: spec.md (the previous specification, whole), contract.d.ts
(the contract it shipped with), change.diff and change.json (the change
record), plan.json (the plan, when one was made) and verify.txt (the
previous tester's whole conversation, when the failure below was cut).
The files seeded under src/ are: {{files}}.

## specification-diff

The change in the specification, a unified diff of the previous text
against the current, whitespace and case normalized:

## specification-diff-large

The change in the specification is large: read
{{previousDir}}/change.diff before you start.

## dependency-changes

What moved around the agent since the previous compile, summed up as
"{{summary}}", in full below: the grants added and removed, the drift
of every moved contract, the api types and tool listings that moved,
the package versions that moved. The current surfaces are on your disk
where every coder finds them, the twins under src/agents/, src/mcp/,
src/openapi/, the package entries, src/assets.d.ts.

## change-plan

The plan: a reading of the change against the code by a judge that saw
both. It is a map of the change, never a substitute for the
specification, which decides when they disagree. Each change says what
and where:

## gate-failures

No plan was made: the change is one the machine localizes. The previous
compile no longer passes against the moved surfaces, and the failed
gates' words below are the machine's exact list of what to touch, file
and line:

## seed-verified

This code passed its live tests against the previous specification.

## seed-unverified

This code did not pass its live tests; the failure follows, and the
change to the specification is the author's answer to it:

## seed-worker

A worker's run is its proof: the plane started this code and it ran.

## closing

That is everything: the specification, and every contract and
declaration the code rides with. Do the work the opening asked for
"{{agentId}}" from the specification above, and stop when it is done;
the compile takes it from there.
