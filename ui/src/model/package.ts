// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useMemo } from 'react';

import { useAgents, usePackageFile } from '../api/queries.js';
import type { CompileAgentReport, GenerationRow } from '../gateway/types.gen.js';
import type { FleetAgent } from './fleet.js';

// A package as the screens read it: its own record of what it holds,
// read from its manifest, and one file at a time after that. The
// package is never brought whole to show one file.

/** The file of a package that names the rest. */
export const MANIFEST = 'cernanto.json';
/** The source a package was compiled from. */
export const SOURCE = 'agent.cern.md';
/** The contract's declarations. */
export const CONTRACT = 'contract.d.ts';

/** What a package's manifest says, as far as the screens read it. */
export interface PackageManifest {
  name?: string;
  version?: string;
  type?: string;
  description?: string;
  license?: string;
  copyright?: string[];
  handlers?: string[];
  /** The package's own record of what it holds: a path to its weight. */
  record?: Record<string, { size: number; sha256: string }>;
  uses?: Record<string, { type?: string; contractHash?: string }>;
  npm?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  openapi?: Record<string, unknown>;
  files?: unknown[];
  provenance?: {
    attempts?: number;
    triageCount?: number;
    contract?: string;
    amendedFrom?: string;
    amendDepth?: number;
    harness?: { name?: string; cli?: string; model?: string; effort?: string };
    verified?: { at: string };
  };
}

/** A package's manifest, once it was read. */
export function usePackage(digest: string | undefined): {
  manifest: PackageManifest | undefined;
  loading: boolean;
  error: unknown;
} {
  const file = usePackageFile(digest, digest === undefined ? undefined : MANIFEST);
  const manifest = useMemo(() => {
    if (file.data === undefined) return undefined;
    try {
      return JSON.parse(file.data) as PackageManifest;
    } catch {
      return undefined;
    }
  }, [file.data]);
  return { manifest, loading: file.isPending && digest !== undefined, error: file.error };
}

/** The generations of an agent the plane runs, the newest first. */
export function useGenerations(agentId: string): GenerationRow[] {
  const shipped = useAgents();
  return useMemo(
    () =>
      (shipped.data?.generations ?? [])
        .filter((entry) => entry.agentId === agentId)
        .sort((a, b) => b.gen - a.gen),
    [shipped.data, agentId],
  );
}

/**
 * The package a screen reads of an agent. With no generation asked for,
 * the one the agent runs: its active generation's, or the one its row
 * carries for an agent that runs inside others. With a generation asked
 * for, that generation's own and no other: undefined where the plane
 * lists none under that number, so what one generation ran is never
 * shown as another's.
 */
export function packageOf(
  agent: Pick<FleetAgent, 'row'>,
  generations: GenerationRow[],
  gen?: number,
): string | undefined {
  if (gen !== undefined) return generations.find((entry) => entry.gen === gen)?.package;
  const chosen = generations.find((entry) => entry.status === 'active') ?? generations[0];
  return chosen?.package ?? agent.row?.artifact;
}

/**
 * Whether the generation an address names is gone: the plane's
 * generations were read, and none of the agent's carries that number. A
 * generation leaves when its agent is deployed again, and a link to
 * what it ran outlives it.
 */
export function useGenerationGone(agentId: string, gen: number | undefined): boolean {
  const shipped = useAgents();
  if (gen === undefined || shipped.data === undefined) return false;
  return !shipped.data.generations.some((entry) => entry.agentId === agentId && entry.gen === gen);
}

/** The files of a package under a folder, the entry module first. */
export function filesUnder(manifest: PackageManifest | undefined, folder: string): string[] {
  const names = Object.keys(manifest?.record ?? {}).filter((name) => name.startsWith(folder));
  const entry = `${folder}index.ts`;
  return names.sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)));
}

/** The file of a list that an address asks for: the file it names, the
 * first file of a folder it names by its closing `/`, and with neither
 * the list's first. */
export function fileAsked(files: string[], asked: string | undefined): string | undefined {
  if (asked !== undefined) {
    if (files.includes(asked)) return asked;
    if (asked.endsWith('/')) {
      const first = files.find((name) => name.startsWith(asked));
      if (first !== undefined) return first;
    }
  }
  return files[0];
}

/** The coding assistant by the name a reader knows it under. */
export function assistantName(harness: string | undefined): string {
  const last = harness?.split('/').at(-1) ?? '';
  if (last === 'claude-code') return 'Claude Code';
  if (last === 'codex') return 'Codex';
  if (last === 'fake') return 'the rehearsal assistant';
  return last === '' ? 'a coding assistant' : last;
}

/** What the UI says of code that was modified: how many times a deploy
 * after a change of the source had the coding assistant change the code
 * that stood, since the code was last written whole. Of code no deploy
 * modified it says nothing, as the cli says nothing of it. */
export function codeWord(modified: number): string | undefined {
  if (modified <= 0) return undefined;
  const times = modified === 1 ? 'once' : modified === 2 ? 'twice' : `${String(modified)} times`;
  return `modified ${times} since the last full compile`;
}

/** What it is that code was modified, and by whom, for a reader who
 * points at the words. */
export const MODIFIED_WORDS =
  'Each time the source changed, the coding assistant modified the existing code instead of writing it again. "Write the code again from the source", among the ways to deploy, is a full compile.';

/**
 * How a compile says the code of an agent came to be, in a reader's
 * words and never in the compiler's own: written whole from the source,
 * modified where it stood, or kept. A compile that only planned says
 * nothing of the code.
 */
export function codeCameWords(code: NonNullable<CompileAgentReport['code']>): string | undefined {
  switch (code) {
    case 'fresh':
      return 'the code written from the source';
    case 'amended':
      return 'the code modified';
    case 'regated':
      return 'the code kept and checked again';
    case 'refreshed':
      return 'the code kept';
    case 'planned':
      return undefined;
  }
}

/** A weight in a few letters. */
export function weightWord(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
