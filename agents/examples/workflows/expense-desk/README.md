# Expense desk

A receipt arrives as a picture attached to a mail, and the desk reads
it off the picture itself: the merchant, the date and the total, one
judgment each, with no text extraction in between. The policy is code
(two hundred euros or less), the reply goes back to the sender, and a
picture that is no receipt is asked again. The picture is a value in the judgment's context, the mail
attachment as the inbox handed it, and the model sees the photo.

The spec is `../expense-desk.cern.md`; `receipts/coffee.png` beside
this README is the receipt the walkthrough sends.

```
$ cernanto deploy examples/workflows/expense-desk
```

Start a call: it waits on the expenses mailbox for the next mail with
a picture. In a second terminal, deliver the receipt as a claimant's
mail through the sandbox inbox:

```
$ cernanto call examples/workflows/expense-desk handleNextExpense
$ PNG=$(base64 -i examples/workflows/expense-desk/receipts/coffee.png | tr -d '\n')
$ cernanto call examples/sandbox/inbox deliverMail --args "{\"address\":\"expenses@acmeledgers.example\",\"mail\":{\"from\":{\"address\":\"ada@example.com\",\"name\":\"Ada Lovelace\"},\"subject\":\"Expense claim: coffee with the client\",\"text\":\"Please reimburse the attached receipt.\",\"attachments\":[{\"name\":\"coffee.png\",\"contentType\":\"image/png\",\"contentBase64\":\"$PNG\"}]}}"
"<0440dc70-ed06-4a2c-a12f-9879ce057f73@example.com>"
$                                                       # the first terminal answers
{"status":"approved","merchant":"Hafen Kaffee","date":"2026-09-12","total":14.9}
```

The trace reads as the desk's day: the wait, the mail with its
attachment, the three readings off the picture, and the reply.

```
$ cernanto trace examples/workflows/expense-desk
Expense Desk · Handle next expense  ok  10.9s
08:08:59  → Inbox
            Wait for mail
            Filter:
              Has Attachment: true
              Timeout Ms:     600000
            Account: expenses
08:09:03  ← Inbox  4.0s
            Attachments:
              - Name:           coffee.png
                Content Type:   image/png
                Size:           36219
08:09:03  → LLM
            Llm concise
            Prompt: What is the name of the merchant on the receipt in the picture?
08:09:09  ← LLM  6.8s
            Hafen Kaffee
08:09:03  → LLM
            Llm date
            Prompt: On what date was the purchase made, per the receipt in the picture?
08:09:09  ← LLM  6.8s
            2026-09-12
08:09:03  → LLM
            Llm number
            Prompt: What is the total paid, in euros, per the receipt in the picture?
08:09:09  ← LLM  6.8s
            14.9
08:09:09  → Inbox
            Reply
            Text:       Your expense is approved: Hafen Kaffee, 2026-09-12, total 14.9 EUR.
```

Under each `→ LLM` line, `cernanto trace <the reading's call id>`
shows what the model was handed: the context with the picture in its
place, `Receipt: image 1 (image/png, 35.4 KB) "coffee.png"`, the
attachment beside the prompt, and the model's answer. The mail's text
names no merchant and no total: each reading is of the picture, not of
a story about it.

Two more roads the desk's tests prove: a receipt over two hundred
euros is refused for the amount, and a picture with no words on it is
asked again. The tests draw their receipts themselves and deliver
them into the sandbox's expenses mailbox.

## Make it yours

Change the policy sentence in the spec (the amount, a limit on the
receipt's age, a category rule) and `cernanto deploy
examples/workflows/expense-desk` amends the desk; the readings stay one
judgment per field. Ask for more off
the receipt (the VAT, the payment method, the items) by naming them in
the spec and in the answer: each is one more judgment over the same
picture. A scanned receipt as a PDF rides the same way: the judgment
sees the pages.

## The real form

The mailbox is a setting, `connectors/email/default`, as the invoice desk's
README shows: connect a Gmail account under the name `expenses`
(`connectors/google/gmail`) and set the provider; the claimants mail
their receipts, and every reply goes out from the account. Nothing in
the spec changes.
