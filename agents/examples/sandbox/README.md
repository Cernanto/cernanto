# Sandbox

The fictional company the workflows run against: Acme Ledgers, eleven
people in Berlin, a storefront and a ledger. Its systems are services
that hold one system each, seeded from the files beside them and
answering the way the real system would. They are real agents with
real memory and real contracts, safe to play with, never published. A
workflow binds `examples/sandbox/inbox` today and a mail provider tomorrow,
because the stores implement the same interfaces the providers do.

| id                            | type                                    | holds or does                                                                                                                                          | the waits it exports                                                                                   |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `examples/sandbox/inbox`      | service, `Implements: connectors/email` | the company's mailboxes, `default` and `billing`, and one per account name used since; everything sent kept; a vendor's mail taken in from outside     | `waitForMail` and `waitForMails`, by sender, subject, thread or attachment, from a mail or a moment    |
| `examples/sandbox/chat`       | service, `Implements: connectors/chat`  | one workspace: channels (`#support`) and people (`@noa`); every account name is a person, the default is `@acme`; a person's answer taken in as a post | `waitForMessage` and `waitForMessages`, by sender, text, thread or mention, from a message or a moment |
| `examples/sandbox/orders`     | service                                 | the shop: orders with their payments and invoices, the exceptions queue, a second charge, refunds made once per order                                  | `waitForFailedPayment`                                                                                 |
| `examples/sandbox/purchasing` | service                                 | purchase orders with their lines, goods receipts, the vendor master, the accounts payable ledger, three sample invoice PDFs                            | none                                                                                                   |
| `examples/sandbox/crm`        | service                                 | leads and tickets with their owners, categories and responses; contacts; contracts by end date                                                         | `waitForNewLead`, `waitForNewTicket`, `waitForTicketResponse`                                          |

Every store seeds itself from its data folder (`inbox/mail/`,
`orders/data/`, `purchasing/data/`, `crm/data/`); the chat starts
empty. A store's memory lives for the life of its deployed version, so
`cernanto delete examples/sandbox/orders` and a deploy again is a fresh shop.

```
$ cernanto deploy examples/sandbox/inbox
$ cernanto call examples/sandbox/inbox listMailboxes
[{"name":"default","address":"office@acmeledgers.example","displayName":"Acme Ledgers"},{"name":"billing","address":"billing@acmeledgers.example","displayName":"Acme Ledgers Billing"}]
```

Two terminals show a wait waking on a delivery from the outside world:

```
$ cernanto call examples/sandbox/inbox waitForMail account=billing hasAttachment:=true timeoutMs:=30000
                                                        # parks here
$ PDF=$(base64 -i examples/sandbox/purchasing/data/invoices/HK-77812.pdf | tr -d '\n')
$ cernanto call examples/sandbox/inbox deliverMail --args "{\"address\":\"billing@acmeledgers.example\",\"mail\":{\"from\":{\"address\":\"buchhaltung@hafenkaffee.example\",\"name\":\"Hafen Kaffee Roesterei\"},\"subject\":\"Invoice HK-77812\",\"text\":\"Please find our invoice attached.\",\"attachments\":[{\"name\":\"HK-77812.pdf\",\"contentType\":\"application/pdf\",\"contentBase64\":\"$PDF\"}]}}"
"<73300549-df44-4dd5-a23f-9146a083acf0@hafenkaffee.example>"
$                                                       # the first terminal answers the mail, its attachment included
```

The chat's wait for a mention skips a plain post and answers the one
that names the account:

```
$ cernanto call examples/sandbox/chat waitForMessage chat="#support" mentioned:=true timeoutMs:=30000
                                                        # parks here
$ cernanto call examples/sandbox/chat send account=noa chat="#support" text="Morning all, the password reset mails are delayed again."
{"delivered":true,"id":"m6"}
$ cernanto call examples/sandbox/chat send account=noa chat="#support" text="@acme can you look at ticket T-7003?"
{"delivered":true,"id":"m7"}
$                                                       # the first terminal answers:
{"id":"m7","chat":"#support","from":{"id":"@noa","name":"noa"},"text":"@acme can you look at ticket T-7003?","mentionsMe":true,"postedAt":"2026-09-28T12:47:54.566Z"}
```

The shop: a card ending in 0000 fails its payment, which wakes the
wait for the next failed payment; a refund is made once however often
it is asked; a second charge pays.

```
$ ORDER=$(cernanto call examples/sandbox/orders placeOrder --args '{"customerName":"Erik Hansen","customerEmail":"erik.hansen@example.dk","items":[{"name":"Ink bottle","quantity":2}],"total":22,"cardLastFour":"0000"}' -q | sed -E 's/^\{"id":"([^"]+)".*/\1/')
$ cernanto call examples/sandbox/orders getOrder orderId="$ORDER"
{"id":"A-1013","customer":{"name":"Erik Hansen","email":"erik.hansen@example.dk"},"items":[{"name":"Ink bottle","quantity":2}],"placedAt":"2026-09-28","deliveredAt":null,"status":"exception","total":22,"currency":"EUR","payment":{"id":"pay_9013","status":"failed"}}
$ cernanto call examples/sandbox/orders refundOrder orderId=A-1007 amount:=29
{"id":"rf_de16eb37-5c72-4e9e-a102-8eaff65d7955","orderId":"A-1007","amount":29}
$ cernanto call examples/sandbox/orders refundOrder orderId=A-1007 amount:=29
{"id":"rf_de16eb37-5c72-4e9e-a102-8eaff65d7955","orderId":"A-1007","amount":29}
$ cernanto call examples/sandbox/orders retryPayment orderId="$ORDER"
{"id":"A-1013","customer":{"name":"Erik Hansen","email":"erik.hansen@example.dk"},"items":[{"name":"Ink bottle","quantity":2}],"placedAt":"2026-09-28","deliveredAt":null,"status":"placed","total":22,"currency":"EUR","payment":{"id":"pay_9013","status":"paid"}}
```

(The new order's id depends on what the shop already holds, so it is
kept in a variable; the shown ids are one run's.)

Purchasing posts an invoice once per vendor and number, and hands out
the sample invoice PDFs by name (`NP-2026-0417` matches purchase order
PO-1042, `HK-77812` is over PO-1043's price, `TL-5590` names a
purchase order that does not exist):

```
$ cernanto call examples/sandbox/purchasing postInvoice --args '{"vendorId":"V-100","invoiceNumber":"NP-2026-0099","poId":"PO-1042","amount":120,"currency":"EUR"}'
{"entryId":"AP-3004","vendorId":"V-100","invoiceNumber":"NP-2026-0099","poId":"PO-1042","amount":120,"currency":"EUR","postedAt":"2026-09-28","status":"open"}
$ cernanto call examples/sandbox/purchasing receiptsOf poId=PO-1042
[{"receiptId":"GR-2201","poId":"PO-1042","receivedAt":"2026-09-12","lines":[{"line":1,"quantityReceived":200},{"line":2,"quantityReceived":12},{"line":3,"quantityReceived":1}]}]
```

`cernanto contract examples/sandbox/<store>` prints every function with what it
takes and answers; `cernanto code examples/sandbox/<store>` the code the compile
wrote, and `cernanto tests examples/sandbox/<store>` the tests it proved live
against the seeds.
