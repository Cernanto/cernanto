// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { ReactNode } from 'react';

import claudeCodeMark from '../assets/marks/claude-code.svg?raw';
import codexMark from '../assets/marks/codex.svg?raw';
import { assistantName } from '../model/package.js';
import { cx } from './ui.js';
import { drawing } from './vector.js';

/**
 * The coding assistants the UI has a mark for, each under the last part
 * of its id, with how much of a mark's box its drawing takes so that
 * the two read as one size: Claude Code's is short and wide.
 */
export const ASSISTANT_MARKS: Record<string, { svg: string; fit: number }> = {
  'claude-code': { svg: drawing(claudeCodeMark), fit: 1.15 },
  codex: { svg: drawing(codexMark), fit: 1 },
};

/** A mark's box beside a word, in the word's own measure. */
const BOX = 1.15;
/** How far over the line a word's middle stands, in the word's measure. */
const MIDDLE = 0.36;

/** A coding assistant as the UI says it: its maker's mark, in the
 * colour and at the measure of the words it stands in, before the name
 * a reader knows it under. One the UI has no mark for is said by its
 * name alone. */
export function AssistantWord({
  harness,
  className,
}: {
  harness: string | undefined;
  className?: string;
}): ReactNode {
  const mark = ASSISTANT_MARKS[harness?.split('/').at(-1) ?? ''];
  const side = mark === undefined ? 0 : BOX * mark.fit;
  return (
    <span className={cx('whitespace-nowrap', className)}>
      {mark !== undefined && (
        <span
          aria-hidden="true"
          className="mr-[0.35em] inline-block [&>svg]:block [&>svg]:size-full"
          style={{
            width: `${side.toFixed(3)}em`,
            height: `${side.toFixed(3)}em`,
            verticalAlign: `${(MIDDLE - side / 2).toFixed(3)}em`,
          }}
          dangerouslySetInnerHTML={{ __html: mark.svg }}
        />
      )}
      {assistantName(harness)}
    </span>
  );
}
