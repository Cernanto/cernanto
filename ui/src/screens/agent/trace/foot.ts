// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What stands at the foot of a conversation is drawn one way: the box
// that calls a function, and what stands in its place for an agent
// nobody calls. A frame, the muted words at its start, and at its end
// the one button that acts on the plane, in the accent, with its word.

/** The frame at a conversation's foot. */
export const FOOT_FRAME = 'w-full rounded-lg border border-line-strong bg-surface p-2';

/** The words at the frame's start, before anything is typed. */
export const FOOT_WORDS = 'min-w-0 flex-1 px-1.5 text-left text-[14px] text-ink-muted';

/** The button that acts on the plane: the accent's, with its word. */
export const FOOT_BUTTON =
  'flex h-8 items-center gap-1.5 bg-accent px-3 text-[13px] font-semibold text-on-accent hover:brightness-105 disabled:opacity-50 disabled:hover:brightness-100';

/** What the foot says after a press, under its line. */
export const FOOT_SAID = 'px-1.5 pt-1.5 text-xs';
