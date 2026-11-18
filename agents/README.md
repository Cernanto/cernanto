# Cernanto agents: the examples and the connectors

Agents written in plain English and compiled into verified TypeScript,
each spec beside the package the compile wrote from it, so the whole
tree lands on a plane without a compile and at no cost. This folder is
the workspace: run every command from here, and an agent's id is its
path (`examples/basics/counter`, `examples/workflows/refund-desk`,
`connectors/slack`).

```
$ cernanto dev up      # the dev plane on this machine
$ cernanto deploy examples/   # lands their packages in dependency order; nothing to compile
```

## Start from a problem you recognize

| I want to...                                                  | start with                                                       | what it teaches                                                                    | to run it   |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------- |
| check that the install works                                  | `examples/basics/counter`                                        | a service with memory, calls served side by side, a crash survived                 | nothing     |
| answer questions from my own documents                        | `examples/basics/team-notes`, then `examples/workflows/helpdesk` | granted files and a judgment grounded in them; a chat bot on top                   | an AI login |
| follow up on support tickets                                  | `examples/workflows/support-follow-up`                           | classify, tell the team, wait for a person, remind once                            | an AI login |
| approve invoices against orders and receipts                  | `examples/workflows/invoice-approval`                            | a document read by judgment, exact arithmetic in code, an approval chain           | an AI login |
| decide refunds under a written policy                         | `examples/workflows/refund-desk`                                 | a policy file, an OpenAPI server other systems call                                | an AI login |
| approve expenses from a photo of the receipt                  | `examples/workflows/expense-desk`                                | a picture read by judgment, the receipt's fields one at a time                     | an AI login |
| act on an alert from my homelab                               | `examples/basics/hook`, then `examples/basics/notice`            | a webhook through the cloud relay; a notice, its public board mocked               | nothing     |
| route the shared inbox to the desks that handle it            | `examples/workflows/mail-router/desk`                            | two rules before one judgment; a handler reached by a forward, one called in place | an AI login |
| put a front desk on the team chat that knows who handles what | `examples/workflows/chat-router/desk`                            | sessions, reroute and takeover; the same handlers behind mail and chat             | an AI login |
| renew a contract by mail once a year                          | `examples/workflows/renewal-desk`                                | a conversation the agent starts: send, wait, counter once, record                  | an AI login |
| shortlist the articles that answer a question                 | `examples/basics/shortlist`                                      | the items that pass and the best of them, two decisions over a list                | an AI login |
| rate an incident and page at a threshold                      | `examples/basics/severity`                                       | a degree on a scale the code compares, two degrees weighed in arithmetic           | an AI login |

"An AI login" is Claude Code or Codex installed on this machine and
signed in with your own Claude or ChatGPT subscription, or an API key
set in its place, which the plane's judgments run on; every example here runs on the sandbox company in
`examples/sandbox/`, so none needs an account with an outside service. The
precompiled packages land without a compile, so nothing else is needed
to run them; editing a spec and deploying it needs the same login, for
the compile.

Three model-backed agents answer the examples' judgments, and a spec
names the one its sentence needs: `cernanto/decision` answers a closed
question with a value the code branches on, yes or no, one of these, a
level on a scale, the ones that pass, best first; `cernanto/llm`
answers an open question with text or a value read out of the
content, or writes text; `cernanto/search` answers a question about
the world with a report and its sources. An example reads the same
whichever engine the plane binds for decisions: the language model
you signed in with unless `cernanto/decision/default` names another, such as
TypeSafe's Jev (`cernanto config cernanto/decision/jev token=<key>` then
`cernanto config cernanto/decision default=cernanto/decision/jev`), which
answers in well under a second with a probability the trace shows.

## Three roads through the tree

- **Learn** the language in `examples/basics/`: seventeen tiny agents, one lesson
  each, read in order, each with a sentence to change and the result to
  expect. Start with `examples/basics/counter`.
- **Adapt** a desk in `examples/workflows/`: business processes on the fictional
  company in `examples/sandbox/`, each a spec you copy and change, with a
  walkthrough and a recipe for moving it into your own workspace: the
  support follow-up (the entry tutorial), the helpdesk and its chat bot,
  the invoice approval, the refund desk, the expense desk, the mail
  router and the chat router with the order-status handler behind them,
  and the renewal desk.
- **Connect** your own services through `connectors/`: the interfaces
  every provider implements, the keyless connectors that need no
  account, and the connectors to real services (Slack, Gmail, Jira,
  Stripe, Postgres, HubSpot), each asking for its account on the first
  call with the steps to create it. Each desk's README carries its real
  form as a diff to apply; a service that is not here is one sentence
  away: name its MCP server or its OpenAPI document by its url in your
  own spec.

## What is here

In the tree: the seventeen basics; two interfaces, four keyless
connectors and seven connectors to real services (Slack, Postgres,
Stripe, Jira, HubSpot, the Google client and Gmail); five sandbox
stores; and nine desks with three workers beside them: the support
follow-up, the helpdesk and its chat bot, the invoice approval, the
refund desk, the expense desk, the order-status handler, the mail
router and the chat router with their desks, and the renewal desk. The
local examples are verified live against their real dependencies by
the compile that wrote them; a connector to a real service is verified
by its deploy once its accounts are logged in, as its README shows.

## The same agents from the registry

An agent here is also a package of the Cernanto registry under the
same name, published with each release, once its tests have run live;
a connector to a real service joins when its own tests have run on an
account of that service, and until then it is here, in the tree. So
there are three more ways to take a published one, none of which
needs this repository:

- **As source, in a folder of your own:**
  `cernanto registry get examples/` brings every example, each page
  beside its package with the files it names, and
  `cernanto deploy examples/` lands them with nothing to compile. They
  are yours from that moment: change a sentence and deploy.
  `cernanto registry get connectors/frankfurter` takes one agent the
  same way.
- **As it is, by its name:** `cernanto deploy connectors/frankfurter`
  installs the package and what it needs, with no page in your folder.
- **From a spec of your own:** a page whose `Uses:` line names
  `connectors/email` has the package installed by its compile and kept
  in your tree.

An agent taken as source and the same agent installed by its name are
two standings of one id, and a plane holds one of them:
`cernanto delete <id>` before taking the other road.

## Reading and running an agent

Every agent is read the same way: `cernanto contract <id>` prints
what it does and what each function takes and answers, `cernanto
source <id>` the page it was compiled from (`--to <folder>` writes the
page there with the files it names), `cernanto code <id>` the
code the compile wrote and `cernanto tests <id>` its tests, `cernanto
call <id> <function> key=value` calls it, `cernanto trace <id>` reads
its latest call as a conversation, `cernanto ls` shows the fleet.

Edit any spec and `cernanto deploy` it: the compile amends the
package against the previous one, gates the code, writes or keeps the
tests, proves them live against the real dependencies, and lands the
result beside the spec. The author's guide is `docs/WRITING-AGENTS.md`
in the repository; the folder READMEs are the indexes.
