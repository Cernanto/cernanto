# cernanto/trace/reader/dynamodb

Type: module

Implements: cernanto/trace/reader
Uses: cernanto/config, npm:@aws-sdk/client-dynamodb@3.1159.0, npm:@aws-sdk/lib-dynamodb@3.1159.0, npm:@aws-sdk/client-s3@3.1159.0

Read the traces of a plane on AWS from the items its agents' processes
write into the plane's DynamoDB table, and a text above 64 KiB from the
plane's bucket beside it.

## The place and the identity

The place is the block's word `machine.substrate` in this copy's
working folder's `materialized.json`, read with the file system's own
read once and kept for the life of the process, when it is a
`dynamodb:` url, `dynamodb://<region>/<table>?bucket=<bucket>`; when
the mark names another kind of place (a laptop's `file:` url), the
configuration's setting `place` names it, read
through cernanto/config. A process with neither refuses every call with
exactly `no DynamoDB place is named`. The identity is the SDK's
default chain, and the bucket is reached with the same identity. Every
read is strongly consistent (`ConsistentRead`) and goes through every
page the store answers.

## The items

The table's partition key is `pk` and its sort key `sk`, both strings.
Under a life:

- `t#<life>#<call>`, one partition per call's id, holds its requests'
  records under `<request's id>#r#<run key>#<place>`: the run key the
  run's grant and count, each written as twelve digits with leading
  zeros, joined by `.`, and the place twelve digits the same way; a
  range read of `<request's id>#r#` answers the records in the order of
  their runs and places. A record item carries `story` (the request's
  id), `attempt`, `seq`, `kind`, `run`, `place`, `at` and `text`, or
  `ref` in place of `text`, the key of the bucket's object holding it.
  The same partition holds a request's children under
  `<parent's id>#p#<child's id>`, carrying `parent`, `child`, `agent`,
  `attempt`, `seq` and `turn`, and a mark that a request is kept there,
  `<request's id>#s`, carrying `story`, `began` and `agent`.
- `f#<life>` holds the life's facts under
  `<began>#<request's id>#<fact>#<attempt>#<run>`, each carrying
  `story`, `call`, `fact`, `agent`, `began` and `text`; a range read
  backwards answers the latest accepted first.
- `n#<life>` holds the totals, one item per copy under its name,
  carrying `callsIn`, `callsOut`, `tokensIn`, `tokensOut`, `costUsd`,
  `unpriced`, `since` and `lastAt`.

Every item but a total carries the TTL attribute `expires`, the moment
of its expiry in epoch seconds plus an hour: an item whose `expires`
less 3600 is at or before the moment of a read,
in seconds, is left out of it. An object a `ref` names that is gone
reads as the record's absence. A request's records and children are
read in the partition of the call's id the request rides: the request's
id up to its first `~`, when that part is four parts joined by `:`,
loses its last part, and the rest from the `~` on stays
(`ops_bank:20001:c-7:5f2a9c1e0b3d4a6f~2` rides `ops_bank:20001:c-7~2`).

## Tests

Uses: cernanto/config, npm:@aws-sdk/client-dynamodb@3.1159.0, npm:@aws-sdk/lib-dynamodb@3.1159.0, npm:@aws-sdk/client-s3@3.1159.0

The tests learn the place as the module does and run live against that
table: they write a life of their own under a random life id with the
SDK (its records, facts, children and totals, one record's text of 100
KiB riding the bucket under `traces/<the life>/...`), read every
function back, and remove what they wrote at the end.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
