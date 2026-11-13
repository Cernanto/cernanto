# Compile Grammar

Type: module

A module, linked into the agents that use it. Read a page the way the
machine reads it, in one scan: the labels that declare its premises,
the grants, the prose and the Tests section, with fenced code tracked
first, and answer either the validated shape or every problem found,
each naming the scope it speaks of. Turn an agent id into a file name,
a substrate service name or a plane package name, and back. The text
is handed in and every answer is data.

## The types and the spec suffix

The agent types are `service`, `task`, `job`, `worker`, `module` and
`interface`. A spec is a file named `<id>.cern.md`, whatever its type:
`SPEC_SUFFIX` is `.cern.md`, and a path ends in it or is no spec path.
The kind is what the page states on its `Type:` line (below), a task
when it states nothing: a file's name carries the id and the suffix
alone.

- `isSpecPath` answers whether a path ends with the spec suffix.
- `specFileNameOf` appends the spec suffix to a base
  (`payments/payment-retry` is `payments/payment-retry.cern.md`);
  `directorySpecFileNameOf` is `agent.cern.md`, the file that names its
  directory's id.
- `agentIdOfSpecPath` takes a path relative to the agents root with
  forward slashes: nothing when it is not a spec path; else the file
  name minus its suffix is THE LEAF, and the id is the path's
  directory when the leaf is `agent` (the directory names the agent),
  else the directory and the leaf joined by `/` (the leaf alone at the
  root); an empty id is nothing. A leaf is taken as written, a dot in
  it included: `digest.worker.cern.md` is the id `digest.worker`,
  which the agent path rule refuses.

## The grants

A grant entry is one of five forms, tried in this order, and a prefix
whose rest fails its rule is unrecognized:

1. `mcp:<server>`, an MCP server: a remote one by its url, when the
   rest after `mcp:` matches the remote url rule, else a local one by
   THE COMMAND that runs it, the rest after `mcp:`, trimmed, when the
   command rule below reads a program in it;
2. `openapi:<url>` where the url matches the remote url rule;
3. `npm:<name>` or `npm:<name>@<pin>` where the name matches the npm
   name rule and the pin, when written, is the text after the LAST `@`
   past the first character: not empty and free of whitespace, a
   version or a range taken verbatim (a scoped name's leading `@`
   stays with the name);
4. `file:<path>` where the path matches the file grant rule;
5. otherwise an agent path matching the agent path rule, optionally
   followed by `@<pin>` under the same pin rule (the version or range
   of an agent published in the registry).

The parsed entries: `{ kind: "mcp", server }` (the url, or the command
as written and trimmed: a server is told remote or local by the remote
url rule alone), `{ kind: "openapi", url }`, `{ kind: "npm", package,
pin? }`, `{ kind: "file", path }` (the path kept exactly as written),
`{ kind: "agent", path, pin? }`; `pin` is present only when one was
written.

THE COMMAND RULE (`mcpCommandOf`, which takes a command's text and
answers its parts or nothing) reads a local server's command the way a
POSIX shell reads a command line, with no shell and nothing expanded:
the text is split into words on whitespace; a part between single
quotes is kept verbatim; a part between double quotes is kept with
`\"` and `\\` as its two escapes; a backslash outside quotes keeps the
character after it (a backslash that ends the text is kept itself);
a word is every part written without whitespace between them, an
empty quoted part a word of its own. THE ENVIRONMENT WORDS are the
leading words of the form `NAME=value`, the name matching
`[A-Za-z_][A-Za-z0-9_]*` and written bare (no quote or backslash
before its `=`), the `=` the first of the word: the name before it,
the value after it, possibly empty, a later word of a name replacing
an earlier one. The first word after them is THE PROGRAM and the rest,
in order, its ARGUMENTS. The answer is `{environment, program,
arguments}`, `environment` the names and their values; a text that
leaves a quote open, or names no program after its environment words
(an empty program among them), answers nothing. So
`TG_APP_ID=1234 TG_API_HASH=abcd npx -y @chaindead/telegram-mcp`
answers the environment `{TG_APP_ID: "1234", TG_API_HASH: "abcd"}`,
the program `npx` and the arguments `-y` and
`@chaindead/telegram-mcp`, and `A="x y" uvx 'a b'` the environment
`{A: "x y"}`, the program `uvx` and the argument `a b`.

The rules, as regular expressions applied to the whole text:

- the agent path: `^(?!(?:.*\/)?tests$)[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$` (kebab-case segments joined by `/`, the spec's folder path from the workspace root at any depth, a single segment being a spec at the root; a last segment `tests` is refused, since `<agent id>/tests` is the place of an agent's tester in the plane's configuration; `isAgentPath`);
- the npm name: `^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$`
  (`isNpmName`);
- the remote url: `^(?:https:\/\/[^\s]+|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s]*)?)$`
  (https, and loopback http; `isRemoteUrl`);
- the file grant: `^\/?(?:[^/\\\0]+\/)*[^/\\\0]*$` AND the path with its
  trailing slashes removed is not empty (so `file:` and `file:/` grant
  nothing; `isFileGrantPath`).

## The license expression

A `License:` label carries one SPDX license expression, the form every
package manifest states a license in (`MIT`, `Apache-2.0`,
`MIT OR Apache-2.0`, `GPL-2.0-only WITH Classpath-exception-2.0`,
`LicenseRef-Acme-Proprietary`). The rule (`isLicenseExpression`) reads
the text with every `(` and `)` set apart by spaces and then split on
whitespace into tokens (empty tokens dropped):

1. an identifier is a token matching `^[A-Za-z0-9.-]+\+?$` that is
   none of `AND`, `OR` and `WITH` (the operators are upper-case only;
   `LicenseRef-<name>` is an identifier like any other; the registry
   holds the SPDX list and checks an identifier against it);
2. a term is an identifier, optionally followed by `WITH` and an
   identifier, or an expression between `(` and `)`;
3. an expression is a term followed by any number of `AND` or `OR`
   and a term;
4. the text is an expression when its tokens read as one expression
   with every token consumed; an empty text is not.

## The scan

A page is read in ONE SCAN over its lines, the line numbers 1-based
over the whole file. The scan tracks fenced code first: a line whose
trimmed text begins with three or more backquotes, or three or more
tildes, opens a fence (the rest of the line is its info string), and
the fence closes at the first later line whose trimmed text is a run
of the same character at least as long and nothing else. Inside a
fence, the opening and closing lines included, every line is prose of
the section it stands in, an example, and nothing below applies to
it. Outside a fence, each line is read by the first of these that
fits:

1. THE TESTS HEADING. A line whose trimmed text is exactly `## Tests`
   opens the Tests section: the head is everything before the first
   such line and the Tests section everything after it (without such a
   line the whole file is the head). A second such line is the problem
   `tests: a second ## Tests heading; a page has one Tests section` at
   its line, and is dropped. THE SCOPE of a section is `spec` for the
   head and `tests` for the Tests section; every problem below opens
   with the scope of the section it stands in, so a reader knows which
   labels it speaks of.
2. A line whose trimmed text is exactly `## License` is dropped: it is
   the reader's heading over the notice labels, which are read by rule
   5 wherever they sit.
3. A NEAR MISS OF THE HEADING: any other level-two heading (a trimmed
   text that begins with `##` and not `###`) whose text, undecorated
   (its `*` and `_` taken out, any closing run of `#` taken off,
   trimmed) and case-folded, is `test`, `tests` or `testing` is the
   problem `<scope>: "<the line, trimmed>" is not the Tests heading;
   did you mean "## Tests"` at its line, and is dropped. Any other
   heading is prose.
4. THE TYPE LINE: a trimmed line that begins with `Type:` spelled
   exactly (a capital T, no space before the colon, no decoration) is
   a Type line, its value the rest, trimmed. In the head the first is
   the page's; a second is the problem `spec: a second Type line; the
   kind is stated once` at its line, and is dropped. In the Tests
   section each is the problem `tests: Type belongs to the head` at
   its line, and is dropped.
5. A LABEL: a trimmed line matching `^(Uses|Implements|Copyright|License|Mocks):(.*)$`
   (the label spelled exactly: the capital, no space before the colon,
   no decoration; Uses and Implements grant, Copyright and License are
   the notice labels, Mocks names the agents the tests replace with
   mocks):
   - when this section already has a block of that label, the problem
     is, for Uses and Implements, `<scope>: a second <Uses|Implements>
     line; a section grants in one place, add the entry to the first`,
     for Mocks `<scope>: a second Mocks line; the mocked agents are
     stated once, add the entry to the first`, and for Copyright and
     License `<scope>: a second <Copyright|License> line; the notice is
     stated once in the whole spec`, at this line, and the line is
     dropped;
   - else when something follows the colon (trimmed), the block's
     entries are, for Uses, Implements and Mocks, that text split on
     every comma, each trimmed, all at this line, except that in a
     Uses line the first part that starts with `mcp:` and whose rest
     does not match the remote url rule takes the rest of the line,
     its commas included, as its one entry (a local server's command
     runs to the end of its line, so it is the line's last entry); for
     Copyright and License, that whole text as ONE entry at this line
     (a comma is part of a notice);
   - else (a bare colon) the block's entries are the bullets of the
     lines below, read one line at a time:
     - a line matching `^\s*[-*]\s+(.*\S)\s*$` is one entry (the
       captured text, trimmed) at its own line;
     - a blank line: when the next non-blank line is a bullet, the
       blank lines up to it are skipped and the list goes on from that
       bullet; else the list ENDS BEFORE the blank line, which is then
       read as any line;
     - any other line ends the list before it; when the list already
       has entries, that line is the problem `<scope>: the line "<the
       line, trimmed>" continues the bullet above it; put every grant
       on its own bullet line` at its line and is DROPPED (the scan
       goes on at the line after it); when the list has no entry yet,
       the line is read as any line.
     A block with no entry is the problem `<scope>:
     <Uses|Implements|Copyright|License|Mocks> names nothing; write the
     entries after the colon, or one per bullet on the lines below` at
     the label's line, and the empty block is kept.
6. A NEAR MISS OF A LABEL, read in A DECLARATION POSITION alone: a
   line that opens a paragraph (the first non-blank line of the file
   or of the Tests section, or the first non-blank line after a blank
   line), or a line in the run of lines after a Type line, a label
   line or a near miss, up to the next blank line. In that position, a
   line whose trimmed text matches `^[*_]*([A-Za-z]+)[*_]*\s*:` and
   whose word, case-folded, is within one edit (one letter inserted,
   dropped or changed) of `type`, `uses`, `implements`, `mocks`,
   `copyright` or `license` (so `use`, `implement`, `mock` and
   `licence` are among them) is the problem `<scope>: "<the word as
   written>:" is not a label; did you mean "<the label meant>"` at its
   line, and is dropped: the label meant is the nearest of the six, in
   its spelling (`Uses:`), and `uses:`, `Uses :`, `**Uses:**` and
   `Use:` are all caught. A line outside a declaration position, and
   a line that opens with any other word and a colon (`Note: the
   caller is trusted.`), is prose.
7. Any other line, as written (untrimmed), is prose; a blank line is
   prose too, and ends the run after a label.

The prose of a section is its prose lines joined by newlines and
trimmed. An `Implementation:` line is prose like any other: no page
declares one.

## The head

After the scan, in this order:

1. The page's type: the Type line's value when the head has one, one
   of the six; any other value is the problem `spec: unknown type
   "<value>" on the Type line; one of task, service, job, module,
   interface, worker` at its line. Without a Type line the type is
   `task`. The Type line is the one home of the kind: nothing else on
   the page, and nothing in its file's name, states it.
2. The Uses block's entries, in order, each: empty is the problem
   `spec: empty entry in Uses line` at its line; unrecognized is
   `spec: unrecognized Uses entry "<value>"; a grant is an agent by
   its path with a namespace (cernanto/decision, payments/payment-retry), a
   package as npm:<name>, an api as openapi:<https url>, a server as
   mcp:<https url> or a local one as mcp:<the command that runs it>, or
   a file as file:<path>` at its line; the recognized ones are the
   grants, in order. No block, no grants.
3. The Implements block's entries, in order, each: empty is `spec:
   empty entry in the Implements line`; an entry starting with
   `openapi:` is an OPENAPI TARGET, kept exactly as written, when its
   rest (the text after `openapi:`) matches the file grant rule or the
   remote url rule, else the problem `spec: Implements names
   "<value>", which is not an openapi document (openapi:<a path
   relative to the spec, from the root with a leading slash, or an
   https url>)`; any other entry that is not an agent path is `spec:
   Implements names "<value>", which is not an agent path or an
   openapi document (openapi:<path or https url>)`; one seen before in
   this block is `spec: "<value>" appears more than once in the
   Implements line`; each at its line; the rest are the implemented
   entries, in order: the interface ids and the openapi targets as
   written. No block, none.
4. The Copyright block's entries, in order, each: empty is the problem
   `spec: empty entry in Copyright line` at its line; the rest are
   the copyright notices, in order, kept as written. No block, none.
5. The License block: more than one entry is the problem `spec:
   License names more than one expression; write one SPDX expression
   (MIT OR Apache-2.0 for a choice)` at the label's line; an empty
   entry is `spec: empty entry in License line` at its line; an entry
   that fails the license expression rule is `spec: unrecognized
   License "<value>"; a license is an SPDX expression: an identifier
   such as MIT or Apache-2.0, LicenseRef-<name> for terms of your own,
   combined with AND, OR, WITH and parentheses` at its line; else the
   entry is the license. No block, none.
6. A Mocks block in the head is the problem `spec: Mocks belongs to
   the tests, inside the Tests section` at its label's line, and the
   block is dropped: the heading is what gives the word its scope.
7. The prose is the head's prose; empty is the problem `spec has no
   prose describing the agent behavior` with no line.

## The Tests section

When the page has one, after the head, in this order: an Implements
block is the problem `tests: Implements belongs to the agent, above
the Tests section` at its label's line; its Uses block is read as the
head's, each problem opening with `tests`; its Copyright and License
blocks are read as the head's, each problem opening with `tests`, and
belong to the PAGE (a notice is the whole page's, wherever it sits:
the end of the page, after the tests, is its usual place), except
that a label the head already carries is the problem `tests:
<Copyright|License> is already stated above the Tests section; state
it once` at the block's label line; its Mocks block's entries, in
order, each: empty is the problem `tests: empty entry in Mocks line`
at its line; one that is not an agent path is `tests: Mocks names
"<value>", which is not an agent path; a mock stands for an agent or
an interface by its id (payments/erp-post), never a package, an api, a
server or a file` at its line; one seen before in this block is
`tests: "<value>" appears more than once in the Mocks line` at its
line; the rest are the mocked ids, in order, kept as written (whether
each names an agent the tests may replace is the plan's judgment); its
prose is the section's prose; when the prose is empty AND the section
carries neither a Uses block nor a Mocks block, the problem `tests
section has no prose` at the heading's line (then the page has no
Tests section); otherwise the Tests section is its grants, its mocked
ids and its prose, the prose empty when the section is labels alone
(the tests are then derived from the specification, with the listed
agents replaced by mocks).

## The answer

`parseSpecText` answers `{ ok: false, issues }` (every problem, each
`message` with its `line` when it has one, in the order of their
lines, the ones without a line last) when any problem was found; else
`{ ok: true, spec }` with `uses`, `implements` (only when any entry
was read: the interface ids and the openapi targets as written, in
order), `copyright` (only when any notice was read), `license` (only
when one was read), `prose` and `tests` (only when the section
exists: its `uses`, its `prose`, which is empty for a section of
labels alone, and `mocks` only when any entry was read: the mocked
ids as written, in order). `parseSpec` takes the markdown alone and
answers the same with `type` added to the spec, the page's kind: its
Type line's, else `task`. Neither takes a kind from its caller: the
page is the one reader's one source.

## The naming rules

- `serviceNameOf`: the substrate's name for an agent, every character
  that is not a letter or a digit replaced by `_` (`cernanto/gateway`
  serves as `cernanto_gateway`).
- `packageDirOf`: an id with every `/` made `-`
  (`cernanto/controller/status` is `cernanto-controller-status`).
- `agentIdOfPackage`: a leading `@cernanto/` is dropped and every `-`
  of the rest is made `/` (`@cernanto/cernanto-decision` is `cernanto/decision`);
  anything else is nothing.

## Tests

The scan is proved on pages. A label and a `## Tests` heading inside a
fenced block grant nothing and split nothing, and the fence's lines
are the prose's. Each near miss of a label (`uses:`, `Uses :`,
`**Uses:**`, `Use:`, `Types:`, `Licence:`) is refused with the label
meant and its line, and a sentence that opens with another word and a
colon is prose; a heading that nearly says Tests (`## Testing`, `##
tests`, `##Tests`) is refused with the heading meant. A second Type
line, a second `## Tests` heading and a second label of one name in a
section are refused at their line, the words opening with the scope.
The kind has one home: a page's Type line, `task` without one, and a
file name that carries a type word is an id with a dot, which the
agent path rule refuses. The Tests section's labels are the tester's
and the head's are the agent's, each problem opening with its scope.

The two forms of a server are proved by the grants they parse to: a
url and a command each parse to their server as written; an inline
Uses line whose last entry is a command holding a comma keeps the
command whole; and a command that leaves a quote open, and one that
names no program after its environment words, are unrecognized
entries.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
