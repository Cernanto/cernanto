// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { lazy, Suspense } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import { Quiet } from './ui.js';

// The editor is the heaviest thing the UI carries, and a reader who
// only watches conversations never needs it: it is a file of its own,
// asked for when a code or a source is first opened.
const Editor = lazy(() => import('./code-editor.js'));

export type { CodeLanguage } from './code-editor.js';

/** A text in the editor: to read, or to change when `onChange` is given. */
export function Code(props: ComponentProps<typeof Editor>): ReactNode {
  return (
    <Suspense fallback={<Quiet>Opening…</Quiet>}>
      <Editor {...props} />
    </Suspense>
  );
}

/** The language a file's name says. */
export function languageOfFile(name: string): 'typescript' | 'markdown' | 'json' | 'yaml' | 'text' {
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) return 'typescript';
  if (/\.(md|markdown)$/.test(name)) return 'markdown';
  if (/\.json$/.test(name)) return 'json';
  if (/\.(yaml|yml)$/.test(name)) return 'yaml';
  return 'text';
}
