// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import type { Command } from 'commander';

import { agentsRootOf } from './deploy/landing.js';
import { fail } from './output.js';
import { treeRelease } from './release.js';

// The skill: the author's guide and the loop a coding assistant runs,
// laid where the assistants read skills. A skill is a folder with a
// SKILL.md the assistant loads when the task matches its description,
// and the files beside it, which it reads when the skill says to. The
// cli ships the folder under skills/cernanto: SKILL.md is the loop and
// the rules, and the guide beside it is a copy of docs/WRITING-AGENTS.md
// the release packer makes, so there is one guide for the person and
// the assistant. Run from the tree, the cli reads the guide from docs/.
// The verb writes the folder into the workspace root, or under the
// home folder for every workspace on the machine, and a second run
// refreshes it to the cli's own files or says it is current.

/** The skill's name: its folder under every skills directory. */
export const SKILL_NAME = 'cernanto';

/** The files the skill holds, SKILL.md first. */
export const SKILL_FILES = ['SKILL.md', 'WRITING-AGENTS.md'] as const;

export type SkillFile = (typeof SKILL_FILES)[number];

/** Where the assistants read a workspace's skills, and who reads each. */
export const SKILL_HOMES: readonly { dir: string; readers: string }[] = [
  { dir: join('.claude', 'skills'), readers: 'Claude Code' },
  { dir: join('.agents', 'skills'), readers: 'Codex, Cursor, Gemini CLI and Copilot' },
];

/** The skill folder the cli ships, beside its package. */
function shippedSkill(): string {
  return resolve(import.meta.dirname, '..', 'skills', SKILL_NAME);
}

/** The skill's files as the cli carries them: SKILL.md from the
 * shipped folder, and the guide from beside it in an installed cli, or
 * from the tree's docs when the cli runs from its compile there. */
export function skillSource(shipped: string = shippedSkill()): Record<SkillFile, string> {
  const skill = join(shipped, 'SKILL.md');
  if (!existsSync(skill)) throw new Error(`the cli ships no skill: ${skill} is missing`);
  const beside = join(shipped, 'WRITING-AGENTS.md');
  const tree = treeRelease();
  const guide = existsSync(beside)
    ? beside
    : tree === undefined
      ? undefined
      : join(tree, 'docs', 'WRITING-AGENTS.md');
  if (guide === undefined || !existsSync(guide)) {
    throw new Error(`the cli's skill is incomplete: no WRITING-AGENTS.md beside ${skill}`);
  }
  return {
    'SKILL.md': readFileSync(skill, 'utf8'),
    'WRITING-AGENTS.md': readFileSync(guide, 'utf8'),
  };
}

/** What the verb did in one skills directory. */
export interface SkillOutcome {
  /** The skill folder, relative to the root, spelled with `/`. */
  dir: string;
  readers: string;
  state: 'installed' | 'refreshed' | 'current';
}

/** Lays the skill into every skills directory under a root: a file is
 * written when it is absent or differs, so a run after an install
 * says current, and a run under a newer cli refreshes. */
export function installSkill(
  files: Record<SkillFile, string>,
  root: string,
  homes: readonly { dir: string; readers: string }[] = SKILL_HOMES,
): SkillOutcome[] {
  return homes.map(({ dir, readers }) => {
    const target = join(root, dir, SKILL_NAME);
    const existed = existsSync(join(target, SKILL_FILES[0]));
    mkdirSync(target, { recursive: true });
    let changed = false;
    for (const name of SKILL_FILES) {
      const path = join(target, name);
      if (existsSync(path) && readFileSync(path, 'utf8') === files[name]) continue;
      writeFileSync(path, files[name]);
      changed = true;
    }
    return {
      dir: join(dir, SKILL_NAME).split(sep).join('/'),
      readers,
      state: !existed ? 'installed' : changed ? 'refreshed' : 'current',
    };
  });
}

/** The verb's words: where the skill went, one line per directory,
 * and what to do next after an install. */
export function skillWords(root: string, outcomes: SkillOutcome[], global: boolean): string {
  const where = global ? `your home folder, ${root}, for every workspace` : `the workspace ${root}`;
  const lines = [`the ${SKILL_NAME} skill for coding assistants, in ${where}:`];
  const width = Math.max(...outcomes.map((outcome) => outcome.dir.length));
  for (const outcome of outcomes) {
    lines.push(`  ${outcome.dir.padEnd(width)}  ${outcome.state.padEnd(9)}  ${outcome.readers}`);
  }
  if (outcomes.some((outcome) => outcome.state !== 'current')) {
    lines.push('ask your assistant for an agent in a sentence; it reads the skill on its own');
  }
  return `${lines.join('\n')}\n`;
}

/** `cernanto skill [--global]`: the author's skill for a coding
 * assistant, into this workspace or the home folder. */
export function registerSkill(program: Command): void {
  program
    .command('skill')
    .option('--global', 'into your home folder, for every workspace on this machine')
    .description("install the author's skill for your coding assistant into this workspace")
    .action((options: { global?: boolean }) => {
      try {
        const global = options.global === true;
        const root = global ? homedir() : agentsRootOf();
        process.stdout.write(skillWords(root, installSkill(skillSource(), root), global));
      } catch (error) {
        fail(error);
      }
    });
}
