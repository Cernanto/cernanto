# Why compile an agent?

[Documentation](README.md) · [Project README](../README.md)

Cernanto keeps an English specification as the source of a program. A coding assistant translates it into TypeScript; contracts, static gates and independently written tests check the translation; a durable runtime executes it.

That design addresses two separate problems: maintaining the intent of generated code, and running a procedure whose progress must survive failures.

## Keep the source you meant

A coding assistant can produce a working application from a conversation. The long-term question is what you maintain when the requirements change.

With Cernanto, the specification remains authoritative. You change the English and deploy again. The compiler amends the existing implementation, checks it, and updates tests when the promise they check has changed. The specification and compiled package live together in git.

This makes a policy change reviewable at the level of the policy. **Specifications outlive models:** a future compiler or coding model has a source to translate again against the established contracts and tests. Recompilation can produce different code; it must pass the same applicable checks.

The generated TypeScript is still available for inspection and diagnosis. It is the translation that Cernanto manages, while the specification is the source the author maintains.

## Give a model a question, and code a procedure

An agent loop can ask a model which tool to call and what to do next. That is useful when the route cannot be specified in advance.

Many business procedures have a different shape. The route is known, while particular steps need a judgment:

- Which team should handle this support request?
- What total is printed on this receipt?
- Which handbook pages answer this question?
- How should this outcome be explained to the customer?

Cernanto compiles the procedure and places model calls at those steps. A receipt's amount can come from a model, while the approval limit is an ordinary numeric comparison. A reply can be generated, while the decision to refund follows a policy in code.

That does not remove model error. It makes the model's role explicit and gives the program a place to handle an inconclusive answer, apply a threshold, or ask a person.

### The reliability argument

As a simplified illustration, if ten required model decisions each succeed independently with probability 0.99, all ten succeed with probability `0.99 ** 10`, about 90.4 percent. This is an illustration of compounded uncertainty, not a measured failure rate for agent frameworks. Real errors are not necessarily independent.

Measured evaluations illustrate why one successful demonstration is not enough. In the June 2024 [τ-bench study](https://arxiv.org/html/2406.12045v1), the GPT-4o function-calling agent achieved a retail task success rate of 61.2 percent. Its retail `pass^8`, which measures success across all eight trials, was below 25 percent. Those results describe that model, benchmark and agent setup in 2024; they are not a measurement of current models or of Cernanto.

In its May 2026 revision, the [AgentPex study](https://arxiv.org/abs/2603.23806v2) evaluated 424 traces from τ²-bench and found specification violations that outcome-only scoring did not capture. A correct final result and a procedure that followed every required rule are different things to test.

Compiling a procedure avoids asking a model to rediscover that procedure on each run. It does not make a wrong implementation correct, nor make the remaining judgments infallible. Those are reasons for the gates, tests, explicit branches and traces.

Frameworks such as LangGraph and Mastra also support procedures with predefined control flow. The distinction is that Cernanto maintains the procedure as English and supplies the compilation and execution system around it. [Comparisons](COMPARISONS.md) explains that boundary.

## What an enterprise needs

A procedure needs more than a successful demonstration: behavior QA can exercise, failure security reviewers can bound, evidence operations can inspect, and rules the business owner can read and change.

| Need                       | What Cernanto supplies                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Repeatability              | A compiled procedure, retained tests and recorded results for recovery. Fresh model judgments can still vary.                   |
| Bounded failure            | Declared dependencies, typed model questions, and explicit branches for uncertainty or human approval.                          |
| Evidence                   | The specification, implementation, tests and compile pins in one package, with traces of execution.                             |
| Predictable model use      | Explicit model-call sites. Steps that require no model run as code; provider availability and charges still apply to judgments. |
| Operational continuity     | Journaled execution that can resume after a process failure, subject to the documented external-write and version boundaries.   |
| Ownership of the procedure | English policies reviewed as diffs and recompiled when they change.                                                             |

These are mechanisms to evaluate against the team's requirements, not automatic security approval or a guarantee that every rule was specified correctly. The examples make each claim inspectable.

## Compose through contracts

Each callable agent exposes a typed contract: its operations, arguments and results. Other agents compile against that contract without needing its implementation.

An interface gives several providers the same contract. A workflow can call the chat interface while the runtime binds it to sandbox chat or Slack. A module is linked into its consumers; a service owns state and can be called across processes or machines.

The compiler hands the coding session the dependency contracts named by the specification, keeping their implementations out of that session's context. This applies information hiding to compilation: the consumer learns what a dependency promises, not how it is implemented. Import and structure checks constrain the generated implementation to its declared surface. This is an architectural boundary to inspect and test, not a claim that generated software cannot have defects.

[How it works](HOW-IT-WORKS.md#typed-contracts-and-composition) follows a concrete system.

## Check the translation

The coding session writes the implementation. A separate session writes tests from the specification and contract without seeing that implementation. The tests then run against the deployed agent and its dependencies.

When a check fails, the compiler reports the failure and attempts a repair. The resulting package retains the source, implementation, tests, contract and compile pins, so the evidence can be inspected.

Independent sessions reduce one kind of coupling between code and tests. They can still share a misunderstanding of ambiguous prose. The author must review the behavior, clarify the specification and add cases where necessary. Live testing also needs appropriate accounts or explicit replacements for actions a test must not perform.

This is what “verified” means here. It is not a formal proof that arbitrary English and generated code are equivalent.

## Keep execution evidence

The runtime journals calls, timers and model results. Recovery reuses recorded work, including the answer to a judgment, rather than asking the model again.

That is different from claiming that two fresh runs will produce identical model responses. A model can return another answer on a fresh call. A restart recovers an existing call from its recorded results.

The runtime also does not eliminate every external side-effect boundary. If a process crashes after an external write but before its result is recorded, a retry can repeat the write. The operation and supporting API need an idempotency mechanism when duplication is unacceptable.

[Runtime guarantees](RUNTIME-AND-GUARANTEES.md#guarantees-and-limits) covers recovery, service versions, state and data flow.

## The compiler is written in Cernanto

The compiler, parser, control plane, gateway, trace reader and credential-custody agents are specified under [`cernanto/`](../cernanto/). Their compiled packages sit beside the source specifications.

Start with [`cernanto/compile.cern.md`](../cernanto/compile.cern.md). It describes the compiler in the same language used by application agents, and composes other agents through their contracts. The compiler can compile its next version through the same gates and live tests.

The language runtime, process package, package-format kit and CLI are handwritten. This is a concrete use of the language for its own platform, rather than a claim that every part of the repository was generated. The specifications and packages are the inspectable evidence: the compiler agents' implementations are generated from their English source.

## Fit and direction

The natural starting point is the business-logic layer: services, integrations, workflows, schedulers and data movement. A team can begin with an assistant, add human approval for actions, and automate more of a procedure as its tests and traces justify it.

The useful property is that the operations manual and the maintained program can be the same set of specifications. Extending that approach into other domains requires appropriate control, testing and evidence for those domains.

## Research and background

The original design discussion referenced the following work. These are background reading, not benchmarks of Cernanto or proof of its runtime guarantees.

- [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045), on evaluating tool-using agents.
- [Willful Disobedience: Automatically Detecting Failures in Agentic Traces](https://arxiv.org/abs/2603.23806), on detecting rule violations in traces.
- [The Register's report on the Replit/SaaStr database incident](https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/), an operational incident discussed in the original rationale.
- [McKinsey's State of AI](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai), [Gartner's agentic-AI project forecast](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027), and [MIT Project NANDA's GenAI Divide report](https://nanda.media.mit.edu/ai_report_2025.pdf), on adoption and deployment.

For evidence specific to this project, inspect the [examples](../agents/README.md), their generated tests, and their recorded walkthroughs.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
