# cernanto/auth

Uses: cernanto/config, cernanto/documents, cernanto/auth/waits

The safe of the agents' accounts. Keep the sealed values, setup fields
and auth states those accounts hold once logged in, in the plane's
shared documents, and carry every ask an agent parks on to the
operator and back. A call that holds (until an account is logged in,
a value stored, a provider's callback received) holds in the safe's
waiting room, `cernanto/auth/waits`, which keeps the asks: tell the
waiting room what was stored, and wait there, the ask handed in with
the wait. The plane's operator tokens, the bearers its API admits, are
kept here too, served to the gateway.

## An agent's account

AN ACCOUNT belongs to the agent whose code calls this agent, read
from the call itself (the calling agent's id; a linked module calls
as itself and owns what it asks for),
and has a name: the name the caller gives, else the provider word it
gives, so an agent that reaches two providers without naming its
accounts holds two, named for the providers. A tester or a test form
of an agent, whose id is the agent's followed by
`-tester-<compile>-r<round>` or `-under-test-<compile>-r<round>`, is that
agent here, holding and asking for the agent's own accounts. THE
PROVIDER WORD is
what the operator reads beside the account, the host of the
provider's url or a short word for a provider with none
(`example.com`, `mcp.example.com`, `postgres`, `ssh`). The account's
KEY WORD, wherever a document is named by it and whenever the waiting
room is told it, is the agent's id, a `#` and the name
(`acme/orders-db#postgres`, `acme/mail#billing`); refuse a name that
carries a `#` in words. A call with no calling agent is refused in
words: an account belongs to the agent whose code calls.

An account is asked for, waited for, read, stored and forgotten by
its owner alone, and two callers act on another agent's account by
naming it as `agent`: the gateway (`cernanto/gateway`), whose calls
answer the operator's asks, list and forget for them, and the compile
family (a caller whose id is `cernanto/compile` or starts with
`cernanto/compile/`), which lists an mcp server's tools before the
agent exists and asks, waits, reads and stores on the agent's behalf;
refuse any other caller naming `agent` with exactly `only the gateway
and the compiler act on another agent's account`. Refuse an ask (a
login, a pin, an authorization or a display) whose name is already
held by the same agent under a different provider word with exactly
`the account "<name>" of <agent> belongs to <provider word>; name this
one`.

## How a call holds

Every call that holds does it the same way: take the waiting room's
mark, look in the documents for what it holds for, and when that is
missing wait in the waiting room, after that mark, for the account's
key word (or, for an authorization, for the callback of its pinned
state); after every answer of the waiting room look again with a new
mark. The documents are the truth of what an account holds; the
waiting room says when to look again. A wait an operator must answer
carries its ask, which the waiting room shows the operator for as long
as the wait is held (THE ASKS below). Whatever writes what a call may
hold for (storing a value, storing an account's setup fields,
answering an ask) tells the waiting room the account's key word and
what was stored, its setup fields or its value, once the documents are
written.

THE PLANE RUNS A CALL AGAIN from its top when the process that ran it
died, and hands it the same random draws it made the first time. So a
call that must know its own earlier write draws its random word before
it reads, and takes a record that carries that word as its own work,
going on from there in place of refusing: the claim of a pinned state
and the mint of a token below are written so. What a call asked of the
waiting room it is answered the same again, and what it told is told
once.

## The asks

When a running agent reaches something that needs an account it does
not hold yet, it asks here, and its call answers only when the
operator has answered: asking hands the waiting room an ask with the
wait, and then answers what the operator gave, so the asker's code
reads as one plain call. An ask carries everything the operator needs
to answer it, free of values: an `id` of its own, a fresh random word
drawn for that ask, the account's `agent` (its owner) and `name`, the
`provider` word, the
calling agent as `agentId` and its call as `callId` (the compile
family's, when it asks on behalf), and the refusal's words as
`refused` when the ask repeats a refused credential. An ask is one of
three kinds:

- credential fields the operator pastes: the fields, each with a
  machine name, a human label and whether the terminal hides its
  value, the label naming the value as the provider names it (a
  service key is a service key); onboarding instructions, numbered
  steps an operator who has never used the provider's console can
  follow blind, naming the menus, buttons and values as the
  provider's page names them; and a help url, the signed-in page of
  that console where the steps start, which
  every fields ask carries: refuse one without a help url, or with an
  empty one, with exactly `an ask needs its help url: the page of the
  provider's console where its steps start`;
- an oauth authorization the operator completes in the browser: the
  authorization url to open and the scopes it must grant;
- something the operator reads and acts on: the message to show.

THE WAITING ROOM KEEPS THE ASKS, and the documents hold none. Every
call that asks hands in an ask of its own, and the operator is shown
one for an account and a kind. A FIELDS ask rides the wait for the
account's setup fields: an account whose setup fields are stored
already is asked nothing, so the asker finds the account ready, unless
the ask carries `refused`: then it is asked although the account is
logged in, handed in with no mark so that only a store of fields after
it answers it, and its answer replaces what is stored. An
AUTHORIZATION ask rides the wait for the callback of its pinned state
and is answered by that callback, a code or a refusal alike. A DISPLAY
ask is handed to the waiting room with no wait and stands until the
caller's own store, whatever the account holds: an operator is needed
every time. Storing setup fields answers the account's fields asks,
and storing a value ends its display asks and takes its authorization
asks from the operator's eyes while their calls go on waiting for
their callbacks: the waiting room does both once it is told what was
stored, so every call parked on the account wakes. Listing answers the
asks the waiting room shows, each with everything it carries, its
`status` `pending` and its `requestedAt` the waiting room's: exactly
what the operator's terminal shows.

## What the contract teaches its consumers

The contract is the only manual a consumer's coder reads. Its
documentation says, for every function, what it answers, what it
records, whether it waits and for what, and shows one example in the
caller's shoes: an agent asking for its `postgres` account with
numbered onboarding steps and masked fields, its `billing` account on
`example.com` completing an authorization, an mcp module storing the
tokens it obtained and reading them back, a provider's refusal asked
again with the provider's words, and the operator's answer of an ask
by its id. It makes the consumer's road plain: an agent that needs an
account's setup fields asks for the account with its onboarding words
and holds (the operator's answer wakes it); an agent that needs an
oauth authorization completes it in one call; an agent that just
needs a stored value waits for it by name, or for the current access
token of a stored oauth payload; the plain, non-waiting reads answer
null for absence. It tells the consumer's coder to write an ask's
onboarding steps from the provider's own page, searched for and
opened as it stands that day, naming the menus, buttons and values
as the page names them. It states the two rules every caller
follows: a credential the provider refused is asked for again with
the refusal's words once a plain read shows the stored value is still
the refused one, and an ask follows the provider's refusal of the
credential alone (a permission denial, a connection failure or a
timeout is handled in the caller's own words). It says that every
answer, listing and announcement is free of values, and that an
announcement carries the account's key word alone.

## The safe

A stored value is keyed like its account and has a kind (a short
label saying how it authenticates, chosen by whoever stores it:
`api-key`, `oauth`, `oauth-mcp`, `relay`). Seal values, setup fields
and auth states with AES-256-GCM under a key this agent makes for
itself the first time it needs one and keeps on its document, read
from there by every call that seals or opens. Values stay out of
every listing, ask, log and debug line: a stored secret, an account's
setup fields, its auth state, the sealing key and a document body
carrying one of those. Every value that enters or leaves this agent
is a secret in its contract, typed with the os module's secret mark:
the value a store receives
and a read answers, the fields an ask answers and an answer receives,
the access token a waiting read answers, an account's auth state as
saved and as read, the verifier an authorization keeps and answers,
and what a provider's callback hands over.

The functions, each keyed by the calling agent (or the named `agent`)
and the name:

- `login` asks for the account's setup fields and holds until the
  operator answers: it takes the name (else the provider word stands
  as the name), the provider word, the numbered onboarding
  instructions (as the asks describe them), the fields (each a machine
  name, a human label naming the value as the provider names it, and
  whether the terminal hides its value), the help url and the scopes
  to request, plus `refused`, the provider's words, when a stored
  credential was refused; it asks for the fields and answers the
  filled fields and the scopes requested for the account (the
  requested scopes joining the account's requirement set). It holds as
  every holding call does, the ask handed in when the stored fields
  are missing, or at once when the ask carries `refused`, holding
  until that very ask is answered.
- `pin` pins one authorization ahead of its url: it takes the name
  (else the provider word) and the provider word, remembers a fresh
  random state parameter against the account's key with the ISO time
  it was pinned (A PINNED STATE below), and answers the state and the redirect url the
  provider should send the browser back to (the `oauth-redirect`
  configuration value when the operator set one, else
  `http://127.0.0.1:7434/oauth/callback`), for a caller whose client
  library composes the authorization url itself and must know both
  before it does.
- `authorize` completes one oauth authorization: it takes the name
  (else the provider word), the provider word, the authorization url
  and the scopes, pins a fresh state against the account's key and
  appends it to the url, holds for the callback of its pinned state
  alone, the authorization ask carrying the url handed in with that
  wait (a timeout of the waiting room is one more wait), and answers
  the code; a provider refusal is an error carrying the provider's
  words. A caller that pinned the state itself with `pin` passes it as
  `state` with a url that already carries it, and the url is then used
  as it is; a state handed that is pinned for another account, or for
  none, or more than a day ago, is refused in words saying to pin it
  first, whether or not it was claimed since, and a state the waiting
  room answers was used before this call began is refused in words
  saying to pin a new one. A caller may hand a PKCE code
  verifier (`codeVerifier`, a secret), which is sealed beside the
  pinned state; the code comes back with the verifier, the one handed
  or else the one resting beside the handed state (read when the
  state is looked up, before the wait), so a call that
  holds a pinned state after a restart still has the verifier its
  challenge was made from. The mark is taken before the state is
  pinned, so a callback landing right after the
  pin still answers the call.
- `display` hands the waiting room a display ask (the name else the
  provider word, the provider word, the message the operator reads and
  acts on, and optional instructions) and answers its id; the caller
  stores the account's value when its own road completes, which logs
  the account in.
- `store` seals a value under the account (the name else the provider
  word, the provider word, the kind, the value: a secret) and LOGS
  THE ACCOUNT IN: the moment and the operator (`by`, when the gateway
  passes one) are recorded on it, and the waiting room is told its key
  word and that a value was stored. Storing replaces any previous
  value.
- `read` answers the stored value by the name (a secret; null when
  none is stored; the setup fields are `fields`'s to answer);
  `awaitValue` waits for it, holding until a value is stored, however
  long that takes, as a plain wait; `awaitLogin` waits until the
  account is logged in (a value or its setup fields stored) and
  answers the kind of what is stored (`fields` for setup fields
  alone); `token` answers the current access token and its expiry out
  of the stored oauth payload, parsed from what the provider handed
  back (the token under `access_token` or `accessToken`; the expiry
  under `expires_at`, `expiry` or `expiresAt` as an ISO text or a
  number of milliseconds or seconds, else computed from `expires_in`
  or `expiresIn` seconds, else an hour from now; a stored value that
  is not an oauth token payload, or carries no access token, is an
  error naming the account), waiting for the value the way
  `awaitValue` does.
- `saveFields` stores the setup fields (a secret) sealed as one object
  under the account with the provider word, records the field names
  and unions the requested scopes into the account's requirement set,
  and logs the account in as `store` does, telling the waiting room
  that setup fields were stored; `fields` answers them (a
  secret; null when never stored), the scopes the provider actually
  granted and the requested union (required scopes named by the
  reader join the union of an account that exists; the entry of an
  account nobody logged in stays absent). `saveState`
  merges an object state key by key over what was saved before, so a
  refresh can save a partial update (any other state replaces what
  was saved); a granted-scope set given with the save replaces the
  previous grant; the save also records whether state exists and
  whether it holds a refresh token (`refresh_token` or
  `refreshToken`, non-empty), so listings answer presence without
  opening a value. `state` answers the saved state, or null, with a
  stale mark exactly when the reader's required scopes are not all
  among the granted ones (an account that never granted anything is
  stale to a reader that requires a scope, and fresh to one that
  requires none).
- `accounts` answers, for every agent or for the named `agent`, the
  logged-in accounts (each one's agent, name, provider word, kind,
  field names, when it was logged in and by whom: an account with
  setup fields alone lists with the kind `fields`, and
  an account with both a value and fields with the value's kind and
  the later of the two logins) and the asks the waiting room shows,
  for every agent or for the one named, with everything each carries;
  a calling agent that is neither the gateway
  nor the compile family lists its own accounts alone. `answer` takes
  a pending fields ask's id, the operator's filled fields (a secret)
  and `by`, asks the waiting room what stands of that ask, stores the
  fields under the ask's account as `saveFields`
  does (the ask's provider word and scopes riding along) and answers
  the account's agent and name, refusing an authorization or a
  display ask with exactly `an authorization or a display completes
  on the agent's side`, and an unknown or answered id in words; the
  gateway answers any ask, an agent its own. `forget` takes an agent
  and a name and removes the pinned authorization states of the
  account and then, last, the account's record, its value, its setup
  fields and its auth state with it, answering `{ok: true}`, an
  unknown account being an error
  naming it, and its pending asks left as they are; `forget` acts on
  any account when the caller is the gateway and on the caller's own
  accounts otherwise.
- THE RELAY TOKEN is the plane's own secret, kept apart from the
  accounts: listings leave it out, and the webhook agent alone is
  served it. `relayChannel` answers the hex sha256 of the token, the
  public path segment of the plane's inbound urls, and `relayToken`
  answers the token itself (a secret), served to the webhook agent
  (`cernanto/webhook`) and refused to any other caller with exactly
  `the relay token is the webhook agent's alone`. When no token is
stored, mint one:
  thirty-two random bytes as hex, written with a create-only swap of
  its document (a lost creation race reads the winner and uses that),
  so every plane has one channel from its first ask. The channel is
  null when the stored value is shorter than sixteen characters.

## The operator tokens

AN OPERATOR TOKEN is the plane's own, kept apart from the accounts:
the bearer an operator presents at the plane's API, kept by its name
and the hex sha256 of its value. The token functions are
served to the gateway (`cernanto/gateway`) and to this agent (its
tester calls as this agent), and refused to any other caller with
exactly `the operator tokens are the gateway's alone`.

- `tokenCreate` takes the name and mints a token. The name is letters,
  digits, dots and dashes, up to 64, starting with a letter or a
  digit; refuse any other: `a token needs a name: letters, digits,
  dots, dashes (a person, a laptop, "ci")`. The value is 32 bytes of
  strong randomness in base64url, drawn before the token's record is
  read, and the record keeps `{name, sha256, createdAt}`, the sha256
  the hex digest of the value. Read the record under the name, and
  read its `sha256` before its state. No record: write it, resting on
  absence. The digest of the value this call drew: the record is this
  call's own, written before the call ran again, so write nothing and
  answer the token with the record's `createdAt`, whether the record
  is live or revoked, a revoked one staying revoked. Another digest on
  a live record (one without `revokedAt`): refuse, `a live token named
  "<name>" exists already`. Another digest on a revoked record: a new
  token under a name that is free again, written over the revoked
  record. The answer is `{name, token, createdAt}` (a secret).
- `tokenList` answers `{tokens: [{name, createdAt, revokedAt?}]}`,
  hashes left out, in the order minted.
- `tokenRevoke` takes the name, stamps the record `revokedAt` with the
  moment (a token revoked already keeps its earlier stamp) and
  answers `{revoked, revokedAt}`; refuse an unknown name: `no token
  "<name>"`. Then keep the revoked records to the newest two hundred
  by `revokedAt`, removing the rest, each removal resting on the
  record as that listing answered it (A REMOVAL below), so a name
  minted again since is left with its new token.
- `tokenCheck` takes the hex sha256 of a bearer and answers the token
  it names, `{name, createdAt, revokedAt?}`, or null when no token has
  that digest, read fresh from the records every time: it is what
  the gateway asks of every request that presents a bearer.

## The oauth callback

The callback arrives as a call to `oauthCallback` carrying `{state,
code, error}`, made by the gateway after it has already redeemed the
state: `code` the authorization code (empty when the provider
refused), `error` the provider's `error_description`, else its
`error`, else empty. Announce the callback: tell the waiting room
those same fields (an absent code or error as an empty string), and
answer `{announced: true}`; the authorization that holds asked the
waiting room for the callback of its pinned state alone, a non-empty
`error` is the refusal to raise, and otherwise the `code` is the
answer, with the sealed verifier the caller handed in. Redeeming a
state (`oauthTake`) claims it exactly once and answers its account,
the agent and the name: draw a fresh random word, then read the
state's record; a state unknown or pinned more than a day ago answers
null; an unclaimed one is claimed by one write resting on the record
as read that adds `claimed`, the word drawn, and the call whose write
lands answers the account; a record whose `claimed` is the word this
call drew is this call's own claim, made before the call ran again,
and answers the account again; a record claimed with any other word
answers null, which is how a forged or replayed callback ends. The
claimed record stays where it is.

`describe` answers the wire protocol number, `1`, and this agent's
role, the word `custody`.

## The records road

Every document of the safe is a record of the plane's under the
family `auth`, this agent's own, reached through cernanto/documents,
bound with no name, so the plane binds its implementor: read a document
by reading its key, list the documents of one kind by one listing of
their prefix, and write a document with one compare-and-set attempt
against the exact string the write rests on, re-deciding on the
answered current value after a lost race, bounded at about twenty
rounds and then a retryable failure naming the document. A failure
of the documents to answer is a retryable failure in its words. One
record holds one thing, and no record holds a list of the others.

A REMOVAL is one write of no value resting on the exact string that
was judged: the string a listing or a read answered for that record,
handed to the write as it is, the record never read again for it. When
the write does not land, the record changed since it was judged and is
left as it stands. So a cleanup never takes what was written after it
looked: a state changed since the listing, a token minted again under
a name whose revoked record the listing held. A removal is safe to
make again, and nothing is decided by its answer. The one removal that
takes whatever stands is `forget`'s of the account's own record, made
again against the answered current value after a lost race, until the
record is gone.

A key is plain text: one that carries an account's key word, a state
or a token's name is handed to the documents exactly as it reads, the
`#` of a key word and every character of a name as they are
(`auth/account/acme/mail#billing`), and a prefix the same way. So two
names are two keys, whatever characters they carry.

## The safe on the documents

- `auth/key` holds the sealing key, base64 of its raw bytes,
  written once with a create-only swap the first time it is needed; a
  lost creation race reads the winner and uses that.
- `auth/relay` holds the plane's relay token, sealed like a value
  (JSON `{version: 1, iv, tag, data}`), written once with a
  create-only swap.
- A KEY'S WORD, wherever a document is named by an account: the
  agent's id, a `#` and the name (`acme/mail#billing`).
- AN ACCOUNT is one record, `auth/account/<the key's word>`: JSON
  spelled exactly `{version: 1, agent, name, provider?, kind?,
  fieldNames, scopes, grantedScopes, hasRefreshToken, loggedInAt?,
  loggedInBy?, value?, fields?, state?}`. The description is plain:
  the provider word (a record without `provider` reads as its name),
  `kind` the stored value's kind, standing when a value does, the
  field names, the requested scope union under `scopes`, the granted
  scopes, whether the state holds a refresh token, and the login
  marks, the last login's, a store's or a save of fields'. `value`,
  `fields` and `state` are each either absent or a sealed `{iv, tag,
  data}` object, each part base64, sealed separately: an account holds
  a value, setup fields or state exactly when that member stands, and
  a write of one of the three leaves the others' sealed members as
  they stand. Every write of an account is one compare-and-set of its
  whole record, so a part and its description move together. A read
  opens the member it answers and no other, and makes no record. The
  accounts of every agent are the records under `auth/account/`, and
  one agent's are those under `auth/account/<the agent's id>#`;
  listings read them and open no member.
- A PINNED STATE is one record, `auth/oauth/<the state parameter>`:
  JSON spelled exactly `{version: 1, agent, name, pinnedAt, verifier?,
  claimed?}`: the account's key, the ISO time it was pinned,
  `verifier` the sealed code verifier when the caller handed one, and
  `claimed` the word of the call that redeemed it. Pinning writes it
  resting on absence, and a record that stands under the state a call
  drew is that call's own, written before the call ran again. A state
  counts for a day from `pinnedAt`, to every reader. Each pin then
  removes the states pinned more than a day ago, and forgetting an
  account removes that account's: both read the records under
  `auth/oauth/`.
- AN OPERATOR TOKEN is one record, `auth/token/<the name>`: JSON
  spelled exactly `{version: 1, name, sha256, createdAt, revokedAt?}`.
  The tokens are the records under `auth/token/`, in the order minted
  by `createdAt`, and the check of a bearer reads them for the one
  whose `sha256` is the digest.

A custody document whose text is not a JSON object fails the call in
words naming the document, the document left as it is.

## The runtime's seam

The runtime's lanes reach the safe through these functions and speak
their parameters in this order, a recompile keeping them: `read` takes
the account name, then optionally the agent; `store` takes the
provider, the kind, the value, then optionally the name, the agent and
who stores it; `login` takes the provider, the instructions, the
fields and the help url, then its optional settings together (the
name, the scopes, the refusal); `pin` takes the provider, then
optionally the name and the agent; `authorize` takes the provider and
the authorization url, then optionally the scopes and the name, then
its optional settings together (the state, the code verifier);
`saveState` takes the name and the state, then optionally the granted
scopes and the agent; `state` takes the name, then optionally the
required scopes and the agent.

## Tests

The tests answer every ask they open from the test side, so none
waits for an operator or stays pending. The tester calls as this
agent itself, a tester holding its subject's accounts, so the
accounts it asks for are this agent's own, under the tests' random
names: a `login` parked detached is answered through `answer` with
the id `accounts` lists, and again with `saveFields` on the same
name, the parked call's answer read back from the started call; a
`store` is read back, waited on and forgotten; two accounts whose
names end, after the same random suffix, one in the single character
U+1F600 and the other in the character U+1F60 followed by a zero, each
store a value of their own and read their own back; a second `login`
for a logged-in account and one carrying `refused` are exercised; a
`display` ask is exercised up to the ask `accounts` lists and ended by
a store; an `authorize` is exercised up to the ask `accounts` lists
and completed through the callback with its pinned state, once with a
state `pin` answered and a verifier handed in, and a second redeeming
of a state answers no account; naming another `agent`
from the tester is refused with the exact words; the relay channel is
the same on a second ask, and the token itself is refused to the
tester with the exact words. The operator tokens: one minted under a
random name is listed, found by `tokenCheck` with the hex sha256 of
its value and by no other digest, refused a second mint under its
live name, revoked twice, then listed revoked and answered revoked by
the check; a revoke of an unknown name is refused; every token a test
mints it revokes before it ends. The on-behalf road of the gateway
and the compile family is proved by their own tests. Test accounts
carry a random suffix, so a rerun starts from nothing, and every test
forgets the accounts it logged in before it ends.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
