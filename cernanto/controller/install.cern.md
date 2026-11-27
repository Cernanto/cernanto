# cernanto/controller/install

Type: module

Uses: cernanto/config, cernanto/packages, cernanto/controller/admission, cernanto/controller/state, cernanto/controller/streams, cernanto/controller/execution, cernanto/controller/rollout

Install agents on the plane. `ship` takes certified rows, admits them
and merges them into the fleet. `land` takes a package the plane
holds, or one the registry serves, and lands it together with the
packages it needs. `agentStart` runs an agent's program again,
`agentStartAlone` starts a module by itself, `agentTraces` sets what
an agent's traces stand at,
`agentDelete` removes an agent, `upgrade` and `drainHost` carry
the plane's own words to its machines. Refuse what does not fit, in plain
words. Note every write on the plane's timeline, through the state
module.

## Ship

`ship {protocol, op, agents}` answers `{protocol: 0, images, agents}`: `images` every agent
id on the merged fleet mapped to its artifact, `agents` the fleet's
row count. Mutate the fleet (the state module's record `fleet`):
inside each attempt, on the text that attempt read, ask the warehouse
(cernanto/packages) which of the rows' artifacts and tester artifacts
it holds (the
manifest is the package's existence), never carried from an earlier
attempt or from before the mutation, since a package the fleet stopped
naming leaves the warehouse under a claim that changes the fleet; the
admission module admits the rows on that text and those holdings or
the ship is refused in its words, and the admitted rows merge. Each named agent's row replaces its
predecessor wholesale, keeping the predecessor's `life`, its `run`
where the shipped row carries none (the count of the starts a person
asked is the agent's, whatever lands over it, so a package landed
again as it is starts nothing again) and, of the
predecessor's `traces`, a word the new row may be set to and nothing
else, by WHAT A ROW MAY BE SET TO below: `debug` is dropped once the
agent is a module, any word once the row is an interface's, a
verification pair's or the host job's, and whatever is none of the
three words, which an older controller may have carried along (a
shipped row's own `traces` is dropped: the setting is `agentTraces`'
alone to write), and every
unnamed row and every generation stay as they are. THE LIVES, asked
inside each attempt of the mutation once the refusal NO ROW IS REMOVED
FROM UNDER ITS USERS below was judged on that attempt's merged rows
(a ship it refuses asks no life), against the fleet that attempt
read and never carried from an earlier attempt or from before the
mutation: an agent runs under a life, one span of its deployment that
every later ship keeps; a shipped row new to that fleet, a shipped row
whose predecessor carries no `life` or one that fleet's `ending` list
names for its agent id, and a module row of that fleet with no `life`
are each given the life the execution module's `life` answers in that
attempt, with the agent id and the lives that `ending` list names for
that id, which is the life the name stands under then (a life a
delete ended, and whose removal finished, is never answered again); a
life that cannot be had fails the ship in that module's words; a
merged row drops
`previousArtifact`; an omitted `testerArtifact` keeps the replaced
row's for every type but a worker and an interface; a fleet marked
deleting is revived, the marker cleared. THE STANDALONE ROWS FOLLOW
THEIR MODULES, in the same mutation, before the compositions are
pinned: a standalone row of the merged fleet (one whose `form` is
`standalone`) whose `target` is no module row there, or is a module
row that carries `form` or carries no `contract` (a module is linked
by its contract, so none can run one that has none), is removed, its
`{agentId, life}` added to the `ending` list when it carries a life;
every other standalone row
takes its target row's `artifact` and, as its `usesContracts`, the
target's id mapped to the sha256 hex of the target row's `contract`
text, written where
they differ. A standalone agent has no code of its own, so it fits
its module as the module stands, whatever the module's contract
became. NO ROW IS REMOVED FROM UNDER ITS USERS, by a ship as by a
delete: when rows that stay on the merged fleet name in their
`uses` a standalone row this rule would remove, the ship is refused
before any life is asked and nothing is written, `"<the standalone id>" is "<its target>"
started by itself, and <those rows' ids, sorted, joined ", "> use it;
this deploy would remove it: remove them first, or delete it all the
same (cernanto delete <the standalone id> --force)`. THE COMPOSITIONS
PINNED, in
the same mutation: every runnable row of the merged fleet (a service,
a task, a job, a worker) gets as its `composition` and its `lives` the
composition and the module lives the rollout module computes for it
from the fleet as it now stands, written where they differ from what
the row carried (an empty one written as none, a row whose computed
composition is unsatisfiable left as it was). Then make, through the
streams module, the lane of every
merged row whose type is `task`, `job`, `worker` or absent; a lane
that cannot be made fails the ship in the module's words. Note
`fleet-shipped`, the subject the shipped ids joined `, ` and the
message `shipped <count> row(s); the fleet carries <the fleet's row
count>`.

## Land

`land {protocol, target?, targets?, noDeps?, installed?}` answers
`{landed, resolved, warnings}`, the lists in landing order: `landed` the
given packages as `{agentId, version, digest}`, `resolved` the packages
the registry supplied, each with `neededBy`, and `warnings` the lines
below. THE TARGETS are `targets`, a list of one or more, else the one
`target`; refuse a call that names neither or both: `land names its
targets as one target or a list of targets`. Several targets land as one
landing: one closure over all of them, one admission, one ship. Refuse a
protocol other than `0`: `protocol <protocol> is not the wire major 0
this plane speaks`.

A TARGET is a digest, `sha256:` and sixty-four lowercase hex
characters, naming a package the warehouse holds; or A REGISTRY
REFERENCE, an agent id (segments of letters, digits, dots, underscores
and dashes, each starting with a letter or a digit, joined by `/`),
alone or followed by `@` and `x.y.z`, `^x.y.z`, `~x.y.z` or `latest`.
Refuse anything else: `target "<target>" is neither sha256: and
sixty-four lowercase hex characters nor a registry reference (an agent
id does not read as one)`, or the same sentence ending `(the range
must be x.y.z, ^x.y.z, ~x.y.z or latest)`. Resolve a reference through
the index like a need: the fitting versions are those not yanked that
the range admits (`^` the same major at or above, `~` the same major
and minor at or above, a bare version itself alone, `latest` or no
range every version), the highest winning. Refuse a reference with no
document or no fitting version: `<target>: the registry has no fitting
version`. A document carrying `deprecated` adds the warning `<id> is
deprecated: <its message>`. The given package is a third party's when
`installed` says so; a package a reference names is a third party's
whatever `installed` says.

THE PACKAGE. Its manifest is its `cernanto.json` entry in the warehouse,
read at the same time as its `contract.d.ts` entry. Refuse a package
the warehouse does not hold, or one without the manifest entry: `<digest>
is not a package the plane holds; upload it first`; and an entry that
does not read as a manifest: `<digest> carries a manifest that does
not read as one`. Read the manifest for `name`, `version`, `type`,
`handlers`, `uses` (id to `{contractHash?}`), `implements` (`[{id,
contractSha?}]`), `specSha`, `contractHash`, `contractCompatibleWith`,
`publisher`, `tests`, `contentDigest` and `provenance`
(`verified`, `harness {name, cli?, model?, effort?}`, `cernanto`,
`doctrine` or `doctrineVersion`, `amendedFrom`, `amendDepth`). Its
contract is the `contract.d.ts` entry when the manifest carries a
`contractHash`. Its IDENTITY is `sha256:` and the sha256 hex of the
manifest entry's text.

THE CLOSURE. A package's needs are every key of its `uses` with that
entry's `contractHash`, and every `implements` stamp carrying a
`contractSha` whose id does not start with `openapi:`. Starting from the
given packages, resolve every need that is neither in the closure, nor
deployed, nor tried before, through THE INDEX: `GET
<base>/index/v1/<id>.json`, the base `registry-index` read through the
configuration agent once per landing (`https://packages.cernanto.com`
when unset or empty, trailing slashes dropped). A 5xx answer is a
retryable failure `the registry index answered <status> for <url>`. Any
other non-2xx answer, or a body that is not an index document
(`versions` rows of `version`, `packageDigest`, `url`, `contractHash?`,
`contractCompatibleWith?` and `yanked?`, beside `deprecated?`), reads as
no document. The fitting versions are those not yanked whose
`contractHash` equals the wanted hash or whose compatible list holds it
(every version when no hash is wanted); the highest by numeric triplet
wins. Fetch its blob at `<base><url>` (a `/` put between when the url
lacks one): a 5xx is a retryable failure `the registry answered <status>
for <the blob's whole url>`, and another non-2xx is refused
`<id>@<version>: the registry answered <status> for <the blob's whole
url>`. When the warehouse holds no package under the sha256 of the bytes,
put the blob into the warehouse under it. Then read its manifest as above;
its identity must equal the row's `packageDigest`, else remove the blob
from the warehouse and refuse the landing `<id>@<version>: the registry's
bytes do not match the index`. A resolved package's own needs are
resolved the same way. A need with no document or no fitting version is
unresolved: without `noDeps` refuse the landing `<the unresolved ids,
sorted, joined ", "> <is|are> needed and not deployed, and the registry
has no fitting version`; with `noDeps` add the warning `<id> is needed
and not deployed; install it too` for each.

THE ADMISSION. The admission module decides over the closure against
the deployed rows, in its words. A package whose deployed row has the
same id and the same standing (both a third party's, the row carrying
the package mark, or both the author's own, the row carrying none) is
the same agent landing again: when the running row's `artifact` is
this package's digest, or the package it names carries this package's
`contentDigest` in its manifest and the same pins (the same uses, each
at the same contract hash), the row keeps the running artifact. A
package whose pins moved lands as itself, its content the same or not.

THE ROWS, one per package in landing order (a package before the
packages that need it), the keys in this order, each optional one
present under its condition: `agentId` the manifest's `name`;
`artifact` the digest, or the running one above; `testerArtifact` the
same digest, when the manifest carries `tests`; `handlers` the
manifest's, none when absent; `uses` the keys of the manifest's
`uses`, sorted; `type` when the manifest's is `worker`, `task`, `job`,
`interface` or `module`; `implements` every stamp carrying a
`contractSha`, as `{id, contractSha}`, when any; `contractCompatibleWith`
when non-empty; `contract` the contract entry, when the manifest
carries a `contractHash`; `specSha` when present; `usesContracts` each
use's `contractHash`, when any; `verified`
the manifest's `provenance.verified`, when present; `package`
`{version, publisher?, digest}`, THE PACKAGE MARK, for a package that
is a third party's, `digest` the package's own digest in the warehouse
(`sha256:` and the hex of its bytes, whatever artifact the row keeps);
`built` `{harness: {name, cli?, model?, effort?},
cernanto?, doctrine? (the manifest's `doctrine`, else its
`doctrineVersion`), amendedFrom?, amendDepth?}`, when any is recorded.
Then one `ship` of every row.

## The release's landing

`landRelease {}` lands the packages of the release every host of the
plane runs. THE VERSION is the release the execution module's settings
report, the one every host runs, so a release lands once its last host
runs it. With none reported, or the version `0.0.0` (a repository tree,
whose dev verb lands the tree's packages itself), there is no release
to land: answer `{landed: [], skipped: <the reason>}` and leave the
plane as it is. A version the execution module reports as deployed is
landed already: answer `{landed: []}` and leave the plane as it is.
THE RELEASE FOLDER is where that version lies on this machine. THE
MARK, the file `materialized.json` in this copy's working folder, read
with the file system's own read, names the release this process runs
from: the `release` entry of its `machine` object, `{folder, version}`
(`machine.release`). When THE VERSION is that release's own, the
release folder is its `folder`; otherwise it is the folder named by THE
VERSION in the parent of that `folder`, the releases folder, where a
machine keeps every release it installed under its version's name. A
mark that cannot be read or names no release, or a release folder that
is not there, is no release to land here: answer `{landed: [], skipped:
<the reason>}` and leave the plane as it is. Else read THE RELEASE'S
RECORD, the file
`platform-release.json` in the release folder, a JSON document
`{version, packages}` whose `packages` lists the release's platform
packages, each `{id, version, packageDigest, blobDigest}`. Each
package is the file its id names under the release folder,
`.cern/<the id's last segment>.cern` in the folder of the id's other
segments, so `cernanto/compile/judge` is `<the release
folder>/cernanto/compile/.cern/judge.cern`, read as a file; its
digest, `sha256:` and the sha256 hex of its bytes, is the record's
`blobDigest` for it. The record names every package of the release,
and no other file of the folder is read for one. Refuse a release
folder with no record: `the release <version> carries no
platform-release.json`; a record that does not read as that document:
`the release <version> carries a platform-release.json that does not
read as one`; a package the record names whose file is not there:
`<id> is named by the release's record and its package is not in the
release folder`; and one whose bytes carry another digest: `<id> in
the release folder does not match the release's record`. Put each
into the warehouse as a deploy does (the package's bytes under its own
digest, unless the warehouse holds it; a package another landing
committed meanwhile, the warehouse refusing the commit for a manifest
it holds or holds no more, is held, and the landing goes on), and land
them all as one landing marked `installed`: every package the record
names a target, one closure, one admission and one ship, in landing
order, each a third party's package, the platform publisher's.
THE RELEASE'S OWN CONTROLLER FINISHES ITS LANDING: when
the ship left the row of `cernanto/controller` as it stood before the
landing (the same `artifact` and the same `composition`), or wrote it
on a fleet that had none, tell the execution module the version is
deployed; when the ship moved that row, leave the word unwritten: the
controller the landing put on the fleet lands the release again once
it runs (a package already landed lands as it is) and writes the word.
Answer `{landed}`, the ids in landing order. A refusal or an
unavailability on the way leaves the word unwritten too, and the next
ask lands again; note
`release-landed` (`the release <version> landed <count> package(s)`,
followed by `; the controller it put on the fleet lands it again`
when the word is left for that controller).

## The operator's writes

`agentStart {agentId}` sets the row's `run` to one more than it was
(absent reading as zero), in one mutation of the fleet, and answers
`{agentId, run}`. Refuse an agent with no row: `no agent "<agentId>"
on the fleet`; the row of `cernanto/host`, the host job, whose
generation stands for the life of the plane whatever its row says, so
that a start of it would start nothing: `"<agentId>" is the host job;
it runs for as long as its host does, and starts again when its host
does`; a standalone row, one whose `form` is `standalone`:
`"<agentId>" is "<its target>" started by itself; delete it and the
next call of "<its target>" starts it anew (cernanto delete
<agentId>)`; a module's row: `"<agentId>" is a module; a call of it
starts it by itself (cernanto call <agentId> <function>)`; and a row
of any other type that is neither a worker, a service (absent reading
as a service) nor a job: `"<agentId>" is a <type>; only a worker's, a
service's or a job's program starts`. AN AGENT THAT IS STARTED AGAIN
MUST BE ABLE TO START, by the reading the traces' write below makes:
a row whose composition the rollout module computes as unsatisfiable
on the fleet that attempt read is given no new generation, so a start
of it would be counted and would start nothing. Refuse it in that
attempt and leave the fleet as it is: `"<agentId>" cannot start again
as it is deployed: a module it uses changed its contract since it was
compiled; deploy it again, compiled against the module as it is
deployed now (cernanto deploy <agentId>)`. Note `agent-started`
(`run <run> of "<agentId>" asked`).

A MODULE IS STARTED BY ITSELF by `agentStartAlone {agentId}`, which
answers `{agentId, started}`: the id of the module's standalone agent,
and whether this ask put it on the fleet. THE STANDALONE AGENT of a
module is one
row beside the module's own, a service that links the module and has
no function of its own: `{agentId: <the module's id>-standalone,
artifact: the module row's, handlers: an empty list, uses: a list of
the module's id alone, usesContracts: the module's id mapped to the
sha256 hex of the module row's `contract` text (an absent contract
hashing as the empty text), form: 'standalone', target: the module's
id, run: 1}`, a service's row, so it names no type. A module's standalone
row on a fleet is the row under that id whose `form` is `standalone`
and whose `target` is the module. Refuse an agent with no row: `no
agent "<agentId>" on the fleet`; and a row that is no module (absent
type reading as a service): `"<agentId>" is a <type>; a module is
what starts by itself`. Refuse the start of a module row
that carries `form`, the test form of a verification pair, which is
the compile's own: `"<agentId>" is a compile's test form; it is not
started by itself`. Refuse the start of a module row that carries no
`contract`, which no agent can link, its standalone agent among them:
`"<agentId>" carries no contract; a module is linked by its contract,
so it is not started by itself`. Any other module row is started by
shipping its standalone row by `ship`'s own mutation, so its
admission, its life, the
pinned compositions and its note are the ship's: inside each attempt,
on the fleet that attempt read, the row is composed from the module's
row as it stands there. A MODULE THAT IS STARTED IS ANSWERED AS IT
STANDS: where, in that attempt, its standalone row stands on the fleet
the attempt read, nothing is written and the answer is `{agentId: <the
standalone id>, started: false}`, so two asks made at the same moment
are one start.
Refuse, in that attempt, a module whose standalone id is taken
by a row that is not its standalone row: `"<the standalone id>" is on
the fleet and is not "<agentId>" started by itself; remove it first
(cernanto delete <the standalone id>)`. Where the row was shipped,
answer `{agentId: <the standalone id>, started: true}` and note
`agent-started`
(`"<agentId>" started by itself as "<the standalone id>"`). A module
by itself is ended by the delete of its standalone agent, which ends
that agent's life: a start after it is another agent under the same
name, so no call made after it is taken by a copy of the run before.

`agentTraces {agentId, traces}` sets what an agent's traces stand at,
`on`, `debug` or `off`, in one mutation of the fleet, and answers
`{agentId, traces, changed, starts}`. WHAT A ROW STANDS AT is the
rollout module's answer for the row and the release's agents, asked
of the execution module once, before the mutation.
Refuse, the first of these that holds: an agent with no row: `no agent
"<agentId>"`; a value that is none of the three: `traces are set to
on, debug or off, not "<traces>"`; an interface's row: `"<agentId>" is
an interface; it runs no code, so it keeps no traces`; a row of a
verification pair, one whose `form` is `test` or `tester`:
`"<agentId>" belongs to a compile's test run, which is always traced
in debug`; the row of `cernanto/host`, the host job: `"<agentId>"
keeps no traces; its log is its record`; and `debug` for a module's
row: `"<agentId>" is a module; a module's traces are on or off, and
its debug lines are kept where an agent that links it is set to
debug`. WHAT A ROW MAY BE SET TO is what these refusals leave: `on`,
`debug` or `off` for a runnable row, `on` or `off` for a module's row,
and nothing for an interface's row, a row of a verification pair and
the host job's. Inside each attempt, on the fleet that attempt read: the row's
`traces` is set to the value, or removed when the value is what the
row stands at with no `traces` on it, so the fleet keeps a setting
only where it differs from what stands without one. `changed` says
whether what the row stands at moved. When nothing changed, the fleet
is left as that attempt read it, the row untouched: a write that says
nothing changed starts no agent. `starts` lists the agents that
start again for it, each `{agentId, type}` (`service` for a row with
no type), sorted by id: none when nothing changed; the row itself when
it is runnable; for a module's row, every runnable row but the host
job's whose composition names the module, the one the row carries
pinned, else the one the rollout module computes for it. AN AGENT
THAT STARTS AGAIN MUST BE ABLE TO: a runnable row whose composition
the rollout module computes as unsatisfiable on that fleet is given no
new generation, so a setting written for it would not reach its
copies. When something changed and `starts` lists such rows, refuse
the write in that attempt and leave the fleet as it is: for the row
itself, `"<agentId>" cannot start again as it is deployed: a module it
uses changed its contract since it was compiled; compile it against
the module as it is deployed now, then set its traces`; for a module's
row, `"<agentId>" is linked by <those rows' ids, sorted, joined ", ">,
which cannot start again as deployed: a module used there changed its
contract since the compile; compile against the modules as they are
deployed now, then set its traces`. Note
`agent-traces` (`the traces of "<agentId>" set to <traces>`) when
something changed.

`agentDelete {agentId, force?}` removes an agent's row, and with a
module's row its standalone row. Refuse an agent
with no row: `no agent "<agentId>"`. The dependents are the rows that
stay whose `uses` name a row the delete removes, the agent's own or,
for a module, its standalone row; when there
are any and `force` is not set, answer
`{dependents}` alone and leave the fleet as it is. Otherwise remove the
row in one mutation, and with a module's row its standalone row, add
`{agentId, life}` to the fleet's `ending` list for each removed row
that carries a life, for the reconcile to remove its traces and
its journal, mark the fleet deleting
when no row remains, and answer `{removed, fleet, dependents}`: the
agent id, the rows remaining and the dependents. Note `agent-deleted`
(`"<agentId>" removed from the fleet`).

`upgrade {version}` and `drainHost {host}` are the plane's own
words, carried to the execution module: hand the version
or the host to its function of the same name, and answer what it
answers, a refusal included. Note `upgrade` (`the release pointer names
<version>`) and `host-drain` (`host <host> drains`) when the backend
answered.

## Tests

Every write here reaches the live plane the tests run on, so the tests
exercise what mutates nothing, the refusals:
a `ship` refused before anything is written (a wrong protocol, a wrong
op, a spelling that collides with a deployed agent's, an artifact the
catalog holds nowhere); a `land` refused before anything is read or
written (a wrong protocol, a target that is neither a digest nor a
reference); a well-shaped digest the warehouse holds no package under; a
reference whose id the index has no document for; a start, a start by
itself and a delete of an agent with no row; a start of a task the
plane runs (`cernanto/controller`), of a module of the plane
(`cernanto/controller/state`) and of the host job (`cernanto/host`),
each in its own words; a start by
itself of an agent the plane runs that is no module
(`cernanto/controller`, a task); a traces write for an agent with no
row, with a value that is none of the three, for an interface
(`cernanto/documents`), for the host job, and `debug` for a module
(`cernanto/controller/state`); and the release and the drain, which
the execution module refuses on a plane of one machine. An
admitted ship or write is proven by the plane's own tier.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
