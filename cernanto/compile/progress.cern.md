# Compile Progress

Type: module

Uses:
- cernanto/documents

Keep and read the progress document of one compile: the attempt's
claim on it, the narration appended under that claim, the rounds and
the resume seeds it records, its end, and the answer a reader of the
compile's progress gets. The compile front (the coordinator, which
links this module) owns the compile itself; this module owns the
document's rules, so the coordinator and every phase module that
narrates through its port write one sequence into one document. The
shapes its functions take and answer (the claim, an event, a step, a
round, the reader's answer) are declared in its own contract.

## The document

THE PROGRESS DOCUMENT is the record `compile/progress/<compileId>`
among the plane's records, this module's own, its key plain text with
the compile's id exactly as it reads, kept and read through
cernanto/documents, every write a compare-and-set against the exact
text read; a failure of the documents to answer is a retryable
failure in its words. THE BINDING: cernanto/documents is bound with no
name, so the plane binds its implementor, once at the first call and
kept for the life of the process. It holds the call and attempt ids, the status (`running`,
`done` or `failed`), a map of agent ids to completed resume seed roots
(`seeds`), the narration (`steps`), THE ROUNDS (per agent, the
verification rounds started, each its number and, once reached, its
verdict, and `shipped` once its pair was removed after the final
ship) and, once the compile ended, its `answer` (the report) or its
`error` (`{kind, message}`). A document that does not parse, or
names no call and attempt, reads as none.

THE CLAIM. An attempt (the coordinator's call id and the random token
its body minted at its start) claims the document by compare-and-set:
a document that names this call (a re-run of the same call) keeps its
seeds, steps and rounds, and any other starts empty, the status
`running` and no answer or error; every later write compares that
claim (the document's call and attempt against this attempt's), so an
older attempt changes nothing of the new attempt's progress or seeds,
and a write under a lost claim is refused with `this attempt no longer
owns the compile progress`; a conflict re-reads and retries while this
attempt owns the document. A checkpoint reads the claim and answers
nothing, or refuses with those words.

THE NARRATION appends one event to the document's `steps` under the
claim, one compare-and-set like every other write of the document (an
older attempt is refused), with the real `attemptId`, `seq` one above
the highest sequence this attempt has recorded (read off the document
itself, so the steps the coordinator records and those the phase
modules record through the port share one sequence) and ISO `at`. The
event's optional fields ride verbatim: `subject` (its agent id),
`step`, `state`, `detail`, `ok`, nonnegative `durationMs`, code/test
`attempt`, `failures`, `result`, `verification`, `waitingFor`,
`tests`, `package` and `spend`.

THE ROUNDS AND THE SEEDS: under the claim, a round is started for an
agent (its number recorded with no verdict, a record of that number
replaced), settled (its verdict recorded as it came) and marked
shipped (`shipped: true` on its record); an agent's recorded rounds
are read under the claim; a completed resume seed root is published
for an agent (`seeds[<id>]`, replacing an earlier root). Each is one
compare-and-set under the claim, refused as above when the claim is
lost.

THE END: the final status write sets `done` with the report as the
answer, or `failed` with the report when one stands and the error
`{kind, message}`; it checks ownership alone (the call and attempt),
and where the attempt could not write it (its calls refused once
cancelled, its process gone) the document stays as the attempt left
it, `running`, for whoever started the compile to read beside the
call's fate.

## The reader's answer

A reader of the compile's progress is answered `{compileId, callId,
status, steps, answer, error}`: `callId` the compile's own call id as
the document holds it (the id the compile's records are filed under,
and the one a cancellation takes); `status` `waiting`, `running`,
`done` or `failed`; `steps` every narrated step in the order of
attempt then sequence (the attempts in the order they first appear),
each with its `attemptId`, `seq`, `at` and the event's fields;
`answer` the report once the compile ended well; `error` `{kind,
message}` when it failed. The read is one document read, whatever the
compile's size.

THE DOCUMENT IS THE WHOLE ANSWER: this module keeps no memory of the
compiles the coordinator runs and judges nothing about a compile's
life. A document is answered as it stands, `running` included: a
compile that ended wrote its own end, and one that did not (its
process stopped, or its call was cancelled and the runtime ended the
attempt with its commands and refused its writes) leaves a document
that says `running` with the steps it reached, which whoever started
the compile reads beside the fate of the call itself, the plane's
fact (the controller's reconcile sweeps the verification pairs of a
compile whose call is held no more; nothing of that is this
module's). A compile id no document holds is answered `{compileId,
callId: <the id as the request gave it>, status: 'waiting', steps:
[]}`, with no answer and no error, when the reader names the call the
compile's start answered (`callId`, the id whoever started the
compile was answered once the plane had stored the compile's call:
the service and the call's key around a version, which is empty until
a process took the call, colon separated): the compile has not
brought itself to its document yet, and its caller, who holds the
call, knows when the call ends. A compile id no document holds, asked
with no call, is refused with exactly `no compile "<compileId>"` (a
contract violation), the same words and nothing after them: whoever
started the compile reads that refusal as a compile that ended before
it wrote anything. With `take` true, the document is removed as it is
answered, whatever its status says: the narration lives like an
answer, until whoever started the compile has read the final state,
and that reader alone asks for the take.

## The port

THE PROGRESS PORT the phase modules narrate through is the
coordinator's own `compileProgress` function, for the checkpoint and
the record alike, with the context `{port: 'cernanto/compile progress
port', compileId, callId, attemptId, subject}` (the compile, the
compile's call, the attempt and the target the events belong to); this
module answers the port for a given compile, call, attempt and
subject, the port's agent id being the coordinator's own (the os
module's agent id, which inside this linked module is the
coordinator's). A call of `compileProgress` whose `context` carries
that mark with those four texts is a port call, which this module
recognizes and serves before anything else: without an `event` it is
a checkpoint, which holds the attempt to its claim (a document that no
longer names the call and the attempt refuses it with `this attempt no
longer owns the compile progress`); with an `event` it appends the
event under the claim as THE NARRATION appends one, the event read as
the phase modules write theirs: prepare's `{phase, kind, text, ok?,
durationMs?, spend?, waitingFor?}` becomes `{subject, step: <phase>,
state: <kind>, detail: <text>, ok, durationMs, spend, waitingFor}`
(each optional part when present, a duration when nonnegative,
`waitingFor` the strings among its entries), and the live cycle's
`{event, round, at, ok?, durationMs?, detail?}` becomes the step
`verify` as a note for `round start`, `deploy` begin for `deploy
begin`, `deploy` end for `deploy end` and `verify` begin for `verify
begin`, its detail the event's own or `round <n>` when it has none; an
event of neither shape records nothing. The port call then answers
the compile's progress as a reader's request for the compile would.

## Tests

Over compile ids of the tests' own, among the plane's records: a claim
starts a document `running` with no steps, a second claim of the same
call keeps the steps the first recorded, a claim of another call
starts empty, and a write of the superseded attempt is refused with
`this attempt no longer owns the compile progress`; the narration's
sequence counts per attempt across the coordinator's and the port's
appends; a round started, settled and marked shipped reads back so; a
published seed reads back under its agent; the reader's answer orders
the steps by attempt then sequence, answers `running` as it stands,
`waiting` for an unknown compile asked with a call, refuses an unknown
compile asked with none with `no compile "<compileId>"`, and `take`
removes the document so the next ask is refused; the port recognizes
its mark, refuses a checkpoint under a lost claim, and maps prepare's
and the live cycle's events to steps.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
