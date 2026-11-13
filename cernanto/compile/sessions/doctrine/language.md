# The platform language

What TypeScript itself cannot say, shared by the code you write and
the tests you write.

# The contract

Exports are the API. Every function `src/index.ts` exports is a
handler other agents call, and nothing else is; the agent's consumers
and tests are written from the exported signatures and their docs,
which is why they are the contract. Named async exports, never a
default export and never a class; helpers stay unexported, and so
does every type that no exported declaration names. A function
the specification gives no result returns `Promise<void>`. Write no
definition or registration of your own and import nothing from the
runtime: the compile wires the agent from the exports.

A function declares its parameters as any TypeScript function does,
each named and typed in the declaration (`send(to: string, subject:
string, body: string)`), the optional ones last with `?`, at most six;
that declaration is the contract. A parameter's type is a record, an
exported interface, only when the input is one thing the specification
names (a mail, a request, a document) or when several optional
settings travel together, last, under the name of what they are
(`settings?: SessionSettings`); the parameters of one function are
never gathered into an object invented to carry them, no type is
declared for one function's parameter list, and a function that takes
nothing declares no parameter. A record the specification names is
declared under the thing's own name (a `Mail`, a `Request`), shared by
every function that takes it, its parameter named for it (`send(mail:
Mail)`), never `input` or `args`, and a record of one member is that
member (`getLead(id: string)`).

Every type a declared parameter or result names is declared in this
agent's own `src`: a shape a dependency's contract also declares is
declared again here, under a name of this agent's, so the contract
stands alone and a type imported from a dependency never appears in
an exported declaration; the declaration made again keeps the
dependency's shape member for member, its optional members optional
in the same form (`prop?: T`, never `prop?: T | undefined`), so a value
crosses between the two types unchanged. The wire delivers json, so the function
parses each parameter with a zod schema as its first statement
(`z.string().parse(to)`; a record with a schema annotated
`z.ZodType<TheRecord>`; an optional parameter with its schema
`.optional()`). Never derive an exported type with `z.infer`. When a
record holds optional properties, `.optional()` infers `T |
undefined`, which `exactOptionalPropertyTypes` refuses against `prop?:
T`: leave that schema unannotated, parse, and normalize into the exact
interface shape by spreading each optional in only when it is defined.
When the specification states what a function returns (a number, a
date, a list of names), the function returns that value itself
(`Promise<number>`, `Promise<Date>`), never an object wrapping it and
never a string standing in for a date; an object is the result only
when the specification asks for several things at once, each under
its own name.

# What happens once and what may happen again

One fact shapes the code. A call to another agent, an operation
through an `openapi:` or `mcp:` grant, a `setTimeout` wait, and a read
of `Date.now()`, `new Date()`, `crypto.randomUUID()` or
`Math.random()` happen once per call, whatever interrupts the call
(inside a job's body nothing of this holds: a job keeps no journal,
its body runs live, and a retryable failure runs it whole again);
everything else the code does with the world (a bare `fetch`, an http
client, a database driver, a command line) may run again. So write
plain awaits and never retries, timers or persistence of your own; a
promise-wrapped `setTimeout` sleep is the right wait for an hour or a
month, it costs nothing while parked, and nothing busy-waits; and
anything that reaches the world lives in an agent of its own that the
specification names (a task, one operation per exported function),
and what you write is the call to it. Inside such a task, a database
transaction is one call in the driver's callback form (`sql.begin(async
(tx) => ...)`), never a BEGIN and a COMMIT on separate awaits; a write
that must not double carries an idempotency key from the call's own
business identity (the order id) or from `crypto.randomUUID()` minted
before the call; a read is free to repeat; a client or a pool is a
module-scope value opened on first use. Never branch on a duration
measured between two clock reads with no await between them: measure
across awaits, or do not branch on it.

# Failures

An Error you throw ends the call, and its caller sees the message. A
trouble the world will get over (a 503 from a service, a connection
refused while it restarts; never a request that timed out, which the
bounded-requests rule below handles inside the call) is thrown tagged, `throw Object.assign(new Error(message),
{ kind: 'retryable' })`, and the call is tried again; tag only what a
retry can heal, never a refusal. When the contract you implement came
from an openapi document (the specification's `Implements: openapi:`
line), a declared error answer is a refusal thrown with that status on
it: `throw Object.assign(new Error('no such order'), { status: 404,
body: { detail: id } })`, the `status` a number the document declares
for the operation and the `body` the shape it declares (left out when
it declares none).

# Requests to the world are bounded

Give every call to a provider the call's own deadline or a short
timeout, never a library's default of none, and cap a library's own
retries by it: `fetch(url, { signal: AbortSignal.timeout(20_000) })`,
or the option a client offers for it. A `setTimeout` is a wait of the
call's own, never the bound of a request. A request the world did not
answer in time is handled inside the call, skipped or answered in
words, never tagged retryable: the next attempt would hang the same
way.

# Webhooks

A webhook delivery's acknowledgement is the provider's own answer:
when the provider demands a crafted or signed response, a challenge
echoed, a token signed, a TwiML body, the consumer composes it with
the provider's own package and its own secret and hands status,
headers and body to the webhook's acknowledgement, which carries them
to the provider as given, before any slow work and inside the
provider's window.

# Node and packages

Node's own modules exist only as `platform.d.ts` declares them (no
node:process, in any file, ever; node:os is a job's own, and of
`process` a job has `process.pid` and `process.kill`; node:fs and
node:fs/promises are a task's, a job's and a module's own, reads and
writes alike, and a service or a worker reads a granted file with
their read subset alone: readFileSync, statSync, readdirSync,
createReadStream, readFile, stat, readdir): owned file access beyond
that rides a
granted npm package (`Uses: npm:fs-extra` in the specification),
paths compose with node:path, and node:crypto is its deterministic subset
(hashing, hmac, the cipher pair, `timingSafeEqual`), while randomness
is the global `crypto` (`crypto.randomUUID()`,
`crypto.getRandomValues`; never imported from node:crypto) and
`Math.random()`. Key material at module scope lives as a base64
string, decoded with `Buffer.from(value, 'base64')` where used, so its
value reads in a trace. Import a package as its declarations export
it: an ES module (its declarations export functions and classes by
name) by its named exports, and a CommonJS package through its default
export, destructured (`import fsExtra from 'fs-extra'; const {
readFile } = fsExtra;`): named imports from a CommonJS module
type-check but can fail at load, and a default import of an ES module
has nothing to bind.

# Calls by name and long calls (./os.js)

A dependency the specification grants is imported from `./agents/`
and called as a function; every function a dependency exports answers
a promise, whatever the work behind it: await it where its answer is
read; a promise handed on as a value is a defect the types do not
refuse. `invoke(agentId, handler, args)` from `./os.js` is the same
call for a target the code learns only when it runs (an id read from
data, a consumer a delivery names, `agentId()` when the agent must
call itself), awaited like any call; a target known when the code is
written is imported, never invoked by name. `invoke` with `wait:
false` starts work that outlives the request (a compile, a long run
someone follows rather than waits for): nobody is sent its answer, so
such work writes its own end where its followers read it, and the
option is never a way to wait for an answer. `cancel(callId)` asks a
call to end. The prompt carries the declarations and docs of both.

# Events: node's own, inside one agent

Agents talk to each other by calls, and by nothing else. Nothing is
emitted from one agent to another, nothing is subscribed to, and no
agent waits on another agent's events. Inside one agent, events are
node's own (`node:events`): an `EventEmitter` in the agent's own
memory, heard by the code of that same agent in that same process.

- **Where an emitter lives.** At the top of the file of a service or
  a worker, whose calls (a service) or parts (a worker) share one
  process and its memory, and of a job, whose calls landing in one
  process share its memory while another copy of the job holds its
  own. A task keeps nothing at the top of the file: each call is on
  its own and may run in another process, so an emitter there
  connects only the parts of one call.
- **Waiting on behalf of callers** (an interface's wait operation,
  `waitForMailReceived(args)` on a mail client) is a wait function of
  a service: the call looks at the agent's memory, and when what it
  looks for is not there it waits on the agent's own emitter and
  looks again after every wake (a plain check on what arrived, a
  judgment through cernanto/decision, anything, cheap checks first). The
  function of the same agent that makes the thing happen (a delivery
  arriving, a poll finding something) writes the memory and emits.
  The caller's call simply stays open until the function returns, and
  the other calls of the service go on beside it.
- **An agent that must wait for something in another agent** calls
  that agent's wait function and awaits it, for as long as it takes:
  a task in the middle of its flow ("send the mail, wait for the
  reply, send the follow-up" is one linear handler with awaits, never
  a sequence decomposed into handlers passing state between them), a
  worker in its loop.
- **The memory is the truth; the event only says "look".** A wait
  function reads first, waits, and reads again, so what it does before
  it waits is safe to do again.

# Identity and cancellation

`callId()` from the os module is this call's id, the same inside a
linked module; `caller()` names its parent; `agentId()` is the name
the agent is deployed under, for whatever must recognize this agent
(a webhook source, a configuration key of its own, a call to itself):
never a literal, because the agent runs under another name while it
is verified. Use `callId()` or an explicit business input for
deduplication. Write no cancellation handling: a cancelled call ends
with every command it started, and a handler's return ends its
remaining child commands, so keep the handler running for as long as
its commands must.
