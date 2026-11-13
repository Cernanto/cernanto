// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { config, parseConfigValue, readConfigWords } from './config.js';

function fakeClient(answers: { value?: unknown; configuration?: unknown }): {
  calls: { operation: string; key?: string; value?: unknown; place?: string }[];
  configGet: (key: string) => Promise<{ value?: unknown }>;
  configSet: (key: string, value: unknown) => Promise<{ present: boolean }>;
  configList: (place?: string) => Promise<{ configuration?: unknown }>;
} {
  const calls: { operation: string; key?: string; value?: unknown; place?: string }[] = [];
  return {
    calls,
    configGet: (key) => {
      calls.push({ operation: 'configGet', key });
      return Promise.resolve({ value: answers.value });
    },
    configSet: (key, value) => {
      calls.push({ operation: 'configSet', key, value });
      return Promise.resolve({ present: value !== null });
    },
    configList: (place) => {
      calls.push({ operation: 'configList', ...(place === undefined ? {} : { place }) });
      return Promise.resolve({ configuration: answers.configuration });
    },
  };
}

test('a value parses as json when it can, the plain word otherwise', () => {
  assert.equal(parseConfigValue('60'), 60);
  assert.equal(parseConfigValue('true'), true);
  assert.equal(parseConfigValue('null'), null);
  assert.equal(
    parseConfigValue('wss://hooks.cernanto.com/connect'),
    'wss://hooks.cernanto.com/connect',
  );
  assert.deepEqual(parseConfigValue('{"a":1}'), { a: 1 });
  assert.equal(parseConfigValue(''), '');
});

test('the words after config are read as nothing, an agent, a name to read, or name=value to write', () => {
  assert.deepEqual(readConfigWords([]), { ask: 'all' });
  assert.deepEqual(readConfigWords(['cernanto/trace']), { ask: 'place', place: 'cernanto/trace' });
  assert.deepEqual(readConfigWords(['cernanto/trace', 'retention-minutes']), {
    ask: 'read',
    key: 'cernanto/trace/retention-minutes',
  });
  // An interface's default is a setting like any other.
  const defaultOfDecision = 'cernanto/decision/default';
  assert.deepEqual(readConfigWords(['cernanto/decision', 'default=cernanto/decision/jev']), {
    ask: 'write',
    key: defaultOfDecision,
    value: 'cernanto/decision/jev',
  });
});

test('name=value splits at its first "=", and the value is json when it parses as json', () => {
  const written = (setting: string): unknown => {
    const asked = readConfigWords(['proof/agent', setting]);
    assert.equal(asked.ask, 'write');
    return { key: asked.key, value: asked.value };
  };
  // Everything after the first "=" is the value, another "=" among it.
  assert.deepEqual(written('url=https://x.example/?a=b'), {
    key: 'proof/agent/url',
    value: 'https://x.example/?a=b',
  });
  assert.deepEqual(written('retention-minutes=60'), {
    key: 'proof/agent/retention-minutes',
    value: 60,
  });
  assert.deepEqual(written('mode=plan'), { key: 'proof/agent/mode', value: 'plan' });
  // Quoted json is a string, the number and the word null among them.
  assert.deepEqual(written('label="60"'), { key: 'proof/agent/label', value: '60' });
  assert.deepEqual(written('label="null"'), { key: 'proof/agent/label', value: 'null' });
  assert.deepEqual(written('limits={"max":3}'), {
    key: 'proof/agent/limits',
    value: { max: 3 },
  });
  // The json null removes; nothing after the "=" is the empty string.
  assert.deepEqual(written('label=null'), { key: 'proof/agent/label', value: null });
  assert.deepEqual(written('prefix='), { key: 'proof/agent/prefix', value: '' });
});

test('words too many, a name that is empty or carries a slash, and an agent that carries "=" are refused in words that show the form', () => {
  const form = /cernanto config \[<agent> \[<name> \| <name>=<value>\]\]/;
  // The old two-word write, a stray word, and a space around the "=".
  assert.throws(() => readConfigWords(['proof/agent', 'mode', 'plan']), form);
  assert.throws(() => readConfigWords(['proof/agent', 'mode=plan', 'extra']), form);
  assert.throws(() => readConfigWords(['proof/agent', 'mode', '=', 'plan']), /one word/);
  assert.throws(() => readConfigWords(['proof/agent', '=60']), /name is not empty/);
  assert.throws(() => readConfigWords(['mode=plan']), /the agent comes first/);
  // The verb joins its words into the key and the plane splits a key
  // at its last slash: a name with a slash is another agent's setting.
  assert.throws(
    () => readConfigWords(['cernanto/harness', 'codex/api-key=k']),
    /the setting "api-key" of the agent cernanto\/harness\/codex/,
  );
  assert.throws(() => readConfigWords(['cernanto/harness', 'codex/api-key']), /carries no slash/);
});

test('a name prints its value as json, and names an unset key plainly', async () => {
  const set = fakeClient({ value: 60 });
  assert.equal(await config(set, ['cernanto/trace', 'retention-minutes']), '60\n');
  assert.deepEqual(set.calls[0], {
    operation: 'configGet',
    key: 'cernanto/trace/retention-minutes',
  });
  const unset = fakeClient({ value: null });
  assert.equal(
    await config(unset, ['examples/workflows/helpdesk/bot', 'channel']),
    'examples/workflows/helpdesk/bot/channel is not set\n',
  );
});

test('name=value echoes the key alone, never the value, and null reads as removal', async () => {
  const client = fakeClient({});
  assert.equal(
    await config(client, ['cernanto/trace', 'retention-minutes=60']),
    'cernanto/trace/retention-minutes set\n',
  );
  assert.deepEqual(client.calls[0], {
    operation: 'configSet',
    key: 'cernanto/trace/retention-minutes',
    value: 60,
  });
  assert.equal(
    await config(client, ['cernanto/llm-prompt/openai', 'token=sk-live-1']),
    'cernanto/llm-prompt/openai/token set\n',
  );
  assert.equal(
    await config(client, ['cernanto/trace', 'retention-minutes=null']),
    'cernanto/trace/retention-minutes removed\n',
  );
});

test('no words print the map of every agent, an agent prints its own settings, and each says when nothing stands', async () => {
  const empty = fakeClient({ configuration: {} });
  assert.equal(await config(empty, []), 'the configuration is empty\n');
  assert.deepEqual(empty.calls[0], { operation: 'configList' });
  const full = fakeClient({
    configuration: { 'cernanto/trace': { 'retention-minutes': 60 } },
  });
  assert.equal(
    await config(full, []),
    `${JSON.stringify({ 'cernanto/trace': { 'retention-minutes': 60 } }, null, 2)}\n`,
  );
  const place = fakeClient({ configuration: { 'retention-minutes': 60 } });
  assert.equal(
    await config(place, ['cernanto/trace']),
    `${JSON.stringify({ 'retention-minutes': 60 }, null, 2)}\n`,
  );
  assert.deepEqual(place.calls[0], { operation: 'configList', place: 'cernanto/trace' });
  const bare = fakeClient({ configuration: {} });
  assert.equal(
    await config(bare, ['examples/workflows/helpdesk/bot']),
    'examples/workflows/helpdesk/bot has no settings and no default\n',
  );
});
