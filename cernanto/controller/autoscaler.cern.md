# cernanto/controller/autoscaler

Type: module

Decide how many copies a generation runs. Given a row, say whether its
agent keeps one copy up for the life of the plane, and whether its
generations follow their demand. Given a service's demand, say which
scaling rule applies and, with the count the backend reports, the
count wanted. Say when the next rule becomes due. Everything is handed
in as arguments and every answer is data; the reconcile module reads
the demand and scales through the backend.

The demand of a service is `{pending, lastActive?}`: the calls
waiting to be taken and the moment of the last delivery.

## One copy, or one on every host

An agent among the every-host agents (the backend's settings name
them: the release's bring-up set and its gateway) RUNS ON EVERY HOST,
one copy on each live host, and this rule comes before every other
rule here: such an agent keeps the count its hosts give it, whatever
its type and its demand. An agent among the release's agents (the
backend's settings name them) that is not one of those keeps one copy
for the life of the plane, and so does every agent whose row
implements an openapi document (an `implements` entry whose id starts
with `openapi:`), and so does one whose newest active generation's
status reads `listening` (a copy of it accepted connections on a fixed
port). Given a row, the release's agents, the every-host agents and
whether the generation listens, answer whether it runs on every host,
keeps one, or neither.

## Elastic rows

Given a row's type (a service when absent) and whether services park
(`park-services`), say whether the row is elastic: a task or a job
is, and a service is when services park; every other row keeps the
count its generation has. THE JOB'S FLOOR is 2. THE CAP of a task
or a job is the execution module's copy limit, and a service's is 1.

## The rule

Given the demand, the generation's `createdAt`, the idle minutes and
the moment, say which rule applies. The quiet time counts since
`lastActive`, or since `createdAt` when the service never delivered.
`raise` when `pending` is above zero. Otherwise `park` when the quiet
time reaches the idle minutes, else `halve` when it reaches sixty
seconds, else none.

## The count wanted

Given the rule (or none), the desired count the backend reports, the
demand, the generation's `slots` (4 when absent), the cap, whether the
row is a job, and the floor, answer the count wanted.

1. `raise`: the ceiling of `pending / slots`, at least 1 and
   at most the cap, and at least the desired count.
2. `park`: 0, or the floor for a job. `halve`: a desired count of zero
   stays zero, else the ceiling of half the desired count, at least 1,
   or at least the floor for a job.
3. none: the desired count.
4. A job whose desired count is below the floor wants at least the
   floor, whatever the rule said.

## The move

Given the nodes the backend lists, the elastic generations that are
not jobs with the node each of their copies runs on and their demand
and quiet time (as above), the spread (`rebalance-spread`, 0.25
when the configuration names none) and the moment, answer at most one
move. Only the nodes that carry a pressure count, each a place for any
generation, and the spread and the least loaded node are read over
those alone. When the highest pressure less the lowest exceeds
the spread, and the most loaded node runs such a generation that is
quiet (`pending` zero and sixty seconds of quiet time), the move is the quietest of those generations and that
node; else none, and none when fewer than two nodes carry a pressure.

## The due moments

Given the demand, the generation's `createdAt`, the count after the
step (absent when it was not read), whether the row is a job, the
floor, the idle minutes and the moment, answer the moments, with the
base `lastActive` or `createdAt` as above: the base plus sixty
seconds while the count is absent or above 1 (above the floor for a
job), and the base plus the idle minutes while the count is absent or
above 0 (above the floor for a job). A base that does not read as a
moment has no moments.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
