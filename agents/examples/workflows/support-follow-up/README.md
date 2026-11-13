# Support follow-up

The entry tutorial: first-line routing of support tickets. Given a
ticket, the desk classifies it, tells the team on its channel, waits
for a person to respond on the ticket, and reminds the team once if
nobody does. The spec is `../support-follow-up.cern.md`; the teams by
category are `teams.json` beside it, a table the code reads and the
prose never repeats.

Everything below runs from the `agents/` folder against the dev
plane, on the sandbox: the CRM holds the tickets, the chat holds the
channels, no account is needed.

## 1. Run it

The response window is two days unless the request says otherwise;
every call below gives a minute:

```
$ cernanto deploy examples/workflows/support-follow-up
```

A seeded ticket, and a person answering on it from a second terminal
a few seconds later; the desk counts the response whether it came
before or after the team was told:

```
$ cernanto call examples/workflows/support-follow-up followUp ticketId=T-7004 responseWindowMinutes:=1
                                                        # parks: the team has been told, the desk waits
$ cernanto call examples/sandbox/crm recordResponse --args '{"ticketId":"T-7004","responder":"rami","message":"Refund of the second charge is on its way, sorry about that."}'
{"ticketId":"T-7004","responder":"rami","message":"Refund of the second charge is on its way, sorry about that.","respondedAt":"2026-09-28T12:39:56.167Z"}
$                                                       # the first terminal answers:
{"category":"billing","team":"Finance","channel":"#finance","outcome":"response"}
```

The same with nobody answering ends after the window with one
reminder on the channel:

```
$ cernanto call examples/workflows/support-follow-up followUp ticketId=T-7003 responseWindowMinutes:=1
{"category":"account access","team":"Support","channel":"#support","outcome":"reminder"}
$ cernanto call examples/sandbox/chat read chat="#support"
[... {"from":{"id":"@acme","name":"acme"},"text":"New account access ticket T-7003 for Support (from piet.devries@example.nl): Cannot log in to the storefront\n\nThe password reset mail never arrives.", ...},
     {"from":{"id":"@acme","name":"acme"},"text":"Reminder: account access ticket T-7003 (Cannot log in to the storefront) has had no response yet.", ...}]
```

The trace reads the whole call as a conversation: the ticket read from
the CRM, the provider looked up in the configuration, one judgment
with its prompt and its answer, the ticket classified, the post, the
wait, the reminder, the answer.

<details>
<summary>the trace of the follow-up</summary>

```
$ cernanto trace examples/workflows/support-follow-up
Support Follow Up · Follow up  ok  1m07s  examples_workflows_support_follow_up:20219:c-d0ddba9b-26d2-46d9-96d4-d83bef20e62c
2026-09-27 12:41:54

12:41:54  ← Gateway
            Follow up
            Ticket Id: T-7003

12:41:54  → Crm
            Get ticket
            Id: T-7003
12:41:54  ← Crm  4ms  examples_sandbox_crm:20214:c-d0ddba9b-26d2-46d9-96d4-d83bef20e62c-1
            Id:              T-7003
            Requester Email: piet.devries@example.nl
            Subject:         Cannot log in to the storefront
            Body:            The password reset mail never arrives.
            ...

12:41:54  → Config
            Get
12:41:54  ← Config  5ms
            Done

12:41:54  → Decision
            Decide which
            Prompt: Which category is this support message about: billing, technical, or account access? ...
            Options:
              - billing
              - technical
              - account access
              - the message does not say which
12:42:01  ← Decision  6.2s
            account access

12:42:01  → Crm
            Classify ticket
            Id:       T-7003
            Category: account access
            Team:     Support
...
```

</details>

The desk's tests, written by the compile from the spec, drive the same
three roads through the sandbox: a ticket answered, a ticket reminded
after the window, a message that names no category sent to triage.
`cernanto tests examples/workflows/support-follow-up` shows them.

## 2. Change a policy sentence

Add a clause to the first paragraph, "tell the team assigned to that
category on its channel, naming the order the message is about when it
names one", and deploy again. The log is an amend against the previous
compile, not a rewrite: the change judged in words, the code amended in
seconds, the tests updated because the promise moved, the live run.

```
$ cernanto deploy examples/workflows/support-follow-up
examples/workflows/support-follow-up  reads a task
compiling ................................
Support Follow Up   examples/workflows/support-follow-up   agent   deployed   verified live in 2m47s, 4 tests
```

The three agents beneath it are current: nothing else in the tree moved.
Take the clause out and deploy once more; the log reads the same way
("the only change is one removed clause"), and the desk is back in two
minutes.

## 3. Switch the provider without regenerating the desk

`cernanto config connectors/chat default=connectors/slack`, then invoke
again: the call parks on the Slack connector's ask for its account, and
the log prints the exact `cernanto auth login connectors/slack`
line; log in from another terminal, with the app's bot token and
signing secret the ask describes, and the parked call resumes, the post
arriving in the real channel. Nothing was recompiled.

## 4. Recompile the same source with another model

`cernanto dev --coder codex`, then `cernanto deploy
examples/workflows/support-follow-up --recompile`: the kept tests run against the
new implementation.

## 5. Interrupt a waiting call

Invoke with the one-minute window, and twenty seconds in kill the
desk's process (its folder is `workflows-support-follow-up` and a
port):

```
$ cernanto call examples/workflows/support-follow-up followUp ticketId=T-7005 responseWindowMinutes:=1 &
$ sleep 20; kill -9 $(lsof -c node 2>/dev/null | awk '$4 == "cwd" && /workflows-support-follow/ {print $2}')
{"category":"technical","team":"Engineering","channel":"#engineering","outcome":"reminder"}
```

On Windows the process is found by the folder on its command line and
ended with the system's own kill, in PowerShell: `taskkill /F /PID
(Get-CimInstance Win32_Process -Filter "Name='node.exe' AND CommandLine
LIKE '%workflows-support-follow%'").ProcessId`.

It answered after 71 seconds, as an uninterrupted run does: the plane
brought the process back, the call resumed from its journal, and the
trace shows the classification asked once (one AI call), the post to
`#engineering` made before the kill and not repeated, and the reminder
on schedule.

## 6. Make it yours

The desk is three files: the spec, its folder (`teams.json`, this
README) and the package beside it under `.cern/`. Copy them into a
workspace of your own, keeping the `examples/workflows/` path (an agent's id is
its path from the workspace root), and deploy from there. The package
lands as it is: nothing it pins has moved, and the agents it uses
(`examples/sandbox/crm`, `connectors/chat`) are already on the plane.

<!-- lab exercise -->

```
$ mkdir -p ../my-agents/examples/workflows/.cern
$ cp examples/workflows/support-follow-up.cern.md ../my-agents/examples/workflows/
$ cp -R examples/workflows/support-follow-up ../my-agents/examples/workflows/
$ cp examples/workflows/.cern/support-follow-up.cern ../my-agents/examples/workflows/.cern/
$ (cd ../my-agents && cernanto deploy examples/workflows/support-follow-up)
landed 1 package; nothing to compile
```

The id is the path, so the copy deploys the same agent your plane
already runs; a second desk beside it is the spec under another name
(the file and, for the files it names, its folder), a fresh compile under
the new id, and `cernanto delete <id>` retires the old one.

Then change what is yours, from the outside in:

- **The data.** The teams and their channels are `teams.json`: edit it
  and deploy; the spec does not change.
- **The settings.** The response window is the `responseWindowMinutes`
  a call gives, else `examples/workflows/support-follow-up/response-window-minutes` in the
  configuration (`cernanto config examples/workflows/support-follow-up response-window-minutes=60`),
  else two days; the chat provider is `connectors/chat/default`; a setting is
  read at each call, no deploy.
- **The policy.** The sentences of the spec. Tell the triage channel
  when a reminder went out, and deploy: an amend, the tests updated
  where the promise moved, two or three minutes.

<!-- lab edit ../my-agents/examples/workflows/support-follow-up.cern.md
window, send the team one reminder on the same channel.
=>
window, send the team one reminder on the same channel and tell the
triage channel that the ticket is still open.
-->

```
$ (cd ../my-agents && cernanto deploy examples/workflows/support-follow-up)
$ cernanto call examples/workflows/support-follow-up followUp ticketId=T-7005 responseWindowMinutes:=1
{"category":"technical","team":"Engineering","channel":"#engineering","outcome":"reminder"}
$ cernanto call examples/sandbox/chat read chat="#triage"
[... {"from":{"id":"@acme"},"text":"Ticket T-7005 is still open: Engineering was reminded on #engineering."}]
```

- **Your application** calls the desk through the plane's gateway, the
  road `cernanto call` takes: one function, one JSON argument,
  the answer and the call's id back. The dev plane answers on
  `127.0.0.1` without a token; a plane on servers wants a bearer from
  `cernanto token create <your app>`.

<!-- lab exercise -->

```
$ curl -s -X POST "http://127.0.0.1:7434/v1/agents/examples%2Fworkflows%2Fsupport-follow-up/invoke/followUp" \
    -H 'content-type: application/json' -d '{"args":{"ticketId":"T-7004"}}'
{"result":{"category":"billing","team":"Finance","channel":"#finance","outcome":"reminder"},"callId":"examples_workflows_support_follow_up:20031:c-6d1f..."}
```

## The real form

Two changes take this desk from the sandbox to Slack and Jira: a
setting and a name.

**The chat is a setting.** The desk posts on the provider
`connectors/chat/default` names, so Slack is one line and no recompile:

```
$ cernanto config connectors/chat default=connectors/slack
```

The next call parks on the Slack connector's ask for its account, the
bot token and the signing secret of a Slack app the ask tells you how
to create; log it in from another terminal and the call goes on:

```
$ cernanto auth login connectors/slack
```

The teams' channels in `teams.json` become Slack channel ids
(`C0123ABCDEF`, from a channel's details); edit the table and deploy,
the spec unchanged. The app must be invited to each channel. The app's
steps are in `connectors/slack/README.md`.

**The tickets are a name in a sentence.** The sandbox CRM holds the
tickets today and Jira holds them in the real form, so the spec
changes one name and the amend adapts the calls behind it: the ticket
by its key, the category and the team recorded as a comment, a
person's response as the next comment by someone other than the desk.

```diff
-Given the id of a new support ticket, read it from examples/sandbox/crm and
+Given the id of a new support ticket, read it from connectors/jira and
 classify its message with cernanto/decision as billing, technical or account
```

The tests move with it, in the paragraph that says how to prove the
desk: the second Jira user opens each ticket and answers as a person,
and the second Slack app reads the team's channel.

```diff
-To prove the desk, open each ticket in examples/sandbox/crm the way a customer
-would and follow the desk through examples/sandbox/chat: the team's channel
-shows the post; a response recorded on the ticket, even one recorded
-before the team was told, ends the wait as a response, with no
-reminder; a ticket nobody responds to brings one reminder on the
-channel after the window, which the tests give with the request, a
-minute; a message that says nothing about billing, technical or
-account access goes to the triage channel. The tests read the
-configuration through cernanto/config.
+To prove the desk, open each ticket with connectors/jira in the
+project that cernanto/config names under `connectors/jira/tests/project`, as the
+second user, the account connected under the name `tester`, and follow
+the desk through connectors/slack: the team's channel, read as the
+second Slack app, the account connected under the name `tester`, shows
+the post; a comment by the second user on the ticket, even one made
+before the team was told, ends the wait as a response, with no
+reminder; a ticket nobody comments on brings one reminder on the
+channel after the window, which the tests give with the request, a
+minute; a message that says nothing about billing, technical or
+account access goes to the triage channel.
```

The compile prints what it read from the changed sentences, the Jira
connector where the CRM was, for the desk and for its tests:

```
examples/workflows/support-follow-up  plan  reads Uses: connectors/jira, cernanto/decision, file:support-follow-up/teams.json, connectors/chat, cernanto/config
examples/workflows/support-follow-up  plan  reads the tests; Uses: connectors/jira, cernanto/config, connectors/slack
```

Then `cernanto deploy examples/workflows/support-follow-up`: the desk is
amended against the Jira connector's contract and verified on the real
site and the real workspace, each account asked for on its first use,
the Jira sign-in in the browser. The connectors' steps are in
`connectors/jira/README.md` and `connectors/slack/README.md`.
