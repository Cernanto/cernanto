# Frequently asked questions

[Documentation](README.md) · [Project README](../README.md)

## What is Cernanto?

A natural-language programming language and a durable runtime for AI agents and workflow automation. Each agent is a Markdown page in plain English; the compiler turns it into typed, tested TypeScript, and the runtime runs it with durable execution on a laptop or on your own servers.

## Is it an AI agent framework or a workflow engine?

It covers the ground of both, as a language. Like a multi-agent framework, it gives you agents that call each other, use tools, keep memory and wait for a person, the human-in-the-loop step. Like a durable workflow engine, it journals every call and timer and resumes after a crash. There is no SDK to import and no orchestration code to write: the agents are pages of English, and the compiler writes the code between them.

## Is it a low-code or no-code tool?

There is no canvas, and no code for you to write, but it is a developer's tool: a terminal, git, Node.js and a coding assistant. It is code-first with the code written by the compiler: what runs is plain TypeScript in a package you commit, and what you maintain is the page it was compiled from.

## Is it an alternative to n8n, Zapier, Make or Power Automate?

Yes, when you want to maintain the procedure as English in git and run it on your own machines. Cernanto compiles the page to code, tests it and provides durable execution. A visual tool may be the better fit when you prefer its editor, integration catalog or hosted service. [Comparing with n8n, Make, Zapier or Power Automate](COMPARISONS.md#comparing-with-n8n-make-zapier-or-power-automate) explains the tradeoffs.

## Is it an alternative to Temporal, Inngest or Restate?

Yes, when you would rather keep a page of English than the workflow code. The guarantee is the same kind, durable execution: what is often called a checkpoint at every step is the journal here, and a crashed process resumes from it. With a workflow engine you write and maintain the workflow code; here the compiler writes it from the page, checks its determinism and tests it live. [The next stop](COMPARISONS.md#the-next-stop-temporal-inngest-restate-or-aws-step-functions) has the whole comparison.

## How is it different from LangChain, LangGraph, CrewAI or an agent SDK?

With a framework you write the orchestration yourself, and where an agent loop runs, a model picks each step at run time. Here the procedure is compiled code, and a model answers only the typed questions the page asks, each answer recorded. [Coming from an agent framework](COMPARISONS.md#coming-from-an-agent-framework-langgraph-crewai-mastra-or-an-agent-sdk) has the whole comparison.

## Can my coding assistant write Cernanto agents?

Yes. `cernanto skill` installs the language's skill for Claude Code, Codex and any assistant that reads Agent Skills. Then ask for the agent in a sentence: the assistant writes the page, deploys it, reads what the compile read and the trace, and fixes the words. See [Use your coding assistant](RUNTIME-AND-GUARANTEES.md#use-your-coding-assistant) for the workspace and global installation paths.

## Is it open source?

The language surface, the cli, the examples and the connector interfaces are Apache 2.0. The runtime and the platform are source-available under BSL 1.1: free for production use on your own machines, with each release converting to Apache 2.0 four years after it ships. It is self-hosted, and [License](RUNTIME-AND-GUARANTEES.md#license) has the map.

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

## Does it work with local models?

Decisions can use a compatible local endpoint, including a configured Ollama. The endpoint must serve the API expected by the decision adapter; [the model guide](HOW-IT-WORKS.md#configuring-a-compatible-decision-endpoint) explains the settings. Reading values, writing text and compiling use the configured language-model and coding-assistant paths.

## Is a model called at run time?

Only where the agent or a dependency asks for a judgment. The procedure is compiled code; model results are recorded and reused during replay. An agent that asks for no judgment and calls no dependency that does makes no model calls.

## Does my data leave my machine?

During a compile, the page, the contracts and the files it names go to your coding assistant. At run time, a judgment's context goes to the judgment model, your agents talk to the services you named, and a webhook delivery crosses the relay on its way to you. Nothing else, on a laptop or on a cluster.

## What is it for, and what is it not for?

It is for the logic layer, programs that act: services, integrations, workflows, schedulers and data movement, such as a support desk, an approval chain, a refund API or an assistant over your documents. Kernels, games and numerics ask for something else, and so does anyone who wants a visual editor with nothing to install.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
