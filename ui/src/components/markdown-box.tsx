// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';

import { Markdown } from './markdown.js';
import { Quiet } from './ui.js';

// A text of Markdown in its box. A text that may be written is written
// where it stands: the box is its writing surface from the start, with
// no way to choose first, and the surface draws the text as a reader
// meets it while it is written, a title as a title and a paragraph
// flowing over the box. The bar that puts the marks in for a writer who
// does not type them stands in the box's head, pale until the box has
// the keyboard or the pointer, so a text that is only read is not
// crowded by it. A text that is read alone is drawn, with no head.

// The writing surface is the heaviest thing the UI carries: it is a
// file of its own, asked for when a text is first shown to be written.
const Editor = lazy(() => import('./prose-editor.js'));

/**
 * A text of Markdown, written where it may be and drawn where it is read alone.
 *
 * @param onChange - Takes the text as it is written; a box given none is read alone, and has no head.
 * @param rows - The lines the box is tall while its text holds fewer.
 */
export function MarkdownBox({
  text,
  onChange,
  label,
  rows = 4,
}: {
  text: string;
  onChange?: ((text: string) => void) | undefined;
  /** The text's name, for a reader who does not see the head over it. */
  label: string;
  rows?: number;
}): ReactNode {
  // The bar of marks is the writing surface's own, drawn in the box's head.
  const [bar, setBar] = useState<HTMLDivElement | null>(null);

  if (onChange === undefined) {
    return (
      <div className="rounded-md border bg-sunken">
        <Markdown text={text} className="px-3.5 py-3" />
      </div>
    );
  }
  return (
    <div className="group rounded-md border border-line-strong bg-sunken focus-within:border-ink">
      <div
        ref={setBar}
        className="flex min-h-10 items-center border-b px-1.5 py-1 opacity-40 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100"
      />
      <Suspense fallback={<Quiet>Opening…</Quiet>}>
        <Editor text={text} onChange={onChange} label={label} rows={rows} bar={bar} />
      </Suspense>
    </div>
  );
}
