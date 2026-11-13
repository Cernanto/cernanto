# Chat

This page only defines the contract every chat provider implements:
a chat account. Every operation takes an optional account name:
without one, act as the domain's default account; with one, act as the
account connected under that name. A name nobody has connected parks
the call until that account is connected.

Send a plain-text message to a conversation, named by the id the
provider gives it, optionally as a reply under a given message (a
thread). Answer whether it was delivered, the provider's id of the
posted message, and the reason when it was not. A conversation the
account cannot reach (not a member, no permission, an unknown id) is a
normal answer, not delivered, with the reason; only a transport
failure is an error. Where the provider has no threads, a reply is a
plain message in the same conversation.

Wait for a message in a given conversation: the first one, in order of
posting, after the position given, that matches every filter given: the sender's id, a
substring of the text (case does not matter), the thread it replies
under, and whether it addresses the account (by a mention or a reply
to it, and every message in a direct message with the account does; a
provider without mentions treats every message as addressed).
A position is a message, named by the id a previous wait answered, or
a moment, and either may lie before the call, so the wait answers from
there, history and live in one call, as far back as the account's
record keeps; the moment the call began when none is given. Answer the
message, or null when the timeout passes with no match; the timeout is
five minutes when none is given. A message the account itself posted
arrives like any other: a wait that wants others' messages alone
filters by sender, and a wait from the position of the account's own
post, the id its send answered, begins after it. Where the provider
has no threads, the thread filter matches any message in the
conversation.

Wait for messages: the same conversation, position, filters and
timeout, and the most to answer, a hundred when none is given. Answer
the matching messages in the order they were posted, at most that
many, and the position to continue from, which the next call hands
back as its position: after the last message answered, or where this
wait's window opened when none was, so a follower misses nothing
posted between two waits. An empty list when the timeout passes with
none.

A message carries its id, its conversation, the message it replies
under when it is a reply, the sender's id and name, its plain text
(the provider's markup rendered as words, mentions as names), whether
it addressed the account, whether the account itself posted it, when
it was posted, and, when the account
can tell, the agent the message is for: the agent that posted the
first message of the thread it is under, or else, in a direct message,
the agent that last wrote in that conversation from this account, both
known from who asked the account to send; absent otherwise, and always
absent for a channel message under no thread.

Type: interface

## Tests

One account of the implementor's own provider takes part, the default
one, posting in one conversation learned the way the implementor's
own Tests section says; every operation names no account.

One scenario, four posts. The account posts in the conversation; a
wait started before the post answers it with the account as the
sender, not addressed to the account, and naming no agent. The
account posts a second message that mentions itself; a wait asking
for messages addressed to the account answers that one and not the
first. The account replies under its first post; a wait on that
thread, started before the reply, answers the reply, naming the agent
that posted the thread's first message, and a wait on another thread
does not. The account posts a fourth message after its first wait
ended; a wait with the position at the first message answers the
second, the next in order, although it was posted before this wait
began, and a wait with no position started now answers null at a
short timeout. A wait from a moment before the first post answers the
first post, although the wait began after it; a batch wait from that
moment with a limit of one answers it and a position that, handed
back, answers the second. A send to a conversation the account cannot
reach answers not delivered with a reason and never throws.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
