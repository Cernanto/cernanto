// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  colored,
  diagnosticsCount,
  diagnosticsSummary,
  issueDiagnostic,
  levelOf,
} from './diagnostics.js';

// The diagnostics render the way a compiler ends: one line per issue
// in the form every editor parses, the notes beneath, and the count.

test('the summary is the lines then their count; error lines count as errors; a pipe gets no color', () => {
  const warning =
    'examples/basics/approval.cern.md:3:55: warning: what is the answer when the time limit passes?';
  const error =
    'examples/basics/approval.cern.md:3:55: error: what is the answer when the time limit passes?';
  assert.equal(levelOf(warning), 'warning');
  assert.equal(levelOf(error), 'error');
  assert.equal(diagnosticsSummary([], false), '');
  assert.equal(diagnosticsSummary([warning], false), `${warning}\n1 warning\n`);
  assert.equal(diagnosticsSummary([error, error], false), `${error}\n${error}\n2 errors\n`);
  assert.equal(diagnosticsCount([error, warning, warning]), '1 error, 2 warnings');
  assert.equal(colored(warning, false), warning);
  assert.equal(
    colored(warning, true),
    'examples/basics/approval.cern.md:3:55: \u001b[1;33mwarning:\u001b[0m what is the answer when the time limit passes?',
  );
  assert.ok(colored(error, true).includes('\u001b[1;31merror:\u001b[0m'));
});

test('a spec issue is a diagnostic: the page, its line, the severity, the message, the remedy beneath; no code', () => {
  const pathOf = (id: string): string | undefined =>
    id === 'demo/welcome' ? 'demo/welcome.cern.md' : undefined;
  const missing = issueDiagnostic(
    {
      severity: 'error',
      agentId: 'demo/welcome',
      message: 'Uses names "acme/greeter" but no spec exists at that path under the agents root',
      line: 7,
      hint: 'if it is a published package, deploy it first: cernanto deploy acme/greeter',
    },
    pathOf,
  );
  assert.deepEqual(missing, {
    line: 'demo/welcome.cern.md:7: error: Uses names "acme/greeter" but no spec exists at that path under the agents root',
    notes: ['if it is a published package, deploy it first: cernanto deploy acme/greeter'],
  });
  const other = issueDiagnostic(
    { severity: 'warning', agentId: 'ops/other', message: 'a worker is never a target', hint: '' },
    pathOf,
  );
  assert.deepEqual(other, { line: 'ops/other: warning: a worker is never a target' });
  assert.equal(
    diagnosticsSummary([missing, other], false),
    [
      missing.line,
      '  if it is a published package, deploy it first: cernanto deploy acme/greeter',
      other.line,
      '1 error, 1 warning',
      '',
    ].join('\n'),
  );
});
