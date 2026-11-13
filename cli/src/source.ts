// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { relative, resolve, sep } from 'node:path';

import type { Command } from 'commander';

import { CernantoError, PACKAGE_SPEC_PATH, specFileNameOf } from '@cernanto/package-format';

import { packageOfTarget, readSeams } from './agent-package.js';
import type { ReadSeams } from './agent-package.js';
import { planLaying, sourceFilesOf, writeLaying } from './deploy/granted-files.js';
import { fail, outputOf } from './output.js';
import type { OutputOptions } from './output.js';

// `cernanto source <agent-id | file.cern | name[@version]> [--to <folder>]`:
// the source an agent was compiled from, as its package holds it. The
// source is what its author wrote: the page, and the files the page
// names on its labels (the files its code is granted, the files its
// tests are granted, a document it implements from the tree). The
// argument is read as `contract` reads it: a deployed agent, a package
// file, or a package in the registry.
//
// Without `--to` the verb prints the page as its own bytes, with no
// heading and nothing added, so a redirect writes the very file the
// package was compiled from. With `--to <folder>` it writes the whole
// source under that folder, the page at the path the agent's id names
// and each file where the page's grant names it, so the folder reads
// as a workspace does. It lays no package: a package of the registry is
// taken with its package beside the page by `cernanto registry get`.

/** A package as the reading verbs hold one. */
type Package = Awaited<ReturnType<typeof packageOfTarget>>;

/** The page of a package: its own text, or as json the text by its path
 * in the package, the form `code` and `tests` answer their files in. */
export function pageOf(pkg: Pick<Package, 'spec'>, options: OutputOptions): string {
  if (options.output === 'json') {
    return `${JSON.stringify({ files: { [PACKAGE_SPEC_PATH]: pkg.spec } }, null, 2)}\n`;
  }
  return pkg.spec;
}

/** The page of the package an argument names. */
export async function sourceOf(
  target: string,
  options: OutputOptions,
  seams: ReadSeams,
): Promise<string> {
  return pageOf(await packageOfTarget(target, seams), options);
}

/**
 * Writes the source of a package under a folder: its page and every
 * file the page grants, each at its place. All or nothing and over
 * nothing: a file that stands at the very bytes is left, and a file
 * that stands with other content refuses the whole.
 *
 * @param pkg - The package, read.
 * @param folder - The folder the source is written under.
 * @param options - `json` answers the folder and the files by their paths.
 * @returns What a person reads: one line per file of the source, then where it lies.
 * @example
 * process.stdout.write(laySource(pkg, './read', {}));
 */
export function laySource(
  pkg: Pick<Package, 'spec' | 'manifest' | 'files' | 'tests'>,
  folder: string,
  options: OutputOptions,
): string {
  const root = resolve(folder);
  const agentId = pkg.manifest.name;
  const refuse = (words: string): never => {
    throw new CernantoError({ kind: 'terminal', message: `nothing was written:\n  ${words}` });
  };
  const source = sourceFilesOf(root, specFileNameOf(agentId), pkg);
  if ('problem' in source) return refuse(`${agentId}: ${source.problem}`);
  const laying = planLaying(root, source.files);
  if (laying.problems.length > 0) return refuse(laying.problems.join('\n  '));
  writeLaying(laying.writes);
  const paths = source.files.map((one) => relative(root, one.path).split(sep).join('/'));
  if (options.output === 'json') {
    return `${JSON.stringify({ agent: agentId, folder: root, files: paths }, null, 2)}\n`;
  }
  const named = paths.length - 1;
  return [
    ...paths,
    `the source of ${agentId} is in ${folder}: its page${named === 0 ? '' : ` and the ${String(named)} file${named === 1 ? '' : 's'} it names`}`,
    '',
  ].join('\n');
}

/** Writes the source of the package an argument names under a folder. */
export async function extractSource(
  target: string,
  folder: string,
  options: OutputOptions,
  seams: ReadSeams,
): Promise<string> {
  return laySource(await packageOfTarget(target, seams), folder, options);
}

/** How many files ride with a package's page, for the line a terminal
 * reads under a printed page; zero when the page names none or they
 * have no place. */
function filesBesideThePage(pkg: Pick<Package, 'spec' | 'manifest' | 'files' | 'tests'>): number {
  const source = sourceFilesOf(resolve('.'), specFileNameOf(pkg.manifest.name), pkg);
  return 'problem' in source ? 0 : source.files.length - 1;
}

export function registerSource(program: Command): void {
  program
    .command('source')
    .argument(
      '<agent-id-or-package>',
      'an agent by id, a .cern package file, or a registry package by name or name@version',
    )
    .option('-o, --output <format>', 'text or json (the page by its path)')
    .option(
      '--to <folder>',
      'write the page and every file it names under this folder, each at its place',
    )
    .description(
      'the source an agent was compiled from, as its package holds it: the page, and with --to the files it names',
    )
    .action(async (target: string, options: { output?: string; to?: string }) => {
      try {
        const pkg = await packageOfTarget(target, readSeams());
        if (options.to !== undefined) {
          process.stdout.write(laySource(pkg, options.to, outputOf(options)));
          return;
        }
        process.stdout.write(pageOf(pkg, outputOf(options)));
        // At a terminal, a page that names files says how to take them
        // too; a pipe or a redirect gets the page alone.
        if (process.stdout.isTTY && options.output === undefined) {
          const beside = filesBesideThePage(pkg);
          if (beside > 0) {
            process.stderr.write(
              `\n${String(beside)} file${beside === 1 ? '' : 's'} the page names ride${beside === 1 ? 's' : ''} in the package; write the page and ${beside === 1 ? 'it' : 'them'} with: cernanto source ${target} --to <folder>\n`,
            );
          }
        }
      } catch (error) {
        fail(error);
      }
    });
}
