// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/** The two ways the UI shows a file an agent is made of: rendered for a
 * reader, or raw, as the text the file holds. */
export const FILE_VIEWS = ['rendered', 'raw'] as const;
export type FileView = (typeof FILE_VIEWS)[number];

/** The word each view is chosen by. */
export const VIEW_WORDS: Record<FileView, string> = { rendered: 'Rendered', raw: 'Raw' };

/** The view a kept word says. A word that names neither is the rendered
 * view, which every such tab opens on. */
export function fileView(kept: unknown): FileView {
  return FILE_VIEWS.find((view) => view === kept) ?? 'rendered';
}
