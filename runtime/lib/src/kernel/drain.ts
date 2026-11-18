// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The drain's stop of a process's intake, on SIGTERM or on a word of
// the plane: no new call lands here, and a service's calls that wait on
// its memory are answered that the version is replaced.

import { ServedUnit } from './units.js';

/** The drain's stop of this process's intake: the lane stopped so no
 * new call lands here, and a service's waits answered. Once: a word and
 * SIGTERM may both ask. */
export function drainAdapter(unit: ServedUnit): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    unit.setServing(false);
    const program = unit.program;
    if (program !== undefined) {
      void program
        .answerWaitingReplaced()
        .catch(() => undefined)
        .finally(() => {
          program.wakeForDrain();
        });
    }
  };
}
