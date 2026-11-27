// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';

import { labelLines } from '../model/source.js';

const labelLine = Decoration.line({ class: 'cm-label-line' });

/** Tints a source's label lines, found again at every change of the
 * text: in the whole file, and in a section's text where a label was
 * written between two paragraphs of it. The tint is the editor's own
 * rule for the class `cm-label-line`. */
export const tintLabels = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.read(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = this.read(update.view);
    }

    read(view: EditorView): DecorationSet {
      const ranges = new RangeSetBuilder<Decoration>();
      const doc = view.state.doc;
      for (const line of labelLines(doc.toString())) {
        if (line <= doc.lines) ranges.add(doc.line(line).from, doc.line(line).from, labelLine);
      }
      return ranges.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
