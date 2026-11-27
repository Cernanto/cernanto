// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { markdownLanguage } from '@codemirror/lang-markdown';
import { Check } from 'lucide-react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';

import { cx } from './ui.js';

// A Markdown text drawn as a reader of Markdown expects it: headings,
// lists, tables and blocks of code. It is drawn from the tree the
// editor's own parser reads, so the screen carries one reading of
// Markdown. A source is a program and may be another publisher's, so
// NOTHING OF IT IS HIDDEN AND NOTHING OF IT IS RUN: HTML and a comment
// written in it stand as the text they are, a link is followed only to
// a web address or a mail address, and a picture is named and never
// fetched.

type Node = ReturnType<typeof markdownLanguage.parser.parse>['topNode'];

/** The marks of the writing itself, which the drawn text does not show. */
const MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'LinkMark',
  'QuoteMark',
  'ListMark',
  'TaskMarker',
  'StrikethroughMark',
  'SubscriptMark',
  'SuperscriptMark',
  'TableDelimiter',
]);

/** The named entities a text is likely to hold, each by the number of its character. */
const ENTITIES: Record<string, number> = {
  amp: 0x26,
  lt: 0x3c,
  gt: 0x3e,
  quot: 0x22,
  apos: 0x27,
  nbsp: 0xa0,
  copy: 0xa9,
  hellip: 0x2026,
  mdash: 0x2014,
  ndash: 0x2013,
};

function kids(node: Node): Node[] {
  const out: Node[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) out.push(child);
  return out;
}

/** An entity as the character it stands for, or as it is written when it is unknown. */
function entity(written: string): string {
  const name = written.slice(1, -1);
  if (name.startsWith('#')) {
    const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    try {
      return Number.isInteger(code) && code > 0 ? String.fromCodePoint(code) : written;
    } catch {
      return written;
    }
  }
  const named = ENTITIES[name];
  return named === undefined ? written : String.fromCodePoint(named);
}

/** Whether an address is one a reader may be sent to from a source. */
function followed(address: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(address.trim());
}

/** Something written in a source that is not Markdown's to draw, shown as the text it is. */
function Written({ text }: { text: string }): ReactNode {
  return <code className="mono text-[12.5px] text-ink-muted">{text}</code>;
}

interface Reading {
  text: string;
  /** The addresses the text defines by a name, for the links that go by one. */
  named: Map<string, string>;
}

/** A link's name as two links are held to be the same by. */
function nameOf(label: string): string {
  return label
    .replace(/^\[|\]$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function Linked({
  address,
  children,
}: {
  address: string | undefined;
  children: ReactNode;
}): ReactNode {
  if (address !== undefined && followed(address)) {
    return (
      <a
        href={address.trim()}
        target="_blank"
        rel="noreferrer noopener"
        title={address.trim()}
        className="text-accent-text underline decoration-1 underline-offset-2 hover:decoration-2"
      >
        {children}
      </a>
    );
  }
  // An address inside the workspace, or of a kind a page does not follow, is named and not followed.
  return (
    <span className="underline decoration-dotted underline-offset-2" title={address?.trim()}>
      {children}
    </span>
  );
}

/** What stands in a part of a line, between two places: its words, and the marked spans drawn. */
function span(reading: Reading, node: Node, from: number, to: number): ReactNode[] {
  const { text } = reading;
  const out: ReactNode[] = [];
  let at = from;
  for (const child of kids(node)) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > at) out.push(text.slice(at, child.from));
    at = Math.max(at, child.to);
    if (MARKS.has(child.name)) continue;
    out.push(<Fragment key={child.from}>{inline(reading, child)}</Fragment>);
  }
  if (to > at) out.push(text.slice(at, to));
  return out;
}

function inline(reading: Reading, node: Node): ReactNode {
  const { text } = reading;
  const whole = (): ReactNode[] => span(reading, node, node.from, node.to);
  switch (node.name) {
    case 'Emphasis':
      return <em>{whole()}</em>;
    case 'StrongEmphasis':
      return <strong className="font-semibold">{whole()}</strong>;
    case 'Strikethrough':
      return <del>{whole()}</del>;
    case 'Subscript':
      return <sub>{whole()}</sub>;
    case 'Superscript':
      return <sup>{whole()}</sup>;
    case 'InlineCode': {
      const marks = node.getChildren('CodeMark');
      const first = marks[0];
      const last = marks.at(-1);
      const inner =
        first === undefined || last === undefined || first === last
          ? text.slice(node.from, node.to)
          : text.slice(first.to, last.from);
      const code = /^ .* $/s.test(inner) && inner.trim() !== '' ? inner.slice(1, -1) : inner;
      return (
        <code className="mono rounded-sm bg-sunken px-1 py-0.5 text-[12.5px]">
          {code.replace(/\n/g, ' ')}
        </code>
      );
    }
    case 'Link':
    case 'Image': {
      const marks = node.getChildren('LinkMark');
      const open = marks[0];
      const close = marks[1];
      const label =
        open === undefined
          ? whole()
          : span(reading, node, open.to, close === undefined ? node.to : close.from);
      const url = node.getChild('URL');
      const byName = node.getChild('LinkLabel');
      const address =
        url !== null
          ? text.slice(url.from, url.to)
          : reading.named.get(
              nameOf(
                byName !== null
                  ? text.slice(byName.from, byName.to)
                  : open === undefined || close === undefined
                    ? ''
                    : text.slice(open.to, close.from),
              ),
            );
      if (node.name === 'Image') {
        // A picture is named, with where it is, and never fetched.
        return (
          <Linked address={address}>
            picture{label.length > 0 && ': '}
            {label}
          </Linked>
        );
      }
      return <Linked address={address}>{label}</Linked>;
    }
    case 'Autolink': {
      const url = node.getChild('URL');
      const address = url === null ? text.slice(node.from, node.to) : text.slice(url.from, url.to);
      return (
        <Linked address={/^[^:/\s]+@/.test(address) ? `mailto:${address}` : address}>
          {address}
        </Linked>
      );
    }
    case 'URL': {
      const address = text.slice(node.from, node.to);
      return (
        <Linked address={/^www\./i.test(address) ? `https://${address}` : address}>
          {address}
        </Linked>
      );
    }
    case 'HardBreak':
      return <br />;
    case 'Escape':
      return text.slice(node.from + 1, node.to);
    case 'Entity':
      return entity(text.slice(node.from, node.to));
    case 'HTMLTag':
    case 'Comment':
    case 'ProcessingInstruction':
      return <Written text={text.slice(node.from, node.to)} />;
    default:
      return text.slice(node.from, node.to);
  }
}

const HEADINGS: Record<string, string> = {
  1: 'mt-0 mb-3 text-[22px] leading-tight font-semibold',
  2: 'mt-7 mb-2 border-b pb-1.5 text-[17px] font-semibold',
  3: 'mt-6 mb-1.5 text-[15px] font-semibold',
  4: 'mt-5 mb-1 text-[14px] font-semibold',
  5: 'mt-4 mb-1 text-[13px] font-semibold',
  6: 'mt-4 mb-1 text-[13px] font-semibold text-ink-secondary',
};

/** The cells of a table's row, an empty one where two bars stand side by side. */
function cells(row: Node): (Node | undefined)[] {
  const out: (Node | undefined)[] = [];
  let held: Node | undefined;
  let bars = 0;
  for (const child of kids(row)) {
    if (child.name === 'TableDelimiter') {
      // The bar a row opens with stands before its first cell and closes none.
      if (bars > 0 || held !== undefined) out.push(held);
      held = undefined;
      bars += 1;
    } else if (child.name === 'TableCell') {
      held = child;
    }
  }
  if (held !== undefined) out.push(held);
  return out;
}

function block(reading: Reading, node: Node, tight: boolean): ReactNode {
  const { text } = reading;
  const within = (): ReactNode[] => span(reading, node, node.from, node.to);
  const heading = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(node.name);
  if (heading !== null) {
    const level = heading[1] ?? '1';
    const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    return <Tag className={cx('text-ink', HEADINGS[level])}>{within()}</Tag>;
  }
  switch (node.name) {
    case 'Paragraph':
      return <p className={tight ? 'my-0.5' : 'my-3'}>{within()}</p>;
    case 'Blockquote':
      return (
        <blockquote className="my-3 border-l-2 border-line-strong pl-4 text-ink-secondary">
          {blocks(reading, node, false)}
        </blockquote>
      );
    case 'BulletList':
    case 'OrderedList': {
      const items = node.getChildren('ListItem');
      // A list whose items stand a blank line apart is drawn with air between them.
      const loose = items.some(
        (item, index) =>
          index > 0 && /\n[ \t]*\n/.test(text.slice(items[index - 1]?.to ?? item.from, item.from)),
      );
      const drawn = items.map((item) => {
        const task = item.getChild('Task');
        return (
          <li
            key={item.from}
            className={cx(loose ? 'my-2' : 'my-0.5', task !== null && '-ml-5 list-none')}
          >
            {blocks(reading, item, !loose)}
          </li>
        );
      });
      if (node.name === 'BulletList') return <ul className="my-3 list-disc pl-6">{drawn}</ul>;
      const first = items[0]?.getChild('ListMark');
      const start =
        first === null || first === undefined
          ? 1
          : Number.parseInt(text.slice(first.from, first.to), 10);
      return (
        <ol className="my-3 list-decimal pl-6" start={Number.isInteger(start) ? start : 1}>
          {drawn}
        </ol>
      );
    }
    case 'Task': {
      const marker = node.getChild('TaskMarker');
      const done = marker !== null && /x/i.test(text.slice(marker.from, marker.to));
      return (
        <div className="my-0.5 flex items-baseline gap-2">
          <span
            role="img"
            aria-label={done ? 'Done' : 'Not done'}
            className={cx(
              'inline-flex size-3.5 shrink-0 translate-y-0.5 items-center justify-center rounded-sm border border-line-strong text-[10px] leading-none',
              done && 'bg-chosen text-ink',
            )}
          >
            {done && <Check size={10} strokeWidth={3} />}
          </span>
          <span className="min-w-0">{span(reading, node, marker?.to ?? node.from, node.to)}</span>
        </div>
      );
    }
    case 'FencedCode':
    case 'CodeBlock': {
      const code = node
        .getChildren('CodeText')
        .map((part) => text.slice(part.from, part.to))
        .join('\n');
      return (
        <pre className="mono my-3 overflow-x-auto rounded-md border bg-sunken p-3 text-xs leading-relaxed text-ink">
          <code>{code}</code>
        </pre>
      );
    }
    case 'HorizontalRule':
      return <hr className="my-5" />;
    case 'Table': {
      const head = node.getChild('TableHeader');
      const rows = node.getChildren('TableRow');
      const cell = (one: Node | undefined): ReactNode[] =>
        one === undefined ? [] : span(reading, one, one.from, one.to);
      return (
        <div className="my-3 overflow-x-auto">
          <table className="border-collapse text-[13px]">
            {head !== null && (
              <thead>
                <tr>
                  {cells(head).map((one, index) => (
                    <th
                      key={index}
                      className="border bg-sunken px-2.5 py-1 text-left font-semibold"
                    >
                      {cell(one)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row) => (
                <tr key={row.from}>
                  {cells(row).map((one, index) => (
                    <td key={index} className="border px-2.5 py-1 align-top">
                      {cell(one)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      // HTML, a comment, a link's definition and whatever else Markdown
      // does not draw: the text as it is written, so nothing of a source is hidden.
      return (
        <pre className="mono my-3 overflow-x-auto text-xs whitespace-pre-wrap text-ink-muted">
          {text.slice(node.from, node.to)}
        </pre>
      );
  }
}

function blocks(reading: Reading, node: Node, tight: boolean): ReactNode[] {
  return kids(node)
    .filter((child) => !MARKS.has(child.name))
    .map((child) => <Fragment key={child.from}>{block(reading, child, tight)}</Fragment>);
}

/** A Markdown text, drawn. It rests on the editor's parser, so it is a
 * file of its own beside the editor's, asked for when it is first shown. */
export default function MarkdownView({
  text,
  className,
}: {
  text: string;
  className?: string;
}): ReactNode {
  const top = markdownLanguage.parser.parse(text).topNode;
  const named = new Map<string, string>();
  for (const child of kids(top)) {
    if (child.name !== 'LinkReference') continue;
    const label = child.getChild('LinkLabel');
    const url = child.getChild('URL');
    if (label !== null && url !== null) {
      named.set(nameOf(text.slice(label.from, label.to)), text.slice(url.from, url.to));
    }
  }
  // The first thing drawn and the last keep no air of their own: the
  // text stands as far from its box's top as from its bottom, whether
  // it opens with a title or with a paragraph.
  return (
    <div
      className={cx(
        'text-[14px] leading-[1.65] break-words text-ink [&>:first-child]:mt-0 [&>:last-child]:mb-0',
        className,
      )}
    >
      {blocks({ text, named }, top, false)}
    </div>
  );
}
