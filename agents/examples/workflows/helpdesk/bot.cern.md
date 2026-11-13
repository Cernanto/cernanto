# Helpdesk bot

Type: worker

Uses:

- examples/workflows/helpdesk
- connectors/chat
- cernanto/config

Follow the support channel, `#support` unless the configuration names
another under `channel`, on the plane's chat provider, with the sandbox chat, `examples/sandbox/chat`, as the fallback when the plane binds none. For every message that addresses you, ask the helpdesk the
question and answer under that message. When the helpdesk cannot
answer, tell the asker that a person will follow up, and post the
question to the support leads' channel, `#triage` unless the
configuration names another under `leads-channel`. A message posted before you started is not yours. Keep
following for as long as you run, missing nothing that arrives while
you answer.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
