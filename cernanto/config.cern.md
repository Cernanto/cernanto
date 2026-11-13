# cernanto/config

Uses: cernanto/documents

Keep the plane's configuration: every setting under the place of the
agent that reads it, written by the operator and read by that agent by
its bare name, and each interface's default implementor. Values are
plain JSON; the credentials of accounts belong to cernanto/auth, and
the keys the plane's own engines need are settings here like any
other. THE WHOLE CONFIGURATION IS SECRET: every ask's parameters and
answer carry the os module's `Secret` mark, a token and a channel name
alike, so no trace at either end carries a key, a value or a listing.

## The key

A key is `<place>/<name>`: a place, then a slash, then the name of one
setting. A place is an agent's id, a linked module's id, or an agent's
id followed by `/tests` for its tester; a name is one segment. The
whole key matches the agent path rule of the plane, lowercase words
joined by hyphens and segments joined by slashes,
`^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$`, with at
least two segments: `cernanto/trace/retention-minutes`,
`cernanto/harness/codex/api-key`, `workflows/helpdesk/bot/channel`,
`connectors/jira/tests/project`. A key is split at its last slash into
its place and its name. A key that is not of this shape (one segment
alone, a dot, an uppercase letter, an empty segment) is refused in
words naming the shape, `<agent id>/<name>`. A name carries no
structure; what has parts is a value with fields. The one reserved
name is `default` (THE DEFAULTS below).

## The place of a caller

An agent never spells its place: the place of a calling agent is its
id as the kernel states it on the call, exact, a linked module's its
own id. The two verification forms are the one exception, and the
kernel states the agent they stand for beside the caller: a caller
whose id is that agent is its test form and reads that agent's place,
so a live verify proves the agent as deployed, with the values the
real agent reads; any other caller the kernel states a target for is the tester, and its
place is `<the target's id>/tests`, where the operator sets the fixtures
a tester needs (`connectors/jira/tests/project`); a tester reads that
place alone, and nothing the operator set for the agent it tests.

## The records

Reach the plane's records through cernanto/documents, bound with no
name, so the plane binds its implementor. A failure of the documents to
answer is a retryable failure in its words. Read the records fresh on
every ask.

One record per setting: THE SETTING at a key is the record
`config/setting/<the key>`
(`config/setting/cernanto/trace/retention-minutes`,
`config/setting/cernanto/harness/codex/api-key`), its string the
value's JSON text, written through this agent alone. A record that does
not exist is a setting that does not stand; one whose string is not
JSON fails the ask naming the record. Write a record by compare-and-set
against exactly what was read, up to about twenty rounds, then fail
retryable naming the record; removing a setting removes its record,
against what was read. A value that serializes past 65536 bytes is
refused naming the cap. A name spelled `__proto__`, `constructor` or
`prototype` is refused in words. A read of a key answers its setting,
or null when none stands.

THE SETTINGS OF A PLACE are the records one listing of the prefix
`config/setting/<the place>/` answers whose key carries one more
segment and no other, the name: a key with a further slash
(`config/setting/cernanto/harness/codex/api-key` under
`config/setting/cernanto/harness/`) is a deeper place's and is left
out. EVERY PLACE'S SETTINGS are one listing of `config/setting/`, each
key split at its last slash into its place and its name. Every place
that has a setting is in that mapping whatever word its id is, an agent
named `constructor` like any other: an id is a key of the mapping, and
never a word the mapping carries of its own.

THE STARTER'S SETTINGS. A plane started with a machine file of its own
may name settings before any agent serves, and the block lays them in
every copy's mark. Before every ask is answered, read the mark, the
file `materialized.json` in this copy's working folder, with the file
system's own read, and take the `settings` entry of its `machine`
object (`machine.settings`), a mapping from a key to its value. A mark
that cannot be read, or that names no settings (every plane an operator
runs), is the end of it: nothing more is read. Otherwise write each
entry into its own record as the operator's `setAt` would, and leave an
entry whose value already stands equal (compared as JSON text) as it
is, so an ask on a plane whose settings stand writes nothing. An entry whose
key is not of the key's shape is passed over. They are settings, read
and listed like any other, and the starter's file is the word for the
keys it names: an operator's write of one is put back at the next ask.

## The defaults

An interface is an agent with one setting, `default`: the implementor a
consumer gets when it names none. It is a setting like any other, the
record `config/setting/<the interface id>/default`, a JSON string
holding the implementor's id. Two write it: the host job seeds
the platform's defaults at a fresh plane's bring-up, each by a write
resting on absence, and the operator sets, changes and removes them
(`cernanto config cernanto/decision default=cernanto/decision/jev`).
`defaultOf` takes
`interfaceId` and answers `value`, the default's id or null; any caller
may ask it, since which implementor serves an interface is a fact of the
plane and no secret.

## The agent's road

An agent reads its own settings by their bare names, and reads nothing
else: `setting` takes `name` and answers `value`, the value at
`<the caller's place>/<name>`, null when none stands; `settings` takes
`names`, a list, and answers `values`, a mapping from each name to its
value, each name's record read once for the whole ask, a name repeated
answered once. A
name with a slash or a dot is refused in words: "a setting is one word
under your agent; another agent's value comes through its function".
An agent writes nothing: the configuration is the operator's to write,
and an agent's own durable state is its records. The agent's two
functions refuse the operator's ask (one with no calling agent) in
words naming the operator's road.

## The operator's road

THE OPERATOR is an ask with no calling agent, or one whose calling agent
is `cernanto/gateway`, which speaks for the operator. The operator speaks full
keys through functions of its own, refused to any other calling agent in
plain words naming the agent's road:

- `getAt` takes `path`, a key, and answers `value`: the setting at the
  key, or null.
- `setAt` takes `path`, a key, and `value`, any JSON; a null or absent
  value removes the setting; answer `value`, what now stands at the
  key, null when the setting is gone.
- `listAt` takes an optional `place` and answers `configuration`. With
  a place, THE SETTINGS OF A PLACE as one mapping from names to values,
  its `default` among them, empty when nothing stands. Without one,
  EVERY PLACE'S SETTINGS, as a mapping from each place that has a
  setting to its mapping: the map of the fleet.

## The runtime's seam

The hand-written runtime binds an interface's implementor for a consumer
that names none by asking `defaultOf` with one argument, the interface's
id, and reads `value` off the answer; and it reads the trace retention
off the record `config/setting/cernanto/trace/retention-minutes`, a
JSON number: that parameter, that field and that record are a contract
the runtime speaks by hand, kept as they are. The host job reads its
own two settings the same way, off their records.

## Tests

The live plane's configuration is the operator's truth and stays as it
is; the tests write nothing. The tests' own place is this agent's
tester's, `cernanto/config/tests`, where the operator sets one fixture
on every plane the tests run on, `probe`, any JSON (`cernanto config
cernanto/config/tests probe=ok`). They prove: `setting` of `probe`
answers what the operator set there, and `settings` of `probe` beside a
name nothing stands under answers the one and null for the other; a
name with a slash or a dot is refused in words; `defaultOf` of
`cernanto/llm-prompt` answers a string, the default the host job seeds on
every plane; `getAt`, `setAt` and `listAt` refuse an agent caller in
plain words.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
