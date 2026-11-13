# Order status

The handler behind both routers, and the tree's statement of what a
handler is: a function that takes a message and answers words, never
a channel. Given who is asking, an email address or a chat handle,
and what they wrote, the desk finds their orders in the shop and
answers the words to send back. It sends nothing itself: the mail
router replies by mail, the chat router posts in chat, one handler
behind both. The spec is `../order-status.cern.md`.

Everything below runs from the `agents/` folder against the dev
plane, on the sandbox shop, with no account.

## 1. Run it

```
$ cernanto deploy examples/workflows/order-status
```

A known customer asking about one of her orders, then about her
latest, then a stranger:

```
$ cernanto call examples/workflows/order-status orderStatus email=lena.fischer@example.com message="Where is my order A-1003?"
{"words":"Your order A-1003 was delivered on 2026-08-14.","foundOrder":true}
$ cernanto call examples/workflows/order-status orderStatus chatHandle=erik message="any news on my order?"
{"words":"Your order A-1011 is placed. It is expected on 2026-09-27.","foundOrder":true}
$ cernanto call examples/workflows/order-status orderStatus email=nobody@example.net message="where is my order?"
{"words":"Sorry, we don't know you in our shop, so we found no orders for you.","foundOrder":false}
```

The trace shows the shop asked for the customer's orders, one
judgment on whether the message names an order and, when it does,
one reading the id, and the sentence composed in code; the shop's
dates are never judged.

## 2. What to read

The whole desk is one function of about a hundred lines: the lookup
by identity, the two judgments, the sentence. The second value in
the answer, whether an order was found, is what the routers read: a
stranger's question is judged again with this handler left out, and
ends with a person.

## The real form

The shop becomes `connectors/postgres` with the same two sentences;
the handler's words do not change, since the routers own the
channels.
