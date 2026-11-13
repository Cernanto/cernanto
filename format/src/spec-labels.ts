// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// A page's declared premises, read the way the plane's grammar module
// reads them, for the cli and any tool outside the plane: one scan of
// the page that tracks fenced code blocks first and, outside a fence,
// recognizes the Tests heading, the five labels, the Type line, the
// bullets under a bare label, the near misses and the duplicates. The
// entries are answered as written; whether each is a grant, an agent
// path or a license expression is the grammar module's to judge. The
// tree holds this scan to the module's on one set of pages.

/** The five labels a page declares its premises with, beside `Type:`. */
export type SpecLabelName = 'Uses' | 'Implements' | 'Mocks' | 'Copyright' | 'License';

/** One problem the scan found: the message names the scope it speaks
 * of, and the line is 1-based over the whole page. */
export interface SpecLabelIssue {
  message: string;
  line?: number;
}

/** The labels of one section, their entries as written, and the
 * section's prose: every line outside a fence that is no label, no
 * bullet of one, no Tests heading and no `## License` heading, and
 * every line inside a fence, joined by newlines and trimmed. */
export interface SpecLabelSection {
  /** The scope word every diagnostic of the section opens with. */
  scope: 'spec' | 'tests';
  uses: string[];
  implements: string[];
  mocks: string[];
  copyright: string[];
  license: string[];
  prose: string;
}

/** A page's declared premises as the scan read them. */
export interface SpecLabels {
  issues: SpecLabelIssue[];
  /** The Type line's value as written, trimmed, when the head has one. */
  type?: string;
  /** The line of the Type line, when the head has one. */
  typeLine?: number;
  head: SpecLabelSection;
  /** The Tests section with its heading's line, when the page has one. */
  tests?: SpecLabelSection & { line: number };
}

const TYPE_LINE = /^Type:(.*)$/;
const LABEL_LINE = /^(Uses|Implements|Copyright|License|Mocks):(.*)$/;
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;
const HEADING = /^##(?!#)\s*(.*?)\s*$/;
const NEAR_LABEL = /^[*_]*([A-Za-z]+)[*_]*\s*:/;
const REMOTE_URL =
  /^(?:https:\/\/[^\s]+|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s]*)?)$/;

/** The labels a near miss is held against, each with its spelling. */
const LABELS: { word: string; label: string }[] = [
  { word: 'type', label: 'Type:' },
  { word: 'uses', label: 'Uses:' },
  { word: 'implements', label: 'Implements:' },
  { word: 'mocks', label: 'Mocks:' },
  { word: 'copyright', label: 'Copyright:' },
  { word: 'license', label: 'License:' },
];

/** The Tests heading's spellings a near miss is held against. */
const TESTS_WORDS = new Set(['test', 'tests', 'testing']);

/** The edit distance of two short words. */
function edits(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    const row: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const above = rows[i - 1];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] =
        i === 0
          ? j
          : Math.min((row[j - 1] ?? 0) + 1, (above?.[j] ?? 0) + 1, (above?.[j - 1] ?? 0) + cost);
    }
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? 0;
}

/** The label a word is a near miss of, within one edit, or undefined. */
function nearLabel(word: string): string | undefined {
  const folded = word.toLowerCase();
  let best: { label: string; distance: number } | undefined;
  for (const { word: known, label } of LABELS) {
    const distance = edits(folded, known);
    if (distance <= 1 && (best === undefined || distance < best.distance)) {
      best = { label, distance };
    }
  }
  return best?.label;
}

/** A heading's text with its decoration taken off: `*`, `_` and the
 * closing `#`s, case folded. */
function undecorated(text: string): string {
  return text
    .replace(/#+\s*$/, '')
    .replace(/[*_]/g, '')
    .trim()
    .toLowerCase();
}

interface Entry {
  text: string;
  line: number;
}

interface Block {
  line: number;
  entries: Entry[];
}

interface Section {
  scope: 'spec' | 'tests';
  line: number;
  blocks: Map<SpecLabelName, Block>;
  proseLines: string[];
}

/** The entries written after a label on its own line: split on every
 * comma, except that in a Uses line a local server's command (an `mcp:`
 * entry whose rest is no remote url) takes the rest of the line. */
function inlineEntries(name: SpecLabelName, rest: string, line: number): Entry[] {
  if (name === 'Copyright' || name === 'License') return [{ text: rest, line }];
  const parts = rest.split(',');
  if (name === 'Uses') {
    for (let k = 0; k < parts.length; k += 1) {
      const part = (parts[k] ?? '').trim();
      if (part.startsWith('mcp:') && !REMOTE_URL.test(part.slice(4))) {
        const before = parts.slice(0, k).map((text) => ({ text: text.trim(), line }));
        return [...before, { text: parts.slice(k).join(',').trim(), line }];
      }
    }
  }
  return parts.map((text) => ({ text: text.trim(), line }));
}

function secondLabelMessage(scope: string, name: SpecLabelName): string {
  if (name === 'Mocks') {
    return `${scope}: a second Mocks line; the mocked agents are stated once, add the entry to the first`;
  }
  if (name === 'Copyright' || name === 'License') {
    return `${scope}: a second ${name} line; the notice is stated once in the whole spec`;
  }
  return `${scope}: a second ${name} line; a section grants in one place, add the entry to the first`;
}

function sectionOf(section: Section): SpecLabelSection {
  const entries = (name: SpecLabelName): string[] =>
    (section.blocks.get(name)?.entries ?? []).map((entry) => entry.text);
  return {
    scope: section.scope,
    uses: entries('Uses'),
    implements: entries('Implements'),
    mocks: entries('Mocks'),
    copyright: entries('Copyright'),
    license: entries('License'),
    prose: section.proseLines.join('\n').trim(),
  };
}

/**
 * Reads a page's declared premises: its `Type:` line, its labels with
 * their entries as written, its Tests section and the prose of each
 * section, and every problem of the scan. Fenced code blocks are
 * tracked first: inside a fence every line is prose, an example. A
 * label is the exact spelling (`Uses:`, capital, no space before the
 * colon, no decoration), and in a declaration position (a line that
 * opens a paragraph, a line in the run of lines after a label up to the
 * next blank line) a line that opens with a word within one edit of a
 * label's and a colon is a near miss, a problem naming the label meant;
 * a level-two heading reading `test`, `tests` or `testing` that is not
 * exactly `## Tests` is a near miss of the heading. A second `Type:`
 * line in the head, a second `## Tests` heading and a second label of
 * one name in a section are problems at their line. Every message
 * opens with the scope it speaks of, `spec` for the head and `tests`
 * for the Tests section.
 *
 * @param markdown - The page's text.
 * @returns The scan's answer: never a refusal, every problem listed.
 * @example
 * const labels = parseSpecLabels('# Mailer\n\nUses: npm:nodemailer\n\nSends mail.\n');
 * // => { issues: [], head: { scope: 'spec', uses: ['npm:nodemailer'], ..., prose: '# Mailer\n\nSends mail.' } }
 */
export function parseSpecLabels(markdown: string): SpecLabels {
  const lines = markdown.split(/\r?\n/);
  const issues: SpecLabelIssue[] = [];
  const head: Section = { scope: 'spec', line: 1, blocks: new Map(), proseLines: [] };
  let tests: Section | undefined;
  let section = head;
  let type: { text: string; line: number } | undefined;
  let fence: { char: string; length: number } | undefined;
  // Whether the next non-blank line opens a paragraph, and whether the
  // scan stands in the run of lines after a label.
  let paragraphStart = true;
  let labelRun = false;

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const t = raw.trim();
    const line = i + 1;
    i += 1;

    if (fence !== undefined) {
      const closing = /^(`{3,}|~{3,})\s*$/.exec(t);
      if (
        closing !== null &&
        (closing[1] ?? '')[0] === fence.char &&
        (closing[1] ?? '').length >= fence.length
      ) {
        fence = undefined;
      }
      section.proseLines.push(raw);
      continue;
    }
    const opening = FENCE_OPEN.exec(t);
    if (opening !== null) {
      fence = { char: (opening[1] ?? '`')[0] ?? '`', length: (opening[1] ?? '').length };
      section.proseLines.push(raw);
      paragraphStart = false;
      labelRun = false;
      continue;
    }
    if (t === '') {
      section.proseLines.push(raw);
      paragraphStart = true;
      labelRun = false;
      continue;
    }

    const heading = HEADING.exec(t);
    if (heading !== null) {
      if (t === '## Tests') {
        if (tests !== undefined) {
          issues.push({
            message: 'tests: a second ## Tests heading; a page has one Tests section',
            line,
          });
        } else {
          tests = { scope: 'tests', line, blocks: new Map(), proseLines: [] };
          section = tests;
        }
        paragraphStart = true;
        labelRun = false;
        continue;
      }
      if (t === '## License') {
        continue;
      }
      if (TESTS_WORDS.has(undecorated(heading[1] ?? ''))) {
        issues.push({
          message: `${section.scope}: "${t}" is not the Tests heading; did you mean "## Tests"`,
          line,
        });
        paragraphStart = true;
        labelRun = false;
        continue;
      }
      section.proseLines.push(raw);
      paragraphStart = false;
      labelRun = false;
      continue;
    }

    const typeLine = TYPE_LINE.exec(t);
    if (typeLine !== null) {
      if (section.scope === 'tests') {
        issues.push({ message: 'tests: Type belongs to the head', line });
      } else if (type !== undefined) {
        issues.push({ message: 'spec: a second Type line; the kind is stated once', line });
      } else {
        type = { text: (typeLine[1] ?? '').trim(), line };
      }
      paragraphStart = false;
      labelRun = true;
      continue;
    }

    const label = LABEL_LINE.exec(t);
    if (label !== null) {
      const name = label[1] as SpecLabelName;
      const rest = (label[2] ?? '').trim();
      paragraphStart = false;
      labelRun = true;
      if (section.blocks.has(name)) {
        issues.push({ message: secondLabelMessage(section.scope, name), line });
        continue;
      }
      const block: Block = { line, entries: [] };
      section.blocks.set(name, block);
      if (rest !== '') {
        block.entries = inlineEntries(name, rest, line);
        continue;
      }
      // The bullets on the lines below a bare label: blank lines before
      // a further bullet are skipped; the list ends before a blank line
      // that no bullet follows, or at any other line, which, when the
      // list already has entries, continues a bullet and is dropped.
      let j = i;
      while (j < lines.length) {
        const below = lines[j] ?? '';
        const bullet = BULLET.exec(below);
        if (bullet !== null) {
          block.entries.push({ text: (bullet[1] ?? '').trim(), line: j + 1 });
          j += 1;
          continue;
        }
        if (below.trim() === '') {
          let k = j + 1;
          while (k < lines.length && (lines[k] ?? '').trim() === '') k += 1;
          if (k < lines.length && BULLET.test(lines[k] ?? '')) {
            j = k;
            continue;
          }
          break;
        }
        if (block.entries.length > 0) {
          issues.push({
            message: `${section.scope}: the line "${below.trim()}" continues the bullet above it; put every grant on its own bullet line`,
            line: j + 1,
          });
          j += 1;
        }
        break;
      }
      if (block.entries.length === 0) {
        issues.push({
          message: `${section.scope}: ${name} names nothing; write the entries after the colon, or one per bullet on the lines below`,
          line,
        });
      }
      i = j;
      continue;
    }

    if (paragraphStart || labelRun) {
      const near = NEAR_LABEL.exec(t);
      const meant = near === null ? undefined : nearLabel(near[1] ?? '');
      if (near !== null && meant !== undefined) {
        issues.push({
          message: `${section.scope}: "${near[1] ?? ''}:" is not a label; did you mean "${meant}"`,
          line,
        });
        paragraphStart = false;
        labelRun = true;
        continue;
      }
    }

    section.proseLines.push(raw);
    paragraphStart = false;
  }

  // The scope rules the scan itself settles: where each label belongs,
  // and a notice stated twice.
  const headMocks = head.blocks.get('Mocks');
  if (headMocks !== undefined) {
    issues.push({
      message: 'spec: Mocks belongs to the tests, inside the Tests section',
      line: headMocks.line,
    });
    head.blocks.delete('Mocks');
  }
  if (tests !== undefined) {
    const impl = tests.blocks.get('Implements');
    if (impl !== undefined) {
      issues.push({
        message: 'tests: Implements belongs to the agent, above the Tests section',
        line: impl.line,
      });
      tests.blocks.delete('Implements');
    }
    for (const name of ['Copyright', 'License'] as const) {
      const block = tests.blocks.get(name);
      if (block !== undefined && head.blocks.has(name)) {
        issues.push({
          message: `tests: ${name} is already stated above the Tests section; state it once`,
          line: block.line,
        });
        tests.blocks.delete(name);
      }
    }
  }
  issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  return {
    issues,
    ...(type === undefined ? {} : { type: type.text, typeLine: type.line }),
    head: sectionOf(head),
    ...(tests === undefined ? {} : { tests: { ...sectionOf(tests), line: tests.line } }),
  };
}
