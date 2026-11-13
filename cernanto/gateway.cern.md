# cernanto/gateway

Implements: openapi:./gateway/openapi.yaml

Uses: cernanto/trace/view, cernanto/controller, cernanto/compile, cernanto/auth, cernanto/trace, cernanto/config, cernanto/packages, cernanto/documents, npm:fs-extra, npm:@prometheus-io/client

The plane's public API: outside callers speak the document's
operations here, and the document says what each takes, answers and
refuses. Called with nothing, `describe` answers the wire protocol
major, `0`, and the role `the public gateway`.

## The listener

Serve the document from the moment the process starts, on the
own setting `port` (7434 without one) at its `host` (an IP address literal, `0.0.0.0` without one; any
other value refuses to bind, naming the setting), over http. Wait and
ask again while the configuration or the port is not yet there. A
request runs as long as its call does and a stream for hours, with
no timeout of the listener's own; a body is read whole up to 256 MiB.
Tokens, logins and settings are read from their owning agents at each
request. The `metrics` counters are the process's own and reset with
it.

## Who may knock

Admit a request as the document's security scheme says, from the
credential the generated server reads by that scheme and hands the
admission together with the request it came on: the bearer's sha256,
in hex, names a live operator token, asked of auth at each request (a
revoked token refuses with the document's words naming it); a request
made at this machine itself is the operator `local`; the
bootstrap token is compared with its file's contents trimmed, and an
absent or empty file admits no one by it. The operator's name rides on
what the request does.

A REQUEST MADE AT THIS MACHINE ITSELF is all of these at once: its
socket's peer is a loopback address; its `Host` header names a loopback
host, `127.0.0.1`, `localhost` or `[::1]`, alone or with a port; it
carries neither a `Forwarded` nor an `X-Forwarded-For` header, the
marks of a front that passed it on; and no page of another site sent
it, so an `Origin` header, when it carries one, names a loopback host
by the same rule after its scheme, and a `Sec-Fetch-Site` header, when
it carries one, is not `cross-site`. A request from a loopback peer
that is not all of these is admitted by its bearer alone, as a request
from any other address is.

## The roads

An operation whose name a used agent's function carries is that call,
answered as the callee answers. An agent the API does not use at
compile time (an operator's invoke) is called by its id and waited for
as long as the call runs. `compile` and `deploy` start the compiler's
compile, `deploy` the one that ships, under the body's compile id as
the idempotency key, and answer once the plane has stored the call. An
invoke of the configuration agent's `setAt`, and a `configSet`, that
answered is followed by one controller pass, asked by an awaited
invoke that does not wait for the answer (`wait: false`): the request
answers once the pass is on its way, and the pass outlives it.

## Behind the operations

- `invoke` refuses an id nothing is deployed as and a module in the
  document's words: a module's composing agents are those whose newest
  generation composes it, a tester among them only when no other does.
  An interface is called through its default implementor, the one the
  plane binds to it, asked of cernanto/config as the runtime asks it
  for a consumer that names none: the call is that implementor's,
  judged by the same gate and answered as it answers, and an interface
  with no default is refused in the document's words, which name its
  implementors and end there. The gate is skipped when the fleet
  cannot be read. Its `callId` is the id of the call's request, the
  `requestId` the language's `invoke` answers beside the call's id,
  under which the request's records are kept. `invokeStream` passes
  the same gate first.
- `land` asks the controller once with every target the body names,
  however many there are, so they land together as one landing.
- `ls` answers the controller's listing with the calls each agent's
  copies hold now added to its rows, asked of the copies themselves
  (THE ACTIVE CALLS below).
- `packagePut`: when the warehouse (cernanto/packages) refuses the
  commit because a slice is missing (a removal of the digest moved the
  number its next commit takes while the slices were put), the slices
  are put again and the commit is asked once more.
- `healthz` probes the plane's records by asking config for this agent's own setting `port`; an answer,
  a value or none,
  is a healthy plane.
- `cancel` asks the language's own cancel for the call named, a
  request's id first turned into its call's id with the view module,
  and answers `{ok: true}`, whether a process holding it was reached
  or the call had ended; a cancel of a compile's call (a call whose
  key begins `k-compile-`) is followed by one controller pass, asked by
  an awaited invoke that does not wait for the answer (`wait: false`),
  so the pass is on its way before the request answers and outlives
  it, and the compile's verification pair leaves with it.
- `compileProgress` asked with the call its start answered hands that
  call to the compiler with the compile's id; while the compiler
  answers `waiting`, the trace agent is asked whether that call is
  over, and once it is the compile ended before it wrote anything: the
  read is refused with the compiler's words for an unknown compile,
  `no compile "<compileId>"`.
- `authLogin` answers the ask with the request's operator as the one
  who answered it.
- `harnessView` and `harnessSet` read and write the plane's coder in
  the shape `{vendor, mode}`: a set writes, one after another and each awaited, the vendor's
  own setting `cernanto/harness/<vendor>/mode`
  through the operator's road of config (`setAt`), and the harness
  interface's default, `cernanto/harness/default`, to
  `cernanto/harness/<vendor>` last, so
  a set that fails before the default leaves the previous coder bound
  and a reader never sees a vendor bound without its mode; a view reads the default and that vendor's mode on the same road
(`getAt`), the vendor being the default's last segment, the mode `plan` when the vendor has none set
  (the vendors' own default), answering no coder when no default
  stands.
- `configGet`, `configSet` and `configList` are the operator's config verbs, as the operator: `configGet` one call of the config agent's `getAt`, `configSet` one of its `setAt`, and `configList` one of its `listAt` with the query's `place` when the request names one (the whole map of the fleet without one);
  the three operations are secrets' (the document says so), as the config agent's asks are, so no record of this agent keeps
  a path, a value or the listing. `configSet` answers whether a value now
  stands at the path.
- `oauthCallback` redeems the query's `state` through auth for the
  account that pinned it and announces the callback with the code and
  the provider's error, its description when it gives one.
- `openapiDocument` answers this document, read from its own file,
  with its servers rewritten to this listener's scheme and the host the
  request came through.

## Streams

A stream tells a request's records as they are made, from the copy
that runs the request, and what is already stored, from the trace
agent. Every stream ends the moment the client goes, which the
operation hears by the request's signal it takes.

A COPY'S STREAM: the copy's record, the plane's record
`copies/<port>/<n>` (a generation's copies numbered from 0) read
through cernanto/documents, bound with no name, so the plane binds its
implementor. A request's summary names the copy that runs it as
`copy: {generation, copy}`, the generation by its port and the copy by
its number, so its record is `copies/<generation>/<copy>`, read under
that key as it is. The record names its `address`
`{host, port}` and its `epoch`; the stream is an HTTP POST with the
fetch the language offers to `http://<host>:<port>/stream` (an IPv6
host in brackets), the headers `content-type: application/json`,
`x-cernanto-key` holding the document's key the record was read under
(`copies/<port>/<n>`, which the record itself does not carry) and
`x-cernanto-epoch` its epoch, and the body `{callId}`, a request's id, or `{}` for everything
the copy runs. While the copy serves, it answers newline-delimited
JSON: a first line `{open: true}`, then a line per record the copy made
that is not stored yet, then a line per record as the copy makes it,
and the line `{fact: 'over', callId, status, error?}` when a request is
over; a linked call (an id with `~`) keeps no such line of its own,
and its stream tells the line `{fact: 'ended', callId, status,
error?}` when the latest of the call's runs ends (an earlier run's end
is not told while a later run goes on) and the `over` line of the
request it ran inside (the id before its first `~`). The stream ends when the
copy lets it go. A copy that answers a status other than 2xx, or that
is not reached, offers no stream.

FOLLOWING A REQUEST tells each of its records once, in their order,
with a cursor that only moves forward (a place for each run, as the
trace agent reads one) and the keys of the records already told (the
view module's). Every read of the trace agent asks for the request's
records past the cursor, a page cut by weight read on by its `next`
beside the same cursor; after it, the cursor names for each run the
26th highest place among the records told of that run (counted by
place, whatever order they were told in), and a run with 25 or fewer
told stays as the cursor had it: a batch of the
store on AWS carries 25 records and can show a later record of a run
before an earlier one, so the last 25 of each run are read again and
passed over by their keys. A linked call is followed as a request
is. (1) Read, and tell what is new, until a read brings nothing new.
(2) When the trace agent says the request is over (for a follow that
knows the call's answer, `invokeStream`'s, only once that answer
came), go to (5): a copy keeps the word that a story is over for a
while and not for good. Otherwise open the stream of the
copy its summary names and hold what it sends, ask the trace agent
once more from the cursor, order the two together with the view module
and tell each whose key was not told, so a request that ran again is
told every end in the order of its runs and every other record in its
first run's version, then tell each held and arriving record whose key
was not told, until the copy's line that says the request is over (its
`over` line; for a linked call, the `over` line of the request it ran
inside or its own `ended` line), or until the copy lets the stream go. (3) When more than 4 MiB of records are held
untold, let the stream go and go back to (1). (4) When no copy answers,
or the copy its summary names is not reached, the request is over if
the trace agent says it is over (for a follow that knows the call's
answer, `invokeStream`'s, only once that answer came), and otherwise
go back to (1) after a pause that doubles from a quarter second to
five seconds. A summary's status is never the word that a request is
over: a request between two attempts reads `ok` or `error` before it
is over, its copy reached or not, and its later attempts are followed
as its first. (5) When the request is over, ask the trace agent from
the cursor one last time once the copy let its stream go or is gone,
tell what is new, and end.

`invokeStream` makes the call with the language's `invoke`: once a copy
took the call, the event `{accepted: {callId}}` with the request's id,
then the request followed from the copy that took it, each record an
event `{record}` (with `lines` under a view). The call's answer ends
the follow, whatever its records say and never a summary's status (a
secret's call keeps no records and is never over in them; a call
between two attempts reads `error` and is not over): once `invoke` answered, the follow goes on
until the request is over (its copy's `over` line, or, while no copy
answers, the trace agent saying it is over), for ten seconds
at most, and for two seconds at most when it has told no record of the
request by the answer (a secret's call keeps none); then it lets the
copy's stream go, reads the trace agent once more and tells what is
new, and the stream ends with the answer, `{result}` with what the
function answered, or `{error: {kind, message}}` with the failure's
kind and words, the document's ErrorEnvelope as it is. Nothing of the
follow outlasts that bound: a pause, a wait or a read of the trace
agent still pending at that moment, the last read among them, is let
go where it stands and its answer, when one comes, is not told, so a
trace agent that is slow or away never withholds the call's answer. A call refused before a
copy took it answers in `invoke`'s statuses before the stream opens.

The call stream (`callStream`) follows the request the path names, a
call's id turned into its request as the trace agent turns it, the
call's summary first; under `tree` each child is entered after the
record that made it and followed in its turn, a request met again
entered once; under a view the view module renders the records, and
the conversation's closing lines ride after them.

The agent stream (`callsStream`) merges the streams of the agent's
copies that serve when it opens, the copies of its active generations,
each copy's stream for everything it runs, as their lines arrive, each
copy's in its own order. With `since`, it first tells the agent's
records stored at or after that moment (the trace agent's records of
the agent since it, oldest first), each record told once by its key
(the view module's); once each of its copies' streams has answered its
first line or ended, as a request's follow waits for its copy's, it
holds what they send, reads the stored records once more for what
landed in the meantime and tells those first, then each held and arriving record
whose key was not told, so a record a copy made before its stream
opened is told before the ones after it; and while no copy of the agent serves it reads
the stored records again for what is new after a pause that doubles
from a quarter second to five seconds, until the client goes. With
`backlog` and no `since`, it first tells the newest `backlog` of the
agent's stored records (the trace agent's latest records of the agent,
that many, none for zero), oldest first, each told once by its key,
and goes on as a stream with `since` the moment it opened. Under a
view, each record is rendered by the
view module as one record of the agent's live stream, a reply quoting
the request it answers for the life of the stream.

## The active calls

THE ACTIVE CALLS are the calls every running copy of the plane holds
now, which each copy answers for itself. `ls` asks the copies first
and the controller after, so the calls the listing itself makes
further down the plane are in no count.

The copies are the plane's records under `copies/`, listed once
through cernanto/documents (the binding A COPY'S STREAM reads one
by). A record's key is `copies/<port>/<n>`, and its JSON names the
agent the copy runs as `launch.agentId`, its `state`, its `address`
`{host, port}` and its `epoch`. A copy is asked when its `state` is
`live` and it names an address. A COPY'S WORKLOAD is an HTTP POST
with the fetch the language offers to `http://<host>:<port>/workload`
(an IPv6 host in brackets), with the headers a copy's stream is asked
with (`content-type: application/json`, `x-cernanto-key` the record's
key and `x-cernanto-epoch` its epoch) and the body `{}`; the copy
answers JSON `{calls: {incomingActive, outgoingActive}, modules}`:
`calls` the two counts of the copy's own agent, and `modules` a
mapping from the id of each module linked into the copy that holds a
call now to that module's two counts there (a module the mapping does
not name holds none in that copy). Every copy is asked at the same
time, and one that has not answered a 2xx status carrying `calls`
with its two numbers within 300 milliseconds is let go and counts as
not answered.

Every row of the controller's listing gains four numbers,
`copiesAsked`, `copiesAnswered`, `incomingActive` and
`outgoingActive`, by its `type`:

- A row that is neither a `module` nor an `interface`: `copiesAsked`
  counts the copies asked whose record names its agent as
  `launch.agentId`, `copiesAnswered` those of them that answered, and
  the two sums add their answers' `calls` (zero with none). The
  request that asks is itself a call this agent holds: one is taken
  off the `incomingActive` of this agent's own row
  (`cernanto/gateway`) when the listing carries it, never below zero.
- A `module`: `copiesAsked` counts the copies asked whose record's
  `launch.composition`, a mapping keyed by the ids of the modules
  linked into the copy, names the module, `copiesAnswered` those of
  them that answered, and the two sums add, over every copy that
  answered, what its answer's `modules` holds under the module's id.
- An `interface`: each of the four is the sum of that number over the
  rows of its implementors in the listing, computed after theirs; with
  none of them in the listing the row stays as the controller gave
  it. An interface's implementors are the agents of the fleet whose
  row names the interface's id under `implements`, a module or an
  agent that runs alike, read from the controller's view of the
  fleet's agents, which is asked together with its listing (a
  listing's own rows name what they implement for modules alone).

For each row that is neither a `module` nor an `interface` with a
copy that did not answer, in the rows' order, the listing's `notices`
gain `<agentId>: <k> of <n> copies did not answer for their active
calls`. When the records cannot be listed, every row stays as the
controller gave it and `notices` gain `the copies could not be
listed: <why>`.

## Tests

The API binds real ports and forwards to the live plane, so the tests
exercise `describe`; the plane's own tier proves the surface.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
