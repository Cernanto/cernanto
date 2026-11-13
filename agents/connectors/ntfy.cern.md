# Ntfy

Given a topic, a title and a message, publish the message under that
title to the topic on the public ntfy.sh board (a post to
`https://ntfy.sh/<topic>`, the message as the body and the title as
the `Title` header), and answer the id and the time the board gave
it.

## Tests

Publish to a topic whose name is a fresh random one, then read the
topic back through the board's poll road
(`https://ntfy.sh/<topic>/json?poll=1&since=all`, one JSON object per
line, each with the message's id, title and message), which shows a
message a second or two after its publish, and check it is there with
the id the publish answered.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
