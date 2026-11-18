# Slack

Implements: connectors/chat

Uses:

- cernanto/auth
- cernanto/webhook
- npm:@slack/web-api@^8

A Slack workspace, reached as a Slack app the operator creates in it.
The account is the app's bot token and its signing secret, asked for
together on the first call under the provider `slack.com`; a named
account is a second app connected under that name. The app the ask
asks for: a bot allowed to read and post in channels, groups and
direct messages, to be mentioned, to read the members' names and to
add reactions; events enabled, with this agent's own url, which the
ask spells out, as the request url and Socket Mode left off, since
events sent over a socket never reach that url, subscribed to the bot
events for messages in channels, groups and direct messages and for
mentions;
people allowed to message the app; and the bot invited to every
channel it should read or post in. Answer Slack's url verification the moment it
arrives, even while the account is still being logged in, so the
operator can save the request url at any point of the setup.

A conversation is a channel or a direct message, named by its id.
Messages arrive by Slack's Events API at this agent's url, which needs
no renewal; the account's own history, read once when a wait begins,
serves what arrived before the wait's position, as far back as the
workspace keeps it, and what arrives after comes by the events alone; a thread whose
first message has no replies yet is an empty thread, not a missing
one. A post
carries the agent that asked for it in Slack's message metadata, and
that is how a wait knows the agent a message is for: the one on the
first message of the thread it is under, or, in a direct message, the
one on the latest earlier post of the account there that carries one. Believe a delivery only after
checking it against the signing secret, and never act twice on a
delivery Slack sends again. Beyond the interface:
answer the channels the bot can see, each with its id and name, and
add a reaction to a message.

## Tests

Uses: cernanto/config

The conversation the tests use is the channel the tests read from the
configuration under `chat`, which the app has been invited to.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
