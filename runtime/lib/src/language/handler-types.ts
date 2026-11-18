// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/** A handler exposed by a service or run by a worker. */
export type HandlerFn = (input: unknown) => Promise<unknown>;

/** A typed stub for a dependency's handler; generated per dependency. */
export interface AgentStub<TArgs, TResult> {
  readonly agentId: string;
  readonly handler: string;
  readonly signature?: (args: TArgs) => Promise<TResult>;
  /** The handler's arguments or answer are secrets (the contract's
   * `Secret<T>` mark): the call keeps both out of its traces, and the
   * callee keeps its own run's out as well. */
  readonly secret?: boolean;
  /** The interface the call is bound through and its contract's hash:
   * the callee answers only when it implements that interface at that
   * contract, and refuses in words otherwise. */
  readonly bound?: InterfaceBinding;
}

/** An interface a call is bound through, by its id and its contract's
 * hash. */
export interface InterfaceBinding {
  readonly interface: string;
  readonly sha: string;
}
