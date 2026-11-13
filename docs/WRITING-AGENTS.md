# Writing Cernanto agents

A Cernanto agent is one markdown file in your workspace, the folder you
run `cernanto` from, named `<id>.cern.md`: the file's path from there
is the agent's id, so `payments/recovery.cern.md` is
`payments/recovery`. The `# Title` is a heading for the
reader, and the prose is the source: a deploy compiles it into
verified, durable TypeScript, derives tests from the prose itself, and
ships it. You describe behavior in plain English, and the page
declares its premises with a handful of labels: the kind of agent
when it is not a task (`Type:`), what it works with (`Uses:`), what
it implements (`Implements:`), and, under a `## Tests` heading, the
sentences about testing with what the tests use and mock. You never
write code.

```md
# Payment Recovery

Type: service

Uses: mcp:https://mcp.stripe.com, notifications/telegram-send

When a failed payment is reported, check whether the customer has any
successful payments in the past. If they do, wait 5 minutes, charge
the payment once more through Stripe's MCP server and answer whether
it recovered. Otherwise notify the risk team on Telegram with
notifications/telegram-send. Keep the payments already charged
between calls, so the same failed payment is never charged twice,
even when it is reported again.

## Tests

Uses: npm:@faker-js/faker

Generate the customers and payment histories with the @faker-js/faker
npm package; never hand-write fixture records.
```

The compile prints what the page declares before it writes anything:

```
payments/recovery  plan  reads a service, from the Type: label
payments/recovery  plan  reads Uses: mcp:https://mcp.stripe.com, notifications/telegram-send
payments/recovery  plan  reads the tests; Uses: npm:@faker-js/faker
```

## What to write, and how much

One to three short sentences, most of the time. Say what the agent
does, in positive sentences: what it is given, what it does with it,
what it answers, and what it refuses. Write the instructions the
person responsible for the work would give a colleague, and a rule
only when it changes an outcome someone cares about; a sentence that
has to be read twice is split or rewritten. Every branch you care
about is a sentence (the happy path, the refusal, the duplicate);
every branch you leave out, the code leaves out too. A spec grows with
the branches it cares about and can run to a page; what it never
carries is two jobs, which is two agents, one naming the other.

Name what the agent works with, and never how to work with it. The
coder that compiles your spec reads the dependency's contract, the
tools of an MCP server, the operations of an OpenAPI document and the
API of an npm package, and looks up a library's official docs on the
web. It also knows the platform: how to wait a month at no cost, how
to retry, how to keep a write from doubling, how to read a file you
named. Write only what it cannot know: which account, which policy
and its thresholds, the order of the steps, what each branch answers
or refuses, the business identity a write must not double under, a
language, a time zone, a cadence.

The test of a sentence: if a test could check it from outside, keep
it; if only a reading of the code could confirm it, delete it. Every
sentence is a promise the compile keeps: the tests prove it, a change
to it is an amend, and a failure is judged against it. Forcing an
implementation is legitimate only when two correct implementations
would differ in a way someone outside can see (polling instead of a
webhook, one reminder and never two), and most such choices are made
by what you name: a spec that names no webhook polls, and one that
names the vendor's npm package and not its MCP server uses the SDK.

The same agent twice. The first tells the coder how to use a library
it already reads; the second says what the agent does:

```md
# Slack Send

Uses: npm:@slack/web-api, cernanto/auth

Create a WebClient from the @slack/web-api npm package with the bot
token read through cernanto/auth under the account "slack", call
chat.postMessage with the channel id and the text, and return the ts
field of the response as the message id. On a rate_limited error,
wait the Retry-After seconds and try again.
```

```md
# Slack Send

Uses: npm:@slack/web-api, cernanto/auth

Send a text to a Slack channel with the @slack/web-api npm package,
on the connected Slack account that cernanto/auth holds, and answer
whether it was delivered and the message's id.
```

Name an agent and stop there. Say `text/fact-check` answers whether a
claim about the world is true, with the sources it read. This spec
grants it once, on its `Uses:` line, names it where the work needs it,
and says nothing of how it is asked; repeating what the checker does
would be a second copy of its contract to keep in step:

```md
# Facts

Uses: cernanto/llm, text/fact-check

Given a text, pick out its claims about the world with cernanto/llm,
rewrite each as a complete, self-contained statement, check the
claims with text/fact-check at the same time, and answer the ones
that are true.
```

The order of several asks is the one word about how that is worth
writing: judgments and calls that do not depend on each other run at
the same time, and a judgment takes seconds on a language model and
well under one on a decision engine. Say "one after another" where
the order matters, and "at the same time" where a reader might
otherwise take the sentences for an order.

## Your project

A workspace is a folder, usually a git repository: the specs, the
files they name beside them, and the compiled agents. An agent's id
is its path from the workspace root. A `cernanto.json` file marks
the root (`{"version": 1}`), so a command works from any folder
below it; without one, the folder you run `cernanto` from is the
root. A command reads all of the workspace, so keep your agents in a
folder that holds them alone: your home folder is refused as a
workspace. A repository that holds other things beside its agents lists
their folders in the marker (`{"version": 1, "folders": ["agents"]}`),
and a folder with a marker of its own is a workspace of its own.
Nothing else is generated, and nothing is ignored.

```
acme-payments/
  cernanto.json                     the workspace's root
  .gitattributes                    *.cern binary
  notifications/
    telegram-send.cern.md
    .cern/telegram-send.cern        the compiled module
  payments/
    reconcile.cern.md
    .cern/reconcile.cern
    recovery.cern.md                payments/recovery, an agent with files of its own
    .cern/recovery.cern
    recovery/                       its folder, named for it
      notify.cern.md                payments/recovery/notify, a part of its own
      prompts/judge.md              a file its spec names: recovery/prompts/judge.md
      .cern/notify.cern
```

**The compiled agent is source.** A deploy writes each agent it compiled
back as one `.cern` file in a `.cern/` folder beside the spec, and you
commit the two together. A recompile costs minutes and money and never
answers the same code twice, so the package is the record of what was
verified: the code the model wrote, the tests that passed with it, its
contract, and the pins of the world at compile time (every npm version and
the lock of its closure, the hash of every agent contract it was
compiled against, the documents behind the APIs it names). The next
deploy starts from it: an unchanged spec lands from the package, with
no compiler in the road, and an edited spec is amended from its code.
Never edit a package and never ignore the folder; mark it binary for
git (`*.cern binary` in `.gitattributes`).

- **An agent's own files live in the folder named for it,** beside its
  spec: the prompts and data it names, the OpenAPI document it
  implements, and a part of its own (`payments/recovery/notify`),
  whose id is its path. The spec stays beside the folder, named for the
  agent, never `agent.cern.md` inside it. Files several agents share
  live in a folder above them. An agent's id is its path, so a spec
  moved to another folder is another agent: it compiles anew under its
  new id, its package left behind, and `cernanto delete` retires the
  old one.
- **Promotion is a deploy of the same commit onto another plane:** the
  bytes the first plane verified land as they are, in dependency order.
- **Agents that are not yours land the same way:** a package from the
  registry, or a package file, is kept in your workspace root's
  `.cern/` folder and committed like your own, and so is every package
  the plane pulls from the registry for an agent of yours: a sentence
  that uses a published agent is enough, the deploy installs it. An id
  with a spec in your workspace has one road, its spec.
- **A published agent taken as source is yours:**
  `cernanto registry get <name>` lays its page beside its package in
  your workspace, with the files the page names, and
  `cernanto registry get <folder>/` does it for every agent under a
  folder. A deploy lands it with nothing to compile, and from then on
  you change its sentences like your own; a later version of the
  registry no longer lands over it.
- **The source of any package is one command away:**
  `cernanto source <id>` prints the page an agent was compiled from,
  deployed, in your tree or in the registry, and
  `cernanto source <id> --to <folder>` writes the page under that
  folder with every file it names, each at its place, for a review, a
  copy to keep, or a start of your own.

## How the agent lives

Most agents are the ordinary kind, a task: each call is its own
world, nothing carries to the next, and the plane runs as many copies
as the calls need. You write nothing about that. Five kinds beside it
change how an agent runs, and a page that is one of them says so on a
`Type:` line, one line in its head, the kind's one home; a page
without one is a task, and the prose still says what the kind means
for the work ("keep one count for everyone who calls this agent"):

| Type:     | When                                                                        |
| --------- | --------------------------------------------------------------------------- |
| task      | the default, with no line: each call its own world, scaling out and to zero |
| service   | it keeps its own state between calls, or a call waits for another           |
| worker    | nobody calls it; it runs on its own time                                    |
| job       | one live run, started over on a failure, nothing in it recorded             |
| module    | it runs inside the agents that use it                                       |
| interface | a contract alone that other agents implement                                |

The compile prints the kind for every agent, so look at the line when
it matters, and `cernanto ls` lists it:

```
examples/basics/counter  plan  reads a service, from the Type: label
examples/basics/clock    plan  reads a worker, from the Type: label
examples/basics/echo     plan  reads a task
```

A kind written anywhere else, a sentence ("A service.") or a word in
the file name (`digest.worker.cern.md`), states nothing: the sentence
is prose and the name is an id with a dot, which the compile refuses.
Changing how an agent lives is changing the line.

What each kind means on the plane, for when you want the detail:

- **task**: every call is its own world; nothing carries to the next
  call, so calls run in parallel and the plane scales the agent across
  cores and servers, down to zero when idle. A failure replays the
  call: its recorded calls are answered from the journal and
  everything else (a fetch, a query, a command) runs again. It fits
  lookups, judgments, notifications, connectors to systems that
  remember for themselves, and deterministic tools (files in, files
  out). A task waits by calling a service's wait function, or holds a
  wait on the world (a provider's push, a poll, a moment) inside its
  own call; that wait says nothing about its kind.
- **service**: the one kind that keeps state. What it remembers
  survives between calls and across a crash; a new version or a
  restart starts with fresh memory, so what must outlive a redeploy
  lives in an agent that owns storage. The wait one call holds and
  another call wakes belongs here (a human approval, a message into an
  open conversation). It serves its calls side by side: a call that
  waits holds nobody up. A wait is a sentence ("waits until the
  approval arrives, or the time given passes"); how the code waits is
  the coder's.
- **job**: a callable operation that runs live, a command-line tool
  whose changing answers steer the work. A retryable failure runs the
  body again from the start, so say what must not happen twice (a
  payment, a message) and the code keys it; a process that dies
  mid-call ends the call, failed, and nothing runs it again. A job
  keeps memory for the life of its process, each copy its own and gone
  with the process (a fact that must outlive it lives in an agent that
  owns storage); it keeps one copy when idle, and may use modules and
  implement interfaces.
- **worker**: a program the plane runs; it starts when deployed, keeps
  its own time in its own words ("every weekday at 18:00"), and no
  other agent may use it. If others need it, it is a service.
- **module**: a capability that runs inside whichever agent uses it,
  like a library function ("render an invoice PDF", "price a quote"),
  with no state of its own and no write of its own that must happen
  once (a send, a charge: a task's). Prefer it when two agents
  would otherwise describe the same how-to, or to keep one
  integration's details out of a busy service.
- **interface**: a contract with no body that several agents
  implement, one per provider, so their callers need not know which
  providers exist. A spec that sends "through an email/client
  provider" reaches email clients; one that says it is "one of the
  email/client providers" is one of them.

The compile holds you to the kind it read: a task that keeps memory
between calls is refused by name, a worker cannot be used by another
agent, an interface cannot carry a body, and services and workers run
no commands; they call a task or a job that does.

An agent owns one responsibility and reaches for other agents for the
rest. A how-to several agents share becomes a module; a step that
stands on its own, should scale, or is worth calling and testing by
itself becomes a task; memory and waits go to a service; a capability
several providers will offer goes behind an interface. The compile
rewards the split: each part is verified by its own tests, a change
recompiles only the part whose sentence moved, and deploying the top
agent compiles or lands everything beneath it.

## What an agent works with

Everything an agent touches is granted on its `Uses:` line; what the
line does not name is unreachable by construction. The entries follow
the colon, separated by commas, or stand one per bullet under a bare
`Uses:`; the prose then names each where the work needs it, and says
what the agent does with it:

- **Another agent**, by its id: `payments/ledger-lookup`, in your
  workspace or already running on the plane. One installed from the
  registry may carry a version (`acme/fact-check@^2`, the 2.x line). A
  worker is never granted, and an agent never grants itself.
- **An npm package**: `npm:grammy@^1`, `npm:pg`, `npm:dayjs`. Say the
  major: the code is written against one major's API. The version a
  compile installs rides the package with the lock of its closure;
  there is no lockfile in the workspace. A package that compiles or
  downloads at install runs its install scripts on the plane as npm
  does on your machine (one compiled from source needs the plane's
  toolchain); an operator turns them off with npm's own
  `ignore-scripts` setting.
- **An account**, through `cernanto/auth`, granted like any agent: the
  agent asks the operator for an account of its own on first use. The
  prose says what the account is and what it must allow (a restricted
  key that may write refunds; a bot allowed to post), never the
  provider's console steps: the compile reads the provider's own page
  when it writes the ask, and steps written into a spec go stale.
- **An MCP server**, by its url: `mcp:https://mcp.stripe.com`; its
  tools become typed functions.
- **A local MCP server**, by the command that runs it, the
  environment it needs in front as `NAME=value` words:
  `mcp:TG_API_HASH=abcd npx -y @chaindead/telegram-mcp`. A command
  runs to the end of its line, so it is the last entry after the colon
  or a bullet of its own. The agent runs the server as a child of its
  own process and its tools become typed functions, as a remote
  server's do. The values ride in the spec as you write them, and the
  server runs where the agent runs, so its program must be on every
  machine of the plane.
- **An OpenAPI document**, by its url:
  `openapi:https://developer.godaddy.com/swagger.json`; its operations
  become typed functions, and a document that authenticates asks the
  operator for the account itself on the first call.
- **A file or a folder** of your workspace: `file:prompts/judge.md`,
  `file:notes/`, a path from the spec's folder, the agent's own folder
  the usual place. A file several agents share is written by its path
  from the workspace root, with a leading `/`. It ships inside the
  agent and is read as files: prompts, templates, lookup tables,
  anything the code needs verbatim, kept out of the prose.
- **The built-in agents** below, by their path like any agent.

The compile prints the line before it writes anything:

```
payments/notify  plan  reads Uses: payments/ledger-lookup, npm:grammy@^1, mcp:https://mcp.stripe.com
```

### The labels

A page declares its premises with five labels and one heading, and a
program reads them, so the same page means the same thing on every
plane and a mistake is refused where it stands:

- `Type:` once, in the head, when the agent is not a task.
- `Uses:` once in the head, what the agent works with; `Implements:`
  once in the head, the interface it is one of or the OpenAPI document
  it serves (`openapi:orders/openapi.yaml`).
- `## Tests` once, and under it the tests' own `Uses:` (a tool only
  the tests use) and `Mocks:` (the agents the tests replace), then the
  sentences about testing.
- `License:` and `Copyright:` once, usually last, under an optional
  `## License` heading.

A label is spelled exactly: the capital, the colon right after the
word, no bold. A near miss is refused with the spelling meant, so a
typo never reads as prose: `"uses:" is not a label; did you mean
"Uses:"`, and `## Testing` gets `did you mean "## Tests"`. A line
inside a fenced code block is an example, never a label, so a page
may quote another page. Everything else on the page is prose, yours;
only a line of prose that happens to open with a label's own spelling
(`Type: ` at the start of a wrapped line) reads as the label, so
start such a sentence another way.

## The built-in agents

Every plane starts with these under `cernanto/`; they are agents like
yours, named, listed, traced and replaced the same way. A page reaches
them by granting them on its `Uses:` line, by their path:

- **decision** (`cernanto/decision`): a decision over your data, answered
  with a value the code branches on. Write it in prose, one shape per
  sentence: "decide whether the customer is entitled to a refund" (an
  if), "classify the message as billing, shipping or technical" (one of
  these), "rate the incident cosmetic, inconvenient, blocking or data
  loss" (a level, the words from least to most), "keep the articles
  that answer the question" (the ones that pass), "order the candidates
  by how well they fit" (best first). A decision the case does not
  settle fails the call rather than guessing, so say what happens then
  when it matters ("when the handbook does not answer it, say so").
  Which engine decides, the language model or a decision model, is the
  plane's binding, which the operator sets; a spec grants
  `cernanto/decision`, never names an engine and reads no setting for
  one.
- **llm** (`cernanto/llm`): what only a language model does: a value
  read out of content ("read the total off the receipt", "the date the
  mail names"), a list written ("list the claims the text makes"), text
  written ("write the reminder as a friendly message"). A picture or a
  document is data too: an attachment or a file read as bytes rides the
  judgment as it is.
- **search** (`cernanto/search`): web-consulted answers, for
  questions needing current outside information.
- **auth** (`cernanto/auth`): credentials are never in specs. Grant
  it, name the account in prose ("through Stripe", "on Telegram"), and
  the agent asks the operator for it on first use; the call parks until the operator
  answers. One account per provider needs no name; a second one is
  named, and the spec says which ("the Google account named billing").
- **webhook** (`cernanto/webhook`): the agent is its own endpoint. It
  asks for the url to hand the provider, waits for each delivery and
  answers it with the reply the provider should see; your spec says
  whose deliveries it takes, what each does and what to reply.
- **config** (`cernanto/config`): the settings the operator writes for
  your agent, each under your agent's id, `<your agent id>/<name>`
  (`cernanto config examples/workflows/helpdesk/bot channel=C01`). Your spec
  names a setting by its bare name ("the channel the configuration
  names under `channel`"); the plane keeps it under your agent's id,
  and your agent reads nothing else. Its own durable state is its
  records.

## Reaching the outside world

The journal of a call holds the calls it makes to other agents, the
operations it makes through the OpenAPI documents and MCP servers it
names, and its own timers, clock reads and random draws. A replay
after a crash runs the call's code again from the start: every call
and recorded operation is answered from the journal, a timer waits
only what was left of it, the clock (`Date.now()`, `new Date()`) reads
the first run's moment at the call's start and again after each of
those steps and runs on with the machine's own between them, so a
deadline computed from it is the first run's and a time measured
across a computation is real, and everything else (a fetch, a
database query, a command) runs again. So the rest of the world is reached through an agent whose job
is that reach: an npm package that talks to a database, a broker or a
vendor's API, a socket, a command, each lives in an agent of its own,
and the agents that need it call that agent. Each exported function
of such an agent does ONE operation against the world, so a retry
repeats one operation, never a sequence. Such an agent is a task,
whose connection or pool is a process-local client, not memory; a
live command whose changing answers steer the work is a job.

Why the rule is not optional: a task that charges a card through an
npm client and then saves through a call charges twice after a crash,
because the replay reaches the charge before it reaches the recorded
call. Split into a `payments/charge` agent and a business agent that
calls it, it charges once. A write that must not double carries an
idempotency key from the call's own business identity (the order id,
the payment id); a database transaction is one exported function that
runs its statements atomically in one call; a read is free to repeat.

```md
# Orders database

Uses: npm:pg

Run one query at a time against the orders database with the pg npm
package and answer its rows. Run a transaction as one call: the
statements given, all or none. Every write is keyed by the id it is
given, so asking twice writes once.
```

## Events, waiting, and time

- Agents talk by calls. An agent that lets others wait for something
  exports a WAIT FUNCTION ("waits until a reply arrives on that thread,
  or the time given passes, and answers it"); inside a service that
  wait is the coder's code over the service's own memory, and no event
  travels between agents. Whether an arrival matters is a sentence the
  code checks after each wake ("only mail from that customer").
- Waiting on a capability is an ordinary function of its interface: a
  mail client interface declares "wait for the next incoming mail,
  filterable by sender and subject", each provider implements it, and a
  consumer calls it ("wait up to three days for the reply from that
  address, remind once").
- A task waits by calling a service's wait function: each of its calls
  runs alone, so nothing one call does can wake another. A job
  subscribes to no other agent's events: a durable agent owns a wait on
  a caller's behalf and calls the job.
- Webhook deliveries are pulled: an agent that works with
  `cernanto/webhook` asks it for the url providers post to, waits for
  the next event with its wait function, and acknowledges it with the
  reply the provider should see. A delivery reaches you through your
  open wait, or through your next wait when it arrived within the last
  thirty seconds while none was open, its provider waiting for your
  answer meanwhile; after those thirty seconds it is the provider's to
  post again, so an agent that takes every delivery keeps a wait open
  and opens the next before slow work; one can reach you twice, so an
  action that must not repeat remembers the provider's own event id:
  "never fulfil the same order twice" is your sentence to write.
- Waiting on the agent's memory is cheap and durable: "if no reply
  arrives, send one reminder". A wait for time ("wait 5 minutes",
  "within 3 days") is a plain `setTimeout`, durable across a crash:
  the fresh process waits what was left of it. A redeploy of a service
  starts its waiting calls again from their first line, the wait
  whole, and with fresh memory, so a deadline that must survive a
  redeploy rides the call that starts the wait, a moment in its input,
  or lives in an agent that owns storage.
- The clock is UTC and the locale C.UTF-8 on every plane, the laptop's
  included, so a call replays the same wherever it runs and a test
  passes the same on the laptop and the servers. A procedure that needs
  a company's local time names the zone ("in Tokyo time"), and the
  code formats with it.

## Tests

You usually write nothing about testing. The compiler derives the
tests from the spec's own prose, runs them live against the deployed
agent, and will not ship code that fails them: every branch your spec
states is already the test plan.

Say how the agent is tested only for what the derived tests cannot
know, and say it in one place: under a `## Tests` heading at the end
of the page, the one home of testing sentences. What you say there
becomes the plan: once a page says how it is tested, the tests prove
what those sentences describe and nothing more, so name every case
you want proved ("prove the four roads: a refund, a late order
refused, a used item refused, an exchange handed to a person"). What
the derived tests cannot know:

- something you want tested in a specific way ("prove the posted
  bytes leave the plane and come back through the front");
- a fact testing needs that the behavior does not carry (a url to
  hit, a sandbox account, a wait that lasts a minute in a test);
- a tool only the tests use, granted on the section's own `Uses:`
  line (`npm:@faker-js/faker` to generate the customers). That line is
  everything the tests may use beyond the agent itself, so grant
  `cernanto/decision` there when your tests judge meaning, and
  `cernanto/llm` when they read text; without it, a machine-only
  agent's tests assert structure and exact values.

```md
Refund the order once, however many times the request comes.

## Tests

The same request sent twice refunds once.
```

Never use testing sentences to restate what the spec already says;
expectations that belong to the behavior are said as behavior, where
they bind the code as well as the tests.

**Testing a connector to a real service.** Its tests need what the
spec must not carry: an address, a conversation, a project key. Put
those in the configuration at the tester's place, `<your agent
id>/tests/<name>` (`connectors/jira/tests/project`), set once per
plane by its operator, grant `cernanto/config` on the Tests section's
`Uses:` line and say that the tests read them, by their bare names. When the proof needs the other side (a mail
received from another mailbox, a comment by another user), connect a
second account of the same provider under the name `tester` and use
it through the same account argument. A connector whose proof is
complete alone (a query, a refund in test mode) needs one account.

### Mocks: when a dependency must not act, or must answer on cue

Tests run your agent and its real dependencies by default. The Tests
section's `Mocks:` line names the dependencies the tests replace with
a mock, for one that must not perform its real actions or one whose
response you need to control. Any agent your page grants can be
replaced; an agent your agent reaches only through another agent is
that agent's to mock, in its own page:

```md
## Tests

Mocks: acme/erp-post
```

That alone keeps the derived tests, with the ERP replaced by a mock the
test session writes from the ERP's contract. Say more when a
controlled response needs saying:

```md
## Tests

Mocks: acme/erp-post

The ERP refuses a posting into a closed period and accepts every
other one. Prove the desk parks a refused entry for a person and
never posts it twice.
```

Live means the actual implementation, with synthetic test data, a test
account on the plane, or the demo company. Reach for one of those
first.

| Situation                                                                                                          | Guidance                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| A dependency classifies text, extracts document fields, searches, or makes a judgment you want verified            | Keep it live. Its actual interpretation matters.                                                             |
| A dependency queries a database or returns a document or report your agent interprets                              | Prefer live with test data. A replacement could invent a format the real system never returns.               |
| A dependency sends messages, changes access, refunds money, or deletes data                                        | Use a real test account when one is available. Otherwise, mock the dependency whose actions must be avoided. |
| You need a particular refusal, empty result, or partial failure that the real dependency will not reliably produce | Use a mock to supply that outcome.                                                                           |
| A dependency is unavailable or too expensive to exercise                                                           | Consider a mock, provided its contract defines enough behaviour to write a meaningful replacement.           |

Keep the judgment running and replace the action that needs
protection: if `acme/review-order` calls the AI and then
`acme/erp-post`, mock the ERP, not the reviewer. A mock replaces
the whole named dependency, so one that both reads important data and
writes may be better served by a test account; a mock needs a
meaningful contract, so a dependency whose answers would need its
private prompt or an undocumented format stays live; the platform's
own agents are never mocked, with one exception, a shadow of
`cernanto/config` answering a test's own fixtures (a loopback endpoint,
a model name), since its answers are the fixtures and nothing of the
platform's behaviour hides behind them; and mocking an AI-backed agent
tests its consumer, not the agent. A mock stands for an agent your spec
already uses, so a testing choice never widens what the production
code may call, and the deploy says which mode proved the agent:
verified live, or verified with mocks for the agents named.

## A module and its user

`billing/invoice-pdf.cern.md`:

```md
# Invoice PDF

Type: module

Uses: npm:pdf-lib

Render an invoice, its lines and its totals, as a PDF with the pdf-lib
npm package, and answer the bytes.
```

Any agent can now grant `billing/invoice-pdf` and say "render the
invoice with billing/invoice-pdf".
In that agent's tests the module's
code runs for real, in process, as does every agent the service uses,
unless the spec says the tests replace one with a mock.

A module deploys on its own, like any agent, verified by its own
tests. Deploying an agent that uses it compiles the module too when it
is in your folder and not yet deployed, or compiles against the
deployed module's contract. Change the module's body and deploy it:
every agent using it rolls onto the new bytes with no recompile. A
change that adds to its contract does the same; a breaking change
recompiles the agents that use it, or goes out under a new name. One
version of a module runs per plane.

## An interface and its family

When several agents provide the same capability through different
providers, an interface gives them one shared contract, so a caller
can name a provider at run time without knowing which providers exist.

`email/client.cern.md`:

```md
# Email Client

Type: interface

An email sending client, the contract every email provider implements.
Two functions. send takes the recipient address, a subject and a
plain-text body, and answers whether the message was accepted and the
provider's reason when it was not; a refused address is a normal
answer, never an error. waitForMailReceived waits for the next
incoming mail, filterable by sender address and by a subject
substring, with a timeout, and answers the mail or null.

## Tests

Every provider's tests check that a syntactically invalid address
answers delivered false, never a throw.
```

An **implementor** says which interface it is one of on its
`Implements:` line. `email/gmail.cern.md`, a task:

```md
# Gmail

Implements: email/client

Uses: npm:googleapis, cernanto/auth

Sends email through the Gmail API with the googleapis npm package, on
the operator's connected Google account, which cernanto/auth holds.
```

The compile holds its surface to the interface exactly and stamps the
conformance onto its deployment, so implementors never drift apart.
Saying what an agent is says nothing of what it may reach: what it
works with is still named where it is used. An interface itself uses
and implements nothing, and a worker cannot implement.

A **consumer** grants the interface and says what it does with it:
"send the mail". Which implementor serves is the interface's default, its one
setting, set by the operator (`cernanto config email/client
default=email/gmail`), and the spec need not say so. A spec may name an
implementor to pin one ("send through email/gmail"), may take the
name as data ("send through the provider named in the request"), and
may name a fallback for a plane that binds none ("the sandbox inbox
when none is bound"); binding a name that is not an implementor fails
in plain words at the first use. Adding an implementor later touches
no consumer. A module
can implement an interface too, and then answers inside the consumer's
process; every other implementor is reached over the wire.

- A consumer's tests go through the implementors the compile finds, on
  the plane or in the workspace; its Tests section grants an
  implementor only to choose among several (`Uses: email/gmail` and
  "send through email/gmail").
- What an interface's Tests section says is the family's: it is applied
  at every implementor's compile beside what the implementor says of its
  own tests, stated once instead of per provider.
- One implementor is a reason to wait with the interface: every
  implementor and consumer recompiles when it changes, so keep
  interfaces small and write one when the second provider is truly
  coming.

## Implementing an OpenAPI document

When the API an agent must serve is already fixed, the document is the
contract: the page names it on its `Implements:` line and says in one
sentence where the agent listens. `orders/orders.cern.md`, beside its
folder `orders/orders/` holding the document:

```md
# Orders

Implements: openapi:orders/openapi.yaml

Uses: acme/accounts, acme/orders-store, file:orders/certs/

Serve the API that the document describes, over https on port 8443
with the certificate and key in certs/, admitting a bearer that
acme/accounts lists as active. Orders live in acme/orders-store under
their id. Reading an unknown id is the document's not-found answer
with the id as the problem's detail.
```

The document becomes the contract, one function per operation named
by its operationId, and the compile generates the server: the typed,
documented, empty functions the coder fills, and the handler that
turns each request into a call of one of them and answers by the
document. Nothing about paths, statuses or shapes is written anywhere:
they are the document's. The port, the protocol, the certificate and
who is admitted are yours, in that one sentence, since the agent
listens for itself, on the port you named, with the document's paths
exactly as written; a certificate is a file beside the spec like any
file a spec names, or a setting of the configuration. A declared error
answer is a refusal answered as the document declares; your spec says
which case gets which. Authentication is the agent's: the document's
security scheme says what a request carries, your sentence says who is
admitted, and the agent refuses the rest. A served request is a call
of the agent, listed and traced like any other. An agent that listens
keeps one copy up and never parks to zero. A task is the usual type for an
API; a service serves the operations beside its other calls. The
document may also be named by a url, so an agent can implement an API
someone else published.

## What the compile warns about

When the agent compiles to a large program, the compile says so and
asks you to move part of what the agent does into another agent that
this one uses. It prints as a warning on the one line every compiler
prints, last, after the card, with its count, the way a compiler ends:

```
support-desk.cern.md: warning: this agent compiles to a large program: move part of what it does into another agent that this one uses
1 warning
```

No sentence settles it; only a split does: a page for the part that
moves, and a `Uses:` on the page that keeps the rest. A warning never
stops the compile.

A page the compile cannot plan (a use it cannot find, a label it
cannot read, a label spelled nearly right) ends with an `error:` line
that names the page and the line, and the road to take beneath it:

```
ops/mailer.cern.md:3: error: "uses:" is not a label; did you mean "Uses:"
```

## Changing a deployed agent

A compile of an agent that already runs starts from the code that
exists, never from a blank page, and does the least the change needs:

- Nothing moved (a redeploy, a reflowed paragraph): the deployed
  agent is kept, in seconds.
- The words moved but the meaning did not: one judgment reads the
  change, finds no code to change, and the package is refreshed with
  the new spec.
- The prose moved, or a dependency was named: one judgment reads both
  specs, the diff and the code, and answers a plan of what the change
  forces and where; the coder modifies the previous code along that
  plan, and the tests are updated where the plan says they must.
- A dependency's contract, an API document, a tool listing or a
  package version moved: the previous code is re-checked against the
  new surface, and only a call site that broke gets a session.

The plan can be asked for alone, the cheapest question to ask of an
unclear edit. A recompile writes the agents you name from their specs
instead, as the first deploy did, and the plane says how many
amendments separate the running code from its last full compile, which
is when a recompile is worth it. A compile does the same work and stops
before the ship, for a package you want in the tree before anything
runs.

## License and copyright

A page states its terms with two labels, usually last, under an
optional `## License` heading:

```md
## License

Copyright: 2026 Acme Payments Ltd

License: MIT
```

The license is one SPDX license expression (`MIT`, `Apache-2.0`, `MIT
OR Apache-2.0` for a choice of two, and `LicenseRef-<name>` for terms
of your own) and the copyright is as you give it, one entry per
holder, several holders one per bullet under a bare colon; the
compile prints both:

```
payments/recovery  plan  reads License: MIT
payments/recovery  plan  reads Copyright: 2026 Acme Payments Ltd
```

Nothing about them reaches the coder: the labels are no part of what
any session sees. They ride into the `.cern` package's manifest
as `license` and `copyright`, and the public registry refuses to
publish a package that states no license. The license of a package
your agent works with is not stated here, and a sentence that has the
agent check or print a license is behavior like any other.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
