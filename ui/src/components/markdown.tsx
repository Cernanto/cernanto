// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { lazy, Suspense } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import { Quiet } from './ui.js';

// A Markdown text is drawn from the editor's own parser, and the editor
// is the heaviest thing the UI carries: the drawing is a file of its
// own beside the editor's, asked for when a text is first shown drawn.
const View = lazy(() => import('./markdown-view.js'));

/** A Markdown text, drawn: headings, lists, tables and blocks of code. */
export function Markdown(props: ComponentProps<typeof View>): ReactNode {
  return (
    <Suspense fallback={<Quiet>Opening…</Quiet>}>
      <View {...props} />
    </Suspense>
  );
}
