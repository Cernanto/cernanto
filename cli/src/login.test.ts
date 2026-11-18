// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { loginTargetOf, planeUrlOf } from './login.js';
import type { LoginProbes } from './login.js';

test('a plane url needs no scheme: the port and the scheme are inferred, an explicit scheme stands', () => {
  assert.equal(planeUrlOf('10.0.1.10'), 'http://10.0.1.10:7434');
  assert.equal(planeUrlOf('10.0.1.10:18434'), 'http://10.0.1.10:18434');
  assert.equal(planeUrlOf('127.0.0.1'), 'http://127.0.0.1:7434');
  assert.equal(planeUrlOf('https://plane.example.com/'), 'https://plane.example.com');
  assert.equal(planeUrlOf(' plane.acme.com '), 'http://plane.acme.com:7434');
  // A plane has one address: a list is refused.
  assert.throws(
    () => planeUrlOf('10.0.1.10, 10.0.2.10'),
    /login takes one url; a plane has one address/,
  );
});

test('a plane url keeps the port as written, and an IPv6 address reads bare or in brackets', () => {
  assert.equal(planeUrlOf('plane.acme.com:80'), 'http://plane.acme.com:80');
  assert.equal(planeUrlOf('::1'), 'http://[::1]:7434');
  assert.equal(planeUrlOf('fe80::1'), 'http://[fe80::1]:7434');
  assert.equal(planeUrlOf('[::1]:18434'), 'http://[::1]:18434');
  assert.throws(() => planeUrlOf('plane.acme.com/gateway'), /does not read as a plane's address/);
  assert.throws(() => planeUrlOf('https://'), /does not read as a url/);
});

/** A probe that records what it was asked and answers as scripted. */
function scripted(
  answer: { ok: true } | { ok: false; reason: string },
): LoginProbes & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    answers: (url) => {
      asked.push(url);
      return Promise.resolve(answer);
    },
  };
}

test('a login reads the plane once, on the url its requests will use', async () => {
  const bare = scripted({ ok: true });
  assert.deepEqual(await loginTargetOf('plane.acme.com', bare), {
    url: 'http://plane.acme.com:7434',
  });
  assert.deepEqual(bare.asked, ['http://plane.acme.com:7434']);
  // An https url is saved as written: a plane behind TLS is held to
  // this machine's own trust, with nothing more to give.
  const secure = scripted({ ok: true });
  assert.deepEqual(await loginTargetOf('https://plane.acme.com/', secure), {
    url: 'https://plane.acme.com',
  });
  assert.deepEqual(secure.asked, ['https://plane.acme.com']);
  const six = scripted({ ok: true });
  await loginTargetOf('[::1]:18434', six);
  assert.deepEqual(six.asked, ['http://[::1]:18434']);
});

test('a plane that does not answer saves nothing, in words that say what to check', async () => {
  await assert.rejects(
    loginTargetOf('plane.acme.com', scripted({ ok: false, reason: 'ECONNREFUSED' })),
    /the plane at plane.acme.com:7434 did not answer \(ECONNREFUSED\).*a plane behind TLS is written with its https url/,
  );
  await assert.rejects(
    loginTargetOf(
      'https://plane.acme.com',
      scripted({ ok: false, reason: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    ),
    /the plane at plane.acme.com did not answer over https \(DEPTH_ZERO_SELF_SIGNED_CERT\).*its certificate is one this machine trusts/,
  );
});

test('the real read: a plane that answers plain http is saved, and a closed port is refused', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    assert.deepEqual(await loginTargetOf(`127.0.0.1:${String(port)}`), {
      url: `http://127.0.0.1:${String(port)}`,
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  // The port is free again: nothing answers on it.
  await assert.rejects(
    loginTargetOf(`127.0.0.1:${String(port)}`),
    /did not answer \(ECONNREFUSED\)/,
  );
});
