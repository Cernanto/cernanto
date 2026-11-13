# Compile

Type: job

Uses:
- cernanto/compile/progress
- cernanto/compile/membership
- cernanto/compile/target
- cernanto/compile/plan
- cernanto/compile/sessions
- cernanto/compile/verify
- cernanto/compile/artifact
- cernanto/compile/contract
- cernanto/compile/gates
- cernanto/compile/lanes
- cernanto/harness
- cernanto/config
- cernanto/machine
- npm:fs-extra

Turn an uploaded workspace of specs into verified, durable agents: the
plane's compiler. A compile is one call of `compile`: the workspace
files land on disk, the plan is settled, and each agent in plan order
goes through its code session and gates, its test session and gates,
its live verification on the plane, its artifact stored and its fleet
row answered, every step narrated into the compile's document. The
work on one target is the target module's, over the four phase
modules and the repairs module it links; the workspace's membership
(the rows, the tree's packages, the ladder of granted ids) is the membership module's; the compile's document is the
progress module's; this agent owns the request, the settings, the
vendor, the plan, the loop with its cascade, the words of the compile
and the ship after it. `compileProgress` answers a compile's narration and its outcome, and
the language's own cancellation of the call ends a running compile and its
commands. Every request is checked against its contract before
anything is read, written or reached: a request that does not fit is
refused with `the <compile|compile-progress> request does not
fit its contract: <path>: <message>`, one entry per field that does
not fit joined by `; `, and a field the contract does not name is left
alone.

The request carries the workspace and the switches the client
resolved; every setting, tool and contract is read by the call that
needs it, and every path handed to a module is absolute.

## The settings

THE OPERATOR'S SETTINGS come from cernanto/config, read by every call
that needs them, each set with `cernanto config cernanto/compile
<name>=<value>`: `data-folder` (the folder every
compile works under, made absolute against the working folder; when
unset, the folder `compiles` under the plane's root, THE MARK'S
`machine.root`), `doctrine` (a doctrine folder overriding the sessions
module's own), `session-turn-timeout-ms` (a positive number, otherwise
the sessions module's default), `model` and `effort` (the plane's
coding model and effort over the vendor's defaults, each taken when it
is a non-empty text and left aside otherwise; unset means the
defaults). These are the compile's whole configuration: a workspace
carries no configuration file, the request carries no configuration,
and an agent's retention, recording and effect limits are the
runtime's own rules by kind and namespace.

THE MARK is the block's file in this copy's working folder,
`materialized.json`, read with the file system's own read once at the
first call that needs it and kept for the life of the process. It names
the plane's root, the `root` entry of its `machine` object
(`machine.root`; the working folder when the mark cannot be read or
names none), and THE RELEASE'S VERSION, the cernanto version the
release runs as, the `version` of that object's `release` entry
(`machine.release.version`; `0.0.0` when the mark cannot be read or
names none).

THE MACHINE is the machine interface bound with no name, the implementor
the plane binds, by the call that needs it; the plane's machine
implementor's id, which that machine answers of itself, is handed to
the target module (an implementor of another machine is verified where
it runs).

THE TOOLS an artifact's provenance records, read at the start of every
compile: `node` is this process's own version (`process.version`
without its `v`; no command runs for it), `npm` what npm prints for
`--version` (trimmed), run by the command the machine answers for that
argument, given twenty seconds;
`typescript` is the version the gates module answers for its own
checker; `openapiTypeEngine` the version the lanes module answers for
its own type engine; a command that cannot run or prints nothing, and a
machine or a module that cannot answer, each read `unknown`. The workspace tools
a compile runs (npm, tsc) inherit this process's own environment.

THE FAMILY DIGEST, the identity of the compiler's own bytes: the hex
sha256 over this process's own artifact digest and the digests of its
composition (the os module's own facts: the process's package digest
and the linked modules' digests), sorted and joined by newlines: what
this process runs, whoever compiled it.

THE DEPLOYED ROWS, THE DEPLOYED TEXTS and THE TREE PACKAGES are the
membership module's, read for every compile with the request, the settings and
the work folders handed to it; what it holds for the compile (THE
MEMBERSHIP) rides through the whole compile and into the target
module with every agent.

## compileProgress

`compileProgress` answers a compile's narration and its outcome as
the progress module reads it: `{compileId, callId, status, steps,
answer, error}`, the document as it stands, `waiting` for a compile id
no document holds when the request names the call its start answered
(`callId`), the refusal `no compile "<compileId>"` for one asked with
no call, and the document removed as it is answered under `take`,
whatever its status says: THE DOCUMENT IS THE WHOLE ANSWER, and this
agent keeps no memory of the compiles it runs. A PORT CALL IS
RECOGNIZED BEFORE THE REQUEST IS HELD TO A READER'S SHAPE: a call
whose `context` the progress module recognizes as THE PROGRESS PORT
(the mark `cernanto/compile progress port` with the compile, the
call, the attempt and the subject) carries the compile in its context
and no `compileId` of its own (`compileId` is a reader's field,
required of a reader's request alone); it is served first, as the
progress module serves a port call (a checkpoint, or an event appended
under the claim), and then answers the compile's progress as a
reader's request would.

## The compile

The whole compile is one job run: a retryable failure runs the body
again from the beginning, and the rows, the caches and the completed
resume seeds recover the completed work; a process that dies
mid-compile ends the compile as the runtime answers its call, failed.
THE REQUEST carries the workspace (`files`, `targets`, `packages`,
`seeds`) and the switches `verify` (the live tester runs after the
compile; it means something under `deploy`, since a verified package
needs a live run and a compile alone verifies nothing), `deploy` (the
compiled rows ship inside the plane after the compile, and the answer
waits for their convergence), `newContract` (a target's previous
contract is neither handed to its session as an anchor nor judged: the
session writes the contract from the specification; the previous
contract is still read for the change class, so the cascade recompiles
the dependents whose pinned contract breaks in the same run),
`contracts` (a given previous contract per agent id, as a declaration
file's text), `recompile`, `planOnly`, `maxLiveCycles`, `cascade`,
`coder` and `runtimeHarness`. THE ANSWER is the report `{protocol: 0,
status, issues, agents, rows}` and, under `deploy`, `shipped`.

1. THE ATTEMPT. The call id identifies the compile; the attempt is a
   random token this body mints at its start, its identity in the
   document and in every folder it names. THE DOCUMENT COMES FIRST:
   the attempt claims the progress document through the progress
   module before it reads the settings, the tools, the fleet's rows or
   anything else that can fail, so a compile that cannot begin (a
   missing setting, a machine that does not answer) ends its document
   `failed` in that failure's own words, and whoever follows the
   compile reads them there. The progress module keeps the document
   (`doc:compile/progress/<compileId>`: the call and attempt ids, the
   status, the seeds, the steps, the rounds, the answer or the error)
   and its claim: a document that names this call (a re-run of the
   same call) keeps its seeds, steps and rounds, and any other starts
   empty; every later write goes under this attempt's claim, and a
   write under a lost claim is refused with `this attempt no longer
   owns the compile progress`. The claim is read at every checkpoint
   and before every narrated step. The final status write checks
   ownership alone, and where the attempt could not write it (its
   calls refused once cancelled, its process gone) the document stays
   as the attempt left it, `running`, for whoever started the compile
   to read beside the call's fate. A terminal failure ends the call; a
   retryable failure is rethrown with its classification.
2. THE NARRATION: every event of the compile (this agent's own and the
   phase modules' through the port) is appended by the progress module
   under the claim, one sequence for the whole compile, each with the
   real `attemptId`, its `seq` and its ISO `at`, the event's optional
   fields riding verbatim (`subject`, `step`, `state`, `detail`, `ok`,
   nonnegative `durationMs`, code/test `attempt`, `failures`, `result`,
   `verification`, `waitingFor`, `tests`, `package` and `spend`).
3. THE WORK FOLDER is `<dataFolder>/work/<the call id sanitized>/<the
   attempt token sanitized>` (sanitized: every character outside
   letters, digits, `.`, `_` and `-` replaced by `-`); each attempt
   removes its own scratch, and its own alone, in its finally block.
   The uploaded files land under `<work>/agents` (a path that starts
   with `/`, contains a `..` segment or a backslash is refused with
   `not a workspace-relative path: <path>`, a contract violation; the
   contents base64 decoded); module inputs under `<work>/inputs`; the
   compile root, where each target's folder lives, is
   `<work>/compiles`. Resume seeds are immutable once published: write
   them below `<dataFolder>/seeds/<the call id sanitized>/<the attempt
   token sanitized>/<a random id>` and publish the completed root by
   compare-and-set through the progress module; a re-run reads the
   roots from the progress document.
4. THE HARNESS: the compile's vendor is resolved once, in this order:
   the request's `coder` (a vendor name, `claude-code` or `codex`, the
   implementor `cernanto/harness/<coder>`), else the harness interface's default as the configuration agent
   answers it, `cernanto/harness/default` (what `cernanto dev` writes on
   a box after its login discovery and the operator on a server), read
   fresh for every compile, when it names
   `cernanto/harness/claude-code`, `cernanto/harness/codex` or
   `cernanto/harness/fake` (the rehearsal vendor a test plane compiles
   on, its scripts where its configuration says); the id so resolved is
   the one bound, by name, through the harness interface for every
   session the compile opens and resumes, so a binding changed
   mid-compile moves no session. With none of them, THE COMPILE HAS NO
   VENDOR AND GOES ON: a plane with no coder connected still answers
   what opens no session (a current target, a refreshed one). A compile
   with no vendor opens no session and asks no judgment: a target that
   would need a session fails with zero attempts, like any failed
   target, as `<id>: no coding vendor: on a box, cernanto dev signs in
   with this machine's Claude or ChatGPT login; on a server, cernanto
   config cernanto/harness default=<the vendor's agent id> and
   its key with cernanto config`, and the missing vendor is a failure of that target alone, and the
   compile as a whole goes on. The model and effort belong to a
   compile with a vendor. The compile's model and effort per agent:
   the vendor's coding defaults (`claude-code`: model
   `claude-sonnet-5-5`, effort `medium`; `codex`: model `gpt-6.1-sol`,
   effort `medium`; the `fake` vendor: none, the plane's settings alone
   applying to it and no name foreign to it) overridden by the plane's
   configuration (`model` and `effort`, read fresh for
   every compile). A configured model name that belongs to another
   vendor stays with its vendor: a name starting with `gpt-` names a
   codex model and any other name (`opus`, `sonnet`, `haiku`, a
   `claude-` name) a claude-code model; a configured model foreign to
   the compile's vendor is left aside, noted (`prepare`, the agent its
   subject, by the target module) as `cernanto/compile/model <name> is not a
   <vendor> model; compiling with <the vendor's default model>`, and
   the vendor's default model applies. THE COMPILE'S MODEL AND EFFORT
   ARE ITS ONE SETTING: every session this compile opens, the coder's,
   the tester's, the fix sessions, and every judgment it asks (the
   change plan, the contract fit, triage, an api's onboarding) runs on them, handed by this agent to the
   membership and target modules as THE JUDGE SETTINGS (the harness,
   the sessions road `{dataDir: <dataFolder>/sessions,
   turnTimeoutMs?}`, the model and the effort) and by them to the
   phases and the judge module with each ask; no judgment picks a
   model of its own. With no vendor the phases are handed the `fake`
   harness with the sessions road and no model or effort, and nothing
   is chosen or narrated.
5. THE DEPLOYED ROWS: the membership module's, read with the request,
   the settings, the work folders and the judge settings handed to it,
   a failed read reading as no rows; the deployed agents are their ids
   with their `uses`. The prelude timings (the harness read, the rows
   read, in milliseconds) ride into the plan line's account. THE TREE
   PACKAGES the request names are the membership module's too, held
   by id as digests and read for the ids in the compile's scope once
   the scope is known (below); an id whose package failed (a rename)
   is a failure the membership module remembers and the loop reports
   when the agent's turn comes.
6. THE PREVIOUS CONTRACT of an agent, its saved tester and its previous
   pins are the membership module's ladders, read on demand by the
   target module for every agent.
7. THE LOOP (the next section) runs with THE COMPILE the target module
   is handed with every agent: the request, the settings, the judge
   settings, the vendor (or none), the tools, the family digest, the
   doctrine, the pins, the work folders (the agents root, the inputs,
   the compile root, the private per-attempt seed root), the progress
   claim (the compile id, the call and the attempt) with THE PROGRESS
   PORT, the record the phase modules call BY NAME: `agentId` this
   agent's id, `checkpoint` and `record` both the NAME of this agent's
   `compileProgress` function (the text `compileProgress`), and
   `context` the mark `cernanto/compile progress port` with the
   compile, the call, the attempt and the target as its subject, made
   for each target; and the two functions of this agent's own the
   target module takes in process (the checkpoint, the claim's, and
   the record), THE MEMBERSHIP, the plan's order, the
   targets, the cascade (`request.cascade`, true when absent), the
   recompile flag, handed to the change module's code-source ladder
   for the agents the request names as targets alone (each of them
   written from its specification, its previous compile and resume
   seed set aside) and off for an agent in the scope as a dependency
   alone, which takes the ladder as any compile's dependency does,
   taken as it is when its package is current, so a recompile of one agent
   leaves its dependencies as they are; the plan-only flag, the
   runtime harness (`request.runtimeHarness`, else the compile's
   vendor, else `claude-code`), the versions, the live verify
   (`verify` under `deploy`, `maxLiveCycles` as the cycle cap), the
   compile's checkpoint, THE CUSTODY CONTRACT (the `cernanto/auth`
   contract, read before each target through the membership module's
   precedence: this compile's compiled contract of it, else the
   package held for it in the workspace, else the deployed row's text;
   none when there is no such agent) and THE
   DOCTRINE FOLDER (`doctrine` when set, else the sessions
   module's own), so the target's sessions read the doctrine the
   provenance records.
8. THE RESPONSE: for every agent report of the loop with status `compiled` or
   `current`, including
   completed agents preceding a later target's failure, the row the
   target module composed for it (THE ROW OF A REPORT: the artifact
   module's row for THE PACKAGE THE PLANE RUNS FOR IT, with its stamp
   and its tester digest; a refreshed agent's the one its own package
   answered) and its `package`, the package handed back for the client
   to write beside the spec (the stamped package of a report verified
   live, the respun package of a refreshed agent, the package written
   from the sources otherwise, each stored at the agent's end as the
   target module writes it). The report's `liveCycles` is the number
   of live repair cycles this compile ran for the agent: the rounds
   the progress module recorded for it under this compile's claim,
   less one, since the first round is no repair; set when above zero
   and absent otherwise. A package that could not be handed back
   leaves `package` absent and the agent's row out, the agent's status
   as it was. The done record: progress `done` end with `compile
   complete` (ok) when the status is ok and no agent is waiting; `plan
   only: nothing compiled` (ok) for a plan-only request that did not
   fail; `compile incomplete: verification is waiting for you` (not
   ok) when an agent's verification is waiting; `compile failed: the
   specs did not pass the gates` for a spec-gate failure; `compile
   failed` otherwise (not ok). THE HELD SHIP goes after it: a final
   ship of this compile's own agent (the id this process serves) would
   roll the process the compile runs in, so the target module holds it
   (`holdFinalShip` to the live cycle; the refreshed and the
   current-from-the-tree roads hold theirs the same way), the row
   composed and not shipped, THE ROUND'S PAIR LEFT STANDING (its rows
   name the package until the held row does, and the warehouse lets a
   package go the moment nothing names it), and once the done record
   is written the held row's package is fetched from the warehouse into
   `<work>/inputs/held/<the digest sanitized>.cern` (a warehouse that holds
   none fails the ship with `the package <digest> is not in the plane
   store`) and stored again through the artifact module (the warehouse's
   put is idempotent), the held row is shipped through the verify
   module's ship, the pair removed right after it and its round marked
   shipped in the document, a failure a `ship` note on the target (not
   ok), `the final ship failed: <message>`, the done record standing
   as written. Return the issues, agent reports and rows through the
   compile contract; a plan-only request answers no rows. The report
   (`{status, issues, agents}`) is written as `report.json`, two-space
   JSON and a newline, under the compile root before the done record.
9. A failure that escapes the loop (a transient the substrate should
   retry, or a terminal one) is recorded first, as a `retry` note (not
   ok): `the compile failed: <reason>` when terminal (any error that is
   not retryable or target-unavailable), else `the attempt failed; the
   plane will retry: <reason>`; then it is rethrown as it is. A
   terminal failure ends the document `failed` with the failure's kind
   (`terminal` when it has none) and words as the document's error,
   ownership checked first; a retryable failure leaves the document
   `running` for the retry; a recording or ending the claim refuses is
   left at that. The attempt removes its own work folder in finally,
   and an aborted or superseded attempt changes nothing of the
   application progress. A compile that ends with a report ends its
   document `done` with the report as its answer when the status is
   `ok`, and `failed` with the report as its answer and the error
   `{kind: <the status>, message: <'compile failed: the specs did not
   pass the gates' for a spec-gate failure, else 'compile failed'>}`
   otherwise.

## The loop: the workspace and the plan

THE CHECKPOINT: between steps (before a session, a deploy, a run, and
where this specification says so) the loop checks its application
progress claim; a cancelled compile's attempt is ended by the runtime,
and one that learns of its cancellation fails with the words `the
compile was cancelled by the operator`, and an agent failing with
exactly those words is reported with them and nothing more.

1. THE WORKSPACE is the membership module's, and THE MEMBERSHIP it
   keeps is handed to the target module as the membership module
   answered it, nothing added: THE FOREIGN SPECS joined
   first, every candidate parsed and the workspace resolved through
   the plan module into `<compile root>/inputs/plan/workspace.json`,
   the workspace the loop reads, the parse failures kept for the
   gates, and each note it has to say (`<id>: using the package in the
   tree`, the tree packages' notes) recorded as the membership module
   answers it.
2. THE DOCTRINE is the sessions module's doctrine over
   `doctrine` when set, else its own folder; THE PINS are the
   plan module's empty pins with the doctrine version: a compile
   starts with no pin of the world and takes each agent's from its
   previous compile (the target module folds them in before prepare).
3. THE MEMBERSHIP LADDER is the membership module's, run after the
   workspace: THE REGISTRY NEEDS landed through the controller and
   noted as it answers them, each granted id the workspace does not
   hold resolved from its deployed row (an interface's family Tests
   remembered) or the
   running contract, each resolution noted (`plan`) in the module's
   words, and the ids it resolved answered as the remote agents for
   the gates.
4. THE DEPLOYED TEXTS and THE DEPLOYED IMPLEMENTORS (every interface id
   any deployed row's `implements` stamps name, each to those rows'
   ids sorted; nothing when no rows were read) are the membership
   module's, read off the ladder's rows once.
5. THE SPEC GATES: the plan module's spec gates over the workspace,
   with the runtime harness, the ids the ladder resolved as the remote
   agents, each deployed row's id to its uses as the remote uses (when
   rows were read), and the ids of the held foreign packages as the
   installed agents; THE SCOPE is the plan module's compile scope over
   the workspace, the targets, the cascade and the deployed agents;
   the issues kept are those with no agent id or an agent id in the
   scope. A target the workspace does not hold adds the issue `CE106`
   (an error, agentId the target): `no spec for "<target>" under the
   agents root (looked for <target>.cern.md, or agent.cern.md inside
   <target>/)` with the hint `did you mean "<closest>"?` when the plan
   module's closest id finds one. Any error among the issues ends the
   compile: the report `{status: 'spec-gate-failure', issues, agents:
   []}` is written and answered, the done record `compile failed: the
   specs did not pass the gates` (not ok). Then THE TREE PACKAGES of
   the scope are read by the membership module (the targets first, the
   modules linked into them transitively).
6. THE PLAN: the plan module's compile plan for the targets, handed
   THE DEPLOYED IMPLEMENTORS; a cycle answers the report `{status:
   'spec-gate-failure', issues: [{code: 'CE140', severity: 'error',
   agentId: <the cycle's first id, or ''>, message: 'the Uses graph
   has a cycle: <the ids joined by " -> ">'}], agents: []}`, written
   and answered with the same done record. The seconds before the plan
   are accounted: the prelude timings plus the milliseconds the
   workspace took; when they add up to 1500 or more, the note (`plan`)
   `prepared in <total, one decimal>s: <name> <seconds, one decimal>s,
   ...` over the phases of 100 ms or more (`harness`, `rows`,
   `workspace`; its own note, apart from the plan line's text); then
   the plan line, progress `plan` end: `<n> agent` (`agents` above
   one) `: <the plan's order joined by ", ">` (ok).
7. SERVED ROWS (skipped when no rows were read; a recompile skips
   nothing here, its flag reaching the named targets alone): the
   membership module's served rows over the plan's order, the targets
   excluded, before the loop starts, so an unchanged agent whose
   dependencies' contracts held is current with zero spend.
8. THE CASCADE of a contract change of an id: for each dependent (the
   plan module's dependents over the shape) not already queued or
   compiled that is a target or a deployed agent, a sub-plan (the
   compile plan with that dependent as the target, handed THE
   DEPLOYED IMPLEMENTORS as THE PLAN was; a cycle answers the failure
   `the cascade to "<dependent>" hits a Uses cycle: <the rest of the
   cycle joined by " -> ">`), whose order's steps not queued or
   compiled are appended to the queue, the SERVED ROWS rule above read
   over them first, in the sub-plan's order and with the rows served
   so far, the dependent itself excluded from it, so a step it serves
   is current as any served row is, with zero spend, and only the rest
   are recompiled: an agent whose spec is unchanged and whose
   dependencies' contracts held is served for a dependent below it,
   and the dependent itself is always recompiled, the changed id being
   a target; the ids recompiled are noted (`cascade` note, the changed
   id its subject): `the contract broke; recompiling dependents:
   <ids>` for a change of any type but an interface, `the interface
   changed; recompiling its implementors and consumers: <ids>` for an
   interface; a cascade that adds nothing notes nothing. A change
   RIPPLES when it is breaking (any type) or compatible for an
   INTERFACE.

## The loop: the agents

The queue starts in plan order. Each agent of the queue, in turn,
after a checkpoint, is run by the target module with THE COMPILE, its
id, its position (from one) and the queue's length: the target module
begins and ends the agent's progress, reports an id a tree package
failed, skips an id without a parsed spec, caches a served row, and
takes every other agent through its phases to its report, its row and
its package; this agent keeps the report among the compile's, the row
among the compile's rows, the issues it added among the compile's
issues, and a held ship's row for the end of the compile. A failed
report ends the loop (the queue left where it stood); a compiled
report whose contract change ripples, when the cascade is on, runs
THE CASCADE, a cascade's failure failing that agent with its words
(progress `agent` end, not ok, result `failed`). The contract maps
follow the compile through the membership module, so a target still
to compile resolves against the contracts this compile wrote.

## The end of the compile

The completed resume seeds of an interrupted compile stay reachable
through its progress document: a fresh attempt of the same call takes
a completed gate-passed seed before the sources it was given, unless a
recompile was asked; a different call starts with no seeds, whatever
compile id it reuses; an attempt clears its own seed directory alone.
THE SEEDS OF A RETRIED ATTEMPT are the completed ones the progress
module answers at the claim, a published seed root per agent, handed
to the target module as the resume seed roots (`resumeSeedRoots`, by
agent id) for every agent the request names no given code for and no
recompile, and never as the request's given code: a resumed seed is
read by the artifact module's reader, gated, tested and verified as a
fresh source's code would be, so a process that died after an agent's
code passed its gates writes that code no second time and ships
nothing unverified.
THE SHIP AFTER THE COMPILE: under `deploy`, once every agent ended and
the compile's status is `ok`, the report's rows that carry an artifact
ship through the verify module's ship into the fleet (this compile's
own agent's row left to THE HELD SHIP), a row without a verified stamp
whose artifact equals the fleet's deployed row of the same agent
keeping that row's stamp (the bytes the plane verified before). The
plane rolls the shipped generations on its own passes, and a call for
one waits in the stream until it serves; the ship then waits for them
through the verify module's wait for active agents, two minutes at
most, over the shipped agents that run (a service, a task, a job or a
worker), each with the artifact its row shipped, so the deploy's done
means the new version takes the next call: the older generation stops
taking calls the moment the newer one is active. The report's
`shipped` is `{agents, converged, notes}`: `converged` true when every
one was active in time, else false with a note per agent still
pending, `<id> is still rolling: <its words from the wait>`. A live
cycle that already shipped an agent's real bytes on green ships them
again all the same: the ship is an idempotent merge. Without
`deploy`, nothing ships and `shipped` is absent. The report `{status:
'ok', issues, agents}` is written (as `report.json`, two-space JSON
and a newline, under the compile root) and answered. A compile ended
by an agent's failure writes and answers `{status: 'compile-failure',
issues, agents}` with every report so far, the queue left where it
stood.

## Tests

A compile is proven by compiling for real, on the plane the tests run
on. THE CASCADE UNDER A NEW CONTRACT is proven with two specs, a
module `proof/pair-base` (one function answering a fixed word) and a
task `proof/pair-caller` that uses it (its one function answers the
base's word): a first compile of both; then a second compile of the base
alone under `newContract` with a spec that renames the function, the
first compile's rows handed as the deployed rows: the report's agents
name the caller as recompiled in the same run (`the contract broke;
recompiling dependents`), and its package pins the base's new
contract. AN IMPLEMENTED INTERFACE KEEPS ITS CONTRACT is proven with
an interface `proof/face` (one function) and a task `proof/face-keeper`
whose spec implements it: a first compile of both; then a compile of
the interface alone with a sentence of its spec reworded and its
function unchanged, the first compile's rows handed as the deployed
rows: the interface's package carries the first compile's contract
byte for byte and its provenance says the contract was `kept`; the
same compile
under `newContract` with a spec that renames the function writes the
new contract. AN INTERFACE THAT STANDS IS CURRENT, proven with the
same interface: a compile of `proof/face` alone, its spec as first
compiled, naming its first compile's package for it (the request's
`packages`), answers it `current` with the detail `current from the
tree (<the first 10 characters of that package's digest after
"sha256:">)` and that same `package`. The other proofs: `compile` with a workspace of ONE spec (`proof/hello.cern.md`, a
service by its `Type: service` line, whose one function answers a
fixed greeting), the request's
files base64, a fresh `compileId`, neither `verify` nor `deploy` and `cascade` off, on
the plane's own vendor; the test asserts the response's `status` is
`ok`, one agent report with status `compiled` and an `artifact` digest,
one row whose `agentId` is the target and whose `contract` names the
function, and no issues. A second compile of the same workspace with a
new compile id compiles the agent again (the compiler keeps no cache of
its own: a row answers `current on the plane` only once a compile
shipped it), while a plan-only request of the same workspace on a
plane that never saw it reports the agent `compiled` with `code:
'planned'` and no row. Every compiled report
names a `package` digest the warehouse answers, a `.cern` the artifact
module's reader accepts, naming the agent; a third compile naming that
package for the target on a plane that never saw the agent, with the
spec unchanged, re-gates the package's files with no session, its
tests reused as they were written, and answers the agent `compiled`
with a row carrying that package's artifact. A PACKAGE WITH NOTHING TO
WRITE FOR COMES BACK AS IT WAS, proven by that third compile: its
report's `package` is the first compile's `package`, the digest the
request named, digest for digest.
A plan-only request of a workspace of two specs,
`proof/hello.cern.md` and `proof/caller.cern.md` (a task that
answers the greeting proof/hello gives it, `proof/hello` on its
`Uses:` line and no `Type:` line), targeting `proof/caller`, is
planned: its status is `ok`, and `compileProgress` of that compile
holds `plan` notes whose subject is `proof/caller` and whose details
are `reads a task` and `reads Uses: proof/hello`, `plan` notes whose subject is
`proof/hello` and whose details are `reads a service, from the Type:
label`, and the `plan` step's end names `proof/hello` before
`proof/caller`.
`compileProgress` of the first compile answers `done`, steps
whose first is the `plan` step and whose last is the `done` step
reading `compile complete`, and the compile's own answer; asked with `take`
it answers once more, and a further ask is refused with `no compile
"<compileId>"`. A cancel uses the platform's ordinary cancellation
operation and stops the compile's commands: the test starts a compile
with the os module's `invoke`, asked not to wait (`wait: false`), reads
the compile's progress until it says `running`, cancels the compile by the
`callId` that start answered, asserts the cancellation answered that
it reached the compile (`true`), and reads its progress once more: it
still says `running` with the steps it reached, since the compiler
keeps no memory and writes no end it did not reach, and the call's own
end is the plane's word to whoever started it; asked with `take`, the
document is answered once more and a further ask is refused with `no
compile "<compileId>"`. While that compile still runs, before its
cancellation, `compileProgress` of a fresh compile id no document
holds, asked with the running compile's `callId`, answers `waiting`
with no steps; asked with no call, it is refused with `no compile
"<compileId>"`.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
