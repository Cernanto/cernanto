Check whether the following contract fully satisfies the module
specification.

Rules for the check:

- Every function described in the specification must have a matching
  handler signature in the contract.
- The contract must not introduce extra handlers that are not mentioned in
  the specification.
- For each matching handler: parameters must match in type and purpose
  (names can differ), and the return value must match. `Promise<T>` and
  `T` are different types: an asynchronous function is a handler and a
  synchronous one a helper, and a caller awaits the one and not the
  other, so a change between them is a mismatch. Extra or
  missing parameters or return fields are a mismatch.
- Implementation details (how something is done) that do not affect the
  signature are ignored. Focus on the public contract: what inputs are
  accepted, what outputs are returned, and what the documentation
  promises.
- The contract's documentation is part of it: a consumer's coder reads a
  function's description, the meaning of its parameters and its stated
  refusals as the promise. A function whose documented behaviour the
  specification now contradicts, or a documented promise the
  specification no longer makes, is a mismatch even when the signature
  holds, and so is a promise whose conditions moved (after what event,
  within what time, for whom); a rewording that keeps the promise is
  not, and neither is a change in how the promise is kept.
- Any signature-level difference counts as a mismatch.
- When the change since the previous compile is given (a diff of the
  specification, the contracts and listings that moved), judge the
  change: the contract is outgrown only when the change forces a
  signature-level difference or moves a documented promise; a mismatch
  the change did not create is not this compile's to fix.
- An operation an implemented interface declares is mentioned by the
  specification's `Implements:` line, never extra: when the context
  carries the implemented interface contracts, every operation they
  declare belongs to the surface.
