# cernanto/host

Type: job

Uses: cernanto/documents, cernanto/objects, cernanto/config, cernanto/machine

Does the plane's work on this host: one copy of this agent runs on every
host as the host's own process, started by the release's block (a server's
unit, a laptop's `cernanto dev`), which rings its `serve` with this host
named for as long as the process runs. `serve` does on this machine what
the plane needs done here: it beats the host's heartbeat, starts the
copies the plane placed here by running the block and stops them by the
words it posts to their call servers, writes the bring-up set's orders
and this host's own records at a fresh plane,
obeys the plane's words to this host (the drain, the upgrade and the
stop), dumps a copy into a checkpoint image and restores a copy from its
image, and applies this host's forwarding table. The controller calls it
for the copies here and for the host's words, a copy running here calls
it for its image, the block calls it to stop the host, and each act is
answered when the work is done, or at once when the act outlives the
call and says so.

Where the block runs as root the copy runs as root, and its acts on the
machine are root's. The copy that serves on a host is the release's own
program, moved to another release by the host's upgrade; a deploy of
this agent lands its package for the next release. It reads the records
when something happened, told by a call of one of its functions.

## This copy, its release and its host

THIS AGENT REACHES ITS MACHINE WITH NODE'S OWN CALLS, the same on every
system: a file is read, listed and removed with the file system
module, a fact of the machine is the os module's, a process is asked
after and ended with `process.kill`, a program is started with the
child process module directly, by its file and its list of arguments,
hidden (`windowsHide` true at every start), and every path is composed
with the path module. A SIGNAL is written below the way the `kill`
command names it and is always sent with `process.kill`: `kill -TERM
<pid>`, `kill -KILL <pid>`, `kill -CONT <pid>` and `kill -USR2 <pid>`
are `process.kill` on the pid with `SIGTERM`, `SIGKILL`, `SIGCONT` and
`SIGUSR2`; `kill -0 <pid>` is `process.kill` with the signal 0, which
asks whether the process is there: it is there when the call returns
or throws with the code `EPERM`, and gone on any other error.

WHAT DIFFERS FROM ONE SYSTEM TO ANOTHER IS THE MACHINE'S, asked of
cernanto/machine, bound with no name, so the plane binds the
implementor of the system this host runs on, once at the first ask and
kept for the life of the process: the trees of processes with their
starts, this boot's identity, what a launch left running, and the
processes working under a folder, each named below where it is asked.
An ask the machine fails is a failure in its words, taken as each
passage below says. The acts that are a server's alone (the images,
the namespaces, the forwarding table) run the server's own tools as
commands, named below, and only a privileged copy reaches them.

THIS PROCESS's pid is the process's own (`process.pid`). THE RELEASE is
the folder the mark names (`machine.release.folder`; the mark is the
working folder's `materialized.json`, below), and THE BLOCK is its
program, `<release>/runtime/process/dist/agent/bin.js`. A release's
block is run with THE NODE of that release: its own `<release>/bin/node`
when that file exists, and otherwise the program `node` in the folder
the mark names (`machine.node`, the node this copy runs on); the
program is named `node` on every system, and a system whose programs
carry an extension finds it by that name. The block
starts a copy as its own process with `--detach <port> <n>` and lays a
folder out for a restore with `--prepare <port> <n>`, each exiting 0
when done or non-zero with its words on its standard error, the last
line of which is the failure's words here. THE RELEASE'S FACTS are what
`<node> <release>/runtime/process/dist/materialize/release-facts.js`
prints, one JSON document: `{version, releaseAgents, types}`, the
version this release runs as, the ids of its packages and the type each
package states, by its id; read once at the start of `serve`.

THE HOME is the parent of the parent of this copy's working folder (this
copy runs in `<home>/generations/<this generation's name>`), the working
folder being the current directory as the path module resolves it: where
this agent keeps what is its own (the plane's secrets, the dumps' and
the restores' folders, the copies' own folders), a folder root's alone
on a server. THE ROOT, where the agents' generations and their data
live, is the mark's `machine.root` when the mark names one, and the home
otherwise. A file this agent reads in the root's folders (a copy's error
stream, its idle file, the pause's words) is read with the file system
module by its own path: opened for reading with the module's
`O_NOFOLLOW` flag where its constants carry one, and where they carry
none opened once the path's own status, read with the link-status
call, is a regular file's;
read when the open file's own status is a regular file's; and read only
so far: the error stream's last 32 KiB, counted from the open file's
size, and a word whole when it holds at most 1 MiB. Anything else at the
path (a link, a pipe, a longer word) reads as an absent file, and the
handle is closed whatever came of the read. Whatever this agent writes lives in its home. THIS HOST,
THE ROOT THE BLOCK RESOLVED AND THE PLANE'S START are what the block
wrote into the working folder's `materialized.json` when it laid the
folder out, read whole with the file system module, under `machine`:
`{id, root?, release, node, settings, everyHost?, leaseMs?}`, `id` the
machine's hostname as the block read it (or the name a proof gave its
second plane on a machine), `root` the plane's root, `release` the
release this copy runs from, `{folder, version}`, `node` the folder of
the node it runs on, `settings` the settings a proof's plane starts with, and
`everyHost` and `leaseMs` this agent's own start, which a proof's plane
may name: whether the gateway runs on every host, and THE LEASE. This host's name is the mark's `machine.id`; a mark
without one is said once, `the mark materialized.json holds no
machine.id`, and the first heartbeat below stays unwritten. THE RELEASES
FOLDER is the parent of this release's folder; THE RELEASES installed
here are the folders of it whose `runtime/process/dist/agent/bin.js`
exists, a folder whose name ends in `.part` left out, in the order of
the `packed` moment their `release.json` names, a release without one
before those with one, and among equals by name (runs of digits compared
as numbers and the rest as text, left to right); THE HIGHEST is the last
of them, the one the unit's launcher starts.

THE MACHINE'S FACTS, read in every beat from the os module: `cpus` its
available parallelism, `memoryTotalMi` its total memory in mebibytes
rounded down, `address` the first IPv4 address of a network interface
that is not internal (`127.0.0.1` when none), `hostImage` `{image:
'unknown', kernel: the os module's release, criu: for a privileged copy
the first line `criu --version` answers with a leading
`Version:` dropped, and 'none' for every other copy and when the
command is absent or fails, arch: the os module's architecture,
release: the facts' version}`, and `forwards` whether `nft --version`
answers, asked by a privileged copy alone and false for every other. The commands run inside the call
that beats. THE
LEASE is the mark's `machine.leaseMs` when it names one, a positive
number (a proof's word), 30000 otherwise.

THE HOST JOB'S OWN SETTINGS are the operator's switches for this agent, the
keys `cernanto/host/images` and `cernanto/host/call-ports`, which the
operator sets through the configuration agent and which stand in that
agent's records of them, `config/setting/cernanto/host/images` and
`config/setting/cernanto/host/call-ports`, each the value's JSON text.
This agent reads those two records directly through
cernanto/documents at every sweep, never by a call of the configuration
agent, since this agent runs before and beneath every other agent and a
call of one that does not serve yet would hold the sweep; a record that does not stand, or whose string is not JSON, reads as its
setting unset; a setting whose record does not stand is read from the mark's
`machine.settings` under its full key (`cernanto/host/call-ports`, a
proof's word) and is unset otherwise. These are the two records of the
configuration agent's this agent reads, and they hold no credential: a
credential is never a setting of this agent. A copy's own folder, this agent's record of a copy it
restored or dumped, is `<home>/copies/<name>` for the first copy of a
generation named `<name>` and `<home>/copies/<name>-c<n>` for the copy
numbered `n` above zero, made with mode 700 when first written.

PRIVILEGED is what this copy is when its process runs with the effective
user id zero, the `uid` of the os module's user info. A copy
that is not (a laptop's plane, a candidate under
verify) answers, after the checks that need no privilege, the restore
and the forwarding with the refusal `not privileged on this machine` and
the dump with `this copy cannot take an image: not privileged`. THE
AGENTS' GROUP is the group of the root, read off the folder's own status; what this
agent writes for the agents (the secrets folder and its files) is root's
with that group when this copy is privileged, read by the agents, and
the home stays this copy's user's own.

## The records

Reach the plane's records through cernanto/documents and the checkpoint
archives through cernanto/objects, each bound with no name, so the
plane binds its implementor, once at the first call and kept for the
life of the process; a record's key and an object's name are plain
text, this host's name in them exactly as it reads; a documents or
objects call that fails is a retryable failure in its words.

THE RECORDS, by family: `hosts/<host>` holds one heartbeat per host
under the host's name, which says until when it holds (below);
`copies/<port>/<n>` holds one slot record per copy, the copy's own entry
riding on it; `generations/<port>` one order per generation under the
port in decimal; `control/<word>` the control words (the host's words,
`control/<host>`, `control/upgrade/<host>` and `control/stop/<host>`,
among them); `ports/<port>/<protocol>` one claim per fixed port;
`images/<name>` the checkpoint images' records, the archives themselves
among the objects under `images/<name>`. A LISTING of a family is one
listing of its prefix through cernanto/documents; an absence from a
listing is confirmed by a read of the record itself before anything acts
on it, and a read the documents do not answer leaves things as they are,
one more sweep asked five seconds later (once: a sweep that reads again
cleanly asks no other). A write against a record's revision is a write
resting on the exact string read, and an exclusive create a write
resting on absence.

A SLOT RECORD is `{host, epoch, since, launch, release, draining?,
park?, hostGoneAt?, image?, process?, stop?, ...}`: the host that runs
the copy, the epoch of its tenure, the moment it was given it, the
generation's complete launch (`agentId`, `port`, `gen`, `type`,
`artifact?`, `composition?`, `form?`, `testOf?`, `release`),
the release version, whether it drains, whether it parks now, the moment
its host was found gone; THE IMAGE, `{image, journals: [{subject,
position}], bytes, at, attempt, epoch, hostImage}`, written by this
agent at a dump's commit (below) and carried through every move of the
record: the archive's name, the position each of the copy's journals
stood at in it, the archive's size, the moment, the life the image holds
(the record's process attempt at the dump), the epoch the copy ran under
and the host image it was taken on; a copy whose record names an image
comes back from it wherever its process is found gone (THE COPIES TO
START below); and the two fields that are this host's: THE PROCESS,
`{attempt, at, restores?, pid?, started?, boot?}`, written by the
block's launcher, the attempt a fresh nonce of one launch written before
the copy is started (`restores` the attempt of the life an image holds,
for a copy prepared for a restore), the pid of the process it started
written the moment it started, and this boot's identity written after
that, with the start identity where the system named one; and THE STOP WORD, `{attempt?, at}`, this agent's
word to the copy (below). The record's `process` is this host's launch
when its `at` is later than the record's `since`; an earlier one is a
previous host's, left by a move, and the copy is started here afresh
when it names no image and restored when it names one. A COPY'S ENTRY is
the record's own fields `agentId`, `generation`, `copy`, `attempt?`,
`ready`, `listens`, `address?`, `exitCode?`, `resumedAt?`, `at`, `state`
and `lease`, what the copy's runtime writes of itself onto its record by
compare-and-set, the rest of the record kept: whether it serves, its
listeners (each `{protocol, port, address, family, state, fixed, bound,
refused?, since}`), THE ADDRESS of its call server (`{host, port}`,
where this agent posts its words to it), a worker's exit code, when it
last resumed from a pause, and the moment of the entry's last write,
which the runtime makes when anything of the entry changes; the entry is the record's
copy's when its `attempt` is the record's process's, and a copy that
leaves cleanly writes its entry `state: 'stopped'` with `ready` false;
this agent reads the entry at its next sweep. AN ORDER is `{name, launch,
release, copies, everyHost?, draining?, retiredAt?, ...}`, what the
controller orders a generation to run; an order with `retiredAt` is
retired. THE GENERATION NAME of an agent id and a port is the id lowered
with every character outside lowercase letters, digits and dash replaced
by a dash, then `-s<port>`.

## The heartbeat

THE HEARTBEAT of this host is `{host, address, cpus,
memoryTotalMi, memoryLiveMi, pressure, version, releases, hostImage,
live, starting, unplaced, failed, draining, at, liveUntil, pid,
words}`, written as the record `hosts/<host>` in one write resting on
what stands (re-read on a lost race) and kept as written: `host`, `address`, `cpus`,
`memoryTotalMi`, `releases` and `hostImage` as above; `version` THIS
RELEASE, the facts' version; `live` the copies below;
`memoryLiveMi` the sum of the measured memory of the live copies,
`pressure` that sum over `memoryTotalMi` (0 when the total is 0), the
machine's measured load and nothing else; `starting` the count of the
copies held that are not ready,
carry no error and are not stopping; `unplaced` an empty list; `failed`
the failed starts below; `draining` whether this host drains; `at` the
moment in milliseconds; `liveUntil` the moment until which this
heartbeat holds, `at` plus THE LEASE, in milliseconds; `pid` the pid of the process whose `serve`
runs, absent when none runs here; `words` the last fifty lines this
agent said, `{at, line}` each, `at` the moment as ISO 8601 text. A LIVE
COPY is `{port, copy, name, agentId, gen, type, epoch, pid?, ready,
starts, since, memoryMi?, cpuMillicores?, listens, form?, error?,
exitCode?, lastWords?, release?, artifact?, stopping?, journalEntries?,
journalBytes?}`, one per slot record naming this host that this agent
holds: a copy's `pid` the record's process's pid when that process is alive
(below), `ready`, `listens` and `exitCode` the copy's entry's when the
entry is the record's copy's, `ready` false and `listens` empty
otherwise; `epoch` and `since` the record's; `starts` the launches this
agent made for the copy, counting one for a copy found running when this
agent began; `memoryMi` and `cpuMillicores` from THE MEASUREMENT: the
sweep's one ask of THE MACHINE'S TREES (below), each live pid's tree,
`memoryMi` the tree's memory in mebibytes and `cpuMillicores` the
increase of the tree's processor seconds since the beat before over the
seconds elapsed, times a thousand, zero at the first (a sweep whose
trees the machine could not answer tells no copy's life: it measures
nothing, starts and stops nothing, and says so once); `journalEntries`
and `journalBytes` the records and the bytes the copy's journal holds
since its last image, the copy's own count, read from its idle file,
`<root>/generations/<name>/work/agent/idle.json` for the first copy and
`work/agent/idle-c<n>.json` for the copy numbered `n` (a JSON document
whose `journalSince` and `journalBytesSince` they are), read as the
error stream below is read, absent when the file is not there or does
not parse; `error` the last failed start's words while the copy is not
running; `lastWords` the last five lines of the copy's error stream,
`<root>/generations/<name>/control/stderr` for the first copy and
`control/stderr-c<n>` for the copy numbered `n`, the lines beginning
`AGENT <digits>: ` left out; `release` and `artifact` the launch's;
`stopping` while a stop of the copy runs (a copy stays listed until its
stop answered). A copy launched into pid namespaces of its own (a copy
with a journal, a service, a task or a worker, on a machine with CRIU
under a privileged copy of this agent) is listed with the pid
of the init of that namespace, the first of the pids the machine's
tree lists under the record's process whose `NSpid` line in its `/proc`
status carries two numbers, the second 1.

THE MACHINE'S TREES are asked of the machine once in every sweep, for
the pids the records of this host name: of each pid, the process's
start, the pids of its tree, the processor seconds the tree used so far
and its memory, or nothing for a pid no process has; the ask is given
thirty seconds. THIS BOOT'S IDENTITY is the machine's, asked once and
kept for the life of this process.

A PROCESS IS ALIVE, first, when the record's own entry carries the
record's process's attempt with an `at` within two leases and a state
that is not `stopped`, and the process is there (`kill -0 <pid>`),
whatever its start; otherwise when the process is there and its
identity is the record's: its `process.boot` is this boot's identity,
and the start the machine's tree tells for the pid is the record's
`process.started`, the two texts equal; a record without `started` is
matched by the pid alone. A pid the machine's trees answer nothing for
while the process is there leaves the process alive by its pid that
sweep, and a start that is told and differs is a death. The process
this agent runs in is alive. A sweep whose ask of the machine failed
leaves every copy as it is, and the next sweep asks again. A slot whose
copy this agent started within the last lease keeps that launch while its
process's pid is there.

THE BEAT. The heartbeat is written by this agent at the end of every
sweep, when a sweep changed anything of it (a copy appearing, ready,
gone, failed or stopping, its listeners, its measurement, the host
draining, its release, its words), and by the sweep a third of a lease
after its last write, its `at` the moment and its `liveUntil` a lease
after it, so it holds while this agent serves, and the heartbeat of a
host whose host job stopped holds no more a lease after its last beat. A
HEARTBEAT STANDS while its `liveUntil` is ahead of the reader's own
clock; one whose `liveUntil` has passed, or that names none, is no
heartbeat to whoever reads it, this agent among them. THE BEAT'S
MOMENT, a third of a lease after the
heartbeat's last write, is one moment: each write of the heartbeat
moves it, and no earlier one stands beside it, so a host at rest sweeps
and writes its heartbeat once a beat and no more. The heartbeat is
written as well by this process at
its load, once, before it serves, from the mark and the working folder
alone, every failure of it said once: THE FIRST HEARTBEAT, `{host: this
host, address: '', cpus: 0, memoryTotalMi: 0,
memoryLiveMi: 0, pressure: 0, version:
'unknown', releases: [], hostImage: {image: 'unknown', kernel:
'unknown', criu: 'none', arch: 'unknown', release: 'unknown'}, live:
[one entry for this copy: port the number after the last `-s` of the
working folder's name, copy 0, name the folder's name, agentId
'cernanto/host', gen 1, type 'job', epoch 0, ready true, starts 1, since
the moment, listens []], starting: 0, unplaced: [], failed: [],
draining: false, at: the moment, liveUntil: the moment plus THE LEASE,
words: []}`, written when no heartbeat
record of this host stands written within the last third of a lease by
another process. A heartbeat that could not be written is said once; the
launches wait while the last beat failed, and the next sweep writes it
again. THE BEAT TELLS THE CONTROLLER WHAT IT CARRIES ANEW: once a
heartbeat landed, for each copy it lists ready (`ready` true, its
listeners with it) that no beat of this agent listed ready under the same
launch of the copy before, and for this agent's own copy once the first
beat over the first heartbeat landed (the first that carries the
machine's facts), this agent tells the controller the copy is ready, a
call of `cernanto/controller` by its id on its `copyReady` with the
copy's agent id, its port, its number and this host, not awaited by the
sweep, a failure said once.

## The defaults and the operator token, at the start of `serve`

At the start of `serve`, before its first sweep, read the release's
facts. This agent writes nothing into the configuration but two
defaults. THE DEFAULTS are the records `config/setting/<the interface
id>/default`, each a JSON string, each written through cernanto/documents by an
exclusive create so the operator's choice survives a restart:
`config/setting/cernanto/llm-prompt/default` as `cernanto/llm-prompt/harness`
and `config/setting/cernanto/decision/default` as `cernanto/decision/llm`,
the engine each interface starts with; the harness default,
`config/setting/cernanto/harness/default`, is never written here, a box's
`cernanto dev` writing it after its login discovery and a server's
operator by hand. THE OPERATOR
TOKEN: take the control word `control/operator-token` by an exclusive
create with the trimmed contents of the file
`<home>/secrets/operator-token` (under the home: on a server this agent's
own folder, which the block links into the gateway's) when that file
exists and is not empty and sixty-four random hex digits otherwise, then
read the word that stands and write it into that file: when privileged
the folder with mode 750 and the file with mode 640, both root's with
the agents' group (the file system module's change of owner, to the
user 0 and that group), and otherwise the folder
with mode 700 and the file with mode 600; the gateway's copies read the
plane's one token there through the folder the block links into theirs.

## The host job: `serve`

`serve` takes nothing and runs for the life of the host; the block that
runs this copy rings it at its start, with this host named, and again
five seconds after it ends, for as long as the process runs. It answers
`{ended}` with the reason when it ends: `not privileged on this machine`
at once when the file `/etc/cernanto/machine.json` or the folder
`/etc/cernanto` exists and this copy is not privileged; `serving
already` at once when one runs in this process; `stopped` when THIS
COPY'S OWN RECORD (the slot record naming this host whose launch's agent
id is `cernanto/host` and whose port is this generation's) says `stop`
or is gone under a standing order (this agent saying `the record of <key>
says stop: this host job ends` or `the record of <key> is gone under a
standing order: this host job ends`), or when the host's stop word below has
been obeyed; and `upgraded` when this host ends for its upgrade below.
At its start this agent says `serving`. A
SWEEP is one reading of this host's records and the acts they ask for,
and THE HOST JOB SWEEPS WHEN SOMETHING HAPPENED: once at the start of
`serve`; at every call of `start`, `stop`, `park`, `drain`, `drainHost`,
`upgrade` and `stopAll` below; when a launch or a stop this agent made
ends; when a moment this agent set itself comes (THE BEAT'S MOMENT
above, a launch's patience, a stop's grace and its last resort, a
backoff's end, the drain's ten minutes, the five seconds after a read
the documents did not answer); and after every heartbeat that landed
again after failing; a sweep asked while one runs is one more sweep
after it. When `serve` ends for a stop
or an upgrade, the heartbeat is written once more without `pid`. In
every sweep the records, the orders, the copies' entries and the control words are
listed once, and the machine is asked once for the trees under the pids
the records name, which tell the identities and the measurement both.

THE FUNCTIONS the plane calls this agent with, each answered at once with
`{asked: true}` (`{asked: false}` when no `serve` runs in this process,
the candidate under verify), the act itself the sweep's that follows:
`start {port, copy}` says the controller placed a copy here (the sweep
starts it as THE COPIES TO START below say); `stop {port, copy, why?}`
says the copy is to leave, and the sweep stops it with THE STOP
below, `why` its words; `park {port, copy}` and `drain {port, copy}` say
the controller wrote that word on the copy's record, and the sweep posts
it to the copy; `drainHost {}` and `upgrade {version}` say the
controller wrote the host's word (THE HOST'S WORDS below), which the
sweep reads; `stopAll {grace?}` is THE HOST'S STOP below. A function
named for a copy no record of which names this host answers `{asked:
false}` with `why` saying so.

A WORD TO A COPY (`stop`, `park`, `draining`) is posted to the copy's
call server at the address its entry names: an HTTP POST with the fetch
the language offers to the route of the word, `http://<host>:<port>/stop`
for `stop`, `/park` for `park` and `/drain` for `draining` (the copy
serves these three routes and no other; an IPv6 host in brackets), the headers `content-type:
application/json`, `x-cernanto-key` holding the record's key
(`copies/<port>/<n>`) and `x-cernanto-epoch` THE EPOCH THE COPY RUNS
UNDER, the epoch of the tenure this agent holds it at (the record's epoch
while the record names this host at it; once the record names another
host or another epoch, still the copy's own, never the record's new
one, which a copy of the old tenure refuses), and the body `{why}`, this
agent's words; a 2xx answer is the copy's taking, and
the copy leaves on the word as it would on its own drain. A word is
taken once per word and tenure of a copy: a copy that answered, whatever
the status, has had it; a POST THAT REACHES NO COPY (no address named
yet, the connection refused, or five seconds without an answer) is
posted again two seconds later, a moment this agent sets, its address read
afresh from the copy's entry, while the copy is held and the word stands
for it, THE STOP's word below through its grace. `stop` is this agent's
stop word below, posted as well, with the words `fenced: ...`, to a copy
whose record names another host, or this host at another epoch; `park`
and `draining` are the controller's words on the record.

THE BRING-UP: at the first sweep of this process the orders, and at
every sweep this host's records. For each agent of THE BRING-UP SET,
`cernanto/packages` at the port 19990, `cernanto/config` at 19991,
`cernanto/trace` at 19992, `cernanto/controller` at 19993,
`cernanto/gateway` at 19994 and `cernanto/host` at 19995, whose agent id
no standing order names, write the order (at the first sweep alone) as
the record `generations/<port>` by an exclusive create, `{name: the
generation name, launch: {agentId, port, gen: 1, type, life, release:
the facts' version}, release: the facts' version, copies:
1, everyHost: true, createdAt: the moment}`, the `life` being the life
the agent's name stands under, asked of this host's own runtime (the
runtime's function `#life` of `cernanto/host`, called at run time with
this host named, `{agentId}` answered `{life}`); the `type` being the one the
release's facts name for that id, in their `types`; an agent whose type
the facts leave unnamed is left out of the bring-up and said once; and
the gateway's order
without `everyHost` when the mark's `machine.everyHost` stands false;
then for each agent of the set but `cernanto/gateway` (which the
controller places): under the newest standing order of the agent (the
latest `createdAt` among the orders of that agent id neither retired nor
draining), when no slot record of that order's port names this host,
write this host's record at the lowest copy number no record of the port
holds, `{host: this host, epoch: 1, since: the moment, launch: the
order's launch, release: the order's release}`, by an exclusive create,
trying the next number when another host took it meanwhile. A bring-up write that fails is made again at the next sweep. This agent's own order
stands for the life of the plane and its record is the host's own,
written at the lowest free copy number of this agent's port by the block
at the copy's start or by this bring-up when none names this host.

THE HOST JOB'S OWN MEMORY is kept in this process for its life and in no
record: the moments it set, the launches and stops under way, the
dumps and restores under way with their ready words, the words it
posted per copy and tenure, the failed starts with their backoffs, and
what it said once; a host job that starts again holds none of it and
reads the records. A function of this agent called in the serving process
asks that process's sweep directly. Nothing of this agent runs before
`serve` is called: the facts are read, the first heartbeat written and
the sweep run inside that call, never at the module's load (a command
outside a call is refused by the runtime).

THE HELD COPIES are the slot records naming this host whose process is
this host's launch and alive, or whose launch this agent asked and not
yet saw a pid for; a copy this agent launched is remembered with the
moment of the launch. A sweep judges a held copy by the record as that
sweep read it, so a copy whose launch ended after the sweep read the
records is judged by the next sweep, which reads the record that launch
wrote: the record the earlier sweep holds still names the process before
the launch. For each held copy, in every sweep: when its
generation's order is gone or retired, stop it with the stop word,
saying `the order of <name> is gone; the copy <n> retires`; when its
record is gone under a standing order (its slot scaled away), stop it as
THE STOP below does, the word `stop` posted to the address this agent
holds for it (no record stands to carry the stop word), saying `the
record of <port>/<n> is gone; the copy <n> leaves`; when its record
names another host, or this host at another epoch, this agent posts it
`stop` with the words `fenced: the record names <host> at epoch
<epoch>`, it leaves, and it is held no more once its process is gone;
when its record says `park` or `draining`, this agent posts it that word
and the copy leaves on it, and when it is still running five minutes
after the word appeared (a moment this agent sets, which asks a sweep) and
holds no call (below), the last resort ends it, this agent saying the copy
stops; one that still holds a call is looked at again a minute later. A
copy HOLDS A CALL while its idle file (the one THE HEARTBEAT reads its
journal counts from) says `inFlight` above zero; a file absent or
unreadable says it holds none. A copy stopped is `stopping` until its
process is gone; then it is held no more. A HELD COPY FOUND GONE that
this agent was not stopping (a crash, a kill from outside) is held no
more, and this agent tells the controller at once, a call of
`cernanto/controller` by its id on its `copyExited` with the copy's
agent id, its port, its number, this host and `why` `the process of the
copy is gone`, not awaited by the sweep, a failure said (`the controller
could not be told that <key> is gone: <why>`). THE FOLDERS LEAVE WITH
THE GENERATION: when a generation's order is retired and no record of it
names this host with a live process, its folder under
`<root>/generations` and its copies' own folders under `<home>/copies`
are removed (the file system module's removal, recursive and forced,
which removes a link itself and leaves its target), once per generation;
a removal that fails is said once and tried again at the next sweep.

THE COPIES TO START: every slot record naming this host that this agent
does not hold, unless this host drains or stops, the last heartbeat
failed or is stale, the record says `park`, the record says `draining`
and names no image, or the copy backs off from its failed starts. A
stop word on a record is the word of the launch it names, and a record
whose process is gone is a copy to start whatever stop word it
carries, the new launch's attempt superseding it; this agent's own
record alone ends `serve` by its stop word (THE HOST JOB: SERVE above). A COPY
WITH AN IMAGE, a record naming an image (THE IMAGE above) whose process
is not alive, comes back from its image alone: its folder is prepared
and it is restored (THE RESTORE below, this agent's own act), after a
crash, a move and a wake alike, with its memory and the records since
the image; a restored tree that dies quickly is a failed start as a
started copy's is, counted and backed off the same (THE FAILED STARTS
below). Two such records are left as they stand: one that says `park`
(the copy left on its park word), and one that says `draining` whose
copy left on that word (its entry's `state` is `stopped` under the
attempt the record's process names: a drained copy leaves for good); a
draining copy whose process died or was ended before it left is restored
to finish what it holds and leave on its word. A record whose process is
gone while a pid of this boot stands on it has the tools that copy left
ended before its copy is started again or let go, WHAT ITS LAUNCH LEFT:
the runtime hands every command a copy runs its attempt as
`CERNANTO_PROCESS_GROUP_NONCE=<attempt>` in the command's environment,
and the machine is asked what that launch left, with that word whole,
the pid and the start the record's process names (the empty text for a
record without `started`) and this process's own pid; each number the
machine answers is handed to `process.kill` with `SIGKILL` as it
stands, one that is gone by then being no failure, as it is after the
last resort below. A signal goes to a pid of this boot alone. The launches and the stops of one sweep run at the same time,
each awaited on its own, and a copy keeps the one launch or stop under
way until it ends. A record's copy is started by the block, `<node>
<release>/runtime/process/dist/agent/bin.js --detach <port> <n>`, with
`<release>` the releases folder's `<the record's release>` when the
record's release is another version among the releases installed here
and this release otherwise; the command exits 0 once the copy's process
is started and its pid written on the record, and the copy is held from
then on, this agent saying `holds <agentId> <port>/<n> at epoch <epoch>`.
A launch that fails is a failed start with the command's words, `the
block failed to start the copy` when it said none. THE LAUNCH'S
PATIENCE: a record whose `process` names an attempt this host's launch
wrote without a pid ten seconds after its `at` is launched again; a copy
whose process is alive but whose entry has not appeared five minutes
after the launch is a failed start, stopped by the stop word and
launched again (a launch materializes its generation's folder first,
`npm ci` and the links of a composition among it, minutes under load,
and a copy ended during its materialize leaves a folder that reads as
current and boots nothing).

THE STOP of a copy is THE STOP WORD on its record, `stop: {attempt: the
record's process's attempt, at: the moment}`, written against the
record's revision (a record that moved is read again) and then posted to
the copy as the word `stop`; its runtime leaves on it, marking its entry
stopped; this agent waits THE GRACE, 40000 milliseconds (0 for a copy
stopped under a stale heartbeat), for the process to be gone, a moment
this agent sets; a copy that still holds a call at the grace's end (above;
a copy stopped under a stale heartbeat and one THE HOST'S STOP ends are
ended at the grace) is looked at again a minute later (`the copy <n> of
<generation> still holds a call; looked at again in a minute`, naming
the copy as the other stops do), the stop staying under way;
and then THE LAST RESORT: the process the record names, alive as above,
is sent `kill -TERM <pid>` (for a copy in pid namespaces of its own, the
init under the holder, the first child of the holder's pid, the holder
following it), and when it is still there five seconds later (one look,
at that moment) `kill -KILL <pid>`, and the tools it left are ended
after it, what its launch left as above, the machine asked with the
stopped attempt's word; a process that would not go is said. A stop word stands
on the record until the next launch's attempt supersedes it.

THE FAILED STARTS: a copy this agent launched whose process is gone
before its entry was ever ready or within sixty seconds of becoming
ready died quickly, A LAUNCH THAT DIED BEFORE ANY SWEEP LISTED IT ALIVE
AMONG THEM (its record names the process the block started, by its pid
and identity, read dead by this agent's own reading of them at that
moment: a copy whose fixed port another agent holds ends within a moment
of its start, and such a death is read like any other, from its error
stream; a launch whose record names no process ten seconds after the
launch is let go and started again); the first quick death is forgiven,
and the second quick death following it, with no sixty seconds of
readiness between them, is a failed start, counted from then on. A
PROCESS THAT IS ALIVE IS A RUNNING COPY, whatever its record says or
fails to say: a copy whose entry has not appeared while its process
lives is left alone. A copy that left on the plane's word (the last
lines of its error stream say `fenced` or begin with `draining: the
heartbeat of`, `stop:`, `park:` or `draining:`, or its record is gone or
says `draining` or `park`) left as it should, and counts as no failure.
A failure's words are `the process ended before it was ready` or `the
process ended soon after it was ready`, followed by `; it said: <its
last line>` when it said anything, and this agent says `<agentId> failed
to start <n> times on host <host>: <the words>` at each new count. The
failures ride in the heartbeat as `failed: [{agentId, port, copy,
message, at, starts}]`, `starts` the count, each kept ten minutes after
its last. THE BACKOFF: the next launch of a copy that failed waits the
lease doubled per failure beyond the first, two minutes at most, from
the failure's moment; an agent of the bring-up set and
`cernanto/gateway` are launched again at once.

THE ADOPTION, at the first sweep of this process: every record naming
this host whose process is this host's launch and alive is held as it
runs, counted one start, this agent saying `adopted <agentId> <port>/<n>
at epoch <epoch>`; one whose order is gone or retired is stopped with
the stop word, saying the order is gone; a record naming this host whose
process is not alive is a copy to start. THE ORPHANS, at the same first
sweep: a process on this host that runs a copy of this plane (one of
the processes the machine names as working under `<root>/generations`
with the block's path in their command line, its command line the
block's for a copy, `<the block> <port> <n> <attempt>`; a working
folder tells this plane's copies from another's, and a machine that
tells none names no process) whose pid no record
of this host names and whose attempt
no record names (as its process's `attempt`, its entry's `attempt` or
its `restores`) was left by a host job that died before it ended the copy:
it is sent `kill -TERM <pid>`, on which its runtime drains (the calls it
holds finish and it exits), this agent saying `an orphan copy <port>/<n>
(attempt <attempt>) is ended: no record names it`, and when it is still
there after THE GRACE and holds no call, the last resort ends it (the
init of a copy in namespaces of its own, its holder following it); a
signal that fails is said (`the end of the orphan <key> failed: <why>`).

THE RESTORE'S PREPARATION: for a record naming this host that names an
image and whose process is not alive, and that neither says `park` nor
says `draining` with its copy left on that word (THE COPIES TO START
above), once per tenure (the key and the epoch), run the block with
`--prepare` (`<node> <the block> --prepare <port> <n>`, which lays the
folder out and reserves the restore's attempt on the record), then
remember THE READY WORD for that key and epoch in this process,
`{workingFolder: the generation's folder, folder: the copy's own folder
(made with mode 700), epoch: the record's, at: the moment}`, and run THE
RESTORE below for the copy; a restore refused is said and made again a
minute later, the copy down meanwhile.

A PAUSED COPY: a held copy whose generation's control folder holds its
own word `prepared` (THE COPY'S WORDS below: suffixed by the copy's
number above zero) for more than three minutes with no `resumed` of its
own beside it was left paused by a dump that died between its two
signals: send its init the resume signal (`kill -CONT <pid>`) every half
second for up to a minute until `resumed` appears, saying so. A
`prepared` word younger than that, with no `resumed` beside it, sets the
moment it turns three minutes old, so the sweep that finds it paused
comes.

THE HOST'S WORDS, read every sweep from the control records: the record
`control/<this host>` holding `drain` is THE DRAIN: clear the word, say
`draining: the controller moves the copies here to the other hosts`,
beat with `draining` true from then on for the life of this process,
hold every launch from then on, and let the copies go as their records
move; after ten minutes with copies still held, say so. The record
`control/upgrade/<this host>` holding a version other than this release
(the heartbeat's `version`) is THE UPGRADE: when the version is not the
highest installed here, say once `the upgrade word names <version> while
<highest> is the highest installed here: the launcher starts the
highest, so this host does not move` and clear the word; otherwise say
`upgrading to the release <version>: draining first`, drain as above
until no copy is held but the ones that are this host's by nature (this
generation's own, and the copies of the bring-up set and of every order
that runs a copy on every host, which end with this host's stop and come
back under the new release) or ten minutes passed, then say `the release
<version> is installed; this host ends for its unit to start it again
under the highest installed`, ask the host's stop of itself as `stopAll`
below does with the grace 40000, `serve` answering `upgraded` in place
of `stopped`: this process ends with its call, and its unit starts it
again under the highest release, which boots the set anew. This agent
ends with the upgrade word standing: the controller clears it once this
host's heartbeat is live under the word's version. `stopAll
{grace?}` is THE HOST'S STOP, the block's word (`cernanto-agent --stop`,
which `cernanto dev down` and the unit's stop run) or this agent's own at
its upgrade, answered `{asked: true}` at once with the stop carried out
after it (`{asked: false}` when no `serve` runs here). This agent says
`the host stops: every copy here leaves within its grace`, holds every
launch from then on, and stops every other copy here IN ORDER, each by
THE STOP above (the word on its record, posted to the copy): first every
copy that is not of the bring-up set, then the bring-up set's in the
reverse of its order, the gateway's, the controller's, the trace
agent's, config's and last the warehouse's (`cernanto/packages`), each step once the processes of the steps
before it are gone. THE GRACE is the call's `grace` (40000 when absent)
from the moment of the call, a moment this agent sets: when it has passed,
every record's process still alive is ended by the last resort at once,
whatever step stands; a grace of 0 asks no order and ends every one at
once by `kill -KILL` and what its launch left, with no `kill -TERM` first.
The host's stop takes over the stop of every copy here, one already
under way included (a copy stopped before it, as not wanted, moved or
drained, whether its own grace still runs or it still holds a call and
is being looked at again a minute later): from the host's stop on, such
a copy is looked at again no more, and its process is ended by the
host's grace like every other, at the host's grace's end when its own
grace would run past it, and at once under a grace of 0.
`serve` answers `stopped` as soon as no other copy here runs any more,
the last resort's included.

## The record check

A dump and a restore act on a copy the plane placed on this host and no
other: read the slot record `copies/<port>/<copy>` and refuse `no record
stands for <port>/<copy>` when there is none and `the record of
<port>/<copy> names <host>, not this host` when its host is another; the
record's `epoch` is the holder's epoch the image's meta carries.

## Dump

`dump` takes the port and the copy, and answers the image's meta; the
copy itself asks for it, from its runtime, once its journal has grown
past its bound. The record check first; then THE REFUSALS FINAL FOR THE
COPY'S LIFE, before anything of the process is read: `this copy cannot
take an image: not privileged` when not privileged, `this copy cannot
take an image: no CRIU on this host` when the host image's `criu` is
`none`, `this copy cannot take an image: images are off on this plane`
when this agent's setting `images` stands false (THE HOST JOB'S OWN SETTINGS
above, read at every dump), and
`this copy cannot take an image: an every-host copy keeps none` when the
generation's order, `generations/<port>` (THE RECORDS above), carries
`everyHost` true; then the record's `launch.agentId` is the agent, the
generation's `name` is the id lowered with every character outside
lowercase letters, digits and dash replaced by a dash and `-s<port>`
appended, and the record's `process` must be alive by the identity check
above, refusing `the record of <port>/<copy> names no live process` when
it names none or its process is gone; THE COPY'S PID, the one the
signals and the dump below act on, is the pid of the init of the copy's
pid namespace when it runs in one (as the heartbeat lists it) and the
record's process's pid otherwise; `/proc/<that pid>/cwd`, read as a
link, must be `<root>/generations/<name>`, else refuse `the process
<pid> does not run <name>`. THE IMAGE KEY of the plane is the file
`/etc/cernanto/image.key`, read whole and trimmed; a privileged copy
without the file refuses a dump and a restore by name (`no image key at
/etc/cernanto/image.key`). THE KEY of a copy is `<the agent id with
every character outside letters and digits as _>.<port>.<copy>`; an
ARCHIVE is an object `images/<key>.<n>-e<epoch>-<eight random hex
digits>.img` with a record of the same name, `{name, size, at, meta}`,
`meta` its own meta; `n` is one more than the `n` of the archive the
record's image names, read off that name, and one when the record names
none. The pause's words live in the generation's control folder
`<root>/generations/<name>/control`: `prepared`, `resumed` and `failed`
for the first copy, and for the copy numbered `n` above zero each
suffixed `-c<n>` (`prepared-c1`), as its error stream is named (THE
COPY'S WORDS, the rule for every word of the pause named in this
document). Remove the three, then send the process the prepare signal
(`kill -USR2 <pid>`), and wait up to sixty
seconds for `prepared` (a JSON document naming the journals the process
holds, each call's history and the copy's program journal by its stream,
and the position each stands at), asking again with the signal every
half second meanwhile; a `failed` word there ends the wait with its text
as the refusal, and a process gone ends it with `the process <pid> is
gone`. Read where the process's standard output and error point
(`/proc/<pid>/fd/1` and `/proc/<pid>/fd/2`, read as links): `socket:[n]`
and `pipe:[n]` names are kept as the meta's `stdio`, and each
`socket:[n]` is external to the image as `unix[n]`; a stream that is a
regular file is the copy's own control file (`control/stderr`,
`control/stderr-c<n>` under its generation's folder), dumped and
restored by its path like any file the copy holds, left out of the
meta's `stdio` and of the externals. Dump the tree into a folder of this
operation's own (made fresh under `<home>/dumps` with mode 700, removed
at the end whatever happened) with `criu dump -t <pid> -D <folder>
--leave-running --tcp-close --manage-cgroups=ignore --link-remap -v4 -o
dump.log`, the system mounts external by their cookies (`--external
mnt[/dev]:dev --external mnt[/run]:run`) and each stdio external
(`--external unix[n]`); a dump that exits non-zero is the refusal, with
the command's output and the last error and warning lines of `dump.log`,
and a `criu dump` still running after five minutes is ended (its process
killed), the copy resumed as below, and the dump refused `the dump of
<port>/<copy> ran past five minutes`. THE PROCESS GOES ON THE MOMENT ITS
TREE IS DUMPED: once the `criu dump` command ended, whatever it answered
(and as well when the prepare or its wait failed), send the resume
signal (`kill -CONT <pid>`) to a process still there and wait up to
sixty seconds for `resumed`, asking again with the signal every half
second, before anything is packed or put; the resume's own failure is
said in the answer's words after the dump's. Pack the folder's regular
files with the `tar` command (`tar -cf - -C <folder> <the names,
sorted>` into a file of the operation's own folder), sign the archive
(the hex HMAC-SHA256 over its bytes with the image key), put the file
among the objects under the archive's name (cernanto/objects, the put of
a file) and then write the archive's record `images/<the archive name>`
resting on absence, `{name, size: the archive's bytes, at: the moment,
meta}`, the meta `{version: 1, key, agentId, port, copy, pid, attempt,
checkpoint, at, journals, stdio, bytes, image, holder: {epoch, host},
hostImage, signature}`, `attempt` the record's process attempt at the
dump, the life the image holds, `checkpoint` the archive's `n`, `at` the
moment the operation began, `journals` the prepared word's, `image` the
archive's own name, `bytes` the archive's size, `holder` the record's
epoch and this host, `hostImage` this host's image as the facts tell it.
THE COMMIT: write the record's image, THE IMAGE above, `{image: the
archive's name, journals: the prepared word's, bytes, at: the moment,
attempt, epoch: the record's, hostImage}`, against the record's revision
as read now, the record's other fields kept; a record that names another
host or another epoch by now is left as it stands, and the dump is
refused `the record of <port>/<copy> moved during the dump`. Say `an
image of <agentId> <port>/<copy> stands: <the archive name>, <bytes>
bytes`, answer the meta, and a minute later remove the archive the
record named before this one, its object and its record, best effort.
The image and the journal are one state, kept readable at every step:
before the commit the record names the image before and the copy's
journals stand uncut behind it; after the commit the record names the
new image and the copy, told by the answer or at its next resume, cuts
its journals behind the positions the image names. A dump asked while
another of the same copy runs waits for it and answers its own.

## Restore

THE RESTORE is this agent's own act for a copy with an image (THE COPIES
TO START above), and `restore`, which takes the agent id, the port, the
copy and the generation's `name` and answers `{restored, pid?, image?,
checkpoint?}`, runs the same act when called. The record check first,
then refuse when not privileged. A restore asked while another of the
same copy runs waits for it and answers its own. THE READY WORD: this
agent prepares the generation's working folder for the copy and remembers
the word for the copy's key and epoch (a copy other than this agent's
own); wait up to five minutes for it, refusing `the copy's folder <the
folder> is not prepared for a restore` after. A record that names no
image answers `{restored: false}`: the copy has no image and is started
afresh. The candidate is THE IMAGE the record names, its meta read from
the archive's record `images/<the image's name>` (refusing `the record
images/<image> is gone` when it is gone); VERIFY it, refusing by name
what fails: its `agentId`, `port` and `copy` must be the request's (`the
meta names <a>/<p>/<c>, not <agent>/<port>/<copy>`) and its `key` the
request's key (`the meta's key <k> is not <key>`); its `hostImage` must
match this host's image (`image`, `kernel`, `criu` and `arch` the same,
`the image was made on a different host image` otherwise, and its
`release` this host's own or among the releases installed here, `the
release <r> is not installed on this host` otherwise; a meta without
`hostImage` matches); the archive, fetched into a file of the
operation's own folder (cernanto/objects, the get into a file; `the
archive <image> is gone` when there is none), must be as long as the
meta's `bytes` says (`the archive is <n> bytes, not <bytes>`) and its
HMAC-SHA256 with the image key must equal the meta's `signature`
(compared in constant time). Unpack the archive with `tar -xf <the file>
-C <image folder>` into a fresh image folder under `<home>/restores`,
made with mode 700, remove a stale `resumed` and `failed` of the copy's
own (THE COPY'S WORDS above) from the generation's control folder, open
the files `<folder>/stdout` and `<folder>/stderr` for appending, write
the action script `post-resume.sh` into the image folder (a shell script
that touches the file `tasks-resumed` beside it when
`CRTOOLS_SCRIPT_ACTION` is `post-resume`), bind a private root for the
restore (`mount --bind / <root>` and `mount --make-rprivate <root>`,
`<root>` a fresh directory under `/run/cernanto/restore`, lazily
unmounted and removed once the tree runs or the restore ended), and run
`criu restore -D <image folder> --restore-detached --tcp-close
--manage-cgroups=ignore --link-remap -v4 -o restore.log --action-script
<the script> --pidfile <image folder>/root.pid --root <root>
--inherit-fd fd[1]:<the meta's stdio.out> --inherit-fd fd[2]:<the meta's
stdio.err> --external mnt[dev]:/dev --external mnt[run]:/run`, each
inherit given when the meta names the stream. The command's standard
output and error are two sockets of this process's own, drained into the
two files for as long as they stay open. The tree runs again when
`tasks-resumed` exists and `root.pid` names the root's pid in this
machine's numbering, within sixty seconds; a restore that ends or times
out before that is refused with the last error and warning lines of
`restore.log`. Then THE RESTORED PROCESS'S IDENTITY: read the slot
record again and write on it, against its revision, the record's
`process` with `pid` the root's pid, `started` its start identity and
`boot` this boot's identity (read as the alive check reads them), the
`attempt` the preparation reserved kept as it is and `restores` the
meta's `attempt`, the life the image holds (a meta without one leaves
the preparation's), while the record read again still names this host,
the epoch read at the restore's start and, as its process's `attempt`,
the one the preparation reserved: a record that moved meanwhile (another
host or epoch, or another attempt reserved on it during the restore) is
left as it stands, the restored tree is ended (`kill -KILL` on the root)
and the restore is refused `the record of <port>/<copy> moved during the
restore`; a write refused for a moved revision is read and made again;
before any signal; then send the root the resume signal with `kill -CONT
<pid>` and wait up to sixty seconds for the copy's own `resumed` in the
generation's control folder, asking again every half second; a tree that
does not resume is killed (`kill -KILL <pid>`) and the restore is
refused with the words. Once resumed, say `adopted the tree the host job
restored`, and answer `{restored: true, pid, image, checkpoint}`; the
record's process is the tree's, and this agent holds it under its record.
A refused restore leaves the copy down over the journals cut behind its
image: this agent says `the copy <copy> of <name> cannot be restored from
<image>: <why>` and tries again a minute later, until the restore runs
or an operator removes what stands. The image folder is removed when the
tree runs or the restore is refused.

## Forwarding

`applyForwarding` takes nothing and answers `{applied}`, the targets'
count. Read this host's targets: the record `control/forwarding/<host>`,
a JSON document `{targets, at}` with `targets` a list of `{port,
protocol, addresses}` (no entry, or no targets, means an empty table).
Check every target before anything else, refusing the first that fails
by name: a port is a whole number from 1 to 65535 other than 22 (`port
<n> is never forwarded`), a protocol `tcp` or `udp` (`protocol <p> is
neither tcp nor udp`), a target carries at least one address (`port <n>
has no addresses`), and an address is a dotted IPv4 address other than a
loopback (`127.` or `0.0.0.0`; `<address> is not a forwardable IPv4
address`) and is the `address` of a heartbeat that stands (A HEARTBEAT
STANDS above) under `hosts/`
(every record a JSON document with `address`; `<address> is no live
host's`). Then refuse when not privileged, and when the machine has no
`nft` command (`nftables is not on this machine`). Read beside the
targets the plane's call-port range, this agent's setting `call-ports` (THE
HOST JOB'S OWN SETTINGS above; `{from, to}`, 20000 and 20999 when absent or
not whole numbers), and
the fixed ports the copies of the heartbeats that stand listen on (every `listens`
entry with `fixed` true of every copy under `live` of every such record under
`hosts/`, its `protocol` and `port`), for THE SECOND WALL: an input
chain that admits the loopback, the answers to this server's own
connections, the pings, the plane's call ports and SSH from the private
address ranges alone, every fixed listener port from anywhere, and drops
the rest. Render the fixed table and apply it with `nft -f -`, the text
on its standard input, refusing with nft's words when it exits non-zero.
THE TABLE, exactly:

```
table inet cernanto {}
flush table inet cernanto
table inet cernanto {
  chain input {
    type filter hook input priority 0; policy drop;
    iif lo accept
    ct state established,related accept
    meta l4proto { icmp, ipv6-icmp } accept
    ip saddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 } tcp dport <calls> accept
    ip saddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 } tcp dport 22 accept
<fixed>
  }
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
<rules>
  }
  chain output {
    type nat hook output priority -100; policy accept;
<rules>
  }
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
<masquerade>
  }
}
```

where `<calls>` is the call-port range as `<from>-<to>`, `<fixed>` is
one line per fixed listener port, ` <protocol> dport <port> accept`,
each port once per protocol, sorted by protocol and then by port,
`<rules>` is one line per target, ` fib daddr type local <protocol>
dport <port> dnat ip to <to>`, `<to>` the one address when the target
has one and `numgen inc mod <n> map { 0 : <a0>, 1 : <a1>, ... }` over
the target's addresses in their order when it has several;
`<masquerade>` is ` ip daddr { <every address of every target, sorted,
each once, joined ", "> } masquerade`, left out with no targets; the
lines are joined by newlines, an empty `<fixed>`, `<rules>` or
`<masquerade>` contributing no line, and the text ends with a newline.

## Describe

Called with nothing, `describe` answers `{role: 'the host job',
privileged, host}`, `host` this host's name.

## Tests

`describe` answers the role, whether this copy is privileged and the
host. The copy under test is the compile's candidate beside the host job
that serves, with no `serve` running in its process and no privilege: `dump` and
`restore` are refused by the record check, asked with a port and copy no
record stands for (the restore with a made-up agent id and generation
name); `applyForwarding` is refused by the privilege, once this host's
targets were read; and `start`, `stop`, `park`, `drain`, `drainHost`,
`upgrade` and `stopAll` answer `{asked: false}`. `serve` is the block's
to ring and is left alone. The dump, the restore, the table and `serve`
are proven on the servers by the plane's own lab and on this machine by
its local tier.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1

