# Compile Verify

Type: module

Uses:
- cernanto/controller
- cernanto/auth

Reach into the plane for the compile while it verifies an agent live:
ship the fleet rows through the controller, read the fleet back from
it, run the deployed tester under the patience clock, and phrase what
every one of these answers. Every reach is a call of a granted agent's
function.

## The plane's reads

THE FLEET VIEW is what the controller answers for the fleet: its rows
exactly as shipped (each with the plane's own `running` beside), its
generations (each with its agent id, its number `gen`, the digest of
the package it runs, its status and, when it carries one, its
composition) and its conditions (each with its type, its status, and a
reason and a message when the view names them). A call that fails, or
an answer that is not the view's shape, reads as no view at all (the
plane blinks during rolls; the caller asks again).

- `fleetState`: nothing (null) when there is no view; else `newest`:
  for each agent, its generation of the highest `gen` with that
  generation's `status` and `package`; `artifacts`: each row's
  `artifact` by agent id, over the rows that carry one;
  `compositions`: the composition of each agent's newest generation,
  over the agents whose newest carries one; `conditions`: the view's,
  each as `{type, status, reason, message}` with an empty text where
  the view names no reason or no message, or an empty list.
- `deployedRows`: an empty list when there is no view; else each row
  as `agentId`, `artifact` (an empty text when the row carries none),
  `testerArtifact` when present, `uses` (the row's strings; an empty
  list when absent), and `type`, `contract`, `specSha`,
  `usesContracts`, `implements`, `contractCompatibleWith` each when
  present and as the row carries them, `verified` (the `at` of the
  row's stamp, a string) when the row carries one: a compile reads it
  to know whether the previous compile passed its live tests, and
  `package` (the row's `{digest, version?, publisher?}`, the digest a
  string) when the row carries one: an installed row names the package
  it came from.
- `runningContract`: the contract the agent given runs with, read off
  the fleet view: nothing (null) when the view has no row for the
  agent or its row carries no `contract` text, and nothing too when
  the controller refuses the read with exactly `no agent "<agentId>"`
  (the agent id spelled as asked); else `contract` and the row's
  `specSha` when present. A view of another shape fails with `the
  controller answered an unexpected fleet view: <the answer as JSON,
  its first 300 characters>`, and any other failure is the failure
  itself: an agent the caller cannot read is told apart from one that
  was never deployed.
- `pendingAskAccounts`: the asks the agents given are parked on, read
  through cernanto/auth's listing of an agent's accounts, once per
  agent id given (the compile reads the asks of the agents it
  verifies); the answer is the accounts of the pending asks requested
  at or after the moment given (plain string comparison of the iso
  texts), each as its words (the account's agent, a space, and its
  name: what the cli takes after `auth login`), without repeats,
  sorted; a listing that fails adds nothing.

## The ship

`shipRows` ships the rows through the controller with protocol 0, the
op `fleet.ship` and the rows verbatim; the controller's refusal is the
failure itself, in its words.

`awaitActive` takes `agents` and `seconds`, `agents` each `{id,
artifact}` (the digest the agent's row shipped), and waits for the
shipped agents to serve: the fleet view read every two seconds until,
for each agent, the newest generation's `package` is the artifact and
its status is `active`, at most the seconds given. A generation of the
artifact is the one the ship caused; the newest generation before the
plane's pass has planned it is the older one, which is active and is
not what is waited for. An agent whose row is a module or an interface
has no generation and counts as served at once; a worker's generation
of the artifact counts when it is `active` or `finished`. It answers
`{active, pending}`: the ids that served in time, and, for each of the
others, `{id, words}`, the words `<id> (no new generation)` when the
view has no generation of the artifact and `<id> (generation <gen>
<status>)` otherwise. It answers in every case: a deploy whose plane
is slow is told so, and goes on.

## The words of a pair that never came up

`notActivatedWords` takes the pair's waits (each `{agentId, before}`,
`before` the agent's newest generation number before the ship, 0 when
it had none), the fleet's state read then (or null when the plane
gave none) and the timeout in milliseconds, and phrases a ship whose
generations did not come up, read when a tester's run ran out of its
patience: the waiting rows are, for each wait, `<id> (no new
generation)` when the state has no generation for it above `before`,
nothing when that newer generation is `active`, and `<id> (generation
<gen> <status>)` otherwise; the head is `the plane did not activate
<the waiting rows joined by ", "> within <the timeout in minutes,
rounded> minutes`; with no state the text is `<head>: the plane did
not answer`; else the faults are the messages (or the types, for a
condition without a message) of the conditions whose status is
`False` and whose type is not `AgentsVerified`, and the text is
`<head>: <the faults joined by "; ">` when there are any, else
`<head>: the fleet names no fault; a module the row composes may
still be compiling (a compile that has not ended: deploy that module
again)`.

## The patience clock

The tester's run is bounded by two budgets: the run's (ten minutes
unless given) burns while no credential ask is parked on the operator,
the ask's (fifteen minutes unless given) burns while one is. Every
tick (the smaller of 5000 and the larger of 50 and a quarter of the
smaller budget, in milliseconds) the accounts asked for since the
moment given are read as `pendingAskAccounts` reads them for the
tester and the agent it tests (the two ids given, the tester's and its
`testOf`; a failed read counts as no ask); the elapsed time since the
previous tick is charged to the ask's budget when any account is
pending, else to the run's. When the ask's budget runs out, the clock
ends the wait with the ask's words; when the run's runs out, with the
run's words. The tester's answer ends the clock the moment it arrives:
a result settles the run, a failure fails it with the failure's
message.

## The tester run

`awaitPair` takes `testerId`, `testOf` and `seconds` and waits for a
round's rows to serve: the fleet view read every two seconds until the
tester's newest generation is active and, unless the test form is a
module (a module's form composes into its tester and has no generation
of its own), the form's newest generation is active, at most the
seconds given; served answers, else it fails with `<row> has no active
generation after <seconds>s` for the first row still without one (the
tester's looked at first), followed by the fleet's conditions whose
message names that row, one message per line (a pin the composition
refuses names itself here; a backend that did not start the process
names itself in the generation's own words).

`runTester` runs a round's tester, given the tester's id and its
`testOf`, the moment asks count from, the pair's waits (each
`{agentId, before}`) for the words of a pair that never came up, and
optionally its budgets and words together (`runMs`, `askMs`,
`runWords`, `askWords`; `the run took too long` and `the operator took
too long` when absent): it calls the tester's `run` with the
language's own function for calling an agent named at run time (the
os module's `invoke`, the arguments `{}`) the moment it is asked,
whether or not the tester serves yet (a call waits for its service and
is taken the moment the service serves), races that one call against
the patience clock (its budgets and words the ones given, the asks
counted since the moment given), and reads the settled result with
`testerResultOf`, strictly: an object with `passed` a number and
`failures` a list, else the failure `the tester answered an unexpected
shape (wanted { passed, failures }): <the answer as JSON, its first
300 characters>`; each failure's `name` when a string (else `unnamed
check`) and `message` when a string (else the entry as JSON). The
outcome: `ok` when no failure and `passed` above zero; `output` the
tester's words (`testerWords`): `<passed> tests passed` (`1 test
passed` for exactly one) alone when nothing failed, `the tester ran no
tests` when nothing passed either, else `<passed> tests passed, <n>
failed:` (the same singular for one) followed by one line `- <name>:
<message>` per failure; `passed`; `failures`. When the run itself
fails (a call the plane refuses, a run that ended in failure, an
answer of the wrong shape, and a cut by the patience clock on either
budget), the outcome is not ok, with `passed` 0 and no failures, and
its output is `the tester could not run: <the error's message>`, the
clock's own words being the message when the clock cut it (`the
tester could not run: the run took too long`, `the tester could not
run: the operator took too long`), followed, when the clock cut the
run and the fleet's state read then shows a row of the pair that has
not come up (no generation newer than its wait's `before`, or a
newest generation that is not active), by a line of its own carrying
the not-activated words over the pair's waits, that state and the
budget that ran out (a pair that never came up says why); a state the plane
cannot give adds nothing, and the prefix stands in every case. An
outcome that is not ok gains `waitingFor` when any account is named:
the accounts asked for since the moment given, read as
`pendingAskAccounts` reads them (a failed read adds nothing) for the
tester AND the agent it tests when the patience clock cut the run on
the ask's budget (the run was parked, whoever asked), and for THE
AGENT IT TESTS ALONE in every other case (a result, a failure of the
run's own, a cut on the run's budget): a request the tester itself
opened and left pending is its test data; sorted and without repeats.
A run parked on the operator is waiting.

`testerFailures` reads the failed checks back off the words: every
line starting with `- `, split at the first `: ` into the name and
the message (a line without one is a name with an empty message).
`verificationWords`, given the verification and optionally the
accounts waited for: `verified live` for `live`; `compiled, waiting
for you: ` followed by one `cernanto auth login <the account's words>`
per account waited for, joined by `, `, for `waiting`; `compiled,
tests not run` for `none`; `compiled` otherwise.

## The pair's removal

`runTester` makes exactly one call of the round's tester; the account
lookup between its ticks never holds a settled call: the call's
settlement is read before and after a lookup, and a lookup still
pending when the call settles is left to its own end while the result
returns at once; on either
timeout the clock ends the wait with its words, and the pair's removal
that follows ends whatever the run was still doing. `removePair`
removes a round's two rows from the fleet through the controller's
agent removal, without force: the tester first, then the test form; a
refusal or a failure is the failure itself, in the controller's words,
and a removal the controller held back (it answers the rows that use
the agent in place of a removal) fails with `agent "<id>" was not
removed: <those rows joined by ", "> use it`.

## Tests

Nothing here reaches a real plane: the controller and auth are faked
by their contracts in the test's world (a fleet view the test holds
and changes, a running contract, a ship that records its
rows, an agent removal that records its ids, the asks of an agent's
accounts the test opens). The tester's call is the language's own: in the test's
world, which has no plane, a call to an id nothing serves is refused
in words, and runTester lets that refusal through with its
classification (the test asserts the rejection and its words). The patience
clock's budgets and cuts are exercised by the plane's own compiles;
here the tests prove the words: `testerResultOf` strict over shapes,
`testerWords`, `testerFailures`, `verificationWords`,
and `pendingAskAccounts` over the faked auth (a
pending request of another agent is not counted, and the read
filtered by `agents` leaves it out), and a tester whose call settles
while the faked auth holds the account lookup returns its result at
once.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
