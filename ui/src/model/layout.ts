// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// How the screen lays itself out by the window's width.

/** The window from which the agent list and an agent stand side by
 * side; on a narrower one they are the screen one at a time, the list
 * first. It is the stylesheet's own middle width. */
export const BESIDE = '(min-width: 768px)';

/** The window's width from which an agent's side panel stands open
 * before the reader chose: on a narrower window an open panel leaves
 * the conversation too little to be read by its two sides. */
export const SIDE_PANEL_FROM = 1440;

/**
 * Whether an agent's side panel stands open: as the reader last chose,
 * and before they chose, open on a wide window and closed on a narrow
 * one. What the panel holds, how the agent stands, is worth the room
 * where there is room.
 *
 * @param chosen - What the reader chose with the panel's button; null before they pressed it.
 * @param wide - Whether the window is at least `SIDE_PANEL_FROM` wide.
 */
export function sidePanelOpen(chosen: boolean | null, wide: boolean): boolean {
  return chosen ?? wide;
}
