# Chat router

Uses:

- connectors/chat
- examples/workflows/helpdesk
- examples/workflows/refund-desk
- examples/workflows/order-status
- examples/sandbox/orders
- cernanto/config
- cernanto/decision

Route a chat message to the desk that handles it, and answer where it
went. A message comes with its conversation: the chat it is in, the
thread it is under when it has one, who posted it, and, when the
conversation already follows a handler, which one and when it last
spoke. The conversation so far is what that person and the account
posted in that thread, or in that direct message, since it began; read
it from the chat. A channel message under no thread begins a
conversation: nothing came before it, and the replies go under it.

A conversation that already follows a handler stays with it: hand the
message, with the conversation so far, to that handler, post its
answer back under the message, and judge nothing. Otherwise judge
once what the message asks for. An order's status is answered through
the order-status handler at once, the words posted back, and opens no
conversation. A refund, a return or an exchange goes to the refund
desk with the order found in the shop by the sender's chat handle,
the one they name or their latest; post the desk's reply back, and
the conversation follows the refund desk from then on. A question
the company's handbook might answer, about the company, its products
or how things are done here, goes to the helpdesk; post its answer
back, and the conversation follows the helpdesk. Anything else
goes to a person: post who asked and what they wrote to the triage
channel, tell the asker a person will follow up, and the conversation
is done.

A handler that has nothing for the message, the helpdesk answering
that it cannot answer or the order-status handler answering that its
words are about no order the shop found, sends the message to be
judged again with that handler left out, once; with nothing left, it
goes to a person as above. A message in the conversation
from someone other than the person it is with and other than the
account itself, a teammate who stepped in, ends your part: post
nothing and answer that the conversation is done; the account's own
posts are its replies, never a teammate's. A conversation whose last message is older than the idle window
is over: judge the message afresh, as the first of a new conversation.

Answer where the message went, the handler the conversation follows
from now on when it follows one, and whether the conversation is done.

Post on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none. The triage
channel is `#triage` unless the configuration names another under
`triage-channel`; the idle window is the minutes the
configuration names under `idle-minutes`, sixty when it
names none.

Decisions are made with cernanto/decision.

## Tests

Uses:

- examples/sandbox/chat
- examples/sandbox/orders

Play the customer through the sandbox chat as a second person, in a
channel of the tests' own naming, and read the posts back: a handbook
question, how many days of holiday and time off employees get (the
handbook covers holidays and time off, expenses, security, the tools
and the office), in a channel that already holds other people's posts; an order asked for and answered at once, the order
placed in the shop under that person's handle first; an order asked
about by a stranger the shop does not know, judged again and ending
with a person; a refund request that reaches the refund desk and keeps
the thread for the follow-up line, handed back as a conversation that
follows the refund desk; a teammate's message in the thread that ends
the conversation; and a conversation whose last message is older than
the idle window, judged afresh on its next message.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
