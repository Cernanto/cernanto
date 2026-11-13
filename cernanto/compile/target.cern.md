# Compile Target

Type: module

Uses:
- cernanto/compile/prepare
- cernanto/compile/code-phase
- cernanto/compile/test-phase
- cernanto/compile/live-cycle
- cernanto/compile/repairs
- cernanto/compile/membership
- cernanto/compile/artifact
- cernanto/compile/verify
- cernanto/compile/contract
- cernanto/compile/gates
- cernanto/compile/workspace
- cernanto/compile/sessions
- cernanto/compile/plan
- cernanto/compile/lanes
- cernanto/compile/npm
- npm:fs-extra

Run one agent of a compile from its place in the plan to its report
and its row: prepare resolves its inputs and decides its generation
and its contract, code-phase writes and repairs the code, test-phase
derives, writes and repairs the tests, the repairs module triages and
repairs what fails, live-cycle ships and runs each verification round,
and the package is written, stamped and stored. The four phase modules
and the repairs module do the work; this module owns the order and
the decisions between them for one target. The compile front (the
coordinator, which links this module) owns the compile: its request,
its settings, its vendor, its progress document and port, THE
MEMBERSHIP the membership module holds for it, and the loop that
calls this module once per agent; it hands them in together as THE
COMPILE this module works in, with the agent's id, its position in
the queue and the queue's length, and the report to fill. Every path
handed in is absolute; a cancellation and a retryable or
target-unavailable failure keep their classification through every
catch and are rethrown as they are. The shapes its functions take and
answer (THE COMPILE, the report, the row, a held ship) are declared in
its own contract, whatever module they came from.

## The phases and the port

The four phase modules do the work on a target: prepare resolves its
inputs and decides its generation and its contract (handed, beside the
workspace and the plan, THE MEMBERSHIP, the membership module's own
shape with exactly the members that module's contract declares today
(`rowsRead`, `rows`, `texts`, `packages`, `packageFailures`,
`treeReads`, `remoteContracts`, `installedTypes`, `installedDigests`,
`familyTests`, `installedDirs`), and THE JUDGE SETTINGS of this
compile, its
harness, session road, model and effort, the ones every judgment runs
on, so the onboarding of a granted api can be judged there, and the
target's spec as the grammar parsed it whole, THE PARSED SHAPE of
the plan module with its members `type`, `uses`, `implements`,
`tests`, `prose`, `license` and `copyright` and no other: its notice
labels, the license expression and the copyright holders, ride beside
its type, prose and grants, so the generation decision sees the notice
the package must carry; and, for an agent the request names as a target,
whether the request asks a new contract for it, `newContract`, which
prepare's NOTHING MOVED rung reads so that such a target is neither
current nor refreshed and goes to the code phase with no previous
contract, and which code-phase is handed too, so its session opens
and is told of the ask; and the contract the request gives for it,
when one, as `handedContract`, which the same rung reads so that a
target whose given text differs from its previous compile's is
neither current nor refreshed either and goes to the code phase with
the given text as the contract to keep, where the strict preserved
path writes it byte for byte when the declarations stand), code-phase
writes and repairs the code (its gates handed, beside the granted
packages and whether files are granted, THE REMOVED SURFACE: the
change record's `surface.removed` from prepare, for the surface gate;
THE LANE HOSTS: the host of every granted document's url and of each
of the document's servers, and of every granted remote mcp server's
url (a local server's command has no host), each with the specifier
of the module the lane generated for it, `./openapi/<name>.js` or
`./mcp/<name>.js`, so the scan refuses a url of a granted api written
into the code; and, for an agent that implements a document, prepare's
`documentName` beside the implemented contracts, so the coder's prompt
names the generated server module `./openapi/<name>.server.js` it
hands requests to and the types module it imports, and THE CODE
WORKSPACE DESCRIPTION carrying prepare's `implementsDocument` as its
own `implementsDocument` (the rendered name, types, server and stubs),
so the workspace module lays the types module under the coder's
`src/openapi/`, the server module under the overlay with its twin, and
seeds the stubs: a description without it leaves the coder with no
module to hand requests to), test-phase derives, writes and repairs
the tests, and live-cycle ships, runs one verification round and reads
the evidence; their contracts define the calls, and this module owns
the order and the decisions between them. Their progress port is
bound to the target and the compile's claim, one sequence for the
whole compile: the code and test phases are handed two functions of
this module's own, the checkpoint (the compile's claim check, handed
in by the coordinator) and the record (the compile's recorder with
the target as the event's `subject`, the detail of every event kept
as the last narrated detail for the failure words), and prepare, the
live cycle and the repairs module are handed THE PROGRESS PORT the
coordinator hands in by its id and its `compileProgress` function;
the sessions' doctrine is the folder the coordinator's compile names
(`doctrineFolder`, loaded through the sessions module; the module's
own when it names none), loaded once per compile and kept across
none, so the prompts carry the doctrine the provenance records, and
the repairs module is handed the same folder with every call that
renders an instruction; THE RESUME SEED LOCATION handed to prepare
has the root the coordinator names for the agent (its
`resumeSeedRoots`, a retried attempt's published root), else this
attempt's own seed root; their returned state is kept for the rest of the
call; a phase's
first spend is folded once and a repair's cumulative spend by its
increase alone, a judgment carrying its own; every narration is
awaited, the model-choice notes included; every completed resume seed
root a phase answers, a repair's included, is published under the
current claim (the progress module's publication, through the
coordinator) before the run goes on (a publication that fails is that
failure), and every code-phase call, each repair included, gets a
fresh immutable seed destination of its own (below the compile's seed
root, a random id).

## The agent's beginning

Each agent begins with progress `agent` begin `<its position, from
one>/<the queue's length>`. An id a tree package failed (a rename)
fails with that package's words, zero attempts, triages and cost
(progress `agent` end, not ok, result `failed`, the words as the
detail). An id without a parsed spec is skipped with zero attempts,
triages and cost, detail `no parsed spec` (progress `agent` end ok,
result `skipped`). A served row is current with zero spend, its
remembered contract, `contractChange` `none` and `deployed as is: the
spec is unchanged since its deploy` (progress `agent` end ok, result
`current`) and its artifact the fleet row's. Every other report starts
failed with zero counters and cost. A configured model foreign to the
compile's vendor is noted first (`prepare`, the agent its subject) as
the coordinator resolved the note.

THE DEPENDENCIES of the target are the membership module's, resolved
before the code workspace is materialized; once resolved, prepare's
contract maps are the truth for the prompts, the coverage, the
implemented stamps and the package's facts, the rendered openapi
contracts among them; the contract maps handed to prepare name every
agent or interface the target's Uses, Implements and Tests section
name, each with its type and its contract when one is known, out of
THE CONTRACT MAPS the membership module holds. Module inputs are
written under the target's compile folder (`<compile root>/<id
dashed>`, its `inputs` beneath, a contract written as
`inputs/contracts/<id dashed>.d.ts`) as absolute paths; the code
workspace is `workspace-a` with its session root `session-a`, the
tester's `workspace-b` with `session-b`.

THE PINS HANDED TO PREPARE are the compile's pins with the target's
previous pins folded in, before the inputs are resolved: the
membership module's previous pins of the agent (nothing when its
ladder answers none). The fold adds each map's entries (`mcp`,
`openapi`, `npm`, each entry read strictly) where the compile's pins
lack them, the doctrine staying the compile's own; then the plan
module's grant pins over the target's grants apply, so a `Uses:
npm:<name>@<pin>` decides the install. The pins prepare answers become
the compile's, whatever prepare decided.

THE PREVIOUS EVIDENCE: before prepare, the live cycle's evidence of
the previous tester (its root text alone, from the target's
verification time, else the epoch) is read and handed to the change
judgment and the amend prompt.

Prepare's ordinary input refusal fails this target before a session
with its detail as the target's; the partial pins it answers fold into
the compile's pins. Then handle the request and disposition in this
order, before considering the selected source:

- A COMPILE WITH NO VENDOR asks neither the sessions module nor the
  judge for anything: a current or refreshed target goes on, and so
  does a re-gated seed whose record needs no reading (a given or
  resumed source, and an amendment whose plan names no code change
  and under which no new contract is asked; its gates failing is that
  failure); any other target fails with zero attempts, `<id>: no
  coding vendor: on a laptop, cernanto dev signs in with this
  machine's Claude or ChatGPT login; on a server, cernanto config
  cernanto/harness default=<the vendor's agent id> and its key with
  cernanto config`.
- A plan-only request (the request's `planOnly`, WHATEVER THE
  GENERATION CHOICE ANSWERED: a target it would compile afresh, amend
  or recompile is planned and no session opens) or a planned
  disposition reports `compiled` with `code: 'planned'`, the
  generation's detail (else the plan's analysis, else `planned`), the
  preparation spend, zero code attempts and no artifact or row
  (progress `agent` end ok, result `compiled`). This includes a fresh
  target, recompile, supplied source or resumed source. THE RECOMPILE
  FLAG is the request's for an agent among the request's targets
  alone: a dependency in the scope takes the ladder as any compile's
  dependency does, current when its package is current, whatever the
  flag.
- Current fetches the returned artifact digest through the artifact
  module and reports current (`contractChange` `none`, the detail the
  generation's, `the package is current for its spec` when it gives
  none; progress `agent` end ok, result `current`); a current MODULE's
  contract joins the contract maps for the consumers that link it,
  read from its package (fetched into `<work>/inputs/artifacts/<the
  digest sanitized>.cern`; a warehouse that holds none fails the target
  with `the artifact <digest> is not in the plane store`); a current
  agent of any other
  type is wired by its row alone. The previous compile's contract
  joins the contract maps, and a held package's tester digest is kept
  as the agent's. A target current on the plane keeps the fleet's row
  as it stands: its result carries no row and nothing of it ships,
  since the plane runs it already (a row read back off the fleet is
  the verify module's projection, never a row a ship takes). A target
  current from the tree, in a compile that
  verifies live, ships before it is reported current: its row as THE
  ROW OF A REPORT composes it (the artifact module's row for the held
  package fetched back from the warehouse, with the package's own stamp
  and its tester digest) goes through the verify module's ship first
  (held, for the coordinator's own agent), so a target compiled after
  it finds it deployed when its pair is materialized, and a ship that
  fails is the target's failure, `the final ship failed: <message>`,
  as a compiled target's is.
- Refreshed keeps the certified bytes under the current specification:
  the package (the held package's file when one is held for the id,
  else the row's artifact fetched through the artifact module and read
  as the package it is; a previous artifact the generation names none
  of fails with `the refreshed compile has no previous artifact to
  re-emit`, and a package that does not read back with `the deployed
  package <digest> does not read back`) written again under the
  current spec text, with THE PACKAGE FACTS' license and copyright
  (the current spec's labels) as the manifest's, through the artifact
  module's respin and stored, and
  its row the artifact module's row for the respun package with the
  stamp it had (the fleet row's when it carries one and the row's
  artifact is the package refreshed, the very bytes the plane runs;
  else the held package's own stamp with its mocks, none when it
  carries none, so code the plane never ran keeps no stamp of another
  package's verification), THAT STAMP ALSO WRITTEN INTO THE RESPUN PACKAGE as its
  `verified` stamp through the same respin, so the package the client
  writes back stays verified, and `testerArtifact` the respun
  package's digest; the contract is the previous compile's text (the
  package's, else the ladder's), joining the contract maps, and the
  report's change class compares the ladder's previous contract with
  it; the size rule runs over the package's code files and adds its
  warning to the report's issues (a package that cannot be read for
  it fails with `the package does not read back`); progress `store`
  begin `contract <the change class>` and end `stored`; under live
  verify the row ships through the verify module's ship (held for the
  coordinator's own agent; a ship that fails is `the final ship
  failed: <message>`): the plane rolls identical code under the new
  words; the report's `artifact` and `package` are the respun
  package's digest, its code `refreshed`, its verification `live`
  when the row carries a stamp and `none` otherwise, its detail the
  agent's words, and the tester digest kept as the agent's.
- Generate proceeds to code with the selected source.

THE READING NOTES the membership module answers for the agent are
recorded (`plan` notes, the agent their subject) once its generation
is decided and is not current; a served row and a current target
print nothing.

## The code

Read the previous contract through the membership module's ladder,
except for a worker, and use prepare's decision. For a target under
`newContract` what the ladder answers serves THE CHANGE CLASS alone
(the cascade's question, the previous contract against the one the
session wrote) and reaches neither the session as an anchor nor the
judgment (a dependency the cascade recompiles keeps its own ladder).
AN IMPLEMENTED INTERFACE KEEPS ITS CONTRACT: for an interface agent
that a deployed row's `implements` stamps name or a workspace spec's
`Implements` names, what the ladder answers is marked given, as the
request's supplied contract is, unless the request names the
interface as a target under `newContract`: its contract is the
contract every implementor and every consumer compiled against, and
only the ask moves it, whatever its specification's words moved or
the plan says; the compile of such an interface notes, under
`prepare`, `an implemented interface keeps its contract;
--new-contract asks a new one`. A CONTRACT PREPARE'S DECISION
PRESERVES (supplied, the spec unchanged, kept by the change, or still
fitting) is the strict keep for the gates and the code phase alike, as
a supplied one always was: the anchor gate holds the workspace's
contract to it, and the code phase writes its text back byte for byte
when the gates hold, so the package's contract hash is the previous
one and no consumer's pin moves for a rewording of the declarations'
documentation; a contract the decision anchors is the coder prompt's
anchor, the contract the spec outgrew, to start from. Carry prepare's
amendment classification, note and failure evidence to code-phase,
AND THE AMEND SECTION OF THE CODER PROMPT for an amendment (the
sessions module's amend prompt input, which its coder prompt renders):
the previous compile's read-only directory, the seeded coder files by
name, the change record's summary line, the specification's unified
diff (empty when the prose did not move), the record's other entries
rendered as lines, the plan when a reading was made (its analysis and
every change's what and where), the failed gates' words when the
machine-checked seed failed, whether the seed passed its live tests
(`verified`, `unverified`, or a worker's) and the last live failure's
words when unverified. THE SEED handed to the code phase, by the code
source: `given`, the request's files for the agent written under the
target's `inputs/seed/` (an unsafe path refused as an uploaded one is,
`not a workspace-relative path: <path>`) with the request's coder
record; `resume`, every file under the resume seed's directory at its
relative path with the seed's coder record (the kind `given` still
when the request supplied this agent's code: a given request forbids
a session whatever snapshot the resume restored); `amend`, the
previous compile's files with its coder record, `needsChanges` when
the plan names code changes, `newContract` when the request asks one
for this target, and prepare's write-code note; `fresh`, none. An
amendment needs a session edit only when its plan names code changes
or a new contract is asked (the ask opens the session whatever the
plan says, and the session is told of it); otherwise a
machine-localized change or a plan with no code changes first re-gates
the snapshot. THE DEPENDENCIES ARE HANDED TO THE WORKSPACE BY THEIR
MARKS: a granted entry as a dependency the code imports, by its
contract; an entry the module closure linked or an implementor
scanned in, and not granted, as a scan-linked module (linked on the
plane, no stub of its own); an entry an implemented interface contributes alone as
the types alone; an entry with the registry mark as a generated module
the registry serves; the code workspace and the tester workspace are
handed the same entries. The CODE WORKSPACE is handed the custody contract (the
`cernanto/auth` contract, written as a file) whenever the spec grants
a remote mcp server (a url) or an openapi document that declares
security (a top-level `security`, or `components.securitySchemes`)
and `cernanto/auth` is not already among its dependencies: the
workspace module's hidden custody dependency, which the generated lane
module imports. A local server's grant needs no custody: its module
runs the command with the environment the command carries. THE HELD
PACKAGE'S LOCK RIDES TO THE CODE WORKSPACE as its given lock (the held
package's `lockPath`, the tree its compile certified), for a held
package that carries one, when the code source is `amend` and the
agent's npm grants are, by name, the `npm` entries of the held
package's manifest (the file at its `manifestPath`, read as JSON): the
install lands that tree and resolves nothing, so a compile that moves
no npm grant answers the lock it was handed. Adopt its
contract, coder, attempts and spend; fold its npm pins into the
compile's pins through the plan module, using the installed versions
returned by materialization, and refresh the artifact's pin slice. A
failed code result ends this target with its detail, or `the code
session exhausted its cycles` when it gives none. The code `regated`,
`amended` or `fresh` is the report's.

Store the compiled target before generating tests: its contract
joins the contract maps, for the consumers that link it in this
compile.

## The size

Once a target's code is final, after its gates and after any code
repair of a type-check triage or a live cycle, before its package is
written, ask the gates module how many functions the coder named
across THE SOURCES' `codeFiles`, and a count above 150 is a warning of
the target: one more entry of the report's `issues`, `{code: 'CW150',
severity: 'warning', agentId: <the target>, message: 'this agent
compiles to a large program: move part of what it does into another
agent that this one uses'}`, no line and no hint, which the cli prints
last with the other diagnostics as THE WARNING LINE (the author's file
by its path from the agents root, `: warning: ` and the message). A
refreshed target, whose code is the code files of the package it is
refreshed from, is counted the same; a current target, an interface and
a plan-only compile are not. The count rides in no package: it is the
code's, and a split of the page is what answers it.

## The tests

A worker, an interface and a target whose code was given have no
test phase (their verification `none`); a resumed source takes the
test phase as the source it resumes would, a given-code seed staying
given. For every other target
use test-phase with the implemented families' Tests from the workspace
first, otherwise the installed or deployed snapshot (THE FAMILY TESTS
the membership module remembered), the graph's AI closure (the plan
module's), the current contract and THE IMPLEMENTORS of each interface
the target grants: the deployed rows whose `implements` stamps name it
and the agents of this compile's plan whose specs implement it, each
with its id and type, per interface, handed to the test phase for the
tester's prompt (the tests reach the agent under test with one of
those ids where it takes an implementor's id as data). Resolve
previous tests from the held package's tester first, then the row's
testerArtifact (the membership module's saved tester). The derived
tester is a worker throughout materialization and gates; use its own
derived grants, including file and test-only npm grants; its
description carries the target, those grants, the mocks, the tester's
mcp tools, the pins, the assets and the custody contract, and no
deployed contract, so the tests reach the agents the Tests section
grants and no other. The combined
target-and-family Tests description belongs to the prompt and reuse
comparison; the tester's derived spec is written to the target's
`inputs/tester.cern.md`. Let the module decide reuse, update or
generation. AN UNVERIFIED SEED'S FAILURE RIDES WITH IT: when the seed
is unverified and THE PREVIOUS EVIDENCE answered the previous tester's
words, the test prompt's `update` carries them as its `failure`, so
the phase updates the tests with what failed; a seed nothing faulted
is handed no update, and the phase reuses its tests as they were
written. A failed result goes to the repairs module's type-check
triage (with no vendor the tests' own words end the target, `the test
session never produced tests that type-check` when they give none); a
successful one supplies the tester for live work.

THE MOCKS. When the target's parsed spec lists agents under `Mocks:`
(`tests.mocks`, already held to the plan's gates), resolve each listed
id's contract the way a dependency's is resolved (the contract maps;
an id reached only beneath another agent through the fleet's rows or
the held packages is a remembered remote contract; an id whose
contract nothing knows is left out), and its type when known, and read
its reach through the plan's AI-in-closure rule. Hand them everywhere
the tests are made: the tester workspace's `mocks` (each id with its
contract path and type); the gates' `mocks` (each id with its contract
path); the test prompt's `mocks` (each id with the file its mock goes
in, `src/mocks/<its stub file name>.ts`, the stub file name its types
import from, its contract text and its reach) and `live` (every other
agent or interface the target's own Uses names, each with its reach);
the test phase's `mocks` (each id with the hex sha256 of its contract
text, for the reuse rule); the sources' tests block `mocks` (the same
pairs); the live cycle's `mocks` (the ids) ON EVERY SHIP of the
target, the deploy and the final ship alike; the package writer's
`verified.mocks` and the report's `mocks` (the ids, the row's stamp
and the agent line agreeing). Note under `write tests`: `mocks: <the
ids joined ", ">; live: <the other reached agents joined ", ", or
"none">`. A target with no `Mocks:` hands none of this. The test
prompt names the TARGET as its agent (the agent under test, whose stub
the tests import); the tester's own id (`<id>-tester`) names the
tester's workspace, its spec and its gates. Its initial workspace and
prompt carry preparation's test assets and MCP listings (the tools of
every mcp server the tester's spec grants). The tester workspace's
`dependencies` are the agents the derived tester's Uses names beyond
the target and the mocked ids (a store the Tests section grants to
play the outside world), each resolved the way a code dependency is:
its contract through the contract maps (one with no known contract
left out), its type, and the compiled directory of a workspace agent
or installed module when it has one; an interface among them is
handed with its contract's sha. The TESTER WORKSPACE is handed the
custody contract whenever the tester's spec grants a remote mcp
server, and the held package's tests' own lock as its given lock (the
file `tests/package-lock.json` under the held package's directory,
when the package carries one), when the code source is `amend` and
the Tests section's npm grants are, by name, the `npm` entries of the
manifest's tests block. A given-code request stays given through a resumed source: no
code session, no tests and no live verification. A resume restores
every nested source file at its relative path. Each phase's complete
input is kept beside its returned state for the repairs, its session
root, derived grants, tuning, assets, family tests and dependencies
riding through every round.

## The package of a target

THE SOURCES of a target's package are assembled after its code phase
and, when it has a tester, its test phase, and handed to the repairs
module for every live round and to the artifact module's workspace
writer wherever this specification writes a package, and assembled
again after every repair (the function the repairs module is handed
for it): the spec's text; the code workspace's `src` as `codeDir` and
the workspace module's coder files of it as `codeFiles`; the file
holding the current contract (the code phase's contract text,
flattened, the one the tester's contract file holds); the workspace's
`package-lock.json` as the lock when the agent grants npm packages,
and the npm entries (each granted package to `{grant: <the pin as the
spec wrote it, when one>, version: <the version the compile's pins
hold for it>}`, a package with no version left out); the workspace's
assets folder and the granted paths (the located grants' artifact
paths); the mcp listings the lanes wrote, by module (`{server,
schemaHash: <the pin>, listingPath}`, `server` the url or the local
server's command as the grant names it, each listing file written
once under the target's `inputs/listings/<module>.json` holding
`{server, tools, instructions?}` as two-space JSON with a final
newline, the shape prepare compares a later compile's listing with; a
server with no pin is left out); the tests when the target has a
tester (the tester workspace's `src`, the workspace module's test
files of it, the tester's `package-lock.json` when its grants install
packages, `contractHash` the hex sha256 of the current contract,
`testsSectionSha` the hex sha256 of the effective Tests section text
when there is one, `mocks` the pairs, `uses` the tester's own agent
grants, `npm` the tester's entries: each package the Tests section
grants to `{grant, version}`, the version THE TESTER'S lock resolves
for it (the lock's `packages["node_modules/<name>"].version`, else its
`dependencies[<name>].version`), else the compile's pins', since a
test-only package stands in no lock of the agent's; `assetsDir` the
tester workspace's assets folder and `assets` the Tests section's
granted paths as located, so the tester's files ride the package under
`tests/assets/` and reach the running tester as an agent's own files
reach it); the implemented interfaces (`{id, contractSha}`) and the
implemented document (`{id: <the Implements entry as written>,
specHash: <the document's sha>, file}`, `file` the document's path in
the package: `files/` and the document's own file name, the name it
rides under among the granted files); the compatible contracts; and
the provenance `{cernanto: <the release
version>, compiler: <the family digest>, doctrine: <the doctrine
version>, harness: <the coder record>, tools: <the tool versions by
name>, attempts: <the attempt records' count>, triageCount, contract:
<`kept` when the compile kept the previous contract it was given or
anchored on, `written` when its session wrote one>}`. THE PROVENANCE
IS OF THE COMPILE THAT WROTE THE CODE: for a target held as a package
whose code is `regated`, whose tests were reused (or which has none),
and for which no session of this compile, a repair's included, wrote
a file, the provenance is the held package's own, the `provenance`
object of its manifest without its `verified` entry (the package
writer sets the stamp), so a package this compile had nothing to
write for comes back with the bytes it was handed. Compatibility
stamps apply only to an ordinary previous contract: breaking starts an
empty list, unchanged carries the deployed row's list, compatible
prepends the previous contract's sha without duplicates; a given
contract contributes no compatibility stamp.

THE PACKAGE FACTS of a target, handed to the live cycle with every
round and to the artifact module's package writer wherever this
specification writes a package: the version (a held package's when one
is held, else `0.0.0`) and the publisher (a held package's, when it
names one); the spec's license and copyright labels; the description
from the prose the grammar parsed (its title, the first heading's
text, and the first sentence of the first paragraph under it, joined
`<title>. <sentence>`, the one alone when the other is missing, none
when both are, the whole cut at 240 characters); the `uses` map (each
id of the agent's own agent grants to `{type: <THE TYPE of the id>,
contractHash: <the hex sha256 of the contract text the contract maps
hold for the id, the contract this compile's code was gated against;
the held package's entry's hash when the maps hold none>, range and
builtAgainst: <the held package's entry's for the id, when one is
held and carries them>}`); and the openapi documents of the agent's
grants (each granted url with a pin to `{specHash: <its pin>,
documentPath: <the document file the lanes resolved for this compile>,
onboarding: <the pin's onboarding when it has one>}`, a url the lanes
resolved no document for left out).

After every code result, including a failed repair, adopt its
cumulative attempts and spend before deciding the outcome; on success
also adopt its current contract, coder and resume pointer, and
recalculate contractChange and compatibility from that current
contract, so neither the report nor the cascade uses the first code
result after a later repair. A changed contract updates the held
contract, the tester's contract file and prompt before re-gating, and
the compatibility stamps of every package assembled after it (each
live round's) are computed from the contract that package carries,
never kept from before the repair. Keep
the latest test result after each repair or re-gate. The sources carry
the current contract, coder and attempts after every repair, so the
package written at the deploy is the code, contract and tests verified
together. Record store begin with contractChange (`contract <the
class>`) and store end `stored` around the rounds that write a
package; retain the sources and the current contract for later targets
and final rows.

The report's contractChange is none without a previous contract,
otherwise the contract module's change class. An ordinary failure
after code preparation names the last narrated detail as `"<detail>"
could not complete: <reason>`, or `the compile could not complete:
<reason>` when no step was narrated, unless the target's detail was
already set by the failing step (its own words then stand). A
triage's begin is a narrated detail like any step's, so a judge that
fails reads `"who is at fault" could not complete: <reason>`. Keep the
accumulated attempts, spend and triage evidence in that failed report
(progress `agent` end, not ok, result `failed`, the detail and the
duration). An agent failing with exactly `the compile was cancelled by
the operator` is reported with those words and nothing more. Preserve
cancellation and classified retryable or target-unavailable errors
through helper catches too, including shipping; only ordinary failures
become these reports, fallback values or notes.

## The verification

Workers, interfaces and given-code compiles have no live cycle, and
neither has AN IMPLEMENTOR OF ANOTHER MACHINE: a target that
implements `cernanto/machine` and is not the plane's machine
implementor (the id the coordinator hands in, which the plane's
machine answered of itself; `cernanto/machine/posix` without one) is compiled and gated like
any other and ships without a verified stamp, its report ok with the
detail `verified where it runs: this plane's machine is <that
id>`, so a deploy of the whole platform ends green on a box of one
machine. Without `verify` under `deploy`, verification is none.

With live verification and a target eligible for verification, first
check every granted interface against the deployed rows' implements
stamps, the workspace's planned implementors and the platform's
modules. Refuse missing implementors before the live deployment: `<id>
cannot be verified: no agent implements <ids joined ", "> (no deployed
row is stamped with it and this compile carries none); deploy an
implementor first`. THE FIRST LIVE ROUND IS THE DEPLOY: the live cycle
ships the round's pair, the target's test form and its tester under
the compile's own ids, once the tests are gated, one package carrying
the code and the tests; a target's rounds are numbered from one, and
the repairs module runs them with THE SOURCES and THE PACKAGE FACTS,
the mocked ids, the cap and the compile's judge settings. Success
records live verification (`verify` note `verified live`),
final-ships through the live cycle's candidate ship with the tester
digest (the round's deploy digest), the mocked ids and, for the
coordinator's own agent, the hold (`holdFinalShip`, the composed row
answered to the coordinator as a held ship), and then removes the
round's pair through the verify module's pair removal (the tester
first, then the test form) and marks the round shipped (the progress
module's record, through the coordinator), the pair of a held ship
left standing for the coordinator: the pair stood through the ship so
a row named the package at every moment; a removal that fails is a
failure of the platform with its words. A final ship failure is `the
final ship failed: <message>`. Waiting sets the report's verification
`waiting` and its `waitingFor`, the detail the verify module's
verification words. A worker and a given-code target under live
verify ship their final row through the live cycle's candidate ship
with no round and no tester digest (held for the coordinator's own
agent); an interface's contract row ships under `deploy` through the
live cycle's candidate ship in interface mode, its round folder `<the
target's folder>/interface` (a failure: `the interface ship failed:
<message>`).

## The end of the agent

1. The report's duration.
2. THE STAMPED PACKAGE of a report verified live is written and stored
   now, so a compile that ends before its response leaves every
   finished agent's package in the warehouse: the running package fetched
   back from the warehouse by the report's `artifact` into
   `<work>/packages/<id dashed>.cern` (a warehouse that holds none fails
   the hand-back with `the store holds no package <digest>`), written
   again through the artifact module's respin with this compile's live
   stamp (the time now as ISO, the mocked ids when any) to
   `<work>/packages/<id dashed>.stamped.cern` and stored through the
   artifact module, the response naming that digest; a report with no
   deploy digest (a compile with no live verify, a worker, an
   interface) has its package written by the artifact module's
   workspace writer from THE SOURCES of the target and THE PACKAGE
   FACTS (`{version: <the held package's, else 0.0.0>}` when the
   agent's run left no facts), with the agent id, its type, the row's
   handlers and no stamp, to `<work>/packages/<id dashed>.cern` and
   stored the same way, under a `store` step of its own (`store` begin
   `contract <the report's change class, none when it has none>`,
   `store` end `stored`): ONE FILE, ONE STORE: the file is stored
   once, so its one digest is the
   report's `artifact`, the digest its row names and the `package`
   handed back alike; nothing is stored a second time at the
   hand-back, and a compile with no live verification hands back the
   very package the plane runs.
   A CURRENT REPORT HANDS ITS PACKAGE BACK TOO, VERIFIED AS ITS ROW IS:
   the running package, fetched back from the warehouse by the report's
   `artifact` (the digest its currency named) into `<work>/packages/<id
   dashed>.cern`, is written again through the artifact module's respin
   with the fleet row's `verified` stamp when the row carries one, to
   `<work>/packages/<id dashed>.stamped.cern`, stored once and handed
   back (the artifact stays the running digest; the package the client
   writes beside the spec stays verified, byte for byte the one the
   tree already holds when nothing moved), and a row with no stamp
   hands the fetched package back as it is; so the file beside the
   spec is written on every deploy that names the agent, a lost one
   recovered from the row. An agent whose package the plane already
   runs (current on the plane) is handed back as the plane runs it, so
   a deploy leaves the tree's packages of the agents it did not change
   as they are. A package
   that could not be handed back is noted (`store` note, `<id>: the
   package could not be composed: <why>`) and leaves `package` absent
   and the agent's row out, the agent's status as it was. THE ROW OF A
   REPORT with status `compiled` or `current`: the report's `artifact`
   is THE PACKAGE THE PLANE RUNS FOR IT (the package the live cycle
   shipped; a current agent's the digest its currency named, the fleet
   row's when the disposition is current on the plane, else the
   cache's; a refreshed agent's the respun package's digest), and its
   row the artifact module's row for that package fetched back from
   the warehouse, with the stamp: this compile's live stamp `{at: <iso
   now>, mocks?}` for a report verified live, the fleet row's
   `verified` for a report current on the plane, and the tester digest
   the agent's outcome carries as `testerArtifact`; a refreshed
   agent's row is the one its own package answered. The report's
   `package` is the digest of the package handed back: the stamped
   package's for a report verified live, the stored package's own for
   a report with no deploy digest, and a refreshed agent's the respun
   package's.
3. Progress `agent` end (ok, result `compiled`, the verification and
   the accounts waited for when set, the duration, and `package`, the
   stamped package's digest, for a report verified live) with the
   detail `compiled, starts on deploy` for a worker, `compiled,
   contract only` for an interface, else the verify module's
   verification words over the report.
4. THE MAPS FOLLOW THE COMPILE: a module's or an interface's contract
   as this compile wrote it replaces the agent's entry in the contract
   maps the membership module holds (its text, its hash and its type),
   so every target still to compile resolves, type-checks against and
   pins the contract this compile produced, rather than the tree
   package's; a dependent compiled after its module in one compile
   lands with pins the plane composes.

The answer of the run: the report as filled, the issues it added (the
size warning), the row when one was composed, a held ship's row when
the coordinator's own agent was held, and the report's change class,
on which the coordinator decides the cascade.

## Tests

A run handed a compile whose request fails its contract (an empty
agent id, a target folder that is not absolute) is refused in words
before any phase. The phases, the package's assembly (its
description, its lane hosts and its compatibility stamps), the
repairs, the rounds and the plan-only answer (no session, no
artifact, no row) are proven by the coordinator's own compiles.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
