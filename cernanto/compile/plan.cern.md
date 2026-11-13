# Compile Plan

Type: module

Uses:
- cernanto/compile/contract
- npm:fs-extra
- npm:semver
- file:plan/assets/

Decide everything a compile settles before a model is involved: what
the agents root holds, the spec gates, the compile order and scope,
the granted files, the pins and the derived tester of an agent. The
engine parses every spec with the grammar and hands the parsed shapes
in, as data to the helpers and as the path of a JSON file to the
operations, so the compile's trace records paths. A file or
directory an operation cannot read is a terminal failure naming the
field and the path (`<field>: cannot read <path>: <why>`). The words
of every gate finding live in the granted file `gate-words.json`: a
catalog by code of a message and an optional hint with named
`{{slots}}`, filled through the contract module's finding-words
function; a finding names its code, its severity, the agent id, the
message, the line when one is known and the hint when the catalog or
the rule gives one. Every finding is an error except the one the
rules below call a warning.

## The workspace scan

`scanWorkspace` walks the agents root for its spec files, without
parsing any:
1. Every directory under the root is walked, the root first; an entry
   whose name starts with `.`, or is `node_modules`, is skipped
   whatever it is; a directory is walked; a file is a
   candidate when its name ends with the spec suffix `.cern.md`; any
   other file is passed over without a word (plain markdown is
   documentation).
2. A candidate's kind is its page's, read by the grammar's parse (a
   `Type:` line, else a task): the scan states none. Its id is the
   grammar's agent id of its root-relative path (posix): the path
   minus the suffix, `agent` naming its directory; a candidate with no
   id is skipped.
3. The candidates are answered sorted by their file path (plain
   string order), each with its id, its file (the absolute path) and
   its type when the name states one.

## The workspace resolution

`resolveWorkspace` reads the parsed candidates (a JSON file holding
the candidates as the engine parsed them: each with its shape when
the spec parsed, else its parse issues) and settles what the
workspace is:
1. THE GRANTED FILES. For every candidate whose spec parsed, each
   `file` grant of its Uses and of its Tests section resolves by the
   GRANT RULE below to a root-relative path; each is recorded with
   the candidate's file as the granter.
2. THE SCREEN. A candidate whose root-relative path equals a granted
   path, or lies under it (the path followed by `/`), recorded by a
   DIFFERENT candidate's file, is data: dropped.
3. THE IDS. In candidate order, the first candidate with an id takes
   it; a later candidate with the same id is dropped and the first
   gains the parse issue `two spec files claim agent "<id>": <the
   first's root-relative path> and <the later's root-relative path>;
   keep one` (no line).
4. THE WORKSPACE: `root`, and `agents` keyed by id in locale order,
   each `agentId`, `file`, `type` (the parsed spec's; `task` when the
   spec did not parse), `spec` when the spec parsed (the shape as the
   engine parsed it, whole: its type, grants, implements, Tests section
   and prose, and its notice labels, the license expression and the
   copyright holders, when the spec states them, so a reader of the
   workspace sees the notice the agent's package must carry), and
   `parseIssues` (every issue, each `message` and `line` when one is
   known). THE PARSED SHAPE has these members and no other: `type`,
   `uses` (each grant as a kind with its one field), `implements`,
   `tests`, `prose`, `license` and `copyright`; a module that declares
   it again declares those, member for member. The workspace is
   written as JSON with two-space indentation and a trailing
   newline to the workspace path given (its parent directories made).
   The answer lists the ids, sorted.

THE GRANT RULE: a written path starting with `/` resolves from the
root (the root followed by the path); any other resolves from the
spec file's folder; the result is made root-relative, posix; a result
that is empty, is `..`, starts with `../` or is absolute escapes the
root and resolves to nothing.

## The operations over the workspace

`runSpecGates`, `planCompile` and `compileScope` read the workspace JSON
at the path given and first drop every id listed in `exclude`.

## The spec gates

`runSpecGates` runs every deterministic gate, in this order, and
answers the findings sorted by agent id (locale order), errors before
warnings within an agent, then by code (locale order):

Step 1, ROW CYCLES, only when `remoteUses` was given: for each agent
in the workspace's order whose spec parsed, for each `agent` grant of
its Uses (the Tests section's grants are left out) whose id is not in
the workspace and is a key of `remoteUses`: the ids are searched
breadth-first from that grant through `remoteUses` (each id's list,
in order) for the agent's own id; when a path exists, `CE106` with
the slots `agentId`, `path` (the grant) and `loop` (the agent's id,
then every id of the path from the grant to the agent's id inclusive,
joined by ` -> `).

Step 2, SERVICE NAMES: the substrate's name for an agent is its id
with every character outside `A-Za-z0-9` replaced by `_`, and two ids
may share one. Over the ids in plain sorted order, the first id with a
name holds it; a later id with the same name is `CE161` (slots
`agentId`, `holder`, `serviceName`) and holds nothing.

Step 3, EACH AGENT, in the workspace's order:
- Each parse issue is `CE100` with the issue's own message and line.
- An id among `installedAgents` is `CE162` (slot `agentId`).
- THE GRANTS, when the spec parsed: over the `agent` grants of the
  Uses (scope spec), then of the Tests section (scope tests), in
  order, with a set of the spec-scope ids seen so far:
  - a spec-scope grant of the agent's own id: `CE102` (slot `agentId`),
    and nothing more for that grant;
  - a spec-scope grant seen before: `CE103`, A WARNING (slot `path`),
    and the checks below still run for it;
  - a spec-scope grant joins the seen set;
  - a grant of an id absent from the workspace: nothing when it is
    among `remoteAgents`; else `CE101` (slot `path`) with the hint
    `did you mean "<the closest id>"?` when a closest workspace id
    exists (the helper below), else no hint; nothing more;
  - a grant of a workspace agent whose type is `worker`: `CE104`
    (slot `path`).
- THE IMPLEMENTS, when the spec parsed and its Implements names
  anything: a worker is `CE181` (no slots) and nothing more; else the
  entries split into the INTERFACE IDS and the OPENAPI TARGETS (the
  entries starting with `openapi:`). For the openapi targets: a second
  one is `CE191` (slot `agentId`) and nothing more for it; a target
  whose rest (the text after `openapi:`) is a remote url is checked no
  further here (the compile fetches it); any other rest resolves by the
  GRANT RULE as a file grant's path does, and nothing is `CE190` with
  the slots `written` (the rest) and `reason` = `it resolves outside
  the agents root`; the resolved path is examined without following
  links: absent is `CE190` with the reason `no file at <rel>` (the
  root-relative path), and anything but a regular file is `CE190` with
  the reason `<rel> is not a regular file`. For each interface id:
  the agent's own id is `CE180` (slot `agentId`); a workspace agent
  whose spec parsed and is not an interface is `CE180` with the words
  of `CE180.2` (slots `target`, `type`); a workspace agent whose spec
  did not parse is nothing (its own issues report); an absent id
  among `remoteAgents` or `installedAgents` is nothing; any other absent id is `CE180` with the words of `CE180.3`
  (slot `target`) and the hint `did you mean "<the closest id>"?`
  when a closest workspace id exists, else `write the interface spec
  first, or deploy it: cernanto deploy <target>`.
- THE MOCKS, when the spec parsed and its Tests section lists any
  (`tests.mocks`), each id in order, with THE REACH of the agent
  computed once: the ids the agent's OWN Uses grants name (the Tests
  section's grants are not in it), agents and interfaces alike, and
  nothing deeper:
  - the agent's own id is `CE237` (slots `agentId`, `reason` = `the
    agent itself`) and nothing more for it;
  - an id that is no workspace agent whose spec parsed, not among
    `installedAgents` and not among `remoteAgents` is `CE243` (slot
    `agentId`) with the hint `did you mean "<the closest id>"?` when a
    closest workspace id exists (the helper below), else `a mock stands
    for an agent the tests could reach: a spec in this workspace, an
    installed package, or a row of the fleet`;
  - an id that is NOT in the reach, whether a workspace agent, an
    installed one or a row, is `CE243` with the hint `it is not among
    the agents this agent uses: <the reach in sorted order joined ", ",
    or "none">`;
  - an id listed twice is the grammar's problem, reported there.
- THE FILE GRANTS, when the spec parsed: the grants of the Uses, then
  of the Tests section, each list located (the assets section, with
  the agent's file as the spec file); every problem is a finding with
  the problem's code, message and hint.
- THE TYPE, when the spec parsed: a worker with a Tests section is
  `CE152`; an interface with any grant is `CE182`, with any implements
  `CE183`, with a Mocks label in its Tests section `CE238` (an
  interface's family section is fed to implementors whose edges it
  cannot know), and with a `file` grant in its Tests section `CE184` with
  the message `an interface's ## Tests section may not grant files:
  the section applies at every implementor's compile, where a file path
  of this spec means nothing` and the hint `name the fact in the prose
  (a configuration key, a url) or move the file to each implementor`.
- THE HARNESS, when `runtimeHarness` was given and the spec parsed:
  each `agent` grant of `cernanto/search` in the Uses is `CE160`
  (slots `agentId`, `capability` = `search`, `runtimeHarness`) unless
  the harness is `claude-code`, `codex` or `fake`.

THE CLOSEST ID (`closestAgentId`): the candidate at the least
Levenshtein distance from the target (the first among equals, in the
candidates' order), when that distance is at most the larger of 3
and a third of the target's length rounded down; else nothing.

## The planner

`dependenciesOf` of an agent: nothing when it is absent or its spec
did not parse; else, in order and without repeats, the `agent` grants
of its Uses, the interface ids it implements (an openapi target is a
document, and stays out), and the `agent` grants of its Tests section
except the agent's own id. `dependentsOf`: every other id of the
workspace whose dependencies include the agent, sorted.

`planCompile`, for the targets given and the deployed implementors
(each interface id to the deployed agents stamped as implementing it;
empty when no deployed agents were read):
1. An agent's TIER: 0 for a module or an interface, 2 for a worker, 1
   for anything else (an unparsed spec included).
2. THE REACHABLE set: the targets and, transitively, their
   dependencies that are workspace ids; then THE IMPLEMENTORS THE
   TESTS NEED: for each reachable interface id that a reachable id
   grants (a Uses grant), when no reachable id implements it and no
   deployed implementor is given for it, every workspace id whose spec
   implements it joins the reachable set, with its own dependencies
   transitively (a consumer's live tests go through an implementor:
   one deployed already is used as it is, else the workspace brings
   its own).
3. THE SEEDS: the reachable ids of tier 0 in sorted order, then the
   implementors so brought (sorted, those of tier 0 already among the
   first), then the targets sorted by tier and then by id (locale
   order).
4. Each seed is VISITED: a visited id is nothing; an id already on the
   visiting stack is a cycle, the stack from that id onwards followed
   by the id again; otherwise the id goes on the stack, each of its
   dependencies in sorted order that is a workspace id is visited (a
   cycle found below ends everything), the id leaves the stack, is
   marked visited and joins the order. A target absent from the
   workspace has no dependencies and joins the order like any other.
5. The first cycle fails the plan with that loop; otherwise the order
   is the plan.

`compileScope`: the scope starts as the targets closed downwards over
the dependencies that are workspace ids; with the cascade on, for
each target in order, each of its dependents (sorted) not yet in the
scope joins it only when it is a target itself or among
`deployedAgents`, and then its own dependencies close downwards and
its own dependents are considered the same way; the answer is the
scope sorted.

## The assets

`locateAssets` takes the grants of one Uses line and locates its
`file` grants against the root, in order, with a set of the paths
located so far and a map of the export names taken:
1. The written path resolves by the GRANT RULE; nothing is `CE170`
   (slot `written`).
2. The path is examined without following links: absent is `CE171`
   (slots `written`, `rel`); a symbolic link, or anything that is
   neither a regular file nor a directory, is `CE172` (slots
   `written`, `folder` = `a symlink` for a link and `not a regular
   file or folder` otherwise, `rel`).
3. A path located before is skipped silently.
4. The artifact path is the last segment of the root-relative path.
   A directory's files are walked: entries in locale order, an entry
   whose name starts with `.` or is `node_modules` skipped, a
   directory recursed, a regular file listed with its artifact path
   (the prefix, `/`, the name), its absolute source and its size, and
   anything else skipped. A file is listed alone. No file at all is
   `CE172` with the words of `CE172.2` (slots `written`, `rel`).
5. A file over 64 MiB (67108864 bytes) is `CE174` (slots `sep` = the
   file's root-relative path, `large` = its size in the contract
   module's human spelling, `MAX_ASSET_BYTES` = the cap in the same
   spelling), and the grant is dropped.
6. The export name is the contract module's asset export name of the
   root-relative path; a name already taken is `CE173` (slots
   `written`, `holder` = the earlier grant as written, `name`), and
   the grant is dropped; else the grant is recorded: the grant as
   written, the name, the kind (`file` or `folder`), the root-relative
   path, the artifact path and the files.
The answer lists the grants, every file once in grant order, and the
problems (each with its code, the grant as written, the message and
the hint). `hashAssets` answers the sha256 hex digest of each file's
bytes by artifact path, the paths in locale order.

## The pins

A compile's pins are what its agents observed of the world outside the
workspace: `{doctrine, mcp, openapi, npm}`, the doctrine version, `mcp`
a map of server (a remote server's url, or a local server's command)
to `{schemaHash}`, `openapi` a map of url to
`{specHash}`, `npm` a map of package name to the version installed. A
compile starts its pins from the previous compile of each agent (the
slice its artifact recorded, handed in by the coordinator) and from
the pins its grants write, and records them in each artifact's
provenance. `emptyPins` takes `doctrineVersion` and answers
`{doctrine: <the version>, mcp: {}, openapi: {}, npm: {}}`.
`grantPins` takes the pins and the grants and answers the pins with
every `npm` grant that carries a pin applied, the maps otherwise
unchanged: a pin that is an exact version (the `semver` package's
`valid` answers it) replaces the map's entry for the package; a pin
that is a range (the package's `validRange` answers it and `valid`
does not) keeps the map's entry when `satisfies` says it fits the
range and otherwise puts the range itself in the entry's place, so
the install is asked for the range and resolves inside it; a pin
that is neither is removed from the map. A grant without a pin leaves
the map as it is. `pinNpmVersions` pins each installed package's
version the pins do not hold yet or hold as a range (`validRange`
answers the entry and `valid` does not: the installed version takes
the range's place; a version that is empty or `missing` is skipped;
an exact pin stays, and so does an entry that is neither a version
nor a range, a `file:` spec) and answers whether any was added or
replaced. `lockSliceFor` answers `{doctrine, mcp, openapi, npm}`: the
pins' doctrine and, for the grants given in order, each granted mcp
server, openapi url and npm package the pins hold, with its pin.

## The derived tester

`testerSpec` derives the tester of an agent from its parsed spec:
1. THE GRANT WORDS of the Tests section, each grant as a Uses line
   writes it: `npm:<package>`, `mcp:<server>` (its url, or a local
   server's command), `openapi:<url>`, `file:<path>`, and an agent's
   path as is.
2. THE AI GRANT (`testAiGrant`): `cernanto/decision/llm, cernanto/llm`
   when the spec has NO
   TESTS PROSE (no Tests section, or a section whose prose is empty:
   labels alone, a `Mocks:` line for one) and the closure is
   AI-powered; nothing otherwise.
3. THE USES LIST: the agent's id, then the grant words, then each id
   of the AI grant as an entry of its own (the grant split at `, `),
   without repeats (the first occurrence kept), joined by `, `.
4. THE MARKDOWN, these lines joined by newlines: `# <the display name
   of the id> Tester`; an empty line; the line `Type: worker`, since
   the tester is a worker and the page is where a kind is stated; an
   empty line; the Uses label, `Uses: <the
   list>`, or, when the list holds a local server's command (a grant
   word that starts with `mcp:` and whose rest is no remote url, which
   runs to the end of its line), the line `Uses:`, an empty line and
   one line `- <entry>` per entry of the list in its order; an empty
   line; the sentence `Runs the tests of "<the id>" against its live
   deployment, as an ordinary consumer of it. Each test calls the
   agent through its dependency module the way any caller would and
   checks what comes back against what its specification promises.
   The run performs every test, never stops at the first failure, and
   returns how many tests passed and the failures, each with the
   test's name and a message saying what was expected and what came
   back. A failing test is a result, never an error.`; an empty line;
   the contract module's tester prose marker; an empty line; the
   spec's prose; then, only when the spec's Tests section has prose,
   an empty line, `What the tests must cover:`, an empty line and the
   section's prose; and a final empty line (the text ends with a
   newline).
5. The answer: the tester's id (the agent's id followed by `-tester`)
   and the markdown, which the engine parses with the grammar.

`aiInAgentClosure`: whether `cernanto/llm`, `cernanto/decision`, an id
beginning `cernanto/decision/` (an implementor of the decision interface)
or `cernanto/search` is reached from the agent's id (itself included) transitively through
the `agent` grants of the Uses of every workspace agent on the way
(an id absent from the workspace ends its branch). `testsSectionOf`: nothing without a Tests section; else the
grant words in plain sorted order joined by `,`, a newline, then,
ONLY when the section lists mocks, the word `mocks:` followed by the
mocked ids in plain sorted order joined by `,` and a newline, and the
section's prose with every run of whitespace collapsed to one space
and trimmed. `displayNameOf`: the id's last `/` segment, split on
`-`, each word's first character upper-cased, joined by spaces.

## The registry modules

`isRegistryModule`: an entry with a directory and the type `module`.
`registryModuleIdentity`: the sha256 hex digest of the directory's
`agent.cern` when it exists; else, when the directory's `dist`
exists, the sha256 hex digest fed, for each regular file of `dist`
walked (entries in locale order, directories recursed) except one
whose name ends with `.tsbuildinfo` or matches `.test.js`,
`.test.d.ts`, `.test.js.map` or `.test.d.ts.map`, with the file's
path relative to `dist` followed by a NUL byte and then its bytes;
else nothing. `registryModuleLinks`: the string entries of `links` in
the directory's `cernanto.json`; none when it is missing or does not
parse. `nestedRegistryModules`: breadth first from the direct ids
(all marked seen), for each id whose entry is a registry module, each
of its links not seen yet is marked seen and, when its own entry is a
registry module, joins the nested list and the queue; the nested list
sorted, the direct ids left out of it.

## Tests

Uses: npm:fs-extra

Every operation works on an agents root the test lays out in a
temporary folder with the granted file package: spec files named
`<id>.cern.md` with a `Type:` line when they are not tasks,
directory agents as `<dir>/agent.cern.md`,
granted files beside them, symbolic links and oversized files where
a case needs them. The parsed candidates a test hands to the
resolution, and the workspace JSON it writes for the gates, the plan
and the scope, are what the grammar reads: each grant as a kind with
its one field, the prose as the spec's body text, the Tests section
with its own grants and prose; a spec that did not parse carries its
issues instead. The words of a finding are read from the granted
catalog and compared whole after filling their slots. A registry
module for the identity helpers is a directory the test writes with
an `agent.cern` file or a `dist` folder. A derived tester whose Tests
section grants a local server's command beside an agent writes its
grants as bullets, and its markdown parses back as a worker to both
grants with the command whole.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
