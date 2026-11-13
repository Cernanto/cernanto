# Helpdesk

Uses:

- file:helpdesk/docs/
- cernanto/decision
- cernanto/llm

Given a question, choose with cernanto/decision the handbook pages that
answer it and, among them, the one page the answer comes from; write
the answer from those pages with cernanto/llm and name that page. When the handbook does not
answer it, say so instead of guessing.

Decisions are made with cernanto/decision.

## Tests

Ask two questions and read the answers, on the decision engine the
plane binds, as any caller gets it: how to book leave is answered
from the holidays page, which the answer names; the office's wifi
password is a question the handbook does not answer, and the answer
says so.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
