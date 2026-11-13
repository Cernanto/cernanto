# cernanto

The command line of [Cernanto](https://cernanto.com), a programming language for AI agents and workflows: written in plain English, compiled to verified TypeScript, run durably on your own machines.

An agent is one page of Markdown. The compiler drives the coding assistant you already have, Claude Code or Codex, to write the TypeScript from your page, then gates and tests it. You never write or see the code. This package is the one install: it starts the local plane your agents run on, and it compiles, deploys, calls and traces them.

## What you need

- Node.js 26 or later, on macOS, Linux or Windows. Linux also needs `bubblewrap` and `socat`.
- To compile an agent of your own, and for any step where an agent asks a model: Claude Code or Codex, installed on this machine and signed in with your own Claude or ChatGPT subscription (the tool uses that sign-in itself, under its vendor's terms, and Cernanto never reads it), or an API key you set instead: `cernanto config cernanto/harness/claude-code api-key=<key>`, then `mode=api-key`. The precompiled examples land with Node.js alone and run up to their first judgment.

## Install

```sh
npm install -g cernanto
```

## First run

Start the plane, then land a precompiled example from the repository and call it:

```sh
cernanto dev
git clone https://github.com/cernanto/cernanto
cd cernanto/agents
cernanto deploy examples/basics/counter
cernanto call examples/basics/counter next
cernanto call examples/basics/counter next
cernanto trace examples/basics/counter
```

What you should see, with your version in place of `<version>` and the longer answers cut at `...`:

```text
$ cernanto dev
installing the local runtime @cernanto/runtime <version> into ~/.cernanto/runtime/<version>
pulling the platform release <version>, <n> packages, from https://packages.cernanto.com
the platform release <version> is installed
starting the local plane
landing the platform release <version>: <n> packages
the platform release <version> is landed; the plane converges it
the local plane is up: http://127.0.0.1:7434
...

$ cernanto deploy examples/basics/counter
landed examples/basics/counter ...
landed 1 package; nothing to compile
...

$ cernanto call examples/basics/counter next
1
$ cernanto call examples/basics/counter next
2

$ cernanto trace examples/basics/counter
Counter · Next  ok  ...
```

The counter is a service: it keeps its count across calls and across a crash. `cernanto ls` lists every agent on the plane, and `cernanto contract examples/basics/counter` says what an agent does and how to call it.

Without git, the same examples come from the Cernanto registry as source, each page beside its package, into a folder of your own:

```bash
mkdir agents
cd agents
cernanto registry get examples/
cernanto deploy examples/
```

## An agent of your own

Make a folder for your agents and put one file in it, `acme/ops/reminder.cern.md`:

```md
# Reminder

Given a message and a number of minutes, wait that long, then answer
the message.
```

From `acme`, `cernanto ops/reminder.cern.md` compiles it, writes and runs its tests, ships it and prints the line that calls it, in a few minutes. `cernanto dev` finds the coding assistant's login on its own; `cernanto dev --coder claude` or `cernanto dev --coder codex` chooses when both are signed in.

Your coding assistant writes agents well once it has the language's skill: in your workspace, `cernanto skill` installs it where Claude Code, Codex and any assistant that reads Agent Skills find it.

## What it puts on your machine

The first `cernanto dev` installs the local runtime, [`@cernanto/runtime`](https://www.npmjs.com/package/@cernanto/runtime) from npm at the same version, under `~/.cernanto`, and pulls the platform's agents, which are packages of the Cernanto registry like any agent's. Then it starts the plane: its gateway on port 7434, which takes a request with no operator token from this machine alone, with its data under `~/.cernanto`. An agent that serves an API of its own listens on its own port, on every address of the machine. It touches nothing else, and it runs as you, never as root.

## Stopping, upgrading, removing

- `cernanto dev down` stops the plane and keeps its data; `cernanto dev` starts it again.
- `cernanto dev reset` wipes the plane's data and starts fresh.
- A new release: `npm install -g cernanto@latest`, then `cernanto dev down` and `cernanto dev`. The plane comes up on the new release with what it held; none of your generated code changes until you recompile.
- `npm uninstall -g cernanto` with `rm -rf ~/.cernanto` removes everything.

## Documentation

- [The repository](https://github.com/cernanto/cernanto): what Cernanto is, the walkthrough, the guarantees and the limits.
- [Writing agents](https://github.com/cernanto/cernanto/blob/main/docs/WRITING-AGENTS.md): the author's guide, the whole language in one document.
- [The examples](https://github.com/cernanto/cernanto/blob/main/agents/README.md): the basics tour, the desks and the connectors.
- [Running a plane on servers](https://github.com/cernanto/cernanto/blob/main/docs/RUNNING-A-PLANE.md): the operator's guide.
- [Discussions](https://github.com/cernanto/cernanto/discussions): the fastest way to reach the people making Cernanto.

`cernanto --help` lists every command, and `cernanto <command> --help` says what one takes.

## License

This package, the cli, is under the Apache License, Version 2.0. The runtime it installs is under the Business Source License 1.1: free on your own machines, one or many, for production use at any size. The repository's [LICENSE](https://github.com/cernanto/cernanto/blob/main/LICENSE) is the map.
