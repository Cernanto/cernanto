# Runtime, setup and guarantees

[Documentation](README.md) · [Project README](../README.md)

Cernanto's local runtime is called a plane. This guide covers setup, execution boundaries, deployment and licensing. For server installation, use [Running a plane](RUNNING-A-PLANE.md).

## Local setup

Use Node.js 26 or later on macOS, Linux or Windows. Linux also needs `bubblewrap` and `socat`.

```bash
npm install -g cernanto
cernanto dev
```

Run that block on its own and wait for the shell prompt before pasting the next one. If an assistant is signed in, `cernanto dev` detects it. Otherwise `connect which? [1]` asks which assistant to connect. Enter selects Claude Code. To try the counter without signing in, press **Ctrl-C at that question**; the plane is already running.

Then deploy the examples:

```bash
git clone https://github.com/cernanto/cernanto
cd cernanto/agents
cernanto deploy examples/
```

The packages are precompiled. The counter runs without model access:

```bash
cernanto call examples/basics/counter next
```

On a fresh counter, the answer is `1`. Calls that ask a model need the model access described below. Changing an agent's specification and deploying it invokes the compiler.

The plane serves its own web UI. One command opens it in your browser:

<!-- lab manual: it opens a browser on the reader's own machine -->

```bash
cernanto ui
```

Select `examples/basics/counter` in the list of agents. The call you just made is there, read as a conversation. Press **Next** in the box under it, and it answers the next number. [The web UI](UI.md) shows what else is on that screen.

### Get the examples without git

After installing the CLI and starting the plane, make a folder of your own:

<!-- lab manual: an alternative registry workspace; the lab supplies its own checkout -->

```bash
mkdir agents
cd agents
cernanto registry get examples/
cernanto deploy examples/
```

The registry supplies the specification beside each package. [The examples guide](../agents/README.md#the-same-agents-from-the-registry) explains the other ways to use published agents.

### Coding assistants, model access and local services

If you sign in through Claude Code or Codex after the plane has started, run `cernanto dev` again before calling an agent that needs a model. It detects and records the login for the plane. Finish any prompt and return to the shell before pasting further commands.

- Claude Code or Codex, installed on this machine and signed in with a paid Claude or ChatGPT subscription. The compiler runs it: the coding assistant writes the TypeScript from your specification on your laptop, the compiler gates and tests it, and your agents' judgments run on the same sign-in. The login is the tool's own: install Claude Code or Codex from its vendor and sign in inside it once. `cernanto dev` finds the login on its own, or offers the sign-in at the terminal; `cernanto dev --coder claude` or `cernanto dev --coder codex` chooses when both are signed in. A compile spends a few minutes of the subscription; a judgment is one call to it, whose usage `cernanto ls` reports. The sign-in stays the tool's own: Cernanto never reads or keeps it, and what you spend of the subscription is under its vendor's terms. An API key works instead, by three settings: the key and the mode under the coding assistant's own agent, then that agent named as the plane's coding assistant (`cernanto config cernanto/harness/claude-code api-key=YOUR_API_KEY`, then `mode=api-key` under the same agent, then `cernanto config cernanto/harness default=cernanto/harness/claude-code`; for Codex, `cernanto/harness/codex` in all three). Without the third, a plane that has no coding assistant yet still asks for a sign-in. A plane on servers always runs on a key.
- A decision engine the plane is pointed at, such as Jev, answers decisions on its own key.

The first `cernanto dev` installs the local runtime (`@cernanto/runtime` from npm at the same version) under `~/.cernanto`, pulls the platform's agents, which are packages of the Cernanto registry like any agent's, then starts the plane: it lands the platform's npm dependencies under `~/.cernanto`, starts its gateway on port 7434, and touches nothing else. The gateway listens on every address of the machine and takes a request with no operator token from this machine alone. An agent that serves an API of its own listens on its port as any server does, on every address: of the examples, `examples/basics/orders` on 8080 and `examples/workflows/refund-desk` on 8085, whose requests run on your sign-in, so land those two on a network you trust. `cernanto dev down` stops it, `cernanto dev reset` wipes its data, and `npm uninstall -g cernanto` with `rm -rf ~/.cernanto` removes it. A new release arrives with `npm install -g cernanto@latest`; it updates the runtime under your agents at their next start and none of your generated code until you recompile.

### Check recovery with the counter

From `agents/` after deploying the examples, call the counter, interrupt its process, and call it again. Its value continues from the preceding call.

On macOS or Linux:

```bash
cernanto call examples/basics/counter next
kill -9 $(lsof -c node 2>/dev/null | awk '$4 == "cwd" && /basics-counter-s/ {print $2}')
cernanto call examples/basics/counter next
```

On Windows, use PowerShell to interrupt the process between those two calls:

```powershell
taskkill /F /PID (Get-CimInstance Win32_Process -Filter "Name='node.exe' AND CommandLine LIKE '%basics-counter-s%'").ProcessId
```

The [support walkthrough](../agents/examples/workflows/support-follow-up/README.md#5-interrupt-a-waiting-call) demonstrates an interrupted wait with a recorded model decision.

## One file of your own

Open a terminal outside the Cernanto checkout and make a folder for your agents:

<!-- lab manual: the lab supplies a disposable project outside its examples workspace -->

```bash
mkdir acme
cd acme
mkdir ops
```

Create `ops/reminder.cern.md` with this content:

<!-- lab workspace acme -->
<!-- lab file ops/reminder.cern.md -->

```md
# Reminder

Given a message and a number of minutes, wait that long, then answer
the message.
```

This agent waits and returns the supplied message as the call's result. It does not need a model when it runs; compiling it needs the coding-assistant access described above.

From `acme`, run:

```bash
cernanto ops/reminder.cern.md
```

The first compile usually takes a few minutes. Cernanto writes and runs the agent's tests, deploys it, and prints the command that calls it. The agent's id is `ops/reminder`. Its package is written to `ops/.cern/reminder.cern`, containing the generated code, tests, contract and compile pins.

Keep both `ops/reminder.cern.md` and `ops/.cern/reminder.cern` in version control. Mark `*.cern binary` in `.gitattributes`; the package is part of the source you keep, not a disposable output. Change the English and deploy again to amend it.

Without a `cernanto.json` marker, the folder where you run the command is the workspace root. For a larger project, add `cernanto.json` with `{"version": 1}` so commands can find that root from its subfolders. [Your project](WRITING-AGENTS.md#your-project) covers files, dependencies and agent ids.

### Give it a judgment

Now have the agent rewrite the message as a friendly reminder after the wait. Replace the file with:

<!-- lab file ops/reminder.cern.md -->

```md
# Reminder

Uses: cernanto/llm

Given a message and a number of minutes, wait that long, then
rewrite the message as a friendly reminder and answer it.
```

From `acme`, deploy it again:

```bash
cernanto deploy ops/reminder
```

Watch the compiler amend the earlier implementation and check the changed behavior. The next call now includes a language-model judgment, so running it also needs model access. Keep the updated specification and package together.

### Use your coding assistant

From the workspace root, install the Cernanto skill:

```bash
cernanto skill
```

It installs the guide in `.claude/skills/cernanto/` for Claude Code and `.agents/skills/cernanto/` for Codex and other assistants that read Agent Skills. Each folder contains `SKILL.md` and `WRITING-AGENTS.md`. Running the command again refreshes those files to the installed CLI's version.

For every workspace on this machine:

<!-- lab manual: installs into your home folder rather than the disposable project -->

```bash
cernanto skill --global
```

The global form uses `~/.claude/skills/cernanto/` and `~/.agents/skills/cernanto/`. Then ask for an agent in a sentence, such as a desk that reads Jira tickets and tells the team on Slack. The assistant writes the specification, deploys it, reads the compiler's interpretation and trace, and changes the English when needed.

## Guarantees and limits

- **Verified means:** the type checker, the import and structure gates, then tests written in a separate session from the spec and the contract, run against the deployed agent and its real dependencies. It is not a proof of equivalence to English: two sessions can share a misunderstanding, and a live dependency cannot supply a rule the author left out.
- **Durable means:** every call to another agent, every OpenAPI and MCP operation, every timer and every judgment is journaled, so after a crash or a restart the procedure resumes where it stopped, its recorded steps answered from the journal. What the journal does not hold (a fetch, a query, a command written straight into an agent) runs again on a replay, which is why the world is reached through an agent whose job is that reach. A new version of a service starts its waiting calls again from their first line, with fresh memory. The one boundary every durable system shares: a crash between an external write and its record can repeat the write, so the spec's "never twice" sentence is what the code keys on, and a supporting API deduplicates the retry. In the trade's words this is durable execution: a step the journal holds is not run again, a write to the outside world is at-least-once, and the idempotency key is what makes it exactly once at an API that honors one.
- **Long-running by design:** a call can wait for a timer or for a person, the human-in-the-loop step, for as long as it takes; the wait costs nothing and resumes after a restart. On Linux servers a long-running agent's journal is cut at a checkpoint image, so its recovery replays the short journal after the image.
- **Deterministic where it can be:** the procedure is code and takes the same path every time; a fresh judgment can vary; a replay reuses the recorded one and never asks the model again.
- **A judgment cannot act.** It answers a typed question into a branch you wrote, behind the same thresholds as every answer; it cannot invent an action or reach a tool the spec did not name. A spec that asks for no judgment, and names nothing that does, makes no model calls when it runs.
- **Two models, kept apart.** The package names the model that wrote the code, the doctrine version it was taught and when the tests passed; changing the coding model changes nothing until you recompile. A judgment uses the judgment model the runtime is configured with, and recovery reuses its recorded result.
- **What leaves your machine:** during a compile, the spec, the contracts and the files it names go to your coding assistant, which may also read a library's public documentation; at run time, a judgment's context goes to the judgment model; your agents talk to the services you named; a webhook delivery crosses the relay on its way to you. Nothing else, on a laptop or on a cluster. The plane's [web UI](UI.md) adds two reads that your browser makes itself, with nothing of the plane in either: the public list of the Cernanto registry's packages, and npm's search for a package name typed into a source's grants.

## Deploying over running work

A deploy does not stop your system, and you write nothing for what follows: versioning is the runtime's work. What it does to the calls in progress, the calls in flight, depends on the kind of agent:

- **A task or a job rolls with overlap.** The new version starts beside the old one and takes calls from the moment it is ready. The old one takes no new call and stays up to finish the calls it holds, however long they wait; then it is retired.
- **A service or a worker is replaced.** A service's new version starts with fresh memory, and the calls that waited on the old version's memory start again in the new one from their first line. A worker's run ends, and the new version starts its own. A call made while the new version is still starting waits for it.
- **A module rolls the agents that use it.** It runs inside them, so each of them gets a new version of its own, by its own kind's rule, a few at a time.
- **What calls the agent keeps running.** When the agent's contract held, its callers are neither recompiled nor restarted, and their next call reaches the new version. When the contract broke, the compile recompiles the callers in the same run. A call that is already running in an older caller still speaks the old contract, so where calls in flight matter, keep a change compatible: add to a contract rather than change what it already promises.

**How a call finds a version.** Every copy of every agent keeps a record in the plane's store: the server and the port it listens on, the version it runs, and whether it serves. A caller reads the records, chooses one live copy and sends the call straight to it, server to server, and the call is journaled. A copy that is leaving declines a new call, and the caller asks another; an agent with no live copy is started for the call, which waits for it.

**Two limits.** A call is finished by the version that took it for as long as that version's process lives. When that process is lost while its version is leaving, as when its server dies, the newest version takes the call over. A task's call is replayed from its journal: the steps it had recorded are answered and not run again, and the step that was cut short runs again. A job keeps no journal, so its call is answered to its caller as an error and is not run again. And a service's memory belongs to its version: what must outlive a deploy lives in an agent that owns storage.

The basics tour [changes an agent while one of its calls waits](../agents/examples/basics/README.md#triage-a-judgment-and-a-wait-route-a-support-request), and shows the two versions answering side by side. The platform's own release is rolled the same way, one server at a time: [Upgrading](RUNNING-A-PLANE.md#upgrading).

## Watching the plane

Observability comes with the runtime, with nothing to add to an agent's source. `cernanto ls` lists every agent on the plane, one line each, the way `ps` lists processes. Its header and one of its lines, the triage example while one of its two calls still waited:

```
AGENT                           TYPE       STATUS    CPU  RAM    SNAPSHOT  JOURNAL  CALLS IN  ACTIVE IN  CALLS OUT  ACTIVE OUT  AI TOKENS  AI COST
examples/basics/triage          task       ready     1m   389Mi  -         4Ki      2         1          6          0           20.7K      $0.0534
```

- **STATUS** is `ready`, `starting` or `parked` for an agent that runs, `waiting for login` for one whose call waits for an account, `linked` for a module, which runs inside the agents that use it, and `contract` for an interface. A module called by itself is listed beside its own line as `<module>-standalone`, a service.
- **CPU and RAM** are what the agent's own processes use, in thousandths of a core and in mebibytes. Each copy measures itself, every ten seconds while it works; a command or a local MCP server it started is in no count.
- **SNAPSHOT and JOURNAL** are the checkpoint image the plane holds of the agent and the journal written since: what a restart loads and what it replays. A laptop keeps the journal alone.
- **CALLS IN and CALLS OUT** are the calls it took and the calls it made since the totals began; `cernanto ls <agent>` says since when.
- **ACTIVE IN and ACTIVE OUT** are the calls its copies hold right now, asked of the copies themselves. A `+` after the number says a copy did not answer, and `?` that none did.
- **AI TOKENS and AI COST** are the tokens of the model requests made for the agent, and their price where the provider reports one. They are counted for your agent that asked, whichever of the platform's agents made the request. Claude Code reports a price, and Jev when its answer carries one; Codex and an OpenAI-compatible endpoint report the tokens alone. On a subscription the figure is the provider's price for those tokens, never a charge.

`cernanto ls -w` prints the table again whenever it changes, and `-o json` gives the exact numbers. `cernanto ls <agent>` adds the agent's functions, the agents a module runs inside and an interface's implementors. `cernanto calls <agent>` lists its recent calls, and `cernanto trace <agent>` reads the latest one as a conversation, `-f` following the agent live.

What is stored of an agent's calls is the agent's own setting, `cernanto traces <agent> on|debug|off`: `on` stores each call with its details and the lines it printed, `debug` adds the debug lines the compiled code writes at each operation, and `off` stores nothing. The totals and the active calls above are counted under all three. A change starts the agent again as a new version, so a service's memory starts over, and it is in effect once that version serves. Your agents start at `on`. The plane's own agents, the ones its release installs, stand at `off` unless you set them, which keeps their traces off your disk and your store's bill, and a trace of your agent then ends at the call it made of them. The compiler, the language-model agent and the decision agents (`cernanto/compile`, `cernanto/llm` and the ones under `cernanto/decision/`) start at `on`, since the plane reads their records back.

The plane's [web UI](UI.md) shows the same in a browser: its Overview is this table, sorted by any column, and an agent's Calls and Trace tabs are its recent calls and each call as a conversation.

## Where it runs

**Develop anywhere on one machine.** The whole platform runs on a laptop or any always-on machine, macOS, Linux or Windows: the compiler with every gate, the live tester, the durable runtime, the traces, as ordinary processes under one host program with no Docker needed. Your agents survive its reboots, and it is free for production use at any size on your own machines. A service's memory is its journal here, replayed at a restart; the journal grows for the life of a generation, which is fine for development and small production on one machine.

**Run production on Linux servers, one or many.** The same host program on each server, one server first and more in the same zone for a plane that survives a server: one store the servers share, DynamoDB and S3 in your own account, across three zones by the store's own nature, and the hosts taking the copies of every agent, spread over the servers, so a dead server's agents come back elsewhere from their journals. That is the plane's high availability: recovery onto the other servers, over a store the cloud keeps in three zones. Two features of this shape are Linux's: an agent's process is checkpointed into an image with CRIU once its journal has grown, and restored where its copy comes back, which bounds its replay, and every fixed port is forwarded by the kernel to the server that holds the copy. It installs onto your own servers or into your own cloud account from the same npm packages as the laptop, with the unit file the process package carries and the operator's guide, [docs/RUNNING-A-PLANE.md](RUNNING-A-PLANE.md); what leaves it is the same list as under Guarantees: the model calls, the services you named, the relay.

**Two hosted services,** both optional. A webhook delivery reaches your plane through the relay at `hooks.cernanto.com`, so a laptop needs no public address: the payload passes through the relay's memory and is never stored, and a channel's url lets a provider deliver into it and nobody read from it. The registry at `registry.cernanto.com` serves the packages you install and the ones you publish. Nothing else on your machines talks to Cernanto. Both are free for the planes you run on Cernanto, each under its own terms, which the software license does not govern.

## Production notes: one node or many

The runtime on your laptop is the same platform on one node, converged the same way as a cluster, and a package compiled on it deploys to a cluster unchanged. What the cluster adds is replication and capacity beyond one machine; nothing else in this table changes.

| Property                      | What it means                                                                                                                                                              | The mechanism                                                                                                                 | One node     | Cluster      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------ |
| Predictable                   | the procedure is code; a judgment is a typed answer into a declared branch                                                                                                 | compiled control flow, five typed judgment functions                                                                          | yes          | yes          |
| Deterministic where it can be | what can be fixed is fixed at compile time; what cannot is recorded once and never re-asked                                                                                | the gates, the journaled judgment, replay                                                                                     | yes          | yes          |
| Durable                       | a crash or a restart resumes the procedure where it stopped                                                                                                                | every call, timer and judgment journaled                                                                                      | yes          | yes          |
| State preserving              | a service keeps its memory across calls and restarts                                                                                                                       | the journal, the version's memory                                                                                             | yes          | yes          |
| Scales out and to zero        | a task runs its calls in parallel and parks when idle                                                                                                                      | placement by the runtime                                                                                                      | across cores | across nodes |
| Capacity beyond one machine   | when one server's CPU and memory are not enough, agent copies spread across servers                                                                                        | placement by the controller onto the host with the least measured load, with no budget per copy                               | no           | yes          |
| Survives a dead server        | the plane's store across three zones, a dead server replaced in minutes                                                                                                    | DynamoDB and S3 under the store seam, a server's copies coming back elsewhere from their journals and their checkpoint images | no           | yes          |
| Changed while it runs         | a deploy starts the new version beside the calls in progress, and the old one finishes what it holds                                                                       | versions side by side for a task, replacement for a service, each call routed by the copies' records                          | yes          | yes          |
| Upgraded while it runs        | a release takes one server at a time, each draining first                                                                                                                  | the hosts' turns, `cernanto cluster upgrade`                                                                                  | no           | yes          |
| Auditable                     | each stored call, judgment and failure is attributed to its agent, and what runs is a package that holds its source, its code, its tests and the model that wrote the code | the package; the traces, set per agent and kept seven days at most                                                            | yes          | yes          |
| Verified before it runs       | tests its writer never saw, run live against the real dependencies                                                                                                         | the second session, the live tester                                                                                           | yes          | yes          |
| Governed                      | what the spec names is the only reach; credentials in custody, connected once by an operator                                                                               | the import gate, the custody agent                                                                                            | yes          | yes          |
| Self-hosted                   | only the model calls, the services you named and the relay leave your machines                                                                                             | one node, or one or more plain servers in your own cloud account                                                              | yes          | yes          |

The platform is one way to package, deploy, connect, observe and recover agents, and it does four things for them together: it compiles them, verifies them, journals their calls and judgments, and replays them. On servers: one plain server first and more by capacity, the same host program on each over one store the servers share, the hosts taking the copies of each agent version and bringing a dead server's agents back elsewhere from their journals and images; a controller that converges the fleet on every change and reads the hosts' heartbeats. An enterprise moves a process onto it in rungs with the same specs at every rung: assist, approve with a sentence in the spec, run with the traces as evidence; the traces justify each promotion.

Coding sessions run in a sandbox where the system provides one, with the runtime's ports unreachable from it. Generated code reaches only what the spec names: every dependency is a declaration file the compiler hands the session, and an import of anything else fails the gate. Credentials are never in specs.

## License

- **Yours:** your specifications, application code and tests generated from them, and your traces. The output exception also covers generated support files. Cernanto implementations and separately licensed dependencies keep their own terms.
- **Production use:** internal use is expressly permitted at any scale. Other production use is permitted unless it offers the Licensed Work to third parties on a hosted or embedded basis as a competitive offering.
- **Competitive offerings:** the test is a paid Product that significantly overlaps the Licensed Work's agent or workflow platform capabilities. A Product may be a hosted or managed service, including in a customer's environment, or software customers operate themselves. The grant expressly covers provider charges for required infrastructure or usage, or support covering the Product.
- **The license map:** the language surface, CLI, package-format kit, documentation, examples and connector interfaces use Apache 2.0. The engine and platform use BSL 1.1, converting to Apache 2.0 after four years per version. Enterprise components and hosted services have separate terms.
- **The full text:** [the engine license](../cernanto/LICENSE) defines the grant. The root [LICENSE](../LICENSE) maps the components and states the patent commitment for permitted use with customer agents and outputs.

### Applications and platform services

These are explanatory examples, not additional license terms.

| Use                                                                                     | How to assess it                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run agents for your organization, including its internal platform                       | Internal use is expressly permitted, including affiliates under common control.                                                                                                                                               |
| Use Cernanto inside an expense service, support assistant or other business application | Using the engine as an internal implementation component does not by itself make the application competitive. Assess the platform capabilities offered to customers.                                                          |
| Help a client operate its permitted deployment                                          | Assisting a customer with its own permitted use does not by itself make a competitive offering. A Product offered with those services is still assessed under the grant.                                                      |
| Supply general-purpose infrastructure or an editor integration                          | Using Cernanto does not by itself establish significant overlap with its agent-platform capabilities.                                                                                                                         |
| Sell hosted, managed or customer-operated agent-platform software using Cernanto        | A separate license is needed when the paid Product significantly overlaps the capabilities named in the grant, including in a customer's cloud account. Embedding includes requiring the engine to be accessed or downloaded. |

A Product is paid when its provider charges for it, for infrastructure or usage required to use it as offered, or for support covering it. This includes compute or model-usage charges and charges bundled into a broader offering, even without a separate platform fee. A customer's independent cloud or model bill is not a charge by the Product's provider. General-purpose infrastructure still has to meet the significant-overlap test to be competitive.

The overlap test concerns the agent or workflow platform capabilities offered to customers, including within a larger Product. Writing the agents for customers does not by itself exempt an offering of platform execution or management capabilities. A genuinely unpaid Product is not competitive under this grant.

A Product that was not competitive when first made generally available does not become competitive later merely because Cernanto adds capabilities. Changes to the Product's own features or pricing must still be assessed. There is no company-revenue threshold or separate supplier-verification condition in this grant.

Customer output remains available for use and distribution under the output exception. That exception does not relicense a copied, modified or recompiled Cernanto compiler, runtime or platform implementation.

### Basis and scope of the grant

The Additional Use Grant follows the [HashiCorp/Terraform BSL model](https://github.com/hashicorp/terraform/blob/main/LICENSE): hosted or embedded use, paid Products including paid support, significant overlap, internal use, and protection for initially non-competing Products.

The substantive Cernanto adaptation is the comparison scope. Instead of referring to a vendor's paid editions, the grant names the agent or workflow authoring, compilation, deployment, execution and management capabilities of the Licensed Work. The restriction therefore does not depend on an enterprise edition or cloud service having launched.

HashiCorp incorporates interpretive guidance through its FAQ and has [explained that guidance's binding role](https://www.hashicorp.com/en/blog/hashicorp-updates-licensing-faq-based-on-community-questions). Cernanto instead states its clarifications in the license file: provider charges for required infrastructure or usage, or support covering the Product; managed services in customer environments; assistance with a customer's own permitted use; and applications that use the engine internally. These are Cernanto's adaptations, not a verbatim copy of HashiCorp's FAQ.

The other Cernanto-specific provision is the compiler-output exception. Apache 2.0 is the Change License. The standard BSL Terms and Covenants are unchanged. The examples here summarize the grant and add no terms; the clarifications travel with each licensed copy.

Each version converts to Apache 2.0 four years after its first public distribution. This software grant does not include a support contract or service-level commitment.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
