# Compile Repairs

Type: module

Uses:
- cernanto/compile/judge
- cernanto/compile/code-phase
- cernanto/compile/test-phase
- cernanto/compile/live-cycle
- cernanto/compile/progress
- cernanto/compile/sessions
- cernanto/compile/workspace
- cernanto/compile/npm

Decide who is at fault when a target's tests fail, and repair the
side that is: the triage of tests that do not type-check against the
code, and the live rounds of a target, each round a deploy and a run
of its tester through the live cycle, each failure triaged and
repaired until the tester passes, the operator is waited for, or the
cap is reached. The target module (which links this module) hands in
the phases' inputs and results and keeps what comes back; the
coordinator above it owns the compile. Every path handed in is
absolute. The shapes its functions take and answer (the judge
settings, the phases' inputs and results, the sources and facts, the
rounds' outcome) are declared in its own contract, whatever module
they came from.

## The repair instruction

A repair instruction is rendered through the sessions module from the
selected fix-doctrine section of the folder the caller names
(`doctrineFolder`, optional in the settings of every function of this
module that renders one; the sessions module's own when none), loaded
for each render: the section's slots filled with the
failure output (a slot named `failure`, `failureOutput`, `output`,
`evidence` or `report`), the triage analysis (`analysis`, `triage` or
`triageAnalysis`) and the current contract (`contract` or
`currentContract`), any other slot filled empty, and the evidence the
section took no slot for appended after it, each piece joined by a
blank line, the analysis under the heading `Triage analysis:` and the
contract under `The current contract:`. That complete text goes to
the phase's repair operation; the phase owns executing the
instruction and its gates. The rendering is a function of this
module's own, so the words of a repair can be read without a repair.

## The triage

THE TRIAGE asks the judge who is at fault, records the verdict and
keeps the history. It is given the spec's prose, the implementation
and test file names (the workspace module's coder files of the code
workspace and test files of the tester workspace, by name), the
failure output, the implemented and dependency contracts, the npm
declarations (each granted package's entry declaration through the
npm module, one that answers nothing left out) and the available live
evidence (the callee traces by name). Its judge root (`<the target's
folder>/triage`, made by the workspace module) exposes `agent/src`,
`tester/src`, their `node_modules` and the code workspace's
`platform.d.ts`, with `spec.md`, `failure.txt`, `trace-tester.txt`,
`trace-agent.txt` and per-test evidence slices under their names. The
returned live traces are written verbatim and their slices and failed
callee traces carried into the judgment; test source is not a trace.
The available slice names are mentioned at the end of the failure
output (`evidence slices: <the names joined ", ">` after a blank
line). Record (through the target's progress port) triage begin `who
is at fault`, end naming the side (`the platform`, `the interface`,
`the code and the tests`, `the code` or `the tests`) with its duration
and spend, and each judgment's duration and spend as `<side>
finished`. The judgment runs on the compile's model and effort (the
judge settings handed in: the harness, the sessions road, the model
and the effort). THE HARNESS IS THE COMPILE'S VENDOR, `claude-code`,
`codex` or `fake`, and absent when the compile has none: the `fake`
vendor is a vendor like the others, its sessions scripted for the
proofs, and a round or a triage under it runs as under any vendor;
only a compile with no vendor at all (the harness absent) asks no
judgment and no repair. The judgment's spend is folded into the
target's report.

## The type-check triage

When type-checking the tests finds the code at fault, increase the
report's triage count and request a code repair with
`type-check-triage-code` (the failure the tests' detail, `the tests
did not compile` when none, and the analysis), the reason `the tests
do not compile against this contract` when the tests give none, with
no live healing allowance. A passing repair adopts its contract and
asks an open test session to apply `contract-corrected` (the
instruction rendered with the new contract, the reason
`contract-corrected`; the test phase's input carries the new contract
in its target and its prompt, THE CORRECTED DECLARATION WRITTEN TO THE
TESTER'S CONTRACT FILE, the target's `contractPath`, before the tests
are repaired or re-checked, so the tests meet the repaired API and
never the stale one). A moved given contract fails with `the
code fix drifted from the given previous contract`. The report's
triageCount counts these type-check-triage repairs; live repairs have
the separate liveCycles counter. A verdict that finds the code sound
leaves the tests as they are. Tests still not ok fail with `the test
session never produced tests that type-check`. A judge call that fails as retryable,
target-unavailable or cancelled passes that failure through as it is
(the compile's own retry and cancellation), never as triage words; a
type-check triage whose judge fails otherwise gives no verdict, and
the tests that never type-checked are the failure: `the test session never produced tests
that type-check`, the failed gates' words after it (`<gate>: <output>`
per failed gate, newline joined and cut to 4000 characters), and
`Triage could not answer: <the judge's failure>` on a line of its own.

A type-check-triage platform verdict fails with `the failure traces to
the platform, not to the code or the tests`, then `Triage analysis:`
and the analysis. An interface verdict fails with `the failure traces
to the interface` (`interfaces` above one) followed by ` this agent
implements (<ids joined ", ">): the interface's own description is
ambiguous or wrong, and no fix to the code or the tests here can settle
it. Fix the interface specification and recompile the family.`, then
`Triage analysis:` and the analysis. Separate that analysis block with
a blank line.

The answer of the type-check triage: the code result and the test
result as they stand after it, each with its cumulative attempts and
spend, the current contract and coder, and the triage count; a
failure is in the words above, the words the target reports.

## The live rounds

THE LIVE ROUNDS run the live cycle once per round with THE SOURCES of
the target's package and THE PACKAGE FACTS of the target as the target
module assembles them, the target's id and type, the compile's id,
the round's folder under the target's folder, the mocked ids on every
ship, and the progress port. THE ROUNDS ARE THE COMPILE'S, NOT THE
ATTEMPT'S: a round's number is one past the last round the progress
document names for the agent (the progress module's records under the
claim handed in), written into the document before the round's pair
is shipped, so a retried attempt (the job's body run again) continues
the count, each round's ids its own; a round the document records
with a verdict is reused as it stands, VERIFIED OR FAILED (a failed
verdict goes to triage as the run that just ended would, the same
code never run again and no repair counted for it), without a new
deploy, and a
round it records without one was cut mid-way and is left to the
controller's cleanup (its pair names this compile as its owner), the
next number starting fresh. The live-cycle counter below counts the
rounds this compile ran across its attempts, read from the same
record (the rounds recorded, less the one reused). The run budget is
the verify module's default of ten minutes and the ask budget its
default of fifteen. The doctrine's `timeout-run` and `timeout-ask`
words are supplied, rendered through the sessions module with each
section's duration placeholder filled from that same budget in
human-readable form (the sessions module's duration words; `the run
outlived its budget` and `the run is parked on a credential ask` when
the doctrine has no such section). Record verify end from the
returned outcome (ok, the output as the detail, the failures, the
accounts waited for and the verification duration), and settle the
round in the document with the outcome.

A round answering `platformFault` fails the target with the round's
failure words, with no triage and no repair. Waiting records the
accounts (`verify` note) with `waiting for you: <cernanto auth login
<account> per account joined ", ">` and ends without a repair, the
accounts answered as the target's `waitingFor`.

THE REPAIR COUNT is the number of repairs this compile has made for
the agent: the rounds the progress document names for the agent, less
one, since the first round is no repair and each later round followed
one (so a fresh attempt starts at zero once its first round is
recorded, a retried attempt goes on where the count stood, and a
reused round, verified or failed, is not counted: the counter counts
repairs made, never runs), and one more after each
repair. A
failing round that finds the count at the cap (`maxLiveCycles`, three
when the request names none) ends the loop; so a cap of three allows
three repairs and four runs, and a cap of zero fails at the first
failing round. Otherwise the count grows by one, the returned
evidence is appended to THE HISTORY under the doctrine's
`evidence-tester` and `evidence-agent` headings (`the tester's trace`
and `the agent's trace` when the doctrine has none; the history is
the text the judgment is handed as its history, the rounds' evidence
so far), and the round is triaged with the round's output as the
failure output (the slice names after a blank line, as above) and
that history. The first platform verdict records (`triage` note) `the
platform was at fault; running the tests again` and retries without
an edit; the second fails with `the platform is at fault: ` and the
analysis. Interface verdicts fail as above.

A code verdict requests live-code repair (`live-code`, the round's
output and the analysis, the reason `the live tests fail`), including
the phase's live gate healing, and checks a changed contract against
the retained tests before storing again (the test phase's regate with
the words `contract-corrected`, its input carrying the new contract,
written to the tester's contract file first).
A tests verdict requests live-tests repair (`live-tests`, the analysis
and the current contract, the reason the round's output). A verdict
that finds both sides at fault requests the code repair first and
then, its gates passed, the tests repair with the same analysis,
before the next live round: one cycle, one run. Given-contract drift
is `the live fix drifted from the given previous contract`. Failed
code repair is `the module no longer passes the gates after a live
fix:`; failed test re-gating is `the tests no longer type-check against
the fixed contract`; failed test repair is `the tester no longer
passes the gates after a triage fix:`. Append failed gates as `<gate>:
<output>`, newline joined and cut to 4000 characters. Missing-contract
details are respectively `the contract could not be read back after
the fix` and `the tester contract could not be read back after the
fix`. The phases' updated state and spend are preserved before another
round, and the sources of the next round are assembled again by the
target module from the repaired code, its contract and the tests (a
function of the target's the rounds are handed and call after every
repair). A code repair is not ready for another live round until the
retained tester has passed its gates against its current contract.

A final non-ok outcome that is not waiting fails with `the tester
still fails after <cycles> cycles:` and its output cut to 4000
characters on the next line; so does a failing round of a compile with
no vendor, whatever the cap allows.

The answer of the live rounds: `verified` with the verifying round's
outcome (its deployed digests, its pair and its number) and the
sources it verified with, or `waiting` with the accounts; the code and
test results, the contract and the coder as they stand after the
repairs, each spend cumulative; the rounds run and the repairs made.
The final ship of a verified round and the removal of its pair are the
target module's.

## Tests

The repair instruction over the fix doctrine the sessions module
loads, its sections as the doctrine renders them: the slots a section
names (the failure, the analysis, the contract) are filled and nothing
is appended for them; what a section lacks is appended after a blank
line (the failure, `Triage analysis:`, `The current contract:`); an
unknown slot is filled empty. The repair count: a cap
of three allows three repairs and four runs; a cap of zero ends at the
first failing round; a retried attempt starts its count at the rounds
recorded. The budget words' fallbacks (`the run outlived its budget`,
`the run is parked on a credential ask` when the doctrine has no
section), triage, the repairs and the rounds themselves are proven by
the coordinator's own compiles.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
