# cernanto/controller/state

Type: module

Uses: cernanto/documents, cernanto/packages

Keep the plane's state, four records of this module's own among the
plane's records, under the family `controller`: the fleet, the ports,
the plane's record and the events. Read a record by key. Write one
compare-and-set, against the exact text that was read. Mutate one
under a decision applied afresh each round until the write lands.
Append a note to the events. When a write of the fleet stops naming a
package, ask the warehouse (cernanto/packages) to remove that package.

Every record is JSON text, read and written whole through
cernanto/documents under the documents' compare-and-set discipline:
one attempt against the exact text a write rests on, null meaning the
record does not exist. THE BINDING: cernanto/documents is bound with no
name, so the plane binds its implementor, once at the first call and
kept for the life of the process. A key as the controller's modules name it
(`fleet`, `ports`, `plane`, `events`) is the record `controller/<the
key>`. Export three verbs every module of the controller goes through:
reading a record by key (null when never written or removed); swapping
it against the exact text read (null to say it must not exist yet,
null as the value to remove it), answered with whether the write
landed and the record's current text either way; and mutating it
under the caller's decision, applied afresh to the text as it stands
on every round, for about twenty rounds, then a retryable failure
naming the key. A failure of the documents to answer is a retryable
failure in its words.

## The records

Export the shape of each record as a type, spelled exactly; a field
not named here rides untouched.

The fleet, the record `fleet`: `{version: 1, deleting? (a boolean),
bindings?, env?, agents: [], generations: [], ending?, removing?,
status?}`.
`ending` is THE LIVES TO END, `[{agentId, life}]`: the lives of the
agents deleted whose traces and journals the plane has yet to remove.
`removing` is THE REMOVALS, `[{digest, claimed? (a boolean), at? (a
number, the moment of the claim in milliseconds), by? (text, the token
of the step that holds the claim), commit? (a number or null, the
number of the package's commit the claim removes, as the warehouse
answers it)}]`: the packages the fleet no longer names, on their way
out of the warehouse (A package's end).
`agents` rows are
the certified rows exactly as shipped: `{agentId (text), artifact
(text), type? ('service'|'task'|'job'|'worker'|'interface'|'module';
absent means a service), handlers (a list of text), uses (a list of
text), links? (a list of agent ids), verified? ({at}), package? (any
value), contract? (text), specSha? (text), usesContracts? (a map of
agent ids to sha256 hex), implements? (a list of `{id, contractSha}`),
contractCompatibleWith? (a list of sha256 hex), staging? (a boolean),
built?, run? (a whole number, one more for every start the
operator asks; absent reads as zero), form? ('test'|'tester'), testOf?
(text), owner? (text), testerArtifact? (text), composition? (a map of
module agent ids to artifact digests, the modules the row's
generations link, pinned at the row's ship), life? (text, THE LIFE:
the one span of the agent's deployment, from its admission to its
delete, kept through every ship that replaces the row), lives? (a map
of module agent ids to their lives, pinned with the composition)}`.
`generations` rows are `{agentId (text), gen (a number), port (a
number), artifact (text), status ('pending'|'active'|'draining'),
config? (text, a sha256 hex), worker? (a boolean), started? (a
boolean), runHandle? (text, a started worker's run handle), run? (a
number), finished? (a boolean, a worker whose run is over),
composition? (a map of module agent ids to artifact digests), life?
(text, the life it runs under), lives? (a map of module agent ids to
their lives), image? (text), slots? (a number),
createdAt (text, ISO)}`: a port-addressed immutable snapshot of one
agent, keeping what it was born with whatever the rows say by now. `status` is `{conditions: [{type, status
('True'|'False'), reason, message}], agentCount (a number),
activeAgents (a number)}`. `env` and `bindings` ride untouched through
every write here, `bindings` as `{accounts: {<name>: any value}}` when
present.

The ports, the record `ports`: `{version: 1, cursor}`, starting at
20000; the cursor only rises, and a port once taken from it stays
taken.

The plane's record, `plane`: `{version: 1, deploys: [], release?:
{version, url, sha256?, at}, storageOwners?: {<agent id>: {node, at}},
sources?: [{name, at}]}`. A
write keeps the fields it does not own exactly as read and stamps its
own `at`-family fields with the moment; `storageOwners` belongs to the
machine.

The events, the record `events`: `{version: 1, events: [{at, kind,
subject, message, operator?}]}`, a ring of the last thousand. Export
the append as one function taking the kind, the subject, the message
and the operator's name when there is one: up to twenty rounds, each
reading the record and swapping it back with the note appended
against the exact text read, until one lands; the note is dropped
after twenty lost rounds or when a read or a swap fails, and the
function answers nothing either way.

## A package's end

A package lives while the fleet names it: every digest its `agents`
rows carry as `artifact` or `testerArtifact`, and every digest its
`generations` rows carry as `artifact` or as a value of `composition`.
THE REMOVALS are this module's alone, whatever a write's caller hands
it: every write of the fleet, through the swap or through the
mutation, carries in place of the caller's `removing` the list of the
text it rests on, with every digest that text named and the written
text does not added as `{digest}`, and every entry not marked claimed
whose digest the written text names taken off. A write whose text
names a digest the list marks claimed is not made. The swap then fails
retryable with `<digest> is being removed from the plane; land it again
in a moment`, once THE STEP below was taken for each such digest whose
claim is a minute old or more. The mutation waits the claim out in its
own rounds instead, since a call attempted again is answered from the
reads its earlier attempt recorded and so would meet the same claim
again at every attempt: it takes THE STEP for each such claim a minute
old or more and otherwise waits a second, then reads the record again
and decides again as on a lost round, such rounds counting toward no
lost round's limit; a claim it still meets ninety seconds after the
first fails it retryable with the same words.

THE STEP takes one entry of the list out, from the fleet's text as it
stands:

- An entry not yet claimed: ask the warehouse for the number of the
  package's commit that stands, then mark the entry by a mutation that
  marks it only while the fleet lists it unclaimed and names its digest
  nowhere, `claimed: true` with `at` the moment, `by` a random token of
  this step's own and `commit` that number, null when the warehouse
  answered none; the entry is left where that mutation finds it named,
  gone or claimed meanwhile.
- An entry claimed a minute ago or more was left by a step cut short:
  this step TAKES IT OVER by a mutation that stamps `at` and `by` anew
  with its own, only while the entry still carries the `by` and the
  `at` this step read, its `commit` kept as it stands. An entry claimed
  less than a minute ago is its claimant's, and the step leaves it.

The step whose mark or takeover landed asks the warehouse to remove
the digest's commit numbered the entry's `commit` (the warehouse's
removal of one commit; null when the entry names none), and once the
warehouse answers, removed, absent or named, a
mutation takes the entry off the list only while it still carries this
step's `by`. So a package leaves the warehouse only under a claim no
write naming it passes, one step at a time holds a claim, and a
removal that arrives late reaches only the commit its claim named,
never a later commit of the same digest.

THE STEPS are taken for the entries of a fleet text one at a time, in
sorted order of their digests: on the text a write of the fleet wrote,
once it landed, and on the text a mutation of the fleet found when its
decision left that text as it stood and nothing was written, a step's
own writes and mutations aside; and for the digests a refused write
names, as above. A
step that fails (an ask of the warehouse, a mark, a takeover, a
removal or a taking off) leaves the entry to a later step, and the
answer of the write or the mutation stays as it is either way. A null
text names no digest, and a text that does not parse as a fleet takes
no step.

## Tests

The tests run on the live plane and read what mutates nothing: any
record by key as it is. The compare-and-set is exercised on a key
named `test:` followed by a random suffix and nothing else: created
from null, swapped once against exactly what was read, mutated once,
and removed with a swap to null before the test ends.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
