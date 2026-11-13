# Orders

Type: service

Uses:

- file:orders/data/orders.csv
- file:orders/data/invoices.csv

The shop's orders and payments, seeded from the granted files. Answer
an order by its id, with its customer, its items, its dates, its status
and its payment, and, until it is delivered, the day it is expected,
five days after it was placed; and an order's invoice, issued the day
the order is placed, due fourteen days later and paid at once when the
card pays. Answer a
customer's orders, latest first, by their email address or by their
chat handle, the person's name in the chat, given with or without its
leading `@` and matched in any letter case; a customer the shop does
not know has none. Answer the
orders placed between two dates, both dates included, newest first. Take a new order: the
customer's name and email, optionally their chat handle, the items,
the total and the last four digits of the card; a card ending in 0000
fails its payment and the order joins the exceptions queue, any other
card pays; answer the new order. Answer the exceptions queue, the
orders whose payment failed, and release an order from it when told
to, which takes it out of the queue and changes nothing else. Charge a failed payment again when asked: it succeeds the second
time, the invoice is paid that day and the order leaves the queue. Mark an order delivered on a
given date when told to. Wait for the next failed payment, for as long
as it takes, and answer its order. Refund an order by its id for an
amount, at most what it paid; asked again for the same order, answer
the refund already made instead of making another, whatever amount
the second ask names. Answer a refund
with its id, its order and its amount.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
