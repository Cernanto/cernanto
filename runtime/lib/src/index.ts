// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The package's root is the agent language: the words the emitted os
// module re-exports and an agent's code writes. The wire and link
// family lives behind ./calls (emitted files and module twins); the
// machine behind ./serve (the block, the fixtures, the plane); ./tests,
// ./mcp and ./openapi carry their own surfaces. The root exports what
// an agent may use, and nothing an agent cannot.

export {
  agentId,
  artifact,
  composition,
  substrateUrl,
  caller,
  callId,
  invoke,
  cancel,
  usage,
  secretHandler,
} from './language/core.js';
export type { AgentFunction, Definition, Invoked } from './language/core.js';
export { reviveWire, wiredHandler } from './language/shapes.js';
export type { WireShape } from './language/shapes.js';
// The error vocabulary of the handler language: a thrown error tagged
// `kind: 'retryable'` keeps the substrate retry; a plain Error is
// terminal.
export { CernantoError, isCernantoError } from './language/errors.js';
export type { ErrorKind, ErrorEnvelope } from './language/errors.js';
