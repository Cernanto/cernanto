// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The trace sink's road to the store: a life's part is one write of
// the process's own substrate, no call, no other process, no journal
// record. A substrate that is closed (the process leaves) answers
// nothing known, and the close's budget decides; one that is suspended
// (a pause) holds the write until it resumes.

import type { LifePart, SaveAnswer } from '../kernel/substrate.js';
import { substrate } from '../kernel/connection.js';

/** Writes one life's part through the process's substrate. */
export async function writeTracePart(part: LifePart): Promise<SaveAnswer> {
  try {
    const handles = await substrate();
    return await handles.traces.write(part);
  } catch {
    return 'unknown';
  }
}
