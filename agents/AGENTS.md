# Editing this workspace

This folder is a Cernanto workspace: `cernanto.json` marks the root, and
an agent is a file `<id>.cern.md`, its id its path from here.
The author's guide is `../docs/WRITING-AGENTS.md`; these are its rules in
brief, for a coding agent working here.

- **A spec is instructions to the agent**, one to three short sentences
  most of the time: what it is given, what it does, what it answers,
  what it refuses. Never how the code does it, never a dependency's
  functions, never a contract. A sentence a test could check from
  outside stays; a sentence only the code could confirm goes.
- **How the agent lives is one `Type:` line**, written when it is
  not the ordinary kind: `service` when it keeps its own state between
  calls or a call waits for another, `worker` when nobody calls it and
  it runs on its own time, `job` when each call is one live run
  started over on a failure, `module` when it runs inside the agents
  that use it like a library, `interface` when it only defines a
  contract others implement. The prose still says what the kind means
  for the work ("one count this agent keeps for everyone who calls
  it"). The compile prints the line back (`reads a service, from the
Type: label`, `reads a task`); a spec without the line is a task.
- **A spec grants what its agent works with on its `Uses:` line**,
  exactly, and names each thing in the prose where the work needs it:
  another agent by its id, an npm package as `npm:<name>@<major>`, an
  MCP server or an OpenAPI document as `mcp:<url>` or
  `openapi:<url>`, a file or a folder as `file:<path from the spec's
folder>`, and the built-in agents under `cernanto/` (`decision`,
  `llm`, `search`, `config`, `auth`, `webhook`). The interface it is
  one of, or the API document it serves, is its `Implements:` line.
  The compile prints the lines back (`reads Uses: ...`) before it writes
  anything; read them after every edit, and a label spelled nearly
  right is refused with the spelling meant.
- **A sentence about testing lives under `## Tests`** and carries
  only what the tests cannot derive: a fact the spec does not carry, a
  case to pin, what only the tests use (the section's `Uses:`), a
  dependency the tests replace with a mock (the section's `Mocks:`).
  Nothing else.
- **Every spec ends with its terms**: `Copyright: 2026 Cernanto` and
  `License: Apache-2.0` under a `## License` heading.
- **An agent's own files live in the folder named for it**, beside its
  spec, and a part of its own is a spec inside that folder
  (`examples/workflows/helpdesk/bot.cern.md` is `examples/workflows/helpdesk/bot`).
  Never `agent.cern.md` inside a folder: a file is found by its name.
- **The package under `.cern/` beside each spec is source**: never edit
  it, never ignore it, commit it with its spec. `cernanto deploy <id>`
  compiles a stale package and lands a current one; deploy the top agent
  and everything beneath it follows.
- **A folder README is an index**: one row per spec with the id, the
  type, what it does and what it shows. The spec itself carries no
  commentary, since it is what a reader copies.
- **Run every command from this folder**: `cernanto deploy`,
  `call`, `trace`, `contract`, `source`, `code`, `tests`, `ls`.
- **An id is a path, so a spec moved or renamed is another agent**: it
  compiles anew under its new id, and its old package is removed.
