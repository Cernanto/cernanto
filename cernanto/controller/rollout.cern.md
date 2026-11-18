# cernanto/controller/rollout

Type: module

Decide the life of the fleet's generations. Given the fleet, what the
backend runs and its settings, say which rows need a new generation
and why, and what each new generation is born with. Given a row and
its generation, say what its launch carries. Given a pending
generation's status, say whether it is active. Given a draining
generation, say whether it may go. Say when the next of these rules
becomes due. Everything is handed in as arguments and every answer is
data; the reconcile module reads the world, asks here, and acts
through the backend.

A runnable row is every row whose `type` is other than `interface`
or `module`, a service when it has no type; these rules are the
runnable rows'. THE HOST JOB'S ROW, `cernanto/host`, is adopted like
any runnable row, and its adopted generation stands as it is for the
life of the plane, whatever its artifact, its config, its composition
or its image say by now, its status left as the plan finds it. The
fleet, as this module reads it: `deleting?`,
`bindings?` (with an `accounts` map), `agents` rows `{agentId,
artifact, type?, uses, usesContracts? (ids to sha256 hex pins),
implements? ([{id, contractSha}]), contract?, contractCompatibleWith?,
run? (absent reads as zero), form?, testOf?, target?, composition? (the
modules pinned at the row's ship), life?, lives? (the modules' lives
pinned with the composition)}` and `generations` rows `{agentId, gen,
port, artifact, status ('pending'|'active'|'draining'), config?,
worker?, run?, finished?, composition?, life?, lives?, image?,
slots?, createdAt}`, every other field carried along. THE
LIFE: an agent runs under a life, the span of its deployment from its
admission to its delete, and a generation runs under the life it was
born with and belongs to the row of that life alone, whatever its
artifact: in every rule below, an agent's generations are those whose
`life` is the row's, a generation that names no life read as the
row's. A row waits for its life, given at its ship, before it needs a
generation. The backend's listing is `[{name, agentId, gen, port, life?}]`,
and its settings carry its
release (when it pins one), the release's agents and its memory
budget. A generation's status from the backend says whether it exists,
its desired and ready copies and, for a worker's run that ended, an
`exitCode`; or it carries an issue (refused or unavailable) in their
place.

## The composition

A runnable row's composition is a map of module agent ids to artifact
digests: THE PINNED ONE the row carries as `composition`; a row that
carries none is read as THE COMPUTED ONE, from the fleet's rows alone:
(1) Take each id in the
row's `uses` whose row is a module row, admitted when the row's
`usesContracts[<id>]` equals the sha256 hex of that module row's
`contract` text or is listed in its `contractCompatibleWith`. (2) For
each id in the row's `uses` whose row is an interface row and whose
pin the row carries, take every module row whose `implements` carries
that interface at that `contractSha`, leaving out a verification pair's
row, one that carries `form`: a module's test form is composed into the
tester whose `testOf` names it, through that tester's own `uses`, and
into no other agent, so a verify rolls none of the interface's
consumers. (3) Repeat the two steps over
every admitted module's own `uses` and `usesContracts` until nothing
is added, each module once, the row itself left out. (4) Each admitted
module contributes its row's `artifact`; sort the keys. Beside it, THE
MODULE LIVES: each admitted module's row's `life`, keyed the same way,
a module row with no life contributing none; a row's pinned lives are
the `lives` it carries. A row whose
own `uses` names a module row while its pin is absent or matches
neither the contract nor the compatible list has an UNSATISFIABLE
computed composition: it needs no generation (its current one keeps
serving), and its id is answered among the unsatisfiable, whatever it
carries pinned. An id with no row leaves the composition as it is.
Export the computation as its own function.

## The plan

Given the fleet, the backend's listing (absent when the backend could
not answer it), the backend's settings, the roll budget and the
moment, answer the plan: the compositions, the unsatisfiable rows, the
adoptions and the needs.

THE BINDINGS DIGEST is the sha256 hex of the JSON of the fleet's
`bindings.accounts` map with its keys sorted (an absent map hashing as
`{}`), absent when the fleet carries no `bindings`.

AN ADOPTION is a listed generation whose agent has a runnable row that
carries a life, whose listed life, when the listing names one, is the
row's, whose port is no generation row's port for that agent, and
whose agent has no non-draining generation row at all. Its generation
row is `{agentId, gen (one past the highest gen of the agent's
generation rows, of every life, 1 without one), port (the listed
port), artifact (the row's), status:
'pending', createdAt (the moment), composition (the row's, when
non-empty), life (the row's), lives (the row's, when non-empty),
config (the bindings digest, when present), image (the settings'
release, when present)}`. With the listing absent, the adoptions are
empty.

A NEED is a runnable row with a satisfiable composition and no
adoption whose agent has no non-draining generation (the reason `new`)
or whose newest non-draining generation (the highest `gen`) differs
from the row, the first difference in this order naming the reason: in
`artifact` (`artifact`); in `config` against the bindings digest,
absent and absent being equal (`config`); in `run`, absent reading as
zero (`run`); in `composition` or in `lives`, absent reading as the
empty map (`composition`); or, for an agent among the release's agents while the
settings name a release, in `image` against that release (`image`).
THE PACING: answer every `new`, `artifact`, `config` and `run` need; of
the `composition` needs at most the budget, the oldest newest-generation
first (by `createdAt`, then by agent id); of the `image` needs one,
chosen the same way. A need carries the agent id, the reason, the
composition and the newest non-draining generation when there is one.
A fleet marked `deleting` answers empty adoptions and empty needs.

## The fleet after planning

Given the fleet as it stands, the listing, the settings, the moment and
the ports allocated, one per needed agent id, answer the fleet
rewritten, the adopted generations, the planned generations each with
its need, and whether anything changed. First append the adoptions of
this fleet. Then, for each allocated port whose agent, on this fleet, is
a runnable row that was not adopted and needs a generation by the rule
above (the pacing aside), append a generation: for a service or a
worker, mark its every non-draining generation `draining` first (the
recreate); the generation is `{agentId, gen (one past the highest gen
of the agent's generation rows, of every life), port, artifact (the
row's), status: 'pending',
worker: true (for a worker), run (the row's, when above zero),
composition (when non-empty), config (the bindings digest, when
present), createdAt (the moment), image (the settings' release, when
present), slots (4 for a task or a job, 1 for a service or a worker),
life (the row's), lives (the row's, when non-empty)}`, its keys in that
order. Then mark `draining` every non-draining generation whose agent
has no row, or whose `life` is another than its row's. On a fleet marked `deleting`, the
rewrite's one change is marking every non-draining generation
`draining`. For a `composition` need, the planned generation's CHANGED
MODULE IDS are the keys whose digest differs between the previous
generation's composition (the empty map without one) and the new one,
sorted.

A TASK OR A JOB ROLLS WITH OVERLAP: the new generation is appended
beside the one it has, and both serve until the older one is retired.
A SERVICE OR A WORKER ROLLS BY RECREATE, its older generations marked
draining as above.

## The launch

Given a row, one of its generations and the settings' release, answer
the launch facts: the agent id, `gen`, `port`, `artifact`,
`composition` (the empty map when absent), `life` and `lives` when the
generation carries them, the type (`service` when
the row has none), for a worker `run` (the generation's, zero when
absent), `slots` when the generation carries it, and `form`,
`testOf` and `target` when the row carries them (the pair's canonical
agent, which both forms state on their calls). When the generation carries no
`image` and the settings name no release, answer instead that the
backend names no release.

## The gate

Given a pending generation's status and whether its row is a worker,
say whether it is GATED: the status carries no issue and reports it
exists with at least one ready copy, or, for a worker, carries an
`exitCode`. A worker whose status carries an `exitCode` is also
FINISHED.

## Ready to go

Given a draining generation, the fleet's generations and its status
(absent when it was not read), say whether it is ready to go: when
the agent has no active generation with a higher `gen`; else when the
status carries no issue and reads it absent or with zero ready copies.

## The listed generations no row names

Given the listing (absent reading as empty), the fleet after planning
and the adopted generations, answer every listed generation that was
not adopted, whose port is no generation row's for its agent, while
the agent has a non-draining generation row; each with the agent's
newest non-draining generation.

## The due moments

Given the fleet's generations after the pass, the moment and the
pending generations this process has already noted as waiting, answer
the moments: for each pending generation, the moment it has been
pending two minutes, when it is younger than that and not yet noted.
A generation whose `createdAt` does not read as a moment has no
moment.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
