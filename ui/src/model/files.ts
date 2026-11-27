// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { labelEntries, scanSource, setLabel } from './source.js';
import type { LabelName, Scope } from './source.js';

// THE FILES A SOURCE NAMES. A source grants its code a file or a folder
// (`file:prompts/judge.md`, `file:notes/`), may implement a document
// kept beside it (`openapi:orders/openapi.yaml`), and grants its tests
// files of their own. A file is no line of the source: it is bytes that
// travel with it. A compile takes them from what a deploy uploads, each
// at the place the source names it from, and the package the compile
// answers carries them. So a browser, which has no folder, sends with
// every deploy each file the source names: one chosen in it, which
// waits in the browser until then, or the one the agent's package
// already carries, read back from the plane.
//
// The rules of where a file stands are the compiler's and the cli's,
// read here the same way: a path is taken from the folder the source
// lies in, or from the workspace's root where it opens with a slash; a
// package carries a file under its own name and a folder's files under
// the folder's name, the code's under `files/` and the tests' under
// `tests/assets/`.

/** A file larger than this is refused by the compile, and by the screen before it. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** What a deploy sends, all told, is held to what the cli sends of a workspace. */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

const FILE_GRANT_PATH = /^\/?(?:[^/\\\0]+\/)*[^/\\\0]*$/;

/** Whether a written path is one a source may name a file by. */
export function isFileGrantPath(path: string): boolean {
  return FILE_GRANT_PATH.test(path) && path.replace(/\/+$/, '') !== '';
}

/** A line of a source that names a file or a folder. */
export interface NamedFile {
  /** The entry as the source writes it: `file:prompts/judge.md`. */
  entry: string;
  /** The path as written, after the kind's word. */
  written: string;
  scope: Scope;
  label: 'Uses' | 'Implements';
  /** Where it stands in a workspace, from its root; none where the path leaves the workspace. */
  place: string | undefined;
  /** The name a package carries it under: the last part of its place. */
  name: string;
}

/**
 * Where a written path stands in a workspace, from its root: taken from
 * the folder the agent's source lies in, or from the root where it
 * opens with a slash. None where the path leaves the workspace or names
 * nothing.
 */
export function placeOf(agentId: string, written: string): string | undefined {
  const parts = written.startsWith('/') ? [] : agentId.split('/').slice(0, -1);
  for (const part of written.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length === 0 ? undefined : parts.join('/');
}

/** The entry a path is named by under a label: a file, or the document an agent implements. */
export function entryOf(label: 'Uses' | 'Implements', written: string): string {
  return `${label === 'Implements' ? 'openapi' : 'file'}:${written}`;
}

/** The lines of a source that name a file or a folder, in the source's order. */
export function namedFiles(text: string, agentId: string): NamedFile[] {
  const labels = scanSource(text);
  const out: NamedFile[] = [];
  const take = (entry: string, scope: Scope, label: 'Uses' | 'Implements'): void => {
    const written = entry.slice(entry.indexOf(':') + 1);
    if (!isFileGrantPath(written)) return;
    const place = placeOf(agentId, written);
    const name = (place ?? written.replace(/\/+$/, '')).split('/').at(-1) ?? '';
    out.push({ entry, written, scope, label, place, name });
  };
  for (const entry of labels.head.uses) if (entry.startsWith('file:')) take(entry, 'spec', 'Uses');
  // An agent implements one document; one that is no address is a file beside the source.
  const document = labels.head.implements.find((entry) => entry.startsWith('openapi:'));
  if (document !== undefined) take(document, 'spec', 'Implements');
  for (const entry of labels.tests?.uses ?? []) {
    if (entry.startsWith('file:')) take(entry, 'tests', 'Uses');
  }
  return out;
}

/** What a package says it holds: each file's weight and its hash. */
export type PackageRecord = Record<string, { size: number; sha256: string }>;

/** A file a package carries for a line of its source. */
export interface CarriedFile {
  /** Its name in the package: `files/reply.md`. */
  inPackage: string;
  /** Its path under the folder the line names; empty for the file the line names itself. */
  rel: string;
  size: number;
  sha256: string;
}

/** The files a package carries for a line of a source: the file of the
 * line's own name, or every file under a folder of that name. */
export function carriedOf(named: NamedFile, record: PackageRecord | undefined): CarriedFile[] {
  const folder = named.scope === 'tests' ? 'tests/assets/' : 'files/';
  const out: CarriedFile[] = [];
  for (const [path, entry] of Object.entries(record ?? {})) {
    if (!path.startsWith(folder)) continue;
    const under = path.slice(folder.length);
    if (under === named.name) out.push({ inPackage: path, rel: '', ...entry });
    else if (under.startsWith(`${named.name}/`)) {
      out.push({ inPackage: path, rel: under.slice(named.name.length + 1), ...entry });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** A file chosen in this browser, which waits for the next deploy. Its
 * bytes are kept by the browser under its key; this is what a draft
 * holds of it. */
export interface WaitingFile {
  /** The key its bytes are kept under. */
  key: string;
  scope: Scope;
  /** The path of the line that names it, as written. */
  written: string;
  /** Its path under the folder the line names; empty for the file the line names itself. */
  rel: string;
  /** The file's own name, as it was chosen. */
  name: string;
  size: number;
  /** Its kind, as the browser read it. */
  type: string;
}

/** One file of a line, and where its bytes are. */
export interface StandingFile {
  /** Where a deploy sends it: its place in a workspace. */
  place: string;
  rel: string;
  name: string;
  size: number;
  from: { waiting: string } | { carried: string };
}

/**
 * How a line that names files stands: with files chosen in this browser
 * that wait for a deploy, with the files the agent's package carries,
 * with none at all, or naming a place outside the workspace.
 */
export interface FileStanding {
  named: NamedFile;
  standing: 'waiting' | 'carried' | 'missing' | 'outside';
  files: StandingFile[];
}

/**
 * How every line of a source that names files stands. Files chosen in
 * this browser for a line are the line's files, whole: a folder chosen
 * again is the folder as it was chosen. A line with none chosen has the
 * files the package carries under its name.
 */
export function fileStandings(
  text: string,
  agentId: string,
  waiting: readonly WaitingFile[],
  record: PackageRecord | undefined,
): FileStanding[] {
  return namedFiles(text, agentId).map((named): FileStanding => {
    const { place } = named;
    if (place === undefined) return { named, standing: 'outside', files: [] };
    const at = (rel: string): string => (rel === '' ? place : `${place}/${rel}`);
    const chosen = waiting.filter(
      (file) => file.scope === named.scope && file.written === named.written,
    );
    if (chosen.length > 0) {
      return {
        named,
        standing: 'waiting',
        files: chosen.map((file) => ({
          place: at(file.rel),
          rel: file.rel,
          name: file.rel === '' ? named.name : (file.rel.split('/').at(-1) ?? file.name),
          size: file.size,
          from: { waiting: file.key },
        })),
      };
    }
    const carried = carriedOf(named, record);
    return {
      named,
      standing: carried.length > 0 ? 'carried' : 'missing',
      files: carried.map((file) => ({
        place: at(file.rel),
        rel: file.rel,
        name: file.rel === '' ? named.name : (file.rel.split('/').at(-1) ?? named.name),
        size: file.size,
        from: { carried: file.inPackage },
      })),
    };
  });
}

/** Why a deploy of a source waits for its files, in words; none where every named file is at hand. */
export function filesTrouble(standings: readonly FileStanding[]): string | undefined {
  const outside = standings.find((one) => one.standing === 'outside');
  if (outside !== undefined) {
    return `${outside.named.entry} names a place outside the workspace: Deploy waits.`;
  }
  const missing = standings.filter((one) => one.standing === 'missing');
  if (missing.length === 0) return undefined;
  const first = missing[0]?.named.entry ?? '';
  return missing.length === 1
    ? `${first} has no file behind it: choose its file, or remove the entry. Deploy waits.`
    : `${first} and ${String(missing.length - 1)} more have no file behind them: choose their files, or remove the entries. Deploy waits.`;
}

/** The agent's own folder, named for it: the usual place of its files. */
function ownFolder(agentId: string): string {
  return agentId.split('/').at(-1) ?? agentId;
}

/** The path a chosen file is offered under: in the agent's own folder, by its name. */
export function offeredPath(agentId: string, name: string, folder = false): string {
  return `${ownFolder(agentId)}/${name}${folder ? '/' : ''}`;
}

/**
 * Why a file's or a folder's name cannot be named on a label's line;
 * none for one that can. A label's entries stand on one line, a comma
 * between two, so a name with a comma would read as two entries.
 */
export function nameTrouble(name: string): string | undefined {
  if (name.trim() === '' || name !== name.trim()) return `"${name}" is no name for an entry.`;
  if (/[,\\\0\n]/.test(name)) {
    return `"${name}" holds a character a label's line cannot carry: give the file another name.`;
  }
  return undefined;
}

/** A source with a line's entry written another way: the same line, the same place among its entries. */
export function withEntryAs(
  text: string,
  scope: Scope,
  name: LabelName,
  from: string,
  to: string,
): string {
  const held = labelEntries(text, scope, name);
  if (!held.includes(from) || held.includes(to)) return text;
  return setLabel(
    text,
    scope,
    name,
    held.map((entry) => (entry === from ? to : entry)),
  );
}

/** A source without one entry of a label. */
export function withoutEntry(text: string, scope: Scope, name: LabelName, entry: string): string {
  const held = labelEntries(text, scope, name);
  return held.includes(entry)
    ? setLabel(
        text,
        scope,
        name,
        held.filter((one) => one !== entry),
      )
    : text;
}

/** A file as it is shown: text to read, a picture, or neither. */
export type FileLook = 'text' | 'picture' | 'other';

/** How a file is shown, by its name: the kinds a source grants its code as text, and pictures. */
export function lookOf(name: string): FileLook {
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(name)) return 'picture';
  if (
    /\.(md|markdown|txt|text|json|jsonl|ya?ml|toml|ini|env|csv|tsv|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|sql|sh|py|rb|go|rs|java|kt|c|h|cpp|pem|crt|key|pub|log|conf|cfg|properties|graphql|proto|svg)$/i.test(
      name,
    ) ||
    !name.includes('.')
  ) {
    return 'text';
  }
  return 'other';
}

/** Whether bytes read as text: no byte a text never holds among its first. */
export function readsAsText(bytes: Uint8Array): boolean {
  const most = Math.min(bytes.length, 8192);
  for (let at = 0; at < most; at += 1) {
    // Below the tab stand the bytes a text never holds, the zero among them.
    if ((bytes[at] ?? 0) < 9) return false;
  }
  return true;
}
