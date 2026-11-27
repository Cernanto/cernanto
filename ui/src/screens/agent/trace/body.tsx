// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Check, Copy } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

import { cx } from '../../../components/ui.js';
import { copyText } from '../../../state/save.js';

/** The text the reader searches the conversation for, as the search
 * reads it; empty while nothing is searched. What a message says marks
 * it where it stands. */
export const Searched = createContext('');

/** A text with the searched words marked in it. */
export function Marked({ text }: { text: string }): ReactNode {
  const needle = useContext(Searched);
  if (needle === '') return text;
  const lower = text.toLowerCase();
  let at = lower.indexOf(needle);
  if (at < 0) return text;
  const out: ReactNode[] = [];
  let from = 0;
  while (at >= 0) {
    if (at > from) out.push(text.slice(from, at));
    out.push(
      <mark key={at} className="found">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

// What a message says, drawn from the trace view's own lines. The view
// writes a value as lines: a label and its value, an item of a list
// under a dash, a text under its label. The screen draws those lines
// as text and never as markup: a value may come from the outside world.

/** One line of a value, as the view wrote it. */
interface Row {
  /** How far in the line stands, in letters. */
  indent: number;
  bullet: boolean;
  label: string | undefined;
  value: string;
}

/** A label of the view: a few words, a capital or a digit first, then a colon. */
const LABEL = /^([A-Z0-9][^:.!?]{0,47}):(?:\s+(.*))?$/;

function rowOf(line: string): Row {
  const lead = /^ */.exec(line)?.[0].length ?? 0;
  let rest = line.slice(lead);
  let indent = lead;
  const bullet = rest.startsWith('- ');
  if (bullet) {
    rest = rest.slice(2);
    indent += 2;
  }
  const labelled = LABEL.exec(rest);
  if (labelled !== null) {
    return { indent, bullet, label: labelled[1], value: (labelled[2] ?? '').trimStart() };
  }
  return { indent, bullet, label: undefined, value: rest };
}

/** Whether a value is an exact thing: an id, a number, an address, a
 * path. It alone takes the fixed-width face; a sentence stays plain. */
function exact(value: string): boolean {
  if (value === '' || /\s/.test(value)) return false;
  return /[0-9_/:@#=]/.test(value) || /^[a-z]+(-[a-z0-9]+)+$/.test(value);
}

const ADDRESS = /(https?:\/\/[^\s<>"')\]]+)/g;

/** A text with its http and https addresses to open in a new tab,
 * shown whole; nothing else in a value is made active. */
function WithAddresses({ text }: { text: string }): ReactNode {
  if (!text.includes('http')) return <Marked text={text} />;
  const parts = text.split(ADDRESS);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent-text underline decoration-1 underline-offset-2 hover:decoration-2"
      >
        <Marked text={part} />
      </a>
    ) : (
      <Marked key={index} text={part} />
    ),
  );
}

/** How long a message is before it is cut: ten lines or six hundred letters. */
const CUT = { lines: 10, letters: 600 };

/** Cuts lines at the cut's measures, at a line's end and at a word's
 * end, and never inside an address. */
function cut(lines: string[]): { shown: string[]; more: boolean } {
  let letters = 0;
  const shown: string[] = [];
  for (const line of lines) {
    if (shown.length >= CUT.lines) return { shown, more: true };
    if (letters + line.length > CUT.letters) {
      const room = CUT.letters - letters;
      let at = line.lastIndexOf(' ', room);
      if (at < room * 0.5) at = room;
      const head = line.slice(0, at);
      const inAddress = /https?:\/\/\S*$/.exec(head);
      shown.push(`${inAddress === null ? head : head.slice(0, inAddress.index)}…`);
      return { shown, more: true };
    }
    letters += line.length;
    shown.push(line);
  }
  return { shown, more: false };
}

/** A value's lines, drawn. Clipped, each stays on one line and is cut
 * at its end where it is too long, which every browser draws alike. */
export function Lines({
  lines,
  muted = false,
  clipped = false,
}: {
  lines: string[];
  muted?: boolean;
  clipped?: boolean;
}): ReactNode {
  const rows = lines.map(rowOf);
  return (
    <div className={cx('flex min-w-0 flex-col', muted ? 'text-ink-muted' : 'text-ink')}>
      {rows.map((row, index) => (
        <div
          key={index}
          className="flex min-w-0 items-baseline gap-x-2"
          style={{ paddingLeft: `${String((row.indent - (row.bullet ? 2 : 0)) * 0.5)}em` }}
        >
          {row.bullet && <span className="shrink-0 text-ink-muted">•</span>}
          {row.label !== undefined && (
            <span className="shrink-0 text-ink-muted">
              <Marked text={row.label} />
            </span>
          )}
          {row.value !== '' && row.value !== '|' && (
            <span
              className={cx(
                'min-w-0',
                clipped ? 'truncate' : 'break-words whitespace-pre-wrap',
                exact(row.value) && 'mono',
              )}
            >
              <WithAddresses text={row.value} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** What a message says: its lines, cut where it is long, with the way
 * to the whole of it. */
export function Body({
  lines,
  whole,
  onWhole,
  muted,
}: {
  lines: string[];
  /** Whether the message is shown whole. */
  whole: boolean;
  onWhole: (whole: boolean) => void;
  muted?: boolean;
}): ReactNode {
  if (lines.length === 0) return null;
  const clipped = cut(lines);
  const shown = whole ? lines : clipped.shown;
  return (
    <div className="min-w-0">
      <Lines lines={shown} {...(muted === undefined ? {} : { muted })} />
      {clipped.more && (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-accent-text hover:underline"
          onClick={() => {
            onWhole(!whole);
          }}
        >
          {whole ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** A small button that copies a text and says so. */
export function CopyButton({
  text,
  label = 'Copy',
  className,
  size = 13,
}: {
  text: string | (() => string);
  label?: string;
  className?: string;
  size?: number;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(typeof text === 'function' ? text() : text).then((done) => {
          setCopied(done);
          window.setTimeout(() => {
            setCopied(false);
          }, 1400);
        });
      }}
      className={cx(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink',
        className,
      )}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

/** A value that is code or a document: a block with a head line that
 * names its kind and copies it, its lines numbered. */
export function CodeBlock({ kind, text }: { kind: string; text: string }): ReactNode {
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <div className="overflow-hidden rounded-md border bg-sunken">
      <div className="flex h-7 items-center justify-between border-b pr-1 pl-2.5 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
        {kind}
        <CopyButton text={text} label={`Copy the ${kind}`} />
      </div>
      <pre className="mono max-h-96 overflow-auto py-2 text-[12.5px] leading-[1.55] text-ink">
        {lines.map((line, index) => (
          <div key={index} className="flex">
            <span className="figures w-10 shrink-0 pr-3 text-right text-ink-muted select-none">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 pr-3 whitespace-pre-wrap">
              {line === '' ? ' ' : line}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
