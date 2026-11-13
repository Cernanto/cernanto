// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  SKILL_FILES,
  SKILL_HOMES,
  SKILL_NAME,
  installSkill,
  skillSource,
  skillWords,
} from './skill.js';

// The skill the cli ships is the guide and the loop for a coding
// assistant: its SKILL.md is read by the assistants that read skills,
// so its frontmatter and its words are held here, and the verb lays it
// where Claude Code and Codex look.

test('the cli ships the skill: a SKILL.md named cernanto with a description, and the guide beside it', () => {
  const files = skillSource();
  const skill = files['SKILL.md'];
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  assert.ok(frontmatter !== null, 'SKILL.md opens with frontmatter');
  const fields: Record<string, string> = {};
  for (const line of (frontmatter[1] ?? '').split('\n')) {
    const [key, value] = line.split(/:\s(.*)/s);
    if (key !== undefined && key !== '') fields[key] = value ?? '';
  }
  assert.equal(fields['name'], SKILL_NAME);
  assert.ok((fields['description'] ?? '').length > 100, 'the description says when to use it');
  assert.ok((fields['description'] ?? '').length <= 1024, 'the description stays short');
  assert.equal(fields['license'], 'Apache-2.0');
  assert.match(skill, /Read `WRITING-AGENTS\.md`, beside this file/);
  assert.match(files['WRITING-AGENTS.md'], /^# Writing Cernanto agents/);
});

test('the skill is laid into both skills directories, refreshed when a file differs, and said current otherwise', () => {
  const root = mkdtempSync(join(tmpdir(), 'skill-'));
  const files = {
    'SKILL.md': '---\nname: cernanto\n---\nthe loop\n',
    'WRITING-AGENTS.md': '# guide\n',
  };
  const first = installSkill(files, root);
  assert.deepEqual(
    first.map((outcome) => [outcome.dir, outcome.state]),
    [
      ['.claude/skills/cernanto', 'installed'],
      ['.agents/skills/cernanto', 'installed'],
    ],
  );
  for (const home of SKILL_HOMES) {
    for (const name of SKILL_FILES) {
      assert.equal(readFileSync(join(root, home.dir, SKILL_NAME, name), 'utf8'), files[name]);
    }
  }
  assert.deepEqual(
    installSkill(files, root).map((outcome) => outcome.state),
    ['current', 'current'],
  );
  // An older skill under one directory is refreshed; the other stays current.
  writeFileSync(join(root, '.agents', 'skills', SKILL_NAME, 'SKILL.md'), 'an older loop\n');
  assert.deepEqual(
    installSkill(files, root).map((outcome) => outcome.state),
    ['current', 'refreshed'],
  );
  assert.equal(
    readFileSync(join(root, '.agents', 'skills', SKILL_NAME, 'SKILL.md'), 'utf8'),
    files['SKILL.md'],
  );
});

test('a skills directory that already exists for other skills keeps them', () => {
  const root = mkdtempSync(join(tmpdir(), 'skill-others-'));
  mkdirSync(join(root, '.claude', 'skills', 'deploy'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'deploy', 'SKILL.md'), 'theirs\n');
  installSkill({ 'SKILL.md': 'ours\n', 'WRITING-AGENTS.md': 'guide\n' }, root);
  assert.equal(
    readFileSync(join(root, '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8'),
    'theirs\n',
  );
  assert.equal(
    readFileSync(join(root, '.claude', 'skills', SKILL_NAME, 'SKILL.md'), 'utf8'),
    'ours\n',
  );
});

test('the words name the root, one line per directory, and what to do next after an install', () => {
  const outcomes = installSkill(
    { 'SKILL.md': 'x\n', 'WRITING-AGENTS.md': 'y\n' },
    mkdtempSync(join(tmpdir(), 'skill-words-')),
  );
  const said = skillWords('/home/acme', outcomes, false);
  assert.match(said, /^the cernanto skill for coding assistants, in the workspace \/home\/acme:\n/);
  assert.match(said, /\n {2}\.claude\/skills\/cernanto {2}installed {2}Claude Code\n/);
  assert.match(
    said,
    /\n {2}\.agents\/skills\/cernanto {2}installed {2}Codex, Cursor, Gemini CLI and Copilot\n/,
  );
  assert.match(
    said,
    /\nask your assistant for an agent in a sentence; it reads the skill on its own\n$/,
  );
  const current = skillWords(
    '/home/me',
    outcomes.map((outcome) => ({ ...outcome, state: 'current' as const })),
    true,
  );
  assert.match(current, /in your home folder, \/home\/me, for every workspace:\n/);
  assert.doesNotMatch(current, /ask your assistant/);
});
