# Renewal desk

Uses:

- examples/sandbox/crm
- connectors/email
- connectors/chat
- cernanto/config
- cernanto/decision
- cernanto/llm

Given the id of a contract nearing its end, renew it by mail. Read the
contract from the CRM: the company, its contact, the value, the end
date, the target price and the owner. Mail the contact asking for a
renewal quote for the coming year, and wait for their answer, a reply
in the thread or a fresh mail from their address, for up to the reply
window. Read the quoted price out of the answer; a reply that neither quotes
a price nor refuses is not the answer, and the wait goes on within the
window. A quote at or below
the target is accepted: reply to say so, and the contract is renewed
at that price. A quote above the target gets one counter: reply asking
for the target price and wait again for up to the reply window; a
second quote at or below the target renews the contract at it, and
one still above it, or a refusal, declines the renewal. No answer
within a window is no answer. Record the outcome on the contract,
renewed at the price, declined, or no answer; tell the contract's
owner on the renewals channel; and answer the outcome, with the price
when there is one.

Also answer, when asked, the contracts due for renewal: those ending
within the days asked for, else within the notice days, soonest
first.

The reply window is the minutes given with the request, else the
minutes the configuration names under `reply-window-minutes`,
else a week. The notice days are the ones the configuration names
under `notice-days`, thirty when it names none. Mail on the plane's mail provider, with the sandbox inbox, `examples/sandbox/inbox`, as the fallback when the plane binds none. Post on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none; the renewals channel is `#renewals` unless the configuration names another
under `channel`.

Decisions are made with cernanto/decision.

## Tests

Uses:

- examples/sandbox/inbox
- examples/sandbox/chat

Play the provider through the sandbox inbox: answer the quote request
above the target and, asked for the target, at it, so the contract is
renewed at the target; on a second contract answer above the target
twice, so the renewal is declined; on a third never answer, so the
outcome is no answer. The reply window the tests give with the request
is a minute. The seeded contracts carry their targets and end over
the coming months: ask for the ones due within two hundred days and
play three of them.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
