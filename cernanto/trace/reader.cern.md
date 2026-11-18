# cernanto/trace/reader

Type: interface

Read the traces the plane's agents stored, the contract each store's
reader implements for cernanto/trace. Every read names an agent's
service, its id with every character that is not a letter or a digit
written as `_`, and the life its traces are kept under; a life with
nothing stored reads as empty.

What an agent's processes store under its life, each item with the
moment it expires (the totals excepted), an item past it left out of
every read:

- a record of a request: the request's id, the call's id, the
  record's attempt (empty when it has none), sequence, kind and run
  (`<grant>.<count>`), its place in its run, its moment, and its text,
  the record as JSON;
- a fact of a request, that a run began, that a run ended, or that the
  request is over: the request's id, the call's id, the attempt, the
  run (empty for the request's end), the agent that ran it, the moment
  the request was accepted, and its text, the fact as one flat JSON
  object: the request's id as `callId`, `attempt`, `run`, `fact`, the
  agent as `agentId` and the accepted moment as `began`, and at the
  same level what the fact says (a begin its function as `handler`,
  its own moment as `at`, the request that made it as `parentCallId`
  with that request's agent as `callerAgentId` or module as
  `callerModuleId`, and the copy as `copy`, `{generation, copy}`; an
  end its `status`, `durationMs` and `error`; the request's end its
  `status` and `error`);
- a child: a request a request made, with both ids, the agent asked,
  and the attempt, sequence and turn of the record that made it;
- the totals, one row per copy that stores under the life: its calls
  in and out, its input and output tokens, its cost, its model
  requests that named no price, and when it began counting, in epoch
  milliseconds.

Four functions, each a read. readFacts answers a life's facts, the
latest accepted first: those of one call's id when it is given one,
those accepted at or after a moment when given one, and at most a
count when given one. readRecords answers one request's records in the
order of their runs and, inside a run, of their places: past a cursor
when given one (each run mapped to the place read through in it, a run
it does not name read whole), while their texts weigh at most a weight
when given one, the first always included, and whether more remain.
readChildren answers the children of one request. readTotals answers a
life's totals rows.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
