# cernanto/controller

Uses: cernanto/controller/reconcile, cernanto/controller/install, cernanto/controller/status, cernanto/controller/streams, cernanto/controller/execution

The plane's controller. Ship rows into the fleet, land packages, start
and remove agents, answer the operator's views, and run the pass that
makes the running fleet match the fleet record. The granted modules do
the work: every function this agent exports forwards its input,
untouched, to the module function of the same name and answers what it
answers, refusals included; the pass goes to the reconcile module, the
ship, the landing and the operator's writes to the install module, and
the views to the status module.

## The functions

`convergeOnce {}` runs one pass. `ship`, `land`, `agentStart`,
`agentDelete`, `upgrade` and `drainHost` are the install module's
writes. `agents`, `history` and `ls` are the status module's views (the status module's description of one agent is read
through `agents`). `describe {}` is this agent's own and answers
`{protocol: 0, role: 'plane-operator'}`. `need`, `copyReady` and
`copyExited` are the plane's words, below.

## When a pass runs

A pass runs when a call asked for one, when a word of the plane asked
for one, and when the alarm rings, at the moment a rule of the
reconcile becomes due. Every pass is one call of `convergeOnce {}` to
the agent id `cernanto/controller`, spelled literally whatever id this
agent was compiled under (a copy deployed under another id hands its
passes to the plane's controller), made with the language's own
function for calling an agent named at run time, and awaited. The
passes of a process run one at a time and outside its calls: a
request made inside a call is answered at once and the pass follows,
outliving the call, and the requests that arrive while a pass runs
are one more pass after it, however many arrived.

A pass is asked when `ship`, `land`, `agentStart`, `agentDelete`,
`upgrade` or `drainHost` returned from its module, whatever it
answered, before the caller is answered (a forwarded call that failed
answers its failure as it is); once when this agent loads, for what
happened while no controller ran; when `need`, `copyReady` or
`copyExited` asks one; and when the alarm rings.

THE WORDS OF THE PLANE, each answered `{asked: true}` at once, the
pass its own after the call. `need {agentId}` is a caller's word that
its call for the agent found every copy busy or away; the runtime
says it, and says it again every minute while it still asks. The word
is noted through the streams module, where the pass reads it as the
agent's demand and starts or raises the agent; before that pass, the
execution module is asked to look at the agent's copies, once per
agent named since the last pass, so a copy away on a host whose host
job no longer takes a call is found and moved by the pass. `copyReady
{agentId, port, copy, host}` is a copy's own word, said by its runtime
once its record says it serves: the pass activates its generation.
`copyExited {agentId, port, copy, host, why?}` is a copy's word at its
clean end, its runtime's, and a host job's for a copy it found gone: the
pass reads what the copy's record and its host's heartbeat say now
and places, retires or starts again. A word naming no agent answers
`{asked: false}`.

ONE PASS AT A TIME ACROSS THE PLANE. The pass takes the pass lease
inside the reconcile module and answers `lost` when another copy holds
it. After a lost pass the alarm stands as the last pass that answered
left it, and one more pass is made five seconds later, so what this
copy was asked for is seen by a pass of its own once the holder's pass
ends; every further ask until then (a word's, the alarm's, a call's)
is that one pass: a busy plane says many words a second, and a copy
that is not the holder answers them with one pass in five seconds.

THE ALARM. The pass answers `nextDue`, the moment the next rule of the
reconcile becomes due. After each pass arm one alarm for that moment,
the latest answer replacing the earlier alarm; the alarm asks for one
pass. A pass a caller made through `convergeOnce` (the gateway's after
a configuration write, another copy's pass) is a pass of this process
too: the call leaves its answer's `nextDue` for the process's loop, as
a request for a pass is left, wakes the loop and answers, and the loop
arms the alarm for that moment on its own turn, outside any call. A
pass that answers no `nextDue` clears the alarm, and the next pass
waits for a call or a word.

THE LOOP IS THE PROCESS'S OWN. The passes, the alarm, the patience and
the retries are made by one loop that runs for the life of the process,
on its own turn, never inside a call: a word (`need`, `copyReady`,
`copyExited`), a pass a caller made and the alarm each leave a request
for the loop and wake it, and the loop makes the pass and arms the
alarm and the retries itself, since a timer armed inside a call is the
call's own and ends with the call.

THE PATIENCE OF A PASS. Give up a pass unanswered after two minutes
and make one more; the newer pass's answer governs the alarm, and a
late answer of the given-up pass is left aside.

A FAILED PASS. A pass whose call answers an error is one line with the
error's words, and one more pass is made ten seconds later, and again
after each failure, until a pass answers; the alarm stands as the last
pass that answered left it. A pass that cannot be made (the substrate
not reachable yet, this process not one the plane runs) is one debug
line, and the next request is served.

THE RELEASE'S LANDING. After every pass this copy held and answered
while the release is not landed, ask the install module to land the
release when this copy is the controller the fleet names: the status
module's description of `cernanto/controller` carries this process's
own artifact and composition (the language's functions for them, an
absent composition reading as none), or the fleet holds no such row
yet (the description refused for an agent the fleet does not have: a
fresh plane, whose first landing writes it). The ask is the pass
holder's, after its pass, so a release is landed by its own
controller, one copy at a time: the copies of the generation that
replaced this one ask once the fleet names them, and a description
that cannot be read leaves the ask to the next pass. A refusal or an
unavailability is one line with its words and the next pass asks
again; a landing that answers `skipped` ends the asking for the
process's life. While the release is not landed, a copy the fleet
names makes one more pass a lease after each pass it held (the lease
the execution module's settings report), so a landing that waited for
the hosts is asked again once the last of them runs the release. The
platform's packages reach a server's plane by this landing.

## Tests

Every function fronts the live plane the tests run on, so the tests
exercise what mutates nothing: `describe`, the admission refusals,
the operator's views, each read called as it is and its answer's shape
asserted against what this plane holds, and `need {}`, which names no
agent and answers `{asked: false}`. The writes are probed through
their refusals alone; `convergeOnce`, a `ship` that would be admitted
and every admitted write are proven by the plane's own tier.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
