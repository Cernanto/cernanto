# Harness Fake

Type: module

Implements: cernanto/harness
Uses: cernanto/config, npm:fs-extra

The rehearsal vendor, one of the harness implementors: it answers
every one-shot and every session turn from script files, so a test
plane runs whole compiles with no model and no cost. Read two
JSON-array files, `ai-script.json` for one-shots and
`ai-session-script.json` for sessions, under the folder the
configuration's `rehearsal` names (an absolute path, read
through cernanto/config fresh at every turn), else under this agent's
own data folder, the literal `agents/harness_fake` under the working
folder, spelled exactly; a missing file is an empty script.

A one-shot takes the first entry whose every condition holds (`text`,
optional `truncated`, `structured` and `usage`, read as a session
entry's; the answered model is `fake`): an entry may carry `when`
(served to a one-shot whose prompt contains this text), `every` (true:
served to every one-shot it matches, and kept) and `label`; an entry
without a condition serves whoever asks, and a one-shot consumes the
entry it serves, an `every` entry excepted, the file written back with
the entry it served consumed; with no entry left for it the turn fails
terminal quoting the prompt. Whatever attachments a one-shot carries
ride along and change nothing.

A session entry may carry `text`, `files` (workspace-relative paths to
contents, written into the workspace before the turn answers),
`status`, `delayMs` (served after this long; a turn timeout that
passes first, by the clock, fails terminal with `the harness did not
finish its work in time`, and a wait woken before its time is the end
of the call that owns the turn, since the plane wakes a stopped call's
timers, failing retryable saying the turn was stopped with its call),
`when` (served to a session whose workspace path contains
this text), `whenInput` (served to a turn whose input contains this
text), `whenReadOnly` (true: served to a read-only turn, a judge's;
false: to a writing turn), `whenFile` (served to a session whose
workspace holds this file, a workspace-relative path), `unlessFile`
(served to a session whose workspace lacks it), `every` (true: served
to every turn the entry matches, and kept), `usage` (`inputTokens`
and `outputTokens`, whole numbers, with `costUsd` when the turn is
priced: the turn's usage, its `units` the two summed; a turn whose
entry names none answers zero of each) and `label` (a word of the
script's own for the served log); an entry without a condition serves
whoever asks, and a turn takes the first entry whose every condition
holds. A session turn consumes the entry it serves, an `every` entry
excepted, so a scripted compile's turns arrive in order; a session
with no matching entry left echoes its input, completed. The session
id a turn answers is a word of this agent's own, reusable for a
resume, and a resume is served as an open is. Every served session
entry appends one line to `ai-session-served.log` beside the scripts:
the entry's `label` (its index in the file when it has none), a space
and the session's workspace path.

WHAT A TURN COST: a served entry, a one-shot's or a session turn's,
that carries `usage` is reported through the os module's `usage` as it
is served (its tokens, and its cost when it names one), so a rehearsal
is accounted as a real run is.

## Tests

Uses: npm:fs-extra
Mocks: cernanto/config

The scripted compiles of the test planes prove sessions and one-shots
alike. The tests here write a script folder of their own under a
temporary directory, hand its path to this agent as its setting `rehearsal` through a shadow
of cernanto/config answering that name, and prove that a one-shot whose prompt contains
a `when` entry's text answers that entry's text and consumes it, that
an `every` entry serves twice, and that a one-shot with no entry left
fails terminal quoting the prompt.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
