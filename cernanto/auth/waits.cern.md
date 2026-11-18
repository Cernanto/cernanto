# cernanto/auth/waits

The waiting room of the plane's safe, a service, and the keeper of the
asks the safe's calls wait on. `cernanto/auth` tells this agent when
something was stored under an account and when a provider calls an
authorization back, and a call of the safe that must wait for one of
those waits here, so it wakes the moment the arrival lands. A wait an
operator must answer carries its ask, and this agent shows the ask to
the operator for as long as the wait is held.

## Who it serves

Serve the safe alone. Read the calling agent from the call itself, at
the top of every function. An id that ends in
`-tester-<compile>-r<round>` or `-under-test-<compile>-r<round>` is the
id before that ending, a tester or a test form standing for its agent:
read the caller's id so, and this agent's own id so as well, since
while it is verified this agent runs under a test form's name itself.
The safe is `cernanto/auth`, and this agent's own tester, a caller
whose id read so is this agent's own id read so, is served beside it.
Refuse every other caller, and a call with no calling agent, with
exactly `the waiting room is the safe's alone`.

## What it is told

`accountConnected` takes `{account, stored}`: the name of an account
the safe stored something under, and what it stored, `fields` for the
account's setup fields or `value` for its value. `oauthCalledBack`
takes `{state, code, error}`, a provider's callback as the safe
received it. Stamp each arrival with this agent's own clock in
milliseconds, keep the newest 1024 arrivals of each kind, wake every
call waiting for it, and answer `{at}`, the stamp.

## What waits here

`mark` takes nothing and answers `{at}`, this agent's own clock in
milliseconds now. Tell the consumer, in the contract, to take a mark
BEFORE looking at its own data and to pass it to a wait as `after`, so
that an arrival landing between the look and the wait still counts.

`waitForAccount` takes `{account, after}` and answers the oldest
arrival whose account equals `account` and whose stamp is at or after
the mark, whatever it stored, as `{account, at}`. Answer at once when
such an arrival is already held, otherwise when it lands; a stamp equal
to the mark counts. It takes an optional `timeoutMs`, and when that
time passes first the answer is `{timedOut: true}`. Many calls wait at
once, for one account or for many, and each is answered by the arrival
it waits for.

## The asks

AN ASK is what an operator reads to answer a call that waits, free of
values, one record as the safe hands it: `{id, kind, agent, name,
provider, agentId, callId, instructions?, fields?, helpUrl?, scopes?,
authorizationUrl?, message?, refused?}`, `id` the safe's own word for
the ask, `kind` one of `fields`, `oauth` and `display`, `agent` and
`name` the account it is for, whose name as an arrival tells it is
`<agent>#<name>`, and `fields` a list of `{name, label, secret?}`. Keep
every ask as it was handed, with `requestedAt`, this agent's own clock
when it took the ask, and tell the consumer in the contract what each
of the three ways below is for.

`askForFields` takes `{ask, after}`, a `fields` ask and an optional
mark, and waits as `waitForAccount` does for an arrival of the ask's
account that stored `fields`: at or after the mark when one is given,
and with no mark the next one to land after this call began, so an ask
made for a credential that was refused is answered only by a store
that follows it. The answer is that arrival, `{account, at}`. It takes
an optional `timeoutMs` and answers `{timedOut: true}` when that time
passes first.

`waitForOauthCallback` takes `{state, after, ask}`, the `oauth` ask of
the authorization that waits, and answers the oldest callback whose
state equals `state` and whose stamp is at or after the mark, as
`{state, code, error, at}`, at once when such a callback is already
held, otherwise when it lands; a stamp equal to the mark counts. When
the newest callback held for the state is stamped before the mark, the
state was used before this call began: answer `{spent: true}` at once.
It takes an optional `timeoutMs` and answers `{timedOut: true}` when
that time passes first.

`showAsk` takes `{ask}`, a `display` ask, keeps it and answers `{at}`
at once: nothing waits on it.

AN ASK IS PENDING from the moment it is taken: a `fields` or an `oauth`
ask until its wait is answered, a `display` ask until an arrival of its
account that stored `value` lands. An arrival that stored `value` also
ends the `oauth` asks of its account as asks, while their waits go on
for their callbacks. A wait that times out takes its ask with it,
pending no more and not ended. Remember the `id` and the `kind` of the
newest 1024 asks that ended, and keep the newest 1024 `display` asks
that are pending.

`asks` takes an optional `agent` and answers `{asks}`: the pending
asks, for every agent or for the one named, one for an account and a
kind, the one with the oldest `requestedAt`, each as it was handed with
`requestedAt` as ISO 8601 text, oldest first.

`askOf` takes `{id}` and answers what stands of that ask: `{state:
'pending', ask}` with the ask as `asks` answers it, `{state: 'ended',
kind}` for one of the remembered ids, and `{state: 'unknown'}`
otherwise.

Type: service

## Tests

The room is the live safe's, so the tests tell it about accounts and
states of their own naming, each with a random suffix, and no real
wait is answered by them. A wait taken with a mark before the telling
answers that arrival, a wait for a name nothing tells about answers
timed out at its short timeout, and many waits for one account are all
answered by its one arrival. An ask handed with a wait is pending
while the wait is held, among `asks` and by its id, and ended once its
wait is answered; a `fields` ask is answered by an arrival that stored
`fields` and left waiting by one that stored `value`; one with no mark
is left waiting by an arrival told before it and answered by the next;
of two asks for one account and one kind `asks` answers the older; a
`display` ask is pending until a `value` is stored for its account; a
wait for a state whose callback was told before its mark answers
spent; and an id nothing carries is unknown.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
