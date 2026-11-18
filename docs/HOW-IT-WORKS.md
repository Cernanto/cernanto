# How Cernanto works

[Documentation](README.md) · [Project README](../README.md)

This guide explains the translation from an English specification to a running agent. For the syntax and authoring rules, use [Writing agents](WRITING-AGENTS.md).

## From a page to a package

```text
agent.cern.md     a page of plain English, in git: the source you maintain
      |
   compile        your coding assistant writes TypeScript from the page
      |
    gates         the type-check and static scans; the code reaches only what the page names
      |
    tests         a second session writes them from the page and never sees the code
      |
  live tests      the tests run against the deployed agent and its real dependencies
      |
 agent.cern       the package: the page, the code, the tests and the contract, committed beside the page
      |
  the plane       durable processes on your laptop or your own servers, every call journaled
```

A change to a sentence amends the code it wrote rather than starting over, and the tests move only when the promise did. At run time a model is asked only where the page calls for a judgment, and its answer is recorded.

The generated TypeScript is inspectable. After deploying an agent, these commands show its source, implementation, tests and public contract:

```bash
cernanto source examples/workflows/helpdesk
cernanto code examples/workflows/helpdesk
cernanto tests examples/workflows/helpdesk
cernanto contract examples/workflows/helpdesk
```

The `code` command also accepts a local `.cern` package path, so inspection does not require starting the runtime. For example, from `agents/`:

```bash
cernanto code examples/workflows/.cern/helpdesk.cern
```

## Typed contracts and composition

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

A task handles a call, a service keeps state across calls within its version, a module runs inside its consumers, an interface exposes a shared contract, a worker keeps running, and a job performs a live operation that can be retried from the start. [Writing agents](WRITING-AGENTS.md#how-the-agent-lives) covers the six types.

## Language-model calls: cernanto/llm

The language-model agent reads values from unstructured material and writes text. Its generated calls return the types the program needs:

| Function      | Result                                    |
| ------------- | ----------------------------------------- |
| `llmList`     | A list of strings                         |
| `llmNumber`   | A number                                  |
| `llmDate`     | A date-parseable string                   |
| `llmConcise`  | A concise string                          |
| `llmDetailed` | A fuller answer, summary or drafted reply |

Each call takes a context object, a constant prompt and optional settings. The context can include images or PDFs. A structured result is assembled in code from the relevant readings; arithmetic and policy checks remain code.

The [expense desk](../agents/examples/workflows/expense-desk/README.md) demonstrates this with a receipt photo. It reads the merchant, purchase date and total separately, then checks the amount against its approval limit. The [helpdesk](../agents/examples/workflows/helpdesk/README.md) uses `llmDetailed` to answer from selected handbook pages.

A typed result is not a guarantee that the model interpreted the source correctly. Missing information can produce a `judgment-inconclusive` error, which the generated program handles according to the specification. Read the [agent's specification](../cernanto/llm.cern.md) for its validation and prompt procedure.

## Decision models: Jev and LLMs

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
TypeSafe's decision model, whose probabilities are shown in the trace
beside the answer:

<!-- lab manual: requires your Jev API key and changes the plane's provider -->

```bash
cernanto config cernanto/decision/jev token=YOUR_JEV_API_KEY
cernanto config cernanto/decision default=cernanto/decision/jev
```

The adapter's `endpoint` and `model` settings point it at Cloudflare's
Clef or at a local Ollama, which speak the same request. Reading a
value out of text and writing text stay with cernanto/llm. A decision
engine reads text; a picture in a decision is refused with a message
naming the key.

### Configuring a compatible decision endpoint

The [decision interface](../cernanto/decision.cern.md) defines the shared contract. The [Jev adapter](../cernanto/decision/jev.cern.md) reads the settings below on each call:

| Setting on `cernanto/decision/jev` | Purpose                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `endpoint`                         | A compatible API endpoint; defaults to `https://api.typesafe.ai`                              |
| `model`                            | The model to request; defaults to `jev-latest`                                                |
| `token`                            | The provider's API key; may be absent for a local endpoint that accepts unauthenticated calls |
| `certainty`                        | The default certainty threshold; defaults to `0.7`                                            |

Changing the endpoint and model selects a compatible service without changing consumers. A local model must be exposed through the API this adapter expects. This adapter currently reads text, even if a provider supports additional input types elsewhere.

For the provider's own API, see [TypeSafe's documentation](https://docs.typesafe.ai/introduction).

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

### When the page itself was ambiguous, and tests that must not act

When the spec itself was ambiguous, the tests can share the misunderstanding, and the trace is where you see it. You fix the sentence, not the code, and you can pin the case. The support follow-up says a response counts whether it was there before the team was told or recorded any time after, and its paragraph on proving the desk pins it:

```md
a response recorded on the ticket, even one recorded before the team
was told, ends the wait as a response, with no reminder
```

Tests run live, so a workflow that sends mail or refunds money is tested on a second account of the provider, logged in as the connector's `tester`, or with a `Mocks:` line that has the tests replace the one dependency whose real action a test must not cause; every other dependency stays real. `cernanto code <agent>` prints the generated code, `cernanto tests <agent>` its tests, and `cernanto trace` prints what ran. When prose is not enough, existing code is an npm package one `Uses:` line away.

## Connect your services

Today an integration is written by hand, the client, the auth, the pagination, the retries and the tests, and kept working when the API changes; or rented from a service that charges per call, holds your credentials under its own app registration, and sees every record that passes through it. Here anything with a REST API and an OpenAPI document, an MCP server, or an npm package that talks to it is one `Uses:` line that names it and a sentence that says the work. The compiler turns its operations, tools or API into typed functions, your coding assistant reads the vendor's own documentation and writes the integration code, and the tests prove it against the real service before it ships; when the vendor's API document moves, the next deploy re-checks the code against it and names what broke. The code runs in your own process under your own credentials, connected once and held in your custody, and there is no per-call fee.

### Two connectors in full, and what the setup is

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

Uses: openapi:https://orders.acme.internal/openapi.json

Given an order id, answer its status and its total.
```

<!-- lab manual: requires the reader's private API and credentials -->

```sh
cernanto auth login acme/orders orders.acme.internal   # answers the agent's ask: paste the token
```

The declaration is the `Uses:` line and the one sentence; the setup is named beside it: the account logged in once, as the agent's own, into the plane's safe; a file the page grants for a lookup table; and, for the tests, a second account of the provider logged in as `tester`, or a `Mocks:` line that has the tests replace the one dependency whose real action a test must not cause. The other direction is one line and one sentence too: an `Implements:` line that names the document and "serve the API that the document describes" make your agent the server of that document, listening on the port its spec names, as the refund desk is.

Events arrive through a wait. An agent that works with `cernanto/webhook` is its own endpoint, and on a laptop or a homelab the free hosted relay at hooks.cernanto.com fronts it with no public IP, DNS record or certificate on your side, so a Stripe payment, a GitHub push or a form submission reaches the wait your agent keeps open the moment it happens.

The catalog under [`connectors/`](../agents/connectors/README.md) holds the email and chat interfaces, four keyless connectors (the ECB's euro rates, Open-Meteo, DeepWiki, ntfy) and seven connectors to real services (Slack, Gmail and the Google client module it shares, Jira, Postgres, Stripe and HubSpot), each a spec of a few lines beside its package, named by its id and asking for its account on the first call that needs it; each desk's README carries its real form as a diff. It is not a count: a service not in it is one `Uses:` line away, and the connector you write for your own tools is the same kind of file.

## A minimal timer

This small agent isolates durable waiting:

```md
# Reminder

Given a message and a number of minutes, wait that long, then answer
the message.
```

The call waits and returns the supplied message as its result. A notification workflow would also name the email or chat service that delivers it. The runtime journals the wait so it can recover after a process restart; the machine must be available to execute the continuation.

The [support follow-up](../agents/examples/workflows/support-follow-up/README.md) is the fuller example: classify a request, notify a team, wait for a response and send a reminder.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
