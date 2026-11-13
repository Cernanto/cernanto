// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { CernantoError } from './errors.js';

// A module composed into a process is named by the generation's own
// table (`dist/linked.js`, emitted at materialize from the composition
// the plane decided). What is left to the runtime is one check on the
// module's surface.

/** One exported turn of a linked module, by name; a module composed
 * here that lacks it is a terminal fault in words (the coverage gate
 * pins every implementor to the interface, so this names a broken
 * composition). */
export function linkedFunction(
  agentId: string,
  namespace: Readonly<Record<string, unknown>>,
  name: string,
): (args: unknown) => Promise<unknown> {
  const fn = namespace[name];
  if (typeof fn !== 'function') {
    throw new CernantoError({
      kind: 'terminal',
      message: `${agentId} is composed into this process but exports no ${name}; rebuild it against the interface`,
    });
  }
  return fn as (args: unknown) => Promise<unknown>;
}
