# Compile Judge

Type: module

Uses:
- cernanto/compile/sessions
- cernanto/compile/grammar
- cernanto/harness
- file:judge/doctrine/

Answer the compiler's own questions with a model: which side a test
failure lives in (`triage`), whether a previous contract still
satisfies an edited specification (`contractFits`), what a change to
a specification forces in the code that implements it (`changePlan`),
how an operator gets the credential a granted api needs
(`onboarding`). The four ride ONE verb, `judge`: a read-only
session with tools on the compile's own model, opened through the
sessions module over a root the compile prepared, its verdict read
off the turn's final text as one JSON line; a judge navigates the
files its root holds and writes nothing.

## The doctrine

The granted folder holds six files, each read as utf8 and trimmed:
`judge-triage.md`, `judge-compat.md`, `judge-change.md` and
`judge-onboarding.md` (one whole prompt each), `judge-verdicts.md`
(named sections, read as the sessions module reads sections: a line
matching `^## ([a-z0-9-]+)\s*$` opens the section it names, its body
the lines until the next heading, trimmed and unwrapped, paragraphs
joined by a blank line) and `session-judge.md` (the standing text of
every judge). `judgeDoctrine` answers `{triage, compat, change,
onboarding, verdicts, session}` loaded once per process from the
module's own folder; a file that is missing fails with `the judge
doctrine is missing <file>`; a verdict question asked of
`judge-verdicts.md` that it lacks or leaves empty fails with `the
judge doctrine is missing the question <name>`.

## The verb

`judge` takes the site, one record every judgment takes (`harness`,
`road`, `root`), then `prompt` and `schema`, then its optional
settings together (`model`, `effort`, `web`, `maxToolCalls`): the
compile's harness and session road (the sessions module's), the root
directory the session opens in, the prompt text, the schema of the
verdict, the model and effort (the compile's own for every judge,
handed in by the caller), whether the session may consult the web
(`web`, for a judgment whose answer lives in the world's
documentation; off when absent), and the cap on tool calls (30 when
absent). The schema is `{required: [<names>], properties: {<name>:
{type: 'string' | 'boolean' | 'number' | 'array', description}}}`, and
THE SCHEMA WORDS are the prompt's last part: `Answer with exactly one
JSON object on a line of its own and nothing else, matching this JSON
schema:` followed by a newline and the schema as JSON. The verb:

1. Asks the sessions module to open a session on the harness and the
   road, over the root as its workspace, with the initial prompt (the
   prompt, a blank line, the schema words), the doctrine's session
   text as the session's doctrine under the version `judge`, the model
   and effort, read-only, the web when asked, and the cap on tool
   calls.
2. A turn that ended `failed` fails the judgment with the turn's
   output trimmed, `the judge session failed` when it has none. Reads
   THE VERDICT LINE off the turn's `output`: the LAST line that,
   trimmed of surrounding whitespace and backticks, starts with `{`,
   ends with `}` and parses as a JSON object, and FITS the schema:
   every required name present with the declared type (`array`: a
   list; `number`: a finite number).
3. When no line fits: ONE more turn, the session resumed through the
   sessions module with the input `Your answer did not fit. ` followed
   by the schema words, read the same way. Still none: the failure
   `the judge answered no verdict`.
4. Answers `{verdict: <the object>, sessionId, spend}`, the spend the
   sessions module's spend of each turn, both turns folded, and counts
   the call on THE SPEND METER.

A turn that fails (a session that cannot open, a cap or a timeout
that aborted it) is the failure itself, in its words. The reading of
step 2 is the helper `readVerdict(output, schema)`, plain and
synchronous: the verdict object, or nothing when no line fits.

THE SPEND METER: `takeJudgmentSpend` answers `{evaluations,
inputTokens, outputTokens}` (and `costUsd` when any was recorded)
since the previous take and starts over; `evaluations` counts every
judge asked.

## Triage

`triage` takes the site (`harness`, `road`, `root`), then `specProse`,
`moduleFiles`, `testFiles` and `failureOutput`, then its optional
settings together (`model`, `effort`, `implementedInterfaces`,
`dependencyContracts`, `npmEntries`, `calleeTraces`, `history`): the
judge's road; the specification's prose; the coder's files and the
test files by name (the texts are on the root's disk under
`agent/src` and `tester/src`, and the prompt carries the names); the
failure's words; the implemented interface contracts by id when any;
the contracts of the dependencies the failing path called, by id; the
npm declaration entries the coder saw, by package; the callee traces
of failed dependency calls, by call; and THE HISTORY as text, the
evidence of this compile's earlier rounds for the agent (the traces
each failed round left, under the coordinator's headings), which the
coordinator keeps and hands in. The prompt is the doctrine's triage text,
then the context as labeled blocks separated by blank lines, each a
label line and its text fenced (` ``` ... ``` `): `The
specification:`; `The module's files, under agent/src:` with the
names joined by `, `; `The test files, under tester/src:` the same;
`The failure:`; then, each only when given and not empty, `The
contract of <id>:` per implemented interface, `The contract of the
dependency <id>:` per dependency contract, `The declaration entry of
<package>:` per npm entry, `The trace of <call>:` per callee trace,
and `The earlier rounds of this compile, their evidence:`. The schema requires
`analysis` (string: the reasoning in at most 250 words),
`failureInModule` (boolean, the verdicts' `triage-module-at-fault`
question as its description), `testsAtFault` (boolean,
`triage-tests-at-fault`: the tests are at fault as well, or alone),
`platformAtFault` (boolean, `triage-platform-at-fault`), and, only
when the agent implements interfaces, `interfaceAtFault` (boolean,
`triage-interface-at-fault`). The verdict is `{failureInModule,
testsAtFault, platformAtFault, analysis}`, with `interfaceAtFault`
only when it was asked; the spend rides beside it.

## The onboarding

`onboarding` takes the site (`harness`, `road`, `root`), then
`specProse`, `url`, `provider` and `authentication`, then its optional
settings together (`model`, `effort`, `refusal`, `declaredScopes`):
the judge's road; the specification's prose; the granted api's url
and its provider word (the host); how the api authenticates, in the
lane's words (`a bearer token in the authorization header`, `OAuth
2.0` with its flow named, `an api key in the "<name>" header`); the
server's refusal words when the document itself is served only to a
signed-in client; and the scopes the document declares, when it
declares any. It answers what the operator is asked with when the
agent's account for the api is missing: the words a terminal prints
with nothing else in front of the operator. The judge runs with the
web on (`web: true`), so the provider's documentation is read as it
stands today. The prompt is the doctrine's onboarding text, then `The
specification:` fenced, `The api:` fenced (the url, the provider word
and the authentication, one per line), `The server's refusal:` fenced
when given, and `The scopes the document declares:` fenced when
given, one per line. The schema requires `helpUrl` (string: the
signed-in page of the provider's console where the operator gets the
credential), `instructions` (string: numbered steps an operator who
has never used that console follows blind, naming the kind of
credential that fits the specification when the provider offers
several, the permissions or scopes this agent's work needs, and
ending with what to paste), `scopes` (array of strings: those scopes
as the provider names them, empty when the provider has none), `road`
(string: `token` when the operator pastes a credential the provider
issues for direct use of the api, `client` when the operator
registers an OAuth client and the lane runs the browser flow) and
`credential` (string: the provider's name for what the operator
pastes on the token road, the words the field is labelled with, such
as `Service key` or `API key`; `OAuth client` on the client road). The
verdict is `{helpUrl, instructions, scopes, road, credential}`, with
the spend beside it.

## The compat check

`contractFits` takes the site (`harness`, `road`, `root`), then
`specProse` and `contract`, then its optional settings together
(`model`, `effort`, `change`, `implementedInterfaces`) and asks
whether the contract still satisfies the specification: the prompt is
the doctrine's compat text, then `The specification:` fenced, `The
contract:` fenced, `The change since the previous compile:` fenced
when given, and `The contract of <id>:` per implemented interface
when given. The schema requires `analysis` (string) and `compatible`
(boolean, the verdicts' `compat-compatible` question); the verdict
`{compatible, analysis}`. The root may be an empty directory: this
judge opens nothing.

## The change plan

`changePlan` takes the site (`harness`, `road`, `root`), then the
change under judgment as one record (`previousSpec`, `currentSpec`,
`summary`, `diff`, `entries`, `previousContract`, `seed`, `files`, and
optionally `implementedInterfaces` and `failure`), then its optional
settings together (`model`, `effort`): the two specifications' prose,
the change record's summary line, the specification's unified diff,
the record's other entries rendered as lines, the previous contract,
the implemented interface contracts when any, whether the previous
code passed its live tests (`seed`: `verified`, `unverified` or
`worker`), the failure's words when unverified, and the coder's files
by name (on the root's disk under `previous/src`; the current
contracts, api types and tool listings under `current/`). The prompt
is the doctrine's change text, then the doctrine's compat text under
the label `The contract rules:`, then the labeled blocks `The previous
specification:`, `The current specification:`, `The change, summed
up:` (the summary line, then the diff, then the entries, one fenced
block), `The previous contract:`, `The contract of <id>:` per
implemented interface, `The coder's files, under previous/src:` (the
names joined by `, `), and `The previous code:` with the words `passed
its live tests`, `did not pass its live tests; the failure:` followed
by the failure's words fenced, or `is a worker's: its run is its
proof`. The schema requires `analysis` (string), `changes` (array:
each `{what, where}`, `what` one sentence and `where` the files and
functions touched, comma separated), `contractChange` (boolean,
`change-contract-moves`), `testsChange` (boolean,
`change-tests-change`) and `absorbable` (boolean, `change-absorbable`);
the verdict is `{analysis, changes, contractChange, testsChange,
absorbable}` with `changes` kept to the entries that carry a string
`what` and a string `where`.

## Tests

A judge test opens on the rehearsal vendor, `cernanto/harness/fake`,
bound by that name, whose script the plane does not carry, so every
turn echoes its input: the road's
`dataDir` is a fresh path under `/tmp` and the root a fresh empty
directory the test makes. Because the echo carries the prompt back
whole, a verdict line the test plants in the prompt (a fenced JSON
object naming every required field) is read back as the verdict, so
the tests prove the reading: the last fitting line wins, a line
missing a required field is not a verdict, the refusal turn asks once
and `the judge answered no verdict` follows, `analysis` is the planted
text, and the spend meter counts one evaluation per call and starts
over on take. The doctrine test loads the module's own folder and
asserts its six parts; the onboarding verb reads its three fields the
same way the others read theirs.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
