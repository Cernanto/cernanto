# Order status

Uses:

- examples/sandbox/orders
- cernanto/decision
- cernanto/llm

Given who is asking, their email address or their chat handle, and
what they wrote, answer the words to send back about their order. Find
their orders in the shop by that identity. Decide whether what they
wrote names an order: when it does, read the one they name, as they
wrote it, and when it names none, take their latest. Answer the
order's status and, until it is delivered, the day it is expected, in
a sentence a customer can read. When the shop does not know them, or
they name an order that is not theirs, say so in the same plain words.
Send nothing: whoever asked you sends the words, by mail or in chat.
Answer the words, and whether they are about an order the shop found.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
