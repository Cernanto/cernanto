# Compile Code Phase

Type: module

Uses:
- cernanto/compile/workspace
- cernanto/compile/gates
- cernanto/compile/contract
- cernanto/compile/sessions
- cernanto/compile/artifact
- cernanto/config
- cernanto/machine
- npm:fs-extra

Write the code of one compile target: materialize its workspace, seed
or generate the implementation, run the gates, keep the contract the
compile must keep, and repair the code on the coordinator's
instruction. The coordinator that links this module (the compile
front) owns the compile queue, the attempt claim, the progress
sequence, the lockfile, the reports, the dependency cascades and the
repair budgets across the phases; every path handed in is absolute,
and this phase answers its state and its spend explicitly.

THE PROGRESS PORT the coordinator hands in is two functions of its
own: `checkpoint`, which checks cancellation and the caller's current
claim, and `record`, which takes one phase event (`{step, state,
detail?, ok?, durationMs?, attempt?, failures?, waitingFor?, tests?,
spend?}`, the state `begin`, `end` or `note`). A checkpoint is taken
before and after every session turn and every gate run; each event is
recorded the moment it happens; nothing of the port is kept between
calls. A checkpoint's refusal, a retryable or target-unavailable
failure of a session, and a failure whose words name a cancellation
propagate as they are.

## The workspace

`writeCode` takes the phase's input (the code workspace's description
as the workspace module takes it, member for member, with the npm
packages the spec grants as `npmPackages` and no spec file, the code
session's prompt input as
the sessions module takes it, the gate battery's input as the gates
module takes it, the session choices (the harness, the road, the
model and the effort), whether the contract to keep was given
(`preservedWasGiven`), the optional seed, the previous compile's
directory for an amendment (`amendDirectory`) and the resume seed's
location (`resume`: the seed root, the compile id and the agent id, a
destination of this attempt's own)) and the progress port. The
dependency entries come resolved (the full module closure, the
scan-linked implementors included) and are used as given, and so do
the paths of the custody contract, the implemented contracts, the
contract to keep and the api documents, and the implemented document's
module name (`documentName`), handed to the sessions module beside the
implemented contracts for its prompt.

The workspace module materializes the directory and the session root
beside it, handed the names of the npm packages the target's parsed
spec grants (`npmPackages`), since that module reads no page; the vendor's sessions run in that session root, and the
compile workspace, which holds the compiler's full dependency tree,
serves the gates and the emission alone. The materialization's answer
(the installed npm versions for the coordinator's pins, the typeless
npm names for the prompts, the timings) rides on the phase's answer as
`materialization` and `typelessNpm`. Record `prepare` end `workspace
ready`, followed by `, npm: <the granted packages joined ", ">` when
any, ok with its duration; timings totaling at least 1500 ms are noted
(`prepare`) as `workspace materialized in <total>s: <name> <seconds>s,
...`, one decimal, over the parts of at least 100 ms.

## The seed

THE SEED, when given, is `{kind, files, coder?, needsChanges?,
newContract?, note?}`: the kind `given` (the agent's given files),
`resume` (the resume seed's files and coder record) or `amend` (the
previous compile's files and coder record); `files` maps each path
under `src/` to the file to copy from; every file is copied under the
workspace's `src/` and the coder record becomes the phase's.

- An AMEND whose plan needs changes (`needsChanges`) or under which A
  NEW CONTRACT IS ASKED (`newContract`: the coordinator's ask for the
  target, so the contract is written anew from the specification
  whatever the record and the plan hold) runs no gates first: THE
  AMEND SESSION opens (below).
- Every other seed is RE-GATED first: note (`write code`) `gating the
  given code: no session` for a given seed, `resuming the gate-passed
  code from the previous attempt` for a resume seed, and the seed's
  note for an amend (`gating the previous compile` when it carries
  none); THE GATES run with ` (resumed code)` appended to their end
  record. Passing gates with a readable contract end the phase with
  the attempt records `[{attempt: <1 for a given seed, else 0>, gates,
  ok: true}]`, no spend, the seed's coder, the code `regated` for an
  amend and `fresh` otherwise, the resume seed stored as on every
  passing path. A GIVEN seed that fails notes `the given code no
  longer passes: <the failed gates' names joined ", ">; amending`, an
  AMEND seed that fails notes `the previous compile no longer passes:
  <the names>; amending`, and in both THE AMEND SESSION opens with the
  failed gates' words (the sessions module's failed-checks words over
  the doctrine's fix prompts) as its `gateFailures` (the code was
  certified once; what fails it now is a dependency whose contract
  moved or a gate that grew, and the session amends it against the
  words); a RESUME seed that fails notes `the resumed code no longer
  passes under this compiler; writing fresh` and the session starts
  fresh.

THE AMEND SESSION'S CONTEXT is the prompt input's `amend` when the
coordinator handed one, else `{previousDir: <the amend directory, or
an empty text>, files: <the seed's paths>, summary: "the code no longer
passes its checks", diff: "", entries: "", seed: "verified"}`, with
the `gateFailures` above; the prompt's `newContract` is set when the
seed asks one.


## The session

THE CODE SESSION runs at most five attempts. Each attempt: a
checkpoint; record `write code` begin (`attempt 1`, or `attempt 1,
amending` for an amendment, else `attempt <n>, fixing the check
failures`, carrying the attempt number). THE FIRST TURN links the
previous compile and opens the session: when an amend directory and a
session root are given, `<the session root>/previous` is removed and
made again as a directory link onto the amend directory by the
machine (the machine interface bound with no name, the implementor the
plane binds), so the vendor's policy keeps it read-only; the prompt is the
sessions module's code-session prompt over the prompt input with the
typeless npm names added when any, the amend context when one is
prepared (and none otherwise), and `newContract` when the seed asks
one, followed by the refused-shapes section when there is one; the
session opens through the sessions module with the harness, the road,
the session root (the workspace's directory when it has none), that
prompt, the doctrine's code session text for the agent's type, and the
doctrine version with the model and effort. A LATER TURN resumes the
session with the sessions module's failure report over the last gates
and the doctrine's fix prompts. A turn that cannot run fails the agent
with `the code session could not run: <reason>` (a classified failure
and a cancellation passing through as they are). The turn's session
id is kept, its coder record becomes the phase's when it reports one,
its spend is added; a checkpoint; record `write code` end `attempt
<n>` with ok (the turn did not fail), its duration, its spend and the
attempt number. A turn that failed ends the phase not ok with the
turn's output as the detail (`the code session failed` when it has
none). Otherwise THE GATES run and the attempt is recorded `{attempt:
n, gates, ok}`; passing gates with a contract end the phase ok. Five
attempts spent end it not ok with the detail `the code session
exhausted its cycles`.

A phase that is not ok answers the accumulated attempts, gates, coder
and spend intact and the failure's words as its detail; its code is
`amended` for an amend session and `fresh` otherwise.

## The gates

THE GATES: a checkpoint; record `check code` begin `tsc, determinism,
kind`; the gates module's code gates over the workspace with the
battery's inputs (the file grants, the implemented contracts, the lane
hosts and the removed surface, each when the coordinator handed it,
passed through as given) and, in the initial mode only, the contract
to keep as its strict preserved path when it was given. Then the
emitted contract is read (the gates module's). With every gate passed
and a contract read: THE CONTRACT TO KEEP, when given, is read from its
path; in the repair mode the emitted contract is compared with it
(the contract module's comparison with the workspace's declaration
siblings and the texts of the dependency contracts the workspace was
materialized with, each read from its path, an unreadable one left
out) and a difference adds the failed gate `{gate: 'contract', ok:
false, output: <the drift wording handed in>}`. With every gate still
passed, the workspace's `types/index.d.ts` is written: A PRESERVED
CONTRACT IS THE PREVIOUS TEXT, the contract to keep written byte for
byte (so the package's contract hash is the previous one and no
consumer's pin moves for a rewording of the declarations'
documentation); else the contract of an interface, or one that
re-exports from ANY sibling file (a root `export` or `import` line
whose `from` names a relative path: the generated twins under
`./agents/`, or a file of the coder's own such as `./types.js`), is
FLATTENED (the contract module's flattening with the workspace's
declaration siblings) and written over it, so every consumer, stamp
and row hashes one self-contained text; the phase's contract is the
text written. Every gate passed with no contract read adds the failed
gate `{gate: 'tsc', ok: false, output: 'no contract declarations were
emitted'}`. The run is ok when every gate passed and a contract stands;
a checkpoint; record `check code` end with the gate names joined `, `
(and the suffix the caller asked), ok, the duration, and the failed
gates as `{name, message: <the first line of its output>}` when any.

## The resume seed and the answer

A passing phase STORES THE RESUME SEED when a resume location was
given: the workspace module's coder files written under a scratch
directory beside the compile workspace (`<the workspace's name>-resume-
scratch`, removed first), the artifact module's resume seed store over
that directory with the coder record, the scratch removed; the seed
root is answered as `resumeSeedRoot`, and the caller publishes the
pointer under its attempt claim. Only gate-passed code is stored.

The answer: `ok`, the contract when one stands, the session id and
the coder when known, the attempt records, the last gates, the spend,
the code (`fresh`, `amended` or `regated`), the materialization, the
typeless npm names, the detail when not ok, and the resume seed root
when stored.

## The repair

`repairCode` takes the prior phase's input and result, the
coordinator's instruction, the reason its progress records, whether
the repair may heal failed gates (a live repair permits two healing
turns, a compile triage none) and the wording a drifted given contract
is refused with, and the progress port. A TURN: a checkpoint; record
`fix code` begin with the reason; the session resumed with the text
when the phase has one, else a first session opened as the code
session opens (the previous compile linked, the prompt the
code-session prompt over the prompt input with the prior result's
typeless names and no amend context, followed by a blank line and the
text); a turn that cannot run, or that failed, fails with `the code is
at fault and no session can fix it` (a classified failure and a
cancellation passing through); the session id, the coder and the
spend are kept cumulative; a checkpoint; record `fix code` end with
the reason, ok, the duration and the turn's spend. The repair: one
turn with the instruction under the reason given, then THE GATES in
the repair mode with the drift wording, the attempt recorded after the
prior ones at the next attempt number; with healing, while the gates
fail and at most twice, a turn with the doctrine's fix prompts' `heal`
section filled with `report` (the sessions module's failed-checks
words over the failed gates, cut to 4000 characters) and `what` (the
filled `heal-what-code` section) under the reason `fixing the check
failures (<the healing turn's number>)`, then the gates again and the
attempt recorded. The answer is the phase's state with the final
gates, the contract when the gates passed, the cumulative attempts,
coder and spend, the prior result's code, materialization and typeless
names, the resume seed stored when the gates passed, and, when they
failed, the detail `<gate>: <the first line of its output>` per failed
gate joined by `; `; the coordinator folds the new spend and decides
whether and how to repair the tests.

## Tests

No vendor or workspace command is needed for these checks. Actual generation, repairs,
gate runs and cancellation are exercised by real coordinator compiles, which
provide the job lifetime required by commands.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
