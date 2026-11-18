# Search

Uses: cernanto/llm-prompt, file:search/prompts/extract.md

The plane's search agent. Given a context object and a constant
prompt, answer `aiSearch` with a prose report of what the web says,
with its sources; a plain judgment then types a value out of the
report.

Refuse a bad input before anything reaches a model: the context must
be an object or null, the prompt a non-empty string, and the optional
`tune` an object whose `model` and `effort`, when present, are
non-empty strings. An attachment in the context (THE ATTACHMENTS
below) with a content type outside image/png, image/jpeg, image/gif,
image/webp and application/pdf, with bytes that are neither bytes nor
base64 text, an image over ten megabytes decoded, all attachments
over twenty-four megabytes decoded together, or more than twenty
images, is refused in words before any turn, naming the key.

## What the contract teaches its consumers

The contract's documentation carries this, on the types and on the
function, with one short example of a call and its answer, written
from the function's description.

The search is for every question the context does not answer, that
is, any question about the world: a fact of knowledge (when a country
was founded, which city is a capital, who wrote a song), a current
fact (a price, the news, whether a domain is taken), or a claim to
verify. A plain judgment (the decision and llm agents' functions) reads
the case only; a question about the world goes to the search, and a typed
value is extracted from the report with a plain judgment over it, the
same way any other text is typed. The context carries every local
variable and argument relevant to the ask, or null when none exist;
the prompt is a constant string, every value riding the context; the
tune (a model and an effort) is rare, the everyday call omitting it.
A picture or a document
rides the context as a value like any other, an object with its
`contentType` (image/png, image/jpeg, image/gif, image/webp or
application/pdf) and its `bytes` (`AiAttachment`; a mail attachment
already has this shape), and the search starts from what it shows: a
photographed product and the question of where it is sold.

## The search

Make the report in two turns of the coding vendor, the engine
`cernanto/llm-prompt/harness` bound by that name through
cernanto/llm-prompt (the one engine that reaches the web), one prompt
at a time, the call's `tune` handed to both
turns when given. Each turn runs once. When the
web cannot ground an answer, fail with an Error carrying `kind:
'judgment-inconclusive'` and a plain reason as its message.

THE FIRST TURN researches in prose with the web enabled. Its prompt
is the constant prompt followed, when the context holds anything, by
a blank line, `### Context:`, a newline and the context rendered as
readable text: one `Readable key: value` line per entry in the
object's own key order, the key's camelCase split into words
(`paymentHistory` reads `Payment history`), nested objects indented
under their key, arrays as indented `- item` lines, a Date as its ISO
text, an empty or null context rendering as nothing. A truncated turn
is inconclusive (the reasoning stage was truncated); its text is the
research.

THE ATTACHMENTS. A value anywhere in the context (at the top level,
under a key, as an item of a list) that is an object whose
`contentType` is a string beginning with `image/` or equal to
`application/pdf` and whose `bytes` are bytes or base64 text is an
attachment, its bytes decoded from base64 text when they are text.
The attachments are collected in order of appearance and numbered
from one within their kind, image or document, each labelled by the
readable key it rode under (`Photo`; for a list item the key and its
position, `Photos 2`). Its line in the rendered context reads
`Photo: image 1 (image/jpeg, 240 KB)` or `Invoice: document 1
(application/pdf, 1.2 MB)`, the decoded size in KB or MB to one
decimal, followed by the object's `name` in quotes when it has one,
and that line is the whole of its rendering. The attachments ride the
FIRST turn beside its prompt, each with its content type, its bytes
and its label; the second turn carries text alone.

THE SECOND TURN extracts the report with the web off, held to a JSON
schema with one required field, `final_answer`, a string that also
allows null. Its prompt is the granted file `search/prompts/extract.md`
verbatim, its final line break removed, with `<the constant prompt>`
replaced by the constant prompt and `<the research>` by the research.
A truncated turn is inconclusive (the extraction stage was truncated).

Read the answer from the turn's structured value when it is an
object, else from the first JSON object in its text (inside a fenced
block when there is one), taken exactly as it is: no object is
inconclusive (the search did not answer with a json object); a missing
or null `final_answer` is inconclusive (the information is not
available in the context); a value that is not a non-empty string is
inconclusive (the search did not yield a text answer). The
`final_answer` string is the report.

## Tests

Uses:

- cernanto/decision/llm
- cernanto/llm
- npm:jimp

A search reaches the web through the vendor, so the tests ask few
questions. One starts from a picture the tests draw themselves, a PNG
of a few hundred pixels showing the digits 42 in a large font on
white, asking what this number is famous for in science fiction: the
report names The Hitchhiker's Guide to the Galaxy, judged with the
decision engine. And two questions of text: one with a stable public answer (the year the Node.js
runtime was first released), whose report must name it, judged with
the decision engine; and one about a thing that does not exist (a
made-up product's release date), which fails with the inconclusive
kind. A malformed request (an empty prompt, a context given as a
string) is refused before any turn runs.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
