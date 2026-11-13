// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { PACKAGE_TESTS_DIR } from '@cernanto/package-format';
import type { CernPackage } from '@cernanto/package-format';

import { folderOfTarget, readSeams } from './agent-package.js';
import type { ReadSeams } from './agent-package.js';
import { fail, outputOf } from './output.js';
import type { OutputOptions } from './output.js';

// `cernanto tests <agent-id | file.cern | name[@version]>`: the tests
// the compile wrote for an agent, every file under a heading with its
// path in the package; a deploy runs them live. The argument is read
// as `contract` reads it: a deployed agent, a package file, or a
// package in the registry.

/** What a package without tests says: an interface's tests are its
 * implementors', a worker carries none, and any other package says it
 * holds none. */
export function noTestsWords(pkg: CernPackage): string {
  const { name, type } = pkg.manifest;
  if (type === 'interface') {
    return `${name} is an interface: the agents that implement it carry the tests`;
  }
  if (type === 'worker') return `${name} is a worker, and a worker carries no tests`;
  return `no tests in the package of ${name}`;
}

/** The tests of the package an argument names, as text or json. */
export function testsOf(target: string, options: OutputOptions, seams: ReadSeams): Promise<string> {
  return folderOfTarget(target, PACKAGE_TESTS_DIR, options, seams, noTestsWords);
}

export function registerTests(program: Command): void {
  program
    .command('tests')
    .argument(
      '<agent-id-or-package>',
      'an agent by id, a .cern package file, or a registry package by name or name@version',
    )
    .option('-o, --output <format>', 'text or json (each file by its path)')
    .description('the tests the compile wrote for an agent, every file under its name')
    .action(async (target: string, options: { output?: string }) => {
      try {
        process.stdout.write(await testsOf(target, outputOf(options), readSeams()));
      } catch (error) {
        fail(error);
      }
    });
}
