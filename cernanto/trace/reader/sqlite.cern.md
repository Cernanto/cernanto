# cernanto/trace/reader/sqlite

Type: module

Implements: cernanto/trace/reader

Read a laptop plane's traces from the SQLite files its agents'
processes write, one file per agent's life, with Node's own
`node:sqlite`, each file opened read-only by the call that reads it.

## The files

The files are in the folder `traces` under the plane's folder: the
block's word `machine.plane` in this copy's working folder's
`materialized.json`, read with the file system's own read once and
kept for the life of the process, else its `machine.root`; a mark
naming neither refuses the call with exactly `the block's mark names
no root`. A life's file is `<service>.<life>.sqlite`, the service
spelled with every character outside `A-Za-z0-9_-` written as `%` and
the two lowercase hex digits of each of its UTF-8 bytes. A life whose
file is not there reads as empty. A read waits up to five seconds for
an agent's process writing the file.

## The tables

The tables are the runtime's, expiries in epoch milliseconds, the
column `story` holding a request's id:

- `records(story, attempt, seq, kind, run, call, place, at, expires,
  text)`, the primary key `(story, attempt, seq, kind, run)`;
- `facts(story, attempt, run, fact, call, agent, began, expires,
  text)`, the primary key `(story, attempt, run, fact)`, an index on
  `(agent, began)` and one on `call`;
- `children(parent, child, agent, attempt, seq, turn, expires)`, the
  primary key `(parent, child)`, both a request's id;
- `totals(writer, calls_in, calls_out, tokens_in, tokens_out,
  cost_usd, unpriced, since, last_at, save_grant, save_count)`, with no
  expiry.

A row whose `expires` is at or before the moment of a read is left out
of it. A run reads `<grant>.<count>`, and runs order by the grant,
then by the count, each as a number.

## Tests

The tests write a life's file of their own into the plane's `traces`
folder, under the service `test_` and a random suffix and a random life
id, with the runtime's four tables and the rows they choose (two runs
of one request, a record past its expiry, two calls' facts, a child,
two copies' totals), read every function back, and remove the file at
the end.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
