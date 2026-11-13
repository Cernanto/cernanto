# LLM Prompt

Type: interface

An interface: the basic component of the plane's AI, one prompt in and
one answer out, implemented by the engines that answer a prompt with a
language model. A consumer binds it with no name and the implementor
the plane binds serves, `cernanto/llm-prompt/default`,
`cernanto/llm-prompt/harness` on a fresh plane; a consumer that names
an implementor pins it.

`oneShot` evaluates one prompt and answers the reply with its
accounting. It takes the `prompt`; optionally, together: `attachments`
(pictures and documents the model sees beside the prompt, each a
`contentType` (image/png, image/jpeg, image/gif, image/webp or
application/pdf), its `bytes` and an optional `label`),
`responseJsonSchema` (the reply must satisfy it and the parsed value
arrives in `structured` beside the text), `model` and `effort` (names
the engine understands; unnamed, the engine's own defaults serve),
`web` (the reasoning may consult the web) and `maxTurns` (the turn
budget for a web-enabled evaluation). An engine that cannot do what
the settings ask refuses in words before any request: a picture it
cannot show, the web it cannot reach. It answers the reply `text`;
`structured` when a schema was asked and honored; `truncated`, true
when the reply stopped before the model finished (the text then a
fragment); `usage` with `units` (total tokens) and the engine-reported
`inputTokens` and `outputTokens`; `costUsd` when the engine prices the
turn; and `model`, the model that served as the engine reports it.

WHAT A REQUEST COST is said where the request is made, through the os
module's `usage`, right after the model answered, once per request
made.

## Tests

Every implementor is proven live on its own engine: a one-shot asked a
question whose answer is a number, held to a schema with one number
field, answers that number in `structured`; and one carrying a picture
the implementor's own Tests section says how the tests draw, asked
what number it shows under the same schema, answers what the picture
shows. An error of any kind is a test failure.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
