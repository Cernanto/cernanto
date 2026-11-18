// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What the runtime does on the machine it runs on, the same call on
// every system: the processes, a program run by its name, the choice
// of a child's environment, links, the toolbox and the monotonic clock
// its own waits are counted on. For the process package (the block,
// the launcher and the materialize), and it names what that package
// uses and nothing else: a proof reads a module of the kernel by its
// own file.
export {
  answerOf,
  endRecorded,
  identityOf,
  measured,
  present,
  sample,
} from './kernel/process-adapter.js';
export type { EndHow, Identity, Recorded, Sample } from './kernel/process-adapter.js';
export { execute, npmCommand } from './kernel/programs.js';
export { CHILD_ENVIRONMENT_NAMES, childEnvironment, setUnder } from './kernel/child-environment.js';
export { linkFile, linkFolder } from './kernel/links.js';
export { makeToolbox } from './kernel/toolbox.js';
export { wallElapsedMs } from './kernel/clock.js';
// The block's words about the machine, as the seam says them.
export { BLOCK_WORDS } from './kernel/seam.js';
export type { EndAnswer, ToolboxAnswer } from './kernel/seam.js';
