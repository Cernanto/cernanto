# cernanto/controller/status

Type: module

Uses: cernanto/config, cernanto/trace, cernanto/controller/state, cernanto/controller/streams, cernanto/controller/execution

Answer the operator's views of the plane, reading it alone: `agents`,
`describe` and `history` show the fleet's rows and generations, `ls`
every agent's workload (its status word, copies, resources, journal,
call totals and AI usage), `nodes` the machines and `status` the plane's
health. Every answer's shape is the wire the clients render byte for
byte, and every fault and remedy is one of the sentences at the end,
verbatim, its `<placeholders>` filled in.

## The sources

Read the fleet (the state module's record `fleet`) through the state
module; the generations' instances, the hosts and the metrics through
the backend, the execution module; the views and the holdings through
the streams module; and the running totals, the calls and the AI
usage, through cernanto/trace, the plane's reader of traces. Read each
source once per answer. A source that is
unavailable leaves every figure resting on it absent, with a notice in
that source's words.

## The views

`agents {}` answers `{agents, generations, conditions}`: each fleet
row exactly as shipped; each generation as `{agentId, gen, port,
package (its artifact), status, composition?, createdAt}`; and the
fleet's conditions. A fleet never
written answers empty lists and no conditions.

`describe {agentId}` answers `{agent, contract?}`: the row as `agents`
gives it, and its `contract` text when it records one. Refuse an
unknown agent: `no agent "<agentId>"`.

`history {agent?}` answers `{entries}`: every generation (the named
agent's alone when `agent` is given), newest first by `createdAt` then
by `gen` descending, each `{at (its createdAt), agentId, gen, package,
version?, status}`, `version` the row's `package.version` when the row
carries the package mark and the generation's artifact is the row's.

`ls {agent?}` is the workload view, `{agents, metrics, sampledAt,
usageSince, notices, callsComplete}`: one row per fleet row in the
fleet's order, every type included. Refuse a focus on an agent with no
row: `no agent "<agent>"`. Each row is `{agentId, type (service when
absent), status, copies, ready ('<ready>/<total>'), restarts,
cpuMillicores?, memoryMi?, journalEntries?,
snapshotMi?, journalMi?, incomingTotal?,
outgoingTotal?, totalsSince?, inputTokens?, outputTokens?, costUsd?,
links?, implements?, contractSha?, functions?}`.

A RUNNABLE ROW (neither a module nor an interface) has its
generations' instances read through the backend: the inventory and
the metrics once, then the instances of every generation, by the name
the inventory lists or the backend's name for the agent and port.
`copies` is the instances, `ready` those ready over all, `restarts`
summed. Sum cpu and memory over the instances when every instance of
every generation was read and every one carries a measurement; each
is absent otherwise. THE STATUS WORD is the
first that holds: `Unknown` when the inventory is unavailable or any
generation's instances could not be read; `Parked` when the desired
copies summed over its generations in the inventory are zero; `Ready`
when the ready copies reach the desired; `Degraded` when some are
ready; `Failed` when none is and an unready instance carries a
reason; `Starting` otherwise. A WORKER reads its active
generation (its last one when none is active): `Waiting` with no
generation; `Finished` when the generation is marked finished;
`Waiting` when it carries no `runHandle`; else by the end of its run,
asked of the streams module by the handle's three parts (its service,
its generation and its call id): `Running` while it has not ended,
`Finished` when it ended well, `Failed` when it ended in failure,
`Unknown` when the handle does not split into three or the end cannot
be read. `journalEntries` is the storage view's figure for the row's
service (zero when it holds no
journal). `snapshotMi` is the holdings' image bytes of the agent over
1048576, present when the plane holds an image of it, and `journalMi`
the holdings' journal bytes of the service over 1048576, zero when it
holds none, both exact quotients, both absent when the holdings could
not be read.

A MODULE ROW reads `In <n> agent<s>` (`s` unless `n` is one), the
count of the agents composing it (the rows any of whose generations'
`composition` names it, and the rows whose `links` name it), or `Not
used`. Its `links` are its module ids, its `implements` its `{id,
contractSha}` stamps, and its totals and usage the trace agent's
figures for its own id; its instances, resources and
journal stay absent. A call into a module is counted once on each
side, as a call between two agents is: a call in on the module's row,
and a call out on the row of the agent whose code made it, its host or
another module of its host. A call the module's own code makes is a
call out on the module's row. Every row carries its own totals alone.
AN INTERFACE ROW reads `<n> implementor<s>` or `No
implementor`, with `, <m> stale` appended when `<m>` of them stamp a
`contractSha` other than its own (`contractSha`, the sha256 hex of its
`contract`). Its `copies`, `ready` and `restarts` are summed over its
implementors' rows, each other figure summed when every implementor
carries it and `totalsSince` the earliest; with no implementor every
optional figure is absent.

THE TOTALS are asked of the trace agent once, in one call for every
row but the interfaces, parked agents included: the running totals of
each agent from its first call, kept as long as the agent. They supply each
row's `incomingTotal` (its calls in), `outgoingTotal` (its calls out),
`totalsSince` (the moment its totals count from, ISO, absent when it
has none), `inputTokens` and `outputTokens` (both absent while both
are zero) and `costUsd` (absent while it is zero). The
answer's `sampledAt` is the moment of the answer and `usageSince` the
earliest `totalsSince` of the rows, the moment itself when none has
one. `callsComplete` is true when the trace agent answered.
`metrics` is true when the metrics were read. THE NOTICES, in order:
the inventory's words or `the inventory is unavailable`; the metrics'
words or `the metrics are unavailable`; `<agentId>:<port>: <words>`
per generation whose instances could not be read; `the storage view
is unavailable`; `the plane's holdings are unavailable`; `the trace
agent's totals are unavailable: <why>`.

FOCUSED on an agent, the answer carries the focused row first, and
that row carries `functions` whatever its type, one `{name}` per
handler of its row. For a module the rows of the agents composing it
follow; for an interface the implementors' rows follow; any other
agent's row stands alone.

## Tests

Every read fronts the live plane the tests run on, so the tests call
each read as it is and assert its shape against what this plane
holds: `ls` lists the controller as a ready row and this module among
the modules composed into one agent; `agents`, `describe` of the
controller and `history` answer rows and generations with the fields
named here; `nodes` and `status` answer their shapes; an agent nothing
knows answers the words named here.

When the calls are complete, the controller's row and this module's
row each carry their own calls in and calls out, whole numbers, each
read as the trace agent gave it for that row.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
