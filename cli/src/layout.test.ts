// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { Command } from 'commander';

import { registerAuth } from './auth.js';
import { registerAgent } from './agent.js';
import { registerCalls } from './calls.js';
import { registerCancel } from './cancel.js';
import { registerCode } from './code.js';
import { registerCompletion } from './completion.js';
import { registerConfig } from './config.js';
import { registerContext } from './context.js';
import { registerContract } from './contract.js';
import { registerCompile } from './deploy/compile.js';
import { registerBareFileForm, registerDeploy } from './deploy/deploy.js';
import { registerDev } from './dev.js';
import { registerInvoke } from './invoke.js';
import { registerLogin } from './login.js';
import { registerRegistry } from './registry.js';
import { registerSkill } from './skill.js';
import { registerTests } from './tests.js';
import { registerToken } from './token.js';
import { registerLs } from './ls.js';
import { registerTrace } from './trace.js';

// The cli's source layout: one module per verb, named as the verb, its
// golden test beside it; main.ts holds the process and program.ts the
// registrations. This proof registers each module alone on an empty
// program and holds what it registers to the table, and checks the test
// file sits beside every verb module.

const SRC = dirname(fileURLToPath(import.meta.url));

/** The layout's table: the module, what it registers (leaf verbs), and
 * how it registers (the arguments its register function takes). */
interface Module {
  file: string;
  verbs: string[];
  register: (program: Command) => void;
}

const LAYOUT: Module[] = [
  {
    file: 'dev.ts',
    verbs: ['dev'],
    register: (p) => {
      registerDev(p);
    },
  },
  {
    file: 'login.ts',
    verbs: ['login'],
    register: (p) => {
      registerLogin(p);
    },
  },
  {
    file: 'context.ts',
    verbs: ['context'],
    register: (p) => {
      registerContext(p);
    },
  },
  {
    file: 'completion.ts',
    verbs: ['completion'],
    register: (p) => {
      registerCompletion(p);
    },
  },
  {
    file: 'config.ts',
    verbs: ['config'],
    register: (p) => {
      registerConfig(p);
    },
  },
  {
    file: 'token.ts',
    verbs: ['token create', 'token list', 'token revoke'],
    register: (p) => {
      registerToken(p);
    },
  },
  {
    file: 'deploy/compile.ts',
    verbs: ['compile'],
    register: (p) => {
      registerCompile(p);
    },
  },
  {
    file: 'deploy/deploy.ts',
    verbs: ['deploy', 'file'],
    register: (p) => {
      registerDeploy(p);
      registerBareFileForm(p, () => {
        throw new Error('unreachable');
      });
    },
  },
  {
    file: 'contract.ts',
    verbs: ['contract'],
    register: (p) => {
      registerContract(p);
    },
  },
  {
    file: 'code.ts',
    verbs: ['code'],
    register: (p) => {
      registerCode(p);
    },
  },
  {
    file: 'tests.ts',
    verbs: ['tests'],
    register: (p) => {
      registerTests(p);
    },
  },
  {
    file: 'ls.ts',
    verbs: ['ls'],
    register: (p) => {
      registerLs(p);
    },
  },
  {
    file: 'calls.ts',
    verbs: ['calls'],
    register: (p) => {
      registerCalls(p);
    },
  },
  {
    file: 'invoke.ts',
    verbs: ['call'],
    register: (p) => {
      registerInvoke(p);
    },
  },
  {
    file: 'trace.ts',
    verbs: ['trace'],
    register: (p) => {
      registerTrace(p);
    },
  },
  {
    file: 'cancel.ts',
    verbs: ['cancel'],
    register: (p) => {
      registerCancel(p);
    },
  },
  {
    file: 'agent.ts',
    verbs: ['delete'],
    register: (p) => {
      registerAgent(p);
    },
  },
  {
    file: 'skill.ts',
    verbs: ['skill'],
    register: (p) => {
      registerSkill(p);
    },
  },
  {
    file: 'auth.ts',
    verbs: ['auth list', 'auth login', 'auth logout'],
    register: (p) => {
      registerAuth(p);
    },
  },
  {
    file: 'registry.ts',
    verbs: [
      'registry login',
      'registry logout',
      'registry whoami',
      'registry publish',
      'registry search',
      'registry yank',
      'registry deprecate',
      'registry token create',
      'registry token list',
      'registry token revoke',
      'registry namespace claim',
      'registry namespace list',
      'registry namespace add',
      'registry namespace remove',
    ],
    register: (p) => {
      registerRegistry(p);
    },
  },
];

function leafPaths(command: Command, path: string[]): string[] {
  const here = [...path, command.name()];
  if (command.commands.length === 0) return [here.join(' ')];
  return command.commands.flatMap((child) => leafPaths(child, here));
}

/** The verbs a register function adds to an empty program. */
function registered(module: Module): string[] {
  const program = new Command('cernanto');
  module.register(program);
  return leafPaths(program, [])
    .map((leaf) => leaf.replace(/^cernanto ?/, ''))
    .sort();
}

test('each module registers exactly the verbs the table assigns it', () => {
  for (const module of LAYOUT) {
    assert.deepEqual(registered(module), [...module.verbs].sort(), module.file);
  }
});

test('every verb module has its golden test beside it', () => {
  for (const module of LAYOUT) {
    const testFile = join(SRC, module.file.replace(/\.ts$/, '.test.ts'));
    assert.ok(existsSync(testFile), `${module.file} has no test beside it`);
  }
});

test('main.ts and program.ts own no verb: no .action() outside the modules', () => {
  for (const file of ['main.ts', 'program.ts']) {
    const text = readFileSync(join(SRC, file), 'utf8');
    assert.doesNotMatch(text, /\.action\(/, `${file} registers an action`);
  }
});
