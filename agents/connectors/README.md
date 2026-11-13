# Connectors

The interfaces every provider family implements, and the connectors to
real services. An interface is a contract nothing runs: a workflow
names it, binds an implementor by its id at run time, and switches
providers without a recompile. A service that is not here is one
sentence away: name its MCP server or its OpenAPI document by its url
in your own spec.

| id                         | type                                 | what it does                                                                                                                                                                          | what it shows                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connectors/email`         | interface                            | an email account: send, reply, wait for a mail by sender, subject, thread or attachment, from a mail or a moment, one at a time or a page at a time; a mail names the agent it is for | an interface with a `## Tests` section every implementor's compile runs                                                                                                                                                                                            |
| `connectors/chat`          | interface                            | a chat account: send to a conversation or under a thread, wait for a message by sender, text, thread or mention, from a message or a moment, one at a time or a page at a time        | the same, for chat; a wait never answers the account's own posts                                                                                                                                                                                                   |
| `connectors/frankfurter`   | task                                 | the euro rate of a currency on a date, from the European Central Bank's reference rates                                                                                               | a keyless reach in an agent of its own, so a caller's call to it is journaled and never re-asked on a replay                                                                                                                                                       |
| `connectors/open-meteo`    | task                                 | tomorrow's forecast for a place from Open-Meteo's free API: the high, the low, the chance of rain, a word for the sky                                                                 | the OpenAPI lane, keyless: the document pinned in the package, its operations typed and journaled                                                                                                                                                                  |
| `connectors/deepwiki`      | task                                 | answers a question about a public repository from its documentation as DeepWiki reads it, naming the pages                                                                            | the MCP lane, keyless: the server's tool listing pinned in the package, its tools typed and journaled                                                                                                                                                              |
| `connectors/ntfy`          | task                                 | publishes a message under a title to a topic on the public ntfy.sh board, and answers the id the board gave it                                                                        | the agent a workflow mocks: `examples/basics/notice` lists it under `Mocks:` so a verify never posts to the public board                                                                                                                                           |
| `connectors/slack`         | task, `Implements: connectors/chat`  | chat on a Slack workspace as a Slack app: send, wait for messages by Slack's Events API, the channels the bot sees, a reaction                                                        | the npm lane with a pasted key (the bot token and signing secret), the push through `cernanto/webhook`; connect: a Slack app, its README; tests need two apps, the account and `tester`, in one channel, `connectors/slack/tests/chat`                             |
| `connectors/postgres`      | task                                 | one SQL statement with its parameters against the connected database: the rows, the count, the database's refusal                                                                     | the npm lane with a connection url; connect: a free Neon or Supabase database, its README; tests need one account and no fixture                                                                                                                                   |
| `connectors/stripe`        | task                                 | a refund by payment and order, once per order; a payment's and an invoice's status; a wait for the next payment event                                                                 | the npm lane with a restricted test-mode key and a webhook endpoint the connector registers itself; tests need `connectors/stripe/tests/payment`, a test-mode payment to refund by one unit                                                                        |
| `connectors/jira`          | task                                 | the open tickets of a project, a ticket with its comments, a new ticket, a comment, a wait for the next ticket or comment                                                             | the MCP lane signed in: the server's own sign-in in the browser, the tools read at the compile; tests need `connectors/jira/tests/project` and a second user connected as `tester`                                                                                 |
| `connectors/hubspot`       | task                                 | contacts and deals in a HubSpot CRM through HubSpot's objects API: a contact by email, a contact created or updated, a deal created, a contact removed                                | the OpenAPI lane signed in: HubSpot's own document at its url, which declares OAuth 2.0, reached with a private app's access token pasted in the lane's ask in place of an OAuth client; connect: a private app, its README; tests need one account and no fixture |
| `connectors/google/client` | module                               | the one Google sign-in every Google connector shares: an access token for the scopes a connector needs, the default account or a named one                                            | the npm lane with a browser sign-in: a Google Cloud project's OAuth client asked for once, the consent in the browser, the token renewed by itself                                                                                                                 |
| `connectors/google/gmail`  | task, `Implements: connectors/email` | mail on a Google account through the client: send, reply, wait for mail by Gmail's push, the account's address, a search, a mail by id                                                | a connector on a client module; the push through a Pub/Sub topic the connector makes; tests need the second Google account connected as `tester`                                                                                                                   |

Every operation takes an optional account name: without one it acts as
the connector's default account (named for its provider), with one as
the account of that name; an account nobody has logged in parks the
call until the operator answers the connector's ask, in the terminal
that deployed or invoked it, or with `cernanto auth login`.
A wait answers from a position: the moment it began when none is
given, or the mail or message it is handed, or a moment, either of
them before the call, so history and live are one call, as far back as
the account's record keeps; the batch waits answer a page and the
position to continue from, so a follower misses nothing between two
calls. Five minutes is the default timeout and null, or an empty page,
is the timeout's answer. A mail or message names the agent it is for
when the account can tell: the one that sent what it replies to, else
the one that last wrote to that sender from the account; a router
leaves such a mail to the desk waiting for it.

The `## Tests` section of an interface is the family's knowledge: it
runs at every implementor's compile on the implementor's own provider
with one account, the default, writing to itself. The sandbox's inbox and chat are
the first implementors; `connectors/google/gmail` and
`connectors/slack` are the real ones, and the same tests prove each
when you deploy it, on a test account of your own: their packages here
are compiled and carry no verified stamp until that deploy. A connector
to a real service asks for its account on the
first call that needs it, with numbered steps for the provider's
console, and each one's README carries those steps, the login line
and what its tests need; a connector is verified by
`cernanto deploy connectors/<name>` once its accounts are logged
in.

`cernanto contract connectors/email` prints an interface's functions
and the shapes they take and answer.
