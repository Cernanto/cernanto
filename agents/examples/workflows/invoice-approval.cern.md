# Invoice approval

Uses:

- connectors/email
- connectors/chat
- connectors/frankfurter
- examples/sandbox/purchasing
- file:invoice-approval/approvers.json
- npm:pdf-parse
- cernanto/config
- cernanto/decision
- cernanto/llm

Each call handles the next invoice: wait for a vendor's mail with a PDF
attached in the billing mailbox. The billing mailbox is the account the
configuration names under `email`, `billing` when it names
none, on the plane's mail provider, with the sandbox inbox, `examples/sandbox/inbox`, as the fallback when the plane binds none.

Read the invoice out of the document's text. The vendor is the mail's
sender, by name; a sender whose name no vendor has makes the invoice a
mismatch, and an approved mismatch posts nothing to the ledger. A vendor's invoice states `INVOICE <number>`,
`Purchase order: <id>`, `Invoice date: <date>`, `Due date: <date>` and
`Total <currency> <amount>`, and the lines it bills, delivery charges
included, as a text table under the header `Description Qty Unit
Amount`: one row per line, what it is for first, then the quantity,
the unit price and the amount, the columns set apart by runs of
spaces. A total in another currency than the euro is converted at the
rate of the invoice's date.

An invoice whose number the ledger already holds for the vendor is a
duplicate: answer it as one, and post nothing.

Find the purchase order and its goods receipts. The invoice matches
when the purchase order exists and is the vendor's, every invoiced line
is one of the order's lines, by what it is for, with a quantity within
what the receipts hold for that line, and the total is within the
tolerance the approver table states of the purchase order's total. A
match is posted to the ledger.

A mismatch gets a one-paragraph explanation of what differs and, when
the order exists, a judgment on whether the invoice's lines describe
the same goods as the order's, both at the same time. It goes to the
approver the approver table names for the amount, on chat, with the
explanation. Wait for the approver's answer,
their next message in that conversation whether under the question or
beside it, within the approval window: the minutes given with the
request, else the minutes the configuration names under
`approval-window-minutes`, else two days; a message that neither
approves nor rejects is no answer, and the wait goes on. When the window
passes, remind the approver once; when it passes again, escalate to the
controller the table names and stop waiting. An approved invoice is
posted to the ledger; a rejected one is not. Post on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none.

Answer what happened to the invoice: matched, approved, rejected,
escalated or duplicate, with the invoice as read, its lines included,
the explanation when there was a mismatch, and the ledger entry when
one was posted.

Decisions are made with cernanto/decision.

## Tests

Uses:

- examples/sandbox/inbox
- examples/sandbox/chat
- examples/sandbox/purchasing
- connectors/frankfurter
- cernanto/config
- npm:pdf-lib

Build each case's invoice as a PDF from the case's numbers, in the
layout the specification states, and deliver it into the inbox's
billing mailbox as the vendor's mail, for a purchase order the
purchasing store already holds, with the vendor that order names as
the sender, by name. Answer the
approver's question through the chat as the approver would: every order
in the store is above a thousand euros, so a mismatching invoice that
bills part of an order keeps its total under a thousand and goes to
Rami, who answers in the conversation `@rami`. The approval window is
given with the request, a quarter of a minute. A call's wait on the
mailbox is open within a second, so
a mail delivered a second after the call is picked up.

Prove four roads, in about a minute: an invoice in pounds that matches
its order posts once, its euro total the pound total at the rate of its
date, a mail delivered to the default mailbox beforehand is never
picked up, and the same invoice delivered again is a duplicate that
posts nothing; an invoice priced above the order past the tolerance
parks for Rami and posts after he approves; an invoice billing more of
a line than was received is a mismatch that posts nothing when Rami
rejects it; an invoice naming an order the store does not hold is a
mismatch that reaches Rami with its explanation and posts nothing when
he rejects it.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
