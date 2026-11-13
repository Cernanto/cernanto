# cernanto/decision/llm

Type: task

Implements: cernanto/decision
Uses: cernanto/llm-prompt, cernanto/config, file:prompts/

The decision interface answered by the plane's language model: each
decision is two turns of the plane's prompt engine, cernanto/llm-prompt
bound with no name, one prompt at a time, on the model and effort the
plane's configuration names for decisions, the call's `tune` over them
when given. Refuse a bad input as the interface says, in words, before
anything reaches a model. This engine sees pictures: an attachment of
an allowed kind rides the first turn.

## The engine

Every turn is a one-shot of the plane's prompt engine, the
implementor the plane binds for cernanto/llm-prompt. Read, fresh on
every call through cernanto/config, `model` and
`effort`: a one-shot's model and effort are the call's
`tune` when given, else these settings, else nothing, so the engine
fills its own defaults. Both turns of a decision carry the same model
and effort.

## The judgment

An answer the case cannot support is inconclusive: fail with an Error
carrying `kind: 'judgment-inconclusive'` and a plain reason as its
message. Each turn runs once.

THE PROMPT FILES. Every text the model reads comes from the granted
folder `prompts/`, used verbatim with only the file's final line
break removed: `facts.md`, the sentence that confines the model to
the context; `stage-one/<function>.md` for each of the five functions
(`if`, `which`, `level`, `filter`, `rank`); `stage-two.md`, the
extraction frame; `rules/<function>.md`, the extraction rules of each
function. Replace each placeholder in angle brackets by the text
named below and keep everything else in a file as it is.

THE FULL PROMPT is the constant prompt followed, when the context
holds anything, by a blank line, `### Context:`, a newline and the
context rendered as readable text: one `Readable key: value` line per
entry in the object's own key order, the key's camelCase split into
words (`paymentHistory` reads `Payment history`), a nested object
indented under its key, an array as indented `- item` lines, a Date
as its ISO text, an empty or null context rendering as nothing.

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

THE ITEMS of a filter or a rank are numbered from one in the given
order and rendered as context values are: a string as itself, a
number or a Date as its text, an object as its readable lines
indented under the number; each item is one block beginning `N. `,
and `<the items>` is the blocks joined by newlines. An item that
holds an attachment is refused in words before any turn, naming the
item's number: an item is judged by its text.

THE FIRST TURN reasons in prose, a free-text turn. Its prompt is
`stage-one/<function>.md` with `<facts>` replaced by `facts.md`,
`<full prompt>` by the full prompt, `<the options>` (which) by the
options joined by `, `, `<the levels>` (level) by the levels joined
by `, ` in the given order, and `<the items>` (filter, rank) by the
items text. A truncated turn is inconclusive (the reasoning stage was
truncated); its text is the analysis.

THE SECOND TURN extracts the typed value, held to a JSON schema with
one required field, `final_answer`, typed by function and also
allowing null, the model's word that the information is not available:
boolean for `if`; number for `which`, described as "Option number
only, 1-based index"; number for `level`, described as "Level number
only, 1-based index, counting from the least"; array of numbers for
`filter` and `rank`, described as "Item numbers only, 1-based". Its
prompt is `stage-two.md` with `<the constant prompt>` replaced by the
constant prompt, `<the analysis>` by the analysis, `<the rules>` by
`rules/<function>.md`, and three placeholders that depend on the
call:

- `<options line>`: for `which`, a newline followed by `Options: `
  and the options numbered from 1 (`1. first, 2. second`); for
  `level`, a newline followed by `Levels: ` and the levels numbered
  from 1 in the given order; for `filter` and `rank`, a newline
  followed by `Items: 1 to N`, N the count of items; empty for `if`;
- `<bounds line>`: for a filter with bounds, a newline followed by
  `Please provide exactly N items.` when the minimum and maximum are
  equal, `Please provide between N and M items.` with both, `Please
  provide at least N items.` with only a minimum, `Please provide no
  more than M items.` with only a maximum; empty otherwise;
- `<empty list sentence>`: for a filter whose minimum is absent or
  zero, `If the Answer says no item satisfies the statement, set
  final_answer to an empty array []; that is a valid answer. ` (the
  trailing space included); empty otherwise.

A truncated turn is inconclusive (the extraction stage was truncated).

THE ANSWER is read from the turn's structured value when it is an
object, else from the first JSON object in its text (inside a fenced
block when there is one), taken exactly as it is; a text without a
JSON object is inconclusive. A
missing or null `final_answer` is the empty list for a filter with no
minimum, and inconclusive (the information is not available in the
context) for everything else. The value must fit the function, else
the judgment is inconclusive with a reason saying what the extraction
did not yield: a boolean for `if`; for `which` a 1-based index into
the options, answered as the option string; for `level` a 1-based
index into the levels, answered as the level string; for `filter` an
array of distinct integers from 1 to the count of items, answered as
those items in the array's order, cut to `maxItems` when it is
longer, and inconclusive naming the bound when it is shorter than
`minItems`; for `rank` an array holding every item's number exactly
once, answered as the items in that order, cut to `maxItems`.

THE CERTAINTY on this engine. The model answers in picks: a true,
false or null answer stands for a probability of one, zero or one
half; a named option or level for the whole mass on it; a kept item
for one. The interface's band then gives the same three outcomes at
any `certainty`; the setting is accepted and checked as the interface
says, and the answer is the pick.

## Tests

Uses:

- npm:jimp

Every decision runs the real vendor, so the tests ask few, small ones
whose answers a machine checks exactly. A condition over a two-line
context answers true, and the same statement over a context that
contradicts it answers false; a choice among three named options
answers the one the context plainly states; a level among four
levels on a short report answers the level the report plainly
states; a filter over four short items, two of which satisfy the
statement, keeps exactly those two; a rank over three items whose
texts plainly order them answers that order; a picture the tests
draw themselves, a PNG of a few hundred pixels showing one large
filled black circle on white and nothing else, under the condition
that the picture shows a circle, answers true, and under the condition
that it shows a square answers false; a question the context cannot answer fails
with the inconclusive kind; and a malformed request (an empty prompt,
options given as an empty list) is refused before any turn runs.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
