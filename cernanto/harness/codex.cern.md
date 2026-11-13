# Harness Codex

Type: module

Implements: cernanto/harness
Uses: cernanto/config, cernanto/machine, npm:@openai/codex-sdk@0.159.2, npm:fs-extra

The Codex vendor, one of the harness implementors: it runs the
vendor's own tool as a child of its own process to evaluate one
prompt and to drive a coding session inside codex's own sandbox, on
the machine's login or the plane's key, and narrates every session on
the console. Every session turn ends with the call that owns it, its
commands ended with it, and the vendor's deadlines and tool budgets
stay in force.

## The credential

This vendor's own setting decides how it is credentialed: read
`mode` through cernanto/config fresh on every turn,
one-shot and session alike, `plan` or `api-key`; an unset or unknown
value reads as `plan`. A login is used exactly where
it lies. This agent's data folder is the literal `agents/harness_codex`
under the working folder, spelled exactly; one-shots run in a scratch
directory under it.

In `plan` mode, the box's mode, the machine's own login serves exactly
where it lies: the codex home the CLI runs with (`CODEX_HOME`) is
`.codex` under the operator's home directory, the `HOME` of THE
MACHINE'S BASICS below. Basics without it are a dead login, failing
terminal with the words that heal it.

In `api-key` mode the key is the secret setting `api-key`,
read through cernanto/config fresh on every turn and
trimmed (an unset value is absence; a value that is not a plain key, a
JSON login file for one, is ignored). The key is the vendor's api key for the turn, handed to the
vendor alone; the configuration's `base-url`, when set, is
the endpoint the key is used at (an Azure OpenAI deployment). The
codex home is then the private `codex-home` under this agent's data
folder, which holds the CLI's session records. With no key the turn
fails terminal with exactly `no api key for codex: on a box, cernanto dev uses this machine's
ChatGPT login; on a server, cernanto config
cernanto/harness/codex api-key=<api key>`.

Its own words for a dead login: "not logged in", "run codex login", a
401, "unauthorized", "refresh token was already used", a revoked or
expired token; what heals it: `cernanto dev` (it runs this machine's
ChatGPT sign-in when none is there).

## The machine's basics

The machine's basics reach this agent through cernanto/machine alone
(THE MACHINE below), asked fresh on every turn: the basics of a child's
environment on this system, whose `HOME` is the home the machine's own
login lives in. A turn whose basics name no `HOME` fails terminal with
exactly `the machine names no HOME for the vendor`.

## The machine

The system under this agent is reached through cernanto/machine: bind the machine interface with no name, fresh on every turn, so the
implementor the plane binds answers; an unavailable binding
fails the turn terminal in words. The machine names the system (`macos`, `linux` or `windows`),
answers the basics of a child's environment on it, and keeps THE
TOOLBOX below.

## The toolbox

The toolbox is the machine's answer for this agent's own folder
`toolbox` under its data folder and THE PROGRAMS below, asked at
every turn: where the system has such a folder the machine keeps it
current with the programs of the list the machine has, and the answer
is the `PATH` value this agent hands on. THE PROGRAMS: `bash`, `sh`,
`ls`, `find`, `tree`, `pwd`, `basename`, `dirname`, `realpath`,
`readlink`, `cat`, `head`, `tail`, `tac`, `sed`, `nl`, `wc`, `stat`,
`grep`, `egrep`, `fgrep`, `rg`, `sort`, `uniq`, `cut`, `tr`, `awk`,
`paste`, `comm`, `diff`, `cmp`, `jq`, `echo`, `printf`, `env`, `true`,
`false`, `test`, `[`, `expr`, `date`, `sleep`, `xargs`, `file`,
`strings`, `od`, `hexdump`, `md5`, `shasum`, `openssl`: the read-only
programs a coder's shell needs, every one of which reads, formats or
shells.

## The vendor's environment

The vendor CLI subprocess sees exactly the environment this agent
composes: first the basics of a child's environment on this system as
the machine answers them (THE MACHINE above), every one of them as
answered, then, over them, `CODEX_HOME` pointing at the home the mode
names in THE CREDENTIAL above, and `PATH` the toolbox (THE TOOLBOX
above). In `api-key` mode the private home holds
the CLI's session records alone; in `plan` mode the operator's own
codex home is the CLI's, as for any session of theirs. The SDK runs
its own bundled CLI, found by itself; codex announces no tool version,
and a turn answers without `cli`.

## The turns

A turn runs in the session's workspace as its working directory (a
workspace that is no git repository opens as any folder), on the
model and effort the call names, codex running unattended with every
approval settled in advance. A one-shot or a session naming no model
runs on `gpt-6.1-sol` at `medium` effort. A transient vendor failure is
retried up to three times inside the turn; a codex api refusal (a 4xx
other than 401, 408 and 429) is terminal, naming the status and the
api's words. The session id a turn answers is the thread codex
started, and a turn codex reports as failed answers `failed` with
codex's own message.

A turn's time is judged by the clock. A turn that ran past
`turnTimeoutMs` is stopped and fails terminal saying the harness did
not finish its work in time; a timer that wakes before that time is
the end of the call that owns the turn, since the plane wakes a
stopped call's timers, and such a turn fails retryable saying the
turn was stopped with its call.

WHAT A TURN COST is said through the os module's `usage` the moment
codex reports the turn's completion, a turn retried inside its run
said at each completion: its input tokens and its output tokens with
the reasoning tokens among them; codex names no price, so the report
carries no cost.

A schema asked of a one-shot reaches codex in its strict form: every
object in it closed and every property required (an optional one
becomes nullable), all the way down. Codex one-shots run read-only in
a scratch directory under this agent's data folder, and `truncated` is
false on every answer (codex reports no truncation). A one-shot that
carries attachments shows each picture to the model as a file of the
one-shot's own folder under the scratch directory, named by its number
with its content type's extension, beside the prompt, and removes the
folder after the turn; a document (`application/pdf`) is refused in
words before any turn. A one-shot without attachments carries the
prompt as text.

The doctrine of a session rides the input of the thread's FIRST turn,
ahead of the prompt; a resumed thread holds it in its history already,
so a resume carries the input alone.

## The sandbox

A session runs in codex's workspace-write sandbox: the session's
workspace and the real workspace behind its `src` link are its
writable roots, the sandbox's network is off, and web search is on as
the model's own tool. The coder's shell sees exactly the environment
this agent composes for it: the machine's basics of a child's
environment, and over them `PATH` the toolbox, `HOME` the private
codex home and `TMPDIR` `/tmp`; a program named by absolute path runs
inside the sandbox, with the network off and its writes confined to
the writable roots, and the programs the shell finds by name are the
toolbox's. On a one-shot the web is on exactly when `web` was asked;
for a session it is always on; the sandbox's network stays off in
both. When the machine names the system `windows`, the session runs
in codex's own unelevated Windows sandbox, in the form a default
install has, and the shell's `PATH` is the toolbox there as
everywhere.

A READ-ONLY session (`readOnly: true`, a judge's) runs in codex's
read-only sandbox, with no writable root and with web search off
unless `web` was asked, when web search stays on as in any session:
the session reads, and reaches the web when asked. `maxToolCalls`
counts the turn's tool items, the command executions, file changes,
mcp tool calls and web searches as they start, over the whole turn
with its retries of a transient failure, and the item past the cap
aborts the turn, failing terminal with `the judge's budget of <n>
tool calls is spent`. Codex confines each writable root as a whole,
so the previous compile's folder `previous/` under a coder's workspace
is guarded there by the doctrine's words.

## The narration

Everything a session does is narrated on the console as it happens,
one line per thing, each line stamped with the seconds since the turn
began (`+12.2s`), read off codex's own stream of the turn; the words,
exactly:

- a tool the coder uses: the tool's name in lower case and what it
  was about: the path relative to the workspace (a path under the
  real workspace behind the session's `src` link reads as `src/...`
  too, the same name as its twin), the pattern, the url or query, or
  the command;
- the coder's reasoning: `thought` and the text of each reasoning
  item;
- the coder's own words between actions and at the end: `said` and
  the text of each message of the coder, every one, the last among
  them; an item whose whole text, trimmed of whitespace and code
  fences, is one JSON object (a judge's verdict) reads as its entries
  instead, one `said` line per entry, `<name>: <value>`: a string's
  further lines each as a `said` line of their own, a list of strings
  its items joined by `, `, any other value as JSON on one line;
- the coder's plan, each time the coder writes it: one `plan` line
  per item, `[ ]` pending, `[x]` done, from the plan's items and
  their completion;
- a shell command that failed (exit code 2 or more, or killed):
  `bash <command> exit <code>` followed by the last twenty lines of
  its output, each as its own line, from the command's exit code,
  status and output; a command that ended with exit code 1 prints its
  own line alone;
- a tool that took two seconds or more: its line again and ` took
<seconds>s`, measured from the ask to the item's completion;
- once per turn, last: `turn done <input> in, <output> out,
<reasoning> reasoning tokens` from the turn's completion, its input,
  output and reasoning token counts.

A text that spans several lines is printed as one line per line, each
carrying the same stamp and label, blank lines dropped, every line
whole.

## Tests

Uses: npm:jimp

Every live turn of the tests names `model` `gpt-6.1-sol` at `effort`
`medium`. The picture the tests carry is drawn by the tests
themselves: a PNG of a few hundred pixels showing the digits 42 in a
large font on white. A live one-shot carrying it, asked what number
it shows and held to a schema with one number field, answers 42.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
