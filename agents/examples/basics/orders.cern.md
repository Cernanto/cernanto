# Orders

Type: service

Implements:

- openapi:orders/openapi.yaml

Keep the orders placed between calls, each under the id this agent
hands back, `o-1` for the first, `o-2` for the second, and so on.
Serve the API that the document describes over http on port 8080.
Reading an unknown id is the document's not-found answer with the id
as the problem's detail.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
