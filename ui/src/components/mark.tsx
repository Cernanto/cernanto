// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { ReactNode } from 'react';

/** The logo's mark, drawn in the look's own ink and accent. */
export function Mark({ size = 22 }: { size?: number }): ReactNode {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Cernanto">
      <polygon
        fill="var(--ink)"
        points="20,4 52,4 60,12 60,24 28,24 28,44 60,44 60,52 52,60 12,60 4,52 4,20"
      />
      <polygon fill="var(--accent)" points="32,28 56,28 56,40 32,40" />
    </svg>
  );
}
