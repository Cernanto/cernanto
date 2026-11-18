# Stripe

Uses:

- cernanto/auth
- cernanto/webhook
- npm:stripe@^22

A Stripe sandbox, the account's test environment, reached with a
restricted key that may write payment intents, charges, refunds and
webhook endpoints and read invoices and events. The account is that
key, asked for on the first call under the provider `stripe.com`;
nothing else is pasted, because this agent registers a webhook
endpoint of its own at its own url for the payment and refund events,
keeps it registered, and believes a delivery only after checking it
against that endpoint's signing secret.

Refund a payment, given the payment's id, the id of the order it
settles and optionally an amount in the currency's smallest unit (the
whole payment when none is given): the order id is the key, so the
same order is refunded once however often it is asked within the day
Stripe keeps the key, and an ask under that order id with another
payment or amount is refused; the answer
is the refund's id, amount, currency and status; a payment that cannot
be refunded is a normal answer, refused, with Stripe's reason. Answer
a payment's status by its id, and an invoice's status by its id. Wait
for the next payment event, a payment that succeeded, a payment that
failed or a refund made, after the call began or after the event named
as the position, and answer its id, its kind, the payment's id, the
amount and the currency, or null when the timeout passes, five minutes
when none is given.

## Tests

Uses: cernanto/config

The payment the tests refund is the test-mode payment the tests read
from the configuration under `payment`, by one unit of its
currency under a fresh order id each run, and a refund asked twice
under one order id answers the same refund; a wait started before the
refund answers the refund's event.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
