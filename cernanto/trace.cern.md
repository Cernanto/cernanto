# cernanto/trace

Uses: cernanto/trace/reader, cernanto/trace/view, cernanto/documents, cernanto/config

Answer what the plane's agents did: an agent's recent calls, the
records of one call with the calls it made, and each agent's running
totals of calls in, calls out, AI tokens and AI cost. The agents'
processes store their traces as they work; read them with
cernanto/trace/reader, whether the agent still runs or not.

## Where an agent's traces are

An agent's traces are kept under its life, one span of its deployment
from its first run to its delete. The plane's document
`lives/<service>`, read with cernanto/documents, names the life that
stands for an agent: its text is JSON `{life, born}`, and the service
is the agent's id with every character that is not a letter or a
digit written as `_`. The agents with traces are the documents under
`lives/`; an agent with no such document has none.

The reader and the documents are cernanto/trace/reader and
cernanto/documents, each bound with no name, so the plane binds its
implementor. A read that fails is a retryable failure in its words.

## Calls and their requests

A call can be asked more than once, under the same key or anew, and
each ask is a request whose records are kept apart. A request's id is
the call's id with the request's own part after one more `:`
(`ops_bank:20001:c-7:5f2a9c1e0b3d4a6f`); a call a linked module ran
inside another call has the id of that call's request with a mark
after it: `~`, the attempt and a `:` when it has one, then the link's
number. The part of an id before its first `:` is the service whose
life keeps the request's traces; a module's calls are listed under the
module's own life as well. A linked call keeps no fact of its own that
it is over: it is over once the latest of its runs ended, or once the
request it ran inside is over, and every reading below of whether a
request is over reads a linked call so, the request's fact read where
the life read keeps that request.

`calls`, `records` and `trace` take a request's id or a call's id. A
call's id with one request reads that request; a call's id with several is refused
with `call <id> rides several requests: <their ids, newest first,
joined ", ">; ask for one of them`. A call's id with an empty
generation part (`<service>::<call>`) matches every generation.

A request's summary is read from what its runs stored: the agent, the
function, when the request was accepted, the request that made it and
that request's agent, and the copy that runs it (`{generation, copy}`,
where a follower reaches its stream). A fact's text is one flat JSON
object: what the fact says (a begin's, an end's or the request's
end's fields, as the reader states them) stands at its top level
beside the request's id, the attempt, the run, the fact, the agent and
the accepted moment. A request's status is its own outcome once it is
over; before that, `ok` when any of its runs ended ok, and otherwise
the latest run's: `error` when it ended in error, `running` while it
runs. Runs order by their grant, then their count. Its duration is
that of the run its status is read from, 0 while it runs.

Records older than the configuration's `retention-minutes`, read
with cernanto/config at each read (1440 when missing or not a number,
10080 at most), are left out of every answer, and so is a request that
is over and was accepted longer ago than that. A request that is not
over stands in every answer, with its records inside that time, for as
long as the store keeps its facts, however long ago it was accepted.

## What each function answers

`calls` lists requests' summaries newest first, 50 when no limit is
given: the requests of a call's id; the requests an agent ran, a
module's read under its own life; or every agent's, each request once.
A process's boot call (the function `boot`) is left out of the lists.

`records` answers one request's records or an agent's latest ones. A
request's records are read past a cursor (each run mapped to the place
read through in it, a run it does not name read whole), chosen and
ordered with cernanto/trace/view, whose answers are records of its own
making: each is matched to the row it was read from by its `run` and
its `place`. They are answered a page at a time: from
`after`, a count of the records past the cursor already answered,
while their JSON texts weigh at most 8388608 bytes together, the first
always included; the answer names `next` when records remain, and the
cursor moved past what the page read. A reader goes on either by
`next` beside the same cursor or by the moved cursor alone, never by
both. An agent's latest records are those at or after a
moment, the newest 500 or the limit given, cut to the newest that
weigh at most 8388608 bytes, oldest first: its requests are read
newest accepted first, every request that is not over among them, and
of the requests that are over the reading stops once it holds the
limit and the next was accepted before the oldest record it keeps. A
read that names both a
request and an agent, or neither, is refused in words.

`trace` answers one request: its summary, a page of its records as
`records` reads them, and the requests it made, each as a summary,
ordered by the record that made each and, under one record, by their
turn. A request nothing was stored for answers null.

`over` answers whether one request is over: true while the fact that
it is over stands in the store, however long ago the request was
accepted, and false otherwise (a request that runs or waits between
two attempts, or one nothing was stored for); a linked call's is true
once the latest of its runs ended or the request it ran inside is
over. It takes a request's id or a call's id, read as `trace` reads
it.

`totals` answers, for each agent asked, in the order asked, its calls
in, calls out, input and output tokens, cost, the model requests that
named no price, and the moment its totals count from, summed over what
its life stores; zeros for an agent with no life.

## Tests

Uses: cernanto/config

The tests read a call of their own back from the live plane. A call of
cernanto/config leaves no record to read, the whole configuration
being secret, so the call they read back is one they make to this
agent: they ask cernanto/config for a setting, then ask this agent for
the totals of cernanto/config and see its calls in at one or more,
wait two seconds for the traces to be stored, and find that `totals`
call among the newest calls of every agent (a finished call whose
handler is `totals`, served by the agent under test, whose id starts
with `cernanto/trace`). They read its records with `trace` and with
`records`, each answering the records the call stored, the handler's
two among them, the record of kind `begin` and the one of kind
`handler` that ends it (a second read past the returned cursor brings
nothing), and see `over` answer true for that call. They prove
the refusal of a records read that names both a request and an agent
or neither, null for a request nothing was stored for and `over` false
for it, and zeros for an agent with no life.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
