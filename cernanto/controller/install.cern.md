# cernanto/controller/install

Type: module

Uses: cernanto/config, cernanto/packages, cernanto/controller/admission, cernanto/controller/state, cernanto/controller/streams, cernanto/controller/execution, cernanto/controller/rollout

Install agents on the plane. `ship` takes certified rows, admits them
and merges them into the fleet. `land` takes a package the plane
holds, or one the registry serves, and lands it together with the
packages it needs. `agentStart` runs an agent's program again,
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
predecessor wholesale, keeping the predecessor's `life`, and every
unnamed row and every generation stay as they are. THE LIVES, asked
inside each attempt of the mutation, against the fleet that attempt
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
deleting is revived, the marker cleared. THE COMPOSITIONS PINNED, in
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
on the fleet`; and one whose type is neither a worker nor a service
(absent reading as a service): `"<agentId>" is a <type>; only a
worker's or a service's program starts`. Note `agent-started` (`run
<run> of "<agentId>" asked`).

`agentDelete {agentId, force?}` removes an agent's row. Refuse an agent
with no row: `no agent "<agentId>"`. The dependents are the other rows
whose `uses` name it; when there are any and `force` is not set, answer
`{dependents}` alone and leave the fleet as it is. Otherwise remove the
row in one mutation, add `{agentId, life}` to the fleet's `ending` list
when the row carries a life, for the reconcile to remove its traces and
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
reference whose id the index has no document for; a start and a
delete of an agent with no row; and the release and the drain, which
the execution module refuses on a plane of one machine. An
admitted ship or write is proven by the plane's own tier.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
