# Harness Claude Code

Type: module

Implements: cernanto/harness
Uses: cernanto/config, cernanto/machine, npm:@anthropic-ai/claude-agent-sdk@0.3.280, npm:fs-extra

The Claude Code vendor, one of the harness implementors: it
runs the vendor's own tool as a child of its own process to evaluate
one prompt and to drive a coding session, every tool call of a
session answered by a policy without a model and the session's shell
fenced by the vendor's sandbox. Beside the interface it exports that
policy as `decideTool` and the shell's fence as `shellSandbox`, so
both are proven without a model. Every session turn ends with the
call that owns it, its commands ended with it, and the vendor's
deadlines and tool budgets stay in force.

## The credential

This vendor's own setting decides how it is credentialed: read
`mode` through cernanto/config fresh on every turn,
one-shot and session alike, one of `plan`, `api-key` and `bedrock`; an
unset or unknown value reads as `plan`. A one-shot that names no model
or effort runs on `sonnet` at `low`. The
login is the machine's own, used where it lies and kept current by
the vendor tool itself. This agent's data folder is the literal
`agents/harness_claude_code` under the working folder, spelled
exactly; one-shots run in a scratch directory under it.

In `plan` mode, the box's mode, the vendor tool runs on this machine's
own login exactly where it lies, the machine's keychain or `~/.claude`,
which the bundled CLI resolves as it does for every other session on
the machine; the machine's `HOME` and user ride the environment for
that (THE VENDOR'S ENVIRONMENT below).

In `api-key` mode the key is the secret setting
`api-key`, read through cernanto/config
fresh on every turn and trimmed (an unset value is absence; a value that
is not a plain key, a JSON login file for one, is ignored). The key reaches the vendor as `ANTHROPIC_API_KEY`, the
vendor alone (the shell's sandbox denies it to the coder's commands,
THE SHELL below). With none, the turn fails terminal with exactly `no api key for claude: on a box, cernanto dev uses this machine's
Claude login; on a server, cernanto config
cernanto/harness/claude-code api-key=<api key>`.

In `bedrock` mode the vendor gets `CLAUDE_CODE_USE_BEDROCK=1`;
`AWS_REGION` from the configuration's `region` (required:
without it the turn fails terminal with exactly `bedrock needs
cernanto/harness/claude-code/region: cernanto config cernanto/harness/claude-code region=<aws region>`);
`ANTHROPIC_BEDROCK_REGION_PREFIX` from `bedrock-prefix` when
set (one of us, eu, apac, jp, au, global); the model pins
`ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL` and
`ANTHROPIC_DEFAULT_HAIKU_MODEL` from `models` (its `opus`,
`sonnet` and `haiku`: full Bedrock model or inference-profile ids,
each passed when set); and `AWS_BEARER_TOKEN_BEDROCK`, the Bedrock API
key, from the secret setting `bedrock-key`, read as
the api key is; with none, the turn fails terminal with exactly `no
bedrock api key: cernanto config
cernanto/harness/claude-code bedrock-key=<api key>`. The
aliases a caller names (`opus`, `sonnet`) stay as given: the vendor
maps them through the pins.

Its own words for a dead login: "not logged in", "please run /login",
"invalid api key", a 401, "unauthorized", a revoked or expired token;
what heals it: `cernanto dev` (it runs this machine's Claude sign-in
when none is there). An `assistant` message whose `error` is
`authentication_failed`, `oauth_org_not_allowed`, `account_on_hold` or
`billing_error` fails the turn terminal the same way, naming the kind.
A transient vendor failure is retried up to three times inside the
turn. An error result whose text begins `Prompt is too long` (the
CLI's refusal of a context, synthesized before a request or echoed
from one) is terminal: the turn fails at once with exactly `the prompt
is too long for the model: <the CLI's words>`.

## The machine's basics

The machine's basics reach this agent through cernanto/machine alone
(THE MACHINE below), asked fresh on every turn: the basics of a child's
environment on this system, whose `HOME` is the home the machine's own
login lives in, and the folder of the node the plane runs on. A turn
whose basics name no `HOME` fails terminal with exactly `the machine
names no HOME for the vendor`.

## The machine

The system under this agent is reached through cernanto/machine: bind the machine interface with no name, fresh on every turn, so the
implementor the plane binds answers; an unavailable binding
fails the turn terminal in words. The machine names the system (`macos`, `linux` or `windows`),
answers the basics of a child's environment on it and the folder of the
node the plane runs on, and keeps THE TOOLBOX below.

## The toolbox

The toolbox is the machine's answer for this agent's own folder
`toolbox` under its data folder and THE PROGRAMS below, asked at
every turn: the machine keeps the folder current with the programs
of the list the machine has, and the answer is the `PATH` value this
agent hands on, under which the vendor's shell finds those programs
alone on every system. THE PROGRAMS: `bash`, `sh`, `ls`, `find`,
`tree`, `pwd`, `basename`, `dirname`, `realpath`, `readlink`, `cat`,
`head`, `tail`, `tac`, `sed`, `nl`, `wc`, `stat`, `grep`, `egrep`,
`fgrep`, `rg`, `sort`, `uniq`, `cut`, `tr`, `awk`, `paste`, `comm`,
`diff`, `cmp`, `jq`, `echo`, `printf`, `env`, `true`, `false`, `test`,
`[`, `expr`, `date`, `sleep`, `xargs`, `file`, `strings`, `od`,
`hexdump`, `md5`, `shasum`, `openssl`, `sandbox-exec`, `bwrap`,
`socat`, `security`: the read-only programs a coder's shell needs,
every one of which reads, formats or shells; the helpers the vendor
tool runs its sandbox with, `sandbox-exec` on macOS and `bwrap` and
`socat` on Linux; and, on macOS, the keychain's `security`, which the
vendor tool asks for its login.

## The vendor's environment

The vendor CLI subprocess sees exactly the environment this agent
composes. It always gets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and
`CLAUDE_CODE_DISABLE_ORG_MEMORY=1` (the vendor's memory across turns
and compiles and its organization memory both off, for one-shots and
sessions alike), `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`
(the API's own limit is the one limit on a prompt's size, whatever
model the plane names) and the variables of the mode in THE CREDENTIAL
above; in `plan` mode the environment is the basics alone. The basics:
the basics of a child's environment on this system as the machine
answers them (THE MACHINE above), every one of them as answered (the
bundled CLI resolves the machine's own login under their `HOME`), with
`PATH` replaced by the toolbox (THE TOOLBOX above). The vendor runs on the settings this agent hands it alone: the
mcp servers the session's policy grants are the ones loaded, and the
operator's own mcp configuration, user settings, project files and
plugins stay out of every session. The SDK runs its own bundled CLI,
found by itself; a turn answers `cli`, the version that served it, as
the vendor announces it at the turn's start.

## The turns

A turn runs in the session's workspace as its working directory, on
the model and effort the call names, with the vendor's own standing
instructions and the doctrine appended to them: the same bytes for
every session of the plane, the session's own context riding its first
user message. A resume continues the recorded session. When a schema
is asked, it is asked through the vendor's own structured-output
mechanism and the value answered as `structured` beside the text (THE
TEXT ROAD below when that fails).

A turn's time is judged by the clock. A turn that ran past
`turnTimeoutMs` is stopped and fails terminal saying the harness did
not finish its work in time; a timer that wakes before that time is
the end of the call that owns the turn, since the plane wakes a
stopped call's timers, and such a turn fails retryable saying the
turn was stopped with its call.

A one-shot answers from the prompt alone; with the web asked, exactly
web search and fetch are on. The turn budget is `maxTurns`, else 8
with the web and 3 without; `truncated` means the token limit stopped
the reply. A one-shot answers the reply's text, the structured value,
the usage and the cost as the vendor reports them. The `model` a turn
answers (one-shot and session alike) is the model the vendor announces
at the turn's start as the one serving the conversation. A run that
produces no result fails retryable saying the harness likely failed to
start.

WHAT A TURN COST is said through the os module's `usage` the moment the
vendor's result reports it, for a one-shot and a session turn alike:
its input tokens with the cache's reads and writes among them, its
output tokens and its total cost in US dollars; a result that ends in
an error and reports its accounting is said as well, and a one-shot
asked once more on THE TEXT ROAD below says each of its two asks.

A one-shot that carries attachments shows them to the model before
the prompt, in the given order: each is introduced by a line of its
own, `Image N (label):` or `Document N (label):` (the number counted
within its kind, the label when given), and follows as the picture or
the document itself, an image under its content type and a document
under `application/pdf`; the prompt comes last. A one-shot without
attachments carries the prompt as text. Everything else of the turn
(the standing instructions, the tools, the output format, the turn
budget, the retries, the text road) is the same on both roads. A
content type outside the four image types and PDF is refused in words
before any turn.

THE TEXT ROAD FOR A STRUCTURED ANSWER: a one-shot that asked a schema
and ends in an error result whose words contain `structured output`
is asked ONCE MORE on the same road as the first ask, its attachments
shown as before, with the schema in the prompt in place of the
vendor's mechanism: the prompt followed by a
blank line and `Answer with exactly one JSON object and nothing else,
matching this JSON schema:`, a newline and the schema as JSON; the
reply's text is read as JSON (the text trimmed of surrounding
whitespace and code fences, else the last span from a `{` to its
matching `}` that parses) and answered as `structured` beside the
text; a reply that yields no JSON fails the turn with the CLI's words
followed by `; the text road answered no JSON`. Any other error result
fails as it did.

## The narration

Everything a session does is narrated on the console as it happens,
one line per thing, each line stamped with the seconds since the turn
began (`+12.2s`), read off the vendor's own stream of the turn; the
words, exactly:

- a tool the coder uses, at the ask: the tool's name in lower case
  and what it was about: the path relative to the workspace, the
  pattern, the url or query, or the command (`+12.2s read
src/index.ts`, `+3.8s bash grep -rn waitForEvent src`, `+15.8s
toolsearch select:WebFetch`);
- a refused tool call: `refused`, the same words, then `: ` and the
  reason (`+3.8s refused bash node src/index.ts: node is not a
read-only program; the compile runs tsc, the lint rules and the
tests and resumes this session with the report`);
- the coder's reasoning: `thought` and the text of each thinking
  block of the coder's messages; a block whose text the vendor
  withholds (an empty block beside its signature) still prints one
  line, `thought (the vendor keeps the text)`; a redacted block reads
  `thought (redacted)`;
- the coder's own words between actions and at the end: `said` and
  the text of each text block of the coder's messages, every one, the
  last among them; a block whose whole text, trimmed of whitespace
  and code fences, is one JSON object (a judge's verdict) reads as
  its entries instead, one `said` line per entry, `<name>: <value>`:
  a string's further lines each as a `said` line of their own, a list
  of strings its items joined by `, `, any other value as JSON on one
  line;
- the coder's plan, each time the coder writes it: one `plan` line
  per item, `[ ]` pending, `[-]` in progress, `[x]` done, from the
  items of the plan tool's call (`TodoWrite`, each item's `content`
  and `status`);
- a tool that failed: the tool's line again, `failed:` and the
  vendor's error text, the content of the tool's result marked as an
  error; a shell command that failed (exit code 2 or more, or killed)
  reads `bash <command> exit <code>` followed by the last twenty lines
  of its output, each as its own line, from that content; a shell
  command that ended with exit code 1 prints its own line alone,
  whatever the vendor marked the result as;
- a tool that took two seconds or more: its line again and ` took
<seconds>s`, measured from the ask to the tool's result;
- a wait: `api retry <attempt>/<max> after <status or error>,
<delay>s` when the vendor retries an API request; `rate limit
<status> <type>, resets <time>` when the vendor reports a rate limit
  at the status `allowed_warning` or `rejected`, the time in epoch
  seconds; `compacting context` when the vendor starts compacting the
  conversation, and `context compacted <before> -> <after> tokens`
  when it has; `still running <tool> <seconds>s` every ten seconds a
  tool keeps running, from the vendor's progress reports; `thinking
~<n> tokens` while the model thinks, from the vendor's estimate,
  printed at most once every fifteen seconds and whenever the
  estimate crosses a further thousand tokens, so a long think reads
  as a rising count;
- once per turn, first: `session <vendor cli version> model <model>
tools <count>` from the vendor's announcement at the turn's start,
  and `mcp <server> <status>` for each mcp server it lists;
- once per turn, last: `turn done <n> model calls, model <api
seconds>s of <wall seconds>s` from the turn's result (the model calls
  it counts, its API time and its wall time);
- a vendor-side problem mid-turn: `error <kind>` from the error kind
  the coder's message carries (`rate_limit`, `overloaded`,
  `server_error`, `max_output_tokens`, ...); `model refusal
<category>: <original model> -> <fallback model>` when the vendor
  falls back to another model after a refusal, and `model refusal: `
  and the text when it reports a refusal with no fallback; `warn ` and
  the text of a warning the vendor reports.

A text that spans several lines is printed as one line per line, each
carrying the same stamp and label, blank lines dropped, every line
whole.

## The policy

A compile session is unattended: every tool call is answered by the
policy below, which the vendor consults at the ask, before the call
runs and for every call, the reads it would otherwise allow without
asking included, on both roads the vendor offers for the decision,
with one decision and one narration for both; the policy's answer
carries the amended input when it amends the call. The session writes
code; the compile runs tsc, the lint rules and the tests and resumes
the session with the report. The rules, exactly:

Writes are allowed inside the session's workspace alone, and there
everywhere but what the compiler owns: the project files
(package.json, tsconfig.json, platform.d.ts, package-lock.json), the
generated sources (src/main.ts, src/os._, src/announce._, src/assets.*,
and everything under src/agents, src/mcp, src/openapi), assets/,
node_modules, dist, types, everything under `.cern`, and the previous
compile's folder `previous/`, which the compile writes before the
session opens and the coder reads.

A READ-ONLY session (`readOnly: true`, a judge's) answers every write
with a refusal: the Write, Edit, MultiEdit and NotebookEdit tools are
denied naming the mode, the shell's sandbox carries an empty
`allowWrite` (the sandbox's own temp directory stays) and `denyWrite`
the whole workspace, and WebSearch and WebFetch are denied as
sub-agents are unless `web` was asked, when exactly those two are
allowed (each counted by `maxToolCalls` like any call); reads follow
the coder's rules. `maxToolCalls` counts every tool call the policy
sees in the turn: the call past the cap, and every call after it, is
denied with `the judge's budget of <n> tool calls is spent: answer
now from what you have read`, and the turn goes on, so what the
session says next is its answer.

Reads are free inside the workspace except `.cern` and the platform's
own packages under node_modules (`@cernanto/*`); another agent's
package under node_modules (`cernanto-agent-*`) carries its
declarations (`types/`) and its manifest there, which are readable,
and a path under such a package's `dist` or `src` is refused as the
implementation. A path a tool names may be absolute or relative (the
vendor's Read, Write and Edit tools name files by absolute path): a
relative path is resolved against the workspace, an absolute one is
taken as it is, and the call is denied when the path climbs with `..`
or lands outside the workspace, naming the path (the workspace
itself, `.` or its own absolute path, is inside); a Glob pattern that
is absolute or climbs is denied; a Grep pattern is a regular
expression. A path under the real workspace behind the session's
`src` link names the same file as its twin under the session's
workspace, and the coder may use either name. A Glob or Grep naming
no path searches `src`: the policy fills the path in through the
amended input.

THE SHELL (the Bash tool) is fenced by the vendor's sandbox: the
command runs in bash exactly as the coder wrote it, pipes, quoting of
every kind (`$'\x1b'`, `$(...)`, backticks, heredocs), loops, `cd` and
redirects to files included, and the operating system decides what it
may touch. The policy refuses the tool's `run_in_background` option
alone (a compile session runs everything in the foreground) and
narrates the command. On session turns the sandbox is on and required:
every command runs inside it, bash is admitted under it without a
question, and a box that cannot sandbox fails the turn terminal naming
the two packages to install (Seatbelt on macOS, bubblewrap and socat
on Linux). The sandbox's network admits no domain, so the plane's own
ports are out of its reach, and the credential variables
`ANTHROPIC_API_KEY` and `AWS_BEARER_TOKEN_BEDROCK` are denied to the
commands. The filesystem lists, with every path absolute, the
workspaces and the toolbox by their real paths (a link resolved before
it is listed): `allowRead` is the session's workspace, the real
directory behind every link at the top of it and behind every link at
the top of each directory in it (the `src` link of a code workspace,
where the compile's files live; the `previous` and `current` links of
a judge's root, where the previous compile's code and the current
contracts live; the `agent/src` and `tester/src` links of a triage
root and their `node_modules`, where the code and the tests the judge
reads live), and the toolbox; `allowWrite` is the two workspaces
alone, the sandbox's own session temp directory writable beside them
and named by `$TMPDIR`; `denyRead` is the operator's home directory
(the basics' `HOME`) and the directory holding the node the plane runs
on (the folder the machine answers, when it answers one), the plane's
working folder (the current directory),
every home directory and every mounted volume (`/Users`, `/home`,
`/root`, `/Volumes`, `/mnt`, `/media`; the workspaces and the toolbox
under them are re-opened by `allowRead`), `/usr/local` and
`/opt/homebrew`, and, in both the session's workspace and the real
one, `.cern`, `node_modules/@cernanto` and every
`node_modules/cernanto-agent-*` package's `dist` and `src`;
`denyWrite` is, in both workspaces, the project files
(`package.json`, `tsconfig.json`, `platform.d.ts`,
`package-lock.json`), the generated sources (`src/main.ts`,
`src/os.ts`, `src/os.d.ts`, `src/announce.ts`, `src/announce.d.ts`,
`src/assets.ts`, `src/assets.d.ts`, `src/agents`, `src/mcp`,
`src/openapi`), `assets`, `node_modules`, `dist`, `types`, `.cern` and
`previous`. A program outside the toolbox is "command not found"; an
interpreter or a network tool named by absolute path is unreadable,
which is unrunnable; a command the sandbox blocks fails inside the
shell with the operating system's own words, which reach the coder as
the tool's output and the screen as a failure line. The command line
itself runs as written.

ON WINDOWS the toolbox and the policy are the fence: when the machine
names the system `windows`, the turn carries no sandbox; the vendor's
`Bash` tool is allowed and narrated as the shell is above, running
over the toolbox's own `bash` (the vendor is told where it is through
`CLAUDE_CODE_GIT_BASH_PATH` in its environment, whose value is the
toolbox's `PATH` value, the very text the machine answered, joined
with `bash.exe`; on Windows this agent's `toolbox` folder is the root
above that value), with the same refusal of `run_in_background`; the
vendor's `PowerShell` tool is denied with `use the Bash tool: the
shell here is bash, and PowerShell has the network and the system
compiled in`; and a shell command whose words name a program or a
file outside the workspaces and the toolbox is refused with `the shell
reaches the workspace and the toolbox alone here: <the word>`, the
command narrated as refused. Such a word is a path spelled with a
drive, `C:\...` or `C:/...` or bash's `/c/...`, that is outside every
workspace and the toolbox's folder (its real path, compared without
regard to case or the separator's direction); a plain posix path
(`/dev/null`, `/tmp`, `/usr/bin`) is the toolbox root's own and
passes. The words are read for that one rule: the fence is the
toolbox, where a program outside it is "command not found", and the
rule keeps a drive path from reaching around it.

Execution beyond that shell is denied: a sub-agent (`Agent`, `Task`)
with "no sub-agents here: do it in this session, with the shell or
with Glob and Grep", and every other running, scheduling or messaging
tool by name. Web tools are on for sessions; an mcp server's tools
when the session's policy granted that server; `ToolSearch` (the
vendor's own way of loading a tool's definition) is allowed and
narrated with its query; `TodoWrite` is allowed and narrated as the
plan; asking the operator a question is denied (nobody attends a
compile: decide and record the assumption in a comment); anything
else is denied by name.

## Tests

Uses:

- npm:jimp
- npm:pdf-lib

The vendor is provisioned on this plane and must run: name `model`
"opus" at `effort` "medium" on the live one-shot. The attachments the
tests carry are drawn by the tests themselves: a PNG of a few hundred
pixels showing the digits 42 in a large font on white, and a one-page
PDF with the lines `Invoice number: HK-77812` and `Total: 294.53
EUR`. A live one-shot carrying the picture, asked what number it
shows and held to a schema with one number field, answers 42; one
carrying the PDF, asked the invoice number, answers HK-77812. The
shell is proven live as well: a session opened in a scratch workspace
holding one small file, on `model` "sonnet" at `effort` "low", asked
to run `ls` in the shell and to answer with what it printed, ends
`completed` with a final text that names the file. `shellSandbox` is
proven on a scratch workspace: the toolbox it answers is the machine's
toolbox for this agent's own folder under its data folder (its real
path, holding a link named `ls`), listed in `allowRead` and absent
from `allowWrite`.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
