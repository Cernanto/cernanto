# Mail router

Uses:

- connectors/email
- connectors/chat
- examples/workflows/refund-desk
- examples/workflows/helpdesk
- examples/workflows/order-status
- examples/sandbox/orders
- cernanto/config
- cernanto/decision
- cernanto/llm

Given a mail from the company's mailbox, send it where it belongs and
answer where it went. Two rules come first, then one judgment, and no
judgment when a rule decided:

- A mail that is for another agent, a reply to one a desk sent or a
  mail from someone a desk wrote to, is that desk's: leave it alone.
- A mail with a PDF attached is a vendor's invoice: forward it, with
  its attachments, to the billing mailbox, where the invoice desk
  picks it up.
- Otherwise judge once what the mail asks for. A customer asking for
  a refund, a return or an exchange goes to the refund desk, with the
  order found in the shop by the sender's address, the one they name
  or their latest; reply to the mail with the desk's reply. A customer
  asking about an order gets the order-status handler's words as a
  reply. A question the company's handbook might answer, about the
  company, its products or how things are done here, gets the
  helpdesk's answer as a reply. Anything else goes to a person: post
  the sender and the subject to the triage channel.

A handler that has nothing for the mail, the helpdesk that cannot
answer it or the shop that does not know the sender or the order they
ask about, sends the mail to
be judged again with that handler left out, once; with nothing left,
it goes to a person as above.

Answer where the mail went: left alone, forwarded, which desk replied,
or a person.

Read and reply on the plane's mail provider, with the sandbox inbox, `examples/sandbox/inbox`, as the fallback when the plane binds none, as the
account the configuration names under `account`, the
default account when it names none. The billing mailbox's address is
the one the configuration names under `billing-address`,
`billing@acmeledgers.example` when it names none. Post on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none; the triage channel is
`#triage` unless the configuration names another under
`triage-channel`.

Decisions are made with cernanto/decision.

## Tests

Uses:

- examples/sandbox/inbox
- examples/sandbox/chat
- examples/sandbox/orders

Deliver one mail of each kind into the sandbox inbox the way the
outside world would, hand it to the router, and prove where it went:
the invoice forwarded into the billing mailbox with its PDF, the
refund desk's reply received by the customer, the order's status and
the helpdesk's answer received as replies, the triage post on the
channel, and a reply to a mail another agent sent left untouched. The
handbook covers holidays and time off, expenses, security, the tools
and the office; a question it answers asks about those.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
