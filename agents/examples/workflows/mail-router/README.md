# Mail router

The person who reads the shared inbox and forwards each mail to
whoever handles it: `office@` in a company, the one address every
automation shares with its owner in a homelab. A desk worker follows
the mailbox and hands every mail to the router, which sends it where
it belongs. Two rules come first and settle without a judgment: a
mail that is for another agent, a reply to one a desk sent, is left
alone; a mail with a PDF attached is a vendor's invoice and is
forwarded to the billing mailbox, where the invoice desk picks it up.
Then one judgment: a refund, a return or an exchange goes to the
refund desk, an order question to the order-status handler, a
question the handbook answers to the helpdesk, each answered as a
reply to the mail; anything else is posted to the triage channel for a
person. The spec is `../mail-router.cern.md`, the worker
`desk.cern.md` beside this file.

Everything below runs from the `agents/` folder against the dev
plane, on the sandbox inbox and chat, with no account.

## 1. Run it

Deploying the desk alone lands the router, the inbox, the three
handlers and the shop beneath it, and starts the desk on the default
mailbox:

```
$ cernanto deploy examples/workflows/mail-router/desk
```

Three mails arrive from the outside world, delivered the way a
provider would: a customer's order question, a vendor's invoice with
its PDF, and a meetup invitation:

```
$ cernanto call examples/sandbox/inbox deliverMail --args '{"address":"office@acmeledgers.example","mail":{"from":{"address":"lena.fischer@example.com","name":"Lena Fischer"},"subject":"Where is my order?","text":"Hi, could you tell me where order A-1003 is? Thanks, Lena"}}'
$ cernanto call examples/sandbox/inbox deliverMail --args '{"address":"office@acmeledgers.example","mail":{"from":{"address":"accounts@nordwind-supplies.example","name":"Nordwind Supplies"},"subject":"Invoice NW-2026-0912","text":"Please find attached our invoice for September.","attachments":[{"name":"NW-2026-0912.pdf","contentType":"application/pdf","contentBase64":"JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZz4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4KJSVFT0YK"}]}}'
$ cernanto call examples/sandbox/inbox deliverMail --args '{"address":"office@acmeledgers.example","mail":{"from":{"address":"sam.ortiz@example.org","name":"Sam Ortiz"},"subject":"Speaking opportunity","text":"Would someone from Acme Ledgers speak at our bookkeeping meetup in November?"}}'
```

A minute later the mailboxes and the channel show where each went:
the reply to Lena, the forward in the billing mailbox with the PDF,
and the triage post:

```
$ cernanto call examples/sandbox/inbox listMails
{"received":[...],"sent":[... {"to":[{"address":"lena.fischer@example.com"}],"subject":"Re: Where is my order?","text":"Your order A-1003 was delivered on 2026-08-14."},
                             {"to":[{"address":"billing@acmeledgers.example"}],"subject":"Fwd: Invoice NW-2026-0912","text":"Forwarded mail from Nordwind Supplies <accounts@nordwind-supplies.example>\n\nPlease find attached our invoice for September.", ...}]}
$ cernanto call examples/sandbox/inbox listMails account=billing
{"received":[... {"from":{"address":"office@acmeledgers.example"},"subject":"Fwd: Invoice NW-2026-0912","attachments":[{"name":"NW-2026-0912.pdf","contentType":"application/pdf","size":68}]}],"sent":[]}
$ cernanto call examples/sandbox/chat read chat="#triage"
[... {"from":{"name":"acme"},"text":"Mail needs a person. From: Sam Ortiz <sam.ortiz@example.org>. Subject: Speaking opportunity"}]
```

`cernanto trace examples/workflows/mail-router` reads the last routing: the
mail, the settings, the one judgment with its four classes, the
handler's answer, the reply or the post. A forwarded invoice shows no
judgment at all: the rule decided.

## 2. The settings

The desk reads its settings when it starts: the mailbox it follows is
`examples/workflows/mail-router/account` (and the desk's `examples/workflows/mail-router/desk/account`) (the default account when unset) on the provider
`connectors/email/default`; the router reads the billing address
`examples/workflows/mail-router/billing-address` (`billing@acmeledgers.example`), the chat
provider `connectors/chat/default` and the triage channel
`examples/workflows/mail-router/triage-channel` (`#triage`). `cernanto deploy
examples/workflows/mail-router/desk` after a change runs the desk again. The desk begins with the
mails of the last day and then follows, so a restart reads that day
again.

## 3. Grow it

Add a rule, one sentence beside the two: "a mail from the insurer's
domain goes to the renewal desk", and the renewal desk under `Uses:`;
no judgment runs for it. Add a handler the same way. Change the
default: the last sentence of the judgment paragraph, say a drafted
reply posted to the triage channel for a person to approve before it
is sent, which is `examples/basics/approval` on the router's own catch-all.
Deploy the desk again; the amend keeps the rest.

## The real forms

The same spec is two people's mailroom. The company's: set
`connectors/email/default` to `connectors/google/gmail` (or to a
connector of your own for another mail provider),
`connectors/chat/default` to `connectors/slack`,
and the shop to `connectors/postgres` behind the handlers; the router
is not recompiled for the provider switch. Bound to a real mailbox the
desk does real work: it begins with the mails of the last day and
answers their senders, so point it first at a mailbox made for the
trial. The homelab's: the person's
own Gmail address, the rules the person's own (receipts to a folder,
the school and the bank to the phone, newsletters archived), and the
triage channel `connectors/ntfy` on their phone, keyless and already in
the tree.
