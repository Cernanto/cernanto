# Chat

Type: service

Implements: connectors/chat

One workspace with its channels and its people. A conversation is a
channel or a person, named by its id: `#` and the channel's name, or
`@` and the person's name, and either exists from the moment it is
first used. Every account name is a person in the workspace, the
default account being the person `acme`; a message addresses a person
when it names them with `@` as a whole name in any letter case,
replies under a message of theirs, or is in the direct conversation
with them; a person's own post is marked as their own and addresses
them too when it replies under their message or names them. Everything posted is kept and can be
read back, a conversation at a time. Every message an agent sends is
kept with that agent's id, and by it a message tells the agent it is
for: a message under a thread is for the agent that sent the thread's
first message, and a message in a direct conversation for the agent
that last sent there from the account. A person's answer arrives as a
post by that person: take it in as a message from a named person, in a
conversation, optionally under a thread, and answer its id.

## Tests

The conversation the tests use is a channel of their own naming. The
tests' own agent sends every post, so the reply under the first post
tells an agent it is for, and the first post tells none.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
