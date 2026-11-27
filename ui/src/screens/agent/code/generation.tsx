// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { ReactNode } from 'react';

import { Button, Quiet } from '../../../components/ui.js';
import type { GenerationRow } from '../../../gateway/types.gen.js';

/** What a tab shows where the generation its address names is gone:
 * that it is, and the way to what the agent runs now. */
export function GenerationGone({
  gen,
  onCurrent,
}: {
  gen: number;
  /** Takes the generation out of the address. */
  onCurrent: () => void;
}): ReactNode {
  return (
    <Quiet>
      Generation {gen} of this agent is no longer on the plane.
      <span className="mt-1 block text-xs">
        A generation leaves when its agent is deployed again, and what it ran leaves with it.
      </span>
      <Button small className="mt-4" onClick={onCurrent}>
        Show what the agent runs now
      </Button>
    </Quiet>
  );
}

/** The generation whose package a tab reads: the active one, unless the
 * reader chose another of the agent's history. */
export function GenerationChoice({
  generations,
  chosen,
  label,
  onChoose,
}: {
  generations: GenerationRow[];
  chosen: number | undefined;
  /** What the choice is of, for a screen reader. */
  label: string;
  /** Called with the generation chosen, or nothing for the active one. */
  onChoose: (gen: number | undefined) => void;
}): ReactNode {
  if (generations.length === 0) return null;
  return (
    <select
      aria-label={label}
      value={chosen ?? ''}
      onChange={(event) => {
        const gen = Number(event.target.value);
        const active = generations.find((entry) => entry.status === 'active')?.gen;
        onChoose(gen === active ? undefined : gen);
      }}
      className="h-7 rounded-md border border-line-strong bg-transparent px-2 text-xs text-ink-secondary"
    >
      {generations.map((entry) => (
        <option key={entry.gen} value={entry.gen}>
          generation {entry.gen}, {entry.status}
        </option>
      ))}
    </select>
  );
}
