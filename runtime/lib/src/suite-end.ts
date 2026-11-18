// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The file a suite runs last. The teardowns the test files register at
// their top level run once every test is over, in the order the files
// were read, and say nothing when they pass: this file's one teardown
// runs after them and tells the suite's runner that they have all run.

import { after } from 'node:test';

/** The name the runner keeps its signal under for the suite's run. */
const SUITE_END_SIGNAL = Symbol.for('cernanto.suite-end');

after(() => {
  const signal = (globalThis as Record<symbol, unknown>)[SUITE_END_SIGNAL];
  if (typeof signal === 'function') (signal as () => void)();
});
