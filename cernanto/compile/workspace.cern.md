# Compile Workspace

Type: module

Uses:
- cernanto/compile/contract
- cernanto/compile/lanes
- cernanto/compile/npm
- cernanto/machine
- npm:typescript
- npm:fs-extra
- file:workspace/assets/

Lay out the workspaces the compiler's sessions and gates work in: a
real TypeScript project on disk with real installed dependencies, the
generated overlay and its declaration twins, the granted files, and
the session root a live coder works in. The session owns `src/`;
everything else is the compiler's. Every document this module takes
rides in as the path of a file (the spec, the contracts, the openapi
documents, the kept tests), read here, and every answer is data. A
file that cannot be read fails with the field's name and the path.

EVERY LINK this module makes is made by the machine (the machine interface bound with no name, the implementor the
plane binds; an implementor that cannot
be bound fails the call in its words): the link path, the target as the step names it
(relative where the step says relative, absolute otherwise) and
whether the target is a directory; the machine makes the link the
system's way and removes a previous entry at the link path first.

The granted files under `assets/` are texts this module writes into
workspaces byte for byte: `platform.d.ts.tmpl` is the ambient
declaration every coder sees, `platform.file-reads.d.ts.tmpl` the
read-only filesystem subset appended to it when the spec grants
files, `platform.filesystem.d.ts.tmpl` and `platform.commands.d.ts.tmpl`
the local filesystem and the asynchronous child-process declarations
appended for a task, a job or a module, `platform.machine.d.ts.tmpl`
the machine's facts and the process's own id and signal, appended
after them for a job alone, `tsconfig.json.tmpl` the code
workspace's type-check configuration, `tsconfig.tester.json.tmpl` the
tester's (the same with node's types, `"types": ["node"]`, after
`lib`), and `tester-entry.ts.tmpl` the tester's executing entry.

## The code workspace

Materializing a code workspace (`materializeCodeWorkspace`) has nine
steps, in this order, and answers what it learned: the granted npm
packages with declarations nowhere, the version each granted package
was installed at (the npm module's reading, for the compile's pins),
and how long each phase took in milliseconds by phase name, ALWAYS
all five (`install`, `types`, `links`, `twins`, `session root`), a
phase that had nothing to do at 0.

Step 1, THE REGISTRY SET. The npm packages the caller hands in
(`npmPackages`: the names of the spec's `npm:` grants as the grammar
read them off the page, in order, without repeats, a scoped name
with its `@scope/`) are the registry dependencies, each at the
pinned version handed in for the name (`npmVersions`) or `latest`
when none is. This module reads no page: the grammar is the one
reader of a spec, and what it read rides in, so the workspace
description names no spec file. The registry set alone enters
`package.json`: the platform libraries and the dependency artifacts
are linked.

Step 2, THE RECONCILE, against the previous `package.json` in the
directory (none counts as no dependencies):

- a declaration package (`@types/<name>`) the previous manifest
  carries and the spec does not grant is CARRIED FORWARD when the
  package it types is still granted, and counts as no change; one
  whose base package is gone is dropped;
- when the comparable dependencies differ from the wanted set (names
  and versions, order ignored), `node_modules` is removed whole so the
  install produces exactly the declared packages;
- `src`, `dist`, `types` and the assets folder are removed in any
  case;
- when a session root is given, the real `src` is created in the
  workspace and the root's `src` becomes a RELATIVE link onto it (a
  directory).

Step 3, THE OVERLAY, written under `.cern/src` (the executing
generated sources; removed whole first), each file remembered, and
some marked hidden:

- `os.ts`, the os module the contract module renders for the agent's
  type and id, unless it renders empty;
- the granted files: each copied under the assets folder at its own
  path, and `assets.ts`, the assets module the contract module renders
  for the grants;
- the ambient declaration: the platform globals, with the file-reads
  subset appended when files are granted, and, for a task, a job or a
  module, the asynchronous child-process and local filesystem
  declarations (a service and a worker get the granted-file reads
  alone), and, for a job, the machine declarations after those,
  written to `.cern/platform.d.ts` (the gate's furniture, outside
  `src`);
- `package.json`, at the WORKSPACE ROOT (the coder's project, beside
  `src`, outside the overlay): the artifact package name of the agent,
  version `0.0.0`, private, type `module`, main `dist/index.js`, types
  `types/index.d.ts`, one script `check` = `tsc -p tsconfig.json
  --noEmit`, the files list `dist`, `types`, `src`, `tests`, the
  assets folder, `cernanto.json`, `provenance.json`,
  `spec.snapshot.md`, `npm-shrinkwrap.json`, and the dependencies: the
  registry set plus the carried declaration packages, sorted by name;
  two-space indentation and a final newline, as every JSON file this
  module writes;
- `tsconfig.json`, at the workspace root beside it: the granted
  `tsconfig.json.tmpl`, byte for byte;
- `src/mcp` and `src/agents` created empty, under the coder's `src`
  (the twins of step 8 land there, outside the overlay);
- one `mcp/<module name>.ts` per granted mcp server (the `mcpTools`
  keys: a remote server's url, or a local server's command), the
  module the lanes module renders for the server, its tools and its
  instructions, under the lanes module's name for the server; two
  servers claiming one name fail: `the mcp grants <first> and <second>
  both name the module "<name>"; drop one`, each server named by its
  url or by its command's label (the lanes module's: its program and
  arguments alone);
- for openapi grants (each document's file read and parsed as JSON
  first; a file that does not parse fails with `cannot read
  openApiDocuments[<url>].documentPath at <path>: <why>`), `src/openapi`
  created, and per document, under the lanes module's name for it, `<name>.types.ts` (the type
  engine's emission, when there is one) and `<name>.ts` (the module
  the lanes module renders); two documents claiming one name fail:
  `the openapi grants <first url> and <second url> both name the
  module "<name>"; drop one`;
- for the implemented document, when `implementsDocument` is handed
  in (`{target, name, types, server, stubs}`: the target as written,
  the lanes module's name for it and the three texts it renders),
  `src/openapi` created, `src/openapi/<name>.types.ts` written with
  the types text under the coder's `src`, and `openapi/<name>.server.ts`
  written with the server text under the overlay (its twin lands as
  `src/openapi/<name>.server.d.ts` by step 8; a granted document of
  the same name is no collision: the server module's name ends in
  `.server`); and THE SEED: when the coder's `src` holds no
  `index.ts` (a first compile, no previous code given), `src/index.ts`
  is written with the stubs text; when it holds one, every operation
  whose function name the file's text does not export (none of
  `export async function <name>`, `export function <name>`, `export
  const <name>` in it) has its stub, the doc block and the function
  as the stubs text renders them, appended after one blank line, so
  the coder starts from the operations the document declares;
- one `agents/<name>.ts` per dependency, `<name>` being the stub
  module name the contract module answers for the agent id (`lab-dep`
  for `lab/dep`, no extension of its own: the `.ts` is appended
  here), in the given order, the hidden custody dependency last
  (step 4): a dependency linked alone (no stub of its own) writes
  none; a dependency that publishes a consumer module has it placed
  verbatim; an interface dependency gets the bind module the contract
  module renders, with the sha256 of the contract text and an
  accessor unless the agent implements it, and the overlay gets,
  once, hidden, `linked.ts` at its root beside `agents/`, `export
  const linked: Record<string, () => Promise<Record<string,
  unknown>>> = {};` (the workspace's empty stand-in for the
  generation's table of composed modules the runtime writes beside
  the glue, so the bind's import of `../linked.js` resolves); every
  other dependency gets the stub module the contract module renders
  for its type, its types inline from the contract handed for it (a
  compile holds no dependency's directory: every dependency, a module
  included, is its contract); a hidden
  dependency's file is written and stays out of the twins in `src`.

Step 4, THE HIDDEN CUSTODY DEPENDENCY. A workspace with a remote mcp
server's grant (a url), or with an openapi document that applies
security (a security requirement at its top or on an operation, or
an auth summary naming a scheme), needs the custody stub: when no
dependency is
`cernanto/auth` already, the custody contract handed in becomes a
hidden `cernanto/auth` dependency of type service;
when none was handed in, the materialization fails: `a generated mcp
or secured openapi module needs the cernanto/auth contract, and this
workspace was given none`. A local server's module reaches no custody
and needs none.

Step 5, THE INSTALL, through the npm module, only when the
dependencies are not empty and (the reconcile saw a change or no
`node_modules` exists): every agent installs WITH its optional
dependencies, as the runtime's materialize installs them from the same
lock, so a gate that loads the compiled code loads what will run, a
native binding an optional platform package carries included; the lock
cache directory and the environment ride through when given (an
absent environment means the install inherits this process's, the
npm module's rule), and so does A GIVEN LOCK (`npmLockPath`: the
`package-lock.json` a held package carries, the exact tree its compile
certified), handed to the install as its lock so the install lands
that tree and resolves nothing. The `install` timing covers
everything up to here.

Step 6, THE TYPES AND THE VERSIONS, only when the registry set is not
empty: the npm module's types ensure runs over the registry
packages, after the install and before any link (its own install
would prune links), with the pins, the optional-dependency choice and
the environment of step 5, and its answer is the typeless list; then
the npm module reads the installed version of every registry package,
the names sorted, and the answer carries them. The `types` timing
covers both.

Step 7, THE LINKS: `@cernanto/runtime-lib` and `zod`, each a directory
link under `node_modules` to that library's folder (THE LIBRARIES), its
target absolute, its parent created; nothing of a dependency is
placed.

THE LIBRARIES are the ones this module's own code runs with, found by
Node's own lookup from this module's code and handed in by nobody: for
each of `@cernanto/runtime-lib`, `zod` and `@types/node`,
`import.meta.resolve` of `<the name>/package.json` names that package's
own `package.json`, and the folder that holds it is the library's
folder. The runtime library and zod are the plane's own, linked into
every agent's folder, so a workspace is checked against the very ones
this module runs with; node's declarations are the ones this module's
own packages bring. Each is found once, at the first call that needs
it, and kept for the life of the process. A library that cannot be
found fails the call terminal with exactly `the workspace module cannot
find its own <the name>`.

Step 8, THE TWINS. The remembered overlay files that are not hidden
get their declaration twins under `src` at the same relative paths:
the granted typescript type-checks the whole overlay (the hidden files
included, so their importers type-check; the ambient declaration
joins the program when it exists) with `strict`, module and
resolution `NodeNext`, target `ES2023`, declaration only,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`, `skipLibCheck`, the overlay tree as the root
directory and `src` as the declaration directory, emitting each
visible file's declaration alone. An error among the program's
diagnostics fails the materialization: `the generated modules do not
type-check, so their contract twins cannot emit: <the first five
messages, flattened, joined by "; ">`. No visible file, no program.

Step 9, THE SESSION ROOT, when one is given (below).

## The session root

A session root is what a live coder sees: its own `src` (the link of
step 2), `platform.d.ts` (the ambient declaration of step 3),
`tsconfig.json` (the granted `tsconfig.json.tmpl`, byte for byte), the
assets folder as a relative link (a directory) onto the workspace's
when the workspace has one, and a `node_modules` farm recompiled from
scratch on every materialization out of the workspace's installed
`node_modules` (none installed, no farm entries):

- an entry starting with `.` is skipped, and so is `@cernanto`: the
  platform's own packages are absent, not denied;
- a scoped entry (`@<scope>`) becomes a directory holding one
  relative link (a directory) per package inside it;
- any other entry is one relative link (a directory).

## The tester workspace

The tester's workspace (`materializeTesterWorkspace`) is a code
workspace (every step above, its `npmPackages` the tester's own,
handed in) whose spec is the tester's derived one, a worker by its
`Type: worker` line, with these particulars:

- its first dependency is the target, by the contract the compile just
  emitted for it and its type, placed as the code workspace places a
  dependency of that type (a module target's stub links on the plane
  like any module's; the test form the plane serves links the real
  code);
- then one dependency per agent handed in as the tests' own
  (`dependencies`: the agents the Tests section grants beyond the
  target, the AI grant and the mocks, each with the file holding its
  contract and its type),
  placed as the code workspace places a dependency of that type, an
  interface's bind included, so the tests reach the agents they were
  granted through `src/agents/` as they reach the target, AND NOTHING
  ELSE IS PLACED: a deployed agent the Tests section does not grant
  has no stub, so a test's import of it fails the type-check in the
  workspace rather than its load on the plane;
- then one dependency per mocked agent handed in (`mocks`: the
  agents the target's Tests section lists under `Mocks:`, each with
  its contract path and its type, task when unknown AND task when a
  module: the mock does the module's work in the test form the plane
  serves, so the tester's dependency is wire-shaped and carries the
  twin alone), so its stub and its declaration
  twin are written as any dependency's; and, when mocks were handed
  in, the directory `src/mocks` created, empty, where a mock goes (a
  mock is `src/mocks/<the mocked id's stub file name>.ts`); an agent
  named more than once among these is placed once, the target as the
  target and any other as its last naming shapes it;
- when mocks were handed in, that is everything placed for them: the
  plane's test form of the target links the mocks in place of the
  mocked edges, and the tester's workspace carries the mocks as test
  files alone;
- the tester's mcp tools, custody contract, version pins, lock cache,
  given lock (`npmLockPath`: the tests' own lock a held package
  carries), environment and granted files ride through; it has no
  openapi documents; its os module is written as any worker's is
  (step 3's `os.ts`, and its twin `src/os.d.ts` of step 8), afresh
  for every tester: the tests reach the agents through the stubs
  under `src/agents/`, and a test that must start a call without
  waiting for it, or end a call by its id, takes the language's own
  functions from `./os.js`, whose declarations are the ones the
  running tester is given. The secret mark is the os module's, as in
  every workspace, and stands after the ambient declaration is
  removed, so a contract that carries the mark type-checks in its
  stub, its twin and the tests;
- after the code workspace: the tester's entry, the granted
  `tester-entry.ts.tmpl`, is written byte for byte at
  `.cern/src/index.ts` (executing code, beside the overlay); each
  kept test file whose name ends with `.test.ts` or `.d.ts` and holds
  no `/` or `\`, and each kept file named `mocks/<name>.ts` (one `/`,
  under `mocks`, no `\`), is written under `src` at its name, any
  other name skipped, and a kept `os.d.ts` or `secret.d.ts` skipped
  too (the os module's twin is the workspace's own, and no kept file
  stands in its place); `tsconfig.json` is replaced by the granted
  `tsconfig.tester.json.tmpl`, byte for byte; `.cern/platform.d.ts` is
  removed (the test files see node's types instead); `@types/node` is
  linked to its folder (THE LIBRARIES); and the session root, when one
  is given, is made again as above with the tester's `tsconfig.json`
  and no `platform.d.ts`, its farm holding node's types with the rest.

## The coder's files and the test files

The coder's own files of a workspace (`coderFiles`) are every `.ts`
file under `src`, recursively, path to text, except the overlay: at
the top level the files `main.ts`, `os.ts`, `os.d.ts`, `assets.ts`,
`assets.d.ts` and the directories `agents`, `mcp`, `openapi`. No
`src`, no files.

The test files of a tester workspace (`testFiles`) are the files
directly under its `src` whose names end with `.test.ts` or `.d.ts`,
name to text, sorted by name, followed by the `.ts` files directly
under `src/mocks` when that directory exists, each as `mocks/<name>`,
sorted by name; no `src`, none. EVERY such `.d.ts` COUNTS, the
overlay's own twin (`assets.d.ts`) included, except `os.d.ts`, the os
module's twin, written afresh for every tester.

## Linking

Linking (`linkDependencies`) links the given packages into the
workspace's `node_modules`, exactly as step 7 links (a directory link,
the target absolute, the parent created).

The directory the executing generated sources live in
(`generatedSrcDir`) is `.cern/src` under a workspace. The ambient
surface for a workspace (`platformGlobals`) is the platform globals
file, with the file-reads file appended when files are granted, the
filesystem and commands files appended for a task, a job or a
module, and the machine file appended last for a job.

## The judge root

A judge's session opens over a root of its own: a directory holding
links onto what the judge may read and the files the compile writes
for it. `judgeRoot` takes `dir`, `links` and `files`: `dir` is
removed whole and made; each entry of `links`, `{name, target}`, makes
a link at `<dir>/<name>` (its parent made) whose target is the
absolute path given, a directory, a target that does not exist still
linked (the judge finds nothing there); each entry of `files`, `{path,
text}`, is written to `<dir>/<path>` (its parent made) as utf8. A name
or a path that is absolute or climbs with `..` fails with `the judge
root refuses the path <the path>` before anything is written. The
answer is `{dir}`.

## Tests

Uses: npm:fs-extra

Every operation works on directories the test makes in a temporary
folder with the granted file package and removes at the end (THE SEED
OVER AN EXISTING `src/index.ts` among them, the index handed as the
previous code and never written into the folder, which the
materialize makes afresh: its text kept first and the stubs of the
operations it does not export appended after one blank line, asserted
on the file's exact text); specs,
contracts and kept tests are written there as files and handed by
path. The machine the links are made through is the plane's own, the
implementor the plane binds. Every workspace links the real platform
libraries, the ones this module finds for itself (the twins type-check
against them), so the tests hand none. A workspace with no npm grant installs
nothing and needs no registry; the one install proven (`fs-extra` at
a pinned version, whose twin `@types/fs-extra` the types ensure adds
and the reconcile carries) is enough, and a `Uses:` block whose
bullets are asterisks names the same grants as one with dashes. An openapi document a test hands in carries at
least one operation: a document with none is refused by the lanes
module before any other rule reads it. The lanes module names an
openapi module after its url's host, the first label alone, so two
documents collide when their urls share it
(`https://a.example.com/v1/x.json` and `https://a.example.com/v2/y.json`
both name `a`) and never merely by title. A target for the tester is a fake compiled
package: `package.json`, `dist/index.js`, `types/index.d.ts` written
by the test. The session root, the link farm, the overlay's twins,
the hidden custody dependency and its failure, the openapi name
collision, the mcp name collision of two local servers whose commands
name one module, the local server's workspace that needs no custody
contract, the kept-test name rule and the coder-files exclusions are
each asserted on the files that exist and their exact texts. A
tester's workspace holds the os module's twin `src/os.d.ts` and no
`src/secret.d.ts`, and a kept test file named `os.d.ts` handed in
does not replace the twin, nor count among the test files. The
judge root is proven fresh: a root made twice holds only the second
call's links and files, a link onto a missing target still exists,
and a climbing or absolute name is refused before anything is written.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
