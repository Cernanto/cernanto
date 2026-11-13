# Compile Artifact

Type: module

Uses:
- cernanto/compile/contract
- cernanto/config
- cernanto/machine
- cernanto/packages
- npm:fs-extra

Keep the certified bytes of a compile. Compose the package a tree
keeps from a verified workspace (what the model wrote and the pins,
from which a plane derives the directory it runs), put a file's bytes
into the plane's warehouse (cernanto/packages) and fetch them back, and
read a package for what it says about itself. Every document an
operation takes rides in as the path of a file (the spec, the
contracts, the listings, the coder's files), and every document one
answers is written to a file under a directory the caller names: the
compile's trace records paths. A file
or directory an operation cannot read is a terminal failure naming the
field and the path (`<field>: cannot read <path>: <why>`).

EVERY LINK this module makes is made by the machine (the machine interface bound with no name, the implementor the
plane binds; an implementor that cannot
be bound fails the call in its words): the link path, the target text as the operation names it
and whether the target is a directory; the machine makes the link the
system's way and removes a previous entry at the link path first.

## The resume seed

A compile keeps the gate-passed coder files of an agent whose compile
has not ended, so a re-run of the SAME compile after a crash resumes
them without paying the session again; the seed lives by compile id
and dies with the compile.

- `storeResumeSeed` takes `seedRoot`, `compileId`, `agentId` and
  `filesDir`, then optionally `harness`. A files directory that does
  not exist is the unreadable-input failure, before anything is
  removed. The seed directory is `<seedRoot>/<the compile id with
  every character that is not a letter, a digit, a dash or an
  underscore replaced by a dash>/<the agent id with every slash
  replaced by a dash>`; it is removed whole, then every file under the
  files directory, at any depth, is copied to the same relative path
  under it. The coder record, when given, is written as compact JSON
  followed by a newline to `<the seed directory>.harness.json` beside
  it; when none was given that file is removed.
- `resumeSeed` takes `seedRoot`, `compileId` and `agentId` and answers
  nothing when the seed directory does not exist or holds no file at
  any depth; otherwise `{directory, harness?}`, the coder record
  parsed from the file beside it when that file exists and parses.

## The tar format

Every tar this module writes or reads is a ustar archive of 512-byte
blocks, deterministic byte for byte: the same entries in the same
order are the same bytes on every machine. The writer takes the
entries in order: every header field not named here is zero (the uid,
the gid, the mtime), the magic is `ustar` with a NUL and the version
`00`, the checksum the standard one. A file is type flag `0` with mode
644 (755 when the entry is executable) and its content padded with
zero bytes to a multiple of 512 (no blocks at all for an empty file);
a directory is its name with a `/` appended when it has none, type
flag `5`, mode 755; a symbolic link is type flag `2`, mode 777, its
target in the link name (a link without a target is a failure). When
a name (a directory's with its slash) exceeds 100 bytes in utf8, or a
link's target does, a pax extended header precedes the entry: a
header block named `PaxHeaders/` followed by the first 88 characters
of the name, mode 644, type flag `x`, whose content is the records
`path=<name>` and `linkpath=<target>` for what did not fit, each
spelled `<length> <key>=<value>` and a newline with `<length>` the
decimal byte count of the whole record; the entry's own header then
carries the name cut to its first 100 characters and, for a target
that did not fit, an empty link name. Two zero-filled blocks end the
archive.

The reader walks the blocks: a block of zero bytes only is skipped; a
type flag `x` block's records apply to the NEXT entry and produce none
of their own (`path` overrides its name, `linkpath` its target); type
flag `0` or NUL is a file (with its content), `5` a directory (a
trailing `/` stripped from the path), `2` a symbolic link (with its
target), anything else `other`; an entry's mode is read from its
header.

## The warehouse

A package's bytes live in the plane's warehouse, cernanto/packages, which
keeps them: it answers a package's manifest, hands out its slices
one by one, takes a slice in create-once, and commits a package by
writing its manifest last. This module asks the warehouse for each of
those and keeps no road of its own to the bytes. A package is named by
its digest (`sha256:<hex>`). A call the warehouse fails is the failure
itself, in its words.

THE PUT (the tail of `storeBytes`), with a file's bytes and their digest: the
warehouse is asked for the package's manifest first. When it holds one,
the bytes are there already, and the package is committed again with
that manifest's own figures, which renews its stamp in the warehouse;
otherwise the bytes are cut into slices of 6291456 bytes as the warehouse
takes them, the slices are put four at a time (a batch of four in
parallel, the batches in order), and the package is then committed
with the slice count, the byte count and `sha256:` followed by the
hex sha256 of the whole. The digest is answered either way.

THE GET (`fetchArtifact`): the warehouse is asked for the package's
manifest; when it holds none, the answer is `found: false`. Otherwise
the slices the manifest counts are asked for four at a time in order;
a slice the warehouse does not hold is a retryable failure `the package
<the first 19 characters of the digest>... is missing slice <n> of
<slices>`; each is decoded and the runs concatenated. When `sha256:`
followed by the hex sha256 of the bytes is not the manifest's sha,
a terminal failure `the package <the first 19 characters of the
digest>... failed its manifest sha check`. The bytes are written to
the tar path given (parents made); the answer is `found: true`.

## The package

A `.cern` package is the one unit an agent's certified inputs travel
and rest in: what the model wrote, the author's inputs and the pins of
the world at compile time, in one uncompressed tar (the tar format
above) from which a plane DERIVES the artifact. It carries no
artifact, no installed package and no emitted module. Its root holds
the manifest `cernanto.json`, npm's own `package-lock.json` when the
agent grants npm packages, the spec snapshot named `agent.cern.md`
whatever the type, `contract.d.ts` when
the agent has a contract, and the folders `code/` (the coder's own
files at their paths under the workspace's `src`), `tests/` (the
tester's files by name, the mocks among them at `tests/mocks/<name>`;
`tests/package-lock.json` is the tester's own lock when the tests
grant npm packages), `files/` (the granted files at their paths) and
`openapi/` and `mcp/` (the documents fetched at compile time, each at
the path its manifest entry names). The one file allowed outside the
manifest's record is `cernanto.sig`, a detached signature.

THE MANIFEST is a JSON object written with its keys sorted at every
depth by their UTF-16 code units (the language's plain sort, which no
locale moves: `VERSION` before `language`; objects inside arrays
included), two-space indentation and a trailing newline, holding:
`packageFormat` 4; `name` the agent id; `version` the version given,
`0.0.0` when none; `type` the agent's type; `target` `{language:
"typescript", runtime: "node"}`; `description`, `license`, `copyright`
and `publisher`, each only when there is one; `specSha` the hex sha256
of the spec's text; `contractHash` the hex sha256 of the contract's
text, only when there is a contract; `contractCompatibleWith` only
when not empty; `handlers`; `uses` an object from each dependency id
to `{type, contractHash?, range?, builtAgainst?}` (the dependency's
agent type, a module entry being a link; the contract hash the code
was written against, when known); `implements`, sorted by id, each
`{id, contractSha}` for an interface and `{id, specHash, file}` for an
implemented document (`id` the grant as written, `openapi:<the
document>`; `file` the document's path in the package, `files/` and
the granted path, an implemented document being a granted file), only when
not empty; `npm` an object from each granted package to `{grant?,
version}` (`grant` the pin as the spec wrote it, absent when none was
written; `version` the one the compile installed, always); `openapi`
from each granted url to `{specHash, file, onboarding?}` (`onboarding`
the pinned words `{helpUrl, instructions, scopes, road?, credential?}`
when the pins carry them for the url) and `mcp` from each granted
server (a remote server's url, or a local server's command) to
`{schemaHash, file}`, `file` in both the document's path inside the
package with its folder, `openapi/<name>` or `mcp/<module>.listing.json`,
the same path the record names; `files` the granted paths as written,
sorted; `tests` `{contractHash?, testsSectionSha?, uses, npm, mocks?}`
only when the package carries tests (the hex sha256 of the contract
they were written against, the hex sha256 of the spec's Tests section
text, the tester's grants, its npm entries shaped as the agent's, and
`mocks` the tester provenance's `testsOf.mocks` when it has any: the
agents the tests replaced with mocks, each with the hash of the
contract its mock was written against); `record` an
object from the path of every file in the package except the manifest
and `cernanto.sig` to `{sha256, size}` (the hex sha256 and the byte
count); `contentDigest` `sha256:` and the hex sha256 of the record
serialized as the manifest is; `provenance` `{cernanto?, compiler?,
doctrine?, harness?, tools?, attempts?, triageCount?, contract?,
verified?, source?}` (`harness` the compile record; `tools` tool
versions by name; `contract` `kept` when the compile kept the previous
contract it was given or anchored on and `written` when its session
wrote one, as the target module records it; `verified` `{at, mocks?, artifact?, tester?}`, `mocks` the
agents the tests replaced with mocks when the row was verified, as
given, the last two the digests of the artifact and tester the compile
produced and verified; `source` `{repository?, commit?, path?}`). The
entries are written in exactly this order: the manifest, the lock, the
spec, the contract, then the files of `code/`, `tests/` (the tester's
lock last among them), `files/`, `openapi/` and `mcp/`, each folder's
files sorted by path, and a `cernanto.sig` the writer is handed last
when there is one, outside the record; so the
same inputs are the same bytes on every machine. The package's DIGEST
is `sha256:` followed by the hex sha256 of the whole file's bytes: the
name the warehouse holds it under and the name a workspace's tree
and a compile exchange; its IDENTITY, the digest the registry indexes,
is `sha256:` and the hex sha256 of the manifest's bytes; its content
digest names the same content across compiles.

`writePackageFromWorkspace` composes the package from a compile's
workspaces, every fact handed in as one record, the workspace facts:
`name`, `type`, `spec`, `codeDir`, `codeFiles`, `contractPath?`,
`lockPath?`, `npm?`, `assetsDir?`, `files?`, `openapi?`, `mcp?`,
`tests?`, `handlers`, `version?`, `license?`, `copyright?`,
`publisher?`, `description?`, `uses?`, `implements?`,
`contractCompatibleWith?`, `provenance`, `verified?`,
`outPath`: the spec entry is `spec` (the text), named `agent.cern.md`;
the contract is the text of the file at `contractPath`, when given;
the code files are `codeFiles` (paths relative to `codeDir`: the
coder's own files as the workspace module lists them), each read from
`codeDir` and carried at `code/<path>`; the lock is the file at
`lockPath`, when given, and the `npm` entries are the ones given
(`{grant?, version}` per granted package); the granted files are
`files` (the paths as the spec wrote them): a path that names a file
is read from `<assetsDir>/<path>` and carried at `files/<path>`, and a
path that names a folder carries every file under it, walked in sorted
order, each at `files/<path>/<its path under the folder>` (the
manifest's `files` lists the files carried; a missing path is a
terminal failure `<name>: the granted file <path> is not in the
workspace`); the openapi documents as given (`openapi`: each granted url to
`{specHash, documentPath, onboarding?}`, the file holding the document
as fetched and the pinned onboarding words when the pins carry them),
each carried at `openapi/<the url's host>-<the first 4 hex characters
of its specHash>.<json when the file's text parses as JSON, else
yaml>` and entered as `{specHash, file, onboarding?}`, `file` that path
with its `openapi/` folder, the onboarding written exactly as given (an
implemented document is a granted file, and has no entry here); the
mcp documents `mcp`, from each module name to `{server, schemaHash,
listingPath}`, each listing file carried at `mcp/<module>.listing.json`
and entered under its server as `{schemaHash, file}`, `file` that
path; the tests, when `tests` is given (`{dir, files, lockPath?,
contractHash?, testsSectionSha?, mocks?, uses, npm, assetsDir?,
assets?}`), each of `files` read from `dir` (a mock listed as
`mocks/<name>`) and carried at `tests/<name>`, the tester's lock at
`tests/package-lock.json` when given, the tester's granted files
(`assets`, the paths as the Tests section wrote them, each read from
`<assetsDir>/<path>`, a folder walked in sorted order as the agent's
own granted folders are) carried at `tests/assets/<path>`, and the
block `{contractHash?, testsSectionSha?, mocks?, uses, npm, assets?}`
as given, `assets` mapping each carried path under `tests/assets/` to
the sha256 hex of its bytes, absent when the tests grant no file. THE
MANIFEST as above with every fact as given (`handlers`, none when the
type is `interface`, whatever names were given; `uses`, `implements`,
`contractCompatibleWith`, `license`, `copyright`,
`description`, `publisher`, `version`), `provenance` as given, its
`verified` the stamp given when one is; the package is written to
`outPath` (parents made) in the format's entry order with the record
over every file, so the same content is the same content digest; the
answer `{digest, packageDigest, contentDigest}`.

`readPackage` takes `packagePath` and `directory` and answers nothing
when the file is not a package (no `cernanto.json` entry at the root,
or one that is not JSON). Otherwise EVERYTHING IS VERIFIED before
anything is answered, each failure a terminal one `the package does
not verify: <what>`, `<what>` in this order: `format <n>; this compiler
speaks 4` for a `packageFormat` that is not 4; `the target <the value>
is not typescript on node`; `the manifest is malformed: <the shape's
complaint>`; `the file <path> is outside the record` for a file the
record does not name, `the file <path> is not what the record says
(sha256 or size)`, and `the record names <path>, which the package
lacks`; `the content digest <digest> is not the record's`; `no spec
entry at the root`, `the spec entry <name> is not agent.cern.md` for a
spec entry under a name other than the type's, and `the spec's sha256
is not specSha <sha>`; `a contract carried without a contractHash`, `a
contractHash recorded without a contract` and `the contract's sha256
is not contractHash <hash>`; the lock against the npm entries: `npm
entries with no lock`, `a lock with no npm entries` and `the npm entry
<name> is <version>, the lock resolves <the lock's version, or
nothing>` (the lock's `packages["node_modules/<name>"].version`), the
tests' entries against the tester's lock the same way with `the tests:
` before the words (a tester's lock in a package whose manifest has no
`tests` block is `the tests: a lock with no npm entries`); `the manifest names <path>, which the package
lacks` for a document, a granted file or an implemented document's
file; `the root file <path> is not one the format names` and `the file
<path> lies under a folder the format does not name` (the signature
excepted). A file that is not there fails `packagePath: cannot read
<path>: no such file`, and a reader asked for a row or a respin over a
file that is no package fails `packagePath: <path> is not a package`. Then, under the directory (made): the manifest to
`cernanto.json` verbatim, the spec to `spec.snapshot.md`, the contract
to `contract.d.ts` when carried, the lock to `package-lock.json` when
carried, each `code/<rest>` to `src/<rest>`, each `tests/<name>` to
`tests/<name>` (the tester's lock to `tests/package-lock.json`), each
`files/<path>` to `assets/<path>`, and each document at its own path
(`openapi/<name>`, `mcp/<name>`). The answer: `{name, version, type,
digest (over the file's bytes), packageDigest (the identity),
contentDigest, specSnapshotPath, contractPath?, contractHash?,
lockPath?, manifestPath, handlers, verified?, license?, copyright?,
specSha, uses (the manifest's map), implements?,
contractCompatibleWith?, npm, openapi, mcp (each server's entry plus
`path`, where its document was written), files, assetsDir (where the
granted files were written; present only when the package carries
any), tests? (the manifest's block plus `lockPath` when the tester's
lock is carried), provenance, previous, deployedTests?}`.
`previous` is the previous compile a later compile of the agent amends:
`files` each code
file's `<rest>` to the path written, keys sorted; `contractPath`;
`specSnapshotPath`; `specSha`; `uses` the ids; `usesContracts` each
use's `contractHash`, only the uses that carry one; `implements` the
interface entries (`{id, contractSha}`); `contracts`, `openapiTypes`
and `implementsContracts` empty (a package records the hash of every
dependency's contract and no text); `listings` each mcp document's
text keyed by its server; `lock` the pins its compile took, whole,
`{doctrine: <the provenance's doctrine, or "">, mcp: <each server to
{schemaHash}>, openapi: <each url to {specHash, onboarding?}, and an
implemented document's id, as its `implements` entry writes it, to
`{specHash: <that entry's>}`, the pin the compile took for the
document under that same name>, npm: <each name to its version>}`; `compiler`
and `doctrineVersion` from the provenance; `harness` its compile
record; `assets` each granted file's path to its sha256 hex.
`deployedTests`, present when the package carries tests: `files` each
test
file's name to the path written, sorted (a mock's name is
`mocks/<name>`); `testsSection` undefined and `testsSectionSha` the
tests block's; `mocks` the tests block's when it has any;
`contractPath` the package's contract when the tests' `contractHash`
is the package's `contractHash`; `specSha`; `harness` the compile
record.

`storeBytes` takes `path`: reads the file and puts its bytes into
the warehouse exactly as the pack's put does (the manifest asked, the
slices, the commit), under `sha256:` followed by the hex sha256 of the
bytes; answers `{digest}`. A package is stored this way, and so is
an artifact tar.

`rowForPackage` answers the fleet row a package ships as, from
`packagePath`, `artifact` and optionally `verified`: the package read
as `readPackage` reads it (a package that does not verify is that
failure), `artifact` the digest given: the package the plane runs for
the row, stored under it. The row, its keys in this order and each
optional key present only under its condition: `agentId` the
manifest's `name`; `artifact` the digest given; `testerArtifact` the
same digest, when the package carries tests; `handlers` the
manifest's; `uses` the keys of the manifest's `uses`, sorted; `type`
the manifest's type when it is `worker`, `task`, `job`, `interface`
or `module`; `implements` the manifest's interface entries as `{id,
contractSha}`, when any; `contractCompatibleWith`, when any;
`contract` the package's contract text, when it carries one; `specSha`
the manifest's; `usesContracts` each use's `contractHash`, over the
uses that carry one, when any does; `verified` the stamp given, else
the package's
own `{at, mocks?}` when it carries one; `built` the provenance's
compile record as THE COMPILE RECORD reads it, when any part is
recorded.

`pairRowsForPackage` answers the two rows a verification round ships,
from `packagePath`, `artifact`, `compile`, `round` and `owner`: the
package read the same way (a package with no tests is a terminal
failure `<name> carries no tests; nothing to verify`). The answer is
`{testForm, tester, rows}`: the two ids, `<the manifest's
name>-under-test-<compile>-r<round>` and `<the manifest's
name>-tester-<compile>-r<round>`, and `rows`, the test form's first:
`rowForPackage`'s row for the package with no `verified` stamp at all
(neither one given nor the package's own) with `agentId` the
test form's id, `form: 'test'`, `testOf` the manifest's name (the agent
the form stands for and calls its dependencies as), `target` the
manifest's name (the agent the pair verifies, which both forms state on
their calls) and `owner` the handle given; then the tester's row, its keys in this order:
`agentId` the tester's id; `artifact` the digest given; `type` `task`;
`handlers` `['run']`; `uses` the test form's id, the tests block's
`uses` (the package's own name among them left out: the tests reach
the target through its test form) and the ids of its `mocks`, sorted
without repeats; `usesContracts` the manifest's `contractHash` under
the test form's id when it has one and each mock's `contractHash`
under its id, when any; `form: 'tester'`; `testOf` the test form's id; `target` the manifest's
name; `owner` the handle given.

`respinPackage` writes a package again, from `packagePath` and
`outPath`, then its optional settings together (`spec`, `license`,
`copyright`, `verified`): the package read as `readPackage`
reads it (a package that does not verify is that failure); the spec
entry is written as `agent.cern.md` whatever name the package read
carried it under, and with a `spec` given it is that text and the
manifest's `specSha` its hex sha256; with a `license` given, the
manifest's `license` is that expression, and with a `copyright` given
(a list of holders), the manifest's `copyright` is that list, so a
notice that moved with the spec moves with it (this module reads no
spec: the caller hands the labels the grammar read); with a `verified` stamp given (`{at, mocks?}`), the provenance's `verified`
is that stamp, the provenance's other facts kept; every other manifest
fact and every other entry (the code, the tests, the contract, the
locks, the files, the documents, the signature) as they were, the
record and the digests recomputed by the same writer; written to `outPath` (parents
made); the answer `{digest, packageDigest, contentDigest}`.

## The compile record

THE COMPILE RECORD read off a provenance: `harness`, when the
provenance's `harness` is an object whose `name` is a string, as
`{name, cli, model, effort}` with each of the last three present only
when it is a string (any other field dropped); `cernanto` when the
provenance's `cernanto` is a string; `doctrine` the provenance's
`doctrine` when it is a string, else its `doctrineVersion` when that
is a string; `amendedFrom` when the provenance's is a string;
`amendDepth` when the provenance's is a number. Nothing recorded means
no record.

## Tests

Uses: npm:fs-extra

Every operation works on directories and files the test writes in a
temporary folder with the granted file package, and the machine the
links are made through is the plane's own, the implementor the plane
binds: a workspace is the coder's `src` with its
files, the contract, and whatever `assets` or `node_modules` entries
the case needs (symbolic links included). The put, the fetch and
`storeBytes` ask the warehouse, which serves the plane's own agents
alone; the tester is one of them (its id is under `cernanto/`), so the
tests leave those to the live cycle's own deploys and put nothing in
the store. A pnpm virtual store is a tree the test lays out on disk
(`store/node_modules/.pnpm/<name>@<version>/node_modules/<name>` with
its sibling dependencies beside it, and a `node_modules/<name>`
symbolic link into it). A resume seed round-trips by compile id and
agent id, and a seed of another compile is not seen. A package written
from a workspace (and a tester's files) reads back through
`readPackage`: its code files are the coder's files byte for byte, its
tests the tester's test files, its lock the workspace's with every npm
entry at the lock's version, its manifest's keys sorted and its record
naming every file; the same inputs written twice are the same bytes; a
package whose file bytes were altered is refused as not verifying; a
file that is not a package answers nothing.

AN IMPLEMENTED DOCUMENT'S PIN READS BACK, a test of its own: a package
written from a workspace whose granted files hold a document
`openapi.yaml` and whose `implements` is `[{id:
'openapi:./api/openapi.yaml', specHash: <the sha256 hex of the
document's text>, file: 'files/openapi.yaml'}]` reads back through
`readPackage` with `previous.lock.openapi['openapi:./api/openapi.yaml']`
equal to `{specHash: <that hash>}`.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
