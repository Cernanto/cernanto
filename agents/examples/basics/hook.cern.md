# Hook

Uses: cernanto/webhook

When asked for the url, answer the url a provider posts its deliveries
to. When asked for the next delivery, wait for it and answer the value
of its body's "event" field, or "unknown" when the body has none or
that field is not text; the provider's own request gets the same
answer.

## Tests

Ask the agent for its url and for the next delivery, post one there
with a plain http request the way a provider would while the wait is
open, and check that the wait and the response both give the
delivery's event.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
