#!/usr/bin/env node
// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { currentContext, overrideContext } from './context.js';
import { startBoxWhenNeeded } from './dev.js';
import { compileProgram } from './program.js';

// The one binary, a client of the plane. The verbs register in
// program.ts, one line per module; this file holds what belongs to the
// process: the context override, the local plane that starts when a
// command needs it, and the exit codes.

// The local plane starts when a command needs it: a refused connection
// to the plane on this machine starts the local plane and the request
// goes again. The dev verbs manage the plane themselves.
startBoxWhenNeeded();

const program = compileProgram();

// `--context <name>` picks a plane for this process only. The program
// parses the option once, in either spelling (`--context name`,
// `--context=name`), and it is applied here before any verb reads the
// context: the plane is the context's, and a stage is a plane. A name
// no context carries is refused before the verb runs.
program.hook('preAction', () => {
  const named = program.opts<{ context?: string }>().context;
  if (named === undefined) return;
  overrideContext(named);
  currentContext();
});

// Usage errors exit 2; the help and the version flag exit 0.
program.exitOverride((error) => {
  if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
    process.exit(0);
  }
  process.exit(error.code.startsWith('commander.') ? 2 : error.exitCode);
});
program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
