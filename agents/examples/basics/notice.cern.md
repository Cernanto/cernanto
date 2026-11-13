# Notice

Given an incident's title and its severity, announce the incident
with connectors/ntfy on the team's public board, the topic
`cernanto-examples-incidents`,
when the severity is high, and answer whether it was announced.

Uses:

- connectors/ntfy

## Tests

Mocks:

- connectors/ntfy

In the tests, replace connectors/ntfy with a mock, so nothing is posted on the public board.
Prove a high severity is announced once, with the incident's title, and a low one never.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
