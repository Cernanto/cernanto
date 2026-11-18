# Gmail

Implements: connectors/email

Uses:

- connectors/google/client
- npm:googleapis@^182
- cernanto/webhook

A Gmail mailbox on a Google account, the default one or the one named,
signed in through the Google client. Mail arrives by Gmail's push: one
Pub/Sub topic and one push subscription to this agent's own url in the
project of the default account, which the sign-in steps say must own
the project, made by the call that finds them missing, and every
account's inbox watched through that topic, the watch set by the call
that finds none and renewed by the call that finds it older than a
day, since Gmail forgets a watch after a week. The mailbox's own
history serves what arrived before a wait's position, as far back as
Gmail keeps it, and fills what a push did not carry; a wait looks
through at most the five hundred newest mails since its position. Send as the account with the attachments given, at most ten
megabytes of them together, and
answer the Message-ID the mail went out with. Beyond the interface:
answer the account's own address, search the mailbox with Gmail's
query language and answer the matching mails, newest first, at most a
hundred, and read a
mail by its Message-ID.

## Tests

The account's own address is the one this agent answers for it.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
