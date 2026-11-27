// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { EditorSelection } from '@codemirror/state';
import type {
  ChangeSpec,
  EditorState,
  Line,
  SelectionRange,
  TransactionSpec,
} from '@codemirror/state';

import { treeOf } from './prose-drawing.js';

// What the bar over a text does: each press writes the Markdown marks a
// writer would type, on the text as it stands, and a second press takes
// them off again. The text stays the writer's own bytes: nothing is
// rewritten but the marks themselves.
//
// A PARAGRAPH IS ONE PIECE TO A PRESS, however many lines of the file it
// is written on: the writer sees it as one flow of words, so a press
// that makes "the line" a heading or an item of a list makes the
// paragraph one, at its first line. A heading is one line of the file,
// so a paragraph made a heading is written on one.

/** The lines the selection touches, each once, in the text's order. */
function chosenLines(state: EditorState): Line[] {
  const lines = new Map<number, Line>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let at = state.doc.lineAt(range.from).number; at <= last; at += 1) {
      lines.set(at, state.doc.line(at));
    }
  }
  return [...lines.values()].sort((a, b) => a.number - b.number);
}

/** The lines a press writes on: the chosen ones that hold words, or the
 * one line the cursor stands on where it is empty. */
function writtenLines(state: EditorState): Line[] {
  const lines = chosenLines(state);
  const worded = lines.filter((line) => line.text.trim() !== '');
  return worded.length > 0 ? worded : lines.slice(0, 1);
}

/** A piece of the text a press writes on: its first line, and the
 * paragraph it is where it is one written on several lines. */
interface Block {
  line: Line;
  paragraph?: { from: number; to: number; top: boolean };
}

/**
 * The pieces a press writes on, each once, in the text's order: a line
 * that stands in a paragraph is that paragraph, taken at its first
 * line, so the lines a paragraph goes on with are never marked by
 * themselves; any other line is itself.
 */
function writtenBlocks(state: EditorState): Block[] {
  const tree = treeOf(state);
  const seen = new Set<number>();
  const out: Block[] = [];
  for (const line of writtenLines(state)) {
    const opened = line.from + (line.text.length - line.text.trimStart().length);
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(opened, 1);
    while (node !== null && node.name !== 'Paragraph') node = node.parent;
    const first = node === null ? line : state.doc.lineAt(node.from);
    if (seen.has(first.number)) continue;
    seen.add(first.number);
    out.push(
      node === null
        ? { line: first }
        : {
            line: first,
            paragraph: { from: node.from, to: node.to, top: node.parent?.name === 'Document' },
          },
    );
  }
  return out;
}

/** A change of lines, with the cursor kept after what was written at its place. */
function written(state: EditorState, changes: ChangeSpec[]): TransactionSpec {
  const set = state.changes(changes);
  return {
    changes: set,
    selection: state.selection.map(set, 1),
    scrollIntoView: true,
    userEvent: 'input',
  };
}

/** What opens a line and is no word of it: a quote's mark, a list's
 * with a task's box, a heading's. */
const LINE_MARKS =
  /^\s*(?:>[ \t]?)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(?:#{1,6}[ \t]+)?/;

/** The words of what is chosen: a line chosen whole, as three presses
 * choose it, is marked from its first word, after the mark that opens
 * it, and the blanks at the two ends of what is chosen stay outside. */
function words(state: EditorState, range: { from: number; to: number }): SelectionRange {
  let { from, to } = range;
  if (from === to) return EditorSelection.cursor(from);
  const line = state.doc.lineAt(from);
  const opened = line.from + (LINE_MARKS.exec(line.text)?.[0].length ?? 0);
  if (from < opened) from = Math.min(opened, to);
  const chosen = state.sliceDoc(from, to);
  from += chosen.length - chosen.trimStart().length;
  to -= chosen.length - chosen.trimEnd().length;
  return to < from ? EditorSelection.cursor(from) : EditorSelection.range(from, to);
}

/**
 * Wraps what is chosen in a mark, `**` for bold, `_` for italic, a
 * backtick for code, or takes the mark off where it already stands
 * around it. With nothing chosen the pair is written and the cursor
 * stands between the two.
 */
export function toggleMark(state: EditorState, mark: string): TransactionSpec {
  const size = mark.length;
  const spec = state.changeByRange((whole) => {
    const range = words(state, whole);
    const chosen = state.sliceDoc(range.from, range.to);
    const before = state.sliceDoc(Math.max(0, range.from - size), range.from);
    const after = state.sliceDoc(range.to, range.to + size);
    if (before === mark && after === mark) {
      return {
        changes: [
          { from: range.from - size, to: range.from },
          { from: range.to, to: range.to + size },
        ],
        range: EditorSelection.range(range.from - size, range.to - size),
      };
    }
    if (chosen.length >= 2 * size && chosen.startsWith(mark) && chosen.endsWith(mark)) {
      return {
        changes: { from: range.from, to: range.to, insert: chosen.slice(size, -size) },
        range: EditorSelection.range(range.from, range.to - 2 * size),
      };
    }
    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark },
      ],
      range: EditorSelection.range(range.from + size, range.to + size),
    };
  });
  return { ...spec, scrollIntoView: true, userEvent: 'input' };
}

const HEADING = /^(\s{0,3})(#{1,6})(?:[ \t]+|$)/;

/** The heading level of the line the cursor stands on; none is 0. */
export function headingLevel(state: EditorState): number {
  const line = state.doc.lineAt(state.selection.main.head);
  return HEADING.exec(line.text)?.[2]?.length ?? 0;
}

/**
 * Makes the chosen pieces headings of a level, or plain text at level
 * 0. A paragraph written on several lines of the file is put on one
 * first, its line breaks made the spaces they read as: a heading is one
 * line.
 */
export function setHeading(state: EditorState, level: number): TransactionSpec {
  const mark = level === 0 ? '' : `${'#'.repeat(level)} `;
  const changes: ChangeSpec[] = [];
  for (const { line, paragraph } of writtenBlocks(state)) {
    if (level > 0 && paragraph?.top === true && paragraph.to > line.to) {
      const text = state.sliceDoc(paragraph.from, paragraph.to);
      for (const found of text.matchAll(/[ \t]*\\?\n[ \t]*/g)) {
        const from = paragraph.from + found.index;
        changes.push({ from, to: from + found[0].length, insert: ' ' });
      }
    }
    const held = HEADING.exec(line.text);
    const indent = held?.[1]?.length ?? 0;
    const from = line.from + indent;
    const to = line.from + (held?.[0].length ?? 0);
    if (state.sliceDoc(from, to) !== mark) changes.push({ from, to, insert: mark });
  }
  return written(state, changes);
}

const ITEM = /^(\s*)(?:([-*+])[ \t]+|(\d+)[.)][ \t]+)?/;

/**
 * Makes the chosen pieces a list, with a dash each or numbered from
 * one, or takes the marks off where every chosen piece already is an
 * item of that kind. A paragraph is one item, marked at its first line;
 * the lines it goes on with stay as they are, and a line's own indent
 * is kept.
 */
export function toggleList(state: EditorState, numbered: boolean): TransactionSpec {
  const lines = writtenBlocks(state).map((block) => block.line);
  const read = lines.map((line) => ITEM.exec(line.text));
  const already = read.every((held) =>
    numbered ? held?.[3] !== undefined : held?.[2] !== undefined,
  );
  const changes: ChangeSpec[] = [];
  lines.forEach((line, index) => {
    const held = read[index];
    const from = line.from + (held?.[1]?.length ?? 0);
    const to = line.from + (held?.[0].length ?? 0);
    const mark = already ? '' : numbered ? `${index + 1}. ` : '- ';
    if (state.sliceDoc(from, to) !== mark) changes.push({ from, to, insert: mark });
  });
  return written(state, changes);
}

/**
 * Writes a link around what is chosen, with the place of its address
 * chosen for the writer to type over; with nothing chosen, a link whose
 * words are chosen first.
 */
export function insertLink(state: EditorState): TransactionSpec {
  const range = state.selection.main;
  const chosen = state.sliceDoc(range.from, range.to);
  const words = chosen === '' ? 'text' : chosen;
  const insert = `[${words}](url)`;
  const selection =
    chosen === ''
      ? EditorSelection.range(range.from + 1, range.from + 1 + words.length)
      : EditorSelection.range(range.from + words.length + 3, range.from + words.length + 6);
  return {
    changes: { from: range.from, to: range.to, insert },
    selection,
    scrollIntoView: true,
    userEvent: 'input',
  };
}
