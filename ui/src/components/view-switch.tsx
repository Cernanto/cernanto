// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { ReactNode } from 'react';

import { FILE_VIEWS, fileView, VIEW_WORDS } from '../model/view.js';
import type { FileView } from '../model/view.js';
import { usePref } from '../state/prefs.js';
import { cx } from './ui.js';

/** The view a tab shows its file in, kept by the browser under the
 * tab's own key, so that each tab is found as it was left. */
export function useFileView(key: string): [FileView, (view: FileView) => void] {
  const [kept, keep] = usePref<FileView>(key, 'rendered');
  return [fileView(kept), keep];
}

/** The switch in a tab's head between its file rendered and raw: the
 * same two words wherever a file is shown both ways, so the control is
 * learned once. */
export function ViewSwitch({
  view,
  onChoose,
  label,
}: {
  view: FileView;
  onChoose: (view: FileView) => void;
  label: string;
}): ReactNode {
  return (
    <div
      className="flex h-7 shrink-0 items-stretch rounded-md border border-line-strong"
      role="tablist"
      aria-label={label}
    >
      {FILE_VIEWS.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={view === name}
          onClick={() => {
            onChoose(name);
          }}
          className={cx(
            'px-2.5 text-xs first:rounded-l-[3px] last:rounded-r-[3px]',
            view === name ? 'bg-ink text-ground' : 'text-ink-secondary hover:bg-hover',
          )}
        >
          {VIEW_WORDS[name]}
        </button>
      ))}
    </div>
  );
}
