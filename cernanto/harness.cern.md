# Harness

Type: interface

An interface: the coding tools, the one surface every AI vendor agent
implements: evaluating a single prompt and driving an interactive
coding session. The implementor that serves a consumer which names
none is the one the plane binds, `cernanto/harness/default`: on a
box `cernanto dev` writes it after its login discovery, on a server
the operator does, and the compile binds by name the vendor its
request names when it names one. Every implementor resolves its own
credential inside its own call, by its own settings (its mode): on
the box the machine's own login used exactly where it lies, on a
server a key among the plane's secret settings. A vendor whose own
words say it has no usable login fails the turn terminal, quoting the
first line of what it said and naming exactly what heals it. A login
is the machine's own, made where the vendor runs.

`oneShot` evaluates one prompt and answers the reply with its
accounting. It takes the `prompt`; optionally: `web` (the reasoning
may consult the web; every other tool stays off), `responseJsonSchema`
(the reply must satisfy it and the parsed value arrives in
`structured` beside the text; a vendor with a native
structured-output mechanism is asked through it), `model` and
`effort` (names the vendor
understands; unnamed, the vendor's own account defaults serve), and
`maxTurns` (the turn budget for a web-enabled evaluation), and
`attachments`, pictures and documents the model sees beside the
prompt, each a `contentType` (image/png, image/jpeg, image/gif,
image/webp or application/pdf), its `bytes` and an optional `label`:
the vendor shows them to the model before the prompt's text, in the
given order, each introduced by its number and label, and refuses in
words a content type it cannot show. It answers
the reply `text`; `structured` when a schema was asked and honored;
`truncated`, true when the reply stopped before the model finished
(the text then a fragment); `usage` with `units` (total tokens) and
the vendor-reported `inputTokens` and `outputTokens`; `costUsd` when
the vendor prices the turn; and `model`, the model that served as the
vendor reports it, the served name where an alias was asked.

`openSession` opens an interactive coding session inside a workspace
directory on this machine and runs its first turn; `resumeSession`
continues a recorded session with one more turn. An open carries
`workspacePath`, `initialPrompt`, and optionally `doctrine` (text that
becomes part of the session's standing instructions for its whole
life), `model`, `effort`, `turnTimeoutMs` (how long one turn may run
before it is aborted), and `grantedMcpServers` (the mcp servers whose
tools the session's policy admits). A resume carries `sessionId`,
`workspacePath`, `input`, and the same options. A session that names
no model or effort runs on the vendor's own defaults for the account.
Three more options serve a judge's session, carried by an open and a
resume alike: `readOnly` (true: a reading session, its
policy denying every write anywhere, its shell the read-only toolbox,
sub-agents off, the web off unless `web` asks for it; a verdict is
read off its final text), `web` (true: the session may consult the web,
exactly web search and fetch on, for a judgment whose answer lives in
a provider's documentation; every other rule of the read-only session
holds) and `maxToolCalls` (how many tool calls one turn may make
before it is aborted, a search or a fetch counted like any call; a
turn that outruns it fails terminal saying the judge's budget of tool
calls is spent). A turn answers the `sessionId`
(reusable for a resume), `status` (`completed`, or `failed` when the
vendor said so), `finalText` (the coder's last words), usage and cost
as in a one-shot, and `model`, `reasoningTokens` and `cli` (the
version of the vendor tool that served the turn) when the vendor
reports them. A turn that outruns `turnTimeoutMs` is aborted and
fails terminal saying the harness did not finish its work in time.
Everything a session does is narrated on the console as it happens,
one line per thing, every line whole, each stamped with the seconds
since the turn began (`+12.2s`), so the compile's screen and the
trace read the coder's work live.

Every turn, one-shot and session alike, runs live, the vendor tool a
child of the implementor's own process, and a turn that dies with the
process is run again by the caller. A transient vendor failure is
retried inside the turn; a terminal one (a dead login, a vendor
refusal) fails at once in the vendor's own words. Every session turn
ends with the call that owns it; deadlines and tool budgets are the
vendor's ordinary policies.

## Tests

The implementor's vendor is provisioned on this plane and must run:
prove `oneShot` live with one real turn, and with one more carrying
a picture the implementor's own Tests section says how the tests
draw, whose answer is what the picture shows. An error of any kind, a CLI
or endpoint that fails to launch included, is a test failure.
Sessions are proven by the plane's own compiles.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
