# Compile Prepare

Type: module

Uses:
- cernanto/compile/plan
- cernanto/compile/grammar
- cernanto/compile/contract
- cernanto/compile/lanes
- cernanto/compile/workspace
- cernanto/compile/artifact
- cernanto/compile/change
- cernanto/compile/judge
- npm:fs-extra

Resolve the inputs and the generation decision for one target of a
compile: check the contracts the coordinator resolved for the
implemented interfaces, locate the granted files, pin the api lanes,
read the previous compile, record what changed, plan the amendment and
decide which contract the code must keep. The code and test sessions
and the deploys are other modules'. Every path handed in is absolute,
and every judgment's spend is answered explicitly beside the result.

THE PROGRESS PORT the coordinator hands in names the agent that serves
it, its checkpoint function, its record function and a context carried
verbatim into every call of either; a checkpoint is a call of the
checkpoint function with the context, a record a call of the record
function with the context and one event (`{phase, kind, text, ok?,
durationMs?, spend?, waitingFor?}`, the phase `prepare`, `change`,
`write code` or `triage`, the kind `begin`, `end` or `note`), each made
with the language's own function for calling an agent named at run
time. A checkpoint is taken before and after every judgment and every
wait on the operator; each phase event is recorded the moment it
happens; a retryable or target-unavailable failure propagates with its
classification.

## The resolved inputs

`resolveInputs` takes the agent (its id, the agents root, its spec
file's path, its type and its parsed spec), the pins handed in (the
compile's pins with the target's previous pins and grant pins folded
in), the coordinator's resolved contracts by id (each with its agent
type and its contract text when it has one), the compile's folders
(the compile root and the inputs folder) and the progress port, and
optionally the judge settings (how the judges' sessions run: the
harness, the road, the agent's compile model and effort) with whether
the specification is unchanged since the previous compile. It answers
ok with the pins updated by the lane resolutions, the pin slice, the
located files and their hashes, the mcp tools and instructions by
server, the openapi documents and types by url, the dependency
contracts, the implemented contracts and the implements stamps; an
ordinary input refusal answers ok false with its words as the detail
and the partial pins beside it.

1. THE GRANTED FILES: the plan module's located files over the spec's
   uses and, separately, over the Tests section's grants; their hashes
   join the provenance and the change record as two maps, the agent's
   files as `assetHashes` and the Tests section's as
   `testsAssetHashes`, each read against the previous compile's map of
   its kind (the package's `assets`; its tests block's `assets`).
2. THE IMPLEMENTED INTERFACES: the spec's `Implements` entries that
   are interface ids, sorted (an entry starting with `openapi:` is THE
   OPENAPI TARGET below). The first problem answers ok false before
   any session, with its words as the detail: an absent or empty
   contract, `the implemented interface "<id>" has no contract this
   compile can read: compile it in this workspace, or install it
   first`; an id whose type is not `interface`, `Implements names
   "<id>", which is a <type>, not an interface`; then the first
   declaration clash among the implemented contracts (the contract
   module's); then, for an interface agent, the name problem of its
   own id (the contract module's); then the name problem of every
   implemented interface id and of every granted agent whose resolved
   type is `interface`. Each implemented interface's stamp is `{id,
   contractSha: <the sha256 hex of its contract>}`.

   THE OPENAPI TARGET: its rest is the text after `openapi:`. A rest
   that is an https url is fetched with the lanes module and the raw
   text written to `<inputs>/openapi-implements/<the agent id with
   every slash a dash>/document.<json when the text's first non-blank
   character is "{", else yaml>`, located as a file grant of that
   file (relative to that folder, the located grant then naming the
   rest as its grant); any other rest is the path the plan module's
   grant rule resolves for a file grant (from the root when it starts
   with `/`, else relative to the spec's folder), read whole (a read
   failure answers ok false: `the implemented document "<target>"
   cannot be read: <why>`) and located as a file grant of the rest. A
   fetch or a locate that fails answers ok false with its message. THE
   DOCUMENT SHA is the sha256 hex of the raw text; the pins'
   `openapi[<the target as written>]` is `{specHash: <the document
   sha>}`. THE CONTRACT is the lanes module's rendered openapi
   interface for the target as written and the raw text, and THE
   SERVER its rendered openapi server for the same (either failing
   answers ok false with its message); the contract joins the
   implemented contracts under the target as written (an interface
   with no spec, no type and no Tests section: the anchor, the
   coverage gate, the change record and the store read it as one),
   and the server's name, types, server and stubs texts are the code
   workspace's `implementsDocument` (`{target, name, types, server,
   stubs}`), its name riding to the sessions as `documentName`. THE
   STAMP is `{id: 'openapi:sha256:<the document sha>', contractSha:
   <the sha256 hex of the contract>}`, last among the stamps. THE
   DOCUMENT FILE joins the located files of the uses (its grants, its
   files whose paths are new, its problems), so the workspace copies
   it under `assets/`, the assets module exports its path (the code
   reads its own document there) and the artifact ships it; its hash
   joins `assetHashes`; its artifact path is the located grant's
   (`document.<extension>` for a url). The target is answered whole
   as `openapiTarget` (`{target, rest, documentSha, documentPath,
   artifactPath, contract, implementsDocument, documentName, stamp}`)
   beside `implementsDocument` and `documentName`. Note (`prepare`)
   `implementing the document <target> (<the document sha's first 10
   characters>)`.
3. THE LANE PINS, in an attempt whose ordinary failure answers ok
   false with the failure's message:
   - per distinct mcp server granted by the uses and then by the Tests
     section, in order (a url, or a local server's command, as the
     grammar parsed it): for a remote server (the grammar's remote
     url), note (`prepare`) `connecting to <url> for tool schemas` and
     take the lanes module's tool listing for the url with the account
     named (the agent under compile, and the url's host as the
     account's name; the url's host, here and in every sentence
     below, is the host with its port when the url names one, the
     name the lanes module keeps the account under); a server that
     demands a sign-in holds the listing in the safe on the agent's
     behalf while the operator logs the account in, so a listing that
     has not answered after two seconds records once the note
     `<the url's host> requires a sign-in; log it in:
     cernanto auth login <the agent's id> <the url's host>` with
     `waitingFor` `[<the agent's id>, <the url's host>]`, takes a
     checkpoint, waits for the answer as long as it
     takes and takes a checkpoint again; for a local server, note
     `starting <the command's label> for tool schemas` (the label is
     the lanes module's: the command's program and arguments, without
     its environment words) and take the lanes module's tool listing
     for the command, which names no account and waits for no
     sign-in; the tools and the instructions are kept by server, the
     pins' `mcp[<server>]` is `{schemaHash}`; note `<the url, or the
     command's label>: <n> tool schema` (`schemas` above one).
   - per distinct openapi url granted by the uses, in order: note
     `fetching the document at <url>`. THE ONBOARDING WORDS carried
     into the first fetch are the handed pins' pinned onboarding for
     the url when the specification is unchanged, and none otherwise.
     The lanes module's document fetch for the url with those words
     and the account named (the agent under compile, and the url's
     host as the account's name) is waited for as a listing is: a
     fetch that has not answered after two seconds records once the
     same sign-in note with the same `waitingFor`, with a checkpoint
     on each side of the wait. A fetch that fails with a message
     carrying `demands a sign-in` (the server refused the anonymous
     fetch) is THE REFUSAL: the onboarding is judged, when none is
     carried yet, with the refusal as both the authentication words
     and the refusal and no declared scopes, and the fetch is made
     again with the onboarding words; any other failure is the
     failure. Then the lanes module's auth summary of the fetched
     document: a scheme has the onboarding judged, when none is
     carried yet, with the scheme as the authentication words, no
     refusal and THE DECLARED SCOPES (the keys of every `scopes`
     object under `flows` of every scheme under
     `components.securitySchemes`). THE JUDGMENT of an onboarding
     (`onboarding judged` is its note) needs the judge settings (none
     handed in fails: `the onboarding of the granted api at <url> must
     be judged, and no judge settings were handed in`): a judge root
     made by the workspace module at `<compile root>/judge-onboarding`
     with no links and no files, a checkpoint, the judge module's
     onboarding with the harness, the road and that root, the
     specification's prose, the url, its host, the authentication
     words, and the agent's model and effort, the refusal and the
     declared scopes each when there is one, a checkpoint, its spend
     added to the call's, the triage note `onboarding finished` with
     its duration and spend, the prepare note `<url>: onboarding
     judged`, and the verdict's `{helpUrl, instructions, scopes, road,
     credential}` as the words. The pins' `openapi[<url>]` is
     `{specHash: <the fetch's>, onboarding?}`, the onboarding present
     when the document authenticates or the server refused (the
     emitted module asks the operator with those words, and the
     package's row names `cernanto/auth` among its uses as it does for
     a remote mcp grant; a `cernanto/auth` grant on the Uses line is
     not needed for it). Note `<url>: pinned <the first 10 characters
     of the hash>, elaborating types`; the lanes module's type
     elaboration of the raw text in the scratch `<compile
     root>/openapi-types/<the first 16 characters of the hash>` gives
     the types source; the module name is the lanes module's for the
     url and the document; the document as two-space JSON is written
     to `<inputs>/openapi/<the agent id with every slash a
     dash>/<module>.json` and the types source to `<module>.types.ts`
     beside it; the lane is kept by url as `{module, specHash,
     documentPath, typesSourcePath, typesSource, onboarding?}`; note
     `<url>: types elaborated`.
   The judgments' spend is answered as `spend` when any was asked.
4. THE PIN SLICE: the plan module's slice of the pins for the uses and
   the Tests section's grants together, each granted openapi url's
   entry taken whole from the pins when it carries onboarding words,
   and the openapi target's pin added under the target as written.

THE DEPENDENCY CONTRACTS are the resolved contracts of the distinct
agent grants of the uses, those with a non-empty text, by id.

## The previous compile and the change decision

`chooseGeneration` takes the agent and its specification (the id, the
type, the spec's whole text and its parsed form), what `resolveInputs`
answered, the environment (the inputs folder, the compile folder, the
doctrine version and the compiler family digest), the request (the
recompile flag, whether the request gave the agent's code, the
plan-only flag, whether it asks a new contract for the agent, the
contract it hands for the agent when one, the published resume seed
location, the deployed row of the agent (`{artifact?, package?, type?,
verified?}`), the held package and the unverified tester's failure
evidence, each when there is one), the judge settings and the progress
port. It answers the disposition (`generate`, `current`, `refreshed` or
`planned`) with its detail, the code source, the previous compile and
its root, the change record and its entries rendered as prompt lines,
the plan, the contract verdict, the amend provenance (`amendedFrom`,
`amendDepth`), the seed, the write-code note, the previous artifact
digest and contract, the previous coder, and the judgments' spend; the coordinator materializes a current artifact or
writes and ships a refreshed package from what is answered. Every path
of the previous compile's files answered stays valid for the caller's
attempt.

THE PREVIOUS ROOT is `<inputs>/previous/<the agent id with every slash
a dash>`, or the held package's directory when one is given.

THE CODE SOURCE is the change module's code-source ladder over the
recompile flag, whether the agent has given code (the request gave it
and no resume seed answers), whether the artifact module's resume seed
at the published location answers one (read unless the compile is a
recompile or no location is given), the spec's type, the row (for a
held package, `{package: <its digest>, type: <its type>}`; else the
deployed row's artifact, package and type, each when present) and
`previous`, read only when every earlier rung passed. THE MECHANICS:
the ladder is asked first WITHOUT `previous`; when it answers `fresh`
with exactly the note `the previous compile could not be read (not
read): writing from the specification`, the previous compile is wanted,
so it is read and the ladder asked once more WITH `previous`
(`{readable, reason?, snapshot, coderFiles}`); any other first answer
stands.

THE READ. With a held package (a format 4 package held from the tree,
read by the artifact module's package reader, carrying the previous
compile it stands for, the directory it was read into, its digest, its
identity, its content digest, its type and its verified stamp when it
has one): progress `change` begin `reading the package in the tree
(<the content digest's first 10 characters after "sha256:">)`, the
previous compile is the package's own, with the `assets` of its
manifest's tests block as `testsAssets` when the block names any (the
manifest is the file `cernanto.json` in the directory the package was
read into, read as JSON), as the read of a row's artifact below
composes it, and `previous` is `{readable:
true, snapshot: true, coderFiles: <the count of its files>}`. Else,
when the row carries an artifact: progress `change` begin `reading the
previous compile (<the digest's first 10 characters after
"sha256:">)`; the artifact module's fetch of the row's artifact into
`<inputs>/previous/<the id dashed>.artifact` (a store that holds none
reads as `{readable: false, reason: "the store holds no artifact
<digest>", snapshot: false, coderFiles: 0}`); the artifact module's
package reader over the fetched file into the previous root gives the
previous compile (the package's own, with its tests block's `assets`
as `testsAssets` and its `license` and `copyright` when the package
carries them), and a file that is no package reads as `{readable:
false, reason: "the artifact carries no manifest and contract",
snapshot: false, coderFiles: 0}`; a read that answers is
`{readable: true, snapshot: <it carries a spec snapshot>, coderFiles:
<the count of its files>}`, and one that fails `{readable: false,
reason: <the failure's message>, snapshot: false, coderFiles: 0}`.

A SOURCE THAT IS NOT `amend` (or an amend with no previous compile
read): when a read began, progress `change` end with the source's
note, ok false and the read's duration; progress `write code` note the
source's note; the answer is `generate` with the note as its detail,
the source, empty entries, the spend, and, for the source `resume`,
the seed `{directory: <the resume seed's>, harness?}`.

THE AMEND, over the previous compile `prior` and THE DIGEST (the held
package's, else the row's artifact):

- THE SNAPSHOT: the text of the previous compile's spec snapshot
  (empty when it has none), parsed by the grammar, its kind the
  snapshot's own `Type:` line's and, for a snapshot that states none
  while the previous compile's manifest states a kind other than a
  task (a snapshot written before the kind was the page's to state),
  the manifest's; THE PREVIOUS PROSE is the parsed snapshot's prose, or the
  whole text when it does not parse (a snapshot that does not parse
  counts as no grants and no implements).
- THE TESTS SECTION STANDS when the snapshot parses, the plan
  module's tests section of the current spec (its type, its uses,
  its prose and its Tests
  section) equals the plan module's tests section of the parsed
  snapshot (the section's grants, its mocks and its prose with every
  run of whitespace collapsed, so a reflow moves nothing; two specs
  without a Tests section agree), and the files the section grants
  are the previous compile's by hash (its `testsAssets`, or none,
  against `testsAssetHashes`, compared as sorted entries: a granted
  file that moved, came or went means the section moved). The Tests
  section is no part of the prose the change record compares, so a
  specification whose Tests section alone moved leaves the record
  empty: the code is the previous compile's, and the tests were
  written for other words.
- THE PREVIOUS CONTRACT is the text of the previous compile's
  contract file (empty when it cannot be read).
- THE CHANGE RECORD is the change module's record over the two sides:
  the specs as the prose alone (the previous prose above against the
  current spec's prose: a `Uses:` or `Implements:` line that moved is
  the grants' or implements' entry to report); the grants as a Uses
  line writes them (`<path>`, `<path>@<pin>`, `mcp:<server>`,
  `openapi:<url>`, `npm:<package>`, `npm:<package>@<pin>`,
  `file:<path>`), the snapshot's against the spec's; the implements,
  the snapshot's against the spec's; THE CONTRACT SIDES, one per
  distinct agent grant of the uses that is not also implemented (the
  previous side the text of the previous compile's `contracts[<the id
  dashed>]`, the current side the dependency contract for the id) and
  one per implemented id in order (the previous side the previous
  compile's `implementsContracts[<the id dashed>]`, the current side
  the implemented contract for the id); THE OPENAPI SIDES, one per
  distinct openapi url of the uses (`{url, module, previous?,
  current?}`: the module the lane's, the previous side the previous
  compile's `openapiTypes[<module>]` text, the current side the lane's
  types source); THE MCP SIDES, one per distinct mcp server of the
  uses (`{server, previous?, current?}`: the previous side the previous
  compile's `listings[<the lanes module's module name for the
  server>]`, else its `listings[<server>]`; the current side this
  compile's listing as the artifact keeps it, `{server, tools,
  instructions?}` as two-space JSON); THE NPM SIDES, one per distinct
  npm grant (the previous compile's pin against the pin slice's); the
  assets (the previous compile's map, or none, against `assetHashes`),
  the tests assets (its `testsAssets`, or none, against
  `testsAssetHashes`); THE SURFACE, present when the snapshot parses
  and either spec implements anything: on each side the distinct
  sorted exported function names (the contract module's) of the
  implemented contracts, the current side read off this compile's
  implemented contracts, the previous side off the previous compile's
  texts for the snapshot's implemented ids (the sides resolved as the
  contract sides are, the openapi target's stamp matched by its id or
  by the `openapi:` prefix); a previous side that cannot be read
  leaves the surface absent; and the versions (the previous compile's
  doctrine version and compiler, or empty texts, against the doctrine
  version and the family digest). A SIDE RECORDED BY HASH ALONE: a
  previous compile read out of a package records the hash of every
  dependency's contract and of every document and no text, so a
  previous side with no text whose previous compile names a hash for
  it compares by hash: the previous side is the current side itself
  when the sha256 hex of the current text equals that hash (an equal
  hash is the same text), and stays missing otherwise. The hashes: a
  dependency's `usesContracts[<id>]`; an implemented interface's or
  document's `implements` stamp's `contractSha` (the stamp found by
  the id, or for an `openapi:` id by the id or the prefix); an
  implemented document with no such stamp, by its pin, the previous
  compile's `lock.openapi[<the target as written>].specHash` against
  the pin slice's specHash for the target (the same document renders
  the same contract); an openapi
  grant's `lock.openapi[<url>].specHash` against the pin slice's
  specHash for the url (the same document elaborates the same types);
  an mcp grant's `lock.mcp[<server>].schemaHash` against the pins'
  schema hash for the server.
- THE FILES: the record as two-space JSON to `change.json` under the
  previous root, its spec diff (or nothing) to `change.diff`, the
  snapshot's text to `spec.md` beside them (the previous
  specification whole, the file the coder's doctrine names) and, when
  tester failure evidence is given, that evidence to `verify.txt` (the
  previous tester's conversation, the file the doctrine names for the
  failure words). Progress `change` end with the record's summary
  line, ok, and the duration since the read began.
- THE ENTRIES of the record, rendered as lines for a prompt: `+
  <grant>` per grant added, `- <grant>` per grant removed, `implements
  + <id>` and `implements - <id>`, then per drift of the contracts,
  the implements, the openapi entries and the mcp entries, in that
  order, `<id> (<kind>):` followed by its lines each indented by two
  spaces, `npm <name> <from> to <to>` per npm move, `asset ~ <path>`,
  `asset + <path>`, `asset - <path>`, `tests asset ~ <path>` (`+` and
  `-` the same) per tests file, and `function - <name>: it left the
  document or an interface this agent implements; remove its export
  and its code` per name of `surface.removed`; the lines joined by
  newlines, empty when the record has none of them.
- VERIFIED: the row is verified when its `verified` stamp is present
  (neither null nor false); a worker counts as verified, its run being
  its proof, and for the decision below so does an interface, a
  contract alone, which runs nothing and carries no tests (the seed
  proof of the reading keeps its own three words, and an interface's
  is `unverified`). A CONTRACT IS ASKED when the request asks a new contract
  for the agent or hands a contract whose text differs from the
  previous contract: such a target answers neither `current` nor
  `refreshed`, whatever moved or stood, since a new contract is a
  change of the surface itself and a handed text is the surface the
  operator asks for; it takes THE AMEND SEED below and goes on to the
  code phase, where the session writes the contract from the
  specification under a new-contract ask and keeps the handed one
  otherwise.
- THE AMEND SEED, the answer `generate` for an amend: the previous
  compile's files under `<the previous root>/src` as the seed's
  directory with the previous coder record, the detail and
  `writeCodeNote` the note below, `amendedFrom` the digest and
  `amendDepth` the previous compile's depth (0 when it records none)
  plus one, the previous artifact digest and contract, the record and
  its entries, the plan when one was made, and the spend.
- A HELD PACKAGE WITH AN EMPTY RECORD whose stamp is missing (an
  interface's aside, which carries none by its kind) or whose
  Tests section moved takes the amend seed with `amendedFrom` absent
  and `amendDepth` the previous compile's own, the note `a new
  contract is asked: the session writes it from the specification`
  under a new-contract ask, `the specification and its dependencies
  are unchanged; re-gating the previous compile under this compiler`
  when the Tests section stands, `the Tests section changed; re-gating
  the previous compile` otherwise (the versions' movement alone, the
  doctrine, the compiler or both, counts as nothing moved for a held
  package).
- NOTHING MOVED: when no contract is asked, the record is `empty`, the
  Tests section stands and the row is verified (for a held package,
  its own stamp is present): THE NOTICE LAGS when the spec states a
  License label other than the previous compile's `license`, or
  Copyright holders other than its `copyright` (compared sorted).
  When the spec's text is the snapshot's byte for byte and the notice
  does not lag, the answer is `current` with the detail `current from
  the tree (<the row's package digest's first 10 characters after
  "sha256:">)` when the row carries a `package` (the coordinator
  projected the workspace's own package as the row), else `current on
  the plane (<the digest's first 10 characters>)`, the previous
  artifact (the row's artifact, else its package, else the digest) and
  the previous contract, without a session. Otherwise, unless the
compile is plan-only, a row with a verified stamp answers `refreshed`
with the detail `refreshed: the package's notice lags the
specification's labels` when the text is the snapshot's, else
`refreshed: the specification changed in whitespace, case or its
notice labels alone`, the previous artifact, the previous contract,
the previous coder and the previous compile's own amend depth, so
the package beside the spec and its manifest's
`license` and `copyright` follow the spec. An unverified row takes
the re-gate of the code phase with its live cycle, whether its record
is empty or its spec moved in words, whitespace, case or its notice
labels alone (the re-gated package carries the current text), and so
does a row whose Tests section moved: the test phase updates the tests for the section's new words,
  and the live cycle proves them.
- THE READING, when the record `needsReading`: `<inputs>/current/<the
  id dashed>` is emptied and filled with `contracts/<the id
  dashed>.d.ts` for every dependency contract and every implemented
  contract, `openapi/<module>.types.ts` for every lane and
  `mcp/<module>.listing.json` for every mcp server as this compile
  keeps them; THE JUDGE ROOT is the workspace module's judge root at
  `<compile folder>/judge-plan` with the links `previous` onto the
  previous root and `current` onto that folder and the file `spec.md`
  holding the spec's text; progress `change` note `planning the
  change`; the seed proof is `verified` for a verified row, `worker`
  for a worker, else `unverified`; a checkpoint, then the judgment
  `change plan` = the judge module's change plan with the harness, the
  road and the root, the previous and current prose, the summary, the
  spec diff, the entries, the previous contract, the implemented
  contracts when any, the seed proof, the tester failure evidence when
  unverified and given, and the previous compile's file names, with
  the agent's model and effort; a checkpoint; its spend added; the
  triage note `change plan finished` with its duration and spend; the
  plan written as two-space JSON to `plan.json` under the previous
  root; progress `change` end `<the analysis' first sentence>; <n>
  change(s), contract <kept|moved>, tests <kept|updated>` (`change`
  for one, ok, the judgment's spend), then one `change` note per
  change `<what> (<where>)`. A plan that is not `absorbable` notes
  (`change`) `the change is not absorbable by the previous code: <the
  first sentence>; writing from the specification`, keeps its
  `contractChange` as THE CONTRACT VERDICT and makes the source
  `fresh`; a judgment that fails (a checkpoint taken) notes `the
  change could not be planned (<message>); writing from the
  specification` and makes the source `fresh`.
- PLAN ONLY answers `planned` with the detail `<the summary line>;
  machine-checked at compile: no judgment` for a record that needs no
  reading, else the plan's end words (the fresh note when the plan
  failed or was not absorbable, the summary when neither), the plan
  and the contract verdict when there are any, the digest as
  `amendedFrom` and the spend; the coordinator reports it without an
  artifact or row.
- A SOURCE MADE FRESH notes (`write code`) the fresh note and answers
  `generate` with the fresh source, the note as its detail, the
  previous compile and its root, the record and its entries, the plan
  and the contract verdict when there are any, and the spend.
- THE SNAPSHOT REFRESH: when no contract is asked, a plan was made
  whose `changes` are empty and whose `testsChange` is false, the
  record's entries are empty (the prose alone moved), the Tests
  section stands, and the row is verified or the package is held: the
  words moved and the meaning did not, so nothing is gated, no session
  opens and no live cycle runs. Progress `write code` note `no change
  in meaning: <the analysis' first sentence>; refreshing the
  specification snapshot`; the answer `refreshed` with that text as its
  detail, the plan, the previous artifact, contract and coder and the
  previous compile's own amend depth, for the coordinator's snapshot
  emission and final ship.
- Otherwise THE AMEND SEED, with the note: `a new contract is asked:
  the session writes it from the specification` when the request asks
  a new contract, the plan's `contractChange` is true, the record's
  `implements.added` is not empty, or one of its `implements.moved`
  drifts has a kind other than `docs` (the code phase opens the
  session whatever the change record says); else, for an empty record,
  `the specification and its dependencies are unchanged; re-gating the
  previous compile under this compiler` when the Tests section stands
  and `the Tests section changed; re-gating the previous compile`
  otherwise; else `machine-checked change: <the summary line>;
  re-gating the previous compile` for a record that needs no reading;
  else `the change forces no code change: <the analysis' first
  sentence>`. The code phase re-gates the seed under that note where
  it opens no amendment session.

## The contract decision

`decideContract` takes the spec (its type, its whole text, its prose
and the implemented contracts by id), the change state (whether the
code source is `amend`, the change record, its entries, the plan and
the contract verdict kept from a plan that made the source fresh),
the compile folder, the judge settings and the progress port, and
optionally the previous contract (`{text, specSha?, given?}`: the
spec sha it was compiled from, and whether the request gave it). It
answers the decision (`preserve` the previous contract, make it the
`anchor`, or `none`), the previous contract's text for a preserve or
an anchor, and the judgment's spend (zero when none was asked); its
notes are recorded under `prepare`. A worker, and an agent with no
previous contract, is `none`. Then the ladder:

- a GIVEN previous contract is preserved (note `previous contract
  given; preserving it as is`);
- the interfaces the agent implements come next, whatever the spec's
  text and the plan say, because the contract covers them: a record
  whose `implements.added` is not empty makes the previous contract
  the ANCHOR (note `an interface is now implemented; the contract
  gains its operations`), and a drift in its `implements.moved` whose
  kind is not `docs` (the interface, or the openapi document, changed
  shape) makes it the ANCHOR too (note `an implemented contract moved;
  the contract follows it`);
- a previous contract whose spec sha equals the sha256 hex of this
  spec's text is preserved (note `spec unchanged since the deployed
  compile; preserving its contract`);
- THE VERDICT, the plan's `contractChange` for an amend, else the
  contract verdict kept: false preserves (note `the change keeps the
  contract; preserving it`); true makes it the ANCHOR (note `the
  change moves the contract: <which>; a new one may cascade`, `which`
  the plan's changes, each as `<what> (<where>)` joined by `, `, whose
  `where` names an exported function of the previous contract (a part
  of the `where` split on commas carrying the name among its words,
  split on whitespace, dots and parentheses), or `see the plan` when
  none does);
- an amend with no verdict (a machine-localizable change) preserves
  (note `the change keeps the contract; preserving it`), no judgment
  asked;
- else note `checking the previous contract against the spec`, a
  judge root made by the workspace module at `<compile
  folder>/judge-compat` with no links and no files, a checkpoint, the
  judgment `contract check` = the judge module's contract check with
  the harness, the road and that root, the spec's prose, the previous
  contract's text, the agent's model and effort, the change (the
  record's spec diff followed by its entries, the empty ones left
  out, joined by a newline; none without a record) and the implemented
  contracts when any; a checkpoint; its spend added; the triage note
  `contract check finished` with its duration and spend; compatible
  preserves (note `previous contract still fits; preserving it`), else
  the ANCHOR (note `previous contract no longer fits; a new one may
  cascade`).

## Tests

Exercise the contract decision where it needs neither a judgment nor
the coordinator's progress port: a worker has no decision, and so has a
target without a previous contract. An unknown implemented interface
fails input preparation before a lane is fetched or a session starts.
Full previous-compile and API preparation, and the decisions that record
their words through the coordinator's progress port, are exercised
through real compiles of the coordinator.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
