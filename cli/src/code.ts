// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { PACKAGE_CODE_DIR } from '@cernanto/package-format';

import { folderOfTarget, readSeams } from './agent-package.js';
import type { ReadSeams } from './agent-package.js';
import { fail, outputOf } from './output.js';
import type { OutputOptions } from './output.js';

// `cernanto code <agent-id | file.cern | name[@version]>`: the code the
// compile wrote for an agent, every file under a heading with its path
// in the package, the entry module first. The argument is read as
// `contract` reads it: a deployed agent, a package file, or a package
// in the registry.

/** The code of the package an argument names, as text or json. */
export function codeOf(target: string, options: OutputOptions, seams: ReadSeams): Promise<string> {
  return folderOfTarget(
    target,
    PACKAGE_CODE_DIR,
    options,
    seams,
    (pkg) => `no code in the package of ${pkg.manifest.name}`,
  );
}

export function registerCode(program: Command): void {
  program
    .command('code')
    .argument(
      '<agent-id-or-package>',
      'an agent by id, a .cern package file, or a registry package by name or name@version',
    )
    .option('-o, --output <format>', 'text or json (each file by its path)')
    .description('the code the compile wrote for an agent, every file under its name')
    .action(async (target: string, options: { output?: string }) => {
      try {
        process.stdout.write(await codeOf(target, outputOf(options), readSeams()));
      } catch (error) {
        fail(error);
      }
    });
}
