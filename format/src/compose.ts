// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { PACKAGE_FORMAT, PACKAGE_TARGET, sha256Hex } from './package.js';
import type { PackageManifest, PackageManifestDraft } from './package.js';
import type { AgentType } from './package.js';

// Composing a format 4 manifest from a compile's facts: what the author
// wrote on the spec, what the compile chose, what it measured and who ran
// it. The record and the content digest are the writer's.

export interface ComposeInput {
  name: string;
  version: string;
  type: AgentType;
  /** The spec as compiled, verbatim. */
  spec: string;
  /** The exported surface; absent for a worker. */
  contract?: string;
  handlers?: string[];
  uses?: PackageManifest['uses'];
  implements?: PackageManifest['implements'];
  contractCompatibleWith?: string[];
  npm?: PackageManifest['npm'];
  openapi?: PackageManifest['openapi'];
  mcp?: PackageManifest['mcp'];
  /** The `file:` grants as written. */
  files?: string[];
  tests?: PackageManifest['tests'];
  license?: string;
  copyright?: string[];
  publisher?: string;
  provenance: PackageManifest['provenance'];
}

const LABEL_LINE = /^(Uses|Implements|Copyright|License|Implementation|Type)\s*:/i;

/**
 * One line for a registry card, read off the spec: its title (the
 * first heading) and the first sentence of its prose. Display only.
 */
export function describeSpec(spec: string): string | undefined {
  const lines = spec.split(/\r?\n/);
  let title: string | undefined;
  const prose: string[] = [];
  let inGrantList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      if (prose.length > 0) break;
      inGrantList = false;
      continue;
    }
    if (line.startsWith('#')) {
      if (title === undefined) title = line.replace(/^#+\s*/, '').trim();
      else if (prose.length > 0) break;
      continue;
    }
    if (LABEL_LINE.test(line)) {
      inGrantList = /:\s*$/.test(line);
      continue;
    }
    if (inGrantList && /^[-*]\s/.test(line)) continue;
    inGrantList = false;
    prose.push(line);
  }
  const paragraph = prose.join(' ');
  const sentenceEnd = paragraph.search(/[.!?](\s|$)/);
  const sentence = sentenceEnd === -1 ? paragraph : paragraph.slice(0, sentenceEnd + 1);
  const parts = [title, sentence.trim()].filter((part) => part !== undefined && part !== '');
  if (parts.length === 0) return undefined;
  const text = parts.join(parts.length === 2 && !/[.!?]$/.test(title ?? '') ? '. ' : ' ');
  return text.length > 240 ? `${text.slice(0, 239).trimEnd()}...` : text;
}

/** Composes the manifest a compile writes, before the writer adds the
 * record and the content digest. */
export function composePackageManifest(input: ComposeInput): PackageManifestDraft {
  const description = describeSpec(input.spec);
  const implementsSorted =
    input.implements === undefined || input.implements.length === 0
      ? undefined
      : [...input.implements].sort((a, b) => a.id.localeCompare(b.id));
  return {
    packageFormat: PACKAGE_FORMAT,
    name: input.name,
    version: input.version,
    type: input.type,
    target: { ...PACKAGE_TARGET },
    ...(description === undefined ? {} : { description }),
    ...(input.license === undefined ? {} : { license: input.license }),
    ...(input.copyright === undefined || input.copyright.length === 0
      ? {}
      : { copyright: [...input.copyright] }),
    ...(input.publisher === undefined ? {} : { publisher: input.publisher }),
    specSha: sha256Hex(input.spec),
    ...(input.contract === undefined ? {} : { contractHash: sha256Hex(input.contract) }),
    ...(input.contractCompatibleWith === undefined || input.contractCompatibleWith.length === 0
      ? {}
      : { contractCompatibleWith: [...input.contractCompatibleWith] }),
    handlers: [...(input.handlers ?? [])],
    uses: Object.fromEntries(
      Object.entries(input.uses ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ),
    ...(implementsSorted === undefined ? {} : { implements: implementsSorted }),
    npm: Object.fromEntries(Object.entries(input.npm ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    openapi: { ...(input.openapi ?? {}) },
    mcp: { ...(input.mcp ?? {}) },
    files: [...(input.files ?? [])].sort(),
    ...(input.tests === undefined ? {} : { tests: input.tests }),
    provenance: input.provenance,
  };
}
