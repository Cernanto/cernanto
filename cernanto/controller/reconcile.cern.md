# cernanto/controller/reconcile

Type: module

Uses: cernanto/config, cernanto/controller/rollout, cernanto/controller/autoscaler, cernanto/controller/admission, cernanto/controller/images, cernanto/controller/state, cernanto/controller/streams, cernanto/controller/execution

Make the running fleet match the fleet record. `convergeOnce {}` runs
one pass: read the fleet and what the backend runs; start the
generations the rows need and retire the ones they no longer need;
activate a generation once its process is ready; scale tasks and jobs
by what waits for them; place every copy on a host; write the fleet's
status; and answer `{converged, nextDue?, parked, lost?}`: whether
nothing is left to do, when the next rule becomes due, which services
are held at zero copies, and whether the pass was lost to another
holder of the pass lease. The rollout, autoscaler, admission and
placement modules decide; this module reads and acts, through the
state and streams modules and the execution module, THE BACKEND
below, the one module that acts on the plane for the controller.

ONE PASS AT A TIME ACROSS THE PLANE. A pass begins by taking the pass
lease through the backend, the holder named by this pass's own call
id; a lease held by another answers `{converged: false, lost: true,
parked: []}` at once, before any read or write; the pass releases the
lease at its revision when it ends, however it ends. Every write of
the fleet is a mutation through the state module whose decision is
applied afresh to the text the write lands on, and a pass writes the
fleet when something changed. The notes below go to the events record
through the state module, after the closing mutation, in the order
they were made.

## The pass

AT THE START, read `rollout-budget`, `park-services` and
`rebalance-spread` through the configuration agent and the
fleet (the state module's record `fleet`) through the state module, at
the same time. The budget is `rollout-budget` when it is a number, 8
otherwise; services park when `park-services` is true. Read the
backend's settings and its listing of generations at the same time,
once per pass; the settings' opaque configuration snapshot rides back
on every ensure, status, scale and removal of the pass. A fleet never
written is read as empty, and the pass runs over it and answers.

THE PAIRS FIRST. Each distinct `owner` of a row carrying `form` is a
handle: split it at its first two colons into a service, a generation
and a key, and ask the streams module once per owner whether that
journal is held. An owner not held is a compile that is over: in one
mutation, remove every row carrying that owner and mark its
non-draining generations draining, noting `pair-removed` with the
owner as the subject and `the compile <owner> is over; its
verification pair left`. A read that fails, and an owner that does
not split, keep the pair.

THE PLANNING. Ask the rollout module for the plan over the fleet, the
listing (absent when the backend refused it or could not answer), the
settings, the budget and the moment. When the plan adopts or needs
anything, or a non-draining generation belongs to no row, or the fleet
is deleting: allocate one fresh port per need from the ports record,
in one mutation that raises its cursor by the count (a cursor absent
or not a number starts at 20000; the ports are the numbers before the
new cursor), then mutate the fleet with the rollout module's fleet
after planning, applied to the text as it stands with those ports.
Note `generation-adopted` for each adopted generation (the agent id
and `adopted the listed generation of <agentId> on port <port>`) and
`generation-planned` for each generation planned for a `composition`
need (`generation <gen> of <agentId> planned on port <port> for a
changed composition: <the changed module ids joined ", ">`).

THE ENSURES, side by side. Hand every non-draining generation of a
runnable row on a fleet that is not deleting to the backend, with the
launch facts the rollout module composes, except a pending service's
or worker's generation while another generation of the same agent
exists (the recreate waits for the pass that finds it alone). When the
rollout module answers that the backend names no release, leave the
generation as it is and put `the backend names no release for the
generations it would start` in the condition. An ensure answering a
name is the generation's realization; a refused or unavailable one
leaves the generation pending and puts its words in the condition. An
ensure of a pending generation that answered a name is a change.

Read a generation's status from the backend once per pass, by the name
its ensure answered or the backend's name for its agent and port, and
reuse it in every step below; the read after a removal is fresh.

THE ACTIVATION. For every pending generation of a runnable row that
was ensured this pass, the rollout module says from its status whether
it is gated and whether a worker is finished. A gated generation is
active for the rest of the pass, its older non-draining generations of
the same agent draining; every draining generation is told to drain
through the backend at each pass until the backend answers it (a
refusal or an unavailability is noted and the telling is made
again at the next pass); note `generation-active` (`generation <gen>
of <agentId> on port <port> is active`). A pending generation older
than two minutes at the pass's start is noted `gate-waiting` at most
once per generation for the life of the process: `generation <gen> of
<agentId> on port <port> has been pending for more than two minutes`,
followed by `: <reason>` and ` (<message>)` from the first of its
instances, read from the backend, that carries a reason, the message
when it gives one.

THE LISTED GENERATIONS NO ROW NAMES, which the rollout module picks
out: once the generation it names is active and its status reports a
ready copy, ask the backend to remove the listed one by its listed
name. A removal that answers removed is a change.

THE PROGRAM RECORDS. Every active generation of a runnable row without
`started` gets the flag: a service's, noting `program-started` (`the
program of <agentId> started in generation <gen> on port <port>`); a
worker's with its run handle from the streams module (the agent id,
the port and the row's run, zero when absent) as `runHandle`,
noting `worker-started` (`the worker <agentId> started run <run> in
generation <gen> on port <port> as <handle>`).

THE SCALING. First, mark finished for life every active worker
generation marked finished or whose status carries an `exitCode`, and
scale it to zero when its status reads it exists with copies above
zero. Then read the status of every newest active generation of an
elastic row, once per pass (a status refused or unavailable reads as
not listening), noting `listener-kept` (`the generation <gen> of
<agentId> listens on a fixed port and keeps one copy`) the first time
one reads `listening`. Then, for every agent that keeps one copy by
the autoscaler's word (given its row, the release's agents, the
every-host agents and whether that status reads `listening`), scale
its newest active generation to one when it is not finished and its
status reads it exists at zero copies; an agent that runs on every
host by the autoscaler's word keeps the count the placement gives it,
one per host. Then, for the newest active generation of each
elastic row by the autoscaler's word that keeps no one copy and runs
on no every host, read the demand of its agent through the streams
module by the agent's id, as the controller notes its needs, once per
agent; a demand that cannot be read ends the step for that agent. Ask
the autoscaler for the rule. When a
rule applies, or the row is a job, read the generation's desired count
from its status, ask for the count wanted, and scale when it differs;
a count of zero after the step parks the generation. A status refused,
unavailable or reading no realization leaves the generation as it is.
A refused or unavailable scale puts its words in the condition and
leaves the count as read.

THE SWEEP, once per pass: read the image records through the streams
module and the images the slot records name through the backend, hand
both with the moment to the images module and remove what it answers
through the streams module; a read that fails puts its words in the
condition as an unavailability and the sweep runs again at a later
pass, and a removal that fails leaves the rest for the next pass.

THE MOVE. When the nodes the pass read carry pressures and the highest
less the lowest exceeds the spread, read the instances of the elastic
generations that are not jobs (the node each copy runs on) and ask
the autoscaler for the move over them, their demand and quiet time as
read above; a move parks the generation off its node through the
backend and notes `generation-moved` (`<agentId> parked off <host>:
the pressure spread <highest> to <lowest> passed <spread>`). Without
pressures, or within the spread, the step ends there.

THE RETIREMENT. For every draining generation, the rollout module says
whether it is ready to go, given its status, read when the generation is
replaced; a generation whose status counts a copy standing in an image
(`imaged` above zero: a slot record naming an image whose copy did not
leave cleanly) waits for that copy whatever the rollout says. Remove the
objects of a generation ready to go through the backend; when its status
read afresh after the removal reports it absent, hand on the calls its
copies held (any agent's but the controller's own, `cernanto/controller`),
purge what it
left through the streams module and remove its row, noting `generation-retired` (`generation <gen> of <agentId> on
port <port> retired`); and when the fleet, read afresh through the state
module for this alone, holds no other generation of the agent, release
the agent's port claims through the execution module, noting
`ports-released` (`<n> port(s) of <agentId> released`) when it released
any. A purge that fails keeps the row for a later pass. A removal that
answers removed is a change.

THE HAND-ON, for a task's or a job's generation of any agent but the
controller itself (`cernanto/controller`), when the fleet holds a newer
generation of its agent under the same life: ask
the agent, by its id, the runtime's function `#handOn` with
`{generation}`, the retired generation's port in decimal, awaited forty
seconds at most. The agent's newest generation takes over the calls the
retired generation's copies held when they died and answers
`{handedOn}`, how many it took, noted as `calls-handed-on` (`<n> call(s)
of <agentId> handed on from generation <gen>`) when above zero. An ask
that fails or is not answered in time keeps the row for a later pass.
The controller's own retired generation hands on nothing: a pass it
was running is left where it is, and the newest generation's next pass
does the work.

THE LIVES TO END, after the retirement, remove what deleted agents
kept, their traces and their journals: for each entry of the fleet's
`ending` list, once the last generation row carrying its life has left
the fleet, ask the backend to end it (the execution module's `endLife`
with the entry's agent id and life): an answer `done` drops the entry
from the list in the closing mutation, noting `life-ended` (`the life
<life> of <agentId> ended: its traces and its journal are removed`);
an answer that more remains leaves the entry, and the pass is due
again five seconds after it; a refusal or an unavailability leaves
the entry for a later pass and puts its words in the condition,
prefixed `end the life of <agentId>`. An ended life is a change.

THE PLACEMENT, once per pass, after the retirement, on a fleet never
written as on any other: ask the backend to place; the orders
ensured, scaled and retired above get their slot records in the same
pass; a refusal or an unavailability
puts its words in the condition, prefixed `place`, and so do the words
the answer's `refused` carries (a host job's dump, restore or
forwarding refused), prefixed `host job`. A placement that left a slot
unplaced is due again in one lease, and so is one whose answer carries
`refused`.

THE CLOSING MUTATION, when the fleet existed and the pass activated,
started, finished, retired or ended anything, or the status block
changed. Decide it on the text the write lands on: turn each gated
generation active and its older non-draining generations draining, set
the started flags and handles, set the finished marks, remove the
retired generations, drop the ended lives from `ending`, and rewrite
the status when it differs: `agentCount` the
rows, `activeAgents` the rows with an active generation, and four
conditions: the three the admission module answers for the rows, then
`FleetNodesLive`: `False` with the reason `BackendUnavailable` and the
unavailable words joined `; ` when any backend read was unavailable;
else `False` with `BackendRefused` and the refused words joined `; `
(the missing release among them) when any was refused; else `True`
with `Hosts` and `<n> hosts run the processes`, `<n>` the hosts the
backend lists as ready (`0` when they cannot be read). Every word a backend answer put in
a condition is prefixed by what was asked and a colon: `listing`,
`status of <name>`, `ensure <agentId> on port <port>`, `remove
<name>`, `scale <name>`.

## The answer

`converged` is true when the pass changed nothing (no pair removed, no
adoption, planning or orphan drained, no ensure of a pending
generation, listed removal, scale or retirement landed,
and no closing write), no backend read was unavailable and every
generation of the fleet is active. `nextDue` is the earliest of the moments the rollout
module (the pending generations' two minutes) and
the autoscaler (for each elastic generation whose demand was read)
answer, the moment the placement answered as its `nextDue` (a record
on a gone host awaiting its move), one lease after the pass when the
placement left a slot unplaced or its answer carried `refused`, five
seconds after the pass when a
retirement landed (a pending service's or worker's generation of the
retired generation's agent is ensured by the pass that finds it
alone) or a removal answered while its generation's status read after
it still reads it standing (its copies are leaving their hosts, and
the retirement lands at a later pass) or a life's end answered that
more remains, and thirty seconds after the
pass when
a backend read was unavailable; a moment already passed is thirty
seconds after the pass, a lease; absent when there is none. `parked`
lists, sorted, the service names
of the generations the scaling parked. `lost` is true for a pass that
found the lease another's, and such an answer carries no `nextDue`
and an empty `parked`: the holder's pass answers for the plane.

## Tests

`convergeOnce` operates the live plane the tests run on; the tests
prove the module exports the pass, and the plane's own tier proves the
pass.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
