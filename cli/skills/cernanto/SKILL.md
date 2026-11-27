---
name: cernanto
description: Write, change and deploy Cernanto agents, plain-English `.cern.md` files, the agents' source, which the cernanto cli compiles into verified, durable TypeScript. Use whenever the user asks for an agent, a workflow, a desk, a connector, a service, a module or an interface in a Cernanto workspace (a folder with a `cernanto.json` marker or `.cern.md` files), asks to change, fix, test, call or trace one, or asks what a spec may say. The spec is the source and the generated code is never edited.
license: Apache-2.0
---

# Writing Cernanto agents with a coding assistant

A Cernanto agent is one markdown file, `<id>.cern.md`, whose prose
says in plain English what the agent does, and whose labeled lines
declare its premises: the kind of agent when it is not a task
(`Type:`), everything it works with (`Uses:`), what it implements
(`Implements:`), and under `## Tests` what its tests use and mock.
Its path from the workspace root is its id
(`payments/recovery.cern.md` is `payments/recovery`). A deploy
compiles the source into TypeScript, gates it, writes tests from the
prose in a second session, proves them live against the real
dependencies, and ships it. The package the compile writes beside the
spec, `.cern/<name>.cern`, is source: committed with the spec, never
edited, never ignored.

Read `WRITING-AGENTS.md`, beside this file, in full before the first
spec of a session. It is the language reference: how an agent lives,
what it may name, how it reaches the world, waits, is tested and
changed. This file is the loop and the rules a coding assistant gets
wrong by instinct.

## The loop

1. **The plane.** `cernanto dev` starts the local plane and installs
   the runtime the first time; any other verb starts a parked plane on
   its own. A compile runs on the Claude Code or Codex login signed in on
   this machine, or on an API key set under that coding assistant's agent
   (`cernanto config cernanto/harness/claude-code api-key=<key>`, then
   `mode=api-key`, then
   `cernanto config cernanto/harness default=cernanto/harness/claude-code`).
   A judgment at run time uses the same unless the plane is pointed at a
   decision engine.
2. **Look first.** Read the specs already in the workspace, and the
   examples of the Cernanto repository (`agents/examples/basics/` is
   one lesson per file, `agents/examples/workflows/` the business
   desks, `agents/connectors/` the interfaces and their providers).
   They are packages of the registry under the same names, so without
   the repository `cernanto source examples/workflows/helpdesk` prints
   one, and `cernanto registry get <name>` brings an agent into the
   workspace as source, its file beside its package (`<folder>/` for
   every agent under a folder). A spec that does what the user wants
   is copied and changed, never rewritten from nothing.
3. **Write the spec, whole, in one edit.** A `# Title`; a `Type:`
   line when the agent is not a task; a `Uses:` line granting
   everything it works with (`Uses: npm:grammy@^1, cernanto/auth,
   file:prompts/judge.md`); an `Implements:` line when it is one of an
   interface's providers or serves an OpenAPI document; then one to
   three short sentences most of the time: what the agent is given,
   what it does with it, what it answers, what it refuses, naming each
   thing it works with where the work needs it. Every branch that
   matters is a sentence; a branch left out is left out of the code.
   Testing sentences, if any, go under a `## Tests` heading with the
   tests' own `Uses:` and `Mocks:`. The terms close the file under
   `## License`: `Copyright: 2026 Acme` and `License: MIT`. The person
   reviews one document.
4. **Deploy.** `cernanto deploy <id>` compiles and ships; it takes
   minutes and prints a plain log. Read the plan lines before anything
   else: `reads a <type>, from the Type: label` (`reads a task` without
   one), `reads Uses: ...`, `reads the tests; Uses: ...; Mocks: ...`.
   They are the source's own labels read back. A label spelled nearly
   right is refused where it stands, with the spelling meant: `"uses:"
   is not a label; did you mean "Uses:"`, `did you mean "## Tests"`;
   fix the spelling, never work around it. `cernanto deploy --dry-run
   <id>` prints the plan alone. A warning that the agent compiles to a
   large program, printed last with its count, is settled by a split
   alone: an agent for the part that moves, and a `Uses:` on the one
   that keeps the rest.
5. **A failed test.** The compile routes a failure to the session at
   fault, the code or the tests, and tries again by itself; the log
   says who. When the tests shared a misunderstanding of the spec, fix
   the sentence and pin the case in a testing sentence. The generated
   code is read for diagnosis (`cernanto compiled <id>`, and its tests
   with `cernanto tests <id>`) and never edited.
6. **Try it.** `cernanto contract <id>` prints the card: the functions,
   what each takes and answers, and the call line to paste (a compile
   ends on the same card, and `cernanto contract <path>.cern` prints
   it for a compiled package before its deploy).
   `cernanto call <id> <function> key=value ...` calls one, the values
   named or in order (`--args '<json>'` for a record or a list), and
   prints the call as a conversation, then the answer. A module's
   function is called where the module runs:
   `cernanto call <module> <function> --in <agent>` inside a task, a
   service or a job that uses it (a worker takes no call), or with no
   `--in` by itself (the first such call starts one service,
   `<module>-standalone`, that keeps the module's memory between calls
   and parks when idle; `cernanto delete <module>-standalone` ends it).
   `cernanto restart <id>` runs a service's, a worker's or a job's
   program again from the top, with an empty memory.
   `cernanto trace <id>` reads the latest call; `-f` follows the agent
   live. The user can watch the same call in the plane's web UI, at the
   address `cernanto dev` printed; you open no browser yourself.
   `cernanto traces <id> debug` stores the agent's debug lines too,
   shown by `--debug` on `trace` and `call` (`on` puts it back, `off`
   stores nothing; each change starts the agent again as a new version).
   `cernanto calls <id>` lists recent calls, `cernanto ls` the agents,
   and `cernanto source <id>` prints the source a deployed agent or a
   package was compiled from (`--to <folder>` writes it there with the
   files it names).
7. **Change it.** Edit the sentence and deploy again: the compile amends
   the previous code and keeps the tests the change did not touch.
   `--recompile` writes the agent afresh from its spec; use it only when
   the user asks for a new implementation.
8. **Commit** the spec with its package. `*.cern binary` in
   `.gitattributes` marks the packages for git.

Accounts and settings stay out of the spec. An agent that needs an
account asks for it on the first call that needs it, and
`cernanto auth login <id>` answers the ask in the terminal. A value the
operator sets is `cernanto config <agent> <name>=<value>`, and the spec says
the agent reads it through `cernanto/config`. A deploy that ends
`waiting for you` compiled the agent and names what its tests still
need from a person, a login (`cernanto auth login ...`) or a setting of
the tests (`cernanto config <agent>/tests <name>=<value>`): give it and
deploy again, and the tests run as they were written.

## What the source says

The kind of agent is one `Type:` line in the head, written only when
it is not the ordinary kind. A task is the default and needs no line.

| Type:     | When                                                          |
| --------- | ------------------------------------------------------------- |
| service   | it keeps its own state between calls, or a call waits for one |
| worker    | nobody calls it; it runs on its own time                      |
| job       | one live run, started over on a failure, nothing recorded     |
| module    | it runs inside the agents that use it, like a library         |
| interface | it is only a contract that other agents implement             |

What the agent works with is granted on the `Uses:` line, exactly,
and the prose says only the work, never the agent that does it:
another agent by its id; an npm package as `npm:<name>@<major>`
(`npm:grammy@^1`); an MCP server as `mcp:<url>`, a local one as
`mcp:<the command that runs it>` with the environment it needs in
front as `NAME=value` words,
the last entry of its line; an OpenAPI document as `openapi:<url>`; a
file beside the spec as `file:<path from the spec's folder>`, kept in
the folder named for the agent; `cernanto/auth` for an account, the
prose saying what it is and what it must allow, never how to create
it; a time zone when a procedure reads local time, since the plane's
clock is UTC everywhere. The built-in agents are granted by their
path: `cernanto/decision` for a decision the code branches on (yes or
no, one of these, a level, the ones that pass, best first),
`cernanto/llm` for text read or written, `cernanto/search` for the
web, `cernanto/auth` for accounts, `cernanto/webhook` for deliveries
from providers, `cernanto/config` for settings. An implementor names
its interface on its `Implements:` line (`Implements:
connectors/chat`); an API server names its document there
(`Implements: openapi:orders/openapi.yaml`) and says in prose where it
listens.

## The rules an assistant gets wrong by instinct

- **No code in a spec.** No TypeScript, no pseudo-code, no endpoints,
  status codes or JSON shapes. An agent may name its own functions and
  say what each takes and answers, in prose; the compiler derives the
  contract from the sentences.
- **Grant the dependency, never name it or its functions.**
  `Uses: examples/sandbox/crm` and "read the ticket", not which agent
  to ask or which call to make with which arguments. The coding
  assistant the compile runs reads the dependency's contract, the MCP server's tools, the OpenAPI
  document's operations and the npm package's own documentation, and
  reaches each grant where the work needs it. An agent's id stays in a
  sentence only when it is itself the fact: an implementor to pin or
  to fall back on, an id that arrives as data.
- **Say nothing the kind gives by default.** Retries, durability,
  resuming after a crash, running calls in parallel, scaling to zero
  and the journal are the language's. A spec that explains them, or
  the design, is wrong.
- **One job per agent.** Two jobs are two agents, one using the other.
  A database, a vendor's API through an npm client, a socket or a
  command each lives in an agent of its own, one operation per
  function, and the business agent calls it.
- **Positive sentences.** What the agent does, answers and refuses. Not
  what it does not do, not a contract, not a restated API document.
- **No credentials and no console steps.** Name the account and what it
  must allow; the agent asks the operator for it.
- **A testing sentence only for what the tests cannot derive:** a
  specific case to pin, a fact only the tests need, a tool only the
  tests use. A test replaces a dependency with a mock only when the
  spec says so: for a dependency whose real action a test must not
  cause, for a refusal or a partial failure the real one will not
  produce on cue, or for one unavailable or too expensive to exercise;
  every other dependency stays real, and a stand-in provider is never
  written.
- **Nothing generated is written by hand.** No contract file, no test
  file, no package, no edit under `.cern/`. A spec is changed by its
  words and deployed.
- **A label is spelled exactly, once per section.** `Uses:`, not
  `uses:`, `Uses :` or `**Uses:**`; `## Tests`, not `## Testing`; one
  `Type:` line, one `Uses:` line per section. A source file that quotes
  another puts the quote in a fenced code block, where no label
  counts; and a line of prose never opens with a label's spelling,
  since `Type: ` at the start of a line is the label wherever it
  stands.

When a sentence has to be read twice, split it. When the compile
refused a label, the spelling was the problem, and the spelling is
what changes.

---

Copyright (c) 2026 Cernanto. This document is licensed under the Apache License, Version 2.0.
