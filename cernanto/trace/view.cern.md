# Trace View

Type: module

Render an agent's call as the conversation it was, and pick, of a
record that several runs of a call made, the one shown and the order
it is shown in. The operator reads this text through the cli
(`cernanto trace`), and the compiler hands the same text to
triage and to the session that fixes a failing test. Every rule below
is exact to the character: the words, the spacing, the order; a text
is cut only where a rule says so. Records are handed in and text is
answered.

## The records

A trace record carries `agentId`, `callId`, optional `attemptId`, `seq`
(a non-negative integer), `at` (an iso date-time), optional `run` and
`place`, then its `kind`:

- `handler`: `handler`, optional `input`, `output`, `error`, `stack`,
  `parentCallId`, `callerAgentId`; `durationMs`;
- `agent-call`: `target`, `handler`, optional `args`, `result`,
  `error`, `stack`, `linked`, `mocked` (a test run's mock answered the
  call); `durationMs`;
- `step`: `label`, optional `error`, `stack`, `exitCode`, `exitSignal`;
  `durationMs`;
- `sleep`: `durationMs`;
- `begin`: `of` (`handler`, `call` or `step`), optional `handler`,
  `target`, `linked`, `label`, `input`, `args`, `parentCallId`,
  `callerAgentId`;
- `log`: `level` (`debug`, `info`, `warn` or `error`), `message`;

A call can be asked more than once, and each ask is a request with
records of its own: `callId` is the request's id, the call's handle
`<service>:<generation>:<call>` with the request's own part after one
more `:`; a call a linked module ran inside another call has the id of
that call's request with a mark after it: `~`, then the attempt and a
`:` when it has one, then the link's number
(`ops_bank:20001:c-7:5f2a9c1e0b3d4a6f~2`). A process's boot call rides
no request, and its `callId` is the call's id alone. `callOfRequest`
answers the call's id of a request's id: the part before the first
`~`, when it is four parts joined by `:`, loses its last part, and the
mark after it stays; any other id is answered as it is.

`run` is the run that made the record, `<grant>.<count>`, two whole
numbers: a run is one execution of a call's body by one process, and
runs order by their grant, then by their count, each compared as a
number; a record without a run comes before every run. `place` is the
record's place in its run, a whole number: inside one run the records
order by it. The moment a record carries is shown, and the order of
runs and places is the order of the records.

The begin of a handler, a call or a step shares `(callId, attemptId,
seq)` with the end record that closes it (a `handler`, an `agent-call`,
a `step`), and a begin pairs with an end of its own attempt.

`chooseVersions` takes records and answers the ones shown: of the
records sharing one `(callId, attemptId, seq, kind)`, the one of the
earliest run; of the `handler` records of one request with no
`attemptId`, the one of the latest run; of two of one run, the one
handed first. `orderRecords` answers records run by run in the order of
runs and, inside a run, by `place`, a record without a place keeping
the order it was handed in. `recordKey` answers the text a record is
shown once by: `<callId>|<attemptId, empty when absent>|<seq>|<kind>`,
and for a `handler` record one more `|` and its run (empty when
absent), so a request that ran again and ended again shows each end.
Every reading below takes the records chosen and in that order.
`compileId` is an application label.

## Names and times

- `readable`: camelCase, snake_case or kebab-case as words, each
  capitalized on its first character: a lowercase letter or digit
  followed by an uppercase letter gets a space between them, every run
  of `-` or `_` becomes one space, the text is trimmed, split on
  whitespace, empty words dropped, each word's first character
  uppercased, joined by single spaces (`checkFact` reads `Check Fact`,
  `payment_retry-v2` reads `Payment Retry V2`).
- `spoken`: a handler as the chat spoke it: a name starting with `ai`
  followed by an uppercase letter drops the `ai`; then the same spacing
  as `readable` (the uppercase split and the `-`/`_` runs), trimmed,
  the WHOLE lowercased, and only the first character uppercased
  (`checkFact` reads `Check fact`, `aiList` reads `List`).
- `agentName`: the platform agents by their spoken names, exactly:
  `cernanto/llm` is `LLM`, an id beginning `cernanto/decision/` (an
  implementor of the decision interface) is `Decision`, `cernanto/search`
  is `Search`,
  an id beginning `cernanto/harness/` is `Harness`, an id beginning
  `cernanto/llm-prompt/` is `LLM prompt`, `cernanto/webhook` is `Webhook`,
  `cernanto/controller` is `Deploy`, `cernanto/compile` is `Compile`,
  `cernanto/auth` is `Auth`, `cernanto/trace` is `Trace`,
  `cernanto/gateway` is `Gateway`; an id starting `openapi/` is the
  rest made readable followed by ` API`; one starting `mcp/` the rest
  made readable followed by ` MCP`; any other id is its last `/`
  segment made readable.
- `humanMs`: under 1000, the rounded number and `ms`; under 60000, the
  seconds with one decimal and `s`; else the seconds rounded: under
  3600, `<minutes>m<seconds padded to 2>s`; else the minutes rounded
  from the seconds: under 1440, `<hours>h<minutes padded to 2>m`; else
  the hours rounded from the minutes and the whole days: `<days>d`
  when the hours divide by 24, else `<days>d<hours padded to 2>h`.
- `clock`: the time of day of an iso date-time to the second
  (`HH:MM:SS`), in the view's zone when it names one, else in utc; an
  unparseable text is eight spaces. `stamp`: the date and time,
  `YYYY-MM-DD HH:MM:SS` in the view's zone, or `YYYY-MM-DD HH:MM:SS
  UTC` when the view names none; an unparseable text is the text
  itself. A zone the system cannot render in reads as none.
- `timeOfDay(at, utc)`: `HH:MM:SS` in utc when asked, else local;
  unparseable, eight spaces. `dateTime(at, utc)`: `YYYY-MM-DD HH:MM:SS
  UTC` in utc, else the local date and time without a marker;
  unparseable, the text itself. `elapsed(ms)`: whole seconds (rounded,
  at least zero): under 60 `<n>s`; else minutes: under 60
  `<m>m<seconds padded to 2>s`; else `<h>h<minutes padded to 2>m`.

## Values

A value renders as lines relative to its own left edge (`valueLines`),
under a view's options (`details`, `debug`, `agentId`, and `zone`, the
IANA name of the time zone its clocks and stamps read in,
`Asia/Tokyo`, utc when absent):

1. A list: empty is the one line `[]`; else its items, all of them
   when the view is detailed, else the first 6, each as its own lines
   with `- ` before the first and two spaces before the rest; when
   items were left out, a last line `… (+<left out> more)`.
2. An object: empty is `{}`; else one entry per key in order: the key
   made readable, and the entries' labels aligned: the width is the
   longest label plus one, and a label is followed by `:` padded to
   the width plus one, then the value's text, when the value is a
   scalar on one line; a scalar text holding a newline reads `<label>: |`
   followed by each of its lines indented by two; a list or object
   value that renders as the one line `[]` or `{}` reads on the label's
   line like a scalar; any other list or object reads `<label>:` and
   its lines indented by two.
3. A scalar: `undefined` reads `Done` where it is an answer (an answer
   of nothing) and renders no body line at all where it is an argument
   (a request without an argument has no argument line), `null` reads
   `null`, a number or boolean its text, a string itself (its lines,
   when it holds newlines, each a line); anything else its JSON text,
   or its `typeof` when it has none.
4. THE ONE FOLD: a string of 40 characters or more that already
   rendered in the same view reads `(same as above)` the next times,
   unless the view is detailed.

The body of a message (`values.body`) is the value's lines each
prefixed by twelve spaces; an empty object has no body.

## Calls and trees

`summarizeCalls` reads records into the calls they describe, keyed by
`callId` (a request's id), the records chosen and in their order:
first every `begin` of a handler is noted per call id (the first one
wins); then every successful `handler` record settles a call even if
an older failed attempt arrived later. Otherwise only the handler of
the latest run can settle it; a run with no end keeps the call
running. A
settled call carries `callId`, `agentId`, `handler`, `at` =
the begin's time when noted, else the record's time minus its
`durationMs`; `durationMs` = the time from the begin to the record
when a begin was noted and that span is not negative, else the
record's `durationMs`; `status` `ok` without an error, `error` with
one (the `error` carried); `parentCallId` and `callerAgentId` carried
when the record has them; then every record of a call id with no call
yet makes a running one: `handler` the begin's handler or empty, `at`
the begin's time or the record's, `durationMs` 0, `status` `running`,
`parentCallId` and `callerAgentId` from the begin when it has them.

`buildCallTrees`: the calls as above; a call is a root when it has no
parent or its parent is not among the calls; each node holds the call,
its records in their order, and its children (the calls
whose parent it is, sorted by their `at` text ascending), recursively;
the roots sorted by `at` the same way. `flattenCallTrees`: every node
of the trees as its own entry, each parent before its children, in
order.

A call tree's summary is `CallSummary` (`callId`, `agentId`,
`handler`, `at`, `durationMs`, `status`, optional `error`,
`parentCallId`, `callerAgentId`); a tree is `call`, `records`,
`children`.

## The face of a call out

How one outgoing call reads (`callFace`), from its target, handler,
arguments, result and error:

- a target starting `mcp/`: the result is unwrapped from its envelope
  when the result is an object: `isError` true makes the error the
  envelope's `textContent` when that is a string, else `the tool
  answered an error` (an error already carried wins); else
  `structuredContent`, when present, is the result; else a string
  `textContent` is the result, parsed as JSON when it parses, the text
  itself otherwise; the party addressed (`to`, and the head line) is
  the target's agent name, the ask is the handler spoken;
- a target that is `cernanto/llm` or begins `cernanto/decision/`, with
  object arguments: the arguments are
  reshaped: `prompt` first when present, then, only when the view is
  detailed, the `context`: its own entries spread when it is an object,
  else `context` itself when it is neither undefined nor null; then
  every other argument in order;
- any other target: the agent name, the handler spoken, the arguments,
  the result and the error as they are.

## The conversation of one call

`civilianLines(tree, options)` renders one call as the conversation of
the ONE agent that ran it, in lines; `civilianTrace` is those lines
joined by newlines with a final newline.

The frame:

1. The handler end is the successful handler, else the latest run's
   handler, chosen by the same rule as the summary; the handler begin is
   the first `begin` of a handler. The handler's name: the end's, else
   the begin's, else the summary's. The start: the begin's time, else
   the summary's `at`. The wall: nothing without an end; else the span
   from the begin to the end when a begin exists and the span is not
   negative, else the end's `durationMs`. The status: `running`
   without an end, `ok` when the end has no error, else `error`.
2. The first line: `<agent name>` alone when the handler name is
   empty, else `<agent name> · <handler spoken>`; then two spaces, the
   status, two spaces, the wall as a human duration and two spaces
   when there is a wall, then the call id.
3. The caller: the summary's `callerAgentId`, else the end's, else the
   begin's; the parent likewise from `parentCallId`. The second line:
   the stamp of the start alone when there is no parent; else the
   stamp, two spaces, `from `, and the parent id alone when there is no
   caller, else `<caller's agent name>  <parent id>`.
4. An empty line.
5. The arrival: the input is the begin's `input`, else the end's. With
   no caller: the line `<clock of the start>  ← <handler spoken>`
   followed by the input's body. With a caller: `<clock>  ← <caller's
   agent name>`, then the handler spoken as a body line (twelve spaces
   before it), then the input's body.

Then the records, in order, each read once (an `agent-call` end
already paired with its begin is skipped when met again; a step's
begin renders with its end; the handler's begin and end are the
frame). Two kinds of block: a PARAGRAPH (an empty line, then its
lines) and an ACTIVITY (an empty line only when the previous block was
not an activity, then its lines).

- A `begin` of a call opens an ask, held by its `(callId, attemptId,
  seq)` until the `agent-call` that shares the tuple, wherever that end
  stands among the records: asks made at once interleave, so other
  asks' begins and ends come between an ask's begin and its end, and
  every open ask keeps waiting for its own. The EXCHANGE renders when
  its end comes, in the order the ends come. The asks still open when
  the records end render last, each as an exchange with no end. An
  `agent-call` met on its own (no begin shared that tuple):
  an exchange whose request time is the end's time minus its
  `durationMs`.
- An EXCHANGE is a paragraph: the face of the call (with the end's
  result and error when there is an end); the child call claimed for
  it: the first unclaimed child whose agent id is the target and whose
  handler is the request's handler, taken out of the unclaimed list;
  for a target that is `cernanto/llm` or begins `cernanto/decision/` the
  judgment details read off that child:
  over its records that are `agent-call`s to an id beginning
  `cernanto/llm-prompt/` whose result is an object: the first string `text` is the analysis, the
  `costUsd` numbers are summed, the first string `model` is the model.
  The lines: `<clock of the request>  → <head>`, the ask as a body
  line, the arguments' body; then, with no end: `(no reply yet)` as a
  body line while the call has no handler end, else `(no reply, the run
  ended without one)`; with an end: the wall is the span from the
  request to the end (when not negative) else the end's `durationMs`;
  `<to>` is followed by ` (mock)` when the end carries `mocked: true`
  (a test run's mock answered the call, not the target's deployment),
  in the conversation exactly as in the live stream;
  an error reads `<clock of the end>  ← <to>  error: <error>`; else
  `<clock of the end>  ← <to>  <reply tags>` then the result's body,
  then, when the view is detailed and there is an analysis, the body
  of `{ analysis }`. The REPLY TAGS: the wall as a human duration, `$`
  and the cost with two decimals when there is one, the model when
  there is one, the non-empty ones joined by ` · `; then, when a child
  was claimed, two spaces and its call id.
- A `step`: an activity; its begin is the one sharing its
  `(callId, attemptId, seq)`; the
  line `<clock>  · <label>`, with `  error: <error>` after the label
  when there is one, then two spaces and the human duration of the
  span from the begin to the end (when a begin exists and the span is
  not negative) else the record's `durationMs`; the clock is the
  begin's time when there is one, else the end's time minus its
  `durationMs`.
- A `log`: an activity, unless its level is `debug` and the view does
  not show debug lines (then nothing): the first line of the message
  after `<clock>  `, preceded by the level and a space when the level
  is not `info`; the message's other lines as body lines.
- Any other kind: an activity of its lines below, the first after
  `<clock>  `.

The activity lines of the other kinds, `earlier` being the records
already read:

- `sleep`: `· slept <human duration>`;

After the records: when there is a handler end, an empty line, then an
error reads `<clock of the end>  → error  <error>`, else `<clock of
the end>  → <to>  <human duration of the wall, else the end's
durationMs>` where `to` is `reply` with no caller, else the caller's
agent name, then the output's body. Then, for every child still
unclaimed, in order: ten spaces, `↳ <child's agent name> · <child's
handler spoken>  <child's status>  <child's call id>`.

## The conversation as it comes

The same conversation for a reader that holds one record at a time.
`startConversation(call, children, options)` takes the call's summary
(a `CallSummary`), its children as calls (each `{call, records}`, the
records given for a child whose agent is `cernanto/llm` or begins
`cernanto/decision/`, the judgment
an exchange reads off them, empty for every other child) and the
view's options, and answers a renderer of two functions: `record(record)`
answers the lines the record adds, in order, and `end()` answers the
lines after the last record. The lines answered, in that order, are
exactly `civilianLines` of the same call, records and children:
`civilianLines` is this renderer fed the tree's records in order, its
children as calls and the records of each child whose agent is
`cernanto/llm` or begins `cernanto/decision/`.

The frame is answered with the first record that is neither a
handler's begin nor a handler's end, or at `end()` when none comes:
its first and second lines from the summary (the handler, the status,
the duration, the start, the caller and the parent, settled by the
same rule the summary was), the arrival's input from the first
handler begin seen, else from a handler end seen by then. Every
handler begin and end is held for the frame and the closing and
renders nowhere else; of the ends the successful one is kept, else
the latest run's. A `begin` of a call is held until the record
after it: an end sharing its tuple makes the exchange; any other
record answers the held exchange with no reply first, then its own
lines. A paragraph's empty line and an activity's are decided by the
block before, as above. `end()` answers an exchange still held (with
no reply), then the handler's end, then the unclaimed children, as
above.

## One record in a live stream

`civilianRecordLines(record, options, open?)` renders one record as it
reads in an agent's live stream. The author's name: empty when the
view's `agentId` is the record's agent, else `<agent name>  `. A head
line is `<clock>  <author><text>`.

THE BOOT CALL is the process's own, named by the handler `boot`: its
`begin` carries the generation and the pid, its `handler` says how the
process left. A boot record renders under a detailed view, and when it
is an error (a `handler` with an error reads as any error does);
otherwise it renders nothing: a copy's start and its clean end stay
out of the conversation, a boot that failed still shows.

- a `begin` of a handler: with no caller, the head `← <handler
  spoken>`; with one, the head `← <caller's agent name>` then the
  handler spoken as a body line; then the input's body;
- a `begin` of a call: remembered as an open request when an open
  requests memory is given; the head `→ <face head>`, the ask as a body
  line, the arguments' body;
- a `begin` of a step: nothing;
- a `handler`: an error reads the head `→ error  <error>`; else the
  head `→ <to>  <human duration>` (`to` as above) then the output's
  body;
- an `agent-call`: the face of the record; the request it answers is
  taken from the open requests memory when given (by `(callId, attemptId, seq)`);
  the QUOTE line, `│ <the request's quote>` as a body line, appears
  when a request was found and either another request to the same
  target was still open or the view is detailed; `<to>` is followed by
  ` (mock)` when the record carries `mocked: true` (a test run's mock
  answered the call, not the target's deployment: the reader sees the
  proof was the weaker one); an error reads the head `← <to>  error:
  <error>` then the quote line; else the head `← <to>  <human duration
  of the record>`, the quote line, the result's body;
- a `log`: nothing for a debug line the view does not show; else the
  activity lines with the head on the first;
- anything else: the activity lines (with no earlier records) with the
  head on the first.

THE OPEN REQUESTS memory (`OpenRequests`): `begin` remembers a call's
begin under `(callId, attemptId, seq)` with its target and its quote: the face's
ask, two spaces, the one-line quote of the arguments, trailing spaces
trimmed; `end` takes the request under the reply's `(callId, attemptId, seq)`
(nothing when none), removes it, and says whether it is ambiguous:
another remembered request to the same target is still open. THE
ONE-LINE QUOTE of arguments (always as a detailed view): an object's
first entry as `<key made readable>: <the value's lines joined by
spaces>` (a value that is an object or a list as its JSON text first),
nothing for an empty object; anything else defined as its lines joined
by spaces; every run of whitespace around a newline made one space;
then cut to 80 characters with `…` appended unless the view is
detailed or the line is short enough.

## Tests

Every input is records the test writes in place; the times are iso
date-times the test chooses, so a rendered clock or elapsed is exact.
A view that names a zone renders every clock and stamp in it: a record
at `2026-08-09T12:00:00Z` under `Asia/Tokyo` reads `21:00:00` and its
stamp `2026-08-09 21:00:00`; the same view without a zone reads
`12:00:00` and `2026-08-09 12:00:00 UTC`. Two asks made at once, the
second's begin before the first's end, render as two exchanges each
with its own end, the one whose end came first first; an ask whose end
never came renders last, with no reply, after the handler's end.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
