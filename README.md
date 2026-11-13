<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cernanto.com/logo/cernanto-logo-on-dark.svg" />
    <img src="https://cernanto.com/logo/cernanto-logo-on-light.svg" alt="Cernanto" width="360" />
  </picture>
</h1>

<p align="center"><b>A programming language for AI agents and workflows: written in plain English, compiled to verified TypeScript, run durably on your own machines.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/cernanto"><img src="https://img.shields.io/npm/v/cernanto?style=flat-square&label=npm" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-26%2B-339933?style=flat-square" alt="Node.js 26 or later" /></a>
  <img src="https://img.shields.io/badge/runs%20on-macOS%20%7C%20Linux%20%7C%20Windows-555555?style=flat-square" alt="Runs on macOS, Linux and Windows" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20BSL%201.1-blue?style=flat-square" alt="License: Apache 2.0 and BSL 1.1" /></a>
  <a href="https://github.com/cernanto/cernanto/discussions"><img src="https://img.shields.io/badge/discussions-join-8250df?style=flat-square" alt="Discussions" /></a>
</p>

Cernanto is a programming language and runtime for writing systems of agents in plain English.

Write tasks, stateful services, reusable modules and interfaces in Markdown. The compiler derives a typed contract for each callable agent, and other agents compile against that contract, so they use its capabilities without knowing its implementation.

Calls between agents become typed function calls. Modules run inside their callers; a call to a service reaches the right process, on the same machine or across a cluster; the runtime handles routing, waits and recovery.

Cernanto compiles your specifications into TypeScript and checks the implementation with types and tests written from the spec. The specifications remain the source you maintain: change a policy, reuse a module, or bind another provider to a shared interface, and deploy again.

Connect existing services through OpenAPI, MCP and npm, and use AI where a judgment is needed while code runs the workflow around it: a decision from a decision model such as Jev or from the language model you signed in with, and text from the language model. Write a support agent, an approval workflow, a refund API or an assistant over your documents. Start with a working example system on your laptop, then connect your own services.

It runs on your laptop and is free on your own machines. You never write or see TypeScript: the compiler drives the coding assistant you already have, Claude Code or Codex, signed in on your machine with its Claude or ChatGPT subscription, to write the code from your specification, then gates and tests it.

If a crash has cost you a run that was half done, if your agent took a different path the second time, or if your workflow grew a state table and a polling loop to stay alive, this is for you. It replaces what you would draw on a low-code canvas such as n8n, Zapier or Make, write for a workflow engine such as Temporal, or hand to an agent loop on LangGraph or CrewAI.

[Website](https://cernanto.com) · [Writing agents](docs/WRITING-AGENTS.md) · [Examples](agents/README.md) · [Discussions](https://github.com/cernanto/cernanto/discussions)

A whole agent, `reminder.cern.md`:

```md
# Reminder

Given a message and a number of minutes, wait that long, then answer
the message.
```

Give it two days and kill its process tomorrow: the answer still arrives on time. In your stack today this is a queue, a worker, a delayed job, a state row, a retry policy and a log to grep. Here it is that sentence.

Cernanto's compiler and control plane are themselves written in Cernanto: about 17,000 lines of English, compiled into about 58,000 lines of TypeScript and 29,000 lines of tests. Read their source in [`cernanto/`](cernanto/).

## Install

Node.js 26 or later, on macOS, Linux or Windows.

```bash
npm install -g cernanto
```

The precompiled examples deploy with Node.js alone and run up to their first judgment. Compiling an agent of your own, and any step where an agent asks a model, run on Claude Code or Codex, installed on this machine and signed in with your own Claude or ChatGPT subscription, or on an API key you set instead. Linux also needs `bubblewrap` and `socat`.

## Quickstart

Start the plane, the local runtime that compiles and runs your agents, and deploy the precompiled examples, in seconds:

```bash
cernanto dev
git clone https://github.com/cernanto/cernanto
cd cernanto/agents
cernanto deploy examples/
```

Then `cernanto call examples/basics/counter next` answers `1`, from a service that keeps its count across a crash.

Without git, the same examples come from the Cernanto registry as source, each page beside its package, into a folder of your own:

```bash
mkdir agents
cd agents
cernanto registry get examples/
cernanto deploy examples/
```

Next, run the support desk: call it on a ticket, answer from a second terminal, kill its process in the middle and watch the call resume, then change a sentence of its page and deploy again. [Run it yourself](#run-it-yourself) has the commands.

| I want to                                  | Start here                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learn to write agents                      | the [basics tour](agents/examples/basics/README.md), seventeen tiny agents, one lesson each, nothing to connect                                      |
| Use my coding assistant                    | [the skill](#writing-agents-with-your-coding-assistant): one command installs it, then ask for the agent in a sentence                               |
| Automate a process                         | the support follow-up below, or the helpdesk for the quickest personal win                                                                           |
| Compare it with n8n, Temporal or LangGraph | [Coming from n8n, Temporal or an agent framework](#coming-from-n8n-temporal-or-an-agent-framework): what changes, and who should stay where they are |
| Connect my systems                         | [Connect your services](#connect-your-services) and each workflow's real-service diff                                                                |
| Evaluate it for work                       | [Guarantees and limits](#guarantees-and-limits), then the production notes at the end                                                                |

## Why compile an agent

Put a model in the control loop and it decides every step. Suppose it is right 99 percent of the time: a ten-step procedure then finishes correctly about nine times in ten, and a process that runs a thousand times a month goes wrong about a hundred times. Have a model write the code once instead, and the code works but the source is lost: the intent lived in a chat, and every later change is made to the output.

Cernanto keeps the source and compiles it. The procedure is code that takes the same path every time, and the 1 percent does not disappear: it becomes a wrong classification, recorded, in a declared branch, which you can review and bound.

<details>
<summary><b>The full argument, with its measurements and sources</b></summary>

**An agent that is right 99 percent of the time.** A runtime agent puts the model in the control loop: on every step it reads its instructions, picks the next tool and decides what comes next. Suppose it decides correctly 99 percent of the time. A ten-step procedure then finishes correctly about nine times in ten, and a process that runs a thousand times a month goes wrong about a hundred times. Measured, it is worse: in the tau-bench study of 2024, the best model then completed a retail customer-service task correctly about six times in ten on the first try, and under a quarter of the time when it had to succeed eight runs in a row [1]. The failures are not noise: rule violations pass outcome scoring unseen [2], and in production the wrong decision has taken whatever action the tools allowed, a deleted database, a production environment deleted and recreated [3]. A better model raises the 99 and does not change the shape: a probabilistic decider on every step compounds, the same input may take a different path next time, nothing can be tested before the run, and the record is a transcript. And when the provider updates the model, the behavior of every running agent changes overnight, with no diff and no event. That is why the pilots demo well and fail QA [4].

**Code whose source was a conversation.** The other way to use a model is to have it write the code once. It works, and it loses the source. The intent lived in a chat; the code shipped; six months later a requirement changes and someone, or some model, reads the code to reconstruct what it was for. Every later change is made to the compiler's output, which is editing the emitted assembly after losing the higher-level source, and a better model next year cannot be applied to this year's work because there is nothing to recompile. Keeping a spec beside the code helps; keeping it authoritative through every later compile is a different commitment, and nothing in that workflow gates the spec, keeps its tests, limits what the code may reach, or recompiles it.

**What an enterprise needs.** Repeatability, so QA can sign off. Bounded failure, so security can approve. Evidence, so audit can accept it. A budget that does not move with the model's mood, so finance can plan. Independence from the model's availability, so operations can commit. Rules the operations lead can read and change, so the business owns its own procedure. A runtime agent gives none of these by default; code whose source was a conversation gives the first three and loses the intent. Cernanto keeps the source and compiles it once, at compile time, and `.cern.md` says so the way `.ts` says typed. The 1 percent does not disappear; it becomes a wrong classification, recorded, in a declared branch, which an enterprise can review, bound and insure.

1. Yao et al., [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045), Sierra, June 2024. On the retail tasks the best model then, gpt-4o, reached pass^1 of 61 percent and pass^8 below 25 percent.
2. Sharma, Barke and Zorn, [Willful Disobedience: Automatically Detecting Failures in Agentic Traces](https://arxiv.org/abs/2603.23806), 2026, the paper behind AgentPex: rule violations and wrong routing found in traces that outcome scoring had passed.
3. The Replit agent that deleted SaaStr's production database during a code freeze, July 2025 ([The Register, 21 July 2025](https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/)); and, as the Financial Times reported on 20 February 2026, Amazon's Kiro deleting and recreating a live AWS Cost Explorer environment in December 2025, a thirteen-hour outage that Amazon attributes to a user's access error and not to the tool.
4. McKinsey, [The state of AI in 2026: On the road to ROI](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai), August 2026: 40 percent of large organizations scaling agents, the share reporting any EBIT impact unchanged at 37 percent. Gartner, [Gartner Predicts Over 40% of Agentic AI Projects Will Be Canceled by End of 2027](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027), 25 June 2025. MIT Project NANDA, [The GenAI Divide: State of AI in Business 2025](https://nanda.media.mit.edu/ai_report_2025.pdf), July 2025: 95 percent of pilots with no measurable return.

</details>

## How it works

```text
agent.cern.md     a page of plain English, in git: the source you maintain
      |
   compile        your coding assistant writes TypeScript from the page
      |
    gates         the type-check and static scans; the code reaches only what the page names
      |
    tests         a second session writes them from the page and never sees the code
      |
  live proof      the tests run against the deployed agent and its real dependencies
      |
 agent.cern       the package: the page, the code, the tests and the contract, committed beside the page
      |
  the plane       durable processes on your laptop or your own servers, every call journaled
```

A change to a sentence amends the code it wrote rather than starting over, and the tests move only when the promise did. At run time a model is asked only where the page calls for a judgment, and its answer is recorded.

## An example: the support follow-up

A Cernanto agent is one markdown file, `<id>.cern.md`: the page says in plain English what the agent does, and a few labeled lines declare what kind of agent it is when that matters and everything it works with; your coding assistant can write one from a sentence. This is `examples/workflows/support-follow-up.cern.md` from the examples, one of their desks, a workflow that handles one kind of request from start to finish:

```md
# Support follow-up

Given the id of a new support ticket, read it from examples/sandbox/crm and
classify its message with cernanto/decision as billing, technical or
account access. When the message does not say which, post it to the triage
channel for a person to sort, and stop there. Otherwise record the
category and the team on the ticket, tell the team assigned to that
category on its channel, and wait for a person to respond on the
ticket; a response on the ticket counts whether it was already there
when the ticket was read or was recorded any time after, however
soon. The teams by category and their channels are in the file
support-follow-up/teams.json. If nobody responds within the response
window, send the team one reminder on the same channel.
Answer the category, the team and its channel, and how it ended: a
response, a reminder, or triage.

Tell the teams through connectors/chat, on the plane's chat provider,
with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane
binds none. The response window is the minutes
given with the request, else the minutes the configuration names under
`response-window-minutes`, else two days.

Uses:

- examples/sandbox/crm
- cernanto/decision
- file:support-follow-up/teams.json
- connectors/chat
- cernanto/config
```

The file goes on with its `## Tests` section, what the tests use and how to prove the desk, and its license labels. The compile prints the page's labels back before it writes anything:

```
examples/workflows/support-follow-up  plan  reads Uses: examples/sandbox/crm, cernanto/decision, file:support-follow-up/teams.json, connectors/chat, cernanto/config
examples/workflows/support-follow-up  plan  reads the tests; Uses: examples/sandbox/crm, examples/sandbox/chat, cernanto/config
```

Two sentences of that spec, the lines of TypeScript they became, and the trace of them running:

```md
classify its message with cernanto/decision as billing, technical or account access
wait for a person to respond on the ticket
```

```ts
const decision = await cernantoDecision();
verdict = await decision.decideWhich(
  { subject: ticket.subject, body: ticket.body },
  'Which kind of support request does the ticket message make: a billing matter (charges, invoices, refunds, payments), a technical problem with the product, or a problem with account access (login, password, permissions)? If the message does not clearly say which, choose the option that says so.',
  [...CATEGORIES, NOT_SAID],
);
const response = await waitForTicketResponse(id, slice);
```

```
12:41:54  → Decision
            Decide which
            Prompt: Which kind of support request does the ticket message make: a billing matter ...
12:42:01  ← Decision  6.2s
            account access
```

The model classifies the request. The compiled program applies the routing, waits for the response, checks the deadline and sends the reminder; an inconclusive classification has an explicit path to a person. The model is called at the first of those lines and nowhere else, and a restart during the wait resumes it with the classification already recorded. The team table is a file the page names and never describes; the coder reads it before writing the code that uses it.

Two changes you will make first: swap the chat provider by binding another implementation of the same interface, in configuration, with nothing recompiled; and change the policy by editing a sentence of the spec, where the amend recompiles only what the sentence touched.

<details>
<summary><b>The parts of this system, and what a contract is</b></summary>

The spec is one part of a system, and the file's type says how each part lives:

| Part                                   | Type      | Its responsibility                                                        |
| -------------------------------------- | --------- | ------------------------------------------------------------------------- |
| `examples/workflows/support-follow-up` | task      | applies the routing policy to one request: classify, route, wait, remind  |
| `examples/sandbox/crm`                 | service   | owns the tickets and holds the wait for a response                        |
| `connectors/chat`                      | interface | the chat operations the workflow depends on: send a message, wait for one |
| `examples/sandbox/chat`                | service   | implements that interface over the fictional company's channels           |
| `connectors/slack`                     | task      | implements the same interface against Slack                               |
| `teams.json`                           | file      | the teams by category and their channels, named by the workflow           |

A contract is what one agent exposes, its operations, inputs and results, and consumers compile against that boundary. An interface is a shared contract several providers implement. The workflow calls the chat interface; the company's chat service and the Slack connector both implement it, so switching providers changes the binding while the workflow keeps the same contract. The invoice approval adds the email interface, a rate from a keyless connector, a PDF read by judgment with the arithmetic in code, and a purchasing service that owns the orders, the receipts and the books.

</details>

## Run it yourself

Run the example system. Change one policy. Swap a provider. Watch it recover from a restart.

<details>
<summary><b>What you need, in full</b></summary>

- Node.js 26 or later, on macOS, Linux or Windows. Linux also needs `bubblewrap` and `socat`.
- Claude Code or Codex, installed on this machine and signed in with a paid Claude or ChatGPT subscription. The compiler uses it as its harness: the coding assistant writes the TypeScript from your specification on your laptop, the compiler gates and tests it, and your agents' judgments run on the same sign-in. The login is the tool's own: install Claude Code or Codex from its vendor and sign in inside it once. `cernanto dev` finds the login on its own, or offers the sign-in at the terminal; `cernanto dev --coder claude` or `cernanto dev --coder codex` chooses when both are signed in. A compile spends a few minutes of the subscription; a judgment is one call to it, whose usage `cernanto ls` reports. The sign-in stays the tool's own: Cernanto never reads or keeps it, and what you spend of the subscription is under its vendor's terms. An API key works instead, set under the coder's own agent (`cernanto config cernanto/harness/claude-code api-key=<key>`, then `mode=api-key`, or the same two under `cernanto/harness/codex`), and a plane on servers always runs on one.
- The precompiled examples land with Node.js alone, in seconds, and run up to their first judgment; the counter runs whole: `cernanto call examples/basics/counter next`. A decision engine the plane is pointed at, such as Jev, answers decisions on its own key.

The cli is one install:

```sh
npm install -g cernanto
```

The first `cernanto dev` installs the local runtime (`@cernanto/runtime` from npm at the same version) under `~/.cernanto`, pulls the platform's agents, which are packages of the Cernanto registry like any agent's, then starts the plane: it lands the platform's npm dependencies under `~/.cernanto`, starts its gateway on port 7434, and touches nothing else. The gateway listens on every address of the machine and takes a request with no operator token from this machine alone. An agent that serves an API of its own listens on its port as any server does, on every address: of the examples, `examples/basics/orders` on 8080 and `examples/workflows/refund-desk` on 8085, whose requests run on your sign-in, so land those two on a network you trust. `cernanto dev down` stops it, `cernanto dev reset` wipes its data, and `npm uninstall -g cernanto` with `rm -rf ~/.cernanto` removes it. A new release arrives with `npm install -g cernanto@latest`; it updates the runtime under your agents at their next start and none of your generated code until you recompile.

</details>

### The walkthrough

One desk, start to finish, in a session. Every command runs from `agents/`; each step says what it needs. The outputs are cut from real runs on the sandbox company; the ids change, the shapes do not.

1. **Run a support request** and watch its conversation: the ticket read, one judgment, the team told on its channel.
2. **Answer the ticket** from a second terminal, and the waiting request wakes.
3. **Watch the reminder** on a ticket nobody answers.
4. **Interrupt it:** kill the desk's process twenty seconds in. The call resumes from its journal, the judgment asked once and the post not repeated.
5. **Change the policy** by adding a clause to a sentence. The compile amends the code it wrote and updates the tests.
6. **Connect Slack** with one setting and no recompile.

<details>
<summary><b>The commands, step by step</b></summary>

**Deploy the examples.** The basics, the sandbox company and the desks: no account, no AI, seconds. Each connector's README deploys it with its own account.

```sh
git clone https://github.com/cernanto/cernanto
cd cernanto/agents
cernanto deploy examples/
```

**Run a support request.** One judgment, on your Claude Code or Codex login. The desk waits two days for a person to respond; set the window to a minute for the session; a setting is kept under the id of the agent that reads it. In one terminal, call the desk on a seeded ticket: at a terminal the call prints its conversation as it goes (the ticket read from the CRM, one judgment with its prompt and answer, the team told on its channel) and stays attached while the request waits.

```sh
cernanto config examples/workflows/support-follow-up response-window-minutes=1
cernanto call examples/workflows/support-follow-up followUp ticketId=T-7004
# parks until a person responds on the ticket
```

**Answer the ticket.** In a second terminal, a person's part is an invoke on the fictional company's CRM; whether it lands before or after the desk has told the team, the desk counts it. The waiting request wakes, and the first terminal prints its answer:

```sh
cernanto call examples/sandbox/crm recordResponse --args '{"ticketId":"T-7004","responder":"rami","message":"Refund of the second charge is on its way, sorry about that."}'
```

```
{"category":"billing","team":"Finance","channel":"#finance","outcome":"response"}
```

**Watch the reminder.** A ticket nobody answers ends after the window with one reminder on the team's channel, and the trace reads the whole call as a conversation.

```sh
cernanto call examples/workflows/support-follow-up followUp ticketId=T-7003
```

```
{"category":"account access","team":"Support","channel":"#support","outcome":"reminder"}
```

```sh
cernanto call examples/sandbox/chat read chat="#support"
```

```
[... {"from":{"id":"@acme","name":"acme"},"text":"New account access ticket T-7003 for Support (from piet.devries@example.nl): Cannot log in to the storefront\n\nThe password reset mail never arrives.
     {"from":{"id":"@acme","name":"acme"},"text":"Reminder: account access ticket T-7003 (Cannot log in to the storefront) has had no response yet.", ...}]
```

**Interrupt it.** Run a third ticket with the minute window, and twenty seconds in kill the desk's process (its folder is `examples-workflows-support-follow-up` and a port). The plane brings the process back, the call resumes from its journal, and the answer arrives when an uninterrupted run's would: the trace shows the judgment asked once, the post made before the kill and not repeated, and the reminder on schedule.

```sh
cernanto call examples/workflows/support-follow-up followUp ticketId=T-7005 &
sleep 20; kill -9 $(lsof -c node 2>/dev/null | awk '$4 == "cwd" && /workflows-support-follow/ {print $2}')
```

On Windows the process is found by the folder on its command line and ended with the system's own kill, in PowerShell:

```powershell
PS> taskkill /F /PID (Get-CimInstance Win32_Process -Filter "Name='node.exe' AND CommandLine LIKE '%workflows-support-follow%'").ProcessId
```

```
{"category":"technical","team":"Engineering","channel":"#engineering","outcome":"reminder"}
```

**Change the policy.** Add a clause to the first paragraph of `examples/workflows/support-follow-up.cern.md`, "tell the team assigned to that category on its channel, naming the order the message is about when it names one", and deploy, on your Claude Code or Codex login. The compile amends the code it wrote rather than starting over: the change judged in words, the code amended in seconds, the tests updated because the promise moved, the live run.

```sh
cernanto deploy examples/workflows/support-follow-up
```

```
examples/workflows/support-follow-up  reads a task
compiling ................................
Support Follow Up   examples/workflows/support-follow-up   agent   deployed   verified live in 2m47s, 4 tests
```

Put the window back to its two days when you are done: `cernanto config examples/workflows/support-follow-up response-window-minutes=2880`.

**Connect Slack.** `cernanto config connectors/chat default=connectors/slack` switches the desk's chat without a recompile, because the sandbox chat and Slack implement one interface. The next call parks on the connector's ask for its account, a Slack app's bot token and signing secret, printing the steps that create the app and the exact `cernanto auth login connectors/slack` line; log in from another terminal and the parked call resumes, the post arriving in the real channel. Connecting Jira is different, because it replaces the ticket dependency and recompiles the desk.

**Recompile under the other coding assistant,** if you have both: `cernanto dev --coder codex`, then the kept tests run against the new implementation.

```sh
cernanto deploy --recompile examples/workflows/support-follow-up
```

</details>

### One file of your own

Make a folder for your agents and put one file in it, `acme/ops/reminder.cern.md`, the reminder from the top of this page:

```md
# Reminder

Given a message and a number of minutes, wait that long, then answer
the message.
```

From `acme`, `cernanto ops/reminder.cern.md` compiles it, writes and runs its tests, ships it and prints the invoke line, in a few minutes; it writes `ops/.cern/reminder.cern` beside the spec, the code, the tests, the contract and the pins of the compile, and you commit the two together. Then give it a judgment, ask for the message rewritten as a friendly reminder with cernanto/llm, deploy again, and watch the amend. The other desks are in the [examples](agents/README.md) with what each one needs: the helpdesk over your own documents, the expense desk that reads a receipt off a photo, the mail router and the chat router over the shared inbox and channel with the order-status handler behind them, the renewal desk, and the homelab alert through the webhook.

### Writing agents with your coding assistant

Claude Code, Codex and any assistant that reads Agent Skills write and change agents well once they have the language's skill. In your workspace, `cernanto skill` installs it into `.claude/skills/` and `.agents/skills/`, where the assistants find it on their own; `cernanto skill --global` installs it once for every workspace on the machine. The skill is the author's guide and the loop the assistant runs: write the agent, deploy, read what the compile read from the page, fix the words. Then ask for the agent in a sentence, "a desk that reads new tickets from Jira and tells the team on Slack": the assistant writes the file, deploys it, reads the compile's reading and the trace, and changes the sentence when the compile read something else. It never writes the TypeScript, and neither do you. The same guide is for you: [Writing agents](docs/WRITING-AGENTS.md).

## Examples

Every example runs on the fictional company in `examples/sandbox/`, so none needs an account with an outside service.

| You want to                                               | Start with                                                                                                                                                               | It shows                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| follow up on support tickets                              | [`examples/workflows/support-follow-up`](agents/examples/workflows/support-follow-up/README.md)                                                                          | classify, tell the team, wait for a person, remind once                  |
| answer questions from your own documents                  | [`examples/workflows/helpdesk`](agents/examples/workflows/helpdesk/README.md)                                                                                            | a judgment grounded in your files, and a chat bot on top                 |
| approve invoices against orders and receipts              | [`examples/workflows/invoice-approval`](agents/examples/workflows/invoice-approval/README.md)                                                                            | a document read by judgment, exact arithmetic in code, an approval chain |
| decide refunds under a written policy                     | [`examples/workflows/refund-desk`](agents/examples/workflows/refund-desk/README.md)                                                                                      | a policy file, and an OpenAPI server other systems call                  |
| approve expenses from a photo of the receipt              | [`examples/workflows/expense-desk`](agents/examples/workflows/expense-desk/README.md)                                                                                    | a picture read by judgment, one field at a time                          |
| route the team's mail or chat to the desk that handles it | [`examples/workflows/mail-router`](agents/examples/workflows/mail-router/README.md), [`examples/workflows/chat-router`](agents/examples/workflows/chat-router/README.md) | rules before a judgment, and the same handlers behind mail and chat      |
| renew a contract by mail once a year                      | [`examples/workflows/renewal-desk`](agents/examples/workflows/renewal-desk/README.md)                                                                                    | a conversation the agent starts: send, wait, counter once, record        |
| act on an alert from your homelab                         | [`examples/basics/hook`](agents/examples/basics/README.md)                                                                                                               | a webhook through the hosted relay                                       |

The [examples guide](agents/README.md) has them all, with what each one needs.

## Coming from n8n, Temporal or an agent framework

### Outgrowing n8n, Make, Zapier or Power Automate

What you draw on a low-code canvas as triggers and steps is here a page of English, like the support follow-up above. What changes when the workflow has to hold in production:

- **A crash in the middle of a run.** Every call and effect is journaled, so a killed process resumes where it stopped, and the calls it had already made are answered from the journal, not made again. No state machine in a database, and no workflows that poll it.
- **Git and review.** The page lives in git and is reviewed as a diff, where an exported JSON was.
- **Your coding assistant.** Claude Code or Codex writes and changes the page from a sentence, and code you already have rides as an npm package.
- **Triggers.** A webhook the agent waits on, a worker that keeps its own time, or a call from your application over HTTP.
- **Parallel steps.** Steps that do not depend on each other run at the same time.
- **Retries.** How to retry is a sentence on the page, such as "on a rate_limited error, wait the Retry-After seconds and try again".
- **Debugging.** One trace shows the whole call, read as a conversation in the terminal.
- **Before it ships.** The compiled code is tested against the real services.
- **Connections.** A service is connected by naming its OpenAPI document, an MCP server or an npm package, so no catalog decides what you can reach.
- **Cost and custody.** It runs on your own machines under your own credentials, with no fee per task.

A canvas remains a good home for prototypes and internal automations, and for anyone who wants a visual editor, a catalog of ready-made app connections and nothing to install: Cernanto asks for a terminal, git and a coding assistant.

### The next stop: Temporal, Inngest, Restate or AWS Step Functions

A common next stop is the code-first road: a durable workflow engine, with a coding assistant writing the TypeScript. The guarantee here is the same kind, durable execution: every call, timer and judgment is journaled, a crash or a restart resumes where it stopped, and a replay answers the calls already made from the journal, so a retry repeats one operation, never the sequence before it. The difference is what you keep. There you write and maintain the workflow yourself, as code held deterministic by the engine's rules or as a state machine definition; here the page stays the source, the compiler writes the code, a gate checks its determinism, and a second session tests it live before it ships. Keep an engine when you want that code in your own hands and in your own language.

### Coming from an agent framework: LangGraph, CrewAI, Mastra or an agent SDK

There you write and maintain the orchestration in Python or TypeScript, and where you hand the steps to an agent loop, a model chooses each one at run time. Here you maintain the English and the compiler writes the TypeScript; a model is asked only at the sentences that call for a judgment, and its answer is recorded, so a restart takes the same path without asking again. A framework's agent loop remains the tool for open-ended work, where the agent must find its own steps.

### Coming from spec-driven development: Spec Kit, Kiro or a coding assistant with a spec file

Those hand a specification to a coding assistant and leave the rest to the session and to you. Cernanto is a compiler and a runtime around that step: the page stays the source, the code may reach only what the page names, gates and independent live tests decide whether it ships, and a change to a sentence amends the code it wrote. It drives the same assistants, Claude Code or Codex.

## Coming from Python or TypeScript

What you keep of your existing stack:

- **An existing Python or TypeScript service** is one sentence that names its OpenAPI document, and it stays where it runs.
- **Python packages** do not run inside an agent; expose the logic as a service with an OpenAPI document, or as an MCP server, and name it.
- **TypeScript logic** rides as an npm package, published or private, and is named like any other.
- **Your application calls a deployed agent** over HTTP. The refund desk implements an OpenAPI document and listens for itself on the port its spec names, so any client calls it:

```python
import requests
r = requests.post("http://127.0.0.1:8085/refund-requests",
                  json={"orderId": "A-1012", "message": "The notebooks arrived but I ordered the wrong size. They are unused, still in the box. Could I get a refund?"})
print(r.json())
```

```ts
const r = await fetch('http://127.0.0.1:8085/refund-requests', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    orderId: 'A-1012',
    message:
      'The notebooks arrived but I ordered the wrong size. They are unused, still in the box. Could I get a refund?',
  }),
});
console.log(await r.json());
```

And the shape of what you write instead:

| You write today                                                                   | Here                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a function, a serverless handler                                                  | a task, the default: each call its own world, scaling out and to zero                                                                                             |
| a stateful microservice, an actor, a state row                                    | a service ("remembers between calls"): memory across calls and restarts, waits that cost nothing                                                                  |
| a package or a library                                                            | a module ("linked into the agents that use it"): runs inside every agent that uses it                                                                             |
| an interface, dependency injection                                                | an interface ("a contract every provider implements"): implementors bound by name at run time                                                                     |
| a cron job, a background process                                                  | a worker ("every weekday at 18:00; nobody calls it"): a program that keeps its own time                                                                           |
| a subprocess, a retry-from-scratch job                                            | a job ("runs the vendor's tool, retried from the start"): one live operation                                                                                      |
| import, requirements.txt, package.json                                            | a sentence that names it: an agent, an npm package, an MCP server, an OpenAPI document, a file                                                                    |
| a queue, a retry policy, an idempotency table, a state machine in a database      | the journal: every call and effect recorded once and resumed after a crash                                                                                        |
| an LLM call with structured output, a classifier prompt                           | a judgment ("classify its message as billing, technical or account access"): a typed answer the code branches on, recorded once and never asked again on a replay |
| a human-in-the-loop step, an approval queue, a workflow that polls for the answer | a wait ("wait for a person to respond"): it costs nothing while it waits and resumes after a restart                                                              |
| a fan-out over a list, then a join                                                | "at the same time": calls and judgments that do not depend on each other run in parallel                                                                          |
| tool calling, function calling                                                    | a sentence that names the tool: its operations become typed functions the code calls, and the model answers without acting                                        |

Microservices without the infrastructure: a call to a service is a function call, in process or across nodes, and no Dockerfile, queue, retry loop, cron table, service discovery or client stub is yours to write. You never write TypeScript and never need to read it; when you want to, it is plain Node with the packages you named, and `cernanto code <agent>` prints it. State lives in a service's memory across calls and restarts; a redeploy starts a fresh version with fresh memory, in which its waiting calls start again from their first line, so what must outlive a version goes to a database, through the Postgres connector.

## The architectures, side by side

Every claim here is checkable in an afternoon. The source is English: open any folder in `agents/` or `cernanto/`. Every agent ships with tests its writer never saw: open any package. A replay never re-asks a judgment: stop the runtime during a wait and read the trace. The same spec recompiles under another model: `--recompile` under the other coding assistant, then the kept tests. A spec with no judgment runs with no model: deploy `examples/basics/counter` and read its trace. The compiler is written in the language: open [`cernanto/compile.cern.md`](cernanto/compile.cern.md) and its twenty modules.

| Architecture                                                                   | The source kept         | The model at run time      | Checked before it runs             | Survives a restart | Replicated on a cluster |
| ------------------------------------------------------------------------------ | ----------------------- | -------------------------- | ---------------------------------- | ------------------ | ----------------------- |
| A prompt-driven agent loop (an agent SDK, CrewAI)                              | a prompt                | every step                 | not by default                     | not by default     | if you add it           |
| An instruction file a model interprets on each run                             | the file                | every run                  | not by default                     | not by default     | if you add it           |
| A coding assistant writing code you then maintain (Claude Code, Codex, Cursor) | the chat, then the code | none                       | you read the code                  | if you add it      | if you add it           |
| A workflow engine with hand-written code (Temporal, Inngest, Restate)          | the code                | wherever you call one      | your tests                         | yes                | yes                     |
| A compiled agent (Cernanto)                                                    | the spec, in git        | only at declared judgments | gates, then independent live tests | yes, journaled     | yes, the same package   |

The examples' comparison folder puts the refund policy beside its two implementations, the prompt-driven loop on an agent SDK with equivalent idempotency and recovery, and the compiled workflow, and the measured report follows when the nightly has run it.

## Connect your services

Today an integration is written by hand, the client, the auth, the pagination, the retries and the tests, and kept working when the API changes; or rented from a service that charges per call, holds your credentials under its own app registration, and sees every record that passes through it. Here anything with a REST API and an OpenAPI document, an MCP server, or an npm package that talks to it is one sentence that names it. The compiler turns its operations, tools or API into typed functions, your coding assistant reads the vendor's own documentation and writes the integration code, and the tests prove it against the real service before it ships; when the vendor's API document moves, the next deploy re-checks the code against it and names what broke. The code runs in your own process under your own credentials, connected once and held in your custody, and there is no per-call fee.

<details>
<summary><b>Two connectors in full, and what the setup is</b></summary>

A public API, keyless, in one sentence, and an internal one, authenticated:

```md
# Open-Meteo

Given a place as latitude and longitude, answer tomorrow's forecast
for it from Open-Meteo's free forecast, which needs no account and
whose API is documented at
https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi/forecast.yml:
the highest and the lowest temperature in degrees Celsius, the chance
of rain as a percentage, and one word for the sky (clear, cloudy, rain
or snow), chosen with cernanto/decision, with the date the forecast is for.

Uses:

- openapi:https://raw.githubusercontent.com/open-meteo/open-meteo/main/openapi/forecast.yml
- cernanto/decision
```

```md
# Order Lookup

Given an order id, answer its status and its total from the orders
API documented at https://orders.acme.internal/openapi.json.

Uses: openapi:https://orders.acme.internal/openapi.json
```

```sh
cernanto auth login acme/orders orders.acme.internal   # answers the agent's ask: paste the token
```

The declaration is the one sentence; the setup is named beside it: the account logged in once, as the agent's own, into the plane's safe; a file the page names for a lookup table; and, for the tests, a second account of the provider logged in as `tester`, or a sentence that says the tests replace the one dependency whose real action a test must not cause. The other direction is one sentence too: "serve the API that openapi.yaml describes" makes your agent the server of that document, listening on the port its spec names, as the refund desk is.

</details>

Events arrive through a wait. An agent that works with `cernanto/webhook` is its own endpoint, and on a laptop or a homelab the free hosted relay at hooks.cernanto.com fronts it with no public IP, DNS record or certificate on your side, so a Stripe payment, a GitHub push or a form submission reaches the wait your agent keeps open the moment it happens.

The catalog under [`connectors/`](agents/connectors/README.md) holds the email and chat interfaces, four keyless connectors (the ECB's euro rates, Open-Meteo, DeepWiki, ntfy) and seven connectors to real services (Slack, Gmail and the Google client module it shares, Jira, Postgres, Stripe and HubSpot), each a spec of a few lines beside its package, named by its id and asking for its account on the first call that needs it; each desk's README carries its real form as a diff. It is not a count: a service not in it is one sentence away, and the connector you write for your own tools is the same kind of file.

## Decisions

A workflow is full of small decisions: is this a refund request, which
team handles it, how severe is it, which of these articles answer the
question. A spec says each in a sentence, and the generated code asks
it with one of five functions, `decideIf`, `decideWhich`,
`decideLevel`, `decideFilter` and `decideRank`, each answering a
boolean or one of the values the code passed, so the next line is an
`if`, a `switch`, a comparison or a loop. A decision the case does not
settle is an error the code catches, never a guess.

Which engine decides is the plane's setting, not the spec's. By default
it is the language model you signed in with. With a Jev key it is
TypeSafe's decision model, which answers in well under a second with a
probability the trace shows beside the answer:

```
cernanto config cernanto/decision/jev token=<key>
cernanto config cernanto/decision default=cernanto/decision/jev
```

The same two settings point at Cloudflare's Clef or at a local Ollama,
which speak the same request. Reading a value out of text and writing
text stay with cernanto/llm. A decision engine reads text; a picture in
a decision is refused with a message naming the key.

## Testing, and when it is wrong

The tests are written by a second session that sees the spec and the contract and never the code, and they run against the running agent before it ships. When a test fails, the failure goes back to the session at fault and the log shows it:

```
05:40:05  connectors/deepwiki  verify       FAIL says the documentation does not answer when DeepWiki holds none for the repository: Cannot read properties of undefined (reading 'split')  16s
05:40:05  connectors/deepwiki  triage       who is at fault
05:40:27  connectors/deepwiki  triage       ok the code  22s
05:40:27  connectors/deepwiki  fix code     the live tests fail
05:40:37  connectors/deepwiki  fix code     fixed the live tests fail  10s
05:40:38  connectors/deepwiki  check code   ok entry, tsc, determinism, type-verify  1s
05:40:58  connectors/deepwiki  verify       ok 2 tests passed  16s
```

<details>
<summary><b>When the page itself was ambiguous, and tests that must not act</b></summary>

When the spec itself was ambiguous, the tests can share the misunderstanding, and the trace is where you see it. You fix the sentence, not the code, and you can pin the case. The support follow-up says a response counts whether it was there before the team was told or recorded any time after, and its paragraph on proving the desk pins it:

```md
a response recorded on the ticket, even one recorded before the team
was told, ends the wait as a response, with no reminder
```

Tests run live, so a workflow that sends mail or refunds money is tested on a second account of the provider, logged in as the connector's `tester`, or with a sentence that says the tests replace the one dependency whose real action a test must not cause; every other dependency stays real. `cernanto code <agent>` prints the generated code, `cernanto tests <agent>` its tests, and `cernanto trace` prints what ran. When prose is not enough, existing code is an npm package one sentence away.

</details>

## Guarantees and limits

- **Verified means:** the type checker, the import and structure gates, then tests written in a separate session from the spec and the contract, run against the deployed agent and its real dependencies. It is not a proof of equivalence to English: two sessions can share a misunderstanding, and a live dependency cannot supply a rule the author left out.
- **Durable means:** every call to another agent, every OpenAPI and MCP operation, every timer and every judgment is journaled, so after a crash or a restart the procedure resumes where it stopped, its recorded steps answered from the journal. What the journal does not hold (a fetch, a query, a command written straight into an agent) runs again on a replay, which is why the world is reached through an agent whose job is that reach. A new version of a service starts its waiting calls again from their first line, with fresh memory. The one boundary every durable system shares: a crash between an external write and its record can repeat the write, so the spec's "never twice" sentence is what the code keys on, and a supporting API deduplicates the retry.
- **Deterministic where it can be:** the procedure is code and takes the same path every time; a fresh judgment can vary; a replay reuses the recorded one and never asks the model again.
- **A judgment cannot act.** It answers a typed question into a branch you wrote, behind the same thresholds as every answer; it cannot invent an action or reach a tool the spec did not name. A spec that asks for no judgment, and names nothing that does, makes no model calls when it runs.
- **Two models, kept apart.** The package names the model that wrote the code, the doctrine version it was taught and when the tests passed; changing the coding model changes nothing until you recompile. A judgment uses the judgment model the runtime is configured with, and recovery reuses its recorded result.
- **What leaves your machine:** during a compile, the spec, the contracts and the files it names go to your coding assistant, which may also read a library's public documentation; at run time, a judgment's context goes to the judgment model; your agents talk to the services you named; a webhook delivery crosses the relay on its way to you. Nothing else, on a laptop or on a cluster.

## Where it runs

**Develop anywhere on one machine.** The whole platform runs on a laptop or any always-on machine, macOS, Linux or Windows: the compiler with every gate, the live tester, the durable runtime, the traces, as ordinary processes under one host program with no Docker needed. Your agents survive its reboots, and it is free for production use at any size on your own machines. A service's memory is its journal here, replayed at a restart; the journal grows for the life of a generation, which is fine for development and small production on one machine.

**Run production on Linux servers, one or many.** The same host program on each server, one server first and more in the same zone for a plane that survives a server: one store the servers share, DynamoDB and S3 in your own account, across three zones by the store's own nature, and the hosts taking the copies of every agent, spread over the servers, so a dead server's agents come back elsewhere from their journals. Two features of this shape are Linux's: an agent's process is checkpointed into an image with CRIU once its journal has grown, and restored where its copy comes back, which bounds its replay, and every fixed port is forwarded by the kernel to the server that holds the copy. It installs onto your own servers or into your own cloud account from the same npm packages as the laptop, with the unit file the process package carries and the operator's guide, [docs/RUNNING-A-PLANE.md](docs/RUNNING-A-PLANE.md); what leaves it is the same list as under Guarantees: the model calls, the services you named, the relay.

**Two hosted services,** both optional. A webhook delivery reaches your plane through the relay at `hooks.cernanto.com`, so a laptop needs no public address: the payload passes through the relay's memory and is never stored, and a channel's url lets a provider deliver into it and nobody read from it. The registry at `registry.cernanto.com` serves the packages you install and the ones you publish. Nothing else on your machines talks to Cernanto. Both are free for the planes you run on Cernanto, each under its own terms, which the software license does not govern.

## License

In five lines:

- **Yours:** your specs, the code and tests the compiler writes from them, and your traces.
- **Free, forever, on your own machines, one or many:** the whole compiler, the live tester, the durable runtime, the host program with the plane's coordination, the checkpoints and the forwarding, production use at any size.
- **The one thing you may not do:** offer a commercial service that lets third parties compile, deploy or run agents by means of the engine, above the revenue threshold the license states; each release converts to Apache 2.0 four years after it ships.
- **The map:** Apache 2.0 on the language surface, the cli, the package format kit, the gateway's OpenAPI document, the guide, this README, the examples and the `connectors/` interfaces; BSL 1.1 on the runtime, the host job and the platform, source-available and never open source; the enterprise edition and the hosted services commercial and not in this repository.
- **The full text** is in each folder's LICENSE file, and the root [LICENSE](LICENSE) is the map. A patent application is pending on the compiler and the runtime; the root LICENSE states that it is not asserted against any use the licenses permit.

## Documentation

- [Writing agents](docs/WRITING-AGENTS.md): the author's guide, the whole language in one document.
- [The examples](agents/README.md): the basics tour, the desks, and the fictional company they run on.
- [The connectors](agents/connectors/README.md): the email and chat interfaces, and the connectors to real services.
- [Running a plane on servers](docs/RUNNING-A-PLANE.md): the operator's guide.
- [The platform's own source](cernanto/): the compiler and the control plane, written in Cernanto.

## Contributing

Write the connector for the tool you use, a task implementing a `connectors/` interface, and share it. Write the workflow for your own department, on the fictional company first. Post your spec in Discussions: a spec is a readable post, and the language grows by specs shared. Issues come with a spec that reproduces them; a fix to a platform agent is a sentence in its spec that the maintainers recompile, since the package is the compiler's output and is judged by its tests; runtime patches are welcome as pull requests.

Discussions is the fastest way to reach the people making Cernanto.

## FAQ

<details>
<summary><b>What is Cernanto?</b></summary>

A natural-language programming language and a durable runtime for AI agents and workflow automation. Each agent is a Markdown page in plain English; the compiler turns it into typed, tested TypeScript, and the runtime runs it with durable execution on a laptop or on your own servers.

</details>

<details>
<summary><b>Is it an AI agent framework or a workflow engine?</b></summary>

It covers the ground of both, as a language. Like a multi-agent framework, it gives you agents that call each other, use tools, keep memory and wait for a person, the human-in-the-loop step. Like a durable workflow engine, it journals every call and timer and resumes after a crash. There is no SDK to import and no orchestration code to write: the agents are pages of English, and the compiler writes the code between them.

</details>

<details>
<summary><b>Is it a low-code or no-code tool?</b></summary>

There is no canvas, and no code for you to write, but it is a developer's tool: a terminal, git, Node.js and a coding assistant. It is code-first with the code written by the compiler: what runs is plain TypeScript in a package you commit, and what you maintain is the page it was compiled from.

</details>

<details>
<summary><b>Is it an alternative to n8n, Zapier, Make or Power Automate?</b></summary>

For a workflow that has to hold in production, yes. Those are visual workflow automation tools: you draw the workflow on a canvas and the tool runs it. Here the workflow is a page of English in git, compiled to code, tested against the real services before it ships, and resumed after a crash where it stopped, on your own machines. For a visual editor with a catalog of ready-made connections and nothing to install, stay with the canvas. [Outgrowing n8n, Make, Zapier or Power Automate](#outgrowing-n8n-make-zapier-or-power-automate) has the whole comparison.

</details>

<details>
<summary><b>Is it an alternative to Temporal, Inngest or Restate?</b></summary>

Yes, when you would rather keep a page of English than the workflow code. The guarantee is the same kind, durable execution: what is often called a checkpoint at every step is the journal here, and a crashed process resumes from it. With a workflow engine you write and maintain the workflow code; here the compiler writes it from the page, checks its determinism and tests it live. [The next stop](#the-next-stop-temporal-inngest-restate-or-aws-step-functions) has the whole comparison.

</details>

<details>
<summary><b>How is it different from LangChain, LangGraph, CrewAI or an agent SDK?</b></summary>

With a framework you write the orchestration yourself, and where an agent loop runs, a model picks each step at run time. Here the procedure is compiled code, and a model answers only the typed questions the page asks, each answer recorded. [Coming from an agent framework](#coming-from-an-agent-framework-langgraph-crewai-mastra-or-an-agent-sdk) has the whole comparison.

</details>

<details>
<summary><b>Can my coding assistant write Cernanto agents?</b></summary>

Yes. `cernanto skill` installs the language's skill for Claude Code, Codex and any assistant that reads Agent Skills. Then ask for the agent in a sentence: the assistant writes the page, deploys it, reads what the compile read and the trace, and fixes the words. See [Writing agents with your coding assistant](#writing-agents-with-your-coding-assistant).

</details>

<details>
<summary><b>Is it open source?</b></summary>

The language surface, the cli, the examples and the connector interfaces are Apache 2.0. The runtime and the platform are source-available under BSL 1.1: free for production use on your own machines, with each release converting to Apache 2.0 four years after it ships. It is self-hosted, and [License](#license) has the map.

</details>

<details>
<summary><b>Do I need an API key, and what does it cost?</b></summary>

On your own machine, no. A compile and an agent's judgments run on the coding assistant you are already signed in to, Claude Code or Codex, with your own Claude or ChatGPT subscription and under its vendor's terms; the vendor's tool uses that sign-in where it lies, and Cernanto never reads or keeps it. An API key of the vendor works instead, by two settings, and a plane on servers always runs on one. Cernanto itself is free on your own machines, with no fee per call or per task. A decision engine such as Jev, when you point the plane at one, answers on its own key, and a connector asks for its own account, such as a Slack bot token, on the first call that needs it.

</details>

<details>
<summary><b>Does it work with local models?</b></summary>

Decisions can be answered by a local Ollama: two settings point the plane at it. Reading a value out of text, writing text and compiling stay with the language model and the coding assistant you signed in with.

</details>

<details>
<summary><b>Is a model called at run time?</b></summary>

Only where the page asks for a judgment. The procedure is compiled code, a judgment is a typed answer into a branch the code already has, its result is recorded, and a replay never asks again. An agent whose page asks for no judgment makes no model calls.

</details>

<details>
<summary><b>Does my data leave my machine?</b></summary>

During a compile, the page, the contracts and the files it names go to your coding assistant. At run time, a judgment's context goes to the judgment model, your agents talk to the services you named, and a webhook delivery crosses the relay on its way to you. Nothing else, on a laptop or on a cluster.

</details>

<details>
<summary><b>What is it for, and what is it not for?</b></summary>

It is for the logic layer, programs that act: services, integrations, workflows, schedulers and data movement, such as a support desk, an approval chain, a refund API or an assistant over your documents. Kernels, games and numerics ask for something else, and so does anyone who wants a visual editor with nothing to install.

</details>

## Deeper

<details>
<summary><b>A language, not a prompt, and written in itself</b></summary>

The next rung of programming needs more than a model that writes code: an enduring source, an architecture for composing programs, and a credible account of how generated behavior is checked and executed.

- **The source stays above the translation.** The spec is what you maintain, in git. The TypeScript is the compiler's output, inspectable for diagnosis and never edited, the way nobody edits a compiler's assembly. Specs outlive models: a later model can attempt a new implementation of the same source against the established contracts and tests.
- **A module system the model cannot bypass.** What a spec names is the static dependency structure of a compile: the compiler reads it from the page once, shows it, and keeps it with the package, and an author who wants it fixed by hand writes it as labels. The compiler enforces Parnas's information hiding in the model's compilation context: one specification and its dependencies' contracts, with their implementations hidden. Import checks constrain the generated code to the allowed compile surface, so reuse becomes an explicit architectural decision.
- **A checked translation.** The model proposes an implementation; deterministic gates and independent live tests dispose. AI has three roles here, generating implementations, helping write independent tests, and answering bounded questions during execution, and the compiler never trusts the translator, only checks it.

**Written in itself.** The compiler and its parser, the control plane, the public gateway, the trace reader and credential custody are all specified in Cernanto: sixty-seven specs under [`cernanto/`](cernanto/), each beside its compiled package. The compiler compiles its next version from those specifications, under the same gates and the same live proof as anyone's agent. The runtime (the language library and the process package with the host job), the package format kit and the command-line client remain handwritten, which is what every self-hosted language keeps by hand. The count, as of the launch tree: about 52,000 lines of hand-written TypeScript, of which the runtime is about 33,000; the platform's sixty-seven specs are about 17,000 lines of English, from which the compiler wrote about 62,000 lines of TypeScript and the tester about 29,000 lines of tests. No hand-written compiler code exists.

What ships with the language: a compiler with its gates and its doctrine; a package format that carries the spec, the code, the tests, the contract and the pins of the compile, and nothing derivable; the interfaces and connectors under `connectors/`; a durable runtime for one machine or a cluster; one command-line client. The natural starting point is the business logic layer, programs that act: services, integrations, workflows, schedulers and data movement. Kernels, games and numerics place different demands on control and validation; extending the approach requires earning trust in each domain. Most of the software an enterprise writes is that layer, and the horizon is a company whose operations manual is a folder of specs in git, every procedure a diff, every execution evidenced, and every better model a compiler upgrade applied to all of it at once.

</details>

<details>
<summary><b>The production notes: one node or many</b></summary>

The runtime on your laptop is the same platform on one node, converged the same way as a cluster, and a package compiled on it deploys to a cluster unchanged. What the cluster adds is replication and capacity beyond one machine; nothing else in this table changes.

| Property                      | What it means                                                                                | The mechanism                                                                                                                 | One node     | Cluster      |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------ |
| Predictable                   | the procedure is code; a judgment is a typed answer into a declared branch                   | compiled control flow, five typed judgment functions                                                                          | yes          | yes          |
| Deterministic where it can be | what can be fixed is fixed at compile time; what cannot is recorded once and never re-asked  | the gates, the journaled judgment, replay                                                                                     | yes          | yes          |
| Durable                       | a crash or a restart resumes the procedure where it stopped                                  | every call, timer and judgment journaled                                                                                      | yes          | yes          |
| State preserving              | a service keeps its memory across calls and restarts                                         | the journal, the version's memory                                                                                             | yes          | yes          |
| Scales out and to zero        | a task runs its calls in parallel and parks when idle                                        | placement by the runtime                                                                                                      | across cores | across nodes |
| Capacity beyond one machine   | when one server's CPU and memory are not enough, agent copies spread across servers          | placement by the controller onto the host with the least measured load, with no budget per copy                               | no           | yes          |
| Survives a dead server        | the plane's store across three zones, a dead server replaced in minutes                      | DynamoDB and S3 under the store seam, a server's copies coming back elsewhere from their journals and their checkpoint images | no           | yes          |
| Auditable                     | every action, judgment and failure attributed and replayable                                 | the traces, read as a conversation                                                                                            | yes          | yes          |
| Verified before it runs       | tests its writer never saw, run live against the real dependencies                           | the second session, the live tester                                                                                           | yes          | yes          |
| Governed                      | what the spec names is the only reach; credentials in custody, connected once by an operator | the import gate, the custody agent                                                                                            | yes          | yes          |
| Self-hosted                   | only the model calls, the services you named and the relay leave your machines               | one node, or one or more plain servers in your own cloud account                                                              | yes          | yes          |

The platform is one way to package, deploy, connect, observe and recover agents, and it does four things for them together: it compiles them, verifies them, journals their calls and judgments, and replays them. On servers: one plain server first and more by capacity, the same host program on each over one store the servers share, the hosts taking the copies of each agent version and bringing a dead server's agents back elsewhere from their journals and images; a controller that converges the fleet on every change and reads the hosts' heartbeats. An enterprise moves a process onto it in rungs with the same specs at every rung: assist, approve with a sentence in the spec, run with the traces as evidence; the traces justify each promotion.

Coding sessions run in a sandbox where the system provides one, with the runtime's ports unreachable from it. Generated code reaches only what the spec names: every dependency is a declaration file the compiler hands the session, and an import of anything else fails the gate. Credentials are never in specs.

</details>

Keep the conversation. Keep the source. Let the machine compile what comes next.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
