# Compile Membership

Type: module

Uses:
- cernanto/compile/plan
- cernanto/compile/grammar
- cernanto/compile/judge
- cernanto/compile/artifact
- cernanto/compile/verify
- cernanto/compile/contract
- cernanto/compile/lanes
- cernanto/controller
- npm:fs-extra

Know what a compile is made of before anything compiles: the fleet's
rows and the texts they carry, the packages held from the tree, the
foreign packages placed as specs, the ladder that resolves every granted id the workspace does
not hold, the rows served as they are, the type and the module links
of an id, and the ladders that
answer an agent's previous contract, its saved tests and its previous
pins. The compile front (the coordinator, which links this module)
hands in the compile's request, its settings and its work folders,
keeps what this module holds for the compile (THE MEMBERSHIP: the rows
by id, the texts, the held packages, the remembered contracts and
types), and narrates through its
own progress; the notes this module has to say are answered as text
for the coordinator to record. Every path handed in and answered is
absolute. The shapes its functions take and answer (the compile's
settings and folders, THE MEMBERSHIP, a row, a held package, a
reading, a dependency entry, the pins) are declared in its own
contract, whatever module they came from.

## The rows and the texts

THE DEPLOYED ROWS are read at the start of every compile through the
verify module's deployed rows (a read that fails reads as no rows):
each row's id, type, `contract` text, `implements` entries, `uses`,
`artifact`, `testerArtifact`, `verified` stamp and
`contractCompatibleWith`. THE DEPLOYED TEXTS are the rows that carry a
contract, by id, each with its type, the interface ids its
`implements` stamps name and its artifact when it has one (the
package the plane runs for it). A compile may grant any row of the
fleet; a package held in the workspace for an id stands as the
contract of that id before the fleet's row does (THE TREE PACKAGES,
below), so a workspace that holds a package for every agent it grants
compiles whatever the plane's rows say: the tree is the truth for a
compile of the plane's own specs, and a plane whose controller is
mid-change still compiles its own agents. The deployed agents are the
rows' ids with their `uses`; the deployed modules are the rows of
`type: 'module'`; THE DEPLOYED IMPLEMENTORS of an interface id are the
deployed rows whose `implements` stamps name it, sorted, every
interface any row's stamps name, whether or not the workspace
implements it, each to those rows' ids sorted (nothing when no rows
were read): what the plan and every sub-plan are handed.

A DEPLOYED MODULE IS READ AS A PACKAGE, like every deployed agent:
its contract and its facts out of the package the store holds by the
row's artifact (THE DEPLOYED TEXTS). A compile holds no module's
directory and runs no materialize: a linked module's code reaches its
consumers on the plane, where the runtime materializes the consumer's
package with the module composed in.

## The tree packages

THE TREE PACKAGES: the request's `packages` (for each id, the digest
of the `.cern` package beside the agent's spec in the workspace, which
the client put into the plane store before submitting) are HELD BY ID
AS DIGESTS, and a package is fetched and read ONLY FOR AN ID IN THE
COMPILE'S SCOPE: every id the plan module's compile scope answers (the
targets closed downwards over their workspace dependencies, and the
dependents the plan recompiles; a target's workspace dependency is in
the scope and its package is read, so a dependency with no row on the
plane ships from the tree in place of a session), and a module linked
into one of those, transitively (a link followed for a workspace
spec's agent grants and a held module's uses, to an id that is a
module or that nothing knows yet); the reads happen once the scope is
known, the targets first, in sorted order per round of the walk, and
every other named package stays in the store unread. For an id in the
scope: the store fetch of the digest into `<work>/inputs/tree/<id
dashed>.cern` (a store that does not hold it, or a fetch that fails,
notes (`prepare`) `<id>: the package named for it is not in the plane
store; compiling without it` and holds nothing); the artifact module's
package reader into `<work>/inputs/tree/<id dashed>/` (a read that
fails notes `<id>: the package beside it does not read back (<why>);
compiling without it`, and one the reader answers nothing for notes
`<id>: the package beside it does not read back (it is not a
package); compiling without it`, each holding nothing); a package
whose `name` is not the id fails THAT AGENT before anything else, with
zero attempts, `the package beside <id> names <name>; a rename is a
new agent: move the package with the spec, or remove it and
recompile`, a failure this module remembers for the id and the
coordinator reports when the agent's turn comes. Otherwise the package
carries no artifact: nothing is put into the store at the read, and
it is HELD by id with the reader's whole answer (its `previous`, its
`deployedTests`, its digests, its stamp and the tester digest the
stamp names, its license, copyright and publisher, its uses with each
entry, its contract hash per use, its interface stamps, its compatible
contracts, its lock paths, its spec snapshot, its granted files'
folder, its documents). Note (`prepare`) `<id>: the package in the
tree (<the content digest's first 10 characters after "sha256:">)`.
Its projection as the row (below) is `{agentId, artifact: '', type,
contract (the package's text), specSha, uses (the ids), usesContracts
(each use's contractHash), implements (the interface entries),
contractCompatibleWith, verified (the package's stamp's `at`),
package: {digest, version, contentDigest}}`, with no artifact and no
testerArtifact, EXCEPT when the fleet's row for the id RUNS THE
PACKAGE'S CONTENT: its `artifact` equals the held package's digest, or
the package its `artifact` names (fetched from the store into
`<work>/inputs/rows/` and read by the artifact module's package
reader; one that is no package runs other content) carries the held
package's content digest: then the fleet's row stands unprojected
(that content already runs on this plane: the disposition answers
`current on the plane`), and the held package serves only the read of
its tests and code. THE ROW OF AN AGENT, wherever the compile reads an
agent's OWN row (the code source and the previous compile, the
previous contract, the saved tests and tester artifact, the verified
stamp): the held package projected as a row
when one is held for the id, else the fleet's row. The tree wins over
the fleet: a held package seeds the compile even when the fleet's row
is newer. The fleet's rows keep every other role (served rows, the
membership ladder, the cascade's deployed agents, the implementor
preflight): a package alone passes for no deployment.

## The workspace

THE WORKSPACE: THE FOREIGN SPECS join first (below), then every
candidate the plan module's scan finds is parsed through the grammar
as uploaded (the parse answers the kind: the page's `Type:` line,
else a task); the parsed candidates (each spec in the plan module's
parsed shape, member for member, its `implements` always a list and
its Tests grants under `grants` beside `uses`) are written to `<compile root>/inputs/plan/parsed.json` and
resolved through the plan module into `workspace.json` beside it, the
workspace the compile reads. Parse failures are kept for the gates.
THE FOREIGN SPECS: for each id of the request's `packages` that no
workspace spec claims, in sorted order, the package is fetched and
read as THE TREE PACKAGES reads one and joins the workspace: its spec
snapshot is written as the id's spec (the spec file `<leaf>.cern.md`,
the leaf the id's last part, under the folder its earlier parts name,
with the line `Type: <the manifest's type>` placed after the
snapshot's first line when the snapshot states no `Type:` line and
the manifest's type is not a task, since the kind is the page's own
to state; so the plan orders it, the compile derives it before its
consumers, and the ladder has nothing to resolve for it), and its
granted files (the reader's
`assets/`, each under its own name) are placed at the paths the
snapshot's grants name (a `file:` grant's path relative to the spec,
or from the agents root under `/`; a folder grant's contents under it;
an implemented document's path the same way; a file no grant names
stays unplaced); note (`plan`) `<id>: using the package in the tree`;
it is a target only when named. The asks of the free candidates run at the same time.

THE READING NOTES of an agent, answered as the lines the coordinator
records (`plan` notes whose subject is the agent's id) once the
agent's generation is decided and is not current, say what the compile
read from the page's labels, so its author sees what was understood
before anything is written, as THE WORKSPACE recorded them when it
took the page in (this function reads no file again). The notes, in
this order: `reads a <type>, from the Type: label` when the page
writes a `Type:` line, and `reads a task` when it writes none (the
article is `an` before `interface`: `reads an interface, from the Type:
label`); `reads Uses: <the entries joined by ", ">` when the
head grants any (the labels' entries as written: an agent's path with
its `@<pin>` when one, `npm:<package>` with its pin, `mcp:<server>`,
`openapi:<url>`, `file:<path>`), a local server's entry (`mcp:` and a
command) followed by ` (the module <name>)`, the lanes module's name
for its command, so the author sees the module the coder imports;
`reads Implements: <the entries>` when any; `reads License:
<license>` and `reads Copyright: <the entries joined by "; ">` when
the page labels them; and, when the page has a Tests section whose
labels use or mock anything, `reads the tests` followed by `; Uses:
<the entries>` when the tests use any and by `; Mocks: <the entries>`
when they mock any.

## The ladder

THE MEMBERSHIP LADDER resolves every id a workspace spec grants (its
`Uses` and its Tests section's) that is not a workspace agent, plus
every `Implements` interface id not in the workspace (an entry
starting with `openapi:` is a document, not an id, and stays out), in
a queue (ids sorted at the start; a resolved MODULE's own uses join
the queue the same way, so the whole closure the consumer composes is
held). THE REGISTRY NEEDS, before the ladder: the fleet's rows read
once; for each id of the queue, in order, that no row carries, ask
the controller to land it from the registry, `land(0, <the
reference>, undefined, true)`, the reference the id alone, or the id,
`@` and the grant's pin when the grant carries one (the first grant
that carries a pin deciding); a landing that answers notes (`plan`,
the id its subject) `<id>: not in the workspace; installed from the
registry at <the landed version, "unknown" when the landing names
none>`, and the rows and the deployed texts are read again before the
ladder; a landing refused notes `<id>: not in the registry (<the
refusal's first line>)` and the id goes to the ladder as it is (a
retryable or target-unavailable failure propagates); the landings run
one after another. Then for each id, in order (a package held for the
id is out of the ladder's reach: THE FOREIGN SPECS put it in the
workspace):
1. THE DEPLOYED ROW: the fleet's row of the id when it carries a
   contract. Its type is the row's `type` read as a compile type (any
   of the six agent types; absent or unrecognized is a service). For
   an interface or module row with an artifact, the store fetch of
   the artifact into `<compile root>/deployed/<id dashed>.cern`, read
   by the artifact module's package reader for ITS FACTS (its type,
   uses, contract and spec snapshot; the family Tests section an
   interface's snapshot carries, parsed by the grammar, the kind the
   manifest's); a module's uses join the queue. A module row with no artifact, or
   whose bytes the store cannot answer, is NOT resolved: note (`plan`)
   `<id>: deployed as a module, but its bytes could not be read from
   the store`, next id. Otherwise the row's contract (the facts' when the package
   carries one; REMOTE CONTRACTS remember it by id), type (the facts'
   when the package states one; INSTALLED TYPES) and artifact digest
   (INSTALLED DIGESTS) are remembered, an interface's family Tests
   section read from its snapshot when any (THE FAMILY TESTS, by
   interface id); note `<id>: not in the workspace; using its deployed
   row (<type>)`. Resolved.
2. THE RUNNING CONTRACT: the previous-contract ladder of the id, when
   it answers (a failure answering nothing): the contract remembered;
   note `<id>: not in the workspace; using the running contract`.
An id no rung answers stays unresolved (the spec gates name it); the
ids resolved are answered for the gates as the remote agents.

THE TYPE of an id: its workspace spec's type, else its installed type,
else its deployed text's type, else `service`; the ladder answers the
same before and after this compile records a compiled contract for
the id, since a recorded contract moves THE CONTRACT MAPS alone
(below). THE DIRECT MODULE LINKS
of an id: for a workspace spec, its module grants plus, for each
granted interface, the deployed implementors of that interface other
than the id itself (no repeats); for an id with a held package or a deployed package read, that
package's manifest: its `uses` that are modules plus its `links` (no
repeats; an unreadable manifest gives none); else none. THE
MODULE CLOSURE of a list of ids is the flattened breadth-first walk
over the direct links.

SERVED ROWS (skipped when no rows were read; a recompile skips nothing
here, its flag reaching the named targets alone): over the ids handed
in, in their order, a non-target workspace agent with a spec is SERVED
from its deployed row when the row carries a contract and a spec sha
equal to the sha256 of the spec file's text, its type read as above
equals the spec's type, no package held from the tree for the id
carries another contract or other content (a tree package current
for its spec whose contract, or whose content digest against the
row's artifact, differs from the row's is newer than the row, an
earlier compile's unshipped work, and the agent is compiled or landed
from it, current from the tree, rather than served from the row; the
row's package is never handed back over it), and every workspace
dependency of the
agent (the plan module's dependencies over the shape) is served too;
a served MODULE's contract and facts are read from its package (the
store fetch of the row's artifact into `<compile root>/deployed/<id
dashed>.cern`; a module the store cannot answer is compiled instead).
A served agent's contract joins the contract maps.

## The ladders of an agent's past

THE PREVIOUS CONTRACT of an agent, read on demand: the request's
supplied contract, marked given; else the held package's contract
with the package's spec identity, when one is held for the id; else
the running contract through the verify module (a read that fails
answering nothing); else the saved tester's contract through the
artifact module. THE SAVED TESTER is resolved DOWN THE SAME LADDER,
read once per agent for the ladder and the test phase alike: a held
package's `deployedTests` (already read; handed to the test phase as
`previousTests`) when one is held for the id and carries tests, else
the target row's testerArtifact: the package fetched from the store by
that digest into `<work>/inputs/artifacts/<the digest sanitized>.cern`,
read by the artifact module's package reader into
`<work>/inputs/tests/<id dashed>-package` for its `deployedTests` and
its contract and handed to the test phase as `previousTests` the same
way (the tree's package carries the tests the plane certified with it,
so a lab whose row is gone reuses them); a store that holds none, a
read that fails or a package without tests answers no tester. The
returned spec identity is kept; an unavailable read supplies no
contract.

THE PREVIOUS PINS of an agent are the `lock` object of its previous
compile, read down a ladder that stops at the first rung answering
pins: the `lock` of a `provenance.json` among the request's given
files for the agent, read as JSON (a given compile keeps the pins its
bytes were certified with); then the held package's `previous.lock`
when the target holds one (THE TREE PACKAGES); then the
`previous.lock` the artifact module's package reader answers over the
fleet row's artifact fetched from the store when the row carries one.
Given files without a provenance among them, a file or a fetch that
is absent or fails to read, or a provenance without pins, answer
nothing at their rung and the ladder goes on; a ladder that answers
nothing answers nothing (a failure of the read, a cancellation and a
classified failure aside, is the same).

THE DEPENDENCIES of a target resolve from this compile's agents (the
contracts recorded as they compile), the held packages, the deployed texts and the
remembered remote contracts, in that order, the whole module closure
(the directly granted modules and their descendants) and the scanned
implementors included: each entry its id, its directory (empty for a
contract-only dependency), the file holding its contract when one is
known (written under the target's inputs as `inputs/contracts/<id
dashed>.d.ts`), its type and its marks. An implemented interface the
target does not grant contributes its types alone; a scanned
implementor links without granting an import; an implemented openapi
document is an anchor and a coverage contract, with no dependency
module of its own. EVERY DEPENDENCY IS HANDED BY ITS CONTRACT, a module like a wire
agent: the text the contract maps hold for it (a module compiled in
this run records its contract there), inline and with no directory,
whether it is a workspace agent, served, current, refreshed, deployed
or known by a remembered remote contract; the registry mark goes to
registry modules alone (as the plan module's registry rule reads it);
the code workspace and the tester workspace get the same resolution,
so every granted contract type is importable in both.

THE CONTRACT MAPS name every agent or interface a target's Uses,
Implements and Tests section name, each with its type and its
contract when one is known: this compile's agents as they were
compiled (THE MAPS FOLLOW THE COMPILE: a module's or an interface's
contract as this compile wrote it replaces the agent's entry, its
text, its hash and its type, so every target still to compile
resolves, type-checks against and pins the contract this compile
produced, rather than the tree package's), the held packages, the
deployed texts and the remembered remote contracts, in that order.

## Tests

Uses: npm:fs-extra

Over a workspace of the tests' own under a folder of their own,
written with the granted file package: the
type of an id falls from the workspace spec to the deployed text to
`service`; the direct module links and the closure follow a workspace
spec's module grants and a granted interface's deployed implementors
without repeats;
the reading notes say `reads a service, from the Type: label` for a
page with a `Type:` line, `reads Uses: ...` with a local mcp server's
module name, and `reads a task` for a page that states no kind; a
foreign package whose snapshot states no kind joins the workspace as
a page with the `Type:` line its manifest's kind writes. The rows,
the packages and the ladder are proven by the coordinator's own
compiles.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
