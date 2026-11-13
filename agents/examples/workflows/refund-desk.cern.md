# Refund desk

Serve the storefront's refund requests as the API document
refund-desk/openapi.yaml describes, over http on port 8085. Given an order id and the
customer's message, fetch the order from examples/sandbox/orders and, at the
same time, decide with cernanto/decision what the customer asks for, a return,
a refund, an exchange or something else, and whether they say the item
is unused. A return is a refund request.
The policy: a refund is made within thirty days of delivery, for an
item the customer says is unused, for the amount the order paid; an
order not yet delivered, one that paid nothing, and a request that does
not say the item is unused are outside it. Inside
the policy, refund the order, once however many times the request
comes, and answer a reply drafted with cernanto/llm on the template refund-desk/reply.md. Outside the policy,
refuse with the policy's own reason in the reply. When the request is unsettled (an exchange, a
complaint, or a case the policy does not cover), send the case to a
person through connectors/chat on the support channel, `#support`
unless cernanto/config names another under `channel`, and
answer a reply saying a person will follow up. Post on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none.

Decisions are made with cernanto/decision.

Uses:

- examples/sandbox/orders
- cernanto/decision
- cernanto/llm
- file:refund-desk/reply.md
- connectors/chat
- cernanto/config

Implements:

- openapi:refund-desk/openapi.yaml

## Tests

Uses:

- examples/sandbox/orders

Inside the policy, refund the order, once however many times the request comes, and answer a reply drafted with cernanto/llm on the template refund-desk/reply.md; the same request sent twice in a test refunds once.
Outside the policy, refuse with the policy's own reason in the reply; a test asks for a refund of an item the customer says was used, on a recent order, and is refused for that reason.
Each test case is set up in the shop with examples/sandbox/orders: place the order and mark it delivered on the date the case needs, within thirty days for a request the policy covers and earlier for one it does not.
Prove the four roads: a refund inside the policy, a refusal for an order delivered too long ago, a refusal for a used item, and an exchange that goes to a person.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
