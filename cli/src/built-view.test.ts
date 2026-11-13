// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { builtByText, readBuiltBy } from './built-view.js';

test('the reader takes the known fields by name, from a provenance or a row alike', () => {
  // provenance.json spells the doctrine as doctrineVersion; the
  // manifest and the row spell it doctrine. Both read the same.
  assert.deepEqual(
    readBuiltBy({
      specSha: 'abc',
      doctrineVersion: '31.0.0',
      cernanto: '0.4.0',
      harness: {
        name: 'cernanto/harness/claude-code',
        cli: '2.1.250',
        model: 'claude-opus-5',
        effort: 'medium',
        transcript: 'stays behind',
      },
      costUsd: 1.5,
    }),
    {
      harness: {
        name: 'cernanto/harness/claude-code',
        cli: '2.1.250',
        model: 'claude-opus-5',
        effort: 'medium',
      },
      cernanto: '0.4.0',
      doctrine: '31.0.0',
    },
  );
  assert.deepEqual(
    readBuiltBy({ doctrine: '31.0.0', harness: { name: 'cernanto/harness/codex' } }),
    {
      harness: { name: 'cernanto/harness/codex' },
      doctrine: '31.0.0',
    },
  );
  // The lineage of an amended compile reads with it; a depth that is not
  // a whole number is not a depth.
  assert.deepEqual(
    readBuiltBy({
      doctrine: '34.0.0',
      harness: { name: 'cernanto/harness/claude-code' },
      amendedFrom: 'sha256:0123456789abcdef',
      amendDepth: 2,
    }),
    {
      harness: { name: 'cernanto/harness/claude-code' },
      doctrine: '34.0.0',
      amendedFrom: 'sha256:0123456789abcdef',
      amendDepth: 2,
    },
  );
  assert.deepEqual(readBuiltBy({ doctrine: '34.0.0', amendDepth: 1.5 }), { doctrine: '34.0.0' });
  // A coder without a name is not a coder; nothing recorded is nothing.
  assert.equal(readBuiltBy({ harness: { model: 'claude-opus-5' } }), undefined);
  assert.equal(readBuiltBy({ specSha: 'abc' }), undefined);
  assert.equal(readBuiltBy(undefined), undefined);
  assert.equal(readBuiltBy('words'), undefined);
});

test('the line reads what is known and nothing more', () => {
  assert.equal(
    builtByText({
      harness: {
        name: 'cernanto/harness/claude-code',
        cli: '2.1.250',
        model: 'claude-opus-5',
        effort: 'medium',
      },
      cernanto: '0.4.0',
      doctrine: '31.0.0',
    }),
    'cernanto/harness/claude-code 2.1.250, model claude-opus-5 at medium effort, cernanto 0.4.0, doctrine 31.0.0',
  );
  assert.equal(
    builtByText({
      harness: { name: 'cernanto/harness/codex', model: 'gpt-5.6-sol' },
      doctrine: '31.0.0',
    }),
    'cernanto/harness/codex, model gpt-5.6-sol, doctrine 31.0.0',
  );
  assert.equal(
    builtByText({ harness: { name: 'harness/fake', effort: 'low' } }),
    'harness/fake, low effort',
  );
  assert.equal(builtByText({ cernanto: '0.4.0' }), 'cernanto 0.4.0');
  assert.equal(builtByText({}), undefined);
});

test('the line names the lineage of an amended compile and nothing of a fresh one', () => {
  assert.equal(
    builtByText({
      harness: { name: 'cernanto/harness/codex', model: 'gpt-5.6-sol' },
      doctrine: '34.0.0',
      amendedFrom: 'sha256:0123456789abcdef',
      amendDepth: 1,
    }),
    'cernanto/harness/codex, model gpt-5.6-sol, doctrine 34.0.0, amended from 0123456789, 1 amendment since the last full compile',
  );
  assert.equal(
    builtByText({ doctrine: '34.0.0', amendedFrom: 'sha256:0123456789abcdef', amendDepth: 3 }),
    'doctrine 34.0.0, amended from 0123456789, 3 amendments since the last full compile',
  );
  // A fresh compile carries a zero depth, or none: no lineage is read.
  assert.equal(
    builtByText({ doctrine: '34.0.0', amendedFrom: 'sha256:0123456789abcdef', amendDepth: 0 }),
    'doctrine 34.0.0',
  );
});
