# Invoice approval

The accounts payable clerk's three-way match and approval chasing. An
invoice arrives by mail with a PDF attached; the desk reads it out of
the document's text in code (a vendor's invoice states its number, its
order, its dates, its total and a table of the lines it bills, and the
spec says so), converts a foreign total at the day's euro rate through
`connectors/frankfurter`, finds the purchase order and its goods
receipts, and matches in code: a second
invoice under a number the ledger already holds for the vendor is a
duplicate and posts nothing; every invoiced line must name goods the
order holds at a quantity the receipts cover, and the total must sit
within the tolerance the approver table states of the order's. A match
posts to the ledger. Judgments read only what is fuzzy: a mismatch
gets a one-paragraph explanation and a judgment on whether the lines
describe the same goods, then goes to
the approver the table names for the amount, on chat; the desk waits
for the answer, reminds once when the window passes, and escalates to
the controller when it passes again. The answer says what happened:
matched, approved, rejected, escalated or duplicate.

The spec is `../invoice-approval.cern.md`; `approvers.json` beside this
file is the approver by amount band, the controller, and the
tolerance. The desk reads the billing mailbox, the account the
configuration names under `examples/workflows/invoice-approval/email` (`billing` when it names
none), on the mail provider under `connectors/email/default` (the sandbox inbox
when it names none); the approval window is two days, or the minutes
a call gives, or the minutes under `examples/workflows/invoice-approval/approval-window-minutes`.

```
$ cernanto deploy examples/workflows/invoice-approval
examples/workflows/invoice-approval  reads a task
compiling ................................
Invoice Approval   examples/workflows/invoice-approval   agent   deployed   verified live in 2m51s, 4 tests
```

The quarter-minute window is for the lab; the desk's own default is two
days. Each call handles the next invoice. In one terminal the desk
waits; in another a vendor's mail arrives with the sample invoice that
matches purchase order PO-1042, the sender named as the vendor:

```
$ cernanto call examples/workflows/invoice-approval handleNextInvoice
                                                        # parks until an invoice arrives
$ PDF=$(base64 -i examples/sandbox/purchasing/data/invoices/NP-2026-0417.pdf | tr -d '\n')
$ cernanto call examples/sandbox/inbox deliverMail --args "{\"address\":\"billing@acmeledgers.example\",\"mail\":{\"from\":{\"address\":\"invoices@nordwind-paper.example\",\"name\":\"Nordwind Paper GmbH\"},\"subject\":\"Invoice NP-2026-0417\",\"text\":\"Please find attached our invoice NP-2026-0417.\",\"attachments\":[{\"name\":\"NP-2026-0417.pdf\",\"contentType\":\"application/pdf\",\"contentBase64\":\"$PDF\"}]}}"
"<5308637a-3519-46bb-8e04-a25be1d3da3a@nordwind-paper.example>"
$                                                       # the first terminal answers:
{"outcome":"matched","invoice":{"vendor":"Nordwind Paper GmbH","vendorId":"V-100","invoiceNumber":"NP-2026-0417","purchaseOrder":"PO-1042","currency":"EUR","total":6000,"totalEur":6000,"invoiceDate":"2026-09-15T00:00:00.000Z","dueDate":"2026-10-15T00:00:00.000Z","lines":[{"description":"A4 copy paper, 80 g, box of 2500","quantity":200,"unitPrice":24.5,"amount":4900},{"description":"Toner cartridge TN-2420","quantity":12,"unitPrice":89,"amount":1068},{"description":"Delivery","quantity":1,"unitPrice":32,"amount":32}]},"ledgerEntry":{"entryId":"AP-3005","vendorId":"V-100","invoiceNumber":"NP-2026-0417","poId":"PO-1042","amount":6000,"currency":"EUR","postedAt":"2026-09-28","status":"open"}}
```

The trace is the whole match in two seconds and no judgment: the mail,
the vendor by the sender's name, the ledger, the order, its receipts,
the post.

<details>
<summary>the trace of the matched invoice</summary>

```
$ cernanto trace examples/workflows/invoice-approval
Invoice Approval · Handle next invoice  ok  2.1s  examples_workflows_invoice_approval:20057:c-d06deeed-3ca0-49ba-af4b-cf935b5f9c2f
2026-09-28 06:35:31

06:35:31  ← Gateway
            Handle next invoice
...
06:35:31  → Inbox
            Wait for mail
            Account:        billing
            Has Attachment: true
            Timeout Ms:     86400000
06:35:33  ← Inbox  2.0s  examples_sandbox_inbox:20020:c-d06deeed-3ca0-49ba-af4b-cf935b5f9c2f-5
            Message Id:  <eff97050-7dfb-408f-a3b5-1f4284138e3a@nordwind-paper.example>
            From:
              Address: invoices@nordwind-paper.example
              Name:    Nordwind Paper GmbH
            ...
            Attachments:
              - Name:         NP-2026-0417.pdf
                Content Type: application/pdf
                Size:         1283

06:35:33  → Purchasing
            Vendor
            Name: Nordwind Paper GmbH
06:35:33  ← Purchasing  7ms  examples_sandbox_purchasing:20058:c-d06deeed-3ca0-49ba-af4b-cf935b5f9c2f-6
            Vendor Id:          V-100
            Name:               Nordwind Paper GmbH
            ...

06:35:33  → Purchasing
            Ledger entries
06:35:33  ← Purchasing  3ms  examples_sandbox_purchasing:20058:c-d06deeed-3ca0-49ba-af4b-cf935b5f9c2f-7
            - Entry Id:       AP-3001
            ...

06:35:33  → Purchasing
            Purchase order
            Po Id: PO-1042
06:35:33  ← Purchasing  2ms  examples_sandbox_purchasing:20058:c-d06deeed-3ca0-49ba-af4b-cf935b5f9c2f-8
            Po Id:     PO-1042
            Vendor Id: V-100
            Total:     6000
            Lines:
              - Line:        1
                Description: A4 copy paper, 80 g, box of 2500
                Quantity:    200
                Unit Price:  24.5
            ...

06:35:33  → Purchasing
            Receipts of
            Po Id: PO-1042
06:35:33  ← Purchasing  2ms  examples_sandbox_purchasing:20058:c-d06deeed-3ca0-49ba-af4b-cf935b5f9c2f-9
            - Receipt Id:  GR-2201
              Lines:
                - Line:              1
                  Quantity Received: 200
            ...

06:35:33  → Purchasing
            Post invoice
            Vendor Id:      V-100
            Invoice Number: NP-2026-0417
            Po Id:          PO-1042
            Amount:         6000
            Currency:       EUR
06:35:33  ← Purchasing  3ms  examples_sandbox_purchasing:20058:c-d06deeed-3ca0-49ba-af4b-cf935b5f9c2f-10
```

</details>

The second sample, `HK-77812`, bills PO-1043's espresso beans at 31.00
instead of the order's 28.50: the lines match, the total is 8.8 % over,
past the 2 % tolerance. This is where the judgments are: a paragraph
explaining the difference, and whether the lines describe the same
goods. Give Lior a minute to answer, call the desk again and deliver
it the same way; the question goes to Lior, the approver for amounts
up to five thousand euros, in his conversation:

```
$ cernanto call examples/workflows/invoice-approval handleNextInvoice approvalWindowMinutes:=1
                                                        # parks until an invoice arrives
$ PDF=$(base64 -i examples/sandbox/purchasing/data/invoices/HK-77812.pdf | tr -d '\n')
$ cernanto call examples/sandbox/inbox deliverMail --args "{\"address\":\"billing@acmeledgers.example\",\"mail\":{\"from\":{\"address\":\"buchhaltung@hafenkaffee.example\",\"name\":\"Hafen Kaffee Roesterei\"},\"subject\":\"Invoice HK-77812\",\"text\":\"Please find attached our invoice HK-77812.\",\"attachments\":[{\"name\":\"HK-77812.pdf\",\"contentType\":\"application/pdf\",\"contentBase64\":\"$PDF\"}]}}"
$ sleep 45; cernanto call examples/sandbox/chat read chat="@lior"
[... {"from":{"id":"@acme"},"text":"Lior Katz, an invoice needs your approval. Invoice HK-77812 from Hafen Kaffee Roesterei for 1860 EUR (1860.00 EUR), purchase order PO-1043, due 2026-10-02.\n\nInvoice HK-77812 from Hafen Kaffee Roesterei (V-101) bills 60 kg of espresso beans at 31.00 EUR per kg, for a total of 1,860.00 EUR, while purchase order PO-1043 authorised the same 60 kg at 28.50 EUR per kg, for a total of 1,710.00 EUR. ...\n\nThe invoice's lines describe the same goods as the order's.\nReply in this thread to approve or reject it."}]
```

Forty-five seconds in, Lior's conversation holds the question (the
first call boots the desk, then it reads the invoice and judges the
lines). Answer as Lior, in the thread or beside it, and the first
terminal answers `approved` with the ledger entry:

```
$ cernanto call examples/sandbox/chat send account=lior chat="@lior" text="Approved, the price rise was agreed in August."
$                                                       # the first terminal answers:
{"outcome":"approved","invoice":{"vendor":"Hafen Kaffee Roesterei","vendorId":"V-101","invoiceNumber":"HK-77812","purchaseOrder":"PO-1043","currency":"EUR","total":1860,"totalEur":1860,"invoiceDate":"2026-09-18T00:00:00.000Z","dueDate":"2026-10-02T00:00:00.000Z","lines":[{"description":"Espresso beans, 1 kg","quantity":60,"unitPrice":31,"amount":1860}]},"explanation":"Invoice HK-77812 from Hafen Kaffee Roesterei (V-101) bills 60 kg of espresso beans at 31.00 EUR per kg, totalling 1,860.00 EUR, while purchase order PO-1043 authorised the same 60 kg at 28.50 EUR per kg, totalling 1,710.00 EUR. The quantity matches, and goods receipt GR-2202 (received 2026-09-16) confirms all 60 kg were delivered, so the discrepancy is entirely in the unit price: the invoice is 2.50 EUR per kg higher than the PO, which adds up to 150.00 EUR (about 8.8% above the PO total) and falls well outside the 2% tolerance. The context gives no explanation for the price increase, such as an agreed amendment to the PO, so that would need to be clarified with the vendor or the buyer. Vendor, currency, and PO reference all match. Because the invoice total of 1,860.00 EUR falls in the band up to 5,000 EUR, approval sits with Lior Katz (@lior).","sameGoods":true,"ledgerEntry":{"entryId":"AP-3006","vendorId":"V-101","invoiceNumber":"HK-77812","poId":"PO-1043","amount":1860,"currency":"EUR","postedAt":"2026-09-28","status":"open"}}
```

The third, `TL-5590`, names PO-9999, which the store does not hold, and
is in pounds. The explanation says so, there is no order to judge the
goods against, and the question reaches Rami, the approver for the
euro amount. Nobody answers: the reminder follows after the window and
the escalation to Dana, the controller, after the second, and the
desk answers on its own. Back to the quarter-minute window first:

```
$ cernanto call examples/workflows/invoice-approval handleNextInvoice approvalWindowMinutes:=0.25
                                                        # parks until an invoice arrives
$ PDF=$(base64 -i examples/sandbox/purchasing/data/invoices/TL-5590.pdf | tr -d '\n')
$ cernanto call examples/sandbox/inbox deliverMail --args "{\"address\":\"billing@acmeledgers.example\",\"mail\":{\"from\":{\"address\":\"accounts@thameslighting.example\",\"name\":\"Thames Lighting Ltd\"},\"subject\":\"Invoice TL-5590\",\"text\":\"Please find attached our invoice TL-5590.\",\"attachments\":[{\"name\":\"TL-5590.pdf\",\"contentType\":\"application/pdf\",\"contentBase64\":\"$PDF\"}]}}"
$                                                       # the first terminal answers after the two windows:
{"outcome":"escalated","invoice":{"vendor":"Thames Lighting Ltd","vendorId":"V-102","invoiceNumber":"TL-5590","purchaseOrder":"PO-9999","currency":"GBP","total":820,"totalEur":954.81,"invoiceDate":"2026-09-20T00:00:00.000Z","dueDate":"2026-10-20T00:00:00.000Z","lines":[{"description":"Desk lamp, LED, dimmable","quantity":15,"unitPrice":54,"amount":810},{"description":"Shipping","quantity":1,"unitPrice":10,"amount":10}]},"explanation":"Invoice TL-5590 from Thames Lighting Ltd (V-102), totaling GBP 820.00 (about EUR 954.81), cites purchase order PO-9999, but no such purchase order exists in the system, so there is nothing to compare its lines, prices, or quantities against. There are also no goods receipts on file, so there is no confirmation that the 15 LED dimmable desk lamps (at 54.00 each, 810.00) or the 10.00 shipping charge were ever delivered. The invoice cannot be matched or verified on either count. Because the EUR total is under 1,000, it falls in Rami Ben-Ari's approval band (@rami), but the missing PO and receipts should be resolved before approving. Whether the PO number was mistyped or the order was never raised is not something the available information settles."}
$ cernanto call examples/sandbox/chat read chat="@rami"
[... {"text":"Rami Ben-Ari, an invoice needs your approval. Invoice TL-5590 from Thames Lighting Ltd for 820 GBP (954.81 EUR), purchase order PO-9999, due 2026-10-20. ..."},
     {"text":"Reminder: invoice TL-5590 from Thames Lighting Ltd still awaits your approval or rejection."}]
$ cernanto call examples/sandbox/chat read chat="@dana"
[... {"text":"Dana Swope, invoice TL-5590 is escalated to you: Rami Ben-Ari did not answer within the approval window after a reminder. Invoice TL-5590 from Thames Lighting Ltd for 820 GBP (954.81 EUR), purchase order PO-9999, due 2026-10-20. ..."}]
```

A run leaves its marks in the sandbox: the matched invoice is on the
ledger, so delivering it again answers `duplicate`. The store's memory
lives for the life of its deployed version: `cernanto delete
examples/sandbox/purchasing --force` (the desk that uses it stays
deployed) and `cernanto deploy examples/sandbox/purchasing` again seed
it afresh.

The desk's tests make each case's PDF themselves (with `pdf-lib`, a
package only the tests grant), deliver it into the billing mailbox as
the vendor's mail for a purchase order the store holds, and answer as
Rami in his conversation. The Tests section names the three roads they
prove, in about a minute: a matching invoice in pounds posts once at
its date's rate while a mail to the default mailbox is never picked up,
and the same invoice delivered again is a duplicate; an overpriced
invoice parks for Rami and posts after his approval; an invoice billing
more than was received is a mismatch and posts nothing when he rejects
it. The reminder and the escalation are the walkthrough's to show, with
the window set to a minute. `cernanto tests
examples/workflows/invoice-approval` shows the tests.

## Make it yours

The desk is the spec, its folder (`approvers.json`, this README) and
the package under `examples/workflows/.cern/`. Copy them into a workspace of
your own, keeping the `examples/workflows/` path, and deploy from there; the
package lands as it is.

<!-- lab exercise -->

```
$ mkdir -p ../my-agents/examples/workflows/.cern
$ cp examples/workflows/invoice-approval.cern.md ../my-agents/examples/workflows/
$ cp -R examples/workflows/invoice-approval ../my-agents/examples/workflows/
$ cp examples/workflows/.cern/invoice-approval.cern ../my-agents/examples/workflows/.cern/
$ (cd ../my-agents && cernanto deploy examples/workflows/invoice-approval)
landed 1 package; nothing to compile
```

The id is the path, so the copy deploys the same agent your plane
already runs; a second desk beside it is the spec under another name
(the file and, for its `file:` grants, its folder), a fresh compile under
the new id, and `cernanto delete <id>` retires the old one.

- **The data.** `approvers.json` is the approver table: the amount
  bands, who approves each, the tolerance, the controller; edit it and
  deploy.
- **The settings.** The approval window is the `approvalWindowMinutes`
  a call gives, else `examples/workflows/invoice-approval/approval-window-minutes`, else two days;
  the mailbox `examples/workflows/invoice-approval/email`, the providers `connectors/email/default` and
  `connectors/chat/default`; read at each call.
- **The policy.** The sentences of the spec. Escalate as soon as the
  window passes, with no reminder, and deploy: an amend. Then the third
  sample again, the one nobody answers (it was never posted, so it is
  not a duplicate): one window instead of two.

<!-- lab edit ../my-agents/examples/workflows/invoice-approval.cern.md
When the window
passes, remind the approver once; when it passes again, escalate to the
controller the table names and stop waiting.
=>
When the window
passes, escalate to the controller the table names and stop waiting.
-->

```
$ (cd ../my-agents && cernanto deploy examples/workflows/invoice-approval)
```

<!-- lab exercise -->

```
$ cernanto call examples/workflows/invoice-approval handleNextInvoice approvalWindowMinutes:=0.25
$ PDF=$(base64 -i examples/sandbox/purchasing/data/invoices/TL-5590.pdf | tr -d '\n')
$ cernanto call examples/sandbox/inbox deliverMail --args "{\"address\":\"billing@acmeledgers.example\",\"mail\":{\"from\":{\"address\":\"accounts@thameslighting.example\",\"name\":\"Thames Lighting Ltd\"},\"subject\":\"Invoice TL-5590\",\"text\":\"Please find attached our invoice TL-5590.\",\"attachments\":[{\"name\":\"TL-5590.pdf\",\"contentType\":\"application/pdf\",\"contentBase64\":\"$PDF\"}]}}"
$                                                       # the first terminal answers after one window:
{"outcome":"escalated","invoice":{"number":"TL-5590","purchaseOrder":"PO-9999",...},"explanation":"The purchase order PO-9999 is not in the purchasing store..."}
```

- **Your application** asks for the next invoice through the plane's
  gateway, as the support desk's recipe shows; each call parks until the
  next invoice mail arrives and answers what happened to it, so a
  system calls it in a loop.

## The real form

Mail from Gmail, chat on Slack, purchasing in a database. The mail and
the chat are settings; purchasing is a grant.

**The mail.** The desk reads the mailbox `examples/workflows/invoice-approval/email` names
(`billing` when it names none) on the provider `connectors/email/default`
names, so Gmail is one setting:

```
$ cernanto config connectors/email default=connectors/google/gmail
```

The next call parks on the Google client's ask: a Google Cloud
project's OAuth client, then the browser sign-in of the account named
`billing`. With one Google account, log that account in as `billing`:

```
$ cernanto auth login connectors/google/client billing
```

With two, the office account is the default, logged in when any Google
connector first asks for it, and the billing mailbox is its own
account, logged in as `billing` when this desk asks; `cernanto
auth list` shows both under the client's id. The Google Cloud steps
are in `connectors/google/README.md`.

**The chat.** `cernanto config connectors/chat default=connectors/slack`,
and the approvers' conversations in `approvers.json` become their
Slack user ids (`U…`): the desk asks each approver in a direct message.
Log the Slack app in when the desk first asks; its steps are in
`connectors/slack/README.md`.

**Purchasing.** The sandbox store becomes a PostgreSQL database with
the purchasing tables, `purchasing.sql` beside this README: the
vendors, the purchase orders and their lines, the goods receipts and
the accounts-payable ledger, seeded with the sandbox's rows. Load it
into a free Neon or Supabase database, then change the grant and give
the coder the schema:

```
$ psql "$DATABASE_URL" -f examples/workflows/invoice-approval/purchasing.sql
```

```diff
 Uses:

 - connectors/email
 - connectors/chat
 - connectors/frankfurter
-- examples/sandbox/purchasing
+- connectors/postgres
+- file:invoice-approval/purchasing.sql
 - file:invoice-approval/approvers.json
 - npm:pdf-parse
 - cernanto/config
 - cernanto/decision
 - cernanto/llm
```

with one sentence of the prose saying where the purchase orders live:

```diff
-Find the purchase order and its goods receipts. The invoice matches
+Find the purchase order and its goods receipts in the purchasing
+database, whose tables the granted schema describes. The invoice matches
```

The tests of the real form play the vendor through Gmail's second
account, the approver through the second Slack app, and read the
database:

```diff
 ## Tests

 Uses:

-- examples/sandbox/inbox
-- examples/sandbox/chat
-- examples/sandbox/purchasing
+- connectors/google/gmail
+- connectors/slack
+- connectors/postgres
 - connectors/frankfurter
 - cernanto/config
 - npm:pdf-lib
```

and the prose changed where it names the sandbox: the invoice mail is
sent to the billing account's own address, which the Gmail connector
answers, from the account connected under the name `tester`; the
approver named for amounts under a thousand euros answers in his
direct message as the second Slack app; a purchase order the tests
need is read from the database. Then `cernanto deploy
examples/workflows/invoice-approval`: the amend adapts the purchasing calls to
the database and the tests run on the real mailbox, workspace and
database, each account asked for on its first use, the database url on
the first read.
