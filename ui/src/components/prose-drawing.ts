// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, TransactionSpec } from '@codemirror/state';

import { labelLines } from '../model/source.js';

// HOW A TEXT OF MARKDOWN IS DRAWN WHILE IT IS WRITTEN. The text a writer
// sees reads as a reader meets it: a paragraph flows over its box, a
// title is a title, a list has its bullets, and the marks that say so
// are not shown. The text itself is the writer's own bytes all the
// while: nothing here changes a character. What is read off the text
// is what is drawn another way than it is written:
//
//   - A LINE BREAK INSIDE A PARAGRAPH IS A SPACE, as Markdown reads it.
//     A source is written in lines of some seventy characters, and a
//     paragraph of it is one flow of words.
//   - A MARK IS SHOWN WHILE THE CURSOR IS IN THE PIECE IT MARKS, and not
//     otherwise: a writer changes a mark by going to it.
//   - A list's item hangs under its bullet, set in by how deep it is.
//
// This file reads the text and says what is drawn so; the editor draws
// it. It is kept apart so that it needs no screen.

type Tree = ReturnType<typeof syntaxTree>;
type Node = Tree['topNode'];

/** A stretch of the text, from a place to a place. */
export interface Span {
  from: number;
  to: number;
}

/** What of a text is drawn another way than it is written. */
export interface Drawing {
  /** A line break inside a paragraph, with the blanks around it and the
   * next line's indent: drawn as one space. */
  joins: Span[];
  /** The indent an item of a list opens its line with: not drawn, the
   * line being set in by the item's depth. */
  dents: Span[];
  /** The marks not shown: the cursor is elsewhere. */
  hidden: Span[];
  /** Pieces drawn in a way of their own, each by its class. */
  pieces: (Span & { cls: string })[];
  /** Lines drawn in a way of their own, each by the place it starts at. */
  lines: { at: number; cls: string }[];
  /** The pieces whose marks show while the cursor is in them. */
  marked: Span[];
}

/** The text's tree, read whole: a source is short enough to be. */
export function treeOf(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 250) ?? syntaxTree(state);
}

const blank = (char: string): boolean => char === ' ' || char === '\t';

function kids(node: Node): Node[] {
  const out: Node[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) out.push(child);
  return out;
}

function within(node: Node, name: string): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at.name === name) return true;
  return false;
}

/** How deep an item of a list stands: 1 for an item of a list that is in no other. */
function depthOf(item: Node): number {
  let depth = 1;
  for (let at = item.parent; at !== null; at = at.parent) if (at.name === 'ListItem') depth += 1;
  return depth;
}

/**
 * The line breaks a paragraph is written with that Markdown reads as a
 * space, each with the blanks before it and what opens the line after
 * it: its indent, and inside a quote the quote's marks. A break the
 * writer made a hard one stays a break, and so does one beside a
 * label's line, which is no line of the paragraph to a source.
 */
export function softBreaks(state: EditorState, paragraph: Node, labels: Set<number>): Span[] {
  const out: Span[] = [];
  const text = state.sliceDoc(paragraph.from, paragraph.to);
  const hard = kids(paragraph)
    .filter((child) => child.name === 'HardBreak')
    .map((child) => ({ from: child.from, to: child.to }));
  const opens = within(paragraph, 'Blockquote') ? /^[ \t]*(?:>[ \t]?)*[ \t]*/ : /^[ \t]*/;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) {
    const place = paragraph.from + at;
    if (hard.some((one) => place >= one.from && place < one.to)) continue;
    const line = state.doc.lineAt(place).number;
    if (labels.has(line) || labels.has(line + 1)) continue;
    let from = at;
    while (from > 0 && blank(text.charAt(from - 1))) from -= 1;
    const to = at + 1 + (opens.exec(text.slice(at + 1))?.[0].length ?? 0);
    out.push({ from: paragraph.from + from, to: paragraph.from + to });
  }
  return out;
}

/**
 * What of a text is drawn another way than it is written.
 *
 * @param focused - Whether the text has the keyboard: a text that has not shows no mark at all.
 */
export function drawingOf(state: EditorState, focused: boolean): Drawing {
  const { doc } = state;
  const drawn: Drawing = { joins: [], dents: [], hidden: [], pieces: [], lines: [], marked: [] };
  const labels = new Set(labelLines(doc.toString()));
  const chosen = state.selection.main;
  /** Whether the cursor is in a piece, so that its marks show; the piece is kept for the asking. */
  const shown = (piece: Span): boolean => {
    drawn.marked.push({ from: piece.from, to: piece.to });
    return focused && chosen.from <= piece.to && chosen.to >= piece.from;
  };
  const hide = (from: number, to: number): void => {
    if (to > from) drawn.hidden.push({ from, to });
  };

  treeOf(state).iterate({
    enter(ref) {
      const name = ref.name;
      if (name === 'Paragraph' || name === 'Task') {
        drawn.joins.push(...softBreaks(state, ref.node, labels));
        return;
      }
      if (name.startsWith('ATXHeading')) {
        const node = ref.node;
        if (name === 'ATXHeading2')
          drawn.lines.push({ at: doc.lineAt(node.from).from, cls: 'cm-md-l-h2' });
        if (shown(node)) return;
        for (const mark of node.getChildren('HeaderMark')) {
          // The mark that opens a heading goes with the blank after it,
          // one that closes it with the blank before it.
          let { from, to } = mark;
          if (from === node.from)
            while (to < node.to && blank(doc.sliceString(to, to + 1))) to += 1;
          else while (from > node.from && blank(doc.sliceString(from - 1, from))) from -= 1;
          hide(from, to);
        }
        return;
      }
      if (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'Strikethrough') {
        const node = ref.node;
        if (shown(node)) return;
        for (const mark of kids(node)) {
          if (mark.name === 'EmphasisMark' || mark.name === 'StrikethroughMark') {
            hide(mark.from, mark.to);
          }
        }
        return;
      }
      if (name === 'InlineCode') {
        const node = ref.node;
        drawn.pieces.push({ from: node.from, to: node.to, cls: 'cm-md-chip' });
        if (shown(node)) return;
        for (const mark of node.getChildren('CodeMark')) hide(mark.from, mark.to);
        return;
      }
      if (name === 'Link') {
        const node = ref.node;
        const marks = node.getChildren('LinkMark');
        const [open, close] = marks;
        // A link written with its address: its words are shown, and the
        // address with its brackets while the cursor is in it.
        if (node.getChild('URL') === null || open === undefined || close === undefined) return;
        if (marks.length < 4 || shown(node)) return;
        hide(open.from, open.to);
        hide(close.from, node.to);
        return;
      }
      if (name === 'Escape' || name === 'HardBreak') {
        // The backslash that keeps a character plain, or breaks a line, is a mark too.
        if (doc.sliceString(ref.from, ref.from + 1) !== '\\') return;
        if (!shown({ from: ref.from, to: ref.to })) hide(ref.from, ref.from + 1);
        return;
      }
      if (name === 'ListItem') {
        const node = ref.node;
        const line = doc.lineAt(node.from);
        const depth = Math.min(depthOf(node), 4);
        drawn.lines.push({
          at: line.from,
          cls: depth === 1 ? 'cm-md-item' : `cm-md-item cm-md-item-${String(depth)}`,
        });
        if (node.from > line.from) drawn.dents.push({ from: line.from, to: node.from });
        const mark = node.getChild('ListMark');
        if (mark !== null) {
          drawn.pieces.push({
            from: mark.from,
            to: mark.to,
            cls: node.parent?.name === 'OrderedList' ? 'cm-md-number' : 'cm-md-bullet',
          });
        }
        return;
      }
      if (name === 'FencedCode' || name === 'CodeBlock') {
        const last = doc.lineAt(ref.to).number;
        for (let at = doc.lineAt(ref.from).number; at <= last; at += 1) {
          drawn.lines.push({ at: doc.line(at).from, cls: 'cm-md-pre' });
        }
      }
    },
  });
  return drawn;
}

/** Which of the pieces that carry marks the cursor is in, as one word:
 * while it stays the same, a move of the cursor redraws nothing. */
export function shownKey(state: EditorState, marked: Span[], focused: boolean): string {
  if (!focused) return '';
  const chosen = state.selection.main;
  const out: number[] = [];
  marked.forEach((piece, index) => {
    if (chosen.from <= piece.to && chosen.to >= piece.from) out.push(index);
  });
  return out.join(',');
}

/** The paragraph or the heading a place of the text stands in, where
 * it stands in one; none on an empty line, in a block of code, in a table. */
function blockAt(state: EditorState, place: number): Node | undefined {
  for (
    let node: Node | null = treeOf(state).resolveInner(place, -1);
    node !== null;
    node = node.parent
  ) {
    if (node.name === 'Paragraph' || node.name.startsWith('ATXHeading')) return node;
    if (/^(FencedCode|CodeBlock|Table|HTMLBlock|CommentBlock)$/.test(node.name)) return undefined;
  }
  return undefined;
}

/**
 * Enter inside a paragraph or a heading: the paragraph ends there and a
 * new one begins, an empty line of the file between the two, since one
 * line break alone is a space to Markdown and would be drawn as one.
 * The blanks and the break the cursor stood beside go with it. None
 * where the cursor stands in no paragraph, or at one's very start: the
 * plain new line is right there.
 */
export function paragraphBreak(state: EditorState): TransactionSpec | undefined {
  const chosen = state.selection.main;
  const block = blockAt(state, chosen.from);
  if (block === undefined || chosen.to > block.to) return undefined;
  const { doc } = state;
  let { from, to } = chosen;
  let breaks = 0;
  for (; from > block.from; from -= 1) {
    const char = doc.sliceString(from - 1, from);
    if (char === '\n' && breaks === 0) breaks = 1;
    else if (!blank(char)) break;
  }
  for (; to < block.to; to += 1) {
    const char = doc.sliceString(to, to + 1);
    if (char === '\n' && breaks === 0) breaks = 1;
    else if (!blank(char)) break;
  }
  if (from <= block.from) return undefined;
  // At the block's end, what follows it stands an empty line away from the new paragraph too.
  const next = doc.sliceString(to, to + 2);
  const apart = to >= block.to && next.length === 2 && next.startsWith('\n') && next !== '\n\n';
  return {
    changes: { from, to, insert: apart ? '\n\n\n' : '\n\n' },
    selection: { anchor: from + 2 },
    scrollIntoView: true,
    userEvent: 'input',
  };
}

/**
 * Shift and Enter inside a paragraph: a line break that stays one, as
 * Markdown writes it, a backslash before the break. None outside a
 * paragraph.
 */
export function hardBreak(state: EditorState): TransactionSpec | undefined {
  const chosen = state.selection.main;
  const block = blockAt(state, chosen.from);
  if (block?.name !== 'Paragraph' || chosen.to > block.to) return undefined;
  return {
    changes: { from: chosen.from, to: chosen.to, insert: '\\\n' },
    selection: { anchor: chosen.from + 2 },
    scrollIntoView: true,
    userEvent: 'input',
  };
}
