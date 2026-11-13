# Expense desk

Uses:

- connectors/email
- cernanto/config
- cernanto/llm

Each call handles the next expense claim: wait for a mail with a
picture attached in the expenses mailbox. The expenses mailbox is the
account the configuration names under `email`, `expenses`
when it names none, on the plane's mail provider, with the sandbox inbox, `examples/sandbox/inbox`, as the fallback when the plane binds none.

Read the receipt off the picture itself, one reading each: the
merchant, the date of purchase and the total paid. The picture is the
receipt whatever it looks like, a photo or a plain drawing with the
words on it. The policy: an expense is approved when its total is two
hundred euros or less. Reply to the sender: approved, with the
merchant, the date and the total as read; or refused, with the reason.
A mail whose picture yields no merchant, no date or no total (a
picture of something else, a picture with no words) is answered asking
for a readable photo of the receipt.

Answer what happened to the claim: approved, refused or asked again,
with the merchant, the date and the total when they were read.

## Tests

Uses:

- examples/sandbox/inbox
- npm:jimp
- file:expense-desk/receipts/coffee.png

Deliver each case's mail into the inbox's expenses mailbox. The
approved case sends the receipt granted to the tests, a coffee
receipt from Hafen Kaffee dated 12 September 2026 for fourteen euros
ninety, and the reply names the merchant and the total; the other
cases send receipts the tests draw themselves, a picture of a few
hundred pixels with the merchant's name, the date and a `TOTAL` line
in a large font on white: a receipt for four hundred euros is refused
for the amount, and a mail whose picture shows a plain circle and no
words is asked again. About a minute in all. A call's wait on the mailbox is open within a
second, so a mail delivered a second after the call is picked up.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
