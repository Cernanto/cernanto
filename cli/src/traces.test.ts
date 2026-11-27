// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Command } from 'commander';

import {
  offLine,
  registerTraces,
  setWords,
  traces,
  tracesList,
  tracesOfAgent,
  tracesValue,
} from './traces.js';
import type { Traces, TracesClient, TracesRow, TracesSet } from './traces.js';

// The traces verb: what each agent's traces stand at, read off the
// plane's listing, and the write that sets one, answered in the words
// of what starts again for it.

// The plane lists its agents in its own order; the verb reads them by
// their ids, as `cernanto ls` does.
const ROWS: TracesRow[] = [
  { agentId: 'ops/web', type: 'service', traces: 'debug' },
  { agentId: 'cernanto/documents', type: 'interface' },
  { agentId: 'cernanto/controller', type: 'task', traces: 'off' },
  { agentId: 'ops/pricing', type: 'module', traces: 'on' },
];

/** A plane that lists the rows and remembers what was written. */
function plane(answer?: Partial<TracesSet>): TracesClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    ls: (agent) => {
      asked.push(`ls ${agent ?? ''}`.trim());
      return Promise.resolve({ agents: ROWS });
    },
    agentTraces: (agentId, value) => {
      asked.push(`set ${agentId} ${value}`);
      return Promise.resolve({ agentId, traces: value, changed: true, starts: [], ...answer });
    },
  };
}

test('the verb takes an agent and a setting, both optional, and the table flags', () => {
  const program = new Command('cernanto');
  registerTraces(program);
  const verb = program.commands.find((command) => command.name() === 'traces');
  assert.ok(verb !== undefined, 'traces registers');
  assert.deepEqual(
    verb.registeredArguments.map((arg) => [arg.name(), arg.required]),
    [
      ['agent-id', false],
      ['setting', false],
    ],
  );
  assert.deepEqual(
    verb.options.map((option) => option.long),
    ['--output', '--no-headers'],
  );
  assert.match(verb.description(), /^what an agent's traces stand at, and the write that sets it/);
});

test('with no agent, every agent and what its traces stand at, an interface with none', async () => {
  assert.equal(
    await tracesList(plane(), {}),
    [
      'AGENT                TYPE       TRACES',
      'cernanto/controller  task       off',
      'cernanto/documents   interface  -',
      'ops/pricing          module     on',
      'ops/web              service    debug',
      '',
    ].join('\n'),
  );
  assert.deepEqual(JSON.parse(await tracesList(plane(), { output: 'json' })), [
    { agentId: 'cernanto/controller', type: 'task', traces: 'off' },
    { agentId: 'cernanto/documents', type: 'interface' },
    { agentId: 'ops/pricing', type: 'module', traces: 'on' },
    { agentId: 'ops/web', type: 'service', traces: 'debug' },
  ]);
});

test('a plane older than the setting names none: an agent that runs is never said to keep no traces, nor told to turn them on', async () => {
  // Such a plane lists its agents with no value. Its agents are traced
  // as they always were, so a missing value is said as missing.
  const older: TracesClient = {
    ls: () => Promise.resolve({ agents: [{ agentId: 'acme/echo', type: 'task' }] }),
    agentTraces: () => Promise.reject(new Error('this plane has no such operation')),
  };
  assert.equal(
    await tracesOfAgent(older, 'acme/echo', {}),
    'acme/echo: this plane does not say what its traces stand at\n',
  );
  assert.deepEqual(JSON.parse(await tracesOfAgent(older, 'acme/echo', { output: 'json' })), {
    agentId: 'acme/echo',
    type: 'task',
  });
  assert.match(await tracesList(older, {}), /\nacme\/echo +task +-\n/);
  assert.equal(await offLine(older, 'acme/echo'), undefined, 'nothing says its traces are off');
});

test('with an agent, its one line; an interface says why it has none; an agent the plane does not list is refused', async () => {
  assert.equal(await tracesOfAgent(plane(), 'ops/web', {}), 'ops/web: traces debug\n');
  assert.equal(
    await tracesOfAgent(plane(), 'cernanto/controller', {}),
    'cernanto/controller: traces off\n',
  );
  assert.equal(
    await tracesOfAgent(plane(), 'cernanto/documents', {}),
    'cernanto/documents is an interface: it runs no code and keeps no traces\n',
  );
  assert.deepEqual(JSON.parse(await tracesOfAgent(plane(), 'ops/web', { output: 'json' })), {
    agentId: 'ops/web',
    type: 'service',
    traces: 'debug',
  });
  await assert.rejects(tracesOfAgent(plane(), 'ops/gone', {}), /no agent "ops\/gone"/);
});

test('a write says what stands and what starts again, in the words of the kind that starts', () => {
  const set = (traces: Traces, starts: TracesSet['starts'], changed = true): TracesSet => ({
    agentId: 'ops/web',
    traces,
    changed,
    starts,
  });
  assert.equal(
    setWords('ops/web', set('debug', [{ agentId: 'ops/web', type: 'task' }])),
    'ops/web: traces debug. It starts again as a new version.\n',
  );
  assert.equal(
    setWords('ops/web', set('debug', [{ agentId: 'ops/web', type: 'job' }])),
    'ops/web: traces debug. It starts again as a new version.\n',
  );
  assert.equal(
    setWords('ops/web', set('off', [{ agentId: 'ops/web', type: 'service' }])),
    'ops/web: traces off. It starts again as a new version. Its memory starts over.\n',
  );
  assert.equal(
    setWords('ops/web', set('on', [{ agentId: 'ops/web', type: 'worker' }])),
    'ops/web: traces on. It starts again as a new version. Its program runs again.\n',
  );
  assert.equal(setWords('ops/web', set('debug', [], false)), 'ops/web: traces are debug already\n');
});

test("a module's write names the agents that link it, which start again", () => {
  const set = (starts: TracesSet['starts']): TracesSet => ({
    agentId: 'ops/pricing',
    traces: 'off',
    changed: true,
    starts,
  });
  assert.equal(set([]).starts.length, 0);
  assert.equal(
    setWords('ops/pricing', set([])),
    'ops/pricing: traces off. No agent starts again for it.\n',
  );
  assert.equal(
    setWords('ops/pricing', set([{ agentId: 'ops/web', type: 'service' }])),
    'ops/pricing: traces off. The agent that links it starts again as a new version: ops/web\n',
  );
  assert.equal(
    setWords(
      'ops/pricing',
      set([
        { agentId: 'ops/desk', type: 'task' },
        { agentId: 'ops/web', type: 'service' },
      ]),
    ),
    [
      'ops/pricing: traces off. The 2 agents that link it start again as new versions, a few at a time:',
      '  ops/desk',
      '  ops/web',
      '',
    ].join('\n'),
  );
});

test('the verb whole: no word lists, an agent reads, a setting writes; a word that is no setting is refused before the plane is asked', async () => {
  const listed = plane();
  assert.match(await traces(listed, undefined, undefined, {}), /^AGENT/);
  assert.deepEqual(listed.asked, ['ls']);
  const read = plane();
  assert.equal(await traces(read, 'ops/web', undefined, {}), 'ops/web: traces debug\n');
  assert.deepEqual(read.asked, ['ls ops/web']);
  const written = plane({ starts: [{ agentId: 'ops/web', type: 'service' }] });
  assert.equal(
    await traces(written, 'ops/web', 'off', {}),
    'ops/web: traces off. It starts again as a new version. Its memory starts over.\n',
  );
  assert.deepEqual(written.asked, ['set ops/web off']);
  assert.deepEqual(JSON.parse(await traces(plane(), 'ops/web', 'on', { output: 'json' })), {
    agentId: 'ops/web',
    traces: 'on',
    changed: true,
    starts: [],
  });
  const refused = plane();
  await assert.rejects(
    traces(refused, 'ops/web', 'verbose', {}),
    /traces are set to on, debug or off, not "verbose"/,
  );
  assert.deepEqual(refused.asked, [], 'the plane was not asked');
  assert.throws(() => tracesValue('ON'), /not "ON"/);
  assert.equal(tracesValue('debug'), 'debug');
});

test('a read that brought nothing says an agent is off, with the command that turns it on, and says nothing of any other', async () => {
  assert.equal(
    await offLine(plane(), 'cernanto/controller'),
    'the traces of cernanto/controller are off, so nothing of its calls is stored; turn them on with: cernanto traces cernanto/controller on\n',
  );
  assert.equal(await offLine(plane(), 'ops/web'), undefined, 'an agent that is not off');
  assert.equal(await offLine(plane(), 'ops/gone'), undefined, 'an agent the plane does not list');
  assert.equal(
    await offLine({ ls: () => Promise.reject(new Error('the plane is away')) }, 'ops/web'),
    undefined,
    'a plane that cannot say',
  );
});
