# cernanto/controller/placement

Type: module

Decide where every copy of every generation runs. Given the
generations the controller wants, each with its count and its kind,
the hosts as their heartbeats describe them, the slot records as they
stand, the images the plane holds and the moment, answer what the
execution module is to write: the slots to create and the host of
each, the slots to move and why, the slots to drain first, the slots
to remove, and for every slot nobody can take, why not. Everything is
handed in as arguments and every answer is data, the same for the same
input; the execution module writes the records this module answers.

## The inputs

A WANTED GENERATION is `{name, agentId, port, type (service, task,
job or worker), copies (the whole count wanted, zero and up),
everyHost? (true for an agent the release names to run one copy on
every host), draining? (true for a generation the controller told to
drain, a newer one of its agent serving), listens?
(a copy of it accepted connections on a fixed port), avoid? ({host,
until}: the host its next copies avoid until the
moment, `*` for every host, the controller's hold-off), release,
createdAt, scaledAt?}`.

A HOST is a live heartbeat's facts: `{host, draining, version, releases (the versions installed on it,
its own among them), hostImage ({image, kernel, criu, arch, release}),
pressure (its live memory over its total memory, zero to one), cpus,
copies (the copies it holds now, its heartbeat's live copies
counted), starting (the copies starting on it now), failed ([{port, copy,
starts, at}], the starts that failed on it within the last ten
minutes)}`. The live hosts alone are handed in; a host the execution
module hands in as gone is GONE, and for each slot record whose host
is gone it hands in the moment a pass first found it gone,
`hostGoneAt`.

A SLOT RECORD is `{port, copy, host, epoch, since, draining?, park?,
hostGoneAt?, stopped?}`, one per copy a host job is to run (`park` true
once the record was marked parked by an earlier answer, `stopped` true
once the copy left on its word, its entry's `state` `stopped`), and AN
IMAGE is `{port, copy, hostImage, epoch?}`, the facts of a copy's image
as its slot record names it, when it names one (`epoch` the one it was
taken under, the execution module's to read; the placement reads
`hostImage` alone): a copy with an image goes only to a host where
the image can be restored.

A RECORD THAT NAMES AN IMAGE whose copy has not left cleanly (`stopped`
not true) is the copy's one road back, and is removed only with its
generation's retirement: on a gone host it MOVES as a wanted record of
its kind does (a task's at once, a service's or a listener's once
`hostGoneAt` is a lease behind), its generation draining or not,
wanted or not, and on a draining host once its copy is gone from the
heartbeat; a record its generation no longer wants (its count lowered)
whose host lives is DRAINED (the answer `drain` for a record not yet
marked `draining`, `keep` while marked) and removed once its copy left
cleanly, the move off a gone or draining host coming first; an
every-host generation's slot follows the every-host rules below
whatever its record names: its slot on a gone host is removed as any
every-host slot there is, its copy the host's own. A record naming an
image whose copy left cleanly, and a record naming none, follow the
rules below as they stand.

The lease is handed in as `leaseMs`.

## The slots wanted

THE HOST JOB'S GENERATION, the one whose agent id is `cernanto/host`,
is answered untouched whatever the hosts and the records say, a record
of it on a gone host standing until that host returns. Every other
generation follows the rules below. A generation's slots are numbered
from zero. A counted generation wants the slots `0` to `copies - 1`.
A generation marked `everyHost` wants one slot on each live host that
is not draining, each slot PINNED to its host: a slot whose host is
live keeps it; a live host with no slot of the generation gets the
lowest number no slot of the generation holds; a slot whose host is
gone is removed; and the count of its slots is the count of its live
hosts, whatever `copies` says. A slot standing past what the
generation wants is removed, the highest numbers first, and a counted
generation that wants zero copies removes them all. A generation
marked `draining` keeps the slots it has: each standing slot is
answered `keep` or `drain` by the rules below until the controller
retires it, and the answer creates or moves none of its slots, so a
host that joined, or one whose slot was removed while it drained,
stays without it. A service that parks is PARKED first (the answer
`park` for a record not yet marked `park`), on a gone host as on a
live one, and KEPT while its record is marked `park`, its image with
it, until the generation wants the slot again or retires. A record
marked `park` is a slot of the generation held at rest while the
generation wants none. When the generation wants the slot again (a
call woke it), the parked record is KEPT while its copy still appears
in its host's heartbeat (the park still under way) and WOKEN once the
copy is gone from it (the answer `wake`, with the host chosen for it
as for a move, its own when that host may take it); a wake keeps the
parked record with its image, under the host chosen. A generation
absent from the wanted ones (retired) removes every slot it has.

## A slot's host

For a wanted slot with no record, choose among the live hosts that may
take it. A host may take the slot unless: it is draining; the
generation's `avoid` names it or `*` while `until` lies ahead of the
moment; its `failed` names this port and copy with three or more
starts; the slot's record
names an image whose `hostImage` the host cannot restore (a restore
needs the same `image`, `kernel`, `criu` and `arch`, and the image's
`release` among the host's `releases`); or its `starting` has reached
its `cpus`. Among the hosts that may, rank by: a host that holds no
copy of the generation first (THE SPREAD STEP: a host holds a copy of
the generation when a slot record of the generation names it or a slot
of it was placed on the host in this answer); then the lowest
pressure; then the fewest copies held, its `copies` and its `starting`
together with the slots placed on it in this answer; then the host's
name. A generation
marked `everyHost` is placed on every host that may take it and skips
the others. THE HOST'S OWN COPIES FIRST: the generations marked
`everyHost` are decided before every other slot of the answer, their
room and their starts counted before any copy moving in from another
host or created anew. When no host may take a slot, the
slot is UNPLACED with the first reason met in the order above, in the
execution module's words: `no host` when no live host stands; `the
order avoids this host for a lease` or `the controller holds the order
off every host`; `the copy failed to start here`; `no compatible host
image` with
`the copy has an image taken on another host image`; `start limit`
with `<n> copies are starting here already`. A slot placed in this
answer counts as a copy of its generation on its host and as a copy
held and a start on its host for the slots decided after it.

## A move

A record whose host is gone MOVES once the kind's wait has passed: a
task's or a job's slot as soon as the host is gone; a service's or a
listener's slot once `hostGoneAt` lies a lease or more behind the
moment. A move is a create on another host by the rule above, keeping
the slot's number; a slot that cannot be placed is unplaced as above
and tried again at the next pass. A record whose host is live stays
where it is whatever the pressure: a service's or a listener's slot
moves when its host is gone or draining, and a task's or a job's
copies move by the autoscaler's move, outside this module.

THE ROOM OF A MOVE TO COME. The slots of services and listeners that
leave a gone host or a draining one are decided next, after the
host's own copies and before every other slot of the answer. A move
of theirs that is due is placed by the rule
above. A slot whose move is still to come (its host gone while the
wait runs, or its copy still draining) is answered as the rules say,
`keep` or `drain`, and its room is HELD: a host is chosen for it by
the rule above as if it moved now, and it counts as a copy held and a
start on that host for every slot decided after it in the answer; a
slot no host can take holds no room. The tasks and jobs that move at
once off the same host are decided after it; one that no host may
take is unplaced like any slot and tried again at the next pass.

A record whose host's `failed` names its port and copy with three or
more starts is REMOVED, and the slot is placed anew by the rule above
in the same answer, a host where it failed skipped and the
generation's `avoid` of `*` (the controller's hold-off) leaving it
unplaced until the hold-off passes; a copy that keeps failing thus
walks the hosts once and then waits. A record that names an image is
KEPT through its failed starts where it stands, and the status reads
its failures. A generation marked `everyHost` is the exception: its
slot on a host is KEPT through its failed starts there.

A record on a DRAINING host: a task's or a job's slot moves at once,
as from a gone host; a service's or a listener's slot is answered
`drain` while its copy still appears in the host's heartbeat, and
moves once the copy is gone from it. A record already marked
`draining` whose copy is gone from its host's heartbeat moves the same
way whether or not the host still says it is draining.

## The answer

For every generation's slot, one of: `keep`; `create {host}`; `move
{host, from (the host the record named), reason (`host gone` or `host
draining`), draining? (true for a pinned copy's record moved off a gone
host with its image, to finish what it holds and leave)}`; `drain` (a service's or a listener's slot leaving a
draining host, its record to be marked draining, which the leaving
host reads as the copy's end); `park` (a parking service's slot scaled
to zero, its record to be marked parked, which the host job reads as
the park word); `wake` (a parked record whose generation wants its slot again, its copy gone from the heartbeat: written anew at the next epoch without `park`, its image kept, on the host chosen as for a move); `remove`; `unplaced {reason, message}`. The
answer lists the decisions by port and copy, and beside them the
generations' wanted counts after the pass. The execution module writes
the records in that order and the epochs are its own.

## Tests

Pure, over made-up hosts, generations and records, every rule above a
case of its own; the same input answers the same placement twice.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
