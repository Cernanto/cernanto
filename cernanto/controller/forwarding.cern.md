# cernanto/controller/forwarding

Type: module

Decide, for each host of the plane, which fixed ports it forwards to
which holders: every server's address accepts every listener's port,
and a host forwards a port it holds no copy of to the hosts that do.
Read the hosts' heartbeats handed in and answer the targets; every
answer is data.

A HEARTBEAT, as the execution module reads it, is `{host, address,
live, at}` and whatever else it carries: `address` the host's own
private address, `live` the copies the host runs, each `{listens,
form?}` with whatever else it carries, `listens` the copy's listeners,
each `{port, protocol, state, fixed, bound}`. A TARGET is `{port,
protocol, addresses}`: the port, `tcp` or `udp`, and the holders'
addresses, sorted, each once.

`targetsOf` takes `{heartbeats, host}` and answers `{targets}`, the
targets the host named forwards. A listener counts when it is `fixed`,
in the state `accepting` and `bound` on every interface (`any`); a copy
that carries `form` (a tester, or a test form of an agent) is left out
with its listeners; a heartbeat whose address is empty or a loopback
address (`127.` or `::1`) is left out with its copies. A port and
protocol a copy of the host itself accepts is served there and left out,
whoever else holds it. The rest, one target per port and protocol,
sorted by port and then by protocol, the addresses sorted and each once.
The heartbeats handed in are the live hosts' as the caller judged them,
and the answer reads them alone.

`planOf` takes `{heartbeats}` and answers `{hosts: [{host, targets}]}`,
one entry per heartbeat in the order given, each `targets` as
`targetsOf` answers for that host.

## Tests

Pure, over made-up heartbeats, every rule above a case of its own; the
same input answers the same output twice.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
