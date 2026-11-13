# cernanto/webhook

Type: job

Uses: cernanto/auth, npm:ws

The plane's webhook agent. Hold the plane's standing channel to the
cloud relay, hand every provider delivery that arrives on it to the
agent it is addressed to, the moment that agent waits for it or at its
next wait within the relay's hold, and carry the agent's reply back to
the provider. Each copy of this process holds a socket to the relay,
the waits open on it and the queue of the deliveries no wait has taken
yet, each kept thirty seconds. The surface is three exported
functions, `sourceUrl`, `waitForEvent` and `ackEvent`.

## Whose deliveries

An agent that grants this one receives deliveries under its own id:
its url is this agent's answer for that id, and what providers post
there is handed to that agent. `sourceUrl` and `waitForEvent` take
the agent in `agent`, or take none and mean the caller, the calling
agent's id as the os module names it; a call that names no agent
while the wire names no caller (a call from the gateway) is refused
in words. `waitForEvent` serves its caller alone: a wait naming
another agent than its caller is refused in words, so no agent can
take another's deliveries. `sourceUrl` answers for any agent named.

## The public url

`sourceUrl` answers the url providers post to for the agent: `<relay
base>/c/<channel>/<segment>`, the segment being the agent's id with
every slash turned into a dash, the channel being the plane's relay
channel as cernanto/auth answers it, the relay base being the relay
url with a `ws:` scheme read as `http:` and any other as `https:`, a
trailing `/connect` and any trailing slash stripped. A failed ask of
cernanto/auth or a null channel fails this call in words. Its
documentation tells the consumer to hand the url to the provider's
subscription api, to renew before expiry, and to clean up when the
agent retires.

THE RELAY URL is `wss://hooks.cernanto.com/connect`, the vendor's
relay, a constant of this agent wherever this specification says the
relay url.

## The hand-over

An agent's token is its id with every character outside letters and
digits replaced by an underscore; a source segment of the wire (an id
with its slashes as dashes) spells the same token by the same rule.

A delivery is handed to the waits open for its agent in this process
the moment it arrives: every wait open for the agent at that moment
answers it (two waits open at once each receive it). A delivery that
arrives while no wait is open for its agent is QUEUED for the agent in
this process for THE HOLD, thirty seconds from its arrival, the time
the relay holds the provider's request: the first wait that opens for
the agent within them answers the oldest delivery queued for it, and
one wait alone takes a queued delivery, so an agent's deliveries are
handed out in the order they arrived and a wait stands open only while
the agent's queue is empty. At the end of its thirty seconds a queued
delivery is dropped, a console line naming its delivery id and its
agent: its provider has by then heard the relay's refusal. The queues
together hold at most 64 MiB, a delivery counted as the bytes of its
frame as it arrived; a delivery that would pass that bound takes the
place of the oldest queued delivery of all, dropped with its console
line. The queue is the memory of this process and is lost with it.

## Waiting

`waitForEvent` takes optionally `agent` (the caller when absent) and
optionally `timeoutMs` (300000 when absent), and answers the next
delivery for the agent, or null when the timeout passes first: the
oldest delivery queued for the agent when the call begins, else the
first that arrives on this process's socket while the wait is open.
The event is `{id, deliveryId, method, query, headers, rawBody,
body?}`. `id` is the handle the acknowledgement names, opaque to the
consumer: the delivery id, spelled here. `deliveryId`, `method`,
`query`, `headers` and `rawBody` are the delivery as the frame
carried it, the method in lower case and `post` when the frame names
none, the query empty when it names none, the header names in lower
case and the provider's exact bytes as base64, and `body` is the raw
bytes parsed as JSON when they parse, absent otherwise (for form
posts and empty bodies the raw bytes are the truth).

The event's documentation carries what a consumer's coder needs. A
delivery reaches the consumer through a wait open for it, or through
its next wait when it arrived within the last thirty seconds while
none was open; so a consumer that takes every delivery keeps a wait
open at all times and opens the next before slow work, the fastest
road, and what arrived while it was between two waits, up to thirty
seconds back, is handed to its next waits, oldest first. A delivery
can reach the consumer more than once (a provider's retry is a new
delivery, and two waits open at once each receive it), so an action
that must not repeat remembers the provider's own event id, the id in
the body or the headers that names the event, rather than the
transport's delivery id. What is older than thirty seconds, or was
lost with the process, comes again from providers that retry and is
otherwise the provider's own history to serve. Every event is
acknowledged with `ackEvent`, before slow work: the acknowledgement is
the answer the provider gets while the relay holds its request, thirty
seconds, and a provider waits for that answer by its own patience, a
few seconds for most (Slack three, GitHub ten), so a reply the
provider must see, a registration handshake (a Meta-style GET carries
`hub.challenge` and `hub.verify_token` in the query, a Slack-style
`url_verification` rides the body) or a crafted answer, is
acknowledged inside the provider's own window; a provider that hung
up first keeps its own failure and retries, or not, by its own rules,
and the acknowledgement is then the consumer's record of having
handled the delivery. The documentation shows how a consumer verifies
a delivery's signature over the exact raw bytes with node's
deterministic crypto and the secret its own specification names,
compared in constant time, for the common forms (a Stripe header
`t=<ts>,v1=<hex>` signing `<ts>.<rawBody>`, a Slack or Zoom header
`v0=<hex>` signing `v0:<ts>:<rawBody>`, a plain hex hmac of the raw
body); the coder writes that example.

## Acknowledging

`ackEvent` takes `eventId`, a numeric `status`, and optionally
`contentType`, a `headers` map and a `body`; an event id that is not
in the form this agent hands out, a delivery id as the relay spells
one (a UUID), fails in words. It sends the provider's reply as the
response frame `{kind: 'response', deliveryId, status, contentType?,
headers?, bodyBase64}`, the delivery id from the event id; when the
reply names a content type and its body is a string, the body's bytes
ride base64 as they are, otherwise the body serialized as JSON (null
for an empty one) rides base64. The frame travels the socket the
delivery came on while that socket is open, and this process's socket
that takes deliveries otherwise; a frame with no open socket to travel
is kept, the first frame of its delivery alone, and sent when a socket
opens within thirty seconds of the delivery's arrival; at the end of
those thirty seconds a kept frame is dropped. The relay matches the
frame by its delivery id on any socket of the channel, so an
acknowledgement on any copy of this process answers the provider. The
first acknowledgement of a delivery is the one the provider sees; a
later one of the same delivery, from another wait that received it too
or after the relay's hold, is taken and the provider keeps its first
answer.

## The relay channel

Hold the plane's standing channel to the relay for the life of the
process, from its start to its end; every copy of this process holds
a socket of its own, and a process without a channel is free to end.

The bearer is the plane's relay token as cernanto/auth answers it to
this agent, trimmed and accepted at sixteen characters or more, the
channel asked of cernanto/auth before the token. While no bearer
resolves, wait fifteen seconds and ask again, quietly. With one, open
a WebSocket to the relay url with the header `authorization: Bearer
<bearer>`. Resolve the bearer fresh before every connect, keeping the
last bearer that worked when a resolve answers nothing. Narrate each
state change with a console line.

THE PROCESS KEEPS ONE SOCKET THAT TAKES DELIVERIES. A socket on which
the relay sent the frame `{kind: 'reconnect'}`, its word that the
socket is going, is GOING: it is kept open for the response frames of
the deliveries that came on it until the relay closes it, and counts
as no socket otherwise. When the process has no socket that takes
deliveries and none opening, it opens one: at once after the relay's
reconnect word, and after five seconds plus up to five random more
after any other close or after an opening that failed.

Each message on the socket is one frame; drop a frame that is not JSON
or is of no shape named here. A delivery frame is `{kind: 'delivery',
deliveryId, source, bodyBase64, headers, method?, query?}`: hand it to
the agent the source names (the token spelled from the source) as THE
HAND-OVER above says. The relay sends every delivery to every socket of
the channel at once and holds the provider's request thirty seconds
for the consumer's response frame, from whichever socket it comes,
answering the provider with its retry refusal, status 503, when none
comes within them. The provider's answer is the consumer's
acknowledgement.

## Tests

The plane's inbound front is the cloud relay at
https://hooks.cernanto.com: the url this agent answers rides it, and a
delivery posted there over https with the language's own http client
is what a real provider does. The tester is an agent of its own, and a
wait naming no agent is a wait for the tester's own deliveries; a
delivery answers the poster only once the tester acknowledges it, so
the acknowledgement comes while the post is still pending. The agent
under test runs two copies beside the plane's standing copy, each with
a socket of its own on the plane's channel, every copy receiving every
delivery at once, and the tester's calls reach the two copies in turn:
a wait can read a delivery a wait on the other copy already took and
answered, queued thirty seconds on its own copy, and its own
acknowledgement of it then changes nothing; and two waits open at once
can sit on different copies. So every test marks what it posts with a
value of its own, a field of the body or a value of the query, reads
on past every delivery that does not carry its mark or that it has
already read, and acknowledges its own alone. Prove live, through the
front: the urls answered (the relay's host, the segments by agent), a
JSON delivery with its crafted reply, a handshake GET with its query
echoed, a delivery posted while no wait is open that the wait opening
two seconds later takes and answers to the poster, the retry refusal
of a delivery left unacknowledged, which comes at the end of the
relay's hold of thirty seconds, a delivery posted a moment before its
wait opens, a reply acknowledged three seconds after the take, two
waits open at once, and the refusal of a wait naming another agent.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
