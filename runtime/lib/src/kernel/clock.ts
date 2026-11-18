// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The machine's clocks for the runtime's own bookkeeping. The wall
// clock tells a moment: what is written down (a record, a trace, which
// operators read and the trace renderer subtracts), what is compared
// with a moment written down, a file's or a record's, the moment an
// agent's timer is due, which its log keeps and its copy tells the
// host job, and the time an agent's code is told. The monotonic clock
// tells time that passed, for every span the runtime counts by itself:
// a duration, a grace before a process is ended, a patience before an
// ask is given up, the while between two looks, a budget, a rate. A
// correction of the wall clock neither cuts those short nor stretches
// them.

// Captured at load, before the transparent globals are installed
// (kernel/globals.ts), so the runtime's own time is the machine's,
// whatever moment a replay reads.
const realPerformanceNow = performance.now.bind(performance);
const realNow = Date.now.bind(Date);

/** What the monotonic clock last read here, and what is added to what
 * it reads now. */
let lastRead = Number.NEGATIVE_INFINITY;
let carried = 0;

/** The machine's monotonic milliseconds for durations. It never reads
 * less than it did. A process brought back from an image is brought
 * back under whatever clock its server has then: where that clock
 * reads less than the one it left, the count goes on from where it
 * stood, so no span counted across that moment waits for the clock to
 * catch up; where it reads more, the spans in flight have passed. */
export function wallElapsedMs(): number {
  const read = realPerformanceNow() + carried;
  if (read >= lastRead) {
    lastRead = read;
    return read;
  }
  carried += lastRead - read;
  return lastRead;
}

/** The wall clock in milliseconds. */
export function wallNowMs(): number {
  return realNow();
}

/** The wall-clock iso stamp for trace records and machine bookkeeping. */
export function wallNowIso(): string {
  return new Date(wallNowMs()).toISOString();
}
