# Chat router

The front desk of the team chat: a desk worker follows the help
channel and hands every message that addresses the account to the
router, which sends it where it belongs. An order's status is
answered at once through the order-status handler; a refund, a return
or an exchange goes to the refund desk and the thread follows it
from then on; a question the handbook answers goes to the helpdesk;
anything else goes to a person on the triage channel. One judgment
per conversation, and none once a conversation follows a desk. The
spec is `../chat-router.cern.md`, the worker `desk.cern.md` beside
this file.

At launch this is the internal team's router: it follows Slack when
`connectors/chat/default` names `connectors/slack`, and reaches a solo
operator's customers when a customer chat connector exists. Until
then the sandbox chat plays the workspace.

Everything below runs from the `agents/` folder against the dev
plane, on the sandbox, with no account.

## 1. Run it

Deploying the desk alone lands the router, the three handlers and the
shop beneath it, in dependency order, and starts the desk on `#help`:

```
$ cernanto deploy examples/workflows/chat-router/desk
```

A customer asks about an order; the answer comes under her message
within seconds:

```
$ cernanto call examples/sandbox/chat post from=lena chat="#help" text="@acme where is my order A-1003?"
"m61"
$ cernanto call examples/sandbox/chat read chat="#help"
[... {"id":"m61","from":{"id":"@lena","name":"lena"},"text":"@acme where is my order A-1003?", ...},
     {"id":"m62","thread":"m61","from":{"id":"@acme","name":"acme"},"text":"Your order A-1003 was delivered on 2026-08-14.", ...}]
```

A refund request reaches the refund desk, which answers under the
policy, and the thread follows the refund desk from then on: the next
line the customer writes under it, mention or not, goes to the same
desk with the conversation so far, with no new judgment:

```
$ cernanto call examples/sandbox/chat post from=lena chat="#help" text="@acme I'd like to return order A-1001, it is unused"
"m97"
$ cernanto call examples/sandbox/chat post from=lena chat="#help" thread=m97 text="it arrived with a cracked cover, does that change anything?"
"m99"
```

The customer's lines go in by `post`, a person's own message; `send`
is the account's own, asked for by whoever calls it, and a thread it
starts belongs to that caller. A question the handbook
answers goes to the helpdesk, and a stranger's order question, one
the shop cannot place, ends with a person on `#triage`:

```
$ cernanto call examples/sandbox/chat post from=lena chat="#help" text="@acme I'd like to return order A-1001, it is unused"
$ cernanto call examples/sandbox/chat post from=noa chat="#help" text="@acme how many days of leave do I get a year?"
$ cernanto call examples/sandbox/chat post from=zed chat="#help" text="@acme where is my order?"
$ cernanto call examples/sandbox/chat read chat="#help"
[... {"thread":"m97","from":{"name":"acme"},"text":"Dear Lena Fischer,\n\nThank you for writing to us about order A-1001.\n\nWe're unable to offer a refund, as our policy allows refunds within thirty days of delivery ..."},
     {"thread":"m100","from":{"name":"acme"},"text":"You get 25 days a year, taken in whole or half days, booked in the calendar and approved by your manager."},
     {"thread":"m70","from":{"name":"acme"},"text":"A person will follow up with you."}]
$ cernanto call examples/sandbox/chat read chat="#triage"
[... {"from":{"name":"acme"},"text":"zed asked: @acme where is my order?"}]
```

`cernanto trace examples/workflows/chat-router` reads the last routing as a
conversation: the message, the conversation so far read from the
chat, the one judgment with its classes, the handler's call and its
answer, the post.

## 2. The settings

The desk reads its settings when it starts: the conversations it
follows are `examples/workflows/chat-router/desk/channels` (`#help` when unset), the chat
provider `connectors/chat/default`, the triage channel
`examples/workflows/chat-router/triage-channel` (`#triage`), the idle window
`examples/workflows/chat-router/idle-minutes` (and the desk's `examples/workflows/chat-router/desk/idle-minutes`) (sixty). `cernanto deploy
examples/workflows/chat-router/desk` after a change runs the router again. To put the router on
`#support` in the helpdesk bot's place:

```
$ cernanto config examples/workflows/chat-router/desk channels='["#support","#help"]'
$ cernanto delete examples/workflows/helpdesk/bot
$ cernanto deploy examples/workflows/chat-router/desk
```

## 3. Grow it

Add a handler: one `Uses:` line and one sentence in the router's
spec, say `examples/workflows/renewal-desk` and "a mail from the insurer goes
to the renewal desk". Change the default: the last sentence of the
routing paragraph. Deploy the desk again; the amend keeps the rest.

## The real form

Set `connectors/chat/default` to `connectors/slack` and restart the desk; the
router is not recompiled. The shop becomes `connectors/postgres` behind
the order-status handler and the refund desk.
