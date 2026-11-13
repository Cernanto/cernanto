# Running a plane on your own servers

A plane is the running system: one laptop, or one or more Linux servers. On a
laptop `cernanto dev` is the whole of it. This page is the servers: one machine
first, more as capacity asks, each running the Cernanto host, `cernanto-host`
(the host job `cernanto/host`, which does the plane's work on the machine, run
by the release's block), over one store the servers share. The hosts cooperate over the
plane's records in that store: the controller writes what each agent is to run
and places every copy on a host, the host job on each host starts and stops the
copies placed on it, and a dead server's agents come back on another from their
journals and, on Linux, from their checkpoint images, which the host job on each
server takes and restores. The same software runs on a laptop and on the
servers, under the same license, free for production use at any size on your
own machines; what this page adds is the procedure, which is the operator's own
work and fits an afternoon.

Everything here is cloud-agnostic in what the plane needs from a machine: a
hostname, a store it can reach, and a private address the servers reach one
another at. The store has two implementors today: the files and SQLite of one
machine (a laptop, or a single server with the store on its own disk), and
DynamoDB with S3 on AWS, where the plane's records and journals live in
one table and its packages, payloads and images in one bucket, both across
three zones by the store's own nature; a server reaches them through its
instance role, and no credential of the plane's reaches any process.

## The shape

- **A server**: the host (`cernanto-host`) and the copies it starts as
  processes. Services stay resident
  unless the operator lets them park; tasks start on demand and end after
  their idle minutes.
- **More servers**: any number in the same zone, each the same shape, joining
  by writing its heartbeat record; the controller places copies on them by
  their room, and a dead server's copies come back on the others.
- **The store**: DynamoDB and S3 for the servers, the plane's place one url
  every process reads, `dynamodb://<region>/<table>?bucket=<bucket>`. One
  table: a partition key `pk` and a sort key `sk`, both strings, the TTL on the
  attribute `expires`, on-demand billing. One bucket, private, whose
  lifecycle rule expires the objects under `traces/` after eight days (a
  trace record's text above 64 KiB rides the bucket, and the traces are
  kept seven days at most).
  The servers' role may read and write both and nothing else of the account's.
- **The copies' call servers**: every copy opens an HTTP server on a port of
  the plane's own range, 20000 to 20999, bound to the server's private
  address, which the other servers' copies reach and nobody else does; the
  network admits that range among the plane's servers alone, and the host's
  own firewall table admits it from the private ranges alone.
- **The gateway's address**: port 7434 on every server, in plain http. What
  reaches it from outside is a front of your own that terminates TLS, under a
  DNS name of yours (below).

## Before you start

Each server: a supported Linux (the servers we prove on run Debian 13, whose
repository ships CRIU 4.1.1; Ubuntu 24.04 and Amazon Linux 2023 run the plane
too, with checkpoints off because their CRIU is 3.17), x86_64 or arm64, with:

- Node.js 26 or later with npm, to install a release with; the plane itself
  runs on the release's own Node, which the install lays (below).
- The tools the host job uses: `nftables` (the port forwarding and the host's
  own wall), `util-linux` (`unshare`, `setpriv`, `mount`: the agents'
  namespaces and the drop to their user), `procps` (the measurements and
  `kill`), `tar`, `gzip`, `libatomic1` on Debian and Ubuntu (`libatomic` on
  Fedora and Amazon Linux), and `criu` 3.18 or newer
  where the distribution ships one (checkpoints stay off without it, and the
  host says so in its heartbeat).
- The store: a DynamoDB table and an S3 bucket as above, and an instance role
  that may use them (the policy is a dozen actions on the two resources).
- Private network between the servers: TCP 20000 to 20999 (the copies' call
  servers) open among them and from nowhere else, every listener's fixed port
  open among them, the gateway's port 7434 open to your front alone and never
  to the world, and the listener ports you name open to the world that must
  reach them.
- SSH from inside your network alone. The host's own firewall table admits the
  plane's ports, the listeners' ports and SSH from the private address ranges,
  and drops every other new connection to the server from the moment the host
  first applies it: a bastion inside the network reaches port 22, an address
  outside it does not, and your cloud's session manager (SSM on AWS) needs no
  port at all.
- What the local MCP servers of your agents run on. An agent that names a
  local server by its command runs that command as a child of its own
  process, as the agents' user, wherever the plane places it, so the program
  must be on every server; the compile starts it too, to read its tools. A
  server run by `npx` needs nothing more; one run by `uvx` needs `uv` on the
  path; one that reads a repository needs `git`.

## The folders and the user

```sh
useradd --system --uid 1800 --home /var/lib/cernanto/agents --shell /usr/sbin/nologin cernanto
mkdir -p /opt/cernanto/bin /opt/cernanto/releases /etc/cernanto /var/lib/cernanto/agents
chown root:root /var/lib/cernanto
chown -R cernanto:cernanto /var/lib/cernanto/agents
```

Every agent process runs as `cernanto`, one fixed uid on every server, which a
checkpoint image records and a restore needs. The data folder,
`/var/lib/cernanto`, is the host job's home and root's alone: the release's
host job runs there with the launcher's privileges and keeps its own folders,
the plane's secrets and the images it takes. One folder inside it,
`/var/lib/cernanto/agents`, is the agents' user's, the plane's root: the
generations' folders of every other agent and their closure store. Nothing an
agent can write is run or trusted by root.

## The machine file

The one fact a server cannot read off itself is the plane's place: the store
every process of the plane speaks. It stands in `/etc/cernanto/machine.json`,
root's and readable by all, beside the server's private address, which the
copies' call servers bind; the file carries these two facts and nothing else:

```sh
cat > /etc/cernanto/machine.json <<EOF
{ "substrate": "dynamodb://us-east-1/cernanto-plane-prod?bucket=cernanto-plane-prod-123456789012", "address": "$(hostname -I | awk '{ print $1 }')" }
EOF
```

A server without the file runs the files and SQLite store under the plane's
root, a single server's plane on its own disk.

Write the file before you install the release: a server holds the platform's
packages that fit it, the ones of its own store, and the install reads the
store here.

## Install the release

A release is the runtime and the platform's packages at one version. It is
laid under `/opt/cernanto/releases/<version>`, never under a `current` link: a
generation keeps the release it was born with, and a restore maps the same
binaries by path.

The runtime and the cli are two packages on npm, and the platform's agents
are packages of the Cernanto registry, `packages.cernanto.com`, like any
agent's. npm lays the two packages into a folder of the release's own, and
`install-release`, a program of the cli, completes the release:

```sh
V=$(npm view cernanto@latest version)     # the newest release, or the one you name
npm install --prefix /opt/cernanto/npm/$V cernanto@$V @cernanto/runtime@$V
node /opt/cernanto/npm/$V/node_modules/cernanto/dist/install-release.js /opt/cernanto/npm/$V /opt/cernanto/releases/$V
```

It does three things. It pulls the platform's packages: `@cernanto/runtime`
carries the list of them for its version, each named by its digest, and each
package pulled is held to the list. A server pulls the ones that fit it: where
an interface has one implementor per store or per system (the documents, the
objects, the trace reader, the machine), it holds the one of its own store and
its own system and leaves the others out, so the plane binds what is installed
and nothing names an implementor in a setting or a file. It lays the release's own Node: a release
names the Node it runs on, and that very version is taken from nodejs.org,
held to nodejs.org's list of checksums, and laid at `bin/node` of the release
folder with npm beside it, so every server of a plane runs one Node whatever
each machine's own is, which a restore on another server needs. And it lays
the release folder over the install, whole: the folder appears under its name
once everything is in it, and one that stands is left as it is.

The Node you run npm with is a tool of the install and never runs the plane:
any Node 26 or newer does.

The launcher and the chooser come from the release:

```sh
install -m 755 /opt/cernanto/releases/$V/runtime/process/bin/cernanto-host /opt/cernanto/bin/
install -m 755 /opt/cernanto/releases/$V/runtime/process/bin/cernanto-release /opt/cernanto/bin/
```

A server reaches three hosts to install a release and bring a plane up:
npm's registry, the Cernanto registry and nodejs.org. A closed network names
a mirror of each: npm takes its registry from its own configuration, and
`install-release` takes a packages host as its third argument and a source of
Node archives as its fourth (the folder that holds one folder per version, as
`https://nodejs.org/dist` does). Whichever host serves a package, it is held
to the digest the runtime's list names.

`cernanto` is the cli, which you use to reach the plane; the plane puts the
platform's packages onto itself from the release folder. The launcher starts
the host from the highest release installed under `/opt/cernanto/releases`,
the one the chooser beside it, `cernanto-release`, names (the newest packed; a
folder still being laid is never chosen); an upgrade is a new release folder,
below.

Pin the versions: every server of a plane runs the same release, and a host
upgrades to the next one by a new release folder, never by `npm update`.

A server whose machine file changed its store after a release was installed
holds the other store's packages: run `install-release` again, which pulls the
ones that fit, before the host starts. A plane that finds one installed for
another store says so in words at its first call and binds nothing.

## The image key

A copy's checkpoint image is signed with the plane's image key, one secret
every server shares: the file `/etc/cernanto/image.key`, root's alone. A
privileged host without it refuses every dump and restore by name (`no image
key at /etc/cernanto/image.key`) and keeps the journals alone. Make the key
once, on the first server, and lay the same file on every server after it:

```sh
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /etc/cernanto/image.key
chmod 600 /etc/cernanto/image.key
```

## The kernel's settings

```sh
cat > /etc/sysctl.d/90-cernanto.conf <<EOF
kernel.io_uring_disabled = 2
net.ipv4.ip_forward = 1
net.ipv4.conf.all.route_localnet = 1
net.ipv4.ip_local_reserved_ports = 20000-20999
EOF
sysctl --system
```

io_uring off, since Node's event loop opens rings CRIU cannot dump; IP
forwarding on, since the kernel forwards a listener's connections to the
holder; the plane's call ports reserved, so the system never hands one of them
to an outbound connection as its source.

## Reaching the gateway from outside

The gateway speaks plain http on port 7434, on every server, and nothing of
the plane terminates TLS. Put in front of it what you already use for that: a
load balancer of your cloud under a certificate of your own name, or a reverse
proxy. Your laptops and pipelines reach the plane there, by its https address.
A plane nobody reaches from outside needs none: its operator works at a
server's own terminal, or through a tunnel to it.

Three rules hold for whatever stands in front:

- It comes to the gateway at a server's private address, never at the
  loopback. A request made on the server itself, at `127.0.0.1:7434`, is the
  operator's with no token, which is how you work at the server's own
  terminal; every other request carries an operator token. The gateway takes a
  request for the server's own only when it also names a loopback host and
  carries no mark of having been passed on (`Forwarded`, `X-Forwarded-For`):
  a front that sets those is held to its token wherever it comes from, and
  one that sets none must come by the private address.
- Port 7434 is open to the front alone and never to the world: an operator
  token would travel in clear.
- The gateway holds a request for as long as its call runs, and a stream for
  hours. Every listener of the plane keeps its connections alive by TCP, a
  probe a minute, which a front that passes connections on (a network load
  balancer) counts as life. A front that counts a request's bytes alone (an
  application load balancer, a reverse proxy) is given an idle time to match,
  or it ends a quiet call.

One check tells you the front is right. From outside,
`curl -s -o /dev/null -w '%{http_code}\n' https://plane.example.com/v1/ls`
answers `401`, and the same request with the header `Authorization: Bearer
<the operator token>` answers `200`.

## The host, on every server

Nothing else is written for the host: it takes no argument and reads no
file but the machine file. The host's name is the machine's hostname, and so
does every agent it starts.

```sh
install -m 644 $T/cernanto-host.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cernanto-host
```

The lease on a copy is thirty seconds, the plane measures each copy's memory and
never limits it, and the checkpoints and the forwarding follow CRIU's and nftables'
presence; services stay resident until the operator lets them park
(`cernanto config cernanto/controller/reconcile park-services=true`, and the
autoscaler's `cernanto/controller/autoscaler/park-services` with it), and every copy with a
journal (a service, a task's long call, a worker's run) bounds it by images
of its own process where CRIU is (`cernanto/host/images`, on where CRIU is): at
a hundred entries once the copy is at rest, at five hundred whatever it does,
the copy asks the host job for its image and cuts its journal behind it, and
a copy with an image is restored from it wherever its process is found gone.
The host is the release's block, `cernanto-agent`, the one command that
materializes a package and runs it, running the host job, `cernanto/host`, the
release's own package of that name, with its privileges kept on every server.
The host job does the plane's work on the machine: it beats the host's heartbeat,
starts every copy the plane places on the server by the same command (the
controller's among them, at a fresh plane) and stops it by a word on its record,
dumps a service's process into its checkpoint image with CRIU, restores one from
its image, and applies the firewall table, the forwarding and the wall together,
each asked by the plane's controller of the copy on that very server. The host
runs as root, as every program that runs other users' processes does; every
agent process but the host job runs as `cernanto` with no capability, a service
in a pid and mount namespace of its own where CRIU is. The unit's stop says one
word on the plane (`cernanto-host --stop`): the host job stops every copy on the
host in order, the platform's own agents last and the package warehouse the very last, so
each serves the ones leaving before it; it ends what is still there when the
grace is over, and exits as soon as nothing is left. A host that crashes comes
back by its unit, which the journal records.

## The first start

At a fresh plane the first host's host job writes the orders and its own records of
the platform's first processes (the warehouse, the configuration, the trace
agent, the controller), and starts them; the controller places the gateway;
once the gateway answers, the controller puts the release's packages onto the
plane, with no compile. A cold start takes a minute or two. The host job writes no
setting but two defaults a plane cannot start without choosing (the engine that
answers a prompt and the one that decides, both the plane's coder until you
bind others, below): the configuration holds what you set, and everything a
process knows of itself (its release, its machine, its store) it finds itself.
Then:

```sh
journalctl -u cernanto-host -f                           # the host's words: the host job writes no traces, its log is here
cat /var/lib/cernanto/secrets/operator-token              # the plane's operator token, minted once
```

Those two run on the server, as root. The rest run on your own machine, where
the cli is installed (`npm install -g cernanto`), with the token the server
printed:

```sh
cernanto login https://plane.example.com --token <the operator token> --name prod
cernanto ls
cernanto call cernanto/controller nodes                   # the hosts and their pressure
```

The plane is up when `cernanto ls` lists the platform's agents ready and the
nodes answer shows every host live. Bind the plane's coder (below), and deploy
your agents with `cernanto deploy` from their workspace.

## The engines and their keys

A server has no machine login, so the plane's AI is bound and keyed by hand,
each engine a setting under the agent that reads it: which implementor serves an
interface is the interface's own setting, `<the interface id>/default`, and a key
is a setting of its engine like any other. The
whole configuration is secret: no trace on the plane carries a setting, and
a write echoes the key alone. The verb takes the agent first, then a name
to read it or `name=value` to write it, and `name=null` removes it.

```sh
cernanto config cernanto/harness/codex api-key=<api key>         # or cernanto/harness/claude-code
cernanto config cernanto/harness/codex mode=api-key              # plan is a laptop's mode
cernanto config cernanto/harness default=cernanto/harness/codex  # the coder: compiles, and every judgment by default

cernanto config cernanto/llm-prompt/openai token=<api key>       # values and decisions on an OpenAI-compatible endpoint instead
cernanto config cernanto/llm-prompt/openai endpoint=<chat-completions url>
cernanto config cernanto/llm-prompt/openai model=<model>
cernanto config cernanto/llm-prompt default=cernanto/llm-prompt/openai

cernanto config cernanto/decision/jev token=<api key>            # decisions on Jev instead
cernanto config cernanto/decision default=cernanto/decision/jev

cernanto config cernanto/harness                                 # an interface's default beside its settings
cernanto config                                                  # every agent's settings on the plane
```

The host job writes the prompt and decision defaults at a fresh plane's start,
`cernanto/llm-prompt/harness` and `cernanto/decision/llm`, so a plane with a
coder bound answers every judgment on it; the harness binding is yours to set.
A binding takes effect on the next call, with no restart, and a call of the
interface by its id (`cernanto call cernanto/decision decideIf ...`) goes to its
default.

The gateway's address is two settings of its own, `cernanto/gateway/host` and
`cernanto/gateway/port`, unset on a plane you install: it listens on every
address at 7434. They are set like any setting and read by the gateway at its
start. Move the port only with what points at it: your front comes to 7434,
and the cli looks for a plane on its own machine there.

## What to expect

- **A server dies**: within a lease its heartbeat lapses, the controller's next
  pass places its copies on the other servers, and the agents come back from
  their journals, or from their checkpoint images where the host job took them,
  with their memory. A plane of one server is down until the server is back or
  replaced; the store, in three zones, loses nothing.
- **An agent's fixed port**: one agent across the plane; every server's address
  accepts it and forwards to the holder.
- **A long-lived service**: its journal is cut behind each image, so its replay
  at a restore is bounded. Without CRIU it replays its whole journal, correct and
  slower.

## Upgrading

Lay the next release beside the running one on every server (the `npm install`
and the `install-release` of the new version, under its own folders), then
name it to the plane:

```sh
cernanto cluster upgrade <version>
```

Each host, one at a time by a token, drains and ends; its unit starts the
launcher, which runs the highest version installed under the releases folder,
so a word naming a lower version is refused by every host. A generation keeps the
release it was born with, so a service's checkpoint images restore on the
binaries they were taken under, and a new generation takes the new release.
Nothing rolls to the new version while a host still runs the one before, so a
host draining for its turn keeps the room the others need: once every host runs
the new version, the controller lands the release's packages and the platform's
generations roll to it; when the packages bring a new controller, that
controller lands them once more before the release counts as landed, so a
release is always landed by its own rules.
`cernanto cluster drain <host>` drains one host for the others to take its
copies, before you take the machine down.

## Installing again over a previous plane

A plane installed again on servers that ran one is wiped as a whole first:
every host stopped, and the store emptied (the table's items, the bucket's
objects) before any host starts again. A fresh plane over a stale store would
read the old records as its own and never serve.

## The same, automated

Nobody installs a fleet by hand twice. The steps above are what a configuration
management role or a first-boot script performs per server: the packages, the
launcher with its chooser, the image key, the machine file, the sysctl, the
unit. Our own automation for one cloud is ours and not
published; a reference role is a later deliverable, driven by the operators who
ask for it.

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License,
Version 2.0.
