// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorState, Prec, Transaction } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { minimalSetup } from 'codemirror';
import {
  Bold,
  Check,
  ChevronDown,
  Code as CodeSign,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkSign,
  List,
  ListOrdered,
  Pilcrow,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { tintLabels } from './label-lines.js';
import { headingLevel, insertLink, setHeading, toggleList, toggleMark } from './prose-commands.js';
import { drawn } from './prose-drawn.js';
import { IconButton } from './ui.js';

// The writing surface of a Markdown box. A text is written here as a
// reader meets it: a paragraph flows over the box, a title is a title,
// a list has its bullets, bold is bold, and the marks that say so are
// shown only where the cursor is, to be changed (`prose-drawn.ts`). The
// text is the writer's own bytes all the while, every mark and every
// line of the file as they wrote them: nothing is written back in
// another style, and the whole file as it is stands in the raw view.
// The bar that puts the marks in for a writer who does not type them is
// drawn in the box's own head, which the box hands this surface. The
// text grows with what is written in it: the page scrolls, not a box
// in it.

/** What a part of the text is, as a class the frame below draws. */
const tinted = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-md-h1' },
  { tag: tags.heading2, class: 'cm-md-h2' },
  { tag: tags.heading3, class: 'cm-md-h3' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], class: 'cm-md-h4' },
  { tag: tags.strong, class: 'cm-md-strong' },
  { tag: tags.emphasis, class: 'cm-md-emphasis' },
  { tag: tags.strikethrough, class: 'cm-md-struck' },
  { tag: tags.monospace, class: 'cm-md-code' },
  { tag: tags.link, class: 'cm-md-link' },
  { tag: tags.url, class: 'cm-md-url' },
  { tag: tags.quote, class: 'cm-md-quote' },
  { tag: tags.list, class: 'cm-md-list' },
  { tag: [tags.processingInstruction, tags.meta], class: 'cm-md-mark' },
]);

// The face, the size and the height of the text are the stylesheet's,
// under `.prose-editor`, beside its rules for every editor.
const frame = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'transparent' },
  '.cm-scroller': { overflow: 'visible' },
  '.cm-content': { padding: '12px 14px', caretColor: 'var(--ink)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent) !important',
  },
  '.cm-label-line': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  // The sizes and the weights are the ones a text has where it is drawn to be read.
  '.cm-md-h1': { fontSize: '22px', fontWeight: '600', lineHeight: '1.25' },
  '.cm-md-h2': { fontSize: '17px', fontWeight: '600' },
  '.cm-md-h3': { fontSize: '15px', fontWeight: '600' },
  '.cm-md-h4': { fontWeight: '600' },
  '.cm-md-strong': { fontWeight: '600' },
  '.cm-md-emphasis': { fontStyle: 'italic' },
  '.cm-md-struck': { textDecoration: 'line-through' },
  '.cm-md-code': { fontFamily: 'var(--font-mono)', fontSize: '12.5px' },
  // A piece of code stands a little off the words around it.
  '.cm-md-chip': { padding: '0 4px' },
  '.cm-md-link': {
    color: 'var(--accent-text)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.cm-md-url': { color: 'var(--ink-muted)' },
  '.cm-md-quote': { color: 'var(--ink-secondary)' },
  // A mark the writer does not read as a word stands pale beside what it
  // marks, while it is shown at all; a list's number is drawn clear.
  '.cm-md-mark': { color: 'var(--ink-muted)', fontWeight: '400' },
  '.cm-md-list.cm-md-mark': { color: 'var(--ink-secondary)', fontWeight: '600' },
  // A second-level heading closes over a hair line, as where it is read.
  '.cm-md-l-h2': { borderBottom: '1px solid var(--border)', paddingBottom: '5px' },
  // An item of a list hangs under its mark, set in by how deep it is: a
  // line the item goes on with starts under its first word.
  '.cm-md-item': { paddingLeft: '24px', textIndent: '-16px' },
  '.cm-md-item-2': { paddingLeft: '48px' },
  '.cm-md-item-3': { paddingLeft: '72px' },
  '.cm-md-item-4': { paddingLeft: '96px' },
  // A dash that opens an item is drawn as the bullet it reads as, in the
  // room the dash takes, so the cursor passes it as it passes the dash.
  '.cm-md-bullet': {
    display: 'inline-block',
    position: 'relative',
    width: '12px',
    textIndent: '0',
  },
  // The dash itself is not shown, whatever tint it carries as a mark.
  '.cm-md-bullet, .cm-md-bullet *': { color: 'transparent !important' },
  '.cm-md-bullet::after': {
    content: '"\\2022"',
    position: 'absolute',
    left: '1px',
    top: '0',
    color: 'var(--ink-secondary)',
    fontWeight: '600',
  },
  '.cm-md-number': { display: 'inline-block', minWidth: '12px', textIndent: '0' },
  // A block of code keeps its lines and its face.
  '.cm-md-pre': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    backgroundColor: 'color-mix(in srgb, var(--ink) 5%, transparent)',
  },
});

/** Marks a change the screen laid in, which is not the writer's to hear back. */
const laidIn = Annotation.define<boolean>();

const HEADINGS: { level: number; word: string; sign: ReactNode }[] = [
  { level: 1, word: 'Heading 1', sign: <Heading1 size={15} /> },
  { level: 2, word: 'Heading 2', sign: <Heading2 size={15} /> },
  { level: 3, word: 'Heading 3', sign: <Heading3 size={15} /> },
  { level: 0, word: 'Normal text', sign: <Pilcrow size={15} /> },
];

/**
 * A text of Markdown to write, with the bar that marks it.
 *
 * @param rows - The lines the text is tall while it holds fewer.
 * @param bar - Where the bar of marks is drawn: the head of the box the text stands in.
 */
export default function ProseEditor({
  text,
  onChange,
  label,
  rows = 4,
  bar,
}: {
  text: string;
  onChange: (text: string) => void;
  /** The text's name, for a reader who does not see the head over it.
   * An empty text shows no words of its own: what stands in a box reads
   * as what the box holds. */
  label: string;
  rows?: number;
  bar: HTMLElement | null;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const changed = useRef(onChange);
  changed.current = onChange;
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (host.current === null) return undefined;
    const press = (act: (state: EditorState) => TransactionSpec) => (made: EditorView) => {
      made.dispatch(act(made.state));
      return true;
    };
    const made = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          Prec.high(
            keymap.of([
              { key: 'Mod-b', run: press((state) => toggleMark(state, '**')) },
              { key: 'Mod-i', run: press((state) => toggleMark(state, '_')) },
              { key: 'Mod-e', run: press((state) => toggleMark(state, '`')) },
            ]),
          ),
          drawn,
          minimalSetup,
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(tinted),
          frame,
          EditorView.theme({ '.cm-content': { minHeight: `${String(rows * 1.65)}em` } }),
          EditorView.lineWrapping,
          tintLabels,
          // A source is prose, so the browser checks its spelling. It
          // changes no word by itself: the text is what the writer typed.
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'true' }),
          EditorView.updateListener.of((update) => {
            if (
              update.transactions.some(
                (transaction) => transaction.docChanged && transaction.annotation(laidIn) !== true,
              )
            ) {
              changed.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = made;
    return () => {
      made.destroy();
      view.current = undefined;
    };
    // The editor is made once; its text follows below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The text the source holds takes the editor's place where the two
  // differ: a field changed a label written inside it, or the source
  // keeps a line elsewhere than it was typed. Only what differs is laid
  // in, so the cursor stays where the writer has it.
  useEffect(() => {
    const made = view.current;
    if (made === undefined) return;
    const held = made.state.doc.toString();
    if (held === text) return;
    const most = Math.min(held.length, text.length);
    let same = 0;
    while (same < most && held.charCodeAt(same) === text.charCodeAt(same)) same += 1;
    let end = 0;
    while (
      end < most - same &&
      held.charCodeAt(held.length - 1 - end) === text.charCodeAt(text.length - 1 - end)
    ) {
      end += 1;
    }
    // It is no step of the writer's: an undo goes past it to what they typed.
    made.dispatch({
      changes: { from: same, to: held.length - end, insert: text.slice(same, text.length - end) },
      annotations: [laidIn.of(true), Transaction.addToHistory.of(false)],
    });
  }, [text]);

  const act = (press: (state: EditorState) => TransactionSpec): void => {
    const made = view.current;
    if (made === undefined) return;
    made.dispatch(press(made.state));
    made.focus();
  };
  // A press of the bar leaves the keyboard and what is chosen in the text.
  const kept = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
  };

  const marks = (
    <div
      role="toolbar"
      aria-label={`Marks of ${label}`}
      className="flex flex-wrap items-center gap-0.5"
    >
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open && view.current !== undefined) setLevel(headingLevel(view.current.state));
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Heading"
            title="Heading"
            className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md pr-1 pl-2 text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink data-[state=open]:bg-chosen data-[state=open]:text-ink"
          >
            <Heading size={15} />
            <ChevronDown size={12} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className="sheet z-[60] min-w-44 p-1 text-[13px] text-ink"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              view.current?.focus();
            }}
          >
            {HEADINGS.map((entry) => (
              <DropdownMenu.Item
                key={entry.level}
                onSelect={() => {
                  act((state) => setHeading(state, entry.level));
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[highlighted]:bg-hover"
              >
                <span className="flex size-4 items-center text-ink-muted">{entry.sign}</span>
                <span className="min-w-0 flex-1">{entry.word}</span>
                {level === entry.level && (
                  <Check size={14} className="shrink-0 text-ink-secondary" aria-label="Chosen" />
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <IconButton
        label="Bold"
        onMouseDown={kept}
        onClick={() => {
          act((state) => toggleMark(state, '**'));
        }}
      >
        <Bold size={15} />
      </IconButton>
      <IconButton
        label="Italic"
        onMouseDown={kept}
        onClick={() => {
          act((state) => toggleMark(state, '_'));
        }}
      >
        <Italic size={15} />
      </IconButton>
      <IconButton
        label="Code"
        onMouseDown={kept}
        onClick={() => {
          act((state) => toggleMark(state, '`'));
        }}
      >
        <CodeSign size={15} />
      </IconButton>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
      <IconButton
        label="List"
        onMouseDown={kept}
        onClick={() => {
          act((state) => toggleList(state, false));
        }}
      >
        <List size={15} />
      </IconButton>
      <IconButton
        label="Numbered list"
        onMouseDown={kept}
        onClick={() => {
          act((state) => toggleList(state, true));
        }}
      >
        <ListOrdered size={15} />
      </IconButton>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
      <IconButton
        label="Link"
        onMouseDown={kept}
        onClick={() => {
          act(insertLink);
        }}
      >
        <LinkSign size={15} />
      </IconButton>
    </div>
  );

  return (
    <>
      {bar !== null && createPortal(marks, bar)}
      <div ref={host} className="prose-editor min-w-0" />
    </>
  );
}
