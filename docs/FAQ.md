# Frequently asked questions

[Documentation](README.md) · [Project README](../README.md)

## What is Cernanto?

A natural-language programming language and a durable runtime for AI agents and workflow automation. Each agent is a Markdown file in plain English; the compiler turns it into typed, tested TypeScript, and the runtime runs it with durable execution on a laptop or on your own servers.

## Is it an AI agent framework or a workflow engine?

It covers the ground of both, as a language. Like a multi-agent framework, it gives you agents that call each other, use tools, keep memory and wait for a person, the human-in-the-loop step. Like a durable workflow engine, it journals every call and timer and resumes after a crash. There is no SDK to import and no orchestration code to write: the agents are written in English, and the compiler writes the code between them.

## Is it a low-code or no-code tool?

There is no canvas, and no code for you to write, but it is a developer's tool: a terminal, git, Node.js and a coding assistant, with a [web UI](UI.md) on the plane to try an agent and watch its calls. It is code-first with the code written by the compiler: what runs is plain TypeScript in a package you commit, and what you maintain is the source it was compiled from.

## Is there a UI?

Yes. Every plane serves a web UI at its gateway's address: `cernanto dev` prints the address, and `cernanto ui` opens it. It lists the agents as `cernanto ls` does, shows each call as a conversation, calls a function from a form, and shows an agent's source, contract, compiled code and tests beside its config, its accounts and its traces. Everything it does is something the cli does, and it serves the plane's own machine. It is a console for a plane and no canvas: an agent is still written in English. [The web UI](UI.md) has the rest.

## Is it an alternative to n8n, Zapier, Make or Power Automate?

Yes, when you want to maintain the procedure as English in git and run it on your own machines. Cernanto compiles the English to code, tests it and provides durable execution. A visual tool may be the better fit when you prefer its editor, integration catalog or hosted service. [Comparing with n8n, Make, Zapier or Power Automate](COMPARISONS.md#comparing-with-n8n-make-zapier-or-power-automate) explains the tradeoffs.

## Is it an alternative to Temporal, Inngest or Restate?

Yes, when you would rather keep plain English than the workflow code. The guarantee is the same kind, durable execution: what is often called a checkpoint at every step is the journal here, and a crashed process resumes from it. With a workflow engine you write and maintain the workflow code; here the compiler writes it from the source, checks its determinism and tests it live. [The next stop](COMPARISONS.md#the-next-stop-temporal-inngest-restate-or-aws-step-functions) has the whole comparison.

## How is it different from LangChain, LangGraph, CrewAI or an agent SDK?

With a framework you write the orchestration yourself, and where an agent loop runs, a model picks each step at run time. Here the procedure is compiled code, and a model answers only the typed questions the source asks, each answer recorded. [Coming from an agent framework](COMPARISONS.md#coming-from-an-agent-framework-langgraph-crewai-mastra-or-an-agent-sdk) has the whole comparison.

## Can my coding assistant write Cernanto agents?

Yes. `cernanto skill` installs the language's skill for Claude Code, Codex and any assistant that reads Agent Skills. Then ask for the agent in a sentence: the assistant writes the agent, deploys it, reads what the compile read and the trace, and fixes the words. See [Use your coding assistant](RUNTIME-AND-GUARANTEES.md#use-your-coding-assistant) for the workspace and global installation paths.

## Is it open source?

The source is open: you can read it, change it and run it in production at any scale, free. The language surface, the cli, the examples and the connector interfaces are open source under Apache 2.0. The runtime and the platform are under BSL 1.1, and every release becomes Apache 2.0 four years after it ships. Until then one thing is reserved: offering Cernanto itself as a paid competing platform takes a commercial license. It limits nobody who runs their own agents. It is self-hosted, and [License](RUNTIME-AND-GUARANTEES.md#license) has the map.

## Do I need an API key, and what does it cost?

On your own machine, no. A compile and an agent's judgments run on the coding assistant you are already signed in to, Claude Code or Codex, with your own Claude or ChatGPT subscription and under its vendor's terms; the vendor's tool uses that sign-in where it lies, and Cernanto never reads or keeps it. An API key of the vendor works instead, by [three settings](RUNTIME-AND-GUARANTEES.md#coding-assistants-model-access-and-local-services), and a plane on servers always runs on one. Cernanto itself is free on your own machines, with no fee per call or per task. A decision engine such as Jev, when you point the plane at one, answers on its own key, and a connector asks for its own account, such as a Slack bot token, on the first call that needs it.

## Can I use Cernanto in a commercial application?

Yes, provided the application is not a competitive offering as defined in the Additional Use Grant. The grant expressly says that using Cernanto as an internal implementation component does not, by itself, make an application competitive. An expense service or support assistant is assessed by the platform capabilities it offers customers, including within a larger Product. Writing the agents for customers does not by itself exempt an offering of platform execution or management capabilities. [The license examples](RUNTIME-AND-GUARANTEES.md#applications-and-platform-services) explain the distinction.

## Can I offer a Cernanto platform to other organizations?

A separate license is needed for a competitive offering: a Product offered to third parties on a paid basis that significantly overlaps the Licensed Work's agent or workflow platform capabilities. This covers hosted or managed services, including services operated in customers' own cloud accounts, and software customers operate themselves. Including the engine, or requiring it to be accessed or downloaded for the Product to operate, is embedded use. There is no small-company revenue exception. [The engine license](../cernanto/LICENSE) defines the scope.

Products not provided on a paid basis are not competitive. A Product that was non-competing when first made generally available does not become competing merely because Cernanto adds capabilities. Changes to that Product's own features or pricing must still be assessed against the grant.

## Does every paid integration need a separate license?

No. Being paid and using Cernanto is not enough by itself: the Product must also meet the hosted-or-embedded and significant-overlap conditions. An editor integration or general-purpose infrastructure tool does not automatically become a competing agent platform.

The grant expressly permits assistance with a customer's own permitted use without that assistance, by itself, becoming a competitive offering. A Product offered with those services is still assessed under the grant, wherever it runs and regardless of the number of customers. A Product that supplies substantial agent-authoring, compilation, deployment, execution or management functionality needs closer assessment.

## What if a hosted platform charges only for compute?

It is paid if its provider charges for infrastructure or usage required to use the platform as offered, including compute or model usage. The grant also includes support covering the Product and charges bundled into a broader offering. A separate platform fee is not required. Being paid alone does not establish significant overlap with Cernanto's platform capabilities.

Your independent cloud or model bill for your own deployment is not a charge by another Product's provider. General-purpose infrastructure is not automatically an agent-platform competitor because a customer installs Cernanto on it. These answers summarize the rules in [the engine license](../cernanto/LICENSE); they do not add new restrictions.

## How do I know the code does what my source says?

The compiler ships no code that fails its tests. A second session writes them from the source and the contract without seeing the code, and they run live: against the deployed agent, the other agents it uses, its npm packages and the real service, on a test account where the agent must act. A `Mocks:` line under `## Tests` replaces the one dependency a test must not really call, and the deploy says which way an agent was proven. That is strong evidence and not a proof: two sessions can share a misunderstanding of the source, so read the trace of a real call, and pin a case in a testing sentence when it matters. [Tests](WRITING-AGENTS.md#tests) and [Guarantees and limits](RUNTIME-AND-GUARANTEES.md#guarantees-and-limits) have the rest.

## Does it work with local models?

Decisions can use a compatible local endpoint, including a configured Ollama. The endpoint must serve the API expected by the decision adapter; [the model guide](HOW-IT-WORKS.md#configuring-a-compatible-decision-endpoint) explains the settings. Reading values, writing text and compiling use the configured language-model and coding-assistant paths.

## Is a model called at run time?

Only where the agent or a dependency asks for a judgment. The procedure is compiled code; model results are recorded and reused during replay. An agent that asks for no judgment and calls no dependency that does makes no model calls.

## Does my data leave my machine?

During a compile, the source, the contracts and the files it names go to your coding assistant. At run time, a judgment's context goes to the judgment model, your agents talk to the services you named, and a webhook delivery crosses the relay on its way to you. Nothing else, on a laptop or on a cluster.

The plane's web UI adds two reads that your browser makes itself, with nothing of the plane in either: the public list of the Cernanto registry's packages, and npm's search for a package name typed into a source's grants.

## How is a plane secured, and who can reach it?

It is software you run on your own machines, so the boundary is your own network and cloud account. On servers the host program alone runs as root: every agent runs as one unprivileged user with no capability, and nothing an agent can write is run or trusted by root. The copies listen on the servers' private addresses, admitted among the plane's servers alone. From outside, the gateway takes a request only with an operator token, minted by name with `cernanto token create` and revoked by name, each with an operator's rights, and TLS is the front you put before it. The plane's web UI sends no token, so it works on the plane's own machine, or through a tunnel to it. The whole configuration is secret, and no trace carries a setting. These are mechanisms to weigh against your own requirements, not a security approval. [Running a plane](RUNNING-A-PLANE.md) has the server's rules.

## What does it have for observability, governance and audit?

Observability comes with the runtime, with nothing to add to an agent's source: calls, judgments and failures are traced under the agent they belong to, `cernanto trace` reads a request back as a conversation, and `cernanto ls` lists every agent with its calls, CPU, memory and model tokens; the plane's [web UI](UI.md) shows the same in a browser. What is stored of an agent's calls is its own setting, `cernanto traces <agent> on|debug|off`: your agents start at `on`, `debug` adds the debug lines the compiled code writes, `off` stores nothing, and the plane's own agents, the ones its release installs, stand at `off` unless you set them, the compiler, the language-model agent and the decision agents aside. Governance is in the compile: generated code reaches only what its source names, since an import of anything else fails a gate, a model answers a typed question and cannot act, and credentials are held by the plane, connected once by an operator and never written in an agent's source. For an audit, the package holds the source, the code, the tests and the model that wrote the code. The traces are for observing and are not a complete audit history: they are kept for seven days at most, and under heavy load the oldest records are dropped and counted, so a record you must keep is one you copy out, as `cernanto trace -o json` prints it. [Watching the plane](RUNTIME-AND-GUARANTEES.md#watching-the-plane) and [What an enterprise needs](WHY-CERNANTO.md#what-an-enterprise-needs) have the rest.

## How do I see what my agents cost?

`cernanto ls` lists every agent with the tokens of the model requests made for it, and their price where the provider reports one, beside its calls, its CPU and its memory. `cernanto trace` shows the model calls of one request. A compiled agent asks a model only where its source asks for a judgment, so the figure follows the judgments and not the length of the procedure. [Watching the plane](RUNTIME-AND-GUARANTEES.md#watching-the-plane) explains each column.

## What does an install download, and from where?

Two packages from npm, the cli (`cernanto`) and the runtime (`@cernanto/runtime`), which are the programs written by hand. The platform's agents are packages of the Cernanto registry, like any agent's: the runtime carries the list of them for its version, each named by its digest, each package pulled is held to that list, and a machine pulls the ones that fit it. A server's install also takes the release's own Node from nodejs.org, held to its checksums. A closed network names a mirror of each host. [Install the release](RUNNING-A-PLANE.md#install-the-release) has the commands.

## Does it run on more than one server?

Yes, for capacity and for high availability. The same host program runs on each server over one store the servers share, DynamoDB and S3 in your own account. A controller places every agent's copies on the servers by their measured load, each call is sent to a live copy found by the copies' records, and a dead server's agents come back on the others from their journals. A server runs the host program as a systemd unit, and the agents as plain processes. A laptop runs the same platform on one node. [Where it runs](RUNTIME-AND-GUARANTEES.md#where-it-runs) and [Running a plane](RUNNING-A-PLANE.md) have the whole shape.

## What happens to running calls when I deploy a new version?

Versioning is the runtime's work, and you write nothing for the calls in flight. A task's new version starts beside the old one and takes the new calls, and the old one takes no new call and stays up to finish the ones it holds. A service is replaced: its new version starts with fresh memory, and its waiting calls start again. Agents that call the changed one keep running when its contract held. [Deploying over running work](RUNTIME-AND-GUARANTEES.md#deploying-over-running-work) has each kind and the limits.

## What is it for, and what is it not for?

It is for the logic layer, programs that act: services, integrations, workflows, schedulers and data movement, such as a support desk, an approval chain, a refund API or an assistant over your documents. Kernels, games and numerics ask for something else, and so does anyone who wants a visual editor with nothing to install.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
