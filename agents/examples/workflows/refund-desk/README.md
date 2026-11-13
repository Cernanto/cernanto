# Refund desk

Tier-one handling of return and refund requests under a written
policy, and the tree's OpenAPI server: the storefront posts the order
id and the customer's message to the desk's document, and gets the
decision and the reply to send. The policy is code, the words come
from the template `reply.md`, and two judgments read the customer's
message: what they ask for, and whether they say the item is unused.

The spec is `../refund-desk.cern.md`; the document it implements is
`openapi.yaml` beside this file, which the desk serves itself on port 8085.

```
$ cernanto deploy examples/workflows/refund-desk
```

Inside the policy (delivered within thirty days, unused): a refund,
made once however many times the same request arrives. The shop's
seeded orders age out of the window, so place one delivered three
days ago:

```
$ ORDER=$(cernanto call examples/sandbox/orders placeOrder --args '{"customerName":"Jonas Berg","customerEmail":"jonas.berg@example.org","items":[{"name":"Ledger notebook","quantity":3}],"total":87,"cardLastFour":"4242"}' -q | sed -E 's/^\{"id":"([^"]+)".*/\1/')
$ DELIVERED=$(node -e 'console.log(new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10))')
$ cernanto call examples/sandbox/orders markDelivered orderId="$ORDER" deliveredAt="$DELIVERED" -q > /dev/null
$ curl -s -X POST -H 'content-type: application/json' -d "{\"orderId\":\"$ORDER\",\"message\":\"The notebooks arrived but I ordered the wrong size. They are unused, still in the box. Could I get a refund?\"}" http://127.0.0.1:8085/refund-requests
{"decision":"refunded","reply":"Dear Jonas Berg,\n\nThank you for writing to us about order A-1021.\n\nWe have refunded you €87 under our policy, as the notebooks were returned unused and in their original box..."}
```

Outside it: a refusal with the policy's reason.

```
$ curl -s -X POST -H 'content-type: application/json' \
    -d '{"orderId":"A-1001","message":"I would like to return the notebooks, unused, for a refund."}' \
    http://127.0.0.1:8085/refund-requests
{"decision":"refused","reply":"Dear Lena Fischer,\n\nThank you for writing to us about order A-1001.\n\nWe are unable to issue a refund for this order, as our policy allows refunds only within thirty days of delivery, and your order was delivered 83 days ago on 2026-07-06.\n\nKind regards,\nAcme Ledgers support"}
```

Unsettled (an exchange): a person on the support channel, and a
reply that says so.

```
$ curl -s -X POST -H 'content-type: application/json' \
    -d '{"orderId":"A-1008","message":"One of the two pens leaks. Can you exchange it?"}' \
    http://127.0.0.1:8085/refund-requests
{"decision":"escalated","reply":"Dear Jonas Berg,\n\nThank you for writing to us about order A-1008.\n\nAs your request involves an exchange, we have escalated your case to a colleague, who will be in touch within one working day.\n\nKind regards,\nAcme Ledgers support"}
$ cernanto call examples/sandbox/chat read chat="#support"
[... {"from":{"id":"@acme"},"text":"Refund desk: order A-1008 (Jonas Berg, jonas.berg@example.org) needs a person, because the customer asks for an exchange. The customer wrote: \"One of the two pens leaks. Can you exchange it?\""}]
```

An unknown order is the document's 404:

```
$ curl -s -X POST -H 'content-type: application/json' -d '{"orderId":"A-9999","message":"refund please"}' http://127.0.0.1:8085/refund-requests
{"error":{"kind":"terminal","message":"no order with id A-9999"}}
```

The same function serves the wire: `cernanto call examples/workflows/refund-desk
submitRefundRequest --args '{"body":{"orderId":"A-1012","message":"..."}}'`
answers the same, with the same refund id, because a refund is keyed
by its order. The desk's tests set each case up in the shop (an order
placed and marked delivered on the date the case needs) and prove the
four roads. `cernanto tests examples/workflows/refund-desk` shows them.

## Make it yours

The desk is the spec, its folder (`openapi.yaml`, `reply.md`, this
README) and the package under `examples/workflows/.cern/`. Copy them into a
workspace of your own, keeping the `examples/workflows/` path, and deploy from
there: the package lands as it is, and the desk serves the document on
the same port.

<!-- lab exercise -->

```
$ mkdir -p ../my-agents/examples/workflows/.cern
$ cp examples/workflows/refund-desk.cern.md ../my-agents/examples/workflows/
$ cp -R examples/workflows/refund-desk ../my-agents/examples/workflows/
$ cp examples/workflows/.cern/refund-desk.cern ../my-agents/examples/workflows/.cern/
$ (cd ../my-agents && cernanto deploy examples/workflows/refund-desk)
landed 1 package; nothing to compile
```

The id is the path, so the copy deploys the same agent your plane
already runs; a second desk beside it is the spec under another name
(the file and, for the files it names, its folder), a fresh compile under
the new id, and `cernanto delete <id>` retires the old one.

- **The words and the document.** `reply.md` is the template every
  reply is drafted on; `openapi.yaml` is the API your storefront calls,
  and the spec implements whatever it says.
- **The settings.** The channel a person is told on is
  `examples/workflows/refund-desk/channel`, the chat provider `connectors/chat/default`.
- **The policy.** The sentences of the spec. Sixty days instead of
  thirty: place a fresh order in the shop, delivered forty-five days
  ago, and ask twice, before and after the change.

<!-- lab exercise -->

```
$ ORDER=$(cernanto call examples/sandbox/orders placeOrder --args '{"customerName":"Mara Voss","customerEmail":"mara.voss@example.net","items":[{"name":"Desk pad (blue)","quantity":1}],"total":29,"cardLastFour":"4242"}' -q | sed -E 's/^\{"id":"([^"]+)".*/\1/')
$ DELIVERED=$(node -e 'console.log(new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10))')
$ cernanto call examples/sandbox/orders markDelivered orderId="$ORDER" deliveredAt="$DELIVERED" -q > /dev/null
$ curl -s -X POST -H 'content-type: application/json' -d "{\"orderId\":\"$ORDER\",\"message\":\"The desk pad is unused, still in its wrap. Could I get a refund?\"}" http://127.0.0.1:8085/refund-requests
{"decision":"refused","reply":"Dear Mara Voss,\n\nThank you for writing to us about order A-1021.\n\nWe are unable to issue a refund for this order, as our policy allows refunds within thirty days of delivery..."}
```

<!-- lab edit ../my-agents/examples/workflows/refund-desk.cern.md
The policy: a refund is made within thirty days of delivery, for an
item the customer says is unused,
=>
The policy: a refund is made within sixty days of delivery, for an
item the customer says is unused,
-->

```
$ (cd ../my-agents && cernanto deploy examples/workflows/refund-desk)
$ curl -s -X POST -H 'content-type: application/json' -d "{\"orderId\":\"$ORDER\",\"message\":\"The desk pad is unused, still in its wrap. Could I get a refund?\"}" http://127.0.0.1:8085/refund-requests
{"decision":"refunded","reply":"Dear Mara Voss,\n\nThank you for writing to us about order A-1021.\n\nWe have refunded you €29 under our policy..."}
```

- **Your application** is the storefront, and the document is its
  road: it posts to the mount as the calls above do.

## The real form

The refund goes to Stripe and the orders live in a database; the chat
is a setting, `connectors/chat/default`, as the support desk's README shows.

**The orders.** `orders.sql` beside this README holds the shop's
tables, the orders with the payment each paid with, their invoices and
the refunds made, seeded with the sandbox's rows. Load it into a free
Neon or Supabase database; in the real world the `payment_id` column
holds the Stripe payment the order paid with, a test-mode payment
intent id (`pi_…`), in place of the sandbox's placeholders:

```
$ psql "$DATABASE_URL" -f examples/workflows/refund-desk/orders.sql
```

**The refund.** The desk refunds the order's payment through Stripe
with the order id as the key, so the same order is refunded once
however often the storefront asks, and records the refund on the
order. The spec changes where it names them: the database in the
sentence that fetches the order, Stripe in the sentence that refunds
it.

```diff
-customer's message, fetch the order from examples/sandbox/orders and, at the
-same time, decide with cernanto/decision what the customer asks for, a return,
+customer's message, fetch the order with connectors/postgres from the
+shop's database, whose tables the file refund-desk/orders.sql
+describes, and, at the same time, decide with cernanto/decision what the
+customer asks for, a return,
```

```diff
 item the customer says is unused, for the amount the order paid. Inside
-the policy, refund the order, once however many times the request
-comes, and answer a reply drafted on the template refund-desk/reply.md;
-the same request sent twice in a test refunds once. Outside the policy,
+the policy, refund the order's payment with connectors/stripe, once
+however many times the request comes, record the refund on the order,
+and answer a reply drafted on the template refund-desk/reply.md; the
+same request sent twice in a test refunds once, and the refund is on
+the order. Outside the policy,
```

The tests set each case up in the database instead of the shop, paid
with the test-mode payment the configuration names under
`connectors/stripe/tests/payment`, and keep the amounts to a few cents so that
payment lasts:

```diff
-Each test case is set up in the shop with examples/sandbox/orders: place the
-order and mark it delivered on the date the case needs, within thirty
-days for a request the policy covers and earlier for one it does not.
+Each test case is set up in the database with connectors/postgres:
+insert the order, a few cents in total and paid with the test-mode
+payment that cernanto/config names under `connectors/stripe/tests/payment`,
+delivered on the date the case needs, within thirty days for a request
+the policy covers and earlier for one it does not.
```

The compile prints what it read from the changed sentences:

```
examples/workflows/refund-desk  plan  reads Uses: connectors/postgres, file:refund-desk/orders.sql, cernanto/decision, cernanto/llm, connectors/stripe, file:refund-desk/reply.md, connectors/chat, cernanto/config
examples/workflows/refund-desk  plan  reads Implements: openapi:refund-desk/openapi.yaml
examples/workflows/refund-desk  plan  reads the tests; Uses: connectors/postgres, cernanto/config
```

Then `cernanto deploy examples/workflows/refund-desk`: the Stripe key is
asked for on the first refund, the database url on the first read;
the connectors' steps are in `connectors/stripe/README.md` and
`connectors/postgres/README.md`.
