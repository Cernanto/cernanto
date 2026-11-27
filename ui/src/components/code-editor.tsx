// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder as placeholderOf } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useLook } from '../state/theme.js';
import type { Look } from '../state/theme.js';
import { tintLabels } from './label-lines.js';

// One colourer for every code on the screen: the code the compile
// wrote, the tests, a contract's declarations, a source's text, JSON
// and YAML. It lays out and colours only the lines in sight, so a file
// of any length is coloured whole. The colours are the ones a
// developer's eye knows, VS Code's Dark+ and Light+, on the site's
// sunken ground.

/** The languages the colourer reads. */
export type CodeLanguage = 'typescript' | 'markdown' | 'json' | 'yaml' | 'text';

const PALETTE: Record<Look, Record<string, string>> = {
  dark: {
    keyword: '#569cd6',
    control: '#c586c0',
    string: '#ce9178',
    comment: '#6a9955',
    number: '#b5cea8',
    type: '#4ec9b0',
    function: '#dcdcaa',
    variable: '#9cdcfe',
    regexp: '#d16969',
    heading: '#569cd6',
    link: '#3794ff',
    meta: '#808080',
  },
  light: {
    keyword: '#0000ff',
    control: '#af00db',
    string: '#a31515',
    comment: '#008000',
    number: '#098658',
    type: '#267f99',
    function: '#795e26',
    variable: '#001080',
    regexp: '#811f3f',
    heading: '#0451a5',
    link: '#0451a5',
    meta: '#6e7681',
  },
};

function colours(look: Look): Extension {
  const of = PALETTE[look];
  return syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [tags.keyword, tags.modifier, tags.definitionKeyword, tags.operatorKeyword],
        color: of['keyword'],
      },
      { tag: [tags.controlKeyword, tags.moduleKeyword], color: of['control'] },
      { tag: [tags.string, tags.special(tags.string)], color: of['string'] },
      {
        tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
        color: of['comment'],
      },
      { tag: [tags.number, tags.bool, tags.null, tags.atom], color: of['number'] },
      { tag: [tags.typeName, tags.className, tags.namespace], color: of['type'] },
      {
        tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
        color: of['function'],
      },
      { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: of['variable'] },
      { tag: [tags.regexp, tags.escape], color: of['regexp'] },
      { tag: [tags.heading], color: of['heading'], fontWeight: '600' },
      { tag: [tags.link, tags.url], color: of['link'] },
      { tag: [tags.emphasis], fontStyle: 'italic' },
      { tag: [tags.strong], fontWeight: '600' },
      { tag: [tags.monospace], color: of['string'] },
      { tag: [tags.meta, tags.processingInstruction, tags.punctuation], color: of['meta'] },
    ]),
  );
}

const frame = EditorView.theme({
  '&': { backgroundColor: 'var(--sunken)', color: 'var(--ink)', height: '100%' },
  '.cm-content': { caretColor: 'var(--ink)', padding: '10px 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--sunken)',
    color: 'var(--ink-muted)',
    border: 'none',
    paddingRight: '6px',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--ink) 5%, transparent)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--ui-chosen)',
    border: 'none',
    color: 'var(--ink-muted)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--ink)',
    borderColor: 'var(--border)',
  },
  '.cm-panels input, .cm-panels button': { fontFamily: 'var(--font-body)', fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--sunken)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    color: 'var(--ink)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    color: 'var(--ink)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--ui-message)',
    border: '1px solid var(--border)',
    color: 'var(--ink)',
  },
  '.cm-placeholder': { color: 'var(--ink-muted)' },
  '.cm-label-line': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '.cm-shown-line': { backgroundColor: 'color-mix(in srgb, var(--accent) 24%, transparent)' },
});

const shownLine = Decoration.line({ class: 'cm-shown-line' });

function languageOf(language: CodeLanguage): Extension {
  switch (language) {
    case 'typescript':
      return javascript({ typescript: true });
    case 'markdown':
      return markdown();
    case 'json':
      return json();
    case 'yaml':
      return yaml();
    case 'text':
      return [];
  }
}

/** The language a file's name says. */
export function languageOfFile(name: string): CodeLanguage {
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) return 'typescript';
  if (/\.(md|markdown)$/.test(name)) return 'markdown';
  if (/\.json$/.test(name)) return 'json';
  if (/\.(yaml|yml)$/.test(name)) return 'yaml';
  return 'text';
}

/**
 * A text in the editor: to read, or to change when `onChange` is given.
 *
 * @param line - A line to bring to the middle, one of the file's own.
 * @param extensions - More of the editor's own parts, for a source's labels.
 */
export default function CodeEditor({
  text,
  language,
  onChange,
  line,
  wrap = false,
  placeholder,
  extensions,
  label,
  labels = false,
}: {
  text: string;
  language: CodeLanguage;
  onChange?: (text: string) => void;
  line?: number | undefined;
  wrap?: boolean;
  placeholder?: string;
  extensions?: Extension;
  label: string;
  /** Tints the lines that are a source's labels. */
  labels?: boolean;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const [look] = useLook();
  const parts = useRef({
    look: new Compartment(),
    language: new Compartment(),
    more: new Compartment(),
    shown: new Compartment(),
  });
  const changed = useRef(onChange);
  changed.current = onChange;
  const readOnly = onChange === undefined;

  useEffect(() => {
    if (host.current === null) return undefined;
    const made = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          frame,
          parts.current.look.of(colours(look)),
          parts.current.language.of(languageOf(language)),
          parts.current.more.of(extensions ?? []),
          parts.current.shown.of([]),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          wrap ? EditorView.lineWrapping : [],
          labels ? tintLabels : [],
          placeholder === undefined ? [] : placeholderOf(placeholder),
          keymap.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = made;
    return () => {
      made.destroy();
      view.current = undefined;
    };
    // The editor is made once for a mode; its text, look and language follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, wrap]);

  // A text that changed outside the editor takes the editor's place; what
  // the reader typed is the editor's own and is left as it is.
  useEffect(() => {
    const made = view.current;
    if (made === undefined) return;
    const held = made.state.doc.toString();
    if (held !== text) {
      made.dispatch({ changes: { from: 0, to: held.length, insert: text } });
    }
  }, [text]);

  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.look.reconfigure(colours(look)) });
  }, [look]);

  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.language.reconfigure(languageOf(language)) });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.more.reconfigure(extensions ?? []) });
  }, [extensions]);

  // The line a reader was led to is brought to the middle and tinted.
  useEffect(() => {
    const made = view.current;
    if (made === undefined) return;
    if (line === undefined) {
      made.dispatch({ effects: parts.current.shown.reconfigure([]) });
      return;
    }
    const at = Math.min(Math.max(1, line), made.state.doc.lines);
    const position = made.state.doc.line(at).from;
    made.dispatch({
      selection: { anchor: position },
      effects: [
        EditorView.scrollIntoView(position, { y: 'center' }),
        parts.current.shown.reconfigure(
          EditorView.decorations.of(Decoration.set([shownLine.range(position)])),
        ),
      ],
    });
  }, [line, text]);

  return <div ref={host} className="h-full min-h-0 w-full overflow-hidden" />;
}
