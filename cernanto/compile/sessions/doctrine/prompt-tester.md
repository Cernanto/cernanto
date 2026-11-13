# The test prompt

The fixed paragraphs of the test session's first prompt, one section
per slot, filled by the compile exactly as the code prompt's are. The
specification, the Tests section and the contracts the compile quotes
ride between them verbatim. A section is one
paragraph, and a line break inside it is the formatter's, read as a
space.

## write-opening

Write the tests for the agent "{{agentId}}": import its functions from
{{module}} and write standard node:test tests in src/<name>.test.ts
that call them and check what comes back against what the
specification promises. The tests run against the deployed agent, with
real dependencies and the real decision and language agents; there is nothing to fake,
except the agents a Mocks section below names, whose mocks you write
beside the tests.

## update-opening

The tests for the agent "{{agentId}}" already exist in src/\*.test.ts:
they are the deployed agent's tests, written for an earlier version of
its specification and contract. Update them, do not rewrite them: keep
every test that still holds as it is, change what the change below
requires, add tests for what is new, and remove only what the change
removed. They import the agent's functions from {{module}} and run
against the deployed agent, with real dependencies and the real
decision and language agents; there is nothing to fake, except the agents a Mocks
section below names, whose mocks you write beside the tests.

## changed-tests-section

What changed: the Tests section of the specification.

## before

Before:

## now

Now:

## no-section-before

(the specification had no Tests section; the tests were derived from
its description)

## no-section-now

(the specification has no Tests section now; derive the tests from its
description)

## changed-specification

What changed: the specification's prose, as a unified diff of the
previous text against the current, followed by the plan of the change,
a judge's reading of what it forces in the code (what and where). Add
the tests that prove what the plan says is new or different, and change
only the tests the change touched:

## changed-contract

What changed: the agent contract. The tests were written against this
one:

## current-contract-follows

The current contract follows below; the tests must type-check against it.

## reused-failure

The existing tests were run as they are and this is what came back; fix
them so they check what the specification actually promises:

## granted-modules

Beside it, {{modules}} export the agents the tests may use; their
contracts below say how to call them (a judgment over an answer
states whether it means what the specification promises).

## no-judgment

The Tests section grants no judgment: none is available to the
tests, so check structure and exact values; if a check would need a
judgment of meaning, it cannot be written here, and the Tests section
has to grant cernanto/decision, or cernanto/llm, the AI grant (derived
tests get it only when the agent itself reaches an AI capability).

## granted-contract

The granted agent's contract (what ./agents/{{file}}.js exports):

## specification

What the agent should do:

## tests

What the tests must check:

## derived-tests

Assert the behavior described above.

## contract

The agent contract (what {{module}} exports):

## npm-typeless-one

The granted npm package {{packages}} (installed in node_modules) ships
no type declarations and the registry has none: before importing it,
declare only the surface the tests actually call in src/<name>.d.ts
(declare module '<package>' { ... }); the doctrine's typeless-package
rule says how.

## npm-typeless-many

The granted npm packages {{packages}} (installed in node_modules) ship
no type declarations and the registry has none: before importing one,
declare only the surface the tests actually call in src/<name>.d.ts
(declare module '<package>' { ... }); the doctrine's typeless-package
rule says how.

## mocks-opening

The Tests section lists agents the tests replace with MOCKS. For each
one below, write the file named, exporting one function per function
of its contract with a compatible signature, async or sync as the
contract declares it: the mock replaces the agent whole, linked into
the tests' own copy of the agent under test, so every call the agent
under test makes to that agent during a test reaches the mock instead
of the real agent, and a value the mock hands back is the very object
the agent then holds. A mock exports nothing else: it runs in the
agent's own process beside the agent under test, where the tests
cannot reach its memory, so no helper arms it or reads what it
received; it answers from the content it receives, which the tests
seeded, and what it received is proved through what the agent
answered. The mock declares the mocked contract's named types in its
own file, verbatim, and imports nothing from the agent it replaces;
the tests import from the agents folder, the mock does not. The mock
and the tests are one
plan: what the test sends, what the mock answers, what the test then
asserts. Nothing else is mocked.

## mock

Mock the agent "{{id}}" in {{file}} (its types: ./agents/{{types}}.js);
{{reach}}. Its contract:

## implementors

The agent under test takes an implementor of {{interface}} by its
agent id, as data; the implementors deployed in this environment are
{{agents}}. Test through each of them by that id, and through no
other: a module implementor answers inside the agent's own process,
any other over the wire, and the same call proves both.

## live-edges

Every other agent the agent under test reaches is REAL in these
tests: {{ids}}. Make that part of the world act through the tests'
own grants and observe it through the agent, as when nothing is
mocked; never write a mock for one of these.

## closing

That is everything: the specification, its Tests section and every
contract the tests ride with. Write the tests for "{{agentId}}" from
them, and stop when they are written; the compile takes them from
there.
