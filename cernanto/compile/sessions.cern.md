# Compile Sessions

Type: module

Uses:
- cernanto/harness
- cernanto/compile/contract
- cernanto/compile/npm
- npm:execa
- npm:fs-extra
- file:sessions/doctrine/

Run the compiler's conversations with the coding vendor. Load the
doctrine (the charters, the shapes, the language, the prompts and the
fix turns, one versioned folder that ships with this module), compose
the code session's and the test session's first prompts from the
doctrine's paragraphs and the compile's data, open and resume compile
sessions on the plane's coding vendor through the harness interface, keep
each session's transcript, and word the fix turns and a turn's spend.
Answer one turn or one prompt at a time; the compiler runs the loops.
Every path and every clock is handed in; the doctrine is the granted
folder.

## The doctrine

The doctrine folder holds twelve files: `session-coder.md` and
`session-tester.md` (the two session charters), `language.md` (the
platform language both sessions receive), `shape-service.md`,
`shape-task.md`, `shape-job.md`, `shape-worker.md`, `shape-module.md`,
`shape-interface.md` (one agent shape each), and three files of named
sections, `prompt-coder.md`, `prompt-tester.md` and `prompt-fix.md`.
Every file is read as utf8 and TRIMMED. `doctrineRoot` answers the
module's own doctrine folder (the granted folder's path, the folder
that holds `language.md`). `loadDoctrine` takes a folder, the module's
own when none is given, and answers the assembled doctrine:

1. `version` is THE DOCTRINE'S OWN IDENTITY, read from its bytes and
   kept by no hand: the first twelve hex characters of the sha256 over
   the twelve files in file-name order, each as its name, a newline,
   its trimmed text and a newline; no file of the folder states a
   version, and two folders with the same texts have the same version.
2. The code session text of a type is `session-coder.md` with its ONE
   occurrence of the slot `<!-- agent-shape -->` replaced by the
   type's `shape-<type>.md`, then `\n\n`, then `language.md`; a charter
   without the slot fails with `session-coder.md is missing the
   <!-- agent-shape --> slot`. `codeSessions` holds the six texts by
   type (`service`, `task`, `job`, `worker`, `module`, `interface`).
3. `testSession` is `session-tester.md`, `\n\n`, `language.md`.
4. `prompts.coder`, `prompts.tester` and `prompts.fix` are the
   SECTIONS of `prompt-coder.md`, `prompt-tester.md` and
   `prompt-fix.md`, each checked for its slots (below): a missing
   section fails with `<file> is missing the prompt section "<name>"`.

READING SECTIONS (`readSections`): a line matching `^## ([a-z0-9-]+)\s*$`
opens the section it names; every following line belongs to it until
the next heading; text before the first heading is nobody's. A
section's body is UNWRAPPED: its lines trimmed, blank lines splitting
paragraphs (a run of blank lines is one split, blank lines before the
first paragraph make none), each paragraph its lines joined by single
spaces, then the markdown escapes read back (a backslash before any of
`\ * _ # < > [ ] ( ) \`` becomes the character alone), and the
paragraphs joined by `\n\n`.

THE SLOTS each prompt file must carry, in this order:
- `prompt-coder.md`: `interface-opening`, `agent-opening`,
  `specification`, `implements-one`, `implements-many`,
  `implements-document`,
  `dependency-contracts`, `dependency-contract`, `granted-interfaces`,
  `granted-interface`, `mcp`, `openapi`, `openapi-auth`, `npm`,
  `npm-entries`, `npm-entry`, `npm-entry-truncated`, `npm-entry-root`,
  `npm-entry-subpaths`, `npm-declaration-map`,
  `npm-declaration-map-more`, `npm-typeless-one`, `npm-typeless-many`,
  `assets`, `ambient-surface`, `os-surface`, `preserve-contract`,
  `anchor-contract`, `new-contract`, `amend-opening`, `previous-compile`,
  `specification-diff`, `specification-diff-large`,
  `dependency-changes`, `change-plan`, `gate-failures`,
  `seed-verified`, `seed-unverified`, `seed-worker`;
- `prompt-tester.md`: `write-opening`, `update-opening`,
  `changed-tests-section`, `before`, `now`, `no-section-before`,
  `no-section-now`, `changed-specification`, `changed-contract`,
  `current-contract-follows`,
  `reused-failure`, `granted-modules`, `no-judgment`,
  `granted-contract`, `specification`, `tests`, `derived-tests`,
  `contract`, `npm-typeless-one`, `npm-typeless-many`,
  `mocks-opening`, `mock`, `implementors`, `live-edges`;
- `prompt-fix.md`: `gate-failed`, `code-gates`, `tests-gates`, `heal`,
  `heal-what-code`, `heal-what-tests`, `reused-tests-checks`,
  `type-check-triage-code`, `contract-corrected`, `live-code`,
  `live-tests`, `evidence-tester`, `evidence-agent`, `timeout-run`,
  `timeout-ask`;

FILLING (`fill`): a section's text with every `{{name}}` (letters
only) replaced by the value of that name; strict on both sides: a
section the doctrine lacks fails with `the doctrine has no prompt
section "<name>"`, a slot the values do not fill with `the prompt
section "<name>" needs a value for "<slot>"`, a value no slot takes
with `the prompt section "<name>" has no slot "<value name>"`.

## The code session's first prompt

`codeSessionPrompt` composes sections from the doctrine's coder
prompts (`say(<name>, <values>)` below fills them) and joins the
sections by `\n\n`, in this order:

1. For an interface `say('interface-opening', {agentId})`, else when
   an `amend` is given `say('amend-opening', {agentId, type,
   previousDir})`, else `say('agent-opening', {agentId, type})`; then
   `say('specification')`; then the spec's prose.
2. When the agent implements interfaces (the contracts given by id, in
   the order given): `say('implements-one')` for exactly one, else
   `say('implements-many')`; then per interface `<id>:` newline and
   the contract fenced as ` ```ts ... ``` `. An id starting with
   `openapi:` is an implemented document: for it
   `say('implements-document', {target: <the id's rest>, name: <the
   document's module name, given with the contracts as
   `documentName`>})` stands in place of the one or many section (the
   other interfaces, when any, keep theirs), and its contract follows
   fenced the same way.
3. The dependency contracts whose id is NOT among the interface
   dependencies, in the order given, when any: `say('dependency-
   contracts')`, then per contract ONE section: `say('dependency-
   contract', {agentId, file: <the agent's stub file name>})`, a
   newline, the contract's exports index line (the contract module's:
   it ends with a newline of its own, or is empty), then IMMEDIATELY
   the contract fenced (` ```ts\n<contract>\n``` `; nothing stands
   between the index line and the fence, so with an empty index line
   the fence follows the label's newline directly).
4. The dependency contracts whose id IS among the interface
   dependencies, when any: `say('granted-interfaces')`, then per
   interface `say('granted-interface', {agentId, accessor: <the
   interface accessor name>, file: <the stub file name>})`, newline,
   the contract fenced.
5. When mcp modules are given and not empty: `say('mcp', {modules:
   <each "<module> (from <url>)", joined by ", ">})`.
6. When openapi modules are given and not empty: `say('openapi',
   {modules: ...the same})` followed, for each module with an `auth`,
   by a space and `say('openapi-auth', {module, auth})`, all as one
   section.
7. The npm packages the spec grants (`npm:` grants, in order), when
   any: the entry declaration of each (the npm module's, per package
   under the workspace; a package without one is skipped);
   `say('npm', {packages})` when no entry was found, else
   `say('npm-entries', {packages})` (the packages joined by `, `);
   then per entry `\n\n` and `say('npm-entry', {name, path, notes})`
   where `notes` = `say('npm-entry-truncated')` when the entry is
   truncated (else nothing) followed by `say('npm-entry-root')` when
   it has no subpaths, else `say('npm-entry-subpaths', {subpaths:
   <joined by ", ">})`; then newline and the entry's text fenced; then
   the DECLARATION MAP: nothing when the entry reaches no other file,
   else newline, `say('npm-declaration-map', {name})`, newline, one
   line per file `- <path> (<its bytes as whole KB, at least 1> KB):
   <the first sixteen exports as the npm module lists them, each
   `<name>@<line>`, joined by ", ", then ", +<n> more" when there are
   more; "no exports" when none>`, joined by newlines,
   then newline and `say('npm-declaration-map-more')` when the entry
   has more files than listed; then, when typeless packages are given
   and not empty, a space and `say('npm-typeless-one'|'npm-typeless-
   many', {packages: <joined by ", ">})`; all of step 7 as ONE section
   (its parts concatenated without separators).
8. When assets are given and not empty: `say('assets', {dir: <the
   contract module's assets directory name>, grants: <the asset
   grants described>, reader: 'the code'})`.
9. The ambient surface: when `<workspace>/.cern/platform.d.ts` exists
   and its trimmed text is not empty, `say('ambient-surface')`, newline,
   the TRIMMED text fenced as ts (` ```ts\n<text>\n``` `). Then the
   os surface the same way from `<workspace>/src/os.d.ts` with
   `say('os-surface')`.
10. When a contract to preserve is given: `say('preserve-contract')`,
    then its anchor rendering (the contract module's) fenced; when an
    anchor contract is given: `say('anchor-contract')` and its anchor
    rendering fenced; when a new contract is asked (the input's
    `newContract` true, neither a preserved nor an anchor contract
    given): `say('new-contract')`, so the ask stands before the amend
    sections that follow.
11. THE AMEND SECTIONS, when an `amend` is given (`{previousDir,
    files, summary, diff, entries, plan?, gateFailures?, seed,
    failure?}`: the previous compile's folder under the session root,
    the seeded coder files by name, the change record's summary line,
    the specification's unified diff (empty when the prose did not
    move), the record's other entries rendered as lines by the
    caller, the plan when a reading was made, the failed gates' words
    when the machine-checked seed failed, whether the seed passed its
    live tests (`verified`), did not (`unverified`) or is a worker's
    (`worker`), and the last live failure's words when unverified),
    in this order: `say('previous-compile', {previousDir, files: <the
    names joined ", ">})`; when the diff is not empty, `say(
    'specification-diff')` followed by a newline and the diff fenced
    as ` ```diff ... ``` ` when the diff is at most 32768 characters,
    else `say('specification-diff-large', {previousDir})` alone; when
    the entries are not empty, `say('dependency-changes', {summary})`
    followed by a newline and the entries; when a plan is given,
    `say('change-plan')` followed by a newline, the plan's analysis, a
    newline, and one line per change `- <what> (<where>)`; when gate
    failures are given, `say('gate-failures')` followed by a newline
    and the words; then `say('seed-verified')` for a verified seed,
    `say('seed-worker')` for a worker's, else `say('seed-unverified')`
    followed by a newline and the failure's words when any.
12. THE CLOSING, always the last section: `say('closing', {agentId})`,
    so the task stands at the end of the prompt, after every contract
    and declaration it rides with.

ASSET GRANTS DESCRIBED (`describeAssetGrants`), one entry per grant
joined by `; `: a file grant with a first file reads `<assets dir>/<the
file's path> (<the file described by the contract module>; granted as
file:<grant>) as \`<name>\``; a folder grant reads `<assets dir>/<the
artifact path>/ (<n> file<s unless one>, <the total size in human
words>; granted as file:<grant>) as \`<name>\`, a map keyed by each
file's path inside the folder`; a file grant with no files reads the
folder form too.

## The test session's first prompt

`testSessionPrompt`, the sections joined by `\n\n`. The agent id given
is THE AGENT UNDER TEST, the one whose functions the tests import and
call; the tester's own id (`<that id>-tester`) names the tester's
workspace alone and appears nowhere in the prompt. The opening names
that agent, the target module being
`./agents/<the agent's stub file name>.js` and the platform modules
the same form for each id given (repeats dropped):

1. `say('write-opening', {agentId, module})` when no update is asked,
   else `say('update-opening', ...)`.
2. When an update is asked: when it names a tests section change,
   three sections: `say('changed-tests-section')`; then `say('before')`,
   a newline, and the previous section's text, with
   `say('no-section-before')` standing in for the text when there is
   none (the `before` label ALWAYS appears); then `say('now')`, a
   newline, and the current section's text, with `say('no-section-
   now')` standing in the same way (the `now` label always appears);
   when it names a change (`change: {summary, diff, plan?}`, the
   specification's), two sections: `say('changed-specification')`,
   then the diff fenced as ` ```diff ... ``` ` (the words `(the
   specification's prose did not move)` when it is empty) followed by
   a blank line, the summary line, a blank line, and the plan as its
   analysis, a newline and one line per change `- <what> (<where>)`
   (the words `(no plan: the change was machine-checked)` when none
   was given); when it names a previous contract, three sections:
   `say('changed-contract')`, the contract fenced, `say('current-
   contract-follows')`; when it names a failure, two sections:
   `say('reused-failure')` and the failure text.
3. `say('granted-modules', {modules: <the granted agents' ids joined
   by " and ">})` when any, else `say('no-judgment')`.
4. Per granted agent id (repeats dropped) whose contract text was
   given, two sections: `say('granted-contract', {file: <the stub
   file name>})`; then the exports index line IMMEDIATELY followed by
   the contract fenced (as in the code prompt's step 3: the index line
   ends with its own newline, nothing between it and the fence).
5. Six sections: `say('specification')`; the spec's prose; then
   `say('tests')` and the Tests section's prose when the section has
   prose, and `say('derived-tests')` alone when it has none (no
   section, or labels alone);
   `say('contract', {module})`; the exports index line immediately
   followed by the contract fenced (the same form as step 4).
5b. When mocks are given and not empty (`mocks`: per agent the
   target's Tests section lists under `Mocks:`, in order, its id, the
   file the mock goes in (`src/mocks/<its stub file name>.ts`), the
   stub file name its types import from, its contract's text and
   whether it reaches the ai or search): `say('mocks-opening')`; then
   per mock `say('mock', {id, file, types, reach})` with `reach` the
   words `it reaches the platform ai or search: its real answers are
   judgments` when it does and `it makes no judgment of its own`
   otherwise, followed by the exports index line immediately followed
   by its contract fenced (the same form as step 4); then, when live
   ids are given (`live`: every other agent the target reaches, with
   the same reach fact each), `say('live-edges', {ids})` with the ids
   joined by `, `, each followed by ` (judges)` when it reaches the ai
   or search.
5c. When implementors are given and not empty (`implementors`: per
   interface the target grants, `{interfaceId, agents: [{id, type}]}`,
   in order): per interface, `say('implementors', {interface: <the
   interface id>, agents: <each agent as "<id> (a <type>)", joined by
   ", ">})`.
6. When typeless packages are given and not empty:
   `say('npm-typeless-one'|'npm-typeless-many', {packages})`.
7. When assets are given and not empty: the coder prompts' `assets`
   section filled with `reader: 'the tests'`.
8. THE CLOSING, always the last section: `say('closing', {agentId})`
   from the tester prompts, so the task stands at the end of the
   prompt, after the specification and every contract it rides with.

## The fix words

`failedChecksWords(gates, fix)`: the failed gates (ok false), each as
`fill(fix, 'gate-failed', {gate: <its name>})`, newline, its output,
joined by `\n\n`; with no failed gate the text `no contract
declarations were emitted`. `failureReport(gates, fix)`: the same
per-gate texts followed by `fill(fix, 'code-gates')`, all joined by
`\n\n`.

## The sessions

A compile session runs on the plane's coding vendor through the
harness interface, cernanto/harness, bound by name to the vendor's
agent id the compile resolved (`vendorAgentId` of the harness name the
compile hands in), which opens and resumes a vendor session; the
vendors keep their own custody, so the session carries no credential. The road (`dataDir`,
`turnTimeoutMs`) names where the transcripts persist and how long one
turn may take (sixty minutes when the road names nothing).

`openSession` asks the bound vendor to open a session with the
workspace path, the initial prompt, the doctrine text, the
turn timeout, the model and effort when given, and `readOnly`, `web`
and `maxToolCalls` when given (a judge's session: the vendor writes
nothing, consults the web only when asked, and caps the turn's tool
calls; all three handed through as they are); then it REMEMBERS, by
the answered session id, the workspace path, the doctrine text, the
model and effort asked and the three judge options (a resume carries
them all again); it records the session in the registry (below) and
appends two transcript turns, `input` with the initial prompt and
`output` with the turn's final text; and it answers the TURN (below).

`resumeSession` looks the session id up among the sessions this
process opened: an unknown one fails with `no plane compile session
"<id>" is open in this run`; then it asks the bound vendor to resume the
session with the session id, the workspace path remembered, the input, the doctrine remembered (when any), the turn
timeout, the model and effort remembered, and the judge options
remembered (a resume of a judge's session stays read-only and capped);
it remembers the answered session id the same way (the workspace, the
doctrine, the model and effort, the judge options), appends the
transcript turns `input` and `output`, and answers the turn.

THE TURN answered: the harness's `sessionId` and `status`, `output`
(the turn's final text, the empty string when the harness gave none: a
judge reads a verdict off it), `costUsd` when the harness gave one,
`inputTokens` and `outputTokens` from the harness's usage, and
`harness`, the coder record: `name` = `cernanto/harness/` followed by
the harness (`vendorAgentId`), `cli` = the version of the vendor tool
that served the turn when the harness reports it, `model` = the model
the harness reports when it does, `effort` = the effort asked when
the session opened.

THE REGISTRY, under the road's `dataDir`: `sessions.json` holds
`{ "version": 1, "sessions": [ { sessionId, workspacePath, harness }
... ] }` (JSON, two-space indented); the row's `harness` is the vendor's
own name exactly as the call named it (`claude-code`, `codex` or
`fake`), never the vendor agent's id; a record replaces any row of the
same session id and appends the new one at the end, then writes the
whole file through `sessions.json.tmp` renamed over it, both with
mode `0o600`, the folder made when missing; a file that cannot be
read is an empty registry, one that reads but does not fit the shape
fails with `session registry at <path> has an unreadable format`.
The transcripts: `transcripts/<session id>.jsonl` beside it, one JSON
line per turn `{ seq, role, text, at }` (`seq` = the count of turns
already in the file, `role` `input` or `output`, `at` the iso time),
appended with mode `0o600`, the folder made when missing; reading a
transcript drops lines that do not parse (a torn tail).

## The words

- `spendOf(turn)`: `inputTokens`, `outputTokens`, `costUsd`, each only
  when the turn has it, in that order.
- `firstLine(text)`: the first line that is not blank, trimmed; empty
  when none.
- `formatTokens(count)`: at a million or more `<n>m tokens` (one
  decimal), at a thousand or more `<n>k tokens` (one decimal), else
  `<count> tokens`.
- `formatDuration(ms)`: the seconds rounded: under 60 `<s>s`, else
  `<m>m<ss>s` (the seconds padded to two).
- `vendorAgentId(harness)`: `cernanto/harness/<harness>`.

## Tests

The tests write no files: they hand the module paths and read what it
answers. A session test opens on the rehearsal vendor,
`cernanto/harness/fake`, bound by that name, whose script the plane
does not carry, so every turn echoes its input: the
road's `dataDir` is a fresh path under `/tmp` (the tests read no
environment and no machine facts), which the module creates; the
workspace path may be any path. The tests assert the turn's `sessionId` is
non-empty and its `status` is `completed`, that a resume with that
id completes again, and that a resume of an unknown id fails with the
module's words. A session ends with the call that owns it, and a
module's tester owns no call to cancel: the plane's own tier
proves that on a real compile. The
doctrine tests load the module's own folder (no argument) and assert
the assembled shape; a folder that does not exist fails.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
