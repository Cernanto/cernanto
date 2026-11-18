# Chat router desk

Type: worker

Uses:

- examples/workflows/chat-router
- connectors/chat
- cernanto/config

Follow the conversations the configuration names under
`channels`, `#help` when it names none, on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none. A message counts when it
addresses you, which every message in a direct message does, and so
does every message in a conversation you are in, mentioned or not; a
message that is for another agent is that agent's, leave it alone. Keep the
conversations you are in, one per person in one thread or in one
direct message, a message under a thread belonging to the
conversation the thread's first message began: the handler each
follows and when it last spoke, and drop one that has been silent for
longer than the idle window the configuration names under
`idle-minutes`, sixty when it names none. Hand every message
that counts to the chat router with its conversation, one message of
a conversation at a time and in order, and keep what the router
answers: the handler the conversation follows now, or that it is
done; a conversation that is done is dropped, and that person's next
message counts only when it addresses you. Keep following for as
long as you run, from the moment you start and leaving alone what was
posted before, missing nothing that arrives while a message is
handled.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
