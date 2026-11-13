# Compile Test Phase

Type: module

Uses:
- cernanto/compile/plan
- cernanto/compile/grammar
- cernanto/compile/workspace
- cernanto/compile/gates
- cernanto/compile/sessions
- cernanto/compile/artifact
- npm:fs-extra

Derive, reuse, generate and repair the tests of one compile target.
The target's contract is the tester's boundary: the test prompt reads
the contract and nothing of the source. A worker, an interface and a
given-code target have no tests, and the coordinator leaves them out.
The coordinator that links this module (the compile front) owns the
compile queue, the attempt claim, the progress sequence, the reports
and the repair budgets across the phases; every path handed in is
absolute, and this phase answers its state and its spend explicitly.

THE PROGRESS PORT the coordinator hands in is two functions of its
own: `checkpoint`, which checks cancellation and the caller's current
claim, and `record`, which takes one phase event (`{step, state,
detail?, ok?, durationMs?, attempt?, failures?, waitingFor?, tests?,
spend?}`, the state `begin`, `end` or `note`). A checkpoint is taken
before and after every session turn, gate run and materialization;
each event is recorded the moment it happens; nothing of the port is
kept between calls. A checkpoint's refusal, a retryable,
target-unavailable or cancelled failure and an abort propagate as they
are.

## The tester

`describeTester` takes the target's id, its parsed spec, whether its
closure reaches an AI capability (`aiInClosure`) and the family's
Tests sections (`familyTests`: per implemented interface, its id and
its Tests section's prose and grants, the workspace spec's, else the
installed one's; an openapi target contributes none), and answers the
tester's id, its parsed spec, its markdown, the combined tests spec,
the Tests section text and the AI grant.

1. THE TESTS SPEC: with no family section, the target's spec itself;
   else the target's spec with a Tests section whose grants are the
   family sections' grants without their file grants, then the
   target's own, and whose prose is, per interface, `The interface
   <id> this agent implements states, for every implementor:` a blank
   line and the section's prose, then the target's own prose when it
   has one, all joined by blank lines. For the plan module it is read
   with its implemented entries always a list and the `Mocks:` ids of
   the target's own Tests section among its tests.
2. THE TESTER: its id and markdown are the plan module's tester spec
   over the tests spec and `aiInClosure`; its AI GRANT is the plan
   module's test AI grant over the same; THE TESTS SECTION text is the
   plan module's tests section of the tests spec. The markdown is
   parsed by the grammar (its `Type: worker` line states the kind; a
   derived spec that does not parse is a terminal failure `the derived
   tester spec for <id> does not parse: <the issues' messages joined
   "; ">`), and the parsed spec is answered as the tester's, in the
   plan module's parsed shape with its members `type`, `uses`,
   `implements` when any, `prose` and `tests` when any, and no other. Npm pins and MCP
   tools come from the coordinator's resolved workspace and gate
   inputs; a tester carries no definition options.

## The deployed tests and the mode

`writeTests` takes the phase's input (the tester workspace's
description as the workspace module takes it, member for member, with
the tester's `npmPackages` and no spec file of the workspace's own,
the gate battery's
input as the gates module takes it, the test session's prompt input
as the sessions module takes it, the session choices (the harness,
the road, the model and the effort), the Tests section text, whether
the contract was kept (`contractKept`), whether the compile amends and
its seed is verified (`amend`, `seedVerified`), the plan's tests
verdict (`planTestsChange`), the deployed tests already read
(`previousTests`, a package's, as the artifact module's package
reader answers them), the mocks (`mocks`: per agent the target's
Tests section lists under `Mocks:`, its id and the hex sha256 of its
contract's text now) and the implementors (`implementors`: per
interface the target grants, its id and the implementors deployed or
planned, each `{id, type}`)) and the progress port.

THE DEPLOYED TESTS are `previousTests` when given (nothing is
fetched); else, when a previous tester artifact is given, it is
fetched through the artifact module into `<previousDirectory>/tester.cern`
(the directory made) and read by the artifact module's deployed-tests
reader into `<previousDirectory>/tests`; an artifact the store does not
hold, or a read that fails, means no deployed tests.

THE MODE: the section CHANGED when the deployed tests recorded the
section's text and it differs from the Tests section text given, or,
when they recorded only its sha256 (`testsSectionSha`: a package
records the hash and no text), when the sha256 hex of the text given
(none for no text) differs from it; the seed is ok when the compile
does not amend, when it amends over a verified seed, and when it
amends over an unverified seed nothing has faulted, the prompt input's
own `update` naming no failure (tests that have not run stand as
written, and the live cycle is their proof); THE MOCKS are compared
as sets of `{id, contractHash}`, the ones given against the ones the
deployed tests recorded (none when they recorded none): the list
changed when their counts differ or a given id was not recorded, and
an id MOVED when both record it with different hashes. With no
deployed tests, or none with files, the mode is GENERATE; else REUSE
when the contract is kept, the section is unchanged, the plan's tests
verdict is not true, the seed is ok and neither the list changed nor
an id moved; else UPDATE (a mock implements the contract it was
written against, so a moved contract rewrites it). An update notes
(`write tests`, `tests: 'updated'`) `updating the deployed tests:
<the reasons that apply, joined ", ">`: `the Tests section changed`,
`the contract changed`, `the mocked agents changed` (the list
changed), `the contract of <id> moved` per moved id, `the seed is not
verified` (an amend over an unverified seed whose tester's failure
the prompt input's `update` names) and `the plan asks for
new tests` (the plan's tests verdict), so the reason is never blank.

THE TESTER IS MATERIALIZED by the workspace module's tester workspace
over the description given, the tester's `npmPackages` (the names of
its parsed spec's `npm:` grants) handed in since that module reads no
page, with the deployed files kept (none for GENERATE); its typeless npm names ride into the session prompt and
the answer. A checkpoint follows.

- REUSE: note (`tests: 'reused'`) `reusing the deployed tests (<n>
  file` (`files` above one) `): the contract was kept and the Tests
  section is unchanged`; THE TESTER'S GATES; ok ends the phase with
  the gates, the tester contract and no spend. Not ok opens THE TEST
  SESSION with an update whose failure is the doctrine's fix section
  `reused-tests-checks` followed by a newline and each failed gate as
  `<gate>:` newline its output, joined by blank lines, the gates so
  far in its history.
- UPDATE: THE TEST SESSION with the update.
- GENERATE: THE TEST SESSION with no update.

THE UPDATE a session is given starts from the prompt input's own
`update` when the coordinator handed one (an unverified seed's failure
already in it survives, replaced only by a failure this phase
supplies), then: a changed Tests section or changed mocks sets
`testsSection` to the deployed section's text (none when the deployed
tests carry no text) and the text given; a contract that was not kept
sets `previousContract` to the text of the contract the deployed
tests were written against, when they record its file; a failure this
phase supplies sets `failure`.

THE TESTER'S GATES: record `check tests` begin `tsc, determinism,
type-verify`; the gates module's code gates over the tester directory
with the tester's id, its type, its spec's npm grants,
and the file grants, the implemented contracts and the contract to
keep each when the battery's input carries it; the tester contract
read (the gates module's); ok when every gate passed and a contract
was read; with every gate passed and no contract, the history gains
`{gate: 'tsc', ok: false, output: 'no contract declarations were
emitted'}` and that gate alone counts as failed; record `check tests`
end with the gate names joined `, `, ok, the duration and, when not
ok, the failed gates as `{name: <gate>, message: <its output>}`, or
`[{name: 'tester contract', message: 'no contract declarations were
emitted'}]` for the missing contract; a checkpoint.

## The test session

THE TEST SESSION runs at most three attempts over the history and
spend it is handed. Each attempt: a checkpoint; record `write tests`
begin with the attempt number (`attempt 1`, or `attempt 1, fixing the
tests` for a repair's first session, else `attempt <n>, fixing the
check failures`). The first attempt opens the session through the
sessions module with the harness, the road, the tester's session root
(its directory when it has none), the sessions module's test session
prompt over the prompt input with the typeless npm names, the
implementors (each `{interfaceId, agents}`) and the update when there
is one, the doctrine's test session text, and the doctrine version
with the model and effort; a later attempt resumes it with the
doctrine's fix section `tests-gates` filled with `report`, the
sessions module's failed-checks words over the last failed gates (the
section's one placeholder). A turn that cannot run records `write
tests` end `attempt <n>`, not ok, with its duration, and ends the
phase not ok with the failure's words as its detail; the session id,
the coder and the spend are kept; record `write tests` end `attempt
<n>` with ok (the turn completed), its duration and its spend; a
checkpoint; a turn that did not complete ends the phase not ok with
the turn's output as its detail. Then THE TESTER'S GATES, appended to
the history; ok ends the phase with the session id, the coder, the
gates, the spend and the tester contract. Three attempts spent end it
not ok. The tests' spend folds into the report.

The answer: `ok`, the tester contract when one stands, the session id
and the coder when known, the detail when an ordinary refusal ended
the phase, the cumulative gates, the cumulative spend, the mode
(`generated`, `updated` or `reused`), the typeless npm names and the
deployed tests that were read.

## The regate and the repair

THE CURRENT TEST FILES are kept before any later materialization
removes the tester's directory: the tester's test files are asked of
the workspace module, which answers them by name once it has read
them, and each file of that answer is written under
`<previousDirectory>/kept-tests` (emptied first) and handed to the
materialization as the files to keep, so the kept set is every test
file the tester held.

`regateTests` takes the phase's input, the prior result and the words
that explain the regate: a checkpoint; record `check tests` note with
the words; the current test files kept; the tester materialized again
against the corrected target contract (the caller updated the
workspace's target contract path and the prompt's contract); a
checkpoint; THE TESTER'S GATES, with no session turn. The answer is
the prior state with the fresh gates appended to its history, the
tester contract when one was emitted, and the prior session, coder,
spend, mode and deployed tests unchanged.

`repairTests` takes the same with the coordinator's instruction and
whether healing turns are allowed: a checkpoint; the current test
files kept; the tester materialized again; a checkpoint; THE FAILURE
is the instruction and the words, the empty ones left out, joined by a
blank line. Without a session, THE TEST SESSION opens as a repair
(its first attempt narrating `attempt 1, fixing the tests`) with THE
UPDATE above over the prior deployed tests (no section change, the
previous contract when the contract was not kept) carrying that
failure, the prior history, spend and mode. With a session, at most one turn plus two
healing turns when healing is allowed: each records `write tests`
begin (`attempt 1, fixing the tests` for the first, `fixing the check
failures (<the healing turn's number>)` after) and resumes the session
with the failure for the first turn, then with the doctrine's fix
section `heal` filled with `what` (the filled `heal-what-tests`
section) and `report` (each failed gate as `<gate>:` newline its
output, joined by blank lines, cut to 4000 characters); the turn's
end, failure and gates are recorded and answered as a session
attempt's are (a turn that cannot run or did not complete ends the
repair not ok with its words); gates that pass end it ok with the
tester contract. The answer is the updated state with its cumulative
gates and spend; the coordinator folds only the increase and judges
who is at fault.

## Tests

Exercise tester derivation with inherited interface Tests, file grants and
an empty family. Family file grants are excluded, own grants preserved,
and the derived tester is a worker. Session and gate paths are verified
through real compiles under the coordinator's job lifetime.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
