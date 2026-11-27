// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Blocks, Layers, ListChecks, Plug, Rocket, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx } from './ui.js';

// The six kinds of agent, each with a sign of its own. A reader learns
// the six once, where a type is chosen, and then meets them wherever a
// type is told, beside its word.

/**
 * The sign of each kind of agent: a bolt for a task, which runs when it
 * is called and scales to nothing; layers for a service, which keeps
 * its state under its calls; a rocket for a worker, which the plane
 * starts and which then runs on its own time; a list of steps checked
 * off for a job, one live run; blocks for a module, a part of the
 * agents that use it; a plug for an interface, which others plug into.
 */
export const TYPE_SIGNS: Record<string, LucideIcon> = {
  task: Zap,
  service: Layers,
  worker: Rocket,
  job: ListChecks,
  module: Blocks,
  interface: Plug,
};

/** A kind's sign alone. A kind the UI has no sign for shows none. */
export function TypeSign({
  type,
  size = 12,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}): ReactNode {
  const Sign = TYPE_SIGNS[type];
  if (Sign === undefined) return null;
  return (
    <Sign size={size} strokeWidth={1.75} className={cx('shrink-0', className)} aria-hidden="true" />
  );
}

/** A kind as it is told wherever a type is told: its sign, then its word. */
export function TypeWord({
  type,
  size = 12,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}): ReactNode {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap', className)}>
      <TypeSign type={type} size={size} />
      {type}
    </span>
  );
}
