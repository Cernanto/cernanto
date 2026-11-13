# Support follow-up

Given the id of a new support ticket, read it from examples/sandbox/crm and
classify its message with cernanto/decision as billing, technical or
account access. When the message does not say which, post it to the triage
channel for a person to sort, and stop there. Otherwise record the
category and the team on the ticket, tell the team assigned to that
category on its channel, and wait for a person to respond on the
ticket; a response on the ticket counts whether it was already there
when the ticket was read or was recorded any time after, however
soon. The teams by category and their channels are in the file
support-follow-up/teams.json. If nobody responds within the response
window, send the team one reminder on the same channel.
Answer the category, the team and its channel, and how it ended: a
response, a reminder, or triage.

Tell the teams through connectors/chat, on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none. The response window is the minutes
given with the request, else the minutes the configuration names under
`response-window-minutes`, else two days.

Uses:

- examples/sandbox/crm
- cernanto/decision
- file:support-follow-up/teams.json
- connectors/chat
- cernanto/config

## Tests

Uses:

- examples/sandbox/crm
- examples/sandbox/chat
- cernanto/config

To prove the desk, open each ticket in examples/sandbox/crm the way a customer would and follow the desk through examples/sandbox/chat: the team's channel shows the post; a response recorded on the ticket, even one recorded before the team was told, ends the wait as a response, with no reminder; a ticket nobody responds to brings one reminder on the channel after the window, which the tests give with the request, a minute; a message that says nothing about billing, technical or account access goes to the triage channel.
The tests read the configuration through cernanto/config.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
