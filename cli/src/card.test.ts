// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { cardOnPlane, workspaceRootOf } from './card.js';
import type { CardPlane } from './card.js';

// The card's facts are gathered once for every road that prints a
// card: what the plane is asked and when, and where a file's workspace
// is looked for. The rendering is the card view's own proof.

const CONTRACT = 'export declare function greet(input: { name: string }): Promise<string>;\n';

test('a card off the plane asks for a description only for what is missing, and reads the relations off the fleet', async () => {
  const asked: string[] = [];
  const row = {
    agentId: 'ops/greeter',
    artifact: 'sha256:g',
    handlers: ['greet'],
    uses: [],
    contract: CONTRACT,
    built: { doctrine: '42.7.0', harness: { name: 'cernanto/harness/codex' } },
  };
  const plane: CardPlane = {
    rows: () =>
      Promise.resolve([
        row,
        { agentId: 'ops/kiosk', artifact: 'sha256:k', handlers: ['serve'], uses: ['ops/greeter'] },
        {
          agentId: 'ops/greeter-tester-bld7-r1',
          artifact: 'sha256:t',
          handlers: [],
          uses: ['ops/greeter'],
        },
      ]),
    describe: (agentId) => {
      asked.push(agentId);
      return Promise.resolve({ agent: row, contract: CONTRACT });
    },
    history: () => Promise.resolve([{ at: '2026-08-20T10:05:00Z', status: 'active' }]),
  };
  // The row carries its contract: nothing is asked. The fleet says
  // who uses the agent, its own tester left out; the history says when
  // the running version started.
  const known = await cardOnPlane(plane, 'ops/greeter', { known: { row } });
  assert.deepEqual(asked, []);
  assert.deepEqual(known?.usedBy, ['ops/kiosk']);
  assert.deepEqual(known.handlers, ['greet']);
  assert.equal(known.deployedAt, '2026-08-20T10:05:00Z');
  assert.equal(known.built?.doctrine, '42.7.0');
  // After a deploy the history is left unread, the deploy being the
  // start, and the compiled-by line stays the contract verb's; the
  // relations are the card's on every road.
  const after = await cardOnPlane(plane, 'ops/greeter', { known: { row }, afterDeploy: true });
  assert.equal(after?.deployedAt, undefined);
  assert.equal(after?.built, undefined);
  assert.deepEqual(after?.usedBy, ['ops/kiosk']);
  // No row known: the plane describes the agent.
  const described = await cardOnPlane(plane, 'ops/greeter');
  assert.deepEqual(asked, ['ops/greeter']);
  assert.equal(described?.contract, CONTRACT);
  // A webhook consumer with its contract in hand asks nothing either.
  const consumer = { ...row, uses: ['cernanto/webhook'] };
  await cardOnPlane(plane, 'ops/greeter', { known: { row: consumer } });
  assert.deepEqual(asked, ['ops/greeter']);
  // A contract nobody can say is no card; a plane that cannot answer
  // the fleet leaves the relations off rather than failing.
  const bare = { agentId: 'ops/greeter', artifact: 'sha256:g', handlers: ['greet'], uses: [] };
  const silent: CardPlane = { rows: () => Promise.reject(new Error('no')) };
  assert.equal(await cardOnPlane(silent, 'ops/greeter', { known: { row: bare } }), undefined);
  const unlisted = await cardOnPlane(silent, 'ops/greeter', { known: { row } });
  assert.equal(unlisted?.contract, CONTRACT);
  assert.equal(unlisted.usedBy, undefined);
});

test("a file's workspace is the nearest marker above it; none outside a workspace", () => {
  const root = mkdtempSync(join(tmpdir(), 'card-root-'));
  mkdirSync(join(root, 'ops', '.cern'), { recursive: true });
  const file = join(root, 'ops', '.cern', 'greeter.cern');
  writeFileSync(file, '');
  assert.equal(workspaceRootOf(file), undefined);
  writeFileSync(join(root, 'cernanto.json'), '{}\n');
  assert.equal(workspaceRootOf(file), root);
});
