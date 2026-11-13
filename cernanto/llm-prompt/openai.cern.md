# LLM Prompt OpenAI

Type: module

Implements: cernanto/llm-prompt
Uses: cernanto/config

The prompt sent to an OpenAI-compatible chat endpoint over https, one
request per one-shot. The endpoint is the configuration's
`endpoint`, the full chat-completions url, posted to
exactly as configured (without one the turn fails terminal with
exactly `no endpoint for the openai engine: cernanto config
cernanto/llm-prompt/openai endpoint=<chat-completions url>`); the key is the
secret setting `token`, read through cernanto/config, the request going without one when it names none; the
model is the call's, else `model` (without either
the turn fails terminal with exactly `no model for the openai engine:
cernanto config cernanto/llm-prompt/openai model=<model>`). Every setting
is read fresh on every turn. Transient failures (429, 5xx, network)
retry with backoff honoring Retry-After, four attempts in all, then
fail retryable; other 4xx are terminal in the endpoint's words. Each
request the endpoint answered is reported through the os module's
`usage`, its `usage.prompt_tokens` the input tokens and its
`usage.completion_tokens` the output tokens, with no cost, the
endpoint naming no price, and the answered `model` is the endpoint's.
A truncated reply is flagged from the finish reason; a schema asked
rides `response_format` (`json_schema`, strict), and the reply's text
parsed as JSON is the structured value. Attachments ride the user
message as a content array: for each, in order, a `text` part `Image N
(label):` or `Document N (label):` (the number counted within its
kind, the label when given), then for an image an `image_url` part
whose url is a data URL of the content type and the bytes, for
`application/pdf` a `file` part with `file_data` the data URL and
`filename` the label or `document-N.pdf`; then the prompt as a `text`
part. Without attachments the message content is the prompt string.
`web` is refused in words before any request: an OpenAI-compatible
chat endpoint does not browse, and a search runs on the harness
engine. An endpoint whose own words say the key is no good ("invalid
api key", a 401, "unauthorized") fails the turn terminal, naming the
engine, quoting the first line of what it said, and naming what heals
it: `cernanto config cernanto/llm-prompt/openai token=<api key>`.

## Tests

Uses: npm:jimp
Mocks: cernanto/config

The tests serve an OpenAI-compatible endpoint of their own on a
loopback port for their duration, answering every chat completion with
the number 42 under the one field the request's schema names, and hand its url to this agent as its setting `endpoint` and a model name as
its `model` through a shadow of cernanto/config answering those names. The picture the tests carry is drawn by the tests themselves, a
PNG of a few hundred pixels showing the digits 42 in a large font on
white, and the question of text asks for a number whose answer is 42.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
