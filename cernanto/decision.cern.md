# cernanto/decision

An interface: the decisions an agent's code asks of a model, each a
typed value over the case in hand, named for the line the code writes
next. `decideIf` answers a boolean for an if; `decideWhich` one of the
given options for a switch; `decideLevel` one of the given levels,
ordered from least to most, for a degree the code compares;
`decideFilter` the given items that satisfy the prompt, best first;
`decideRank` the given items in order of how well each satisfies it.
Every implementor answers this surface, and a consumer's code is the
same whichever implementor serves. The implementor that serves is the one the plane binds,
`cernanto/decision/default`, `cernanto/decision/llm` on a fresh
plane: a consumer binds the interface with no name, and names an
implementor only to pin one.

## What every implementor refuses

A bad input is refused in words before anything reaches a model, and
the contract states each rule once, where the parameter or the
setting is declared: the context is an object or null; the prompt a
non-empty string; `options` and `levels` lists of distinct non-empty
strings, one option at least and two levels; `items` a list;
`minItems` a non-negative integer; `maxItems` a positive integer no
smaller than `minItems`; `certainty` a number from one half to one;
`tune` an object whose `model` and `effort` are strings when present.
An attachment in the context, an object with a `contentType` and
`bytes` that are bytes or base64 text, is refused naming its key when
the type is outside image/png, image/jpeg, image/gif, image/webp and
application/pdf, when an image decodes to over ten megabytes or all
attachments to over twenty-four together, or when there are more than
twenty images; an implementor that cannot see pictures refuses every
attachment the same way, naming `cernanto/llm` as where a picture is
read.

## What the contract teaches its consumers

The contract's documentation carries, once each: the rules of
decision on the context type, each parameter where it is declared,
and on each function what it answers, which outcome is an error, and
one short example of a call and its answer in the shape the code
writes, the following line included, written from the function's own
description. Every decision takes the context first, then its prompt,
then what it decides over (the options, the levels, the items), then
its optional settings last, together.

THE RULES OF DECISION. A decision is for what inherently needs a
model over the case in hand, meaning read from text, classifying,
rating, choosing among given things; what TypeScript can compute is
written as TypeScript. The context is the whole of what is known for
the question, every relevant variable under a readable key, or null
when none exist; the decision answers from the context and the
constant prompt, the model bringing its understanding of language and
categories, and a fact the context lacks fails the call as
inconclusive. The prompt is a constant string, every value riding the
context, and defines what qualifies in the specification's own words,
and it names the thing judged: a condition
over a search report judges the claim, "the fact is true, per the
report". A question about the world belongs to `cernanto/search`,
whose report rides the context and is judged here as a claim.
Inconclusive is an error: the call throws the error of kind
`judgment-inconclusive`, and the consumer's code handles it where a
person or a stronger reading comes in; the prompt asks its question
as it is, a fallback such as "answer false if unsure" belonging to the
consumer's own code. A picture or a PDF
rides the context as a `DecisionAttachment` anywhere in it, judged as it
is by an engine that sees pictures and refused in words by one that
reads text alone. Free text, a number or a date read out of content, a
list written or a reply drafted belong to `cernanto/llm`; a decision
answers one of the typed values above.

THE CERTAINTY, an optional setting of every decision but a rank:
every answer stands on the probability the engine puts on it. An `if`
is true when that probability reaches `certainty`, false when it falls
to one minus `certainty`, and inconclusive between; a `which` or a
`level` answers its top option only when it carries `certainty`; a
`filter` keeps the items that reach it. The default is the plane's,
every answer arrives typed as above, the probability behind it the
engine's own, an engine that answers in picks gives the same three
outcomes at any certainty, and `certainty: 0.5` asks a plain yes or no
for a low-stakes branch. THE TUNE, a model and
an effort as the bound engine names them, rides the same settings and
is set only when a specification asks for it on a particular decision.

WHICH FUNCTION, in one short table: over ONE CASE, `decideIf` for a
yes or no, `decideWhich` for one of named kinds, `decideLevel` for a
degree on an ordered scale; over A LIST, `decideFilter` for the items
that pass and `decideRank` for their order. A choice among strings is
`decideWhich`; the best of things, records or documents, is
`decideRank` with `maxItems: 1`, which answers the caller's own
object. Several decisions over one case are several calls, made at
the same time.

WHAT EACH FUNCTION ANSWERS, the documentation of each carrying one
short example of a call and its answer:

- `decideIf`: the boolean, `true` when the context supports the
  statement the prompt makes.

- `decideWhich`: exactly one of the given `options`, typed as their
  union; an option may be a descriptive phrase, and a case that may
  fit none gets an option that says so.

- `decideLevel`: exactly one of the given `levels`, least to most,
  typed as their union; a case between two levels lands on the nearer,
  and a threshold is an index into the levels.

- `decideFilter`: the `items` that satisfy the prompt, best first,
  each the caller's own value; `minItems`, zero or absent letting the
  list be empty, and `maxItems`, the top so many of those that pass,
  bound it; fewer than `minItems` is inconclusive and an empty list a
  normal answer.

- `decideRank`: the `items` in order of how well each satisfies the
  prompt, best first, every item once, each the caller's own value;
  `maxItems` keeps the top so many; an order always exists, so a rank
  always answers one.

THE IDIOMS, one line each: a degree (severity, urgency, risk, a grade
against a rubric) is `decideLevel`, a weighted composite two levels
and arithmetic on their indexes; a candidate picked out of text is
`decideWhich` over spans the code proposed, so the answer is a span
of the document; the paragraphs that match a query are
`decideFilter` over chunks the code split; tags are `decideFilter`
with the labels as the items; a match of two records is `decideIf`
over a context holding both; a gate before an action is `decideIf`,
then code decides what happens and who confirms; reranking is
`decideRank` over the hits; a taxonomy deeper than the options allow
is `decideWhich` level by level.

Type: interface

## Tests

An implementor is proven by its own tests, live on its own engine,
and they cover every function: a condition answered true and the
same statement over a contradicting context answered false; a choice
among three named options answering the one the context plainly
states; a level among four on a short report; a filter over a few
short items keeping exactly the ones that satisfy the statement; a
rank over a few items in the order the statements plainly give; a
question the context cannot answer failing with the inconclusive
kind; and a malformed request (an empty prompt, options given as an
empty list) refused before any turn runs.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
