// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FleetAgentRowWire } from '../gateway/types.gen.js';

import { afterShip, formatReport, workerNextStep, writtenLines } from './afterword.js';
import type { ShipPlane } from './afterword.js';
import { responseOf } from './plane.fixture.js';
// The tables render this machine's time; the proof reads them in utc.
process.env['TZ'] = 'UTC';

test("formatReport is the afterword: each failed agent with its detail; the spec issues are the summary's; nothing on green", () => {
  const report = {
    status: 'failed',
    issues: [{ code: 'CE104', agentId: 'ops/other', message: 'a worker is never a target' }],
    agents: [
      { agentId: 'ops/greeter', status: 'compiled' },
      {
        agentId: 'ops/failed',
        status: 'failed',
        detail: 'the tests never passed\n\n  see the trace\n',
      },
    ],
  };
  assert.equal(
    formatReport(report),
    ['ops/failed: FAILED', '  the tests never passed', '    see the trace', ''].join('\n'),
  );
  assert.equal(
    formatReport({
      status: 'ok',
      issues: [],
      agents: [{ agentId: 'ops/greeter', status: 'compiled' }],
    }),
    '',
  );
});

function planeOf(overrides?: {
  fleet?: { agentId: string; uses?: string[]; running?: number; suspended?: number }[];
  generations?: {
    agentId?: string;
    gen: number;
    status: string;
    package?: string;
    inFlight: number;
  }[];
}): {
  plane: ShipPlane;
} {
  return {
    plane: {
      rows: () =>
        Promise.resolve(
          (overrides?.fleet ?? []).map((row) => ({
            artifact: 'sha256:x',
            handlers: [],
            uses: [],
            running: 0,
            ...row,
          })),
        ),
      ...(overrides?.generations === undefined
        ? {}
        : { generations: () => Promise.resolve(overrides.generations ?? []) }),
    },
  };
}

test("afterShip reports each agent's package as the plane shipped it", async () => {
  const { plane } = planeOf({
    fleet: [{ agentId: 'ops/greeter' }],
    generations: [
      {
        agentId: 'ops/greeter',
        gen: 1,
        status: 'active',
        package: 'localhost:5000/cernanto/agents@sha256:abc',
        inFlight: 0,
      },
    ],
  });
  const lines: string[] = [];
  const outcome = await afterShip(plane, responseOf(), {
    write: (line) => lines.push(line),
  });
  assert.deepEqual(outcome, { shipped: 1, linkedOnly: 0 });
  assert.ok(lines.includes('deployed ops/greeter: sha256:abc\n'), lines.join(''));
});

test('a deployed worker says the plane starts it and how to follow, stop and start it; a service does not', async () => {
  // A worker ran nothing in its compile: the deploy says the plane
  // starts it once its generation serves, and names the trace that
  // follows it and the stop/start that are the operator's hands on it.
  const { plane } = planeOf({
    fleet: [{ agentId: 'news/monitor' }, { agentId: 'ops/greeter' }],
    generations: [
      { agentId: 'news/monitor', gen: 1, status: 'active', package: 'img:m1', inFlight: 0 },
      { agentId: 'ops/greeter', gen: 1, status: 'active', package: 'img:g1', inFlight: 0 },
    ],
  });
  const lines: string[] = [];
  await afterShip(
    plane,
    responseOf({
      agents: [
        { agentId: 'news/monitor', status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0 },
        { agentId: 'ops/greeter', status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0 },
      ],
      rows: [
        {
          agentId: 'news/monitor',
          artifact: 'sha256:m',
          type: 'worker',
          handlers: ['run'],
          uses: [],
        },
        {
          agentId: 'ops/greeter',
          artifact: 'sha256:g',
          handlers: ['greet'],
          uses: [],
        },
      ],
    }),
    { write: (line) => lines.push(line) },
  );
  assert.deepEqual(lines.slice(-3), [
    'deployed news/monitor: sha256:m\n',
    'follow news/monitor live: cernanto trace news/monitor -f\n',
    'deployed ops/greeter: sha256:g\n',
  ]);
  assert.equal(workerNextStep({ agentId: 'ops/x' }), 'follow ops/x live: cernanto trace ops/x -f');
});

test('a followed worker deploy keeps the next-step block off: the live follow takes over', async () => {
  const { plane } = planeOf({
    fleet: [{ agentId: 'news/monitor' }],
    generations: [
      { agentId: 'news/monitor', gen: 1, status: 'active', package: 'img:m1', inFlight: 0 },
    ],
  });
  const lines: string[] = [];
  await afterShip(
    plane,
    responseOf({
      agents: [
        { agentId: 'news/monitor', status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0 },
      ],
      rows: [
        {
          agentId: 'news/monitor',
          artifact: 'sha256:m',
          type: 'worker',
          handlers: ['run'],
          uses: [],
        },
      ],
    }),
    { write: (line) => lines.push(line), follow: true },
  );
  assert.equal(lines.at(-1), 'deployed news/monitor: sha256:m\n');
  assert.ok(!lines.some((line) => line.includes('follow news/monitor live')), lines.join(''));
});

test('a deployed service ends on its card with the call to paste', async () => {
  // The deploy's last word for a service is its contract, exactly as
  // `cernanto contract` renders it, so what was shipped and how to
  // call it are on screen without another command; the json output
  // path (`card: false`) keeps the tail to the deployed lines.
  const contract = [
    '/**',
    ' * Hands out the next queue number.',
    ' *',
    ' * @returns The number handed out: 1 on the first call, then 2, 3, and so on.',
    ' */',
    'export declare function nextNumber(): Promise<number>;',
    '',
  ].join('\n');
  const shipOf = (): Parameters<typeof afterShip>[1] =>
    responseOf({
      agents: [
        {
          agentId: 'ops/ticket-counter',
          status: 'compiled',
          attempts: 1,
          triageCount: 0,
          costUsd: 0,
        },
      ],
      rows: [
        {
          agentId: 'ops/ticket-counter',
          artifact: 'sha256:t',
          handlers: ['nextNumber'],
          uses: [],
          contract,
          verified: { at: '2026-08-21T10:00:00Z' },
        },
      ],
    });
  const planeSetup = (): ReturnType<typeof planeOf> =>
    planeOf({
      fleet: [{ agentId: 'ops/ticket-counter' }],
      generations: [
        { agentId: 'ops/ticket-counter', gen: 1, status: 'active', package: 'img:t1', inFlight: 0 },
      ],
    });
  const lines: string[] = [];
  await afterShip(planeSetup().plane, shipOf(), { write: (line) => lines.push(line) });
  assert.deepEqual(lines.slice(-2), [
    'deployed ops/ticket-counter: sha256:t\n',
    [
      '',
      'Ticket Counter   ops/ticket-counter   stateful   deployed   verified live 2026-08-21 10:00:00',
      '',
      '',
      'Next number',
      '  Hands out the next queue number.',
      '',
      '  answers  number',
      '    The number handed out: 1 on the first call, then 2, 3, and so on.',
      '',
      '  call it: cernanto call ops/ticket-counter nextNumber',
      '',
      '',
    ].join('\n'),
  ]);
  const quietLines: string[] = [];
  await afterShip(planeSetup().plane, shipOf(), {
    write: (line) => quietLines.push(line),
    card: false,
  });
  assert.equal(quietLines.at(-1), 'deployed ops/ticket-counter: sha256:t\n');
});

test('an agent that takes deliveries ends on its call line like any other', async () => {
  // A webhook consumer's row carries its contract, so the deploy asks
  // the plane nothing and prints the card off the fleet.
  const asked: string[] = [];
  const base = planeOf({
    fleet: [{ agentId: 'ops/sms-responder' }],
    generations: [
      { agentId: 'ops/sms-responder', gen: 1, status: 'active', package: 'img:s1', inFlight: 0 },
    ],
  });
  const plane: ShipPlane = {
    ...base.plane,
    describe: (agentId) => {
      asked.push(agentId);
      return Promise.resolve({});
    },
  };
  const shipOf = (): Parameters<typeof afterShip>[1] =>
    responseOf({
      agents: [
        {
          agentId: 'ops/sms-responder',
          status: 'compiled',
          attempts: 1,
          triageCount: 0,
          costUsd: 0,
        },
      ],
      rows: [
        {
          agentId: 'ops/sms-responder',
          artifact: 'sha256:s',
          handlers: ['handleDelivery'],
          uses: ['cernanto/webhook'],
          contract:
            '/** Answers a text. */\nexport declare function handleDelivery(delivery: { body: string }): Promise<void>;\n',
        },
      ],
    });
  const lines: string[] = [];
  await afterShip(plane, shipOf(), { write: (line) => lines.push(line) });
  assert.deepEqual(asked, []);
  assert.match(
    lines.at(-1) ?? '',
    /call it: cernanto call ops\/sms-responder handleDelivery body=\.\.\.\n/,
  );
  // A plane that cannot describe prints the same card off the fleet.
  const silent: ShipPlane[] = [
    { ...base.plane, describe: () => Promise.reject(new Error('no')) },
    base.plane,
  ];
  for (const one of silent) {
    const said: string[] = [];
    await afterShip(one, shipOf(), { write: (line) => said.push(line) });
    const card = said.at(-1) ?? '';
    assert.match(card, /call it: cernanto call ops\/sms-responder handleDelivery body=\.\.\.\n/);
  }
});

test('an agent that landed as it was ends as a compiled one does, read as the fleet holds it', async () => {
  // A landing answers ids alone, so a landed agent is read off the
  // fleet, its contract off the plane's description when the fleet
  // carries none; the lines are the ones a compiled agent ends on. An id
  // the fleet does not hold ends on nothing.
  const contract = [
    '/**',
    ' * Hands out the next queue number.',
    ' *',
    ' * @returns The number handed out: 1 on the first call, then 2, 3, and so on.',
    ' */',
    'export declare function nextNumber(): Promise<number>;',
    '',
  ].join('\n');
  const asked: string[] = [];
  const plane: ShipPlane = {
    rows: () =>
      Promise.resolve([
        {
          agentId: 'ops/ticket-counter',
          artifact: 'sha256:t',
          handlers: ['nextNumber'],
          uses: ['lib/format'],
          verified: { at: '2026-08-21T10:00:00Z' },
        },
        {
          agentId: 'news/monitor',
          artifact: 'sha256:m',
          type: 'worker',
          handlers: ['run'],
          uses: [],
        },
        {
          agentId: 'lib/format',
          artifact: 'sha256:f',
          type: 'module',
          handlers: ['format'],
          uses: [],
        },
      ] as FleetAgentRowWire[]),
    generations: () =>
      Promise.resolve([
        {
          agentId: 'ops/ticket-counter',
          gen: 3,
          status: 'active',
          composition: { 'lib/format': 'sha256:f' },
        },
      ]),
    describe: (agentId) => {
      asked.push(agentId);
      return Promise.resolve({ contract });
    },
  };
  const landed = ['ops/ticket-counter', 'news/monitor', 'lib/format', 'ops/unknown'];
  const moduleLine = 'deployed lib/format: sha256:f   recomposed into ops/ticket-counter\n';
  const card = [
    '',
    'Ticket Counter   ops/ticket-counter   stateful   deployed   verified live 2026-08-21 10:00:00',
    'uses  lib/format',
    '',
    '',
    'Next number',
    '  Hands out the next queue number.',
    '',
    '  answers  number',
    '    The number handed out: 1 on the first call, then 2, 3, and so on.',
    '',
    '  call it: cernanto call ops/ticket-counter nextNumber',
    '',
    '',
  ].join('\n');
  const workerBlock = `${workerNextStep({ agentId: 'news/monitor' })}\n`;
  const lines: string[] = [];
  const outcome = await afterShip(
    plane,
    { agents: [], rows: [], landed },
    { write: (line) => lines.push(line) },
  );
  assert.deepEqual(outcome, { shipped: 4, linkedOnly: 0 });
  assert.deepEqual(lines, [
    moduleLine,
    'deployed ops/ticket-counter: sha256:t\n',
    card,
    'deployed news/monitor: sha256:m\n',
    workerBlock,
  ]);
  // The plane is asked to describe the agents that get a card, no other.
  assert.deepEqual(asked, ['ops/ticket-counter']);
  // The json output path keeps the card off and asks for none; a
  // followed worker keeps its block off, the live follow takes over.
  const quiet: string[] = [];
  await afterShip(
    plane,
    { agents: [], rows: [], landed },
    { write: (line) => quiet.push(line), card: false },
  );
  assert.deepEqual(quiet, [
    moduleLine,
    'deployed ops/ticket-counter: sha256:t\n',
    'deployed news/monitor: sha256:m\n',
    workerBlock,
  ]);
  assert.deepEqual(asked, ['ops/ticket-counter']);
  const followed: string[] = [];
  await afterShip(
    plane,
    { agents: [], rows: [], landed },
    { write: (line) => followed.push(line), follow: true },
  );
  assert.deepEqual(followed, [
    moduleLine,
    'deployed ops/ticket-counter: sha256:t\n',
    card,
    'deployed news/monitor: sha256:m\n',
  ]);
  // An agent the compile shipped ends once, as the compile answered it.
  const both: string[] = [];
  await afterShip(
    plane,
    {
      ...responseOf({
        agents: [],
        rows: [{ agentId: 'ops/ticket-counter', artifact: 'sha256:new', handlers: [], uses: [] }],
      }),
      landed: ['ops/ticket-counter'],
    },
    { write: (line) => both.push(line), card: false },
  );
  assert.deepEqual(both, ['deployed ops/ticket-counter: sha256:new\n']);
});

test('a landed card reads its contract from the plane, and a plane that cannot describe leaves the card to the fleet', async () => {
  const contract =
    '/** Answers a text. */\nexport declare function handleDelivery(delivery: { body: string }): Promise<void>;\n';
  const row = {
    agentId: 'ops/sms-responder',
    artifact: 'sha256:s',
    handlers: ['handleDelivery'],
    uses: ['cernanto/webhook'],
  };
  const landing = { agents: [], rows: [], landed: ['ops/sms-responder'] };
  const lines: string[] = [];
  await afterShip(
    {
      rows: () => Promise.resolve([row]),
      describe: () => Promise.resolve({ contract }),
    },
    landing,
    { write: (line) => lines.push(line) },
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'deployed ops/sms-responder: sha256:s\n');
  assert.match(
    lines[1] ?? '',
    /call it: cernanto call ops\/sms-responder handleDelivery body=\.\.\.\n/,
  );
  // A describe that fails leaves the card to the contract the fleet
  // carries; with none there, the agent ends on its deployed line.
  const refusing = (rows: FleetAgentRowWire[]): ShipPlane => ({
    rows: () => Promise.resolve(rows),
    describe: () => Promise.reject(new Error('no')),
  });
  const carried: string[] = [];
  await afterShip(refusing([{ ...row, contract }]), landing, {
    write: (line) => carried.push(line),
  });
  assert.equal(carried.length, 2);
  assert.match(carried[1] ?? '', /call it: cernanto call ops\/sms-responder handleDelivery /);
  const bare: string[] = [];
  await afterShip(refusing([row]), landing, { write: (line) => bare.push(line) });
  assert.deepEqual(bare, ['deployed ops/sms-responder: sha256:s\n']);
});

test('afterShip reports modules as linked, never as shipped rows', async () => {
  const { plane } = planeOf({
    generations: [{ gen: 1, status: 'active', inFlight: 0 }],
  });
  const lines: string[] = [];
  const outcome = await afterShip(
    plane,
    responseOf({
      agents: [
        { agentId: 'lib/format', status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0 },
      ],
      rows: [],
    }),
    { write: (line) => lines.push(line) },
  );
  assert.deepEqual(outcome, { shipped: 0, linkedOnly: 1 });
  assert.ok(lines.includes('prepared module lib/format: rides inside its consumers\n'));
});

test('a module deploy names its carriers off the compositions, hops away included, and waits for them', async () => {
  // Bottom is composed into report and top two hops up, through
  // middle, a module with no generation of its own: nothing with a
  // generation names bottom directly, so the carriers come from the
  // plane's compositions, and the deploy waits until each newest
  // generation composes the new digest (the tester of middle is a
  // carrier too, kept off the printed line as every tester is).
  const base = planeOf({
    fleet: [{ agentId: 'chain/report' }, { agentId: 'chain/top' }],
    generations: [
      { agentId: 'chain/report', gen: 1, status: 'active', inFlight: 0 },
      { agentId: 'chain/top', gen: 2, status: 'active', inFlight: 0 },
    ],
  });
  let polls = 0;
  const composition = (digest: string): Record<string, string> => ({
    'chain/bottom': digest,
    'chain/middle': 'sha256:mid',
  });
  const plane: ShipPlane = {
    ...base.plane,
    rows: () =>
      Promise.resolve([
        { agentId: 'chain/bottom', type: 'module', artifact: 'sha256:old', uses: [] },
        { agentId: 'chain/middle', type: 'module', artifact: 'sha256:mid', uses: ['chain/bottom'] },
        { agentId: 'chain/report', type: 'worker', artifact: 'sha256:rep', uses: ['chain/middle'] },
        { agentId: 'chain/top', artifact: 'sha256:top', uses: ['chain/middle'] },
      ] as FleetAgentRowWire[]),
    generations: () => {
      polls += 1;
      const digest = polls > 1 ? 'sha256:new' : 'sha256:old';
      return Promise.resolve([
        { agentId: 'chain/report', gen: 1, status: 'active', composition: composition(digest) },
        { agentId: 'chain/top', gen: 2, status: 'active', composition: composition(digest) },
        {
          agentId: 'chain/top',
          gen: 1,
          status: 'retired',
          composition: composition('sha256:older'),
        },
      ]);
    },
  };
  const lines: string[] = [];
  await afterShip(
    plane,
    responseOf({
      rows: [
        {
          agentId: 'chain/bottom',
          type: 'module',
          artifact: 'sha256:new',
          handlers: ['foundingDate'],
          uses: [],
        },
      ],
    }),
    { write: (line) => lines.push(line) },
  );
  assert.ok(
    lines.includes('deployed chain/bottom: sha256:new   recomposed into chain/report, chain/top\n'),
    lines.join(''),
  );
  assert.ok(polls >= 2);
});

test('a first deploy names the carriers shipped beside the modules, reached through the module rows', async () => {
  // A first deploy onto an empty fleet: bottom, middle and report ship
  // in one request. Report reaches bottom through middle (a module
  // row's own uses), so both module lines name it once its generation
  // composes them, as "composed into".
  const base = planeOf({
    fleet: [],
    generations: [{ agentId: 'chain/report', gen: 1, status: 'active', inFlight: 0 }],
  });
  let polls = 0;
  const plane: ShipPlane = {
    ...base.plane,
    rows: () => Promise.resolve([]),
    generations: () => {
      polls += 1;
      return Promise.resolve(
        polls > 1
          ? [
              {
                agentId: 'chain/report',
                gen: 1,
                status: 'active',
                composition: { 'chain/bottom': 'sha256:b', 'chain/middle': 'sha256:m' },
              },
            ]
          : [],
      );
    },
  };
  const lines: string[] = [];
  await afterShip(
    plane,
    responseOf({
      rows: [
        {
          agentId: 'chain/bottom',
          type: 'module',
          artifact: 'sha256:b',
          handlers: ['foundingDate'],
          uses: [],
        },
        {
          agentId: 'chain/middle',
          type: 'module',
          artifact: 'sha256:m',
          handlers: ['compareFoundings'],
          uses: ['chain/bottom'],
        },
        {
          agentId: 'chain/report',
          type: 'worker',
          artifact: 'sha256:r',
          handlers: ['run'],
          uses: ['chain/middle'],
        },
      ],
    }),
    { write: (line) => lines.push(line) },
  );
  assert.ok(
    lines.includes('deployed chain/bottom: sha256:b   composed into chain/report\n'),
    lines.join(''),
  );
  assert.ok(
    lines.includes('deployed chain/middle: sha256:m   composed into chain/report\n'),
    lines.join(''),
  );
});

test('a missing dependency warns after the ship', async () => {
  const { plane } = planeOf({
    fleet: [{ agentId: 'ops/greeter' }],
    generations: [{ gen: 1, status: 'active', inFlight: 0 }],
  });
  const lines: string[] = [];
  await afterShip(
    plane,
    responseOf({
      rows: [
        {
          agentId: 'ops/greeter',
          artifact: 'sha256:abc',
          handlers: ['greet'],
          uses: ['ops/ledger'],
        },
      ],
    }),
    { write: (line) => lines.push(line) },
  );
  assert.ok(
    lines.some((line) => line.includes('uses ops/ledger, which is not deployed')),
    lines.join(''),
  );
  // A use under `cernanto/` is the plane's own and draws no warning.
  assert.ok(!lines.some((line) => line.includes('cernanto/')), lines.join(''));
});

test('a breaking contract deploy warns about in-flight dependents', async () => {
  const { plane } = planeOf({
    fleet: [
      { agentId: 'ops/greeter' },
      { agentId: 'ops/consumer', uses: ['ops/greeter'], running: 2 },
    ],
    generations: [{ gen: 1, status: 'active', inFlight: 0 }],
  });
  const lines: string[] = [];
  await afterShip(
    plane,
    responseOf({
      agents: [
        {
          agentId: 'ops/greeter',
          status: 'compiled',
          contractChange: 'breaking',
          attempts: 1,
          triageCount: 0,
          costUsd: 0,
        },
      ],
    }),
    { write: (line) => lines.push(line) },
  );
  assert.ok(
    lines.some((line) =>
      line.includes('2 calls in flight across ops/consumer may fail on their next call'),
    ),
    lines.join(''),
  );
});

test("the plane's own convergence verdict is repeated when its patience ran out, with its notes", async () => {
  const { plane } = planeOf({
    fleet: [{ agentId: 'ops/greeter' }],
    generations: [{ gen: 1, status: 'active', inFlight: 0 }],
  });
  const lines: string[] = [];
  await afterShip(
    plane,
    responseOf({
      shipped: {
        agents: ['ops/greeter'],
        converged: false,
        notes: ['deploy waits: a blocked port between two nodes'],
      },
    }),
    { write: (line) => lines.push(line), card: false },
  );
  assert.ok(lines.includes('deploy waits: a blocked port between two nodes\n'), lines.join(''));
  assert.ok(
    lines.includes('warning: the fleet has not converged yet; watch it with: cernanto ls\n'),
    lines.join(''),
  );
  // The plane's own agents are rows of the one fleet like any other:
  // the card and the fleet read look there.
  const asked: string[] = [];
  const platformPlane: ShipPlane = {
    rows: () => {
      asked.push('fleet');
      return Promise.resolve([]);
    },
  };
  await afterShip(
    platformPlane,
    responseOf({
      rows: [{ agentId: 'cernanto/config', artifact: 'sha256:c', handlers: ['get'], uses: [] }],
      shipped: { agents: ['cernanto/config'], converged: true, notes: [] },
    }),
    { write: () => undefined, card: false },
  );
  assert.ok(asked.length > 0 && asked.every((where) => where === 'fleet'), asked.join(','));
});

test('the packages written back: one line with the reminder for one, the digests in the log', () => {
  const one = [{ path: '/w/ops/.cern/greeter.cern', digest: 'sha256:0123456789abcdef0123' }];
  const two = [...one, { path: '/w/ops/.cern/other.cern', digest: 'sha256:fedcba9876543210fedc' }];
  assert.equal(writtenLines([], false, 'commit it with its spec'), '');
  assert.match(
    writtenLines(one, false, 'commit it with its spec'),
    /^wrote .*greeter\.cern; commit it with its spec\n$/,
  );
  assert.match(
    writtenLines(two, false, 'commit it with its spec'),
    /^wrote .*greeter\.cern\nwrote .*other\.cern\ncommit the packages with their specs\n$/,
  );
  assert.match(
    writtenLines(one, true, 'commit it with its spec'),
    /^wrote .*greeter\.cern \(sha256:0123456789ab\.\.\.\)\ncommit the packages with their specs\n$/,
  );
  // No reminder: the path alone, a compile's ending.
  assert.match(writtenLines(one, false, ''), /^wrote .*greeter\.cern\n$/);
  assert.match(writtenLines(two, false, ''), /^wrote .*greeter\.cern\nwrote .*other\.cern\n$/);
});

test("a deployed agent's card names who uses it, off the fleet, as contract does", async () => {
  // The card is the one contract prints, gathered the same way: the
  // fleet's rows that grant the agent are its `used by` line.
  const { plane } = planeOf({
    fleet: [
      { agentId: 'ops/ticket-counter' },
      { agentId: 'ops/kiosk', uses: ['ops/ticket-counter'] },
    ],
    generations: [
      { agentId: 'ops/ticket-counter', gen: 1, status: 'active', package: 'img:t1', inFlight: 0 },
    ],
  });
  const lines: string[] = [];
  await afterShip(
    plane,
    responseOf({
      rows: [
        {
          agentId: 'ops/ticket-counter',
          artifact: 'sha256:t',
          handlers: ['nextNumber'],
          uses: [],
          contract: 'export declare function nextNumber(): Promise<number>;\n',
        },
      ],
    }),
    { write: (line) => lines.push(line) },
  );
  const card = lines.at(-1) ?? '';
  assert.match(card, /^Ticket Counter {3}ops\/ticket-counter {3}stateful {3}deployed$/m);
  assert.match(card, /^used by {2}ops\/kiosk$/m);
  assert.match(card, /call it: cernanto call ops\/ticket-counter nextNumber\n/);
});
