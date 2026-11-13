# cernanto/controller/streams

Type: module

Uses: cernanto/documents, cernanto/objects

Read the plane's records for the controller: note the needs the
callers say and answer what waits for an agent and how a worker's run
ended; purge what a gone generation left behind; answer the storage
view and the holdings for the operator's listing;
and list and remove the checkpoint images' records and archives the
images module's sweep names. Keep every spelling exact and answer
what the documents answered.

## The records

Reach the plane's records through cernanto/documents and the images'
archives through cernanto/objects, each bound with no name, so the
plane binds its implementor, once at the first call and kept for the
life of the process. Every failure of a
documents or objects call is a retryable failure in its words. A
record or a prefix that holds nothing answers the empty case each
function names. The journals are the runtime's own; the controller
learns of them from the hosts' heartbeats.

THE RECORDS are the plane's documents under these families, which the
runtime and the host job write and this module reads. A COPY'S RECORD
is `copies/<port>/<n>`, the slot record of one copy of a generation
(`port` the generation's port in decimal, `n` the copy's number), JSON
`{host, epoch, since, launch, release, ..., process?, stop?, cut?}` as
the execution module and the host job spell it, with the copy's own
entry riding on it (`agentId`, `generation`, `copy`, `attempt?`,
`ready`, `listens`, `exitCode?`, `at`, `state`, `lease`), `launch`
carrying the agent's id as `agentId`. A HEARTBEAT is `hosts/<host>`,
the host job's beat as the execution module spells it, its `live`
listing the copies the host runs with `journalEntries` and
`journalBytes` beside each, the records and the bytes the copy's
journal holds since its last image, as the copy's own runtime counts
them, and its `liveUntil` the moment in milliseconds until which the
beat holds: a record whose `liveUntil` has passed by this module's
clock, or that names none, is no heartbeat, and the views below read
the heartbeats that stand. THE IMAGES are the records under `images/`, one record per
archive, `images/<archive name>`, each JSON `{name, size, at, meta?}`,
beside the archives themselves among the objects under
`images/<archive name>`; a record whose name ends in `.meta` is a
pointer, listed as any record and removed as the images module's
sweep names it; the key and the names are the images module's
spellings.

`serviceName` answers THE SERVICE NAME of an agent id: every
character outside letters, digits and underscores becomes an
underscore, slashes included. `copyName` answers THE COPY NAME of an
agent's copy: `<port>/<n>`.

## What waits for an agent

`noteNeed {agentId}` remembers the moment, in this process, of a
caller's word, through the controller's `need`, that its call for the
agent found every copy busy or away. The needs are the process's own,
kept for two minutes each, and the answer is `{noted: true}`.

`demandOf {agentId}` answers `{pending, lastActive?}`: `pending` the
needs of the agent noted within the last two minutes and `lastActive`
the moment of the agent's latest need, as ISO text, absent when none
was noted. Zero and no `lastActive` when nothing stands.

`endOfRun {agentId, generation, run}`, the generation its port in
decimal, answers `{ended, failed}` from the copy record
`copies/<port>/<run>`, whose entry the worker's runtime writes:
`{ended: false, failed: false}` without a record or while it carries
no `exitCode`; `{ended: true, failed: false}` when its `exitCode` is
0; `{ended: true, failed: true}` for any other.

`runHandle {agentId, generation, run}`, the generation its port in
decimal, answers `{handle}`: `<service>:<generation>:<callId>`,
`service` the agent's service name and `callId` the text
`k-worker:<agentId>:p<generation>`, with `:r<run>` appended when the
run is above zero (run 2 of `ops/mailer` on port 20003 is
`k-worker:ops/mailer:p20003:r2`), from its arguments alone.

## What a generation leaves

`purgeGeneration {agentId, generation}`, the generation its port in
decimal, purges the images of the generation's copies: every record
under `images/` whose name begins with `<the agent id with every
character outside letters and digits as _>.<port>.` and the object of
each archive among them, the archives first and any `.meta` pointer
last; a second purge of the same generation answers zero. The answer
is `{purged}`, the records and objects purged, summed.

## The views

`storageView {}` answers `{services: [{service, journalEntries}]}`,
or null when the documents could not be reached. `services` comes
from the heartbeats' live copies: each copy's `journalEntries` summed
to its agent's service name as `journalEntries`, largest first.

`holdings {}` answers `{images: [{agentId, port, copy, bytes,
hostImage?, epoch?}], journals: [{service, bytes}]}`. Read `images`
from the slot records, every record under `copies/` that names an
image (its `image`, `{image, journals, bytes, at, attempt, epoch,
hostImage}`, the host job's commit of the copy's own dump), each as
`{agentId: the record's launch's, port and copy: the record's key's,
bytes: the image's, hostImage: the image's when it carries one, epoch:
the image's}`, largest first by bytes; with no record naming an image
the list is empty. Sum `journals` from the heartbeats' live copies,
each copy's `journalBytes` to its agent's service name, largest first
by bytes; with no heartbeat the list is empty.

## The images

`imageRecords {}` answers `{records: [{name, size, at, meta?}]}`:
every record under `images/`, by one listing, `name` the record's name
(its key past `images/`), `size` and `at` the record's own, and `meta`
the record's `meta` when it is an object, absent otherwise; in the
order of the listing. With nothing under `images/` the list is empty.

`removeImages {names}` removes each name given: the object
`images/<name>` through cernanto/objects (a name with no object
answers the same) and the record `images/<name>` through
cernanto/documents, as it was read; a name with neither is skipped.
The answer is `{removed}`, the count of the names that had a record
or an object.

## Tests

The tests run on the live plane and read what mutates nothing: the
storage view; the holdings (two lists, the images one
possibly empty); the image records (a list, possibly empty, every
entry with a name and a size); the removal of a made-up name (zero
removed); the demand of the warehouse (`cernanto/packages`: a count at or
above zero) and of an agent nobody served (`test/never-` and a random
suffix: zero and no `lastActive`), and the demand of the never-served
agent read again after one need is noted for it (one pending and a
`lastActive`, the note and the read in the tests' own process); the
purge of a generation of the never-served agent (zero purged); the
run handle of a made-up worker checked against
its spelling; the end of a made-up run (not ended); and the two
spellings.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
