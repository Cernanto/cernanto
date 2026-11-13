# cernanto/compile/lanes

Type: module

Uses:

- cernanto/auth
- cernanto/compile/grammar
- cernanto/machine
- npm:@hey-api/openapi-ts
- npm:typescript
- npm:yaml
- npm:fs-extra
- npm:cross-spawn

Read the two outside lanes a spec grants, mcp and openapi, for the
compiler, and generate the typed modules a consumer's workspace holds
for them. An mcp grant names its SERVER: a remote one by its url, a
local one by the command that runs it (the grammar module tells them
apart by its remote url rule and reads a command by its command
rule). For a remote server, list the server's tools over the
protocol, reading the account the agent under compile holds for the
server when the server refuses an anonymous listing and signing the
agent in on its behalf when it holds none; for a local server, start
the command and list the tools over the child's stdin and stdout;
either way pin the listing's schema hash. For an openapi grant, fetch
the document, json or yaml, hash the raw bytes served and elaborate
the document into TypeScript types with the pinned type engine. From
either, generate, model-free, the typed module a consumer's workspace
holds for the grant: one function per tool or operation carrying its
binding as a literal, its docs from the listing or the document, and
the module names the grant derives (the server's host or its
command's package, the document's title). For an agent that
implements an openapi document, render the contract it is held to and
the server code it serves the document with. The listings and the
documents are reads; the compiler pins what it saw, and every
generated text is deterministic for its inputs. A local server's
command carries values in its environment words, so the words of a
failure and the header of a generated module name a local server by
THE COMMAND'S LABEL (`mcpCommandLabel`, which takes the command and
answers it): its program and arguments alone, each word as it is, or
as its json string when it is empty or holds whitespace, a quote or a
backslash, joined by single spaces; `the command` when it names no
program.

## The mcp listing

`listMcpTools` takes the server (a url, or a local server's command),
the account and a listing given. A local server's listing is below,
'The local listing'; a remote server's is this section's. For a
remote server the protocol is JSON-RPC 2.0 over the streamable HTTP
transport, spoken with plain fetch: one fresh session per listing.
Every message is a POST of a json body `{"jsonrpc": "2.0", ...}` to
the server url with the headers `accept: application/json,
text/event-stream` and `content-type: application/json`, plus
`authorization: Bearer <token>` when a bearer is in hand,
`mcp-session-id: <id>` once the server minted one (the value of the
`mcp-session-id` response header of any earlier answer) and
`mcp-protocol-version: <version>` once the handshake settled one;
each request has a budget of 120 seconds for the whole exchange, body
read included. A request carries a numeric `id` counting from 1 per
session, a `method` and, when there are any, `params`; a
notification carries only `method`. The session opens with the
request `initialize` and the params `{"protocolVersion":
"2025-06-18", "capabilities": {}, "clientInfo": {"name": "cernanto",
"version": "0.0.0"}}`: the version the server answers in its result's
`protocolVersion` (a string) is the session's, else the proposed one;
the result's `instructions`, a non-blank string when the server
publishes usage instructions, is kept; then the notification
`notifications/initialized` is sent and its answer's body, if any, is
read and dropped. The tools are then read with the request
`tools/list`, `{}` the first time and `{"cursor": <the previous
answer's nextCursor>}` while the answer carries a non-empty string
`nextCursor`, each answer's `tools` array (absent reads empty)
appended in order. When the server minted a session, a DELETE of the
url with the same headers ends it, within five seconds, its outcome
ignored whether it succeeds, fails or is refused; a server that keeps
no sessions gets no DELETE.

An answer is read as json when its `content-type` does not say
`text/event-stream`: the body parsed, and the response with the
request's `id` found in it (a batch array is searched; an object is
the response when its `id` matches and it carries `result` or
`error`); a body that is not json, or one without the response, is a
retryable failure in words (`<url> answered a body that is not json:
<the first 200 characters>`, `<url> answered without responding to
request <id>`). An event-stream answer is read event by event: line
ends normalized (`\r\n` and a lone `\r` read as `\n`, a trailing `\r`
held back until its `\n` arrives), events split at blank lines, each
event's data the `data:` lines' values joined by newlines (one
leading space after the colon removed; an event with no data line is
skipped), each data parsed as json and searched for the response the
same way; the first response found ends the read and the rest of the
stream is let go (the reader cancelled), and a stream that ends
without it is a retryable failure (`<url> closed the stream before
answering request <id>`; an absent body, `<url> answered an empty
event stream`). A non-2xx transport answer is a failure carrying the
status, the body's first 300 characters and the `retry-after` header
in seconds when it is a positive number, worded `<url> answered
<status>` followed by `: <the body's first 300 characters>` when the
body is not empty; a json-rpc `error` in a response is a refusal
worded `<method> was refused (<code>): <message>`. A failure
classifies: the server demanding authentication (a transport status
401 or 403, or the failure's words containing, in any letter case,
`401`, `unauthorized`, `invalid_token` or `invalid access token`) is
an AUTH refusal; a json-rpc refusal is terminal in its own words; a
transport failure with status 408, 425, 429 or 500 and above is
retryable (`could not reach MCP server <url>: <the failure's words>`,
the retry-after kept), any other status terminal in the failure's
words; anything else that reached the wire and failed is retryable
worded the same `could not reach MCP server <url>: ...` way.

Each listed tool is kept to the fields the listing carries: `name` (a
tool without a non-empty string name is terminal: `<the url, or the
command's label> listed a tool without a name`), `title` and
`description` when strings, `inputSchema` when an object (else
`{"type": "object"}`), `outputSchema` when an object, and
`annotations` reduced to exactly the hints the server set among
`title` (a string) and the booleans `readOnlyHint`,
`destructiveHint`, `idempotentHint` and `openWorldHint`, absent
altogether when it set none. The SCHEMA HASH the compiler pins is the
sha256 hex digest of the tools sorted by name (plain string order)
and serialized canonically: object keys sorted, arrays in order,
`undefined` and non-finite numbers written as `null`, strings,
booleans and finite numbers as json, no whitespace (every deployed
lockfile pins this hash, so the serialization is fixed). A LISTING
GIVEN (`listing`: `{tools, instructions?}` as a package carries it)
opens no session, starts no command and sends nothing: its tools are
kept to the fields above exactly as listed ones are, its instructions
likewise, the schema hash is computed over them the same way, and
that is the whole listing road for it, for a remote server and a
local one alike.

The listing is tried anonymously first. A failure that is not an
auth refusal fails the listing at once, in the classified words. On
an auth refusal, when the caller named the agent under compile (the
input's `account`: the agent's id, and the server url's host as the
account's name), the agent's account for the server is read through
the granted auth agent on the agent's behalf (its value, read by the
agent and the name); the bearer is the `access_token` string inside
a stored json payload, else the stored value itself. With a bearer
the listing is tried once more with `authorization: Bearer <the
bearer>`. With nothing stored, or when the second try is refused
again, THE SIGN-IN runs on the agent's behalf, the same dance the
generated module runs at run time (below, 'The ladders'): the
server's authorization server is discovered from the refusal's
`www-authenticate` resource metadata url when it named one (the
resource metadata's first `authorization_servers` entry names the
authorization server; a resource metadata that names no
`authorization_servers` entry, like no resource metadata at all,
leaves the server's own origin as the authorization server, whose
endpoints are then read from the origin's well-known documents; a
metadata read that cannot reach its host is a retryable failure,
`could not reach <url>: <the failure's words>`, and one that answers
anything but a json object is no document), a state
is pinned and a client registered: through the authorization server's
registration endpoint when it publishes one (the registration
`client_name` `cernanto`, the redirect url, the grant types
`authorization_code` and `refresh_token`, the response type `code`,
`token_endpoint_auth_method` `none`; a refusal is terminal, `the
authorization server of <host> refused the client registration
(<status>): <the body's first 300 characters>`, a body that is not json
`the authorization server of <host> answered a registration that is not
json: <the first 200 characters>`, an answer with no `client_id` `the
authorization server of <host> registered no client_id`), else asked of
the operator under the agent's account for the server (the provider
`<host>`, the instructions `1. Open the developer console of <host> and
sign in.`, `2. Register an oauth client whose redirect url is <the
redirect url>.` and `3. Paste its client id and, when it has one, its
client secret below.` on three lines, the fields `clientId` labelled
`Client id` and `clientSecret` labelled `Client secret`, a secret, the
help page `https://<host>`; an empty client id fails terminal, `no
oauth client id was given for <host>`), the authorization ask is
opened under the agent's account (the ask names the agent as the
account's owner, as the pin did, and carries the pinned state and the
PKCE verifier) and this call holds in the safe until
the operator's browser lands at the plane, the code is exchanged (the
token endpoint posted the form; a refusal is terminal, `the
authorization server of <host> refused the code exchange (<status>):
<the first 300 characters>`, a body that is not json `the authorization
server of <host> answered tokens that are not json: <the first 200
characters>`, tokens with no `access_token` `the authorization server
of <host> answered no access_token`) and the tokens stored under the
agent's account exactly as the generated module stores them at run time, so
the run-time refresh reads what this sign-in kept: the kind
`oauth-mcp`, the value the token payload with `client` (the
registered or given `client_id` and `client_secret`) and `server`
(the authorization server's url as `authorizationServerUrl`, its
metadata document as `metadata`, the resource indicator as `resource`
and the advertised scope as `scope`) beside it. A server that
publishes no authorization server asks the operator for a pasted
token in place of the dance: the provider `<host>`, the instructions
`1. Open <host> and sign in.`, `2. Create an access token for its MCP
server at <url>.` and `3. Paste the token below.` on three lines, the
one field `token` labelled `Access token`, a secret, the help page
`https://<host>`, the account `{agent, name: <host>}` carrying the
refusal's words as `refused` when a stored bearer was refused; an empty
answer fails terminal, `no token was given for <url>`; the token is
stored under the kind `api-key`. Then the listing is tried with
the fresh bearer, and a refusal then fails in its classified words. A
refusal with no agent named fails in the classified words, `<url>
demands a sign-in`. The sign-in's network steps are plain reads and
posts, each given 120 seconds (`<url> did not answer within 120
seconds`).

## The local listing

A local server's listing starts its command and speaks the protocol's
stdio transport with it; it reads no account and signs nothing in.
THE COMMAND is read by the grammar module's command rule; a command
the rule reads nothing in fails terminal, `an mcp command names no
program`. THE CHILD is the program started with `cross-spawn`, as the
runtime starts a local server: the program found on the child's `PATH`
the way the system finds one, a Windows command shim (`npx.cmd`) run
through its command interpreter with every argument escaped, and no
shell anywhere else; its arguments exactly as the rule read them, in
this process's own working folder, its stdin, stdout and stderr
piped. ITS ENVIRONMENT: the machine's child environment basics
(through the machine interface, bound with no name, the implementor
the plane binds); the folder of the node the plane runs on, as the
same machine answers it, when it answers one, first on the
`PATH`, before the basics' own value, joined by the path module's
delimiter, so a package runner finds the plane's own node; the
`HOME`, when the basics name one this process cannot write, replaced
by the folder `.mcp-home` of the working folder (made when missing),
where a package runner keeps its cache; and the command's environment
words over all of it.

THE WIRE: every message is one line of json, `{"jsonrpc": "2.0",
...}` serialized with no line break inside it, written to the child's
stdin and ended by `\n`; the child's stdin has a listener for its
errors from the start, so a write to a stdin the child already closed
(a child that left at its start) is let go and the child's end says
why it left; every line the child writes on its stdout is one message
(a trailing `\r` dropped, a blank line skipped), and a line that is
not json fails the listing terminal, `<the label> wrote a line that
is not json: <the line's first 200 characters>` (the protocol gives
stdout to its messages alone); the child's stderr is read line by
line, the last twenty lines kept for a failure's words. A request
carries a numeric `id` counting from 1, a `method` and, when there
are any, `params`; a notification carries only `method`; the response
to a request is the message with its `id` and a `result` or an
`error`. A request the child itself sends (a message with a `method`
and an `id`) is answered on its stdin: a `ping` with `{"jsonrpc":
"2.0", "id": <its id>, "result": {}}`, anything else with `{"jsonrpc":
"2.0", "id": <its id>, "error": {"code": -32601, "message": "this
client serves no <method>"}}`; a notification of the child's is
skipped. THE HANDSHAKE AND THE TOOLS are the remote listing's to the
letter: `initialize` with the same params, the version and the
instructions kept the same way, `notifications/initialized` sent,
then `tools/list` page by page, each tool kept and the schema hash
computed as above.

THE BUDGET is 120 seconds for the whole listing, counted from the
start, a first download of the server's package included; a listing
not done by then fails terminal, `<the label> answered nothing within
120 seconds`. THE END, once the tools are read or the listing failed:
the child's stdin is closed and it has five seconds to leave, then it
is killed; what it left behind ends with the call, as every command of
the compile does. A CHILD THAT CANNOT BE STARTED fails terminal: `<program> does not
exist on this host` when the program names a path (a slash or a
backslash in it) and nothing is there, `<program> is not on this
host's PATH` when it names a bare program nothing finds, `<program>
cannot be run on this host: EACCES` when it cannot be run, and `<the
label> could not be started: <the error's words>` for any other
failure to start. THE FAILURES, each terminal and in words naming the
label: a program the system does not find (the spawn's `ENOENT`),
`<the program> is not on this host's PATH`, or `<the program> does
not exist on this host` for a program written with a path; a program
the system will not run (`EACCES`), `<the program> cannot be run on
this host: EACCES`; a child that leaves before the listing is done,
`<the label> ended at its start, exit <code>`, or `on <the signal>`
in place of `exit <code>`, followed by `: ` and the kept stderr lines
joined by `\n` when it wrote any; a json-rpc `error`, `<method> was
refused (<code>): <message>`.

## The openapi document

`fetchOpenApiDocument` fetches a granted document with a plain GET
following redirects, anonymously first (a fetch that fails on the wire
is retryable, `could not fetch the openapi document at <url>: <the
failure's words>`). An answer that is neither 2xx
nor an auth refusal fails with `the openapi document at <url>
answered <status>`, retryable for a 408, 425, 429 or a status of 500
and above, terminal otherwise. AN AUTH REFUSAL (a 401, or a 403)
rides the listing's ladder above, the same functions and the same
rules with the document url in the server url's place: when the
caller named the agent under compile (the input's `account`: the
agent's id, and the document url's host as the account's name), the
agent's account for the host is read on its behalf and its bearer
tried once more as `authorization: Bearer <the bearer>`; with nothing
stored, or refused again, the operator is asked, on the agent's
behalf and under that account, for a pasted token (a document server
runs no authorization dance: the token is the whole sign-in), stored
under the agent's account named by the document url's host as the
setup fields the generated module reads at run time (the one
field `secret`, labelled `Access token`, a secret; the ask's account
`{agent, name: <host>}` with the onboarding's scopes when it names any
and, when a stored bearer was refused, `refused` as `the openapi
document at <url> answered <status>`; an empty answer fails terminal,
`no token was given for <url>`), and the fetch is tried with it, a
refusal then failing in its classified words. THE ASK'S WORDS are the onboarding
handed in (`onboarding`: `{helpUrl, instructions, scopes, road?,
credential?}`, judged by the caller from the agent's specification):
its page as the help url, its steps as the instructions, its scopes
as the scopes; a fetch handed none, or one with no agent named, fails
`<url> demands a sign-in` (classified as an auth refusal) so the
caller can judge the words and try again. Once the document is read
that way, when its first server's host differs from the document
url's host, the same fields are stored under the agent's account
named by that host as well, so the generated module's first call
finds the account logged in. The raw text served is hashed (sha256,
hex) and parsed as json first, then as yaml with the granted yaml
package when json parsing fails; a text that is neither fails with
`the openapi document at <url> is neither json nor yaml: <the yaml
parser's words>`. The answer carries the parsed document, the raw
text and the hash. A document GIVEN as text (`documentText`: the text
a package carries for the url) is parsed and hashed exactly as a
served text is, with no fetch, and the answer carries it the same
way.

## The type engine

`elaborateOpenApiTypes` runs the granted `@hey-api/openapi-ts`
engine's `createClient` over the document as json, on the granted
`typescript`, the compiler's own pinned version: the raw text is
parsed as a fetched one is (json first, then yaml with the granted
yaml package) and the parsed document is written into the scratch
directory (created when missing) as `document.json`, serialized with
`JSON.stringify(document, null, 2)`, with the options `input` (that
file), `output: { path: <scratch>/out, tsConfigPath: null }` (the
engine's tsconfig discovery OFF, so it runs on its own defaults, the
same bytes everywhere), `plugins: ['@hey-api/typescript']` (the
typescript plugin alone: no sdk, no client, no engine code at run
time) and `logs: { level: 'silent', path: <scratch> }` (its crash
reports kept in the scratch folder); the emitted
`<scratch>/out/types.gen.ts` is the answer, read whole. The engine is
deterministic over pinned bytes, so a failure is terminal at once (an
error tagged `kind: 'terminal'`), worded `the openapi type engine
could not elaborate the document: <the engine's words>`, with no
retry. A raw text that parses as neither json nor yaml fails the same
terminal way, the yaml parser's words in the engine's place. The
engine's own version is what the provenance records, and
`typeEngineVersion` answers it: the `version` in the `package.json` of
the granted `@hey-api/openapi-ts` this module runs, that file found by
Node's own lookup from this module's code (`import.meta.resolve` of
`@hey-api/openapi-ts/package.json`) and read with the file system's own
read; `unknown` when it cannot be found or read.

The OPERATION EXPORTS of an elaborated source
(`elaboratedOperationsOf`) are read with two patterns over the text:
every line `export type <Name>Response = ` names a response union,
and every block from a line `export type <Name>Data = {` to the next
line `};` is an operation whose `url` is the value of the
single-quoted `url: '...'` literal inside the block (a block without
one is skipped); each is answered as `<Name>Data`, the url, and
`<Name>Response` when the response union exists, in the blocks'
order.

## Names

`mcpModuleName` takes the server. A remote server's module name is the
server url's hostname with a leading `mcp.` removed, its first
dot-separated label, every character that is not a letter, digit or
`-` replaced by `-`, lower-cased; an empty result is `server`. A LOCAL
SERVER'S module name is read off its command's NAME SOURCE: the
program's base name (the text after its last `/` or `\`, without a
trailing `.exe`, `.cmd`, `.bat` or `.ps1`), unless that base name is
one of the runners `npx`, `pnpx`, `bunx`, `uvx`, `pipx`, `uv`,
`node`, `bun`, `deno`, `python`, `python3`, `docker` and `podman`; a
runner's source is the first of its arguments that does not start
with `-`, is not the word `run`, and is not the word right after one
of the options `-e`, `--env`, `--env-file`, `-v`, `--volume`,
`--mount`, `-p`, `--publish`, `--name`, `--network`, `-w`,
`--workdir`, `-u`, `--user`, `--entrypoint`, `--from`, `--with` and
`--directory` (the runners' options that take a value), and the
runner's own base name when no argument is left. The source then
loses everything up to its last `/` or `\`; then a version: an `@`
after its first character and what follows it, else `==` and what
follows it, else a `:` and what follows it; then a trailing
extension, a `.` followed by letters and digits alone; and is
cleaned: every character that is not a letter, digit or `-` replaced
by `-`, lower-cased, every run of `-` made one, a `-` at either end
removed. A cleaned source that is `mcp`, `server` or `mcp-server`
names nothing of its own: the segment before its last `/` is the
source instead, when there is one (a scope's leading `@` dropped),
cleaned the same way. Last, a leading `mcp-server-`, else a leading
`server-`, else a leading `mcp-` is removed, and a trailing
`-mcp-server`, else a trailing `-server`, else a trailing `-mcp`; an
empty result is `server`. So `npx -y @chaindead/telegram-mcp` names
`telegram`, `uvx mcp-server-git --repository /repo` names `git`,
`docker run -i --rm -e GITHUB_TOKEN ghcr.io/github/github-mcp-server`
names `github`, `npx -y @playwright/mcp@1.2.3` names `playwright`,
`python -m mcp_server_time` names `time`, `npx -y
@modelcontextprotocol/server-filesystem /data` names `filesystem` and
`/opt/acme/bin/erp-mcp --db /var/acme` names `erp`. Two grants that
name one module are refused where the workspace lays the modules. An
openapi module's name (`openApiModuleName`) is the hostname of the
document's first server url when it parses as a url (else the
document url's hostname), with a leading `api.` or `www.` removed,
its first label cleaned the same way; an empty result is `api`. A
tool's function name is its name camel-cased (split on every run of
characters that are not letters or digits, the first part
lower-cased, every later part with its first letter upper-cased and
the rest lower-cased) and its type names are the pascal case (every
part capitalized the same way) followed by `Input` and `Result`. An
operation's identifier is its operationId, or `<method> <path>` when
it has none, split the same way, the first part's first letter
lower-cased and kept otherwise, the later parts' first letters
upper-cased and the rest kept, `operation` when nothing remains, and
prefixed `op` when it would start with a digit; its pascal form
upper-cases the first letter. A property name that is not a plain
identifier (letters, digits, `_` and `$`, not starting with a digit)
is written as a json string.

THE MODULE'S OWN NAMES. What a generated module imports is written
under the name this specification gives it while no function the
module exports carries that name. One a function carries is held
under a LOCAL, the name with `$` appended, in every place the
module's text writes it: its import reads `<name> as <local>`, a call
of it is a call of `<local>`, and its member of the safe calls
`<local>` in place of `<name>`. A function whose name is a RESERVED
WORD is declared under a local of its own, the name with `$`
appended: its doc block, then `async function <local>(` in place of
`export async function <name>(`, and after its closing brace the line
`export { <local> as <name> };`. The reserved words are `arguments`,
`await`, `break`, `case`, `catch`, `class`, `const`, `continue`,
`debugger`, `default`, `delete`, `do`, `else`, `enum`, `eval`,
`export`, `extends`, `false`, `finally`, `for`, `function`, `if`,
`implements`, `import`, `in`, `instanceof`, `interface`, `let`,
`new`, `null`, `package`, `private`, `protected`, `public`, `return`,
`static`, `super`, `switch`, `this`, `throw`, `true`, `try`,
`typeof`, `var`, `void`, `while`, `with` and `yield`.

## The type a schema reads as

A json schema (the mcp lane, `typeFromSchema`) renders: an `enum` as
the json of its values joined by ` | `; a `const` as its json; `anyOf`
or `oneOf` (the first present, non-empty) as the members rendered and
joined by ` | `; a `type` array as the schema rendered once per member
type and joined by ` | `; `string` as `string`, `number` and
`integer` as `number`, `boolean`, `null` as themselves; `array` as the
items' type followed by `[]` (`unknown[]` without items); `object`
with declared properties as `{`, one line per property indented two
spaces deeper than the caller's indent (a `/** <description> */` line
before it when the property has one; a `?` after the name when it is
not in `required`; the property's type rendered at the deeper
indent), an index line `[key: string]: unknown;` when
`additionalProperties` is `true` or a schema, and `}` at the caller's
indent; an `object` with no properties as `Record<string, <the
additionalProperties schema's type>>` when that is a schema, else
`Record<string, unknown>`; anything else `unknown`. An openapi schema
(the openapi lane, `typeFromOpenApiSchema`) renders the same way with
these differences: a local `$ref` (`#/...`, each segment's `~1` read
as `/` and `~0` as `~`) resolves against the document (a reference
that does not resolve to an object, or one already being resolved on
the way, renders `unknown`); a 3.0 `nullable: true` appends ` | null`
unless the rendered text already has a `null` member; `allOf` merges
its object members (each dereferenced, nested `allOf` merged first)
into one object schema whose properties and required names are the
union and whose `additionalProperties` is the last member's that
declares one, and renders `unknown` when any member is not an object
(properties, a type `object` or `additionalProperties`);
`anyOf`/`oneOf` and type arrays drop duplicate renderings; an array's
item type is parenthesized when it contains `|` or `&`; a property's
description comes from its dereferenced schema, with `*/` written as
`*\/`; a schema with neither `type` nor `properties` renders
`Record<string, <value type>>` when its `additionalProperties` is a
schema and `unknown` otherwise, and a schema with `type` `object` (or
no type but properties) and no properties renders the record form.

## The mcp module

`generateMcpModule` takes the server, its tools and its instructions.
The tools' function names are read before anything is generated, the
tools in name order (locale order). Two tools whose function names
are one name are terminal: `the tools "<the first's name>" and "<the
second's name>" of <url> both read as the function <fn>`. A tool
whose function name starts with a digit is terminal: `the tool
"<name>" of <url> reads as "<fn>", which is no JavaScript name`. For a
local server, the command's label stands wherever these words and the
module's text below say `<url>`.

The generated mcp module begins with the header lines `// Generated
by the Cernanto compiler from <url>`, `// Do not edit: regenerate by
recompiling the agent.`, `// Every call runs as a journaled step in
this agent's own worker and`, `// is traced as mcp/<name>; the
server's bearer comes from this`, `// agent's own account in the
plane's safe, read before each call,`, `// refreshed once when the
server rejects a stale oauth token, and`, `// signed in on the plane
(the operator authorizes in the browser)`, `// when the server demands
a sign-in nothing stored can answer.`, `// Property names stay
exactly as the server declares them; only`, `// the function names
are restyled.`, then, when the server published non-blank
instructions, `//`, `// What the server says about using its tools:`
and each line of the trimmed instructions as `//   <line>` (three
spaces after the slashes), then, when any tool declares a
`readOnlyHint`, `//`, `// The server marks these tools (untrusted
hints, per the MCP spec):` and the partition lines `//   read-only:
<the read-only tools' function names joined by ", ">` and `//
writing:   <the writing tools' function names the same way>` (each
line present only when its list is not empty; a tool is read-only
when its hint is true and writing when it is false, tools without the
hint in neither), then the imports `import { mcpCallThrough, type
McpCustody } from '@cernanto/runtime-lib/mcp';` and `import {
authorize, login, pin, read, store } from
'../agents/cernanto-auth.js';`, a blank line, then the grant's
constants: `const LANE = <json of { server: <the url>, module: <the
module name>, host: <the url's host> }>;` (the host is the provider
word, and the name of the agent's account for the server when the
caller names none) and `const CUSTODY: McpCustody = { <THE SAFE'S
MEMBERS for authorize, login, pin, read and store> };` (the safe the
ladder is handed), and a blank line.

THE SAFE'S MEMBERS: the ladder speaks in records and the custody
agent declares its parameters in order, so each member of the safe
is an adapter from the one to the other, the optional settings
gathered last and the call naming the function's local when it has
one: `authorize: (a) => authorize(a.provider, a.authUrl, a.scopes,
a.name, { ...(a.state === undefined ? {} : { state: a.state }),
...(a.codeVerifier === undefined ? {} : { codeVerifier:
a.codeVerifier }) })`, `login: (a) => login(a.provider,
a.instructions, a.fields, a.helpUrl ?? '', { ...(a.name === undefined
? {} : { name: a.name }), ...(a.scopes === undefined ? {} : { scopes:
a.scopes }), ...(a.refused === undefined ? {} : { refused: a.refused
}) })`, `pin: (a) => pin(a.provider, a.name)`, `read: (a) =>
read(a.name)`, `store: (a) => store(a.provider, a.kind, a.value,
a.name)`, `saveState: (a) => saveState(a.name, a.state,
a.grantedScopes)` and `state: (a) => state(a.name,
a.requiredScopes)`, the members in that order among the ones the
module needs, joined by `, ` on one line.
After the header come the tools sorted by name (locale order), each
`export interface <Pascal>Input <the input schema's type, rendered at
no indent; a rendering that does not start with "{" is wrapped as "{
value: <it> }">`, `export type <Pascal>Result = <the output schema's
type, or "unknown" when the tool declares none>;`, a doc block `/**`,
then when the tool has a title (its annotations' title, else its own)
` * <title>.` and ` *`, then ` * <description, or "The <tool name>
tool of <url>.">`, then when hints apply ` *` and the hint lines (` *
Read-only, per the server: it does not create, modify, or delete
anything.` for a true readOnlyHint; for a false one ` * Writes, per
the server: it creates or modifies data (declared non-destructive).`
when destructiveHint is false, else ` * Writes, per the server: it
creates, modifies, or DELETES data (destructive updates possible).`;
` * Idempotent, per the server: repeating the same call changes
nothing further.` for a true idempotentHint; ` * Not idempotent, per
the server: a repeated call may act again.` for a false one on a tool
not marked read-only; ` * Open world, per the server: it interacts
with entities beyond the server itself.` for a true openWorldHint),
then ` *`, ` * @param args - The tool arguments, exactly as the server
declares them.`, ` * @param account - Optional account name, for one
of several accounts this agent holds on the server; the server's host
names the default one.`, ` * @returns The tool result<": the server
declares no output schema, so a json answer arrives parsed and prose
arrives as a string; validate the shape with your own zod schema
(never JSON.parse it)" without an output schema, ", validated by the
server schema" with one>.`, ` * @example`, ` * const result = await
<fn>({} as <Pascal>Input);`, ` */`, and `export async function
<fn>(args: <Pascal>Input, account?: string): Promise<<Pascal>Result>
{`, `  return (await mcpCallThrough(LANE, CUSTODY, <the tool name as
json>, args, account)) as <Pascal>Result;`, `}` and a trailing
newline. The header and the tool sources are joined by newlines.

THE MODULE OF A LOCAL SERVER is the same text with these differences
and no other: the header's first line is `// Generated by the
Cernanto compiler from the local MCP server <the command's label>`;
the five lines from `// is traced as mcp/<name>; the server's bearer
comes from this` to `// when the server demands a sign-in nothing
stored can answer.` are, in their place, `// is traced as mcp/<name>;
the server runs as a child of this`, `// agent's own process, started
by the first call and kept while`, `// the process serves, with the
environment the specification` and `// writes in front of its
command.`; the imports are `import { localMcpCallThrough } from
'@cernanto/runtime-lib/mcp';` alone; the constants are `const LANE =
<json of { command: <the command>, module: <the module name> }>;`
alone (no custody: the command carries its environment); and each
tool's doc block has no `@param account` line, its function being
`export async function <fn>(args: <Pascal>Input):
Promise<<Pascal>Result> {`, `  return (await localMcpCallThrough(LANE,
<the tool name as json>, args)) as <Pascal>Result;`, `}`.

## The openapi module

`generateOpenApiModule` walks the document's `paths` (an object, else
terminal: `the openapi document at <url> declares no paths`; a
document that is not an object, `the openapi document at <url> is
not an object`) in locale order of the path, and within a path the
methods `get`, `put`, `post`, `delete`, `patch`, `head`, `options` in
that order, each operation object once. An operation PAIRS with the
elaborated operation exports sharing its path template: the candidate
whose Data name (without `Data`, letters and digits only,
lower-cased) equals its operationId normalized the same way; a lone
candidate; else the one whose Data name starts with the capitalized
method when exactly one does. The function name is the operation
identifier above, paired or not (a reader of the document alone
derives the same name; the pairing lends an operation its types, and
its name comes from the document); a taken name gains the pascal
method, then `2`, `3`, ... until free. The base url is the document's
first server url with each `{variable}` replaced by the variable's
default, resolved against the document url and stripped of a trailing
slash, the document url's origin when there is none or it does not
parse. The parameters are the path item's shared ones then the
operation's own, each dereferenced, keyed by `<in>:<name>` (a later
one replacing an earlier), kept when `in` is `path`, `query` or
`header` (a path parameter is always required), with its description
and schema. The request body is the operation's (dereferenced) body's
`application/json` content: present when that content exists,
required when the body says so. The success response is the lowest
`2xx` code's (dereferenced) response; its result type is its
`application/json` schema's type, `unknown` when the response has
content of another kind, `undefined` when it has no content.

Each operation renders `export type <Pascal>Input = Omit<<Data name>,
'url'>;` when paired, else `export interface <Pascal>Input {}` with
no groups or `export interface <Pascal>Input {` followed by the
groups and `}`: a group per `path` (required), `query` (required when
any query parameter is) and `header` (optional) that has members, `
<group><? when optional>: {`, one member line per parameter (`    /**
<description with */ escaped> */` when described, then `
<name><? when not required>: <the schema's type at four spaces>;`),
`  };`, then `  body<? when not required>: <the body schema's type at
two spaces>;` when the body is present; then `export type
<Pascal>Result = <the paired Response name, "unknown" when paired
without one, else the result type>;`, the doc block `/**`, ` * <the
summary, else the description, else "The <METHOD> <path> operation
of <document url>.", its first line with */ escaped><, then "\n *
@remarks <note>" when the security resolution left a note>`, ` *`,
` * @param args - The operation arguments, grouped as the document
declares them.`, ` * @param account - Optional custody account name;
defaults to "<module>".` for a secured operation only, ` * @returns
The <success code, or "2xx"> response body.`, ` * @example`, ` *
const result = await <fn>({} as <Pascal>Input);`, ` */`, and `export
async function <fn>(args: <Pascal>Input, account?: string):
Promise<<Pascal>Result> {` for a secured operation (`(args:
<Pascal>Input)` for an open one), `  return (await
securedOpenApiCall(SECURED, CUSTODY, <the binding as json>, args,
account)) as <Pascal>Result;` (secured) or `  return (await
callThroughOpenApi(<the binding as json>, args)) as <Pascal>Result;`
(open), `}` and a trailing newline. The BINDING is `{ module,
operation: <fn>, baseUrl, method, path, parameters: [{ name, in,
required }, ...], hasBody, security? }` in that key order, the
`method` in lower case as the document keys it (`get`, `post`), which
is how the runtime lane reads it, the security present when the
operation resolved one.

SECURITY resolves from the operation's `security` requirements, else
the document's: the first requirement object with any key, its keys
sorted and the first taken, looked up in the document's
`components.securitySchemes`; a scheme the document does not define
leaves the note `The declared security scheme "<key>" is not defined
in the document.`; an `http` scheme with `bearer`, an `oauth2` and an
`openIdConnect` scheme resolve `{ scheme: 'bearer' }`; an `apiKey`
scheme with a string name resolves `{ scheme: 'apiKeyHeader', name }`
when its `in` is `header` and `{ scheme: 'apiKeyQuery', name }` when
`query`; anything else leaves the note `The declared security scheme
"<key>" (<type, or "unknown">) is not supported; the call rides
without it.`; a resolved scheme carries the scheme's `description`
trimmed and cut at 500 characters when it has one. The DOCUMENT AUTH
SUMMARY (`documentAuthSummary`) for the prompt and for the onboarding
judgment names the scheme the module itself resolves to, the first
secured operation's (its own requirements, else the document's
top-level ones, the first requirement with any key and its keys
sorted), so a scheme the document declares but applies nowhere stays
out of it: `a bearer token in the authorization header` for http
bearer and openIdConnect, `OAuth 2.0 with its authorization-code
flow` for an oauth2 scheme that declares one (else the bearer words),
`an api key in the "<name>" query parameter` or `an api key in the
"<name>" header` for an apiKey with a name, nothing otherwise (a
document with no secured operation, an unsupported or undefined
scheme included).

The module's text is the header `// Generated by the Cernanto
compiler from <document url>`, `// Do not edit: regenerate by
recompiling the agent.`, the import line `import { callThroughOpenApi,
securedOpenApiCall, type OpenApiCustody } from
'@cernanto/runtime-lib/openapi';`, `import type { OpenApiCallArgs,
OpenApiOperationBinding } from '@cernanto/runtime-lib/openapi';`,
then, when any operation is secured, `import { login } from
'../agents/cernanto-auth.js';` (`import { authorize, login, pin,
saveState, state } from '../agents/cernanto-auth.js';` for an oauth2
flow), then, when any operation paired, `import type {` followed by
the paired type names sorted and once each as `  <name>,` lines and
`} from './<module>.types.js';`, then, when any operation is secured,
a blank line and the secured constants `const SECURED = <json of {
module, provider, onboarding?, oauth2? }>;` (the provider the host of
the document's server url: the provider word, and the name of the
agent's account for the api when the caller names none; `onboarding`
the words handed to the generation, `{helpUrl, instructions, scopes,
road?, credential?}`, when any, exactly as given: the page, the
numbered steps, the scopes, the road and the credential's name the
run-time ask carries, the runtime's own generic steps and the
provider's site otherwise) and `const CUSTODY: OpenApiCustody = {
<THE SAFE'S MEMBERS for login> };` (for login, authorize, pin,
saveState and state under an oauth2 flow), and a blank line; the
first secured operation's scheme is the module's. An OAUTH2 SCHEME
whose `flows.authorizationCode` names an `authorizationUrl` and a
`tokenUrl` is the module's oauth2 flow: the binding still carries `{
scheme: 'bearer' }` (the token rides the authorization header), and
the constants carry `oauth2: { authorizationUrl, tokenUrl, scopes }`,
the scopes being the sorted union of the scopes the secured
operations' requirements name for the scheme, else the flow's
declared scope names; an oauth2 scheme with no such flow resolves to
a pasted bearer as before. A document with no operations at all is
terminal: `the openapi document at <url> declares no operations`. The
header and the operation sources are joined by newlines.

## The ladders

The ladder every tool function rides is the runtime library's
(`mcpCallThrough` of `@cernanto/runtime-lib/mcp`), and the
call-through every operation rides and the secret ladder a secured
one rides are the runtime library's too (`callThroughOpenApi` and
`securedOpenApiCall` of `@cernanto/runtime-lib/openapi`): the
generated modules hand them the grant's constants, the binding and
the safe's functions, and the runtime holds every rule (the account
read fresh before each call, the one refresh of a stale oauth token,
the sign-in on the plane, the operator asked for a missing or
refused credential in the provider's words). A local server's tool
functions ride `localMcpCallThrough` of the same module: each call one
record of the agent's journal, run on the server the agent's own
process keeps as its child for the command, with no account and no
sign-in.

## The openapi interface

An agent whose spec says `Implements: openapi:<target>` is held to a
contract rendered from that document, exactly as an implementor of an
interface is held to the interface's: `renderOpenApiInterface({target,
raw})` answers `{contract}`, the declarations-only text the compiler
treats as an interface contract (the code session's anchor, the
coverage gate's yardstick, the change record's previous side).
`target` is the document as the spec names it (`./orders.yaml`, an
https url) and `raw` its text. The words below name the target as
written.

The document is parsed as the fetched one is (json first, then yaml;
a text that is neither fails terminal `CE192: the openapi document
<target> is neither json nor yaml: <the yaml parser's words>`); a
document that is not an object, or whose `paths` is not an object,
fails `CE192: the openapi document <target> declares no paths`, and
one with no operation at all `CE192: the openapi document <target>
declares no operations`. The operations are walked as the openapi
module walks them (the paths in locale order, the methods `get`,
`put`, `post`, `delete`, `patch`, `head`, `options` in that order),
each with the same parameters (the path item's shared ones then the
operation's own, each dereferenced, kept when `in` is `path`, `query`
or `header`, a path parameter always required), the same request
body (the `application/json` content) and the same success response
(the lowest `2xx` code's, dereferenced). The FUNCTION NAME is the
operation's identifier as the module derives it from its
`operationId`; an operation without an `operationId` fails `CE193:
the operation <METHOD> <path> of <target> has no operationId; a
served operation is addressed by name`, and two operations whose
names fold to one fail `CE193: the operations <operationId> and
<operationId> of <target> fold to the same name "<name>"; rename
one`. An operation fails `CE194: the operation <operationId> of
<target> <what>; <the remedy>` when it declares a `cookie` parameter
(`declares a cookie parameter`, `a served operation reads no
cookies`). A request body whose content has no `application/json`
entry renders `Uint8Array` for an `application/octet-stream` content,
`string` for a `text/*` content and `unknown` for any other: the
agent serves its document on a listener of its own, so a stream,
bytes and a text body are every implementor's. Every failure is an
Error tagged `kind: 'terminal'`, the code its first word.

The contract text is, in order: the header lines `// The contract
rendered from <target>: one function per operation.` and `// Do not
edit: regenerate by recompiling the agent.`, a blank line, then per
operation in walk order: `export interface <Pascal>Input {` with the
groups rendered as the openapi module renders an UNPAIRED operation's
Input (a group per `path` (required), `query` (required when any
query parameter is) and `header` (optional) that has members, one
member line per parameter with its description line when described,
then `body` when the operation takes one, required when the body says
so), where the SECURITY the operation resolves to (the module's
security resolution) adds an optional member: `authorization` to the
header group for a bearer scheme, the named header to the header
group for an apiKey header scheme, the named parameter to the query
group for an apiKey query scheme (each typed `string`, the group
present for it even when the document names no other member;
`export interface <Pascal>Input {}` when there are no groups at
all), and where an operation is served in process, its success a
`text/event-stream` or an `application/octet-stream` content (a
stream, bytes), one more member after its groups, `/** Aborted when
the client goes. */ signal?: AbortSignal;`, the request's signal the
runtime's server lane hands the operation, so a poller with nothing
to say stops the moment its client goes, then `}`; then `export type
<Pascal>Result = <the success type>;`, the success type being the
`application/json` schema of the success response rendered with the
openapi schema renderer, `void` for a `204` or a response without
content, `string` for a `text/*` content, `Uint8Array` for
`application/octet-stream`, `AsyncIterable<unknown>` for
`text/event-stream`, and `unknown` for any other content; then, per
declared response whose code is not `2xx` (`default` excluded) and
whose content has an `application/json` schema, in the document's
order, `export type <Pascal>Error<code> = <that schema rendered>;`;
then the doc block `/**`, ` * <the summary, else the description,
else "The <operationId> operation of <target>.", its first line with
*/ escaped>`, then, when the operation has both a summary and a
description, ` *` and ` * <the description's first line>`, then ` *`,
` * @param args - The operation's arguments, grouped as the document
declares them.`, ` * @returns The <success code, or "2xx"> response
body<", streamed" for a stream, ", nothing" for void>.`, then per
declared non-2xx code ` * @throws an Error carrying \`status:
<code>\`<" and a <Pascal>Error<code> body" when the code has a json
schema>: <the response's description's first line, else "the
declared <code> answer">.`, ` */`, and `export declare function
<fn>(args: <Pascal>Input): Promise<<Pascal>Result>;`, or, for an
operation carrying the extension `x-cernanto-secret: true` (a
secret's operation), `export declare function <fn>(args:
Secret<<Pascal>Input>): Promise<Secret<<Pascal>Result>>;`, the os
module's mark, so the served side keeps no record of its body or its
answer; the operations joined by blank lines, a trailing newline. The text imports nothing
and re-exports nothing: it is self-contained, as an interface
contract must be, and its every type is inline (a `$ref` resolves to
its shape, written out in place).

## The openapi server

An implementor serves its document itself, on a listener of its own,
through code this module renders beside the contract: the server
module the agent's listener hands requests to, the types module the
coder imports, and the stubs the coder's file is seeded with.
`renderOpenApiServer({target, raw})` answers `{name, types, server,
stubs}`, the document read and walked exactly as the openapi
interface above reads and walks it, with the same failures.

THE NAME is the implemented document's module name, the name the
runtime's materialize gives the same document: the base name of the
target's file without its extension, or a url's first host label,
lower-cased with every run of characters outside `a-z0-9` written as
one `-` and the ends trimmed of `-`, `api` when nothing remains
(`./orders.yaml` is `orders`, `./gateway/openapi.yaml` is `openapi`,
`https://api.shop.example/spec.json` is `api`).

THE TYPES text is the contract text above without its function
declarations: the same header lines (the first reading `// The types
rendered from <target>: one Input and one Result per operation.`),
then per operation its `Input` interface, its `Result` type and its
`Error<code>` types with their doc blocks as the contract renders
them, the `export declare function` line and its doc block left out.

THE SERVER text is the module `src/openapi/<name>.server.ts`, in
order: the line `// Generated by the platform from <target>. Do not
edit.`; `import type { IncomingMessage, ServerResponse } from
'node:http';`; `import { createOpenApiHandler, type OpenApiAdmit }
from '@cernanto/runtime-lib/openapi-server';`; `import { agentId,
invoke } from '../os.js';`; a blank line; `export const document:
Record<string, unknown> = <the document as compact JSON>;`; a blank
line; the doc block `/** The document's request handler for node's http
or https server: answers true when the request was one of the
document's paths and it served it, false when the path is not the
document's and it touched nothing. `admit` decides who is admitted to a
secured operation, `bodyCap` the bytes a body is read under. */`; and
the function

```ts
const own = '../index.js';

export function createHandler(options?: { admit?: OpenApiAdmit; bodyCap?: number }): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return createOpenApiHandler({
    document,
    operations: () => import(own),
    call: async (operationId, args) => (await invoke(agentId(), operationId, args, {})).result,
    ...(options?.admit === undefined ? {} : { admit: options.admit }),
    ...(options?.bodyCap === undefined ? {} : { bodyCap: options.bodyCap }),
  });
}
```

ending in a newline: the handler binds the runtime's server lane to
the agent's own operations, imported from the module beside it (the
specifier held in a variable: the workspace's type-check of the
overlay leaves it unresolved, since the agent's own module lives
beside the overlay and not inside it, and the materialized process
resolves it beside the generated module), and to a call of the
agent's own function by its id for an operation that answers a value,
so a served request is a call like any other, journaled and traced.

THE STUBS text is the coder's `src/index.ts` as it is seeded: the
line `// The operations the document <target> declares, seeded by the
compile: fill each body. The listener is yours.`; `import {
createServer } from 'node:http';`; `import { createHandler } from
'./openapi/<name>.server.js';`; `import type { <every Input and
Result name the operations use, in walk order> } from
'./openapi/<name>.types.js';` and, on the next line, `export type {
<the same names> } from './openapi/<name>.types.js';` (the re-export
puts the types on the agent's emitted contract, where the coverage
gate reads them through the sibling the types module emits, so the
coder declares none of them again by hand); a blank line; the
listener:

```ts
// The listener: the port, the protocol and the admission the specification names; write the port.
const PORT = THE_PORT_THE_SPECIFICATION_NAMES;
const api = createHandler();
const server = createServer(async (req, res) => {
  if (await api(req, res)) return;
  res.statusCode = 404;
  res.end();
});
server.on('error', (error: Error & { code?: string }) => {
  if (error.code !== 'EADDRINUSE') throw error;
  setTimeout(() => server.listen(PORT), 2000);
});
server.listen(PORT);
```

(written in what the coder's declaration of `node:http` offers, a
`statusCode` and an `end`, and an `Error` with a `code`, which that
declaration has; `writeHead` and `NodeJS.ErrnoException` lie outside
it)

(the bind tried again every two seconds while the port is held: the
previous generation lets it go at a roll; the port's value is a name
no module defines, so a seed left as it is fails the type-check and
the session writes the port the specification names, a number or a
setting read from the configuration, and `node:https` where the
specification says so); then per operation in walk order, after a
blank line, the contract's doc block for it and `export async function
<fn>(args: <Pascal>Input): Promise<<Pascal>Result> {`, `  throw new
Error('not implemented: <fn>');`, `}`; a trailing newline.

## The ingress failure reader

`ingressCallError` reads a substrate ingress answer that is not 2xx
as a classified failure: a 404 or a 503 is the ingress's own voice
(the callee not registered yet, the substrate booting) and is an
error tagged `kind: 'target-unavailable'` (the runtime retries it
until the callee lands) in the fallback words the caller gives;
anything else is the callee's terminal outcome, an error tagged
`kind: 'terminal'`, worded by the body when it is json with a
non-empty string `message` (a message of the form `<kind>: <words>`
whose kind is one of the runtime's error kinds, `terminal`,
`retryable`, `judgment-inconclusive`, `contract-violation` or
`target-unavailable`, is read as its words
alone), else by the fallback words. EVERY failure this module throws,
here and in the listing, the fetch and the elaboration, is an Error
carrying a `kind` property the runtime reads (`retryable`, `terminal`
or `target-unavailable`; `Object.assign(new Error(words), { kind })`):
the compiler's readers ask the kind by name.

## Tests

Uses:

- npm:fs-extra
- npm:@modelcontextprotocol/sdk

The safe in both modules is the adapters typed by the runtime's
custody interfaces, and the module type-checks with them.

The listing needs a server: the public reference server at
`https://mcp.deepwiki.com/mcp` lists its tools anonymously (three
tools, `read_wiki_structure` among them), and a url nothing serves
(`https://127.0.0.1:9/mcp`) fails in words. The mcp lane's call road
needs a server of the tests' own: a streamable-http server started in
the test process on a loopback port with the protocol package, serving
two tools (one answering structured content beside its text, one text
alone), keeping a session the client carries and closes, and, on a
second path, demanding a bearer (a call without one classifies as
auth, with it answers, and a listing of it with no agent named fails
in the sign-in demand's words); a tool the server does not have
answers as the server frames it, and a listing given as a package
carries opens no session. The sign-in on an agent's behalf is proved
by the compile that first needs it. The document fetch behind a sign-in
is proved on a plain http path of the tests' own loopback server that
serves a small document only with a bearer: a fetch with no agent
named fails in the sign-in demand's words, and one naming an agent
whose account for the server the tests logged in beforehand, with the
compile family's power to store on an agent's behalf, answers the
document and stores the same fields under the account the document's
first server host names. The document fetch needs
a published document: `https://petstore3.swagger.io/api/v3/openapi.json`
is json and `https://petstore3.swagger.io/api/v3/openapi.yaml` is the
same document as yaml (the two parse to the same title and paths); the elaboration and the generation run on what they fetch,
with a temporary scratch folder made through the granted file
package. The generated texts are checked for their shape (the header
lines, one function per tool or operation, the ladder present), never
compared to a fixed byte count. The names are proved on a listing and
a document of the tests' own, given as data: a listing whose tools
are named `delete`, `read` and `mcp_call_through`, a listing with two
tools that read as one function, a listing with a tool whose name
starts with a digit, and a document with a bearer scheme whose
operations carry the operationIds `delete` and `login`.

The local listing needs a server of the tests' own: a stdio server the
test writes as a file in a temporary folder with the granted file
package and runs with `node <the file>`, its flags choosing a fault.
Proved on it: its tools and its instructions listed, the schema hash
equal to the hash of the same tools given as a listing; a value the
server needs in its environment reaching it from the command's
environment words, and the server leaving at its start without it
failing in the words its stderr wrote; a program the host does not
have, a line on stdout that is no message, and a ping the server asks
answered while the listing goes on. The local module names are proved
as data on every command 'Names' writes out, and the module of a
local server is checked for its shape: the header naming the label
and no value of the environment, no custody, and each function taking
the tool's arguments alone.


## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
