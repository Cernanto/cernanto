// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The machine's clocks for the runtime's own bookkeeping: the wall
// clock on every trace record (operators read them, and the trace
// renderer derives durations from at-differences) and the monotonic
// clock for the durations the runtime measures itself.

// Captured at load, before the transparent globals are installed
// (kernel/globals.ts), so the runtime's own time is the machine's,
// whatever moment a replay reads.
const realPerformanceNow = performance.now.bind(performance);
const realNow = Date.now.bind(Date);

/** The machine's monotonic milliseconds for durations. */
export function wallElapsedMs(): number {
  return realPerformanceNow();
}

/** The wall clock in milliseconds. */
export function wallNowMs(): number {
  return realNow();
}

/** The wall-clock iso stamp for trace records and machine bookkeeping. */
export function wallNowIso(): string {
  return new Date(wallNowMs()).toISOString();
}
