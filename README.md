<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cernanto.com/logo/cernanto-logo-on-dark.svg" />
    <img src="https://cernanto.com/logo/cernanto-logo-on-light.svg" alt="Cernanto" width="360" />
  </picture>
</h1>

<p align="center"><b>A programming language for AI agents and workflows: written in plain English, compiled to verified TypeScript, run durably on your own machines.</b></p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#examples">Examples</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#decision-models-jev-and-llms">Decision models</a> ·
  <a href="#comparing-cernanto">Comparisons</a> ·
  <a href="docs/README.md">Docs</a>
</p>

Cernanto is a programming language and self-hosted runtime for writing systems of agents in plain English.

Write tasks, stateful services, reusable modules and interfaces in Markdown. Cernanto compiles them into TypeScript, checks the implementation with types and tests written from the specification, and runs it on your laptop or your own servers. **The English specification remains the source you maintain.**

If a crash has cost you a run that was half done, if your agent took a different path the second time, or if your workflow grew a state table and a polling loop to stay alive, this is for you.

- **Compose agents through typed contracts.** Agents call each other without knowing each other's implementation. Connect existing services through OpenAPI, MCP and npm.
- **Use models where the work needs them.** Read a receipt, classify a request, or write an answer. Compiled code handles the procedure around those judgments.
- **Keep progress through a restart.** The runtime records calls, timers and model results, then uses that journal to recover interrupted work.

The compiler uses Claude Code or Codex on your machine. You maintain the Markdown; the generated TypeScript, tests and contracts are available to inspect.

## An agent in English

Your team has a handbook. You want an assistant that answers from it, names its source, and says when the handbook does not contain an answer.

Here are the dependencies and behavior from the [helpdesk agent](agents/examples/workflows/helpdesk.cern.md):

```md
# Helpdesk

Uses:

- file:helpdesk/docs/
- cernanto/decision
- cernanto/llm

Given a question, choose the handbook pages that answer it
and, among them, the one page the answer comes from; write
the answer from those pages and name that page. When the
handbook does not answer it, say so instead of guessing.
```

The same agent can answer a command-line call, serve your application, or sit behind the included [chat bot](agents/examples/workflows/helpdesk/README.md). Replace the handbook with your own files and deploy.

## Quickstart

You need **Node.js 26 or later** on macOS, Linux or Windows. Linux also needs `bubblewrap` and `socat`.

**First, check the runtime without a model sign-in.** Install Cernanto, start its local runtime, and deploy the precompiled examples:

```bash
npm install -g cernanto
cernanto dev
```

Run that block on its own. If an assistant is already signed in, `cernanto dev` detects it and returns. Otherwise it asks `connect which? [1]`: choose an assistant to sign in, or press **Ctrl-C at that question** to continue without one. The runtime is already running; Enter selects Claude Code rather than skipping the question.

Once you are back at the shell prompt, deploy the examples:

```bash
git clone https://github.com/cernanto/cernanto
cd cernanto/agents
cernanto deploy examples/
cernanto call examples/basics/counter next
```

A fresh counter returns `1`; call it again and it returns `2`. Its count survives a process restart. [Try the interruption](docs/RUNTIME-AND-GUARANTEES.md#check-recovery-with-the-counter) with no model account needed.

**See it in your browser.** The runtime serves its own web UI. One command opens it:

<!-- lab manual: it opens a browser on the reader's own machine -->

```bash
cernanto ui
```

Select `examples/basics/counter` in the list of agents. The call you just made is there, read as a conversation. Press **Next** in the box under it, and it answers the next number. [The web UI](docs/UI.md) shows what else is on that screen.

**Then ask the helpdesk.** Have Claude Code or Codex installed and signed in with your Claude or ChatGPT subscription, or [configure an API key](docs/RUNTIME-AND-GUARANTEES.md#coding-assistants-model-access-and-local-services). Model usage is through that provider. The included handbook and sandbox need no Slack, CRM or email account.

If you skipped sign-in or signed in separately afterwards, run this command on its own and finish any sign-in prompt. It records the login for the runtime before the helpdesk call:

```bash
cernanto dev
```

Then ask:

```bash
cernanto call examples/workflows/helpdesk ask question="Who approves expenses over 5000 euros?"
```

An example answer from the included handbook:

<!-- lab output -->

```json
{ "answered": true, "answer": "Dana Swope, the finance lead.", "page": "expenses.md" }
```

The wording can vary. Ask about the Berlin office's Wi-Fi password and the agent should say that the handbook does not answer it.

In the web UI, select `examples/workflows/helpdesk`. Its **Trace** shows how it reached that answer: the handbook pages it chose, then the answer it wrote from them.

The examples deploy from their existing packages. Editing a specification and deploying it invokes the compiler.

[Get the examples without git](docs/RUNTIME-AND-GUARANTEES.md#get-the-examples-without-git) · [Put the helpdesk in your chat](agents/examples/workflows/helpdesk/README.md)

### Change the English

In `examples/workflows/helpdesk.cern.md`, replace `the answer from those pages and name that page` with `the answer from those pages, in at most two sentences, and name that page`. Keep the existing final period, then deploy:

<!-- lab edit examples/workflows/helpdesk.cern.md
the answer from those pages and name that page
=>
the answer from those pages, in at most two sentences, and name that page
-->

```bash
cernanto deploy examples/workflows/helpdesk
```

The compiler amends the implementation and checks it again. You commit the specification and the compiled package beside it.

Prefer to work through your coding assistant? Run `cernanto skill` in your workspace to install the language guide for Claude Code, Codex and other assistants that read Agent Skills. Then describe the agent you want. [Writing agents](docs/WRITING-AGENTS.md) explains the language and development loop.

Ready to write an agent of your own? [Start with one file](docs/RUNTIME-AND-GUARANTEES.md#one-file-of-your-own), then add its dependencies. The setup guide also covers [workspace and global skill installation](docs/RUNTIME-AND-GUARANTEES.md#use-your-coding-assistant).

## How it works

**The specification becomes a program.** These are excerpts from the helpdesk's generated TypeScript; setup, logging, error handling and the intermediate source-page ranking are omitted:

```ts
const decision = await cernantoDecision();

relevant = await decision.decideFilter(
  { question: q },
  'The handbook page contains the answer to the question.',
  pages,
  { minItems: 1 },
);

if (relevant.length === 0) return { answered: false, answer: NOT_ANSWERED, page: null };

const answer = await llmDetailed(
  { question: q, pages: relevant },
  'Answer the question using only the handbook pages. Write a concise answer drawn from the pages.',
);
return { answered: true, answer, page: best.page };
```

`cernanto/decision` selects and ranks the pages. `cernanto/llm` writes the answer from their contents. The surrounding program reads the files, handles missing information and returns a typed result.

The same separation applies to business rules. The [expense desk](agents/examples/workflows/expense-desk/README.md) reads a receipt photo through `cernanto/llm`: the merchant as text, the purchase date as a date-parseable string, and the total as a number. Its generated code applies the €200 approval limit with `if (total <= LIMIT_EUR)`. The model reads the receipt; the policy is a comparison in code.

A recorded excerpt from the expense desk's walkthrough shows the numeric reading returned by `cernanto/llm`:

```text
08:09:03  → LLM
            Llm number
            Prompt: What is the total paid, in euros, per the receipt in the picture?
08:09:09  ← LLM  6.8s
            14.9
```

The full trace continues with the program's approval reply for €14.90.

A deploy checks the translation before putting it into use:

1. **Compile:** the coding assistant writes TypeScript against the contracts of the dependencies the specification names.
2. **Check:** types and static gates check the generated code, including its imports and determinism constraints.
3. **Test:** a separate session writes tests from the specification and contract, without seeing the implementation. They run against the deployed agent and its dependencies.
4. **Package and run:** the `.cern` package keeps the specification, code, tests, contract and compile pins together.

**Consistency has a precise boundary.** The deployed program fixes the control flow; fresh model answers can still vary or be wrong. Recovery reuses recorded model results instead of asking again. Checks and tests provide evidence, not a proof that the code perfectly implements the English.

The compiler and control plane are themselves [written in Cernanto](cernanto/compile.cern.md). The handwritten runtime and CLI are separate. [Why Cernanto](docs/WHY-CERNANTO.md#the-compiler-is-written-in-cernanto) says which parts are generated and which are written by hand.

Read more about [compilation, typed model calls and testing](docs/HOW-IT-WORKS.md).

## Work that survives a restart

The [support follow-up](agents/examples/workflows/support-follow-up/README.md) classifies a ticket, tells the responsible team, waits for a person to respond, and sends a reminder if nobody does.

In an application, keeping that wait alive can mean a queue, a worker, a delayed job, a state row and a retry policy. Here it is a sentence in the agent's source.

Its walkthrough interrupts the process twenty seconds into a one-minute wait. The runtime restarts it, the classification is reused, and the workflow finishes with a reminder. The recorded run returns:

```json
{ "category": "technical", "team": "Engineering", "channel": "#engineering", "outcome": "reminder" }
```

The tutorial shows the commands, trace, policy change and switch from sandbox chat to Slack. This is the same runtime used by the helpdesk and your own agents. External writes still need idempotency when a crash falls between an action and recording its result; see [guarantees and limits](#guarantees-and-limits).

## Decision models: Jev and LLMs

Cernanto separates model work into agents with typed contracts:

| Agent               | What it does                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `cernanto/llm`      | Reads values from text, images or PDFs, and writes text: numbers, dates, lists, concise answers and detailed replies. |
| `cernanto/decision` | Answers yes/no questions, selects a category, rates a case, filters items or ranks them.                              |
| `cernanto/search`   | Researches a question about the world and returns a report with sources.                                              |

Decisions use the configured language model by default. To use **TypeSafe's Jev decision model**, set its key and select it:

<!-- lab manual: requires your Jev API key and changes the plane's provider -->

```bash
cernanto config cernanto/decision/jev token=YOUR_JEV_API_KEY
cernanto config cernanto/decision default=cernanto/decision/jev
```

The helpdesk's page selection now uses Jev through the same contract; its written answer still comes from `cernanto/llm`. **Changing the decision provider does not require rewriting or recompiling the agent.**

The Jev adapter uses probabilities to apply certainty thresholds and reports an inconclusive decision when the threshold is not met. It currently accepts text. Compatible decision endpoints, including a configured local Ollama, are covered in [the model guide](docs/HOW-IT-WORKS.md#decision-models-jev-and-llms). Jev is optional.

## Examples

Each workflow includes its English source, compiled package and walkthrough. The sandbox supplies the business services; workflows that make judgments need model access.

| You want to…                                 | Start here                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Answer questions from your documents         | [Helpdesk](agents/examples/workflows/helpdesk/README.md): sources, grounded answers and a chat bot                                                                |
| Follow up on support tickets                 | [Support follow-up](agents/examples/workflows/support-follow-up/README.md): classify, route, wait and remind                                                      |
| Approve expenses from a receipt photo        | [Expense desk](agents/examples/workflows/expense-desk/README.md): typed readings and a policy in code                                                             |
| Approve invoices against orders and receipts | [Invoice approval](agents/examples/workflows/invoice-approval/README.md): documents, arithmetic and human approval                                                |
| Handle refund requests through an API        | [Refund desk](agents/examples/workflows/refund-desk/README.md): written policy, model judgments and replies                                                       |
| Route shared mail or chat                    | [Mail router](agents/examples/workflows/mail-router/README.md) and [chat router](agents/examples/workflows/chat-router/README.md): shared handlers and escalation |
| Renew a contract by email                    | [Renewal desk](agents/examples/workflows/renewal-desk/README.md): a conversation that waits for replies                                                           |
| Learn one feature at a time                  | [Basics tour](agents/examples/basics/README.md): seventeen small agents, including state, decisions and webhooks                                                  |

[All examples and connectors](agents/README.md)

With their recorded runs on the site: [the refund desk](https://cernanto.com/examples/refund-desk), [the support follow-up](https://cernanto.com/examples/support-follow-up) and [the invoice approval](https://cernanto.com/examples/invoice-approval).

## Comparing Cernanto

Cernanto combines a programming language with a durable workflow engine for AI agents, integrations and human-in-the-loop workflows. It is an alternative to maintaining the procedure as application code or a visual workflow.

| If you are considering…                                       | The distinction                                                                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LangGraph, LangChain, CrewAI, Mastra or an agent SDK**      | Those provide ways to implement agents and workflows in code. Cernanto generates the implementation from the English source you maintain.                                                |
| **n8n, Zapier, Make or Power Automate**                       | Cernanto expresses the procedure as text, with typed contracts and tests. Choose a visual tool when its editor and ready-made integrations suit you better.                              |
| **Temporal, Inngest, Restate or AWS Step Functions**          | Durable execution is shared ground. Cernanto adds specification-driven compilation and verification; other engines let you maintain workflow code or state-machine definitions directly. |
| **Spec Kit, Kiro or a coding assistant with a specification** | Cernanto provides a compiler, package and runtime around the coding session, keeping the specification authoritative through later changes.                                              |

LangGraph and Mastra also support predefined workflows; a model choosing every step is a particular agent-loop design, not a requirement of those frameworks.

Existing Python and TypeScript services can stay where they run. Agents reach them through OpenAPI or MCP, reuse npm packages, and expose APIs to your applications.

[Detailed comparisons and the mapping from Python or TypeScript](docs/COMPARISONS.md) · [Why compile an agent?](docs/WHY-CERNANTO.md)

Each comparison on the site, with a recorded run and the limits: [n8n, Zapier and Make](https://cernanto.com/comparisons/workflow-automation) · [Temporal, Inngest and Restate](https://cernanto.com/comparisons/durable-execution) · [LangGraph, CrewAI and the agent SDKs](https://cernanto.com/comparisons/agent-frameworks) · [Spec Kit and Kiro](https://cernanto.com/comparisons/spec-driven-development)

## Guarantees and limits

- **Verification:** types, static gates and independent live tests. Two sessions can share a misunderstanding of the specification; “verified” does not mean formal proof.
- **Recovery:** journaled calls, operations, timers and judgments resume from recorded progress. Unjournaled effects can run again, and external writes need a supporting idempotency mechanism to prevent duplicates.
- **State and upgrades:** a service keeps memory across restarts of its current version. A new version starts with fresh memory and restarts its waiting calls from the beginning. Put state that must outlive a version in a database.
- **Data and models:** compilation sends the specification, dependency contracts and relevant files to your coding assistant. Runtime judgments send their context to the model provider. Agents contact the services you name; webhook payloads pass through the optional relay.

[Full execution guarantees, testing boundaries and data flow](docs/RUNTIME-AND-GUARANTEES.md)

## Where it runs

Develop on macOS, Linux or Windows. Run production on your own machines, with no Cernanto fee per task. Linux server deployments can share a store in your AWS account and recover agents on another server. The registry and webhook relay are hosted services with their own terms.

[Run a plane on your servers](docs/RUNNING-A-PLANE.md) · [Local runtime and deployment details](docs/RUNTIME-AND-GUARANTEES.md)

## License

**Yours:** your specifications, the code and tests Cernanto generates from them, and your traces.

**Free for your own agents, including production at any scale:** run the compiler and runtime on your laptop, your servers or in your own cloud account, on one machine or many.

Offering Cernanto as a paid competing platform requires a commercial license. [License details](docs/RUNTIME-AND-GUARANTEES.md#applications-and-platform-services).

The language surface, CLI, package format, documentation, examples and connector interfaces use **Apache 2.0**. The runtime and platform are **source-available under BSL 1.1**, with each release converting to Apache 2.0 after four years.

See [LICENSE](LICENSE) for the full terms.

## Documentation

| Read next                                                | What you will find                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Writing agents](docs/WRITING-AGENTS.md)                 | The language, dependencies, tests and changes to deployed agents            |
| [The web UI](docs/UI.md)                                 | The runtime's own screen: agents, calls as conversations, source, settings  |
| [How it works](docs/HOW-IT-WORKS.md)                     | Compilation, generated code, model calls, contracts and integrations        |
| [Why Cernanto](docs/WHY-CERNANTO.md)                     | The source model, design rationale and compiler written in its own language |
| [Comparisons](docs/COMPARISONS.md)                       | Agent frameworks, workflow tools, durable engines and existing code         |
| [Runtime and guarantees](docs/RUNTIME-AND-GUARANTEES.md) | Setup, recovery, deployment, model requirements and licensing               |
| [FAQ](docs/FAQ.md)                                       | Common questions about fit, cost, models and data                           |
| [Documentation index](docs/README.md)                    | Guides and examples organized by what you want to do                        |

## Contributing

Write a connector for the tool you use, or a workflow for your department, and share its specification in Discussions. A specification is a readable post; the language grows through agents people share.

Report a problem with the smallest specification that reproduces it. A fix to a platform agent is a change to its English source, which the maintainers recompile; runtime, process-package and CLI patches are welcome. The [public contributing guide](https://github.com/Cernanto/cernanto/blob/main/.github/CONTRIBUTING.md) explains proposals, pull requests and the contributor agreement.

[Discussions](https://github.com/cernanto/cernanto/discussions) · [Issues](https://github.com/cernanto/cernanto/issues) · [Website](https://cernanto.com)

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
