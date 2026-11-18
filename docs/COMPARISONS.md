# Comparing Cernanto

[Documentation](README.md) · [Project README](../README.md)

Cernanto is a programming language and runtime for AI agents and workflow automation. The main choice is what you want to maintain: a visual workflow, application code, or an English specification compiled into a program.

The alternatives below overlap. LangGraph supports both predefined workflows and dynamic agents, and Mastra has an explicit workflow engine. Durable execution is also a core feature of several workflow engines. Cernanto's distinction is the maintained English source and the compilation, contracts and testing around it.

- [LangGraph: workflows and agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)
- [Mastra: workflows](https://mastra.ai/docs/workflows/overview)

## Comparing with n8n, Make, Zapier or Power Automate

A procedure drawn on a visual canvas becomes a page of English, as in the [support follow-up](../agents/examples/workflows/support-follow-up/README.md). The differences to evaluate are the authoring model, the runtime behavior and the integrations you need:

- **A crash in the middle of a run.** The runtime journals agent calls, supported operations, timers and judgments. A restarted process recovers from that journal. External writes still need idempotency at the action/record boundary; [execution guarantees](RUNTIME-AND-GUARANTEES.md#guarantees-and-limits) describes the limits.
- **Git and review.** The page lives in git and is reviewed as a diff, where an exported JSON was.
- **Your coding assistant.** Claude Code or Codex writes and changes the page from a sentence, and code you already have rides as an npm package.
- **Triggers.** A webhook the agent waits on, a worker that keeps its own time, or a call from your application over HTTP.
- **Parallel steps.** Steps that do not depend on each other run at the same time.
- **Retries.** How to retry is a sentence on the page, such as "on a rate_limited error, wait the Retry-After seconds and try again".
- **Debugging.** One trace shows the whole call, read as a conversation in the terminal.
- **Before it ships.** The compiled code is tested against the real services.
- **Connections.** A service is connected by naming its OpenAPI document, an MCP server or an npm package, so no catalog decides what you can reach.
- **Cost and custody.** It runs on your own machines under your own credentials, with no fee per task.

Choose a visual tool when its editor, catalog of ready-made app connections or hosted service fits your team. Cernanto asks for a terminal, git and a coding assistant. The right choice depends on those requirements, not on whether the workflow is important enough for production.

## The next stop: Temporal, Inngest, Restate or AWS Step Functions

A common next stop is the code-first road: a durable workflow engine, with a coding assistant writing the TypeScript. The guarantee here is the same kind, durable execution: every call, timer and judgment is journaled, a crash or a restart resumes where it stopped, and a replay answers the calls already made from the journal, so a retry repeats one operation, never the sequence before it. The difference is what you keep. There you write and maintain the workflow yourself, as code held deterministic by the engine's rules or as a state machine definition; here the page stays the source, the compiler writes the code, a gate checks its determinism, and a second session tests it live before it ships. Keep an engine when you want that code in your own hands and in your own language.

## Coming from an agent framework: LangGraph, CrewAI, Mastra or an agent SDK

There you write and maintain the orchestration in Python or TypeScript, and where you hand the steps to an agent loop, a model chooses each one at run time. Here you maintain the English and the compiler writes the TypeScript; a model is asked only at the sentences that call for a judgment, and its answer is recorded, so a restart takes the same path without asking again. Use a framework when you want direct control of its Python or TypeScript code, including open-ended agent loops, predefined workflows or a combination of the two.

## Coming from spec-driven development: Spec Kit, Kiro or a coding assistant with a spec file

These approaches use specifications to guide a coding assistant. Compare how each keeps the specification and implementation aligned, and what it supplies for testing, packaging and execution. Cernanto is a compiler and a runtime around that step: the page stays the source, the code may reach only what the page names, gates and independent live tests decide whether it ships, and a change to a sentence amends the code it wrote. It drives the same assistants, Claude Code or Codex.

## Coming from Python or TypeScript

What you keep of your existing stack:

- **An existing Python or TypeScript service** is one `Uses:` line that names its OpenAPI document, and it stays where it runs.
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
| import, requirements.txt, package.json                                            | a `Uses:` line that names it: an agent, an npm package, an MCP server, an OpenAPI document, a file                                                                |
| a queue, a retry policy, a state machine in a database                            | the journal: calls, operations, timers and judgments recorded and resumed after a crash; unjournaled effects run again, and an external write needs idempotency   |
| an LLM call with structured output, a classifier prompt                           | a judgment ("classify its message as billing, technical or account access"): a typed answer the code branches on, recorded once and never asked again on a replay |
| a human-in-the-loop step, an approval queue, a workflow that polls for the answer | a wait ("wait for a person to respond"): it costs nothing while it waits and resumes after a restart                                                              |
| a fan-out over a list, then a join                                                | "at the same time": calls and judgments that do not depend on each other run in parallel                                                                          |
| tool calling, function calling                                                    | a `Uses:` line that names the tool: its operations become typed functions the code calls, and the model answers without acting                                    |

Microservices without the infrastructure: a call to a service is a function call, in process or across nodes, and no Dockerfile, queue, retry loop, cron table, service discovery or client stub is yours to write. You never write TypeScript and never need to read it; when you want to, it is plain Node with the packages you named, and `cernanto code <agent>` prints it. State lives in a service's memory across calls and restarts; a redeploy starts a fresh version with fresh memory, in which its waiting calls start again from their first line, so what must outlive a version goes to a database, through the Postgres connector.

## The architectural choices

The same library can support more than one architecture. In particular, a framework does not require a model to choose every step.

| Approach                                    | Source you maintain                                                   | What determines the next step                                 | Verification and recovery                                 |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| A prompt-driven agent loop                  | Instructions plus application code                                    | A model, within the tools and limits the application provides | Depends on the application's tests and persistence design |
| A coding assistant writing application code | Usually the application code, often with a specification alongside it | The resulting program                                         | The checks and runtime you configure                      |
| A durable workflow engine                   | Workflow code or a state-machine definition                           | The program, including any model calls you add                | Your tests and the engine's recovery semantics            |
| Cernanto                                    | The English specification and its compiled package                    | Generated TypeScript, with declared model judgments           | Static gates, independent tests and journaled execution   |

To inspect Cernanto's claims, read an agent's specification and package, inspect its generated code and tests, and follow a restart walkthrough. Recompile the same specification with another coding assistant and run the retained tests against the new implementation.

The [comparison examples](../agents/examples/comparison/README.md) put a refund policy beside a prompt-driven implementation and a compiled workflow. Consult that guide for the test setup and available measurements.

## Choosing before you have an existing stack

Cernanto fits services, integrations, AI workflows, approval chains and other programs whose policy can be described and tested. Examples include document assistants, support desks, refund APIs and scheduled conversations.

Consider another approach when you need a visual editor, want to own the implementation directly in another programming language, or need an open-ended agent to discover its own procedure. Kernels, games and numerical systems have different control and validation requirements.

[Examples](../agents/README.md) · [Verification and runtime limits](RUNTIME-AND-GUARANTEES.md)

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
