# cernanto/packages

Uses: cernanto/documents, cernanto/objects

The plane's package warehouse. Keep a .cern package's bytes as
content-addressed slices among the plane's objects, committed by a
manifest record written last; take those bytes in and hand them out,
answer the plane's questions about them, and remove a package the
moment the plane's fleet stops naming it. Everything kept is the
plane's records and objects.

## The records and the objects

The warehouse's records are the plane's records under the family
`packages`, reached through cernanto/documents, and the slices are the
plane's objects, reached through cernanto/objects. THE BINDING: each of
the two is bound with no name, so the plane binds its implementor. A
record's key and an object's name are plain text, handed exactly as
they read, a digest's `:` as it is (`packages/sha256:<hex>`). A
failure of the documents or the objects to answer is a retryable
failure in its words.

Read a record by reading its key: the string is the record's text,
and null is the answer when there is none. Write a record
compare-and-set: `expected` is the exact current string the write
rests on (null for "must not exist yet") and `value` the whole new
string (null removing the record), handed to the documents' own
compare-and-set write as they are, one attempt; the answer is what the
write answered, whether it landed and what the key holds either way.

A debug line about a record or a slice carries its key, the calling
agent and the value's LENGTH in place of the value: slices of
megabytes pass here.

## The warehouse

A package is named by its digest (`sha256:<hex>`). One digest can be
committed, removed and committed again, and each COMMIT has a NUMBER,
0 for the digest's first: the commit's slices are objects of its own,
reached through cernanto/objects, at the names
`packages/<digest>/c<number>/<n>`, zero-based, each holding the bytes
of one run of the tar (the slice as bytes, not as text: the base64
text a caller hands in is decoded before the put and encoded again
after the get). The record `packages/<digest>` says where the digest
stands, and is never removed: a MANIFEST, JSON `{version: 1, slices,
bytes, tarSha, at, number}`, how many slices the commit spans, its
total raw size, the sha256 of the whole tar in the `sha256:<hex>`
spelling, an ISO timestamp of the commit and the commit's number; or,
once that commit is removed, a REMOVAL, JSON `{version: 1, removed:
true, number, slices, next}`, the number and the slice count of the
commit removed and `next` the number the digest's next commit takes.
THE NEXT NUMBER is the removal's `next`, and 0 when the record is
absent or its text is neither shape. A manifest with no `number` is a
commit made before commits were numbered, read as the commit numbered
-1: its slices are at `packages/<digest>/<n>`, and its removal names
the number -1 and `next` 0. A package with no manifest does not exist,
whatever slices linger, and a record whose text is neither shape
reads as no manifest.

## The package functions

A package's bytes come in and go out through four functions, served
to the plane's own: a calling agent among THE RELEASE'S AGENTS (the
ids of the packages the release this process runs from carries, found
by THE SCAN below; a linked module calls as itself), THE PAIR A COMPILE MAKES TO PROVE ONE
OF THEM (a calling agent whose id is a release agent's id followed
by `-tester-` or `-under-test-`, the tester and the test form the
live cycle names for it), or the operator (an ask with no calling
agent at all); refuse any other caller in plain words saying packages
are the plane's. A `digest` is `sha256:` and sixty-four lowercase hex
characters and an `index` a whole number from zero; refuse anything
else in plain words naming the field.

THE SCAN finds the release's agents in the folder the release's
packages lie in. Read the mark, the file `materialized.json` in this
copy's working folder, with the file system's own read, and take the
`folder` of the `release` entry of its `machine` object
(`machine.release.folder`): the release this process runs from. Under
that folder's `cernanto` folder, walk every folder at any depth, a link
to a folder walked as a folder, and a folder whose name starts with a
dot left out unless its name is `.cern`: every file whose name ends in
`.cern` and that lies in a folder named `.cern` is a package, and its
id is its path from the release's folder with the `.cern` folder and
the `.cern` ending dropped, so `cernanto/compile/.cern/gates.cern` is
`cernanto/compile/gates`. The scan is made by the ask that needs it. A
mark that cannot be read, or that names no release's folder, or a
folder that cannot be read, means none: no agent is among them, and the
pair and the operator are served as ever.

`packageManifest {digest}` answers `{manifest}`: the package's
manifest as the object `{version, slices, bytes, tarSha, at}` parsed
from the record `packages/<digest>`, its number left out, or null when
the package does not exist.

`packageCommitNumber {digest}` answers `{number}`: the number of the
commit that stands (-1 for a manifest with no number), or null when
the package does not exist.

`packageSlice {digest, index}` answers `{data}`: the base64 text of
that run of the tar, the object of the slice `index` of the commit the
manifest names, or null when the package does not exist or that slice
is absent.

`packagePutSlice {digest, index, data}` writes one slice of the commit
the digest is taking: when a manifest stands the package is committed
already and nothing is written; otherwise the bytes `data` decodes to
are put as the object `packages/<digest>/c<the next number>/<index>`
(a put of the same bytes under a name already there is done). `data`
is the base64 text of one run of at most 6 MiB (6291456 bytes) of the
tar, so 8388608 characters at most; refuse longer in plain words
naming the cap. It answers `{stored: true}`.

`packageCommit {digest, slices, bytes, tarSha}` commits the package
once its slices are written, as the commit of the next number. When a
manifest stands the package is committed already. Otherwise make sure
each of the commit's slices stands (the objects' description of
`packages/<digest>/c<the next number>/<n>` for every n below
`slices`), failing for the first that does not with `slice <n> of
<digest> is missing; put it again`, then write the manifest
compare-and-set against the exact text the next number was read from
(null when the record was absent), as compact JSON with the keys in
the order `version` (the number 1), `slices`, `bytes`, `tarSha`, `at`
(the current time as an ISO string), `number`. A write that does not
land reads the record again: a manifest is another writer's commit
of the same bytes, and anything else is decided again from the text
read, for up to twenty rounds, past which the commit fails retryable
naming the record. Then THE STAMP, either way: for up to twenty
rounds, read `packages/index` (absent reads as `{version: 1, digests:
{}}`), parse it, and write it back compare-and-set against the exact
string read (null when absent) with `digests` holding every existing
entry in its place and this digest stamped `{at: <the current time as
an ISO string>}` (an existing entry of this digest keeps its place
with its stamp replaced; a new one goes last), as compact JSON with
`version` before `digests`; the first write that lands ends the
rounds, and twenty lost rounds end quietly. Answer `{digest, at}`,
`at` the committed manifest's.

`packageEntry {digest, name}` answers `{text}`: the content of the
file named `name` inside the package's tar, as utf8 text, or null when
the package does not exist or carries no such entry. Read the tar from
the slices of the commit the manifest names in order, each slice's
object the bytes of its run,
stopping once the entry sought is in hand, as a ustar archive of
512-byte blocks whose pax extended headers name the entry that
follows them and whose directories and links are walked past. Refuse
a `name` that is not a
plain relative path (a leading slash, a `..` segment) in plain words
naming the field.

## A package's end

The warehouse index is the record `packages/index`: JSON `{version:
1, digests}` where `digests` maps each committed package's digest to
`{at}`, an ISO timestamp of when it was last stored. `packageCommit`
stamps it; read it as the one enumerable list of packages, prune the
entry of a package that is removed, and treat a missing or
unparseable index as empty.

A PACKAGE LIVES WHILE THE PLANE'S FLEET NAMES IT, and its commit is
removed at the ask that follows the write that dropped its last name.

THE NAMES. The fleet is the record `controller/fleet`, the
controller's state module's, read here through cernanto/documents as
the plane's list of what is alive: JSON with `agents` rows and
`generations` rows. A digest is NAMED when any row of either list
carries it as `artifact`,
any `agents` row carries it as `testerArtifact` (a package reference
just like its artifact, even when no tester row or tester generation
exists), or any `generations` row carries it as a VALUE of its
`composition` object (module agent ids to digests). A
`previousArtifact` on an old row is not a name. Read the names whole:
when the fleet cannot be read (the read itself fails) or holds a
text that does not parse, fail the ask retryable naming the record,
the package left as it is. A FLEET RECORD THAT IS ABSENT (it reads
null) names no digest, and the ask goes on.

`remove {digest}` removes the commit that stands of a package the
fleet no longer names. `removeCommit {digest, number}` removes it only
when it is the commit numbered `number`, as `packageCommitNumber`
answered it, and with `number` null removes no commit: the plane asks
it with the number it read before it claimed the removal, and a
digest's numbers are never used again, so an ask that arrives late
removes the commit it was asked for and never a later commit of the
same digest. Both are the plane's
own: served to a calling agent among the release's agents, to the
pair a compile makes to prove one of them and to the operator (an ask
with no calling agent at all, or the gateway's); any other caller is
refused in plain words saying only the plane removes packages. Both
answer `{digest, removed}`, `removed` true when this ask removed the
commit, with `reason` when it did not: `named` when the fleet still
names the digest (a caller that asked too early gets that answer),
`absent` when no manifest stands, or, for `removeCommit`, when the
manifest that stands is another commit's.

An ask goes in this order. First the record, when the ask removes
the commit that stands: its manifest replaced by its removal,
compare-and-set against the exact text read (a lost race reads the
record again and decides again, for up to twenty rounds, past which
the ask fails retryable naming the record), so the package stops
existing at that moment. Then, whenever the record names a removal
(this ask's or one that stood before it), the slices of the commit it
removed: every slice below its count, under its number (at
`packages/<digest>/<n>` for the number -1), each the
objects' own removal, a name already gone answering the same. Then,
whenever no manifest without a number stands, the slices lingering at
names `packages/<digest>/<n>`, `<n>` a number alone after the digest,
listed under `packages/<digest>/`. The slices of a commit the record
does not name as removed are never touched. Last the index entry,
pruned unless a manifest stands.

`unnamed {}` answers `{digests}`: every digest of the index that
nothing names, oldest `at` first, each as `{digest, at}`, a read of
the index and the fleet as they stand; the operator's `doctor` shows
it.

## The runtime's seam

The runtime materializes a generation and reads its packages through
these functions and speaks their parameters in this order, a recompile
keeping them: `packageManifest` takes the digest; `packageSlice` takes
the digest and the slice index; `packageEntry` takes the digest and
the entry's name.

## Tests

The manifests, the index and the fleet are the live plane's own and
stay as they are: the tests read what the reads answer as-is. The
live warehouse keeps every package it holds:
`remove` is exercised through the answers that leave it whole (a
digest that does not exist answers `absent`), `unnamed` is called
as-is and its answer's shape asserted, and removal itself is proven
on a package the tests commit themselves and nothing names, read back
as gone with its manifest, its slices and its index entry; committed
again under the same digest, its slices put again, it is read back
whole at a number one past the first commit's, a `removeCommit`
naming the first commit's number answers `absent` and leaves it
whole, and one naming its own number removes it. The tests call as
the tester of this agent (`cernanto/packages-tester-…`, the pair a
compile makes to prove it): the package functions are served to them,
exercised where the live warehouse stays whole (an absent digest's
null manifest, slice and entry; a malformed digest, an oversized slice
and an entry name with `..` refused in words naming the field or the
cap). The refusal of a caller outside the release's agents is the
plane's own identity to prove, beyond the tester's reach.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
