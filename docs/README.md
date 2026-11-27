# Cernanto documentation

[Project README](../README.md) · [Website](https://cernanto.com) · [Discussions](https://github.com/cernanto/cernanto/discussions)

## Start here

- [Quickstart](../README.md#quickstart): install Cernanto and ask the included helpdesk a question.
- [Writing agents](WRITING-AGENTS.md): the language, dependencies, tests and development loop.
- [The web UI](UI.md): the plane's own screen, where you install an example, call it and watch its calls.
- [One file of your own](RUNTIME-AND-GUARANTEES.md#one-file-of-your-own): create a workspace, compile your first agent, and install the coding-assistant skill.
- [Examples](../agents/README.md): choose a workflow or follow the basics tour.
- [FAQ](FAQ.md): fit, costs, model access, local models and data.

## Understand the system

- [How it works](HOW-IT-WORKS.md): English to TypeScript, contracts, typed model calls, tests and integrations.
- [Why Cernanto](WHY-CERNANTO.md): the maintained source, compiled procedures and design rationale.
- [Comparisons](COMPARISONS.md): LangGraph, CrewAI, Mastra, n8n, Temporal, other tools and existing Python or TypeScript code.
- [Decision models: Jev and LLMs](HOW-IT-WORKS.md#decision-models-jev-and-llms): model roles, typed decisions and provider configuration.
- [Platform source](../cernanto/): the compiler and control plane, written in Cernanto.

## Run and connect agents

- [Runtime, setup and guarantees](RUNTIME-AND-GUARANTEES.md): local setup, recovery, state across versions, data flow and licensing.
- [Running a plane on servers](RUNNING-A-PLANE.md): install and operate on your own Linux servers.
- [Connectors](../agents/connectors/README.md): OpenAPI, MCP, chat, email and service integrations.
- [Helpdesk tutorial](../agents/examples/workflows/helpdesk/README.md): use your handbook, add a chat bot and change its policy.
- [Support follow-up tutorial](../agents/examples/workflows/support-follow-up/README.md): route a ticket, wait, interrupt, recover and connect Slack or Jira.

## Contribute

Read the [public contributing guide](https://github.com/Cernanto/cernanto/blob/main/.github/CONTRIBUTING.md), share an agent in [Discussions](https://github.com/cernanto/cernanto/discussions), or open an [issue](https://github.com/cernanto/cernanto/issues) with a specification that reproduces the problem.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
