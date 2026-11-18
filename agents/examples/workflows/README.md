# Workflows

Business processes to copy and adapt, one folder each, self-contained:
the spec named for the desk, its own files in the folder of the same
name (a lookup table, a template, a document, a docs folder), its
README with the walkthrough and the diff to its real form, and its
package under `.cern/`. Every desk's local form runs on the sandbox
with no account.

| id                                     | type   | what it does                                                                                         | what it shows                                                                                      |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `examples/workflows/support-follow-up` | task   | classifies a ticket, tells the team, waits for a response, reminds once                              | classify, route, wait, remind in one page; the lifecycle walkthrough                               |
| `examples/workflows/helpdesk`          | task   | answers a question from the handbook, naming the page, or says it cannot                             | a judgment grounded in granted files                                                               |
| `examples/workflows/helpdesk/bot`      | worker | follows the support channel and answers through the helpdesk                                         | a worker on a feed, with a cursor; the shortest road to a bot in your chat                         |
| `examples/workflows/refund-desk`       | task   | decides a refund request under the policy and drafts the reply                                       | an OpenAPI server on its own port; a policy in code; a refund made once                            |
| `examples/workflows/invoice-approval`  | task   | reads an invoice PDF from the mail, matches it to the order and receipts, posts or asks the approver | messy documents, exact arithmetic, an explicit policy, a human approval, a rate from a keyless API |
| `examples/workflows/expense-desk`      | task   | reads a receipt off the picture attached to a mail and approves or refuses it under a policy         | a picture in the judgment's context: the model sees the photo; one reading per field               |
| `examples/workflows/order-status`      | task   | answers a customer's question about their order in words, for the routers to send                    | a handler: a function that takes a message and answers words, never a channel                      |
| `examples/workflows/chat-router`       | task   | routes a chat message to the desk that handles it, one judgment per conversation                     | sessions, reroute and takeover on one page, on the same handlers the mail router uses              |
| `examples/workflows/chat-router/desk`  | worker | follows the help channel and hands every message that counts to the chat router                      | a worker keeping the conversations, the rest stateless                                             |
| `examples/workflows/mail-router`       | task   | sends each mail of the shared inbox where it belongs: a desk, a mailbox, a person                    | two rules before one judgment; a handler entered by a forward and one called with what it takes    |
| `examples/workflows/mail-router/desk`  | worker | follows the company's mailbox and hands every mail to the mail router                                | a worker on a mail feed, from the last day on                                                      |
| `examples/workflows/renewal-desk`      | task   | asks a contract's provider for a renewal quote by mail, counters once, records the outcome           | the conversation an agent starts: send, wait a week, follow up, in the spec and in the code        |

The front page is the support follow-up's walkthrough,
`support-follow-up/README.md`: run it, change a policy sentence, switch
a provider by configuration, recompile with another model, interrupt a
waiting call.
