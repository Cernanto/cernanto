# cernanto/documents

An interface: the plane's documents, keyed strings with a
compare-and-set write and a listing by prefix, as the
platform's agents reach them wherever the plane runs. An implementor
answers for the store the plane runs on, and every implementor is a
module linked into its consumer's process. A consumer binds it with no
name, and the plane binds the implementor of the store it runs on.

A key is plain text: an implementor keeps and answers a key exactly as
it was handed, whatever characters it carries, and a store whose own
names take fewer characters converts inside its implementor. The
family of a key is its text up to its first `/`. Every record has one
owner, the agent that writes it, which keeps its records under a
family named after itself (`auth/`, `config/`, `controller/`,
`packages/`, `compile/progress/`) beside the plane's own families.

The operations:

- READ a key: the document's string and its revision, or null and the
  revision a later write resting on absence honours, when there is
  none.
- WRITE a key compare-and-set: `expected` is the exact current string
  the write rests on (null for "must not exist yet") and `value` the
  whole new string (null removing the document); the answer says
  whether the write landed and carries the current string either way;
  one attempt.
- LIST a prefix: every key under it with its string and revision,
  strongly consistent, every write acknowledged before the call began
  among them.

Type: interface

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
