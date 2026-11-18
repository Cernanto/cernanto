// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The runtime's own commands: a program the runtime itself starts (a
// read of the machine's processes, a lane's server) runs outside any
// call, and the command keeper lets it through. One mark says so, read
// by the keeper and set by whoever starts such a program.

import { AsyncLocalStorage } from 'node:async_hooks';

const own = new AsyncLocalStorage<true>();

/** Runs the runtime's own command work: a program started under it
 * belongs to the runtime and to no call. */
export function asRuntimeCommand<T>(fn: () => T): T {
  return own.run(true, fn);
}

/** Whether the code running now is the runtime's own command work. */
export function isRuntimeCommand(): boolean {
  return own.getStore() === true;
}
