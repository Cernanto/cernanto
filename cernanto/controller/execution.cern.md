# cernanto/controller/execution

Type: module

Uses: cernanto/config, cernanto/controller/placement, cernanto/controller/forwarding, cernanto/host, cernanto/documents

Acts on the plane's records for the controller. Given a generation the
controller wants, write its order with its copy count; given the
orders, the hosts' heartbeats and the slot records, place every copy
on a host as the placement module decides and tell the hosts' host
jobs what to start, stop, park and drain; given a question of the
controller, answer it from the heartbeats and the records as they
stand. Every answer carries its facts, or says in its own field that
the request was refused or the observation could not be made, in
words.

## The plane's records

The records are reached through cernanto/documents, bound with no
name, so the plane binds its implementor, once at the first call and
kept for the life of the process, a key handed as plain text, a
host's name and a version in it exactly as they read; and the
configuration is read
through cernanto/config; a call handed the caller's per-pass snapshot
reads the configuration from it, and a call without one reads it
afresh. A documents call that fails is `unavailable` in its words. A
family with nothing under it is a plane with no host yet: every read
that needs a host answers from what stands, and the hosts' listing
answers none.

THE FAMILIES. `hosts/<host>` holds one HEARTBEAT per host under the
host's name, written by its host job when what it says changed and kept
as written. `generations/<port>` holds one ORDER per generation under
the port in decimal, this module's record of what the controller
wants; the host jobs write the bring-up set's orders at a fresh plane's
boot. `copies/<port>/<n>` holds one SLOT RECORD per copy, what a host
job runs: `{host, epoch, since, launch, release, draining?, park?,
hostGoneAt?}`, the host that runs the copy, the epoch of its tenure
(1 for a fresh record, one more at every move to another host and at
every wake of a parked record), the moment the host was given it, the
generation's complete launch with `release` beside its facts (the
host job starts the copy from the record alone), `draining`
when its generation is replaced or its host leaving, `park` when a
parking service is scaled to zero (the record stands, parked, until
the generation wants the slot again), and `hostGoneAt` the moment a
pass first found its host gone. Beside them ride the host job's fields,
`process`, `stop` and THE IMAGE, `image: {image, journals, bytes, at,
attempt, epoch, hostImage}`, the copy's own image, and the copy's own
entry (`ready`, `listens`, `exitCode`, `attempt`, `at`, `lease`,
`state`), all of them carried through every write of this module as
they stand; a record naming an image keeps it through every move and
wake, and its copy is placed on a host whose image can restore it.
`control/<word>` holds the control words: `control/release` the
release the hosts upgrade to, `control/pass` the pass lease,
`control/<host>` (`control/core-a` for the host `core-a`) that host's
word, `drain`, `control/upgrade/<host>` the host's upgrade word,
`control/stop/<host>` the host's stop word, `control/deploy-<version>`
a release's landing word, and `control/forwarding/<host>` that host's
forwarding targets, `{targets, fixed, at, applied?, refused?}`, `fixed`
the ports its wall opens, `applied` the
launch of the host job that applied them, absent until one did, and
`refused` `{launch, words}`, the launch of the host job that refused
them and its words.
`ports/<port>/<protocol>` holds one claim per fixed port, `{agentId,
since}`, the agent whose listener bound the port, written by the
runtime at the bind. A listing of a family is one listing of its
prefix; a write against a record's revision rests on the exact string
read, and an exclusive create rests on absence.

THE HEARTBEAT is `{host, address, cpus, memoryTotalMi,
memoryLiveMi, pressure, version, releases, hostImage, live, starting,
unplaced, failed, draining, at, liveUntil}`: `releases` lists the release versions installed on
the host, its own among them; `live` lists the copies the host runs as
`{port, copy, name, agentId, gen, type, epoch, pid?, ready, starts,
since, memoryMi?, cpuMillicores?, listens, error?, exitCode?}`;
`starting` counts the copies starting on it now; `unplaced` is an
empty list; `failed` lists the starts that failed as `{agentId, port,
copy, message, at, starts}`, one entry per copy with `starts` the
count of its failed starts on that host; `at` is the moment of the
beat in milliseconds, and `liveUntil` the moment until which the beat
holds, in milliseconds, its host job's own word. A host carries `pressure` when it measures one,
its live memory over its total memory, zero to one. A HEARTBEAT
STANDS while its `liveUntil` is ahead of this module's clock at the
read: a record under `hosts/` whose `liveUntil` has passed, or that
names none, is no heartbeat, and every read of a heartbeat's key and
every listing of the heartbeats below answers the ones that stand. A
host is GONE when no heartbeat stands for it, or when
a slot record naming it carries a `hostGoneAt` at or after its
heartbeat's `at` (its host job took no word since its last beat: THE
HOST JOB'S WORDS below); a host job that beats again after that moment
brings its host back. A host is LIVE when it is neither gone nor `draining`.
THE LEASE is `lease-ms` through the configuration agent, 30000
when absent or not a number.

THE ORDER is `{name, launch, release, copies, everyHost?, draining?,
avoid?, unplaced?, createdAt, scaledAt?, retiredAt?, listened?,
handOnOwed?}`, what the controller orders a generation to run: `name`
the generation's name by THE NAMING RULE below; `launch` the
generation's complete input with `release` (the plane's release)
beside its facts; `copies`
the count wanted; `everyHost` true for an agent among THE EVERY-HOST
AGENTS, one copy on each live host whatever `copies` says: an agent
whose standing order is marked `everyHost` (the host job marks the
orders of the bring-up set when it writes them, the gateway's left
unmarked on a laptop's tier whose hosts share one machine and one
gateway port; and a generation that replaces an every-host generation
is every-host, so a bring-up agent is never planned at one copy
mid-roll), with `cernanto/host` among them always. The mark is written
at the order's creation and read from the
order after, so the placement and the counts follow the order and no
later setting. `unplaced` lists the copies the last
placement could not place, `[{copy, reason, message, at}]`;
`retiredAt` is the moment of the order's removal, after which the
order is a tombstone and its slot records are removed; `listened`
remembers that a copy of the generation listened; `handOnOwed` lists,
by their numbers, the copies of an every-host generation that left
with their gone hosts and whose calls a live copy has yet to take over
(THE HAND-ON BY OWNER below). The copies an order WANTS are the live
hosts that are not draining for an order marked `everyHost` and
`copies` otherwise, by the order's own mark. A
copy is HELD when its slot record stands, and READY when the
heartbeat of the record's host is live and lists the copy with
`ready` true at the record's epoch.

THE FACTS of a generation's launch are exactly `{agentId, port, gen,
artifact?, composition?, life?, lives?, type, slots?, run?, form?,
testOf?, target?}`, and a launch is these facts alone: `life` the life the
generation runs under and `lives` the life of each module of its
composition, by the module's id; a process reads its facts from its own
folder, and a worker's launch carries in `run` the number of the run
its process starts when it boots. The facts are the whole of what a
launch, a listing entry and a naming input carry; the naming input is
`{agentId, port}`, and the listing takes an empty input. The port,
the substrate's generation sequence, identifies the generation
plane-wide; `gen` is the agent's own generation ordinal. The
composition maps module agent ids to artifact digests. A launch may
name THE FORM the package takes: `form` is `test`, the package itself
with the mocks its tests wrote linked in place of the mocked edges, or
`tester`, the package's tests as a task with one function `run`; a launch with a form names `testOf`, the pair's other id: a tester's the
id its tests call, a test form's the agent it stands for and calls its
dependencies as; and `target`, the canonical id of the agent the pair
verifies, which both forms state on every call they make. The form,
`testOf` and `target` go into the order's launch with the rest of the
facts.

## The operations

`ensure` takes `{name, launch}`, the launch the generation's input,
the facts above. Refuse, before any reach, a launch that does not fit
the facts, and a name other than the naming rule's answer for the
launch's agent and port. An order standing for the port is left as it is and
its name answered: a generation is immutable, it keeps its stamped
release when ensured again, and ensuring it again leaves a park in
force. An order retired is refused, `this generation has retired`.
Else write the order and answer `{name}`.

`objectName` takes the naming input and answers `{name}`, the
generation's name by the rule; `generationObjectName` answers the
same name as a plain synchronous function, for the callers that name
a generation without an await.

`scale` takes `{name, copies}`. Refuse, before any reach, a count
that is not a whole number at or above zero, the count refused as it
was given. A port with no order, or a retired one, answers `{exists:
false}`; else set the order's `copies` and `scaledAt` against the
entry's revision, asking again up to three times when the entry
moved, and answer `{exists: true, copies}`.

`parkOff` takes `{name, host}`: a generation is parked off a machine
as it is scaled to zero, and its wake lands elsewhere. Do as `scale`
to zero and, when the heartbeats name more than one live host, have
the order's `avoid` name the host until one lease from the moment, so
the placement of the generation's next copies passes that host by; on
a plane of one host the wake lands on the one host there is. The
answer is `scale`'s.

`status` takes `{name}`. No order answers `{exists: false, copies:
0, readyCopies: 0}`, and so does a retired order no live heartbeat
lists a copy of. A retired order whose copies a live heartbeat still
lists answers `{exists: true, copies: 0, readyCopies: the copies
still listed and ready, release}`: its removal is asked and the host
jobs are stopping it. Else answer `{exists: true, copies: the copies
wanted, readyCopies: the copies ready, imaged: the copies standing
in an image, release: the order's release}`. THE COPIES READY are the
slot records of the order's port (`copies/<port>/<n>`, one listing)
whose entry says `ready` true with a `state` other than `stopped` and
`parked` and whose host's live heartbeat lists the copy at the
record's epoch, ready or not: the entry is the copy's own word,
written the moment it serves, and a copy its host job lists no more
counts no more. THE COPIES STANDING IN AN IMAGE are the slot records
of the port that name an image and whose copy has not LEFT; a copy
has LEFT when its record's entry says `state` `stopped` under the
record's process's attempt, the entry's `attempt` equal to the
record's `process.attempt`, and an entry of an earlier life, the one
a restore's `process.restores` names, is read as that life's alone.
The answer carries `exitCode` when the record entry of a worker's
copy carries one (a run that ended reports its exit code beside the
copy counts), and `listening: true` once a ready copy's record
entry has listed a listener in the accepting state on a fixed port
bound on every interface; the order remembers it as `listened`, so a
parked generation still says so.

THE HOLD-OFF, read with `status`: when the heartbeats' `failed`
entries for the order's copies within the last ten minutes carry
`starts` that sum to three or more (an entry without `starts` counts
one), the latest of them younger than the order's `scaledAt` or
`createdAt`, set the order's `avoid` to `{host: '*', until: ten
minutes from the moment}` against the entry's revision, so the
placement keeps its copies off every host until then. The hold-off
applies to every order but the bring-up set's and `cernanto/gateway`'s,
and an order already avoiding every host is left as it is.

`copies` takes `{name}` and answers the instances, empty for no order
or a retired one: one per slot record, `{name: <port>-<n>, state
(running when the heartbeat lists the copy without an error, pending
otherwise), ready, restarts (the copy's starts less one, at least
zero), host (the record's host), startedAt (the record's `since` as
ISO 8601)}`, with `reason: failing` and the message when the host's
`failed` names the copy; and one per copy the order's `unplaced`
names, `{name: <port>-<n>, state: pending, ready: false, restarts: 0,
reason: unplaced, message}`, the message the placement's words.
A held-off order's instances carry `reason: failing` and the last
failure's words.

`drain` takes `{name}`: draining a generation tells its copies to stop
taking new calls and finish what they hold, so its retirement finds
them idle. An order standing gets `draining: true` against the
entry's revision and each of its slot records `draining: true`
against its own revision, and each record's host is told `drain` for
the copy by THE HOST JOB'S WORDS below; an absent or retired order is
left alone. The answer is `{name}`, with `refused` when a word to a
host job was refused or unavailable.

`remove` takes `{name}`: an order standing gets `retiredAt`, an absent
one is removed already, and the answer is `{removed: true}` either
way; the next placement removes its slot records and the host jobs
stop the copies.

`releasePorts` takes `{agentId}`, asked once the fleet holds no other
generation of the agent and the generation's status reads absent:
every claim of the agent under `ports/` is removed resting on the
string it was read at, a claim another agent made meanwhile standing;
a removal refused for any other reason is thrown so the caller asks
again. The answer is `{released: the count}`, zero when the agent held
none.

`list` takes `{}` and answers every order without `retiredAt` as
`{name, agentId, gen, port, copies, readyCopies, release, life?}`,
naming each generation's agent by its id and `life` the order's
launch's when it names one, and purges on the way every tombstone
older than an hour whose slot records are gone.

`hosts` takes `{}` and answers one host per heartbeat, `{name: the
host, ready: live, cpuMillicores: the cpus times a thousand, memoryMi:
memoryTotalMi,
version, pressure: the heartbeat's pressure}`, from the heartbeats
alone.

`metrics` takes `{}` and answers one measurement per live copy of a
live host that carries one, `{name: <port>-<n>, cpuMillicores,
memoryMi}`.

`images` takes `{}` and answers `{named: [{port, copy, image}]}`, one
entry per slot record that names an image (THE IMAGE above), `image`
the archive's name, in the order of the records' listing.

## The placement pass

`place` takes `{}` and runs one placement: read every order, every
heartbeat and every slot record once; mark the gone hosts; hand the
placement module what it decides over; write its answer; hand on the
calls of the every-host copies that left; set each host's forwarding
targets; pace the upgrade; and answer the counts.

THE GONE HOSTS. For each slot record whose host is gone and which
names no `hostGoneAt`, set `hostGoneAt` to the moment against the
record's revision; for each record whose host is no longer gone and
which names one, remove it against the record's revision.

THE OLD HEARTBEATS. A record under `hosts/` whose `liveUntil` is more
than a day behind the moment, or that names none and whose `at` is, is
removed against the exact string read, the answer of the removal left
unread: a host that left the plane keeps no record there.

THE DECISION. Hand the placement module the orders that stand
(retired ones left out; the wanted generation's fields from the
order, its `draining` as the order's and its `listens` from
`listened`), the hosts that are not gone in the shape it reads (a
draining one with `draining` true; its `copies` the heartbeat's live
copies counted; the failed starts within the last ten minutes), the
records with
every field the placement reads (the host, the epoch, `since`,
`draining`, `park`, `hostGoneAt`, and `stopped`, true when the
record's entry says its copy LEFT, as `status` reads it), the images
the records name (each record's `image` as `{port, copy, hostImage,
epoch}`, the image's `epoch` the one it was taken under), the lease
and the moment.

THE WRITES, in the answer's order. A `create` is a new record by an
exclusive create: `epoch` the moment in epoch milliseconds, `since`
the moment, the launch from the order with the order's `release`; a
record that appeared meanwhile is left as it is. A
`move` is an update against the record's revision after one more
read of the heartbeat key of the host the record names: a host live
again and not draining refuses a move for `host gone`, and a move for
`host draining` is written on the first read; the record gets the
new host, the epoch the moment in epoch milliseconds or one more than
the record's when that is higher, `since` the moment, `hostGoneAt`
removed, `draining` removed when the generation's order is not
draining and kept when it drains, and its image kept. A `wake` is a
move of a parked record: `park` removed with `hostGoneAt` and
`draining`, the host the placement's (the record's own when it may
take the copy), the epoch one more than the record's or the moment
when that is higher, `since` the moment, the record's image kept. A
`drain` is `draining: true` against the record's revision. A `park`
is `park: true` against the record's revision, and a record that
carries `park` already is left alone. A `remove` is a delete of the
record, and when the record removed is an every-host generation's,
its copy's number is added to the order's `handOnOwed` against the
order's revision. Then the order's `unplaced` is rewritten from the
placement's words against the order's revision, emptied when every
copy was placed. A write refused for a moved revision is left for the
next pass.

THE HAND-ON BY OWNER. For every order whose `handOnOwed` names a
copy, ask the agent, by its id, the runtime's function `#handOn` with
`{generation: the order's port in decimal, owner: 'copy-<the
number>'}`, forty seconds at most, so a live copy of the generation
takes over the calls the dead copy held; note `calls-handed-on` (`<n>
call(s) of <agentId> handed on from copy <number>`) when the answer's
count is above zero. A number whose ask answered is removed from
`handOnOwed` against the order's revision; one whose ask failed or
was not answered in time stays for the next pass, the module due
again five seconds on.

THE FORWARDING, in the same pass. Hand the forwarding module every
heartbeat read above, and read THE WALL'S PORTS off the same
heartbeats: every `listens` entry with `fixed` true of every copy under
`live`, as `{port, protocol}`, each once, sorted by protocol and then
by port. They are the ports a host's table opens beside what it
forwards, the same list for every host, and a host renders its table
when it is told to apply. Write each host's answer under
`control/forwarding/<host>` as `{targets, fixed, at}`, `fixed` the
wall's ports and `at` the moment, when the standing entry's `targets`
differ from the answer's or its `fixed` from the wall's ports (each
compared as JSON text, an entry that carries no `fixed` differing from
any), or no entry stands. Then have the hosts apply their
targets: a live host whose heartbeat lists a ready copy of
`cernanto/host`, and whose standing key names as `applied` or as
`refused.launch` neither the launch of the host job's own slot record
on that host (its `process.attempt`), is told to apply its targets by
THE HOST JOB'S WORDS below. Once the call answered, its key is rewritten
as `{targets, fixed, at, applied}`, `at` the moment and `applied` that
launch. A call the host job refuses (one that cannot apply a table, an
unprivileged one, refuses for the life of its launch) is said in the
answer and its key is rewritten as `{targets, fixed, at, refused:
{launch, words}}`, that launch and the refusal's words, so the same
host job is asked again only once its targets or the wall's ports
change; a call unavailable is said
in the answer and made again at the next pass. A host whose targets
stand applied or refused by the host job that runs is left alone, and a
plane at rest leaves every key as it stands.

THE UPGRADE PACING, in the same pass, while the control word
`release` names a version. A HOST TO UPGRADE is a live host whose
heartbeat `version` differs from the word while its `releases` carry
the word and none of them stands above the word in THE RELEASE ORDER
(runs of digits by number, the rest as text, left to right). A
standing word `upgrade/<host>` whose host's heartbeat is live under
the word's version is cleared first, and stands no more for the rest
of the pass. One upgrade word stands at a time: while any host's word
stands, the pass writes no other; else the word is written for the
first host to upgrade by name, as the version, by an exclusive
create, in the same pass that cleared the one before, so the hosts
follow one another with no pass between them. A standing word whose
host has no heartbeat is left as it is. A host whose upgrade word
stands while its heartbeat neither drains nor runs the word's version
is told `upgrade` again at every pass. A live host whose heartbeat
`version` differs from the word while its `releases` do not carry it
is told `start` for its own record of the host job, so its host job
reads the releases installed beside it at that sweep and its heartbeat
names the release once it holds it. The pass is due again one lease
after it while an upgrade word stands, while a host to upgrade
stands, while a live host told `start` this way has not listed the
word's version yet, and while a host whose heartbeat says it drains
still holds a slot record other than its host job's.

THE ANSWER is `{created, moved, woken, drained, removed, unplaced,
forwarded, refused?, nextDue?}`: the counts written (`forwarded` the
hosts whose table the host job applied), `refused` the words of every
word to a host job refused or unavailable, joined `; `, when any was, and
`nextDue` the earliest moment the pass is due again, as ISO text,
absent when nothing waits: one lease after a gone host's record's
`hostGoneAt` for the record of a service and for the record of A
LISTENER, a generation whose order is marked `listened` whatever its
type (a task that listens on a fixed port is one: its copy keeps the
port and moves a lease later, as a service's does), each told by the
order of the record's port; any other task's or job's record moves at
once and is due at no moment of its own; one lease after the pass while an upgrade or a
drain goes on; five seconds after the pass when a word to a host job of
this call found a host gone, so the pass that found the host gone arms the
pass that moves its copies. A moment already passed is left out: its
record was moved this pass or left unplaced, and an unplaced slot
waits the pass's own lease.

## The pass lease

`takePass` takes `{holder}` and takes the control word `pass` for the
holder: an exclusive create of `<holder>:<until>`, `until` one lease
(`lease-ms`, thirty seconds when absent) from the moment, when
nobody holds it; when a holder's `until` has passed, a rewrite
against the revision read, so a holder that died in the middle of its
pass loses the word. Answer `{taken: true, revision}` or `{taken:
false, holder, until}`. `releasePass` takes `{revision}` and clears
the word at that revision alone, a word another holder took since
left standing; answer `{}`.

## The host job's words

The host jobs read their hosts' records when this module tells them to.
A word is a call of `cernanto/host` named at run time, the agent id
spelled literally and the host named in the call's options, made
after the writes of the call that asks for it, once per copy or host,
to a host that is not gone and whose heartbeat lists a ready copy of
`cernanto/host`, a draining host among them, and awaited until it is
answered or fails, forty seconds at most. Its refusal is a terminal
failure in the host job's words and its unavailability a retryable one,
each said in the answer's words. The words: `start` for a copy, to
the host a slot record was written for (a placement, a move, a
restart, a look); `stop` for a copy with the reason, to the host of a
record this module removed or moved off it, the reason the record's
end in words; `park` and `drain` for a copy, to the host of a record
this module wrote `park` or `draining` on; the host's own drain and
upgrade, to the host whose word this module wrote (`control/<host>`,
`control/upgrade/<host>`); and the forwarding targets, to the host
whose key THE FORWARDING wrote. A HOST WHOSE HOST JOB DOES NOT TAKE A
WORD (the call fails as the target unavailable, the failure kind
`target-unavailable`) is a host gone to this module: write
`hostGoneAt` with the moment on every slot record naming it, resting
on what was read, a record whose `hostGoneAt` stands at or after its
host's last beat left as it is and an older one replaced, so the
placement moves what the host held, and say so in the answer's words.

`look` takes `{agentId}`, a caller's word that no copy of the agent
took its call: read the slot records of the agent's standing orders
once and tell the host job of each host they name `start` for each of
its records, by the words above; the host job reads its records and
starts again a copy found gone, and one that does not take the word is
a host gone, as above. Answer `{told, gone}`: the count of words the
host jobs took, and the hosts found gone this way.

## The plane's words

`upgrade` takes `{version}`: the hosts upgrade to the release named
one at a time, each told by a word of its own and draining first (THE
UPGRADE PACING above), and a generation keeps the release it was born
with. Refuse, before any reach, a version that is not a release name,
letters, digits, dots, dashes and underscores with a letter or digit
first (`not a release name: "<version>"`); refuse on a plane whose
heartbeats name one live host (`this plane is one machine: its
release is the host's own`); else write the control word `release`
and answer `{version}`.

`markDeployed` takes `{version}`, writes the control word
`deploy-<version>` as `done`, the one fact that a release's packages
landed on this plane, and answers `{version}`; `deployed` takes
`{version}` and answers `{done}`, whether the word stands.

`drainHost` takes `{host}`: draining one host tells it to let its
copies go for the other hosts to take. Refuse a host no heartbeat
names (`no host "<host>"`), and refuse on a plane whose heartbeats
name one live host (`this plane is one machine: nothing drains`);
else put the word `drain` under the record `control/<host>`, the
host's name itself, tell the host by THE HOST JOB'S WORDS, and answer
`{host}`, with `refused` when the word was refused or unavailable.

An observation that could not be made is answered as `unavailable`
in its words, which is a different answer from an absent figure or a
figure of zero.

## The lives

An agent runs under a life, one span of its deployment, and a host's
runtime keeps the record of the life each name stands under, with the
life's traces and its journal. `life` takes `{agentId, ending?}` and
answers `{life}`, the life the name stands under, a new one made when
none stands, the lives `ending` lists ended in the name's record
first. `endLife` takes
`{agentId, life}` and answers `{done}`: true once the life's traces
and journal are removed, false while more remains to remove, to be
asked again. Each is a call of the runtime's function of the same
word, `#life` with `{agentId, ending?}` and `#endLife` with `{agentId,
life}`, on `cernanto/host` named at run time, the host named in the
call's options, the call's `result` being `{life}` or `{done}`: the
first live host by name whose heartbeat lists a ready copy of
`cernanto/host`, awaited forty seconds at most; a plane with no such
host answers `unavailable` in words. The runtime's
refusal is a terminal failure in its words and an unavailability a
retryable one, each answered in the answer's words.

## The naming rule

A generation's name is `<agent slug>-s<port>`, the slug the agent id
lowered with every character outside lowercase letters, digits and
dash replaced by a dash; beyond 63 characters it is `<first 24 slug
characters>-<first 8 hex characters of sha256 of the agent
id>-s<port>`. The port a name carries is the decimal after its last
`-s`. Naming reads the input alone and needs no plane.

## The release's agents and the settings

The release's own agents are generations on every plane, listed,
ensured, scaled and removed like any other. Every host's host job writes
the bring-up set's orders and its own slot records of them at a fresh
plane's boot, before the controller runs, and the listing lists them
for the reconcile to adopt. THE RELEASE'S AGENTS are the ids of the
packages the release this process runs from carries, found by THE SCAN
below, so a generation of the release is told from any other by its
agent id alone, whoever compiled the package that runs under its name.
THE EVERY-HOST AGENTS are the agents whose standing order, one not
retired, is marked `everyHost`, with `cernanto/host` among them
always, in the orders written and in the settings this module
reports.

THE SCAN finds the release's agents in the folder the release's
packages lie in. Read the mark, the file `materialized.json` in this
copy's working folder, with the file system's own read, and take the
`folder` of the `release` entry of its `machine` object
(`machine.release.folder`): the release this process runs from. Under
that folder's `cernanto` folder, walk every folder at any depth, a link
to a folder walked as a folder, and a folder whose name starts with a
dot left out unless its name is `.cern`: every file whose name ends in
`.cern` and that lies in a folder named `.cern` is a package, and its
id is its path from the release's folder with the `.cern` folder and
the `.cern` ending dropped, so `cernanto/compile/.cern/gates.cern` is
`cernanto/compile/gates`. The scan is made once, at the first call
that needs it, and kept for the life of the process. A mark that cannot
be read, or that names no release's folder, or a folder that cannot be
read, means none.

`settings` describes the execution shape, the hosts of the plane, one
machine or several, each running the host job, and reports the kind
`hosts`, THE RELEASE, the one every host runs: the lowest version, in
the release order, that a standing heartbeat names, a draining host's
among them, where a beat that lists no release installed, a beat that
names no `pid` (the one a host writes before its host job serves, and
the last one a host writes when its host job leaves) unless that host's
upgrade word stands, and a host gone name none; so a plane in the
middle of an upgrade keeps the release its hosts ran until the last
of them has moved. When no standing heartbeat names a version, or the
hosts cannot be read, the release is absent for the pass and the next
beat names it again: the release follows the hosts alone, and a host
gone for a moment (its host job late with its beat, or a call it did not
take) moves it nowhere. The orders this module writes carry the same
release. The rest: THE RELEASE'S AGENTS
as the scan finds them, sorted; THE EVERY-HOST AGENTS as the standing
orders mark them, sorted; the idle minutes from `idle-minutes` (15), and
the copy limit, the live hosts times `copies-per-host` (4 when
absent or not a number), at least one, or `max-copies` (8)
when the hosts cannot be read. The settings carry the configuration
as an opaque snapshot, which a reconcile pass hands back to the
pass's operations: an operation handed the snapshot reads from it for
that pass, and one without it reads the configuration afresh. The
snapshot carries these values alone; a credential is read at the
reach that needs it.

## Tests

The tests run on the live plane the tests run on, whose one host job
runs the controller this module is linked into, and leave its records
and words as they stand: they exercise the naming rule and the port
read back from a name; the refusals that need no reach (a count that
is not a whole number, a name that does not fit its launch, a
malformed launch, a version that is not a release name); the settings
read (the kind `hosts`, the release, the release's agents as the scan
finds them, `cernanto/controller` among them, its numbers at their
defaults when the configuration names none); and the reads: `list` names the plane's
own generations, the controller among them; `hosts` answers at least
one host, this machine's, live, with a positive cpu and
memory; `metrics` answers a measurement for at least one live copy;
the `copies` of the controller's own generation answer at least one
instance whose `host` is a host the heartbeats name; the `status` of
a made-up generation answers `{exists: false, copies: 0,
readyCopies: 0}` and its `copies` `[]`; `images` answers a list,
every entry with its three fields. The writes (`ensure`, `scale`,
`parkOff`, `drain`, `remove`, `place`, `takePass`, `upgrade`,
`drainHost`) are proven by the local tier and the lab, which move
real records on planes of their own.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
