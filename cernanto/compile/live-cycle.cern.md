# Compile Live Cycle

Type: module

Uses:
- cernanto/compile/artifact
- cernanto/compile/workspace
- cernanto/compile/verify
- cernanto/trace
- cernanto/trace/view

Deploy and observe exactly one verification round for the compiler:
the package of the round, the ships, the temporary tester's run and
the failure evidence. The cycle cap, the platform-fault retry, the
triage, the repair sessions and the reports are the coordinator's (the
compile front, which links this module); every path handed in is
absolute.

THE PROGRESS PORT the coordinator hands in names the agent that serves
it, its checkpoint function, its record function and a `context`
carried back on every call; a checkpoint is a call of the checkpoint
function with `{context}` (nothing when none was given), a record a
call of the record function with the context and one event
(`{event, round, at, ok?, durationMs?, detail?}`, the event `round
start`, `deploy begin`, `deploy end` or `verify begin`, `at` the ISO
moment), each made with the language's own function for calling an
agent named at run time. Each event is recorded the moment it
happens; a checkpoint is taken before and after every wait; nothing of
the port is kept between calls. A retryable or target-unavailable
failure propagates with its classification, and so does whatever a
checkpoint throws.

## The package of the round

THE SOURCES of a package (`sources`) are the compile's workspaces and
what the writer takes from them: the spec's text; the code workspace's
`src` and the coder's files in it; the contract file tsc emitted; the
handlers the contract module read from it (none for an interface);
the lock and the npm entries; the assets folder and the granted paths;
the mcp listings by module, each with its server; the tests (the
tester workspace's `src`, its files with the mocks among them, its
lock, its assets folder with the paths the Tests section grants, and
the block the manifest carries for them); the implemented interfaces
and documents, the compatible contracts and the provenance. THE PACKAGE FACTS of the target (`package`) are the
version, publisher, license, copyright and description, the `uses` map
and the openapi documents, each `{specHash, documentPath,
onboarding?}` with its onboarding words `{helpUrl, instructions,
scopes, road?, credential?}`.

THE PACKAGE OF THE ROUND is written by the artifact module's workspace
writer from the sources and the facts handed to it exactly as given,
with the target's id as its name, its type, and no stamp, to
`package.cern` in the round's folder (made first); its bytes are
stored through the artifact module, and the digest answered is THE
DEPLOY DIGEST, the `artifact` of every row of the compile. A round's
pair rows are the artifact module's pair rows for the package file
(the deploy digest, the compile id, the round number and the owner
handle); an agent's row is the artifact module's row for the package
file (the deploy digest and, at the final ship, the stamp).

THE SHIP of rows goes through the verify module: the fleet's state is
read first, the rows are shipped verbatim (the controller's refusal
is the failure), and THE WAITS are computed off the state before, each
`{agentId, before}`; for each shipped row the FIRST of these cases that
applies decides:

1. a module or interface row: no wait;
2. a pair row (one carrying `form`): a wait on its newest generation
   before (0 when none);
3. any other row: no wait when the state before lists its artifact
   unchanged, else a wait on its newest generation before (0 when
   none).

## One round

`runCycle` takes the round: the progress port, the target's id and
type, the compile's id, the round's number (from one per target,
handed in by the coordinator) and folder, the sources, the package
facts, the mocks (`mocks`: the ids the target's Tests section lists
under `Mocks:`), and the run and ask budgets with their timeout words
(`runMs`, `askMs`, `runWords`, `askWords`, each when given).

THE DEPLOY: the round's start is the ISO moment; record `round start`;
a checkpoint; record `deploy begin`; the package of the round written
and stored; the pair rows for it, the owner handle being this call's
own id as the language gives it (the compiler's call id, inherited
through this linked module; a call's id spells its handle: the
service, the generation and the key, colon separated); the ship with
its waits. Every round ships a fresh pair under the compile's id and
the round's number, `<target>-under-test-<compile>-r<round>` (the
target's test form) and `<target>-tester-<compile>-r<round>` (its
tester), even when the bytes are unchanged: a fresh generation is
fresh memory and fresh mocks, and each compile's rows are its own
while compiles of one target overlap. Record `deploy end` with ok and
the deploy's duration. A deploy that fails records `deploy end` not
ok and ends the round `failed` with the output `the live deploy
failed: <message>`, no platform fault, empty deployed digests, the
deploy's duration as its spend and empty evidence; no tester runs.

THE PAIR'S SERVICE: a checkpoint; the verify module's wait for the
pair (the tester, the test form, 120 seconds); a checkpoint. A pair
that does not serve is the round's failure `the verification pair
did not serve within 2m00s: <the wait's words>` with `platformFault`
(a row without a generation is the plane's to explain), no tester
run.

THE TESTER'S RUN: a checkpoint; record `verify begin` with the detail
`<the tester's id> <the test form's id>`; the verify module's tester
run with the pair's two ids, the round's start as the moment asks
count from, the waits and the budgets and words given; its outcome
is the round's (`ok`, `output`, `passed`, `failures`, `waitingFor`
when named), no platform fault; a run that fails outright is not ok
with `the tester could not run: <message>`. A checkpoint. THE LEAK
CHECK, when mocks are listed: the test form's calls since the round's
start, read as the evidence reads them (the trace agent's calls for
the id, limit 12, the ones at or after the moment) and each one's tree
(THE TREE READ below); every `agent-call` record in those trees whose
`target` is a listed id and that does not carry `mocked: true` is a
leak, the round's output is one line per leak, `the mock of <target>
was bypassed: <the record's agentId> reached it for real during a
mocked run (the mocks scope was lost on the way to <the record's
agentId>/<its handler>); this is a fault of the platform, never of the
code or the tests`, joined by newlines, with `platformFault` and the
run's `passed` and `failures` kept (a line `mock leak in <the target's
id> round <n>: <the count> unmocked call(s)` is printed); the
coordinator fails the target with those words and opens no triage.
The verification's duration runs from `verify begin` to the end of
the leak check.

THE PAIR'S REMOVAL: a failed or waiting round reads its evidence
first, THE OUTCOME's `evidence` below, once the store holds the round:
a copy stores its records about a second after it makes them, so the
tester's calls are listed again with the trace agent every half
second, for at most fifteen seconds, until a call of the tester at or
after the round's start is listed with a status other than `running`,
and the evidence is read after it; then the round removes its own pair
through the verify module (the tester first, then the test form); a
removal that fails makes the round not ok with `platformFault`, the
removal's words appended to the output on a new line; a verified round
LEAVES ITS PAIR STANDING for the coordinator, who removes it right
after the final ship, so a row of the fleet names the round's package
at every moment (the warehouse lets a package go the moment nothing names
it). A failure thrown while the pair is being verified (a checkpoint's
refusal, a classified failure) removes the pair first and propagates.

THE OUTCOME: `ok`; `state` `verified` when ok, `waiting` when not ok,
no platform fault and an account is waited for, else `failed`; the
output, the passed count, the failures and `waitingFor`;
`platformFault`; `deployed` (the agent's and the tester's digests are
one, the deploy digest); `pair` (the tester's and the test form's
ids); the round's start; `verifyMs`; `spend` `{deployMs, verifyMs}`;
and `evidence`, THE EVIDENCE below for a failed round, read with the
pair's tester id as the tester and the pair's test form id as the
target (the round's own copy of the agent under test, under whose id
its calls are recorded), since the round's start, with the output;
empty (`{tester: '', target: '', callees: [], slices: []}`) for a
verified or waiting one. The coordinator records verify end and
decides whether to wait or repair.

## Candidate ships

`shipCandidate` takes the candidate: its kind (`final` for a verified
or untested executable target, `interface` for a contract ship), the
target's id and type, the round's folder, the sources, the package
facts, the mocks, the tester digest of the round that verified (absent
for a worker or a target with no live cycle) and `holdFinalShip`. A
ship answers when the controller admitted the row.

- THE FINAL SHIP: with a tester digest, the package is the verified
  round's own `package.cern` in the round's folder, stored again
  through the artifact module before the ship (the warehouse's put is
  idempotent; the pair's rows, still standing, name the package until
  the shipped row does), or, when that folder is gone (an attempt
  restarted after the round verified), the package the round recorded
  by its digest, fetched from the warehouse and shipped as it is, never
  written anew from sources the attempt no longer has; without one, the package is written from the
  sources and stored as the deploy writes one. Its row is the agent's
  row for that package file with the stamp `{at: <the current ISO
  time>, mocks?}` (`mocks` the listed ids when the target's Tests
  section lists any: the row says which agents the proof replaced,
  wherever the bytes go), `testerArtifact` the same digest and
  `verified` that stamp, published whether or not its bytes changed,
  EXCEPT A HELD SHIP: when the coordinator asks the ship held
  (`holdFinalShip`: the target is the agent the coordinator's own
  process serves, so the ship would roll the process this compile runs
  in), the package is stored and the row composed as above and
  answered as `heldShip`, the fleet's state read and no row shipped,
  the note `shipped final: held until the compile's end (it rolls this
  compiler)`; the coordinator ships it once its done record is
  written. A module notes `shipped final: its carriers compose the
  verified bytes`; another executable target notes `shipped final: the
  declared package rolls` when the digest changed, else `shipped
  final: the tested package serves`.
- THE CONTRACT SHIP of an interface: its package written from the
  sources and stored as the deploy writes one; its row the agent's row
  for the package file, with no stamp; the note `shipped: an
  interface row, the contract its implementors are held to`.

The answer: the digest, the waits (none for a held ship), the newest
generation of the agent before the ship (0 when none), whether the
digest differs from the artifact the fleet listed for the agent
before, the note and, for a held ship, the composed row as `heldShip`.

## The evidence

`readEvidence` takes the tester's id, the moment the evidence counts
from, and optionally the target's id and the tester's output: a live
failure names both identities and gets the full evidence; the prepare
phase's best-effort read of a previous unverified compile's failure
names the tester alone and gets its root text, with no target text, no
callee traces and no slices.

THE EVIDENCE of an agent since a moment: the trace agent's calls for
the id with a limit of 12 list the agent's recent calls newest first;
of those at or after the moment, the newest three, in oldest-first
order; each one's tree is THE TREE READ: the trace agent answers a
call a page at a time, so a tree is read call by call, its trace of
the call
(its records page by page, from each `next` the previous answer named
while it moves forward, its children as calls), then each child the
same way, depth first in the order they began, a call met again not
read twice; the tree so read is the view module's call tree, every
call with its records whole. THE EVIDENCE IS THE CONVERSATION THE
TESTS HAD WITH THE AGENT UNDER TEST AND THE AGENT'S OWN CALLS BENEATH
IT, every child rendered whole, the size cuts below keeping the text
bounded. THE ROOT TEXT renders each root call once with the view
module's civilian trace (details and debug on), trims each at its end,
joins them by blank lines and cuts the whole at 24000 characters with
the note `… (trace cut after 24000 chars)` on a new line; any failure
along the way answers the empty text.

THE CALLEE TRACES of the target's evidence: over the same trees, every
child call (`children`, at any depth) whose summary carries an `error`
or a `status` other than `completed` or `ok`, newest first and at most
three, each rendered alone by the view module's civilian trace
(details and debug on, the child's agentId as the view's agent),
trimmed at its end and cut at 8000 characters with the note `… (trace
cut after 8000 chars)` on a new line, named `<the child's agentId>/<its
handler> (<its callId>)`; a failure along the way answers none. THE
EVIDENCE SLICES of the tester's text, when the output is given and
the text is not empty: for each failed test the output names (the
verify module's tester failures over it), the lines of the text from
the line after the previous outcome line (a line whose text after the
time gutter, `HH:MM:SS` when present, starts with `✔ ` or `✖ `; the
text's first line when there is none) through the line carrying `✖
<the test's name>`, when such a line exists; each slice named by the
test's name with every run of characters other than letters, digits,
`.` and `-` replaced by one `-`, cut at 80 characters; a failure
answers none.

## Tests

Read evidence for unique nonexistent agent and tester ids and a future
since time: empty text, slices and callee traces. Do not ship or stop an
operator's agents in this module's tests. Actual deployment, temporary
tester cleanup, waiting and repair are exercised by the coordinator compiles.
Also read previous tester evidence without a target identity; the unused
target and callee evidence remain empty.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
