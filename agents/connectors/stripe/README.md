# Stripe

`connectors/stripe` refunds a payment once per order, answers a
payment's and an invoice's status, and waits for the next payment
event (a payment that succeeded or failed, a refund made), delivered
through a webhook endpoint the connector registers at its own url. The
account is a restricted key of a Stripe account in test mode.

## Connect

Nothing is set up in advance: the first call asks for the key, in the
terminal that made the call and under `cernanto auth list`, with
the steps the compile read from Stripe's own documentation. As Stripe's
dashboard stands today (a new account works in a sandbox, its test
environment, with no activation):

1. Sign in at https://dashboard.stripe.com, in the sandbox.
2. Open API keys (under Developers, or the shortcut in the sidebar)
   and press "Create secret key".
3. Choose "Building your own integration" and continue; name the key
   and set every resource to None except Write on Payment Intents,
   Charges, Refunds and Webhook Endpoints, and Read on Invoices and
   Events.
4. Press "Create key", copy the key at once (Stripe never shows it
   again) and paste it into the field the ask shows.

Answer the ask where it printed, or from another terminal:

```
$ cernanto auth login connectors/stripe
```

Nothing else is pasted: the first wait registers the webhook endpoint
at the connector's own url, keeps its signing secret as a second
account named `webhook`, and believes a delivery only after checking
it against that secret. A key Stripe refuses is asked for again with
Stripe's words.

## Verify it

The connector's own tests need one account and one fixture, a
test-mode payment to refund: create a payment in the test dashboard
(a payment intent, `pi_…`, paid with a test card) and name it in the
configuration. Each run refunds one unit of its currency under a fresh
order id, asks the same refund again and gets the same one back, and
sees the refund's event arrive through the endpoint.

```
$ cernanto config connectors/stripe/tests payment=pi_3Q...
$ cernanto deploy connectors/stripe
```

## Use it

```
$ cernanto call connectors/stripe paymentStatus id=pi_3Q...
$ cernanto call connectors/stripe refundPayment paymentId=pi_3Q... orderId=A-1007 amount:=100
$ cernanto call connectors/stripe waitForPaymentEvent timeoutMs:=120000
```

The refund desk's real form grants it beside the shop's database;
`examples/workflows/refund-desk/README.md` shows the diff.
