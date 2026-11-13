# Helpdesk

The assistant in your chat, grounded in your files. Two agents: the
task `examples/workflows/helpdesk` answers a question from the handbook under
`docs/` and names the page, or says the handbook does not answer it;
the worker `examples/workflows/helpdesk/bot` follows the support channel,
answers every message that addresses it through the task, and when the
task cannot, tells the asker a person will follow up and posts the
question to the support leads. The task carries the tests; a worker
carries none, its trace is the proof.

Deploy the top and the task comes with it:

```
$ cernanto deploy examples/workflows/helpdesk/bot
```

Ask as a person in the channel; the bot answers under your message:

```
$ cernanto call examples/sandbox/chat send account=noa chat="#support" text="@acme how many days of leave do I get a year?"
{"delivered":true,"id":"m15"}
$ cernanto call examples/sandbox/chat send account=noa chat="#support" text="@acme what is the wifi password in the Berlin office?"
{"delivered":true,"id":"m16"}
$ cernanto call examples/sandbox/chat read chat="#support"
[... {"from":{"id":"@noa"},"text":"@acme how many days of leave do I get a year?"},
     {"from":{"id":"@acme"},"thread":"m8","text":"You get 25 days of leave a year, taken in whole or half days, booked in the calendar and approved by your manager.\n\n(Source: holidays.md)"},
     {"from":{"id":"@noa"},"text":"@acme what is the wifi password in the Berlin office?"},
     {"from":{"id":"@acme"},"thread":"m10","text":"The handbook doesn't answer this question; a person will follow up with you."}]
$ cernanto call examples/sandbox/chat read chat="#triage"
[... {"from":{"id":"@acme"},"text":"Unanswered question from noa in #support:\n@acme what is the wifi password in the Berlin office?"}]
```

The bot's trace shows a worker on a feed rather than a clock: the
configuration read once, then a wait for the next message that
addresses it, the answer, and the next wait from the cursor of the last
message handled, so nothing that arrived while it answered is missed
(`-f` follows the running bot live):

```
$ cernanto trace examples/workflows/helpdesk/bot
Bot · Run  running  examples_workflows_helpdesk_bot:20223:k-worker=...
12:55:02  ← Run
12:55:02  → Config   Get
12:55:02  ← Config   Done
12:55:02  → Config   Get
12:55:02  ← Config   Done
12:55:02  → Config   Get
12:55:02  ← Config   Done
12:55:02  → Chat     Wait for message   Chat: #support   Mentioned: true
12:55:19  ← Chat  16.9s
            Id: m8 ... Text: @acme how many days of leave do I get a year?   Mentions Me: true
...
```

The task alone:

```
$ cernanto call examples/workflows/helpdesk ask question="Who approves an expense above five thousand euros?"
```

## Make it yours

The helpdesk is the task's spec, its folder (`docs/`, the bot's spec
`bot.cern.md` with its package under `.cern/`, this README) and the
task's package under `examples/workflows/.cern/`. Copy them into a workspace of
your own, keeping the `examples/workflows/` path, and deploy the top from
there; both land as they are.

<!-- lab exercise -->

```
$ mkdir -p ../my-agents/examples/workflows/.cern
$ cp examples/workflows/helpdesk.cern.md ../my-agents/examples/workflows/
$ cp -R examples/workflows/helpdesk ../my-agents/examples/workflows/
$ cp examples/workflows/.cern/helpdesk.cern ../my-agents/examples/workflows/.cern/
$ (cd ../my-agents && cernanto deploy examples/workflows/helpdesk/bot)
landed 2 packages; nothing to compile
```

The id is the path, so the copy deploys the same agent your plane
already runs; a second desk beside it is the spec under another name
(the file and, for its `file:` grants, its folder), a fresh compile under
the new id, and `cernanto delete <id>` retires the old one.

- **The data.** Your handbook goes under `docs/`, markdown pages; deploy,
  and the specs do not change.
- **The settings.** The channel the bot follows is `examples/workflows/helpdesk/bot/channel`,
  the leads' channel `examples/workflows/helpdesk/bot/leads-channel`, the chat provider
  `connectors/chat/default`; the bot reads them when it starts, so
  `cernanto deploy examples/workflows/helpdesk/bot` after a change runs it again.
- **The policy.** The task's sentences. Keep the answers short, and
  deploy the task alone: the bot is unchanged and its next question
  reaches the new version.

<!-- lab edit ../my-agents/examples/workflows/helpdesk.cern.md
the answer from those pages with cernanto/llm and name that page.
=>
the answer from those pages with cernanto/llm, in at most two
sentences, and name that page.
-->

```
$ (cd ../my-agents && cernanto deploy examples/workflows/helpdesk)
$ cernanto call examples/workflows/helpdesk ask question="How do I book leave?"
{"answered":true,"answer":"Book it in the calendar, in whole or half days, and your manager approves it.","page":"holidays.md"}
```

- **Your application.** The bot is the road for people in the chat;
  a system asks the task through the plane's gateway, one function and
  one JSON argument, as the support desk's recipe shows:

<!-- lab exercise -->

```
$ curl -s -X POST "http://127.0.0.1:7434/v1/agents/examples%2Fworkflows%2Fhelpdesk/invoke/ask" \
    -H 'content-type: application/json' -d '{"args":{"question":"Who approves an expense above five thousand euros?"}}'
{"result":{"answered":true,"answer":"Dana Swope, the finance lead.","page":"expenses.md"},"callId":"examples_workflows_helpdesk:20027:c-..."}
```

Replace `docs/` with your own handbook and deploy; nothing in the
specs changes.

## The real form

The bot follows whatever provider `connectors/chat/default` names, so Slack is
three settings and a restart, with no recompile:

```
$ cernanto config connectors/chat default=connectors/slack
$ cernanto config examples/workflows/helpdesk/bot channel=C0123ABCDEF
$ cernanto config examples/workflows/helpdesk/bot leads-channel=C0456GHIJKL
$ cernanto deploy examples/workflows/helpdesk/bot
$ cernanto trace examples/workflows/helpdesk/bot -f
```

The channel ids are Slack's (`C…`, from a channel's details), and the
app must be invited to both. The bot's first wait parks on the Slack
connector's ask for its account, the bot token and the signing secret
of a Slack app the ask tells you how to create; log it in from another
terminal and the wait goes on:

```
$ cernanto auth login connectors/slack
```

Ask in the channel with `@<the app's name>` and the answer arrives
under your message, from the handbook under `docs/`. The app's steps
are in `connectors/slack/README.md`.

The chat router (`../chat-router/README.md`) does the bot's job and
more: it answers through the helpdesk, sends refunds to the refund
desk and order questions to the order-status handler, and hands the
rest to a person. One configuration line puts it on `#support` in the
bot's place:

```
$ cernanto config examples/workflows/chat-router/desk channels='["#support"]'
$ cernanto delete examples/workflows/helpdesk/bot
$ cernanto deploy examples/workflows/chat-router/desk
```
