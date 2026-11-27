// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { CompileKind, CompileSwitches } from '../../../state/compiles.js';

/** One way to deploy a source besides the plain one: its words, and what it asks of the compile. */
export interface DeployWay {
  word: string;
  hint: string;
  kind: CompileKind;
  switches: CompileSwitches;
}

/**
 * The ways to deploy a source besides the plain one, in the words the
 * page says them. They are offered wherever a source is deployed: under
 * a draft, and in an agent's menu for the source it already runs.
 */
export const DEPLOY_WAYS: readonly DeployWay[] = [
  {
    word: 'Without the tests',
    hint: 'Shipped as compiled, not verified',
    kind: 'deploy',
    switches: { noVerify: true },
  },
  {
    word: 'Compile and stop before the ship',
    hint: 'The package is made and nothing runs it',
    kind: 'compile',
    switches: {},
  },
  {
    word: 'Write the code again from the source',
    hint: 'The previous compile is set aside',
    kind: 'deploy',
    switches: { recompile: true },
  },
  {
    word: 'With a new contract',
    hint: 'The agents that use it compile with it where it breaks them',
    kind: 'deploy',
    switches: { newContract: true },
  },
  {
    word: 'Stop at the first failed round',
    hint: 'No triage and no fix',
    kind: 'deploy',
    switches: { failFast: true },
  },
];

/**
 * The dry run, under the cli's own name for it (`deploy --dry-run`):
 * what a deploy of a draft would do, asked of the compile and not done.
 * It is no way to deploy, so it stands apart at the menu's end, and on
 * no button of its own: its answer says little of a small agent nothing
 * uses, and much of one whose contract others are pinned to.
 */
export const DRY_RUN = {
  word: 'Dry run',
  hint: 'What a deploy would do. Nothing is written, verified or shipped',
  /** What it does all the same, for a reader who points at it. */
  more: 'An agent the source uses that this plane does not run is installed from the registry first.',
} as const;
