// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The run a worker starts by itself. A process is started by booting
// it and stopped by killing it, so a worker whose launch names its run
// starts that run when it boots: when a program runs is when its
// process exists.

/** The key a worker's run is called under: the one the controller's
 * start by message uses, so a run begun either way is one call and a
 * process that restarts resumes it. A later run (the operator started
 * the worker again) is a call of its own, because the retained answer
 * of the run before it would answer it otherwise. */
export function workerRunKey(agentId: string, generation: string, run: number): string {
  const first = `worker:${agentId}:p${generation}`;
  return run > 0 ? `${first}:r${String(run)}` : first;
}
