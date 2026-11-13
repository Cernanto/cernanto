// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// TypeScript to JavaScript at materialize: the coder's and the tester's
// files are certified erasable (the compiler's tsconfig sets
// `verbatimModuleSyntax` and `erasableSyntaxOnly`), so node's own
// stripper answers, its types replaced by whitespace and every line
// kept where it was. TypeScript's transpiler is the fallback for a file
// the stripper refuses, so a certified package still materializes on a
// stripper that moved.

import { stripTypeScriptTypes } from 'node:module';

import ts from 'typescript';

let warningsQuieted = false;

/** Node's stripper is still flagged experimental and says so once per
 * process on stderr; that one warning is kept out of the materialize's
 * output. */
function quietExperimentalWarning(): void {
  if (warningsQuieted) return;
  warningsQuieted = true;
  const listeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning: Error) => {
    if (
      warning.name === 'ExperimentalWarning' &&
      warning.message.includes('stripTypeScriptTypes')
    ) {
      return;
    }
    for (const listener of listeners) listener(warning);
  });
}

/** Strips one TypeScript source to JavaScript. */
export function stripToJavaScript(source: string, fileName: string): string {
  quietExperimentalWarning();
  try {
    return stripTypeScriptTypes(source, { mode: 'strip' });
  } catch {
    // Not erasable by the stripper: TypeScript's transpiler handles
    // the rest (an enum, a namespace) without a type check. The
    // directory a process boots from is an ES module package, so a
    // `.ts` and a `.mts` file come out as ES modules, the imports and
    // exports as written; a `.cts` file comes out as CommonJS by its
    // own extension.
    const result = ts.transpileModule(source, {
      fileName,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
        verbatimModuleSyntax: true,
      },
      reportDiagnostics: false,
    });
    return result.outputText;
  }
}

/** The JavaScript file name of a TypeScript source (`a/b.ts` reads
 * `a/b.js`); a declaration file has none (it is types alone). */
export function javaScriptNameOf(fileName: string): string | undefined {
  if (fileName.endsWith('.d.ts') || fileName.endsWith('.d.mts') || fileName.endsWith('.d.cts')) {
    return undefined;
  }
  if (fileName.endsWith('.ts')) return `${fileName.slice(0, -3)}.js`;
  if (fileName.endsWith('.mts')) return `${fileName.slice(0, -4)}.mjs`;
  if (fileName.endsWith('.cts')) return `${fileName.slice(0, -4)}.cjs`;
  return fileName;
}
