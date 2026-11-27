// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { Prec, StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

import { drawingOf, hardBreak, paragraphBreak, shownKey } from './prose-drawing.js';
import type { Span } from './prose-drawing.js';

// The editor's part of how a text of Markdown is drawn while it is
// written: what `prose-drawing.ts` reads off the text is laid over it
// here, and the two keys that end a paragraph and break a line are
// given what they mean in a text drawn so. The text is never changed by
// the drawing: a line break shown as a space is a line break still.

/** The space a line break inside a paragraph is drawn as. */
class Space extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const made = document.createElement('span');
    made.textContent = ' ';
    return made;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

const asSpace = Decoration.replace({ widget: new Space() });
const unshown = Decoration.replace({});
const classed = new Map<string, Decoration>();
const lined = new Map<string, Decoration>();

function piece(cls: string): Decoration {
  let made = classed.get(cls);
  if (made === undefined) {
    made = Decoration.mark({ class: cls });
    classed.set(cls, made);
  }
  return made;
}

function line(cls: string): Decoration {
  let made = lined.get(cls);
  if (made === undefined) {
    made = Decoration.line({ class: cls });
    lined.set(cls, made);
  }
  return made;
}

/** A text's drawing as the editor holds it. */
interface Drawn {
  /** Whether the text has the keyboard: one that has not shows no mark. */
  focused: boolean;
  /** The pieces whose marks show while the cursor is in them, and which of them it is in now. */
  marked: Span[];
  key: string;
  /** Everything laid over the text. */
  laid: DecorationSet;
  /** What the cursor passes as one place: a line break drawn as a space, an item's indent. */
  whole: DecorationSet;
}

function draw(state: EditorState, focused: boolean): Drawn {
  const read = drawingOf(state, focused);
  const whole: Range<Decoration>[] = [
    ...read.joins.map((span) => asSpace.range(span.from, span.to)),
    ...read.dents.map((span) => unshown.range(span.from, span.to)),
  ];
  const laid: Range<Decoration>[] = [
    ...whole,
    ...read.hidden.map((span) => unshown.range(span.from, span.to)),
    ...read.pieces.map((one) => piece(one.cls).range(one.from, one.to)),
    ...read.lines.map((one) => line(one.cls).range(one.at)),
  ];
  return {
    focused,
    marked: read.marked,
    key: shownKey(state, read.marked, focused),
    laid: Decoration.set(laid, true),
    whole: Decoration.set(whole, true),
  };
}

/** Says the text took the keyboard, or lost it. */
const keyboard = StateEffect.define<boolean>();

// A drawing that hides a line break changes how tall the text is, so
// the editor takes it from a field of its state, read before it lays
// the text out. It is read again when the text changes, when the text
// takes or loses the keyboard, and when the cursor enters or leaves a
// piece that carries marks; a cursor that moves inside one paragraph
// redraws nothing.
const drawing = StateField.define<Drawn>({
  create: (state) => draw(state, false),
  update(value, transaction) {
    let focused = value.focused;
    for (const effect of transaction.effects) if (effect.is(keyboard)) focused = effect.value;
    if (transaction.docChanged || focused !== value.focused)
      return draw(transaction.state, focused);
    if (
      transaction.selection !== undefined &&
      shownKey(transaction.state, value.marked, focused) !== value.key
    ) {
      return draw(transaction.state, focused);
    }
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.laid),
    EditorView.atomicRanges.of((view) => view.state.field(field).whole),
  ],
});

/** Enter: a list goes on with its next item, a quote with its next
 * line; a paragraph ends and a new one begins; anywhere else, a new line. */
function enter(view: EditorView): boolean {
  if (insertNewlineContinueMarkup(view)) return true;
  const spec = paragraphBreak(view.state);
  if (spec === undefined) return false;
  view.dispatch(spec);
  return true;
}

/** Shift and Enter: a line break that stays one, inside a paragraph. */
function shiftEnter(view: EditorView): boolean {
  const spec = hardBreak(view.state);
  if (spec === undefined) return false;
  view.dispatch(spec);
  return true;
}

/** A text of Markdown drawn as a reader meets it, while it is written. */
export const drawn: Extension = [
  drawing,
  EditorView.focusChangeEffect.of((_state, focusing) => keyboard.of(focusing)),
  Prec.high(keymap.of([{ key: 'Enter', run: enter, shift: shiftEnter }])),
];
