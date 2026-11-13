// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { test } from 'node:test';

import { openInBrowser } from './open-url.js';

test('opening a url spawns the platform opener with the url as one argument', () => {
  const spawned: { command: string; args: string[] }[] = [];
  const spawnFn = ((command: string, args: string[]) => {
    spawned.push({ command, args });
    return { unref() {}, on() {} } as unknown as ChildProcess;
  }) as unknown as typeof import('node:child_process').spawn;
  const url = 'http://127.0.0.1:7434/v1/oauth/consent?state=abc&client_id=def&scope=read';
  openInBrowser(url, spawnFn);
  const call = spawned[0];
  assert.ok(call);
  // Whatever the platform opener is, the url rides as a single
  // argument of a program that is no shell, so a query string with
  // its `&` reaches the browser whole: a shell would end its command
  // at the first one.
  assert.ok(call.args.includes(url));
  assert.ok(!['cmd', 'cmd.exe', 'sh', 'bash', 'powershell'].includes(call.command), call.command);
});

test('a machine with no opener leaves the url to the operator: the process goes on', async () => {
  // The opener is a program this machine does not have: the spawn
  // reports it on the child a moment later.
  const missing = ((_command: string, _args: string[], options: object) =>
    spawn('cernanto-no-such-opener', [], options)) as unknown as typeof spawn;
  openInBrowser('http://127.0.0.1:7434/v1/oauth/consent?state=abc', missing);
  await new Promise((resolve) => setTimeout(resolve, 200));
});
