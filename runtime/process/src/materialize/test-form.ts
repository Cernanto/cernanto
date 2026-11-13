// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
// The test form: the package's own bytes materialized as themselves,
// then every mocked id of its Tests block rewritten at every depth of
// the composition: the agent's stub of the mocked id and each composed
// module's become the mock the tests wrote, linked statically beside
// them; a mocked module is left out of the composition by the caller.
// The rule: a mock replaces an edge of the process under test; anything
// reached over the wire is live unless mocked itself.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  handlersOf,
  secretHandlersOf,
  wireParametersOf,
  wireShapesOfSurface,
} from './declarations.js';
import { staticMockBind, staticMockStub, stubFileName } from './glue.js';
import { installClosure } from './install.js';
import type { ReadPackage } from './manifest.js';
import { resolveFacts, surfaceOf } from './materialize-package.js';
import type { DependencyResolver } from './materialize-package.js';
import { javaScriptNameOf, stripToJavaScript } from './strip.js';

export interface ApplyTestFormInput {
  /** The package whose tests list the mocks. */
  pkg: ReadPackage;
  /** The directories the rewrite runs in, by the id each serves: the
   * agent's own first, then every composed module's. A mocked module's
   * own directory, when handed in, is left as it is. */
  dirs: Readonly<Record<string, string>>;
  dependency: DependencyResolver;
  /** The environment the install runs under (npm's). */
  env?: NodeJS.ProcessEnv | undefined;
  log?: ((line: string) => void) | undefined;
}

export interface AppliedTestForm {
  /** The mocked ids, sorted. */
  mocked: string[];
  /** The ids of `dirs` whose stubs were rewritten, each with the
   * mocked ids it took, sorted. */
  rewritten: Record<string, string[]>;
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** The mock the tests carry for an id: `mocks/<the id's stub name>.ts`
 * (or its JavaScript twin), the name the tests block wrote it under. */
function mockSourceOf(pkg: ReadPackage, id: string): { name: string; text: string } {
  const file = stubFileName(id);
  for (const name of [
    `mocks/${file}.ts`,
    `mocks/${file}.mts`,
    `mocks/${file}.js`,
    `mocks/${file}.mjs`,
  ]) {
    const bytes = pkg.tests[name];
    if (bytes !== undefined) return { name, text: bytes.toString('utf8') };
  }
  throw new Error(
    `${pkg.manifest.name}: its tests list a mock of ${id} but carry no mocks/${file}.ts`,
  );
}

/**
 * Rewrites the mocked edges in every directory given: for each mocked
 * id, the mock's file compiled to `dist/mocks/<stub>.js` and the stub
 * at `dist/agents/<stub>.js` replaced by the static mock stub (a bind
 * for an interface) wherever a directory carries that stub. A package
 * whose tests list no mocks is left untouched.
 */
export async function applyTestForm(input: ApplyTestFormInput): Promise<AppliedTestForm> {
  const log = input.log ?? ((): void => undefined);
  const { pkg } = input;
  const target = pkg.manifest.name;
  const mocked = [...new Set((pkg.manifest.tests?.mocks ?? []).map((mock) => mock.id))].sort(
    (a, b) => a.localeCompare(b),
  );
  const rewritten: Record<string, string[]> = {};
  if (mocked.length === 0) return { mocked, rewritten };
  for (const id of mocked) {
    const facts = await resolveFacts(
      input.dependency,
      id,
      `the mock of ${id} in the test form of ${target}`,
    );
    const surface = surfaceOf(facts);
    const mock = mockSourceOf(pkg, id);
    const file = stubFileName(id);
    const stubSource =
      facts.type === 'interface'
        ? staticMockBind(
            id,
            handlersOf(surface),
            file,
            secretHandlersOf(surface),
            wireShapesOfSurface(surface),
            wireParametersOf(surface),
          )
        : staticMockStub(id, surface, file);
    const compiledName = javaScriptNameOf(mock.name);
    const compiled =
      compiledName === mock.name ? mock.text : stripToJavaScript(mock.text, mock.name);
    for (const [owner, dir] of Object.entries(input.dirs)) {
      if (mocked.includes(owner)) continue;
      const stub = join(dir, 'dist', 'agents', `${file}.js`);
      if (!existsSync(stub)) continue;
      writeText(join(dir, 'dist', 'mocks', `${file}.js`), compiled);
      writeText(stub, stubSource);
      (rewritten[owner] ??= []).push(id);
    }
  }
  for (const ids of Object.values(rewritten)) ids.sort((a, b) => a.localeCompare(b));
  // A mock runs in the target's process and imports what the tests were
  // granted (`tests.npm`, the tests' own lock): the closure lands
  // beside the mocks, `dist/mocks/node_modules`, where Node resolves a
  // mock's imports from, apart from the target's own packages.
  const testsNpm = pkg.manifest.tests?.npm ?? {};
  if (Object.keys(testsNpm).length > 0 || pkg.testsLock !== undefined) {
    for (const owner of Object.keys(rewritten)) {
      const dir = input.dirs[owner];
      if (dir === undefined) continue;
      await installClosure({
        directory: join(dir, 'dist', 'mocks'),
        packageName: `cernanto-mocks-of-${stubFileName(target)}`,
        npm: testsNpm,
        lock: pkg.testsLock,
        env: input.env,
        log,
      });
    }
  }
  const where = Object.keys(rewritten);
  log(
    `${target}: test form, ${mocked.join(', ')} mocked${where.length === 0 ? ' nowhere (no directory imports them)' : ` in ${where.join(', ')}`}`,
  );
  return { mocked, rewritten };
}
