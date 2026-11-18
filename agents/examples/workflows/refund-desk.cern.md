# Refund desk

Uses:

- examples/sandbox/orders
- cernanto/decision
- cernanto/llm
- file:refund-desk/reply.md
- connectors/chat
- cernanto/config

Implements:

- openapi:refund-desk/openapi.yaml

Serve the storefront's refund requests as the API document describes,
over http on port 8085. Given an order id and the customer's message,
fetch the order and, at the same time, decide what the customer asks
for, a return, a refund, an exchange or something else, and whether
they say the item is unused. A return is a refund request.
The policy: a refund is made within thirty days of delivery, for an
item the customer says is unused, for the amount the order paid; an
order not yet delivered, one that paid nothing, and a request that does
not say the item is unused are outside it. Inside the policy, refund
the order, once however many times the request comes, and answer a
reply drafted on the template. Outside the policy, refuse with the
policy's own reason in the reply. When the request is unsettled (an
exchange, a complaint, or a case the policy does not cover), send the
case to a person on the support channel, `#support` unless the
configuration names another under `channel`, and answer a reply saying
a person will follow up. Post on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none.

## Tests

Uses:

- examples/sandbox/orders

The same request sent twice refunds once. A refund asked for an item
the customer says was used, on a recent order, is refused for that
reason.
Each test case is set up in the shop: place the order and mark it
delivered on the date the case needs, within thirty days for a request
the policy covers and earlier for one it does not.
Prove the four roads: a refund inside the policy, a refusal for an
order delivered too long ago, a refusal for a used item, and an
exchange that goes to a person.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
