# Inbox

Type: service

Implements: connectors/email

Uses: file:inbox/mail/

The company's mailboxes, one per account name: the default mailbox and
`billing`, each seeded with the mails in the granted folder, each
mail in the mailbox its file names, and a new
empty mailbox for any other name the first time it is used, at that
name's address in the company's domain. A mail sent to one of the
company's own addresses arrives in that mailbox the moment it is sent,
and a reply reaches the original's sender the same way; a mail to any
other address is delivered and kept, and arrives nowhere. Answer the
mailboxes with their names and addresses when asked, and the mails a
mailbox holds, received and sent, when asked.

Take a mail in from the outside world, the way a provider would deliver
it: given the address it is for and the mail (its sender, subject,
text, optional html and attachments), keep it in that mailbox with a
Message-ID of its own and answer that id; a waiting call sees it like
any other mail. A mail for an address no mailbox has is refused.

## Tests

The account's own address is the default mailbox's, as the mailboxes
answer it.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
