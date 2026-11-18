// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { PackageHarness } from '@cernanto/package-format';

// What compiled an artifact, read the same way everywhere it is
// written: the artifact's provenance.json (the compile writes it), the
// package manifest's provenance (pack copies it by name) and the
// fleet row's `built` (the compile and the install stamp it). One
// reader and one line of words, so every card reads a compile the same
// way.

/** The coder (the vendor agent, its CLI version, the model that
 * served, the effort asked), the cernanto release and the doctrine
 * version behind an artifact. Every part is known only when it was
 * recorded. */
export interface BuiltBy {
  harness?: PackageHarness;
  cernanto?: string;
  doctrine?: string;
  /** The digest of the previous compile this one descends from, when
   * the code was amended, re-gated or refreshed rather than written
   * from the specification. */
  amendedFrom?: string;
  /** How many amendments separate this compile from its last full
   * compile; zero, or absent, for a compile written from the spec. */
  amendDepth?: number;
}

function stringAt(value: Record<string, unknown>, key: string): string | undefined {
  const entry = value[key];
  return typeof entry === 'string' && entry !== '' ? entry : undefined;
}

/** The known fields of a `built` record out of untyped data, each read
 * by its name and kept when it has the expected type (a
 * provenance.json's other facts stay where they are). The doctrine
 * reads from `doctrine` or, as provenance.json spells it,
 * `doctrineVersion`. Undefined when nothing is recorded. */
export function readBuiltBy(value: unknown): BuiltBy | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const compiled: BuiltBy = {};
  const harness = record['harness'];
  if (typeof harness === 'object' && harness !== null) {
    const fields = harness as Record<string, unknown>;
    const name = stringAt(fields, 'name');
    if (name !== undefined) {
      const cli = stringAt(fields, 'cli');
      const model = stringAt(fields, 'model');
      const effort = stringAt(fields, 'effort');
      compiled.harness = {
        name,
        ...(cli === undefined ? {} : { cli }),
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
      };
    }
  }
  const cernanto = stringAt(record, 'cernanto');
  if (cernanto !== undefined) compiled.cernanto = cernanto;
  const doctrine = stringAt(record, 'doctrine') ?? stringAt(record, 'doctrineVersion');
  if (doctrine !== undefined) compiled.doctrine = doctrine;
  const amendedFrom = stringAt(record, 'amendedFrom');
  if (amendedFrom !== undefined) compiled.amendedFrom = amendedFrom;
  const depth = record['amendDepth'];
  if (typeof depth === 'number' && Number.isInteger(depth) && depth >= 0)
    compiled.amendDepth = depth;
  return Object.keys(compiled).length === 0 ? undefined : compiled;
}

/** One line of plain words for the operator: `cernanto/harness/claude-code
 * 2.1.250, model claude-opus-5 at medium effort, cernanto 0.4.0,
 * doctrine 31.0.0`. Each part reads only when it was recorded;
 * nothing recorded reads as undefined, so a caller prints no line. */
export function builtByText(compiled: BuiltBy): string | undefined {
  const parts: string[] = [];
  const harness = compiled.harness;
  if (harness !== undefined) {
    parts.push(harness.cli === undefined ? harness.name : `${harness.name} ${harness.cli}`);
    if (harness.model !== undefined) {
      parts.push(
        harness.effort === undefined
          ? `model ${harness.model}`
          : `model ${harness.model} at ${harness.effort} effort`,
      );
    } else if (harness.effort !== undefined) {
      parts.push(`${harness.effort} effort`);
    }
  }
  if (compiled.cernanto !== undefined) parts.push(`cernanto ${compiled.cernanto}`);
  if (compiled.doctrine !== undefined) parts.push(`doctrine ${compiled.doctrine}`);
  if (compiled.amendDepth !== undefined && compiled.amendDepth > 0) {
    if (compiled.amendedFrom !== undefined)
      parts.push(`amended from ${compiled.amendedFrom.replace(/^sha256:/, '').slice(0, 10)}`);
    parts.push(
      `${compiled.amendDepth} ${compiled.amendDepth === 1 ? 'amendment' : 'amendments'} since the last full compile`,
    );
  }
  return parts.length === 0 ? undefined : parts.join(', ');
}
