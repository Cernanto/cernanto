# Email

This page only defines the contract every email provider implements:
an email account. Every operation takes an optional account name:
without one, act as the domain's default account; with one, act as the
account connected under that name. A name nobody has connected parks
the call until that account is connected.

Send a mail to a list of addresses, with optional cc and bcc lists, a
subject, a text body, an optional html body and optional attachments,
each a name, a content type and its bytes as base64, ten megabytes in
all at most (refuse more in words). Answer whether it was delivered
(the provider accepted it), the Message-ID it went out with, and the
reason when it was not. A malformed or refused address is a normal answer,
not delivered, with the reason; only a transport failure is an error.

Reply to a received mail, named by its Message-ID, with a text, an
optional html and optional attachments. The reply goes to that mail's
sender, keeps its subject with the reply prefix, and is threaded so
every mail client shows it under the original. Answer as for a send. A
reply to a Message-ID the account never received is a normal answer,
not delivered, with the reason.

Wait for a mail: the first one, in order of arrival, after the
position given, that matches every filter given: the sender's address
(exact, case does not matter), a substring of the subject (case does
not matter), the Message-ID it replies to (named in its In-Reply-To or
References), and whether it carries an attachment. A position is a
mail, named by the Message-ID a previous wait answered, or a moment,
and either may lie before the call, so the wait answers from there,
history and live in one call, as far back as the account's record
keeps; the moment the call began when none is given; and a wait from
the position of a mail the account sent, the Message-ID its send
answered, begins after it, so a desk that mailed someone waits for
what comes after its own mail. Answer the mail, or null when the
timeout passes with no match; the timeout is five minutes when none
is given. A mail the account itself sent is not one that arrived, whatever the mailbox files it under, unless it was sent to the account's own address: arrival is the mailbox receiving mail from another.

Wait for mails: the same position, filters and timeout, and the most
to answer, a hundred when none is given. Answer the matching mails in
the order they arrived, at most that many, and the position to
continue from, which the next call hands back as its position: after
the last mail answered, or where this wait's window opened when none
was, so a follower misses nothing that arrives between two waits. An
empty list when the timeout passes with none.

A mail carries its Message-ID and the provider's own id, the sender's
address and name, the to and cc lists, the subject (empty when it has
none), the plain text (converted from the html when the mail has no
text), the html when it has one, when it was received, its
attachments, each with its name, content type and size, and its bytes
as base64 when it is ten megabytes or smaller, and, when the account
can tell, the agent the mail is for: the agent that sent the mail this
one replies to, or else the agent that last wrote to this sender from
this account, both known from who asked the account to send; absent
when neither is known.

Type: interface

## Tests

One account of the implementor's own provider takes part, the default
one, writing to itself: its own address is learned the way the
implementor's own Tests section says, and every operation names no
account (the named reading is the same road under a name).

One scenario. The account sends a mail with an attachment to its own
address; a wait, started before the send and asking for an attachment,
answers it with the attachment's name, type, size and bytes and the
account's own address as the sender, and names the agent that sent
it, the account having written to itself. The account replies to it; a
wait, started before the reply and naming the original as the mail
replied to, answers the reply, whose In-Reply-To names the original
and which names the agent that sent the original. The account sends a
second mail without an attachment, replying to nothing, after the
first wait ended; a wait with the position at the first mail answers
the second, although it arrived before this wait began; a wait with no
position started now answers null at a short timeout; a wait asking
for an attachment from the same position answers null. A wait from a
moment before the first mail was sent answers the first mail, although
the wait began long after it; a batch wait from that moment with a
limit of one answers the first mail and a position that, handed back,
answers the second. A send to an invalid address answers not delivered
and never throws; a reply to a Message-ID the account never received
answers not delivered.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
