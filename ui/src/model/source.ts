// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import {
  AGENT_PATH_PATTERN,
  parsePackageRef,
  parseSpecLabels,
} from '@cernanto/package-format/browser';
import type { SpecLabels } from '@cernanto/package-format/browser';

// A source stays one text, read in the parts the scan splits it into:
// the labels, the agent's own text, the tests' labels and their text,
// and the notice. The fields are the scan of that text, made again at
// every change, and a field's change rewrites its own label's lines and
// no other byte, since a compile changes only what moved. A section's
// text is the lines of the source between the labels that stand above
// it and what stands under it, as they are written: a change of it
// writes those lines and no other, and no label is moved. A source
// opened and saved with nothing changed is the same bytes.

export type { SpecLabels };

/** The labels a source's fields write. */
export type LabelName = 'Uses' | 'Implements' | 'Mocks' | 'Copyright' | 'License';
/** Where a label stands: the agent's own head, or its Tests section. */
export type Scope = 'spec' | 'tests';

/** The six kinds of agent, each with the guide's own line of when it fits. */
export const AGENT_TYPES: { type: string; when: string }[] = [
  { type: 'task', when: 'The default: each call its own world, scaling out and to zero.' },
  { type: 'service', when: 'It keeps its own state between calls, or a call waits for another.' },
  { type: 'worker', when: 'Nobody calls it; it runs on its own time.' },
  { type: 'job', when: 'One live run, started over on a failure.' },
  { type: 'module', when: 'It runs inside the agents that use it.' },
  { type: 'interface', when: 'A contract alone that other agents implement.' },
];

/** A label's own lines in a text. */
interface Block {
  scope: Scope;
  name: LabelName | 'Type';
  /** The first line of the block, from zero. */
  from: number;
  /** The line after its last. */
  to: number;
  /** Whether its entries stand on the label's own line. */
  inline: boolean;
}

/** What a line that is no text of a section belongs to: the labels a
 * section grants and declares with, or the notice at the source's end. */
type Apart = 'label' | 'notice';

interface Layout {
  lines: string[];
  blocks: Block[];
  /** The line the agent's text opens with, when that line is its title. */
  title: number | undefined;
  /** The line of `## Tests`, when the text has one. */
  tests: number | undefined;
  /** The line of the first `## License`, when the text has one. */
  license: number | undefined;
  /** Of each line, what it belongs to when it is no text of a section:
   * a label's own line, a heading the scan reads as a mark, or a line
   * the scan refuses. A line of a section's text, a blank one among
   * them, has none. */
  apart: (Apart | undefined)[];
}

const LABEL_LINE = /^(Type|Uses|Implements|Copyright|License|Mocks):(.*)$/;
const FENCE_OPEN = /^(`{3,}|~{3,})/;

function isBullet(line: string): boolean {
  const opened = line.trimStart();
  return /^[-*]\s/.test(opened) && opened.slice(1).trim() !== '';
}

function blank(line: string | undefined): boolean {
  return (line ?? '').trim() === '';
}

/** Whether a line is a first-level heading: the title a text opens with. */
function isTitle(line: string | undefined): boolean {
  const trimmed = (line ?? '').trim();
  return trimmed === '#' || /^#\s+\S/.test(trimmed);
}

/** Where each label's lines stand: a light walk of the text by the
 * scanner's own rules for a fence, a label's line and the bullets under
 * a bare label. It finds lines; what they say is the scanner's to read. */
function layoutOf(text: string): Layout {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  const licenses: number[] = [];
  let scope: Scope = 'spec';
  let fence: { char: string; length: number } | undefined;
  let tests: number | undefined;
  let i = 0;
  while (i < lines.length) {
    const trimmed = (lines[i] ?? '').trim();
    if (fence !== undefined) {
      const closing = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
      if (
        closing !== null &&
        (closing[1] ?? '')[0] === fence.char &&
        (closing[1] ?? '').length >= fence.length
      ) {
        fence = undefined;
      }
      i += 1;
      continue;
    }
    const opening = FENCE_OPEN.exec(trimmed);
    if (opening !== null) {
      fence = { char: (opening[1] ?? '`')[0] ?? '`', length: (opening[1] ?? '').length };
      i += 1;
      continue;
    }
    if (trimmed === '## Tests' && tests === undefined) {
      tests = i;
      scope = 'tests';
      i += 1;
      continue;
    }
    if (trimmed === '## License') licenses.push(i);
    const label = LABEL_LINE.exec(trimmed);
    if (label === null) {
      i += 1;
      continue;
    }
    const name = label[1] as Block['name'];
    const rest = (label[2] ?? '').trim();
    const known = blocks.some((block) => block.scope === scope && block.name === name);
    if (rest !== '' || name === 'Type') {
      if (!known) blocks.push({ scope, name, from: i, to: i + 1, inline: true });
      i += 1;
      continue;
    }
    // A bare label: its bullets on the lines below, blank lines before a further bullet among them.
    let end = i + 1;
    let j = i + 1;
    while (j < lines.length) {
      const below = lines[j] ?? '';
      if (isBullet(below)) {
        j += 1;
        end = j;
        continue;
      }
      if (below.trim() === '') {
        let k = j + 1;
        while (k < lines.length && (lines[k] ?? '').trim() === '') k += 1;
        if (k < lines.length && isBullet(lines[k] ?? '')) {
          j = k;
          continue;
        }
      }
      break;
    }
    if (!known) blocks.push({ scope, name, from: i, to: end, inline: false });
    i = end;
  }
  // What is no text of a section: a label's lines, the notice's heading
  // and its two labels, the Tests heading, and every line the scan
  // names a problem at, since the scan keeps none of those in a
  // section's text. The scan is the one judge of a line it refuses.
  const apart: (Apart | undefined)[] = lines.map(() => undefined);
  for (const issue of parseSpecLabels(text).issues) {
    if (issue.line !== undefined && issue.line <= lines.length) apart[issue.line - 1] = 'label';
  }
  for (const block of blocks) {
    const kind = block.name === 'Copyright' || block.name === 'License' ? 'notice' : 'label';
    for (let line = block.from; line < block.to; line += 1) apart[line] = kind;
  }
  for (const line of licenses) apart[line] = 'notice';
  if (tests !== undefined) apart[tests] = 'label';
  // The title is the line the agent's text opens with, when that line
  // is a first-level heading. One with nothing after its mark is still
  // the title's line: a title cleared and typed again is that line.
  const head = tests ?? lines.length;
  let opens = 0;
  while (opens < head && (apart[opens] !== undefined || blank(lines[opens]))) opens += 1;
  const title = opens < head && isTitle(lines[opens]) ? opens : undefined;
  return { lines, blocks, title, tests, license: licenses[0], apart };
}

/** Whether an entry needs a line of its own: a local server's command
 * runs to the end of its line, and a comma would part any other entry. */
function needsOwnLine(entry: string): boolean {
  return (entry.startsWith('mcp:') && !/^mcp:https?:\/\/\S+$/.test(entry)) || entry.includes(',');
}

/** A label's lines for its entries: one line, or bullets under a bare label. */
function written(name: string, entries: string[], inline: boolean): string[] {
  if (name === 'Copyright' || name === 'License') return [`${name}: ${entries.join(', ')}`];
  if (inline && !entries.some(needsOwnLine)) return [`${name}: ${entries.join(', ')}`];
  return [`${name}:`, '', ...entries.map((entry) => `- ${entry}`)];
}

/** Lines with a part of them replaced, and a blank line kept around what was laid in. */
function spliced(lines: string[], from: number, to: number, put: string[]): string[] {
  return [...lines.slice(0, from), ...put, ...lines.slice(to)];
}

/** Removes a block with the blank line that parted it from what follows. */
function without(lines: string[], block: Block): string[] {
  const after = (lines[block.to] ?? 'x').trim() === '' ? block.to + 1 : block.to;
  return spliced(lines, block.from, after, []);
}

/** The line a new label of the head is laid at: after the title and the
 * labels that already stand under it. */
function headPlace(layout: Layout): number {
  const own = layout.blocks.filter(
    (block) => block.scope === 'spec' && block.name !== 'Copyright' && block.name !== 'License',
  );
  if (own.length > 0) {
    const last = own.reduce((a, b) => (b.to > a.to ? b : a));
    // Only the labels that stand at the top, before the prose, draw a new one to them.
    const prose = layout.lines.slice((layout.title ?? -1) + 1, last.from).some(
      (line, index) =>
        line.trim() !== '' &&
        !own.some((block) => {
          const at = (layout.title ?? -1) + 1 + index;
          return at >= block.from && at < block.to;
        }),
    );
    if (!prose) return last.to;
  }
  return layout.title === undefined ? 0 : layout.title + 1;
}

/**
 * A source with one label's entries set. The label's own lines are
 * rewritten and no other byte; no entry removes the label, and a label
 * the source lacks is laid in where its kind stands: in the head under
 * the title, in the Tests section under its heading, the notice under
 * `## License` at the end.
 */
export function setLabel(text: string, scope: Scope, name: LabelName, entries: string[]): string {
  const layout = layoutOf(text);
  const kept = entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
  const notice = name === 'Copyright' || name === 'License';
  const block = layout.blocks.find(
    (entry) => entry.name === name && (notice || entry.scope === scope),
  );
  if (block !== undefined) {
    if (kept.length === 0) return without(layout.lines, block).join('\n');
    return spliced(layout.lines, block.from, block.to, written(name, kept, block.inline)).join(
      '\n',
    );
  }
  if (kept.length === 0) return text;
  const lines = [...layout.lines];
  // A text ends with one line's end, which the split shows as a last empty line.
  const end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  if (notice) {
    if (layout.license === undefined) {
      const lead = end > 0 && (lines[end - 1] ?? '').trim() !== '' ? [''] : [];
      return spliced(lines, end, end, [
        ...lead,
        '## License',
        '',
        ...written(name, kept, true),
      ]).join('\n');
    }
    const other = layout.blocks.find(
      (entry) => entry.name === 'Copyright' || entry.name === 'License',
    );
    if (other !== undefined) {
      const at = name === 'Copyright' ? other.from : other.to;
      const put =
        name === 'Copyright'
          ? [...written(name, kept, true), '']
          : ['', ...written(name, kept, true)];
      return spliced(lines, at, at, put).join('\n');
    }
    return spliced(lines, layout.license + 1, layout.license + 1, [
      '',
      ...written(name, kept, true),
    ]).join('\n');
  }
  if (scope === 'tests') {
    if (layout.tests === undefined) {
      const at = layout.license ?? end;
      const lead = at > 0 && (lines[at - 1] ?? '').trim() !== '' ? [''] : [];
      // A blank line parts the new section from a heading that follows it.
      const tail = (lines[at] ?? '').trim() !== '' ? [''] : [];
      return spliced(lines, at, at, [
        ...lead,
        '## Tests',
        '',
        ...written(name, kept, true),
        ...tail,
      ]).join('\n');
    }
    const own = layout.blocks.filter(
      (entry) => entry.scope === 'tests' && (entry.name === 'Uses' || entry.name === 'Mocks'),
    );
    const at = own.length > 0 ? Math.max(...own.map((entry) => entry.to)) : layout.tests + 1;
    return spliced(lines, at, at, ['', ...written(name, kept, true)]).join('\n');
  }
  const at = headPlace(layout);
  const put = ['', ...written(name, kept, true)];
  if ((lines[at] ?? '').trim() !== '') put.push('');
  return spliced(lines, at, at, put).join('\n');
}

/** A source with its kind set. A task states none, so choosing it
 * removes the line. */
export function setType(text: string, type: string): string {
  const layout = layoutOf(text);
  const block = layout.blocks.find((entry) => entry.name === 'Type' && entry.scope === 'spec');
  if (type === 'task' || type === '') {
    return block === undefined ? text : without(layout.lines, block).join('\n');
  }
  if (block !== undefined) {
    return spliced(layout.lines, block.from, block.to, [`Type: ${type}`]).join('\n');
  }
  const at = headPlace(layout);
  const put = ['', `Type: ${type}`];
  if ((layout.lines[at] ?? '').trim() !== '') put.push('');
  return spliced(layout.lines, at, at, put).join('\n');
}

/** Where a section's text stands among the lines of a source. */
interface Cut {
  /** The section's first line, and the line after its last. */
  from: number;
  to: number;
  /** The first line of the text. The lines before it, from the
   * section's first, stay as they are: the labels that stand above the
   * text, and in the Tests section the blank line under its heading. */
  lead: number;
  /** The labels that stand right under the title the text opens with:
   * their first line and the line after their last, with the blank line
   * that parts them from what follows. The two are one line where no
   * label stands there. */
  under: number;
  below: number;
  /** The line after the text's last. What stands from there on stays as
   * it is: the blank line that parts the text from it, the labels under
   * the text, the notice. */
  tail: number;
}

/**
 * Where a section's text stands. The text is the section's lines as
 * they are written, from the first that is text to the last: a label
 * that stands between two paragraphs of it is one of its lines, and
 * stays where its author wrote it. Three runs of lines are no part of
 * it: the labels above it, the labels right under its title, and what
 * stands under it.
 */
function cutOf(layout: Layout, scope: Scope): Cut | undefined {
  const { lines, apart } = layout;
  if (scope === 'tests' && layout.tests === undefined) return undefined;
  const from = scope === 'spec' ? 0 : (layout.tests ?? 0) + 1;
  const to = scope === 'spec' ? (layout.tests ?? lines.length) : lines.length;
  const text = (line: number): boolean => apart[line] === undefined && !blank(lines[line]);
  let first = from;
  while (first < to && !text(first)) first += 1;
  // The labels above the text, as far as the notice: they and the blank
  // line under them stay where they are.
  let lead = from;
  let label = -1;
  for (let line = from; line < first && apart[line] !== 'notice'; line += 1) {
    if (apart[line] === 'label') label = line;
  }
  if (label >= 0) {
    lead = label + 1;
    if (lead < first && blank(lines[lead])) lead += 1;
  } else if (scope === 'tests' && from < first && blank(lines[from])) {
    lead = from + 1;
  }
  if (first === to) return { from, to, lead, under: lead, below: lead, tail: lead };
  // The labels right under the title, with the blank line after them.
  const under = first + 1;
  let below = under;
  if (scope === 'spec' && layout.title === first) {
    let last = -1;
    let line = first + 1;
    for (; line < to && !text(line) && apart[line] !== 'notice'; line += 1) {
      if (apart[line] === 'label') last = line;
    }
    if (last >= 0) {
      below = last + 1;
      if (below < line && blank(lines[below])) below += 1;
    }
  }
  let last = to - 1;
  while (last > first && !text(last)) last -= 1;
  // Under the text: of the blank lines before what stands there, the
  // last is the one that parts the two, and stays with what it parts.
  const floor = Math.max(last + 1, below);
  let next = floor;
  while (next < to && apart[next] === undefined) next += 1;
  const tail = next > floor ? next - 1 : next;
  return { from, to, lead, under, below, tail };
}

/**
 * A section's own text: the agent's, with the title it opens with, or
 * the tests'. It is what the scan reads as the section's prose, as its
 * lines stand in the source; the labels above it, the ones right under
 * its title and what stands under it are the fields' and are left out.
 * Where labels stand under the title, one blank line stands in their
 * place, so a title and the paragraph after it read as they do in the
 * source.
 */
export function sectionText(text: string, scope: Scope): string {
  const layout = layoutOf(text);
  const cut = cutOf(layout, scope);
  if (cut === undefined) return '';
  return [
    ...layout.lines.slice(cut.lead, cut.under),
    ...(cut.below > cut.under ? [''] : []),
    ...layout.lines.slice(cut.below, cut.tail),
  ].join('\n');
}

function leadingBlanksOff(lines: string[]): string[] {
  let from = 0;
  while (from < lines.length && blank(lines[from])) from += 1;
  return lines.slice(from);
}

/**
 * A source with one section's text set, and every other line as it
 * was. The labels above the text stay above it and what stands under
 * it stays under it. The labels right under the title stay there while
 * the text opens with a title, and stand above the text once it opens
 * with none. A Tests section a source lacks is made by the first text
 * written for it, before the notice, and one that holds no label goes
 * with the last of its text.
 */
export function setSectionText(text: string, scope: Scope, written: string): string {
  const layout = layoutOf(text);
  const { lines } = layout;
  const typed = written.trim() === '' ? [] : written.split('\n');
  // A text ends with one line's end, which the split shows as a last empty line.
  const end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  const cut = cutOf(layout, scope);
  if (cut === undefined) {
    if (typed.length === 0) return text;
    const at = layout.license ?? end;
    const lead = at > 0 && !blank(lines[at - 1]) ? [''] : [];
    const tail = !blank(lines[at]) ? [''] : [];
    return spliced(lines, at, at, [...lead, '## Tests', '', ...typed, ...tail]).join('\n');
  }
  const held = lines.slice(cut.from, cut.to);
  const labels = held.some((_line, index) => layout.apart[cut.from + index] === 'label');
  if (scope === 'tests' && typed.length === 0 && !labels && layout.tests !== undefined) {
    // The section goes whole, as far as the notice, with the blank line
    // that parted it from what stood above where nothing follows it.
    let stop = cut.from;
    while (stop < end && layout.apart[stop] !== 'notice') stop += 1;
    const start =
      layout.tests > 0 && blank(lines[layout.tests - 1]) && blank(lines[stop])
        ? layout.tests - 1
        : layout.tests;
    return spliced(lines, start, stop, []).join('\n');
  }
  const above = lines.slice(cut.from, cut.lead);
  const under = lines.slice(cut.under, cut.below);
  let below = lines.slice(cut.tail, cut.to);
  const opens = typed.findIndex((line) => !blank(line));
  let middle: string[];
  if (under.length === 0) {
    middle = typed;
  } else if (opens >= 0 && isTitle(typed[opens])) {
    // The blank line under the title is the one that stands in the labels' place.
    const rest = typed.slice(opens + 1);
    middle = [...typed.slice(0, opens + 1), ...under, ...(blank(rest[0]) ? rest.slice(1) : rest)];
  } else {
    middle = [...leadingBlanksOff(under), ...typed];
  }
  // A text written where none stood is parted by a blank line from the
  // labels above it and from what stands under it; and where the last
  // of a text goes, one blank line parts what stood around it, not two.
  if (cut.lead === cut.tail && typed.length > 0) {
    if (above.length > 0 && !blank(above.at(-1))) middle = ['', ...middle];
    if (below.length > 0 && !blank(below[0])) middle = [...middle, ''];
  }
  if (typed.length === 0 && below.length > 0 && blank(below[0])) {
    const before = middle.at(-1) ?? above.at(-1);
    if (before === undefined || blank(before)) below = below.slice(1);
  }
  return spliced(lines, cut.from, cut.to, [...above, ...middle, ...below]).join('\n');
}

/** The lines of a text that are a label's own, from one: what the editor tints. */
export function labelLines(text: string): number[] {
  const out: number[] = [];
  const layout = layoutOf(text);
  for (const block of layout.blocks) {
    for (let line = block.from; line < block.to; line += 1) {
      if ((layout.lines[line] ?? '').trim() !== '') out.push(line + 1);
    }
  }
  return out;
}

/** What the scan reads of a source. */
export function scanSource(text: string): SpecLabels {
  return parseSpecLabels(text);
}

/** The entries a label holds in a text, as the scan reads them. */
export function labelEntries(text: string, scope: Scope, name: LabelName): string[] {
  const labels = scanSource(text);
  const section = scope === 'spec' ? labels.head : labels.tests;
  if (section === undefined) return [];
  const held = {
    Uses: section.uses,
    Implements: section.implements,
    Mocks: section.mocks,
    Copyright: section.copyright,
    License: section.license,
  };
  return held[name];
}

/** A text with one more entry on a label, every other line as it was;
 * the text itself where the label already holds the entry. */
export function withEntry(text: string, scope: Scope, name: LabelName, entry: string): string {
  const held = labelEntries(text, scope, name);
  return held.includes(entry) ? text : setLabel(text, scope, name, [...held, entry]);
}

/** Where an entry of a label leads: an agent's own page, or a page of the web. */
export type EntryLead = { agent: string } | { href: string };

const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

/**
 * Where an entry leads a reader who presses it. An agent this plane
 * runs leads to its own page, by its id alone, whatever version the
 * entry asks; an npm package to its page at npm, by its name alone,
 * whatever range the entry asks. A server, a document and a file lead
 * nowhere, and so does an agent the plane does not run: it has no page
 * here.
 */
export function entryLead(
  entry: string,
  runs: (agentId: string) => boolean,
): EntryLead | undefined {
  if (entry.startsWith('npm:')) {
    const asked = entry.slice(4).trim();
    const at = asked.indexOf('@', 1);
    const name = at < 0 ? asked : asked.slice(0, at);
    return NPM_NAME.test(name) ? { href: `https://www.npmjs.com/package/${name}` } : undefined;
  }
  if (/^(mcp|openapi|file):/.test(entry)) return undefined;
  const agentId = parsePackageRef(entry)?.name ?? entry;
  return runs(agentId) ? { agent: agentId } : undefined;
}

/** The kind a source states; a task when it states none. */
export function typeOf(labels: SpecLabels): string {
  return labels.type === undefined || labels.type === '' ? 'task' : labels.type;
}

/** A new agent's first text. */
export function newSource(title: string): string {
  return `# ${title}\n\n`;
}

/** A title made from an id's last part: `telegram-send` reads `Telegram Send`. */
export function titleFromId(agentId: string): string {
  const name = agentId.split('/').at(-1) ?? agentId;
  return name
    .split(/[-_]+/)
    .filter((word) => word !== '')
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
}

/** Whether an id is one an agent may take, by the platform's own rule
 * for an agent's path: lowercase words and digits, a single dash
 * between two of them, parts joined by `/`, the last part never
 * `tests`. */
export function validId(agentId: string): boolean {
  return AGENT_PATH_PATTERN.test(agentId);
}

/** Who holds an id: the plane's agents, and this browser's drafts. */
export interface IdHolders {
  agent: (agentId: string) => boolean;
  draft: (agentId: string) => boolean;
}

/** What keeps an id from a new agent's draft: it is no id an agent may
 * take, an agent of the plane stands under it, or a draft does. */
export type IdRefusal = 'invalid' | 'agent' | 'draft';

/** Why a new agent's draft cannot stand under an id; undefined where it can. */
export function idRefusal(agentId: string, held: IdHolders): IdRefusal | undefined {
  if (!validId(agentId)) return 'invalid';
  if (held.agent(agentId)) return 'agent';
  if (held.draft(agentId)) return 'draft';
  return undefined;
}

/**
 * What stands between each source of an import and a draft under its
 * id, in the list's order: the id's own refusal, or `twice` where an
 * earlier source of the same import that is still taken has the id; and
 * undefined where the source becomes a draft. It is the one reading of
 * an import, for what its list shows and for what it saves.
 */
export function importStandings(
  sources: readonly { id: string; ticked: boolean }[],
  held: IdHolders,
): (IdRefusal | 'twice' | undefined)[] {
  const taken = new Set<string>();
  return sources.map((source) => {
    const refusal = idRefusal(source.id, held);
    if (refusal !== undefined) return refusal;
    if (taken.has(source.id)) return 'twice';
    if (source.ticked) taken.add(source.id);
    return undefined;
  });
}

/** The lines two texts differ by, for the diff read before a deploy: each
 * line of the old text and the new, in order, with what happened to it. */
export function lineDiff(
  before: string,
  after: string,
): { kind: 'same' | 'gone' | 'new'; text: string }[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // The longest run of lines the two share, by the classic table.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      if (row === undefined) continue;
      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: { kind: 'same' | 'gone' | 'new'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      out.push({ kind: 'gone', text: a[i] ?? '' });
      i += 1;
    } else {
      out.push({ kind: 'new', text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: 'gone', text: a[i++] ?? '' });
  while (j < b.length) out.push({ kind: 'new', text: b[j++] ?? '' });
  return out;
}
