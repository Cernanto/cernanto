# Compile Change

Type: module

Uses:
- cernanto/compile/contract

Given what an agent's previous compile recorded and what this compile
holds, say what changed between the two: the specification, the
grants, the contracts, the api types, the tool listings, the package
versions, the granted files and the versions of the doctrine and the
compiler. Answer one record the compile plans the change from and
hands to the coder's amend session, and answer where an agent's code
comes from. Everything is computed from the texts and lists handed in.

## The normalized text

`normalizeSpec` answers the form two specification texts are compared
in: the text split into paragraphs at blank lines (a line that is
empty or whitespace alone), each paragraph's lines trimmed and joined
with one space with every run of whitespace inside it collapsed to one
space, the paragraphs in order, each as one line, joined by one
newline; a text with no paragraph is the empty string. `foldedSpec`
answers the normalized text lower-cased, the form the comparison
reads, so a reflowed paragraph, an added blank line, a trailing space
and a capital letter compare equal.

## The diff

`specDiff` takes `previous` and `current`, the two texts, and answers
`{changed, diff, paragraphs}`. `changed` is whether the folded forms
differ. `diff` is the unified diff of the two normalized texts, in
their original case, one paragraph per line, when they changed, else
the empty string: the header lines `--- previous` and `+++ current`,
each hunk introduced by `@@ -<start>,<count> +<start>,<count> @@`
(one-based starts, counts of lines in that side), three lines of
context, every line prefixed `-`, `+` or one space, computed by a
longest-common-subsequence over the folded lines, so a paragraph that
moved in case alone is context. `paragraphs` is the number of lines
prefixed `-` or `+`, zero when not changed.

## The change record

`changeRecord` takes the two sides of every input and answers the
record. Its input:

1. `spec`: `{previous, current}`, the texts.
2. `grants`: `{previous, current}`, each the list of the grants a
   `Uses:` line writes, as it writes them: an agent or interface id
   as is, `npm:<package>`, `openapi:<url>`, `mcp:<server>` (a remote
   server's url, or a local server's command), `file:<path>`.
3. `implements`: `{previous, current}`, each the list of interface
   ids the `Implements:` line names.
4. `contracts`: a list of `{id, previous?, current?}`, one per agent
   or interface id on the current `Uses:` and per id on the current
   `Implements:`: `current` its contract text now, `previous` the
   contract text the previous compile recorded, absent when it recorded
   none.
5. `openapi`: a list of `{url, module, previous?, current?}`, the
   elaborated types source of each openapi grant on both sides.
6. `mcp`: a list of `{server, previous?, current?}`, the tool listing
   of each mcp grant (`server` its url or its command) on both sides as
   JSON text: an object whose `tools` is a list of tools, each with
   `name` and, when present, `description`, `title`, `inputSchema`,
   `outputSchema` and `annotations`.
7. `npm`: a list of `{name, previous?, current?}`, the pinned version
   of each npm grant on both sides.
8. `assets`: `{previous, current}`, each a map of the agent's granted
   files' paths to their sha256, the Tests section's files apart.
9. `testsAssets`: `{previous, current}`, each a map of the files the
   Tests section grants, path to sha256 (an empty map when it grants
   none).
10. `surface`: `{previous, current}`, each the sorted list of the
   function names the agent's implemented surface names, the
   operations of the document it implements and the functions the
   interfaces it implements declare; absent when the agent implements
   nothing on either side.
11. `versions`: `{doctrine: {previous, current}, compiler: {previous,
   current}}`, the doctrine version and the compiler family digest;
   a previous side that is unknown is the empty string.

The record:

- `spec`: `{diff, paragraphs}` of `specDiff`, present only when the
  texts changed.
- `uses`: `{added, removed}`, the grants on the current list and not
  the previous, and the reverse, each sorted.
- `contracts`: one DRIFT per `contracts` entry whose id is on the
  current `Uses:` and whose two sides differ (below); an entry whose
  sides are equal text is left out.
- `implements`: `{added, removed, moved}`: the ids on the current
  `Implements:` and not the previous, the reverse (each sorted), and
  one drift per kept id whose two contract sides differ.
- `openapi`: one drift per entry whose sides differ, its `id` the
  url and `module` the module.
- `mcp`: one drift per entry whose sides differ, its `id` the server.
- `npm`: `{name, from, to}` per entry whose sides differ, `from` the
  previous version or `none`, `to` the current or `none`.
- `assets`: `{changed, added, removed}`, the paths whose sha differs,
  the paths only on the current side, the paths only on the previous
  side, each sorted.
- `testsAssets`: `{changed, added, removed}`, the same over the Tests
  section's files; a moved tests file is the Tests section's matter
  and leaves `empty` alone (prepare reads it as the section moved).
- `surface`: `{added, removed}`, the function names on the current
  surface and not the previous, and the reverse, each sorted; both
  empty with no `surface` input.
- `doctrine`: `{from, to}` when the doctrine versions differ, else
  absent; `compiler`: the same for the family digests.
- `summary`: the one line below.
- `empty`: true when `spec` is absent, `uses` adds and removes
  nothing, `contracts`, `openapi`, `mcp` and `npm` are empty,
  `implements` adds, removes and moves nothing, `surface` adds and
  removes nothing, and `assets` changes, adds and removes nothing;
  the versions and `testsAssets` are left out of this reading.
- `needsReading`: true when `spec` is present, or `uses.added` is not
  empty, or any drift of `contracts`, `implements.moved`, `openapi` or
  `mcp` is of kind `docs`, `both` or `unknown`.

A DRIFT is `{id, kind, lines}` (plus `module` for openapi), `kind` one
of `structural`, `docs`, `both`, `unknown`, and `lines` the words of
the move:

1. A previous side that is absent is `unknown`, its one line `no
   previous <contract|types|listing> recorded`.
2. A contract (`contracts`, `implements.moved`): the structural part
   moved when the contract module finds the two texts a different
   surface; the words moved when the comment text of the two sides
   differs, the comment text being every `/** ... */` block and every
   `//` line, in order, whitespace runs collapsed. Both moved is
   `both`; the structural part alone `structural`; the words alone
   `docs`; two texts that differ in whitespace alone are no drift. The
   lines: for a structural move, the contract module's drift lines of
   the current text against the previous; for `docs`, the unified
   diff of the two texts' lines (as `specDiff` renders one, over the
   raw lines); for `both`, the drift lines followed by that diff.
3. An openapi types source: the structural part moved when the two
   sources differ with their comment text removed (the same comment
   reading), the words when their comment texts differ; the kinds and
   the lines as for a contract, the structural lines the unified diff
   of the comment-stripped sources.
4. An mcp listing: a side that does not parse as the shape above is
   `unknown` (the line `the listing could not be read`). The
   structural part moved when a tool's name is on one side only or a
   kept tool's `inputSchema` or `outputSchema` differs (compared as
   canonical JSON: keys sorted, no whitespace); the words moved when a
   kept tool's `description`, `title` or `annotations` differs. The
   lines: `+ <name>` per tool gained, `- <name>` per tool lost, `~
   <name>: schema` and `~ <name>: description` per kept tool's part
   that moved, in name order.

THE SUMMARY LINE is the parts below that have something to say,
joined by `; `; `unchanged` when the record is `empty` and no version
moved:

1. `spec: <n> paragraph(s) changed` (`paragraph` for one).
2. `uses: +<added joined ", ">, -<removed joined ", ">` (either half
   alone when the other is empty).
3. `contracts moved: <id> (<kind>), ...`.
4. `implements: +<ids>, -<ids>, moved <id> (<kind>), ...`.
5. `openapi: <module> (<kind>), ...`.
6. `mcp: <server> +<gained> -<lost> ~<changed>` (the counts), `...`.
7. `npm: <name> <from> to <to>, ...`.
8. `assets: ~<changed>, +<added>, -<removed>`.
9. `tests assets: ~<changed>, +<added>, -<removed>`.
10. `surface: +<added joined ", ">, -<removed joined ", ">` (either
   half alone when the other is empty).
11. `doctrine <from> to <to>`; `compiler <from> to <to>` (the digests'
   first 10 characters).

## The code source

`codeSource` answers where a compile's code comes from, `{kind, note}`,
`kind` one of `given`, `resume`, `amend`, `fresh`, down this ladder,
the first rung that applies. Its input: `recompile` (the request's
flag), `seeded` (the request gave this agent's files), `resumeSeed`
(this compile's resume seed holds gate-passed files for the agent),
`row` (`{artifact?, package?, type?}`, the fleet's row for the agent
when there is one; a row without `type` is a service; a row with a
`package` and no `artifact` was projected from a package held in the
tree, and has a previous compile), `specType` (the spec's type), and
`previous` (`{readable, reason?, snapshot, coderFiles}`: whether the
row's artifact was read, why not, whether it carries a spec snapshot,
and how many coder files it carries; absent when no read was
attempted).

1. `seeded`: `given`, `gating the given code: no session`.
2. `resumeSeed` without `recompile`: `resume`, `resuming the
   gate-passed code from the previous attempt`.
3. `recompile`: `fresh`, `writing from the specification (--recompile)`.
4. No `row`, or a row with neither `artifact` nor `package`: `fresh`,
   `no previous compile: writing from the specification`.
5. `specType` is `interface` and the row carries an `artifact` or no
   `package`: `fresh`, `an interface compiles to a contract alone`. An
   interface's package carries the declarations the model wrote, so a
   row projected from one has a previous compile and the ladder goes
   on as for any agent.
6. The row's type (a service when absent) differs from `specType`:
   `fresh`, `the agent's type changed from <the row's> to <the
   spec's>: writing from the specification`.
7. No `previous`, or one that is not `readable`: `fresh`, `the
   previous compile could not be read (<reason, or "not read">):
   writing from the specification`.
8. A `previous` without a `snapshot` or with no coder file: `fresh`,
   `the previous compile carries no <spec snapshot|coder files>: writing
   from the specification`.
9. Otherwise `amend`, `amending the previous compile`.

## Tests

Everything here is plain compute over the texts given; nothing reaches
a plane and nothing is faked. The tests hand texts in and check what
comes back: a paragraph reflowed at another width, an added blank line
and a capitalized heading are no change and no diff; a reworded
sentence is a diff of one paragraph with `- ` and `+ ` lines in the
original case; a grant added lands in `uses.added` and the record
needs a reading, a grant removed in `uses.removed` and does not; a
tests file whose sha moved lands in `testsAssets.changed` and leaves
`assets` and `empty` alone; a function on the previous surface and
not on the current lands in `surface.removed` and the record is not
empty; a
contract whose comments alone changed is a `docs` drift and needs a
reading, one whose signature changed is `structural` and does not,
one with both is `both`; an absent previous contract is `unknown` and
needs a reading; a listing with a tool gained is structural with a
`+ <name>` line, one with a description changed is `docs`; an npm
version moved reads `<from> to <to>`; a record with nothing moved is
`empty` with the summary `unchanged`, and the same with a doctrine
moved is still `empty` with the summary naming the versions; the
code-source ladder answers every rung in order with its note.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
