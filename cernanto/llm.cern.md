# cernanto/llm

Uses: cernanto/llm-prompt, cernanto/config, file:llm/prompts/

The plane's language-model agent: what only a language model does.
Given a context object and a constant prompt, answer one typed value
with a model over the case in hand: `llmList` a list of strings,
`llmNumber` a number, `llmDate` a Date-parseable string, `llmConcise`
the most minimal text answer, `llmDetailed` a full text answer. A
decision, a yes or no, one of named options, a level on a scale, the
items of a list that pass or their order, is `cernanto/decision`'s.

Refuse a bad input before anything reaches a model: the context must
be an object or null, the prompt a non-empty string, `minItems` a
non-negative integer and `maxItems` a positive integer, and the
optional `tune` an object whose `model` and `effort`, when present,
are strings. An attachment in the context (THE ATTACHMENTS below)
with a content type outside image/png, image/jpeg, image/gif,
image/webp and application/pdf, with bytes that are neither bytes nor
base64 text, an image over ten megabytes decoded, all attachments
over twenty-four megabytes decoded together, or more than twenty
images, is refused in words before any turn, naming the key.

## The engine

Every turn is a one-shot of the plane's prompt engine: cernanto/llm-prompt
bound with no name, so the implementor the plane binds answers. Read,
fresh on every call through cernanto/config, `model` and
`effort`: a one-shot's model and effort are the call's `tune` when
given, else these settings, else nothing, so the engine fills its own
defaults. Both turns of a judgment carry the same model and effort.

## What the contract teaches its consumers

The contract's documentation carries, once each: the rules of
judgment on the context type, each parameter where it is declared,
and on each function what it answers, which outcome is an error, and
one short example of a call and its answer in the shape the code
writes, written from the function's own description. Every judgment
takes the context first, then its prompt, then its optional settings
last, together.

THE RULES OF JUDGMENT. A judgment is for what inherently needs a
model over the case in hand, meaning read from text, a value extracted
from unstructured content, text written; what TypeScript can compute
is written as TypeScript. The context is the whole of what is known
for the question, every relevant variable under a readable key, or
null when none exist; the judgment answers from the context and the
constant prompt, the model bringing its understanding of language and
categories, and a fact the context lacks fails the call as
inconclusive. The prompt is a constant string, every value riding the
context, and defines what qualifies in the specification's own words,
an empty answer being legitimate where nothing qualifies; it names
the thing judged: a judgment over a search report judges the claim
the report is about. A question about the world belongs to
`cernanto/search`, whose report rides the context and is judged here
as a claim. Inconclusive is an error: the call throws the error of
kind `judgment-inconclusive`, and the consumer's code handles it; the
prompt asks its question as it is, a fallback such as "return null if
missing" belonging to the consumer's own code. An object is composed
from one focused judgment per field, assembled in code. A picture or
a PDF rides the context as an `LlmAttachment` anywhere in it and is
seen as it is; a bare base64 string is text. A decision, a yes or no,
one of named options, a level on a scale, the items of a list that
pass or their order, belongs to `cernanto/decision` even when a
language model could answer it; this agent reads values out of
content and writes text.

THE SETTINGS, optional and last: the tune, a model and an effort as
the vendor names them, set only when a specification asks for it on a
particular judgment; and for a list, `minItems` (zero or absent lets
the list be empty) and `maxItems`, a list outside them failing as
inconclusive.

WHAT EACH FUNCTION ANSWERS, the documentation of each carrying one
short example of a call and its answer:

- `llmList`: a list of items in their simplest form, each the core
  name alone.

- `llmNumber`: one numeric value, digits and a decimal point alone,
  usable in arithmetic as it is.

- `llmDate`: a date or time as an absolute string the Date
  constructor accepts; a date in the world reaches the context through
  a search report first.

- `llmConcise`: the most minimal string that addresses the question,
  an identifier without qualifiers, a value without formatting, an
  answer without preamble.

- `llmDetailed`: the full text, a summary, an analysis, a reply
  drafted, with its detail preserved.

## The judgment

Make a judgment in two turns of the plane's prompt engine, one prompt
at a time, the model and effort of THE ENGINE above handed to both
turns. Each turn runs once. An answer the
context cannot support is inconclusive: fail with an Error carrying
`kind: 'judgment-inconclusive'` and a plain reason as its message.

THE PROMPT FILES. Every text the model reads comes from the granted
folder `llm/prompts/`, used verbatim with only the file's final line
break removed: `facts.md`, the sentence that confines the model to
the context; `stage-one/<primitive>.md` for each of the five
primitives (list, number, date, concise, detailed); `stage-two.md`, the extraction frame; `rules/<primitive>.md`,
the extraction rules of each primitive. Replace each placeholder in
angle brackets by the text named below and keep everything else in a
file as it is.

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

THE FIRST TURN reasons in prose, a free-text turn. Its prompt is
`stage-one/<primitive>.md` with `<facts>` replaced by `facts.md`,
`<full prompt>` by the full prompt. A truncated turn is inconclusive (the reasoning stage was
truncated); its text is the analysis.

THE SECOND TURN extracts the typed value, held to a JSON schema with
one required field, `final_answer`, typed by primitive and also
allowing null, the model's word that the information is not available:
array of strings for list; number for number; string for date, concise and detailed. Its
prompt is `stage-two.md` with `<the constant prompt>` replaced by the
constant prompt, `<the analysis>` by the analysis, `<the rules>` by
`rules/<primitive>.md`, and three placeholders that depend on the
call:

- `<options line>`: empty;
- `<bounds line>`: empty;
- `<empty list sentence>`: for a list whose minimum is absent or zero,
  `If the Answer says there are no items (nothing to list), set
  final_answer to an empty array []; that is a valid answer. ` (the
  trailing space included); empty otherwise.

A truncated turn is inconclusive (the extraction stage was truncated).

THE ANSWER is read from the turn's structured value when it is an
object, else from the first JSON object in its text (inside a fenced
block when there is one), taken exactly as it is; a text without a
JSON object is inconclusive. A missing or null `final_answer` is the
empty list for a
list with no minimum, and inconclusive (the information is not
available in the context) for everything else. The value must fit the
primitive, else the judgment is inconclusive with a reason saying what
the extraction did not yield: for list an array of strings within
the bounds (fewer than the minimum or more than the maximum is
inconclusive, naming the bound); for number a finite number, a
numeric string converted and a boolean refused; for date a string the
Date constructor parses; for concise and detailed a non-empty string.

## Tests

Uses:

- npm:jimp
- npm:pdf-lib

Every judgment runs the real vendor, so the tests ask few, small ones
whose answers a machine checks exactly. The attachments the tests
carry are drawn by the tests themselves: a PNG of a few hundred
pixels showing the digits 42 in a large font on white, and a one-page
PDF with the lines `Invoice number: HK-77812` and `Total: 294.53
EUR`. The number written in
the picture answers 42; the invoice number read off the PDF answers
HK-77812 and its total 294.53; a picture under `image/bmp` is refused
before any turn. And the text judgments: a number and a
date read out of a short context answer the values it holds; a
question the context cannot answer fails with the inconclusive kind;
and a malformed request (an empty prompt, `maxItems` given as zero)
is refused before any turn runs.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
