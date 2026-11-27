// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Download } from 'lucide-react';
import type { ReactNode } from 'react';

import { saveFile } from '../../../state/save.js';
import { CopyButton } from '../trace/body.js';

/** The bar over a file of a package that is shown raw: its name, its
 * weight where the package tells it, and the two ways to take it away,
 * a copy and a save under its own name. */
export function FileBar({
  name,
  weight,
  text,
}: {
  name: string;
  weight?: string | undefined;
  text: string | undefined;
}): ReactNode {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-sunken pr-2 pl-4 text-xs text-ink-muted">
      <span className="mono min-w-0 flex-1 truncate text-ink-secondary">{name}</span>
      {weight !== undefined && <span className="figures">{weight}</span>}
      {text !== undefined && (
        <>
          <CopyButton text={text} label="Copy the file" />
          <button
            type="button"
            aria-label="Save the file"
            title="Save the file"
            onClick={() => {
              saveFile(name.split('/').at(-1) ?? 'file.txt', text, 'text/plain');
            }}
            className="inline-flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
          >
            <Download size={13} />
          </button>
        </>
      )}
    </div>
  );
}
