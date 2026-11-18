// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The emission vocabulary: the wire and link family only
// compiler-emitted files (the generated modules under dist/agents,
// dist/mcp, dist/openapi) and the platform's hand-written module twins
// import. Coder-written code reaches every dependency through its
// generated module, and the determinism gate refuses any runtime import
// in hand-written files.
export { boundImplementor, boundInterface, call, linkedCall, stub } from './language/core.js';
export { reviveWire } from './language/shapes.js';
export type { WireShape } from './language/shapes.js';
export { linkedFunction } from './language/linked.js';
