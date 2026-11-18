# cernanto/decision/jev

Type: task

Implements: cernanto/decision
Uses: cernanto/config, npm:@typesafe-ai/sdk@0.6.0

The decision interface answered by a decision model behind the Jev API:
one request per decision through TypeSafe's SDK to the endpoint the
plane's configuration names, else TypeSafe's own, so the same agent
serves Jev, Cloudflare's Clef, Perplexity's decider or a local Ollama
by endpoint and model alone. Refuse a bad input as the interface
says, in words, before anything reaches the endpoint. This engine
reads text alone and answers in probabilities.

## The endpoint, the model and the key

Read, fresh on every call through cernanto/config,
`endpoint` (`https://api.typesafe.ai` when it names none),
`model` (`jev-latest` when it names none),
`token` (the API key, read with the secret read; absent
when it names none, and the request then goes without a key, as a
local engine accepts), and `certainty` (the default
certainty, 0.7 when it names none). Every request goes through the
SDK to that endpoint with that key and that model, every option of
the SDK given by this agent, with a timeout of ten seconds per
attempt and the SDK's own retries on.

## The checks before a request

Two refusals in words, terminal, before any request. An attachment
anywhere in the context or in an item (an object with a
`contentType` beginning `image/` or equal to `application/pdf` and
`bytes` that are bytes or base64 text) is refused naming the key and
cernanto/llm as where a picture is read: `the decision engine cannot see
pictures: "<key>" holds an <content type>; ask cernanto/llm for what
the picture shows`. A state over the engine's budget is refused
naming the sizes: the state's JSON text estimated at four characters
a token against 32,000 tokens for the state with the longest question
and 64,000 for the whole request: `the context is too large for the
decision engine: about <characters> characters, the engine takes about
<characters allowed>; send only the fields the question needs`.

## The request

THE STATE is a JSON object: the context itself, its keys the
context's own, a Date as its ISO text, null rendering as an empty
object; for a filter or a rank, an object with `context`, the context
as above, and `items`, an object whose keys are the item numbers from
one in the given order as strings and whose values are the items.

THE QUESTIONS, named and typed as the API takes them:

- `if`: one `noul` question named `answer` whose instructions are the
  prompt.
- `which`: one `choice` question named `answer` whose instructions
  are the prompt and whose criteria map every option to itself.
- `level`: one `score` question named `answer` whose instructions are
  the prompt and whose criteria are the levels in the given order,
  least first.
- `filter` and `rank`: one `noul` question per item, named by the
  item's number, whose instructions are `Item <number> satisfies:
  <the prompt>`; at most 32 items ride one request, further items
  going in further requests whose state holds the context and that
  batch of items alone, the numbering kept from the whole list.

THE ANSWER. A `noul` answers the probability of yes. A `choice`
answers the chosen option and a probability per option. A `score`
answers the expected level as a number counted from zero and a
probability per level, and the answer's level is the one nearest that
number.

THE BAND, with `certainty` the call's when given, else the default:

- `if` is true when the probability reaches `certainty`, false when
  it falls to one minus `certainty`, and otherwise inconclusive, the
  error of kind `judgment-inconclusive` carrying the probability in
  its message (`the case does not settle it: 0.52`).
- `which` answers the chosen option when its probability reaches
  `certainty`, else inconclusive with the top two options and their
  probabilities in the message.
- `level` answers the nearest level when the probability on that
  level and on the levels directly beside it, taken together, reaches
  `certainty`, else inconclusive with the expected level in the
  message.
- `filter` keeps the items whose probability reaches `certainty`, in
  descending probability, cut to `maxItems`; fewer than `minItems`
  kept is inconclusive naming the bound; no minimum and none kept is
  an empty answer.
- `rank` answers every item in descending probability, ties in the
  given order, cut to `maxItems`; a rank always answers.

Log the probabilities of every answer as one debug line per decision,
the distribution beside the answer in the trace.

WHAT A REQUEST COST is said through the os module's `usage` right after
the endpoint answered each request, a request made again included:
the input and output tokens and the cost its answer reports, when it
reports them; a request whose answer reports neither is said all the
same, as one request with no tokens and no price.

## The errors

The SDK's errors, classified: an authentication or permission failure
(401, 403) is terminal in the vendor's words, naming what heals it,
`cernanto config cernanto/decision/jev token=<api key>`; a rate limit or a
server failure (429, 5xx) that outlives the SDK's own retries, and a
connection or timeout failure, are retryable; a bad request or an
unprocessable one (400, 422) is terminal with the endpoint's words.
An answer
without the question named, or with a value of the wrong shape, is
terminal naming what the endpoint answered.

## Tests

Every decision runs the configured endpoint, so the tests ask few,
small ones whose answers a machine checks exactly. A condition over a
two-line context answers true, and the same statement over a context
that contradicts it answers false; a choice among three named options
answers the one the context plainly states; a level among four levels
on a short report answers the level the report plainly states; a
filter over four short items, two of which satisfy the statement,
keeps exactly those two; a rank over three items whose texts plainly
order them answers that order; a statement the context leaves open, two
opposing facts side by side, fails with the inconclusive kind; a context holding a picture
(an object with an image content type and a few bytes) is refused
before any request, naming the key; and a malformed request (an empty
prompt, options given as an empty list) is refused before any
request.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
