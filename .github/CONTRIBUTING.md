<!-- SPDX-License-Identifier: Apache-2.0 -->

# Contributing

Cernanto grows by specs shared. The surface open to everyone is the
language's: specs, examples, connectors, interfaces, the guides, and the
runtime that runs them.

## Where contributions go

- **A spec you wrote.** Post it in Discussions under Show and tell. A spec
  is a readable post, and other people's specs are how the language
  learns what it needs next.
- **An example or a connector.** Open a proposal issue first, in a few
  sentences, then a pull request under `agents/`: a connector under
  `agents/connectors/`, an example under `agents/examples/`. A connector
  is a task implementing one of the standard interfaces; its README
  shows the deploy and one call.
- **A problem.** Open an issue with the smallest spec that reproduces it.
  A fix to a platform agent under `cernanto/` is a sentence in that
  agent's spec, which the maintainers recompile: the package beside the
  spec is the compiler's output, judged by its tests, and is never edited
  by hand.
- **A runtime, process package or cli patch.** Welcome, small and with
  its tests where the package carries them. The process package
  (`runtime/process`) with the host job is the whole of what runs a
  plane on one machine or on many, the plane's coordination, the port
  forwarding, the upgrade and the checkpoints included; the maintainers
  verify a patch against the test tiers that run on their own
  infrastructure (a local tier of three hosts and a lab of two
  servers) before it lands.
- **The guides.** `docs/WRITING-AGENTS.md`, `docs/RUNNING-A-PLANE.md` and
  the READMEs take corrections and clearer sentences by pull request.

## How a change lands

This repository is published from the maintainers' tree. A pull request
is reviewed here; when it is accepted it is applied to that tree with
your authorship and appears here with the next publication, and the pull
request is closed with a reference to the commit that carries it.

Every contributor signs the Contributor License Agreement in
`.github/CLA.md` before their first change is merged.

## Style

- Every source file begins with the two-line header of its folder's
  license. The root `LICENSE` is the map.
- Commit subjects read `type(scope): what changed`, lowercase, under 72
  characters. Types: feat, fix, refactor, test, docs, perf, build, ci,
  chore.
- English, plain words, no emoji. A comment states a constraint the code
  cannot express; the code says the rest.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm test` is
  what CI runs on every pull request.
