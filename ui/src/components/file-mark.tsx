// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { ReactNode } from 'react';

import markdownMark from '../assets/marks/markdown.svg?raw';
import { Mark } from './mark.js';
import { drawing } from './vector.js';

/** The two files an agent is carried in: its source, which is a
 * Markdown file, and its package, which is Cernanto's own format. */
export type AgentFile = 'source' | 'package';

/** The Markdown mark as the page draws it. */
const MARKDOWN = drawing(markdownMark);

/** How much wider than a square drawing the Markdown mark stands, so
 * that the eye takes the two for one size: it is a wide plate, and at a
 * square's width it would read as the smaller of the two. */
const WIDE = 1.15;
/** The Markdown mark's own proportions, which its guidelines ask for. */
const PROPORTION = 128 / 208;

/** A file's mark is its format's own, as a file wears it in a file
 * manager and in an editor: Markdown's for a source, Cernanto's for a
 * package. It is a picture beside words that name the file, so it says
 * nothing aloud. */
export function FileMark({ file, size = 20 }: { file: AgentFile; size?: number }): ReactNode {
  if (file === 'package') {
    return (
      <span aria-hidden="true" className="inline-flex shrink-0">
        <Mark size={size} />
      </span>
    );
  }
  const width = Math.round(size * WIDE);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 text-ink [&>svg]:size-full"
      style={{ width, height: width * PROPORTION }}
      dangerouslySetInnerHTML={{ __html: MARKDOWN }}
    />
  );
}
