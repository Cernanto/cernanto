# Renewal desk

The person who renegotiates the yearly contracts: a vendor's support
contract in a company, the car insurance in a home. Given a contract
nearing its end, the desk mails the provider's contact for a renewal
quote and waits for the answer, up to a week; a quote at or below the
target price the CRM holds is accepted, a quote above it gets one
counter at the target and a second wait; the outcome, renewed at a
price, declined, or no answer, is recorded on the contract and the
owner is told on the renewals channel. The conversation an agent
starts, in order: send, wait, follow up, in the spec and in the code.
The spec is `../renewal-desk.cern.md`.

Everything below runs from the `agents/` folder against the dev
plane, on the sandbox CRM, inbox and chat, with no account.

## 1. Run it

```
$ cernanto deploy examples/workflows/renewal-desk
```

The contracts due, by the days asked for (thirty when none is given,
or the configuration's `examples/workflows/renewal-desk/notice-days`):

```
$ cernanto call examples/workflows/renewal-desk contractsDueForRenewal days:=200
[{"id":"C-2024-018","company":"Skandia Bygg AB","endAt":"2026-11-30","value":48000,"targetPrice":45000, ...},
 {"id":"C-2025-003","company":"Fjord Logistics AS","endAt":"2026-12-15","value":26500,"targetPrice":25000, ...}, ...]
```

Renew one, with a minute's reply window instead of a week; the call
parks on the provider's answer, which you play from a second terminal
by delivering the provider's mail into the sandbox inbox, in reply to
the quote request the desk sent:

```
$ cernanto call examples/workflows/renewal-desk renewContract contractId=C-2025-003 replyWindowMinutes:=1
                                                        # parks: the quote request is out, the desk waits
$ cernanto call examples/sandbox/inbox listMails
{"received":[...],"sent":[... {"messageId":"<c485458e-...@acmeledgers.example>","to":[{"address":"henrik.aas@fjordlogistics.example"}],"subject":"Renewal quote for contract C-2025-003", ...}]}
$ cernanto call examples/sandbox/inbox deliverMail --args '{"address":"office@acmeledgers.example","mail":{"from":{"address":"henrik.aas@fjordlogistics.example","name":"Henrik Aas"},"subject":"Re: Renewal quote for contract C-2025-003","text":"Hello, for the coming year we can offer 27500 EUR. Regards, Henrik","inReplyTo":"<c485458e-...@acmeledgers.example>"}}'
```

The quote is above the target, so the desk counters once and waits
again; answer at the target and the call returns:

```
$ cernanto call examples/sandbox/inbox listMails
{... "sent":[... {"messageId":"<7929f5b6-...@fjordlogistics.example>","subject":"Re: Renewal quote for contract C-2025-003","text":"Thank you for your quote. We can renew at 25000 EUR. Could you confirm that price?"}]}
$ cernanto call examples/sandbox/inbox deliverMail --args '{"address":"office@acmeledgers.example","mail":{"from":{"address":"henrik.aas@fjordlogistics.example","name":"Henrik Aas"},"subject":"Re: Renewal quote for contract C-2025-003","text":"Understood. We can do 25000 EUR for the year.","inReplyTo":"<7929f5b6-...@fjordlogistics.example>"}}'
$                                                       # the first terminal answers:
{"contractId":"C-2025-003","outcome":"renewed","price":25000}
$ cernanto call examples/sandbox/crm getContract id=C-2025-003
{"id":"C-2025-003", ..., "renewal":{"outcome":"renewed","price":25000}}
$ cernanto call examples/sandbox/chat read chat="#renewals"
[... {"from":{"name":"acme"},"text":"Ines Moreau: the renewal of contract C-2025-003 (Fjord Logistics AS) is renewed at 25000 EUR."}]
```

A second quote still above the target, or a refusal, declines the
renewal; no answer within the window is recorded as no answer. The
trace reads the whole call as a conversation: the contract read, the
mail sent, the wait from the position of that mail, the quote read by
one judgment, the counter, the second wait, the outcome recorded, the
post.

## 2. Interrupt it

The waits are the mail connector's own, and the call parks on them,
so a restart of the plane during the week-long wait changes nothing: the
answer that arrives after the plane is back resumes the call where it
parked, with the quote request sent once and the quote read once.

```
$ cernanto call examples/workflows/renewal-desk renewContract contractId=C-2024-018 replyWindowMinutes:=5
$ cernanto dev down && cernanto dev      # from a second terminal, mid-wait
$ cernanto call examples/sandbox/inbox deliverMail --args '{...the quote at the target, in reply to the request...}'
```

## 3. The settings

The reply window is `examples/workflows/renewal-desk/reply-window-minutes` (a week when
unset), the notice days `examples/workflows/renewal-desk/notice-days` (thirty), the renewals
channel `examples/workflows/renewal-desk/channel` (`#renewals`), the mail provider
`connectors/email/default` and the chat provider `connectors/chat/default`.

## The real forms

The company's: `connectors/email/default` to `connectors/google/gmail`,
`connectors/chat/default` to `connectors/slack`, and the CRM to
`connectors/hubspot` behind the contracts. The homelab's: the
contracts are the person's subscriptions and insurances in a granted
JSON file, and the owner is told on their phone through
`connectors/ntfy`.
