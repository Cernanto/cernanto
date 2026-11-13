// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { readCernPackage } from '@cernanto/package-format';

import type {
  CompileProgressResponse,
  CompileStepRecord,
  PlaneCompileResponse,
} from '../gateway/types.gen.js';
import type { TraceRecord } from '../gateway/types.gen.js';
import type { CompileClient } from './upload.js';

// The plane as the deploy tests see it: a compile submits, its narration
// is read off the document the fixture scripts (the steps so far, then
// done on a schedule), the harness streams deliver what the fixture
// scripts, the store keeps what was put, and a landing answers the row
// of the uploaded package by its manifest.

export function responseOf(overrides?: Partial<PlaneCompileResponse>): PlaneCompileResponse {
  return {
    protocol: 0,
    status: 'ok',
    issues: [],
    agents: [
      { agentId: 'ops/greeter', status: 'compiled', attempts: 1, triageCount: 0, costUsd: 0.5 },
    ],
    rows: [
      {
        agentId: 'ops/greeter',
        artifact: 'sha256:abc',
        handlers: ['greet'],
        uses: [],
      },
    ],
    ...overrides,
  };
}

/** One narrated step of a compile, as the gateway answers it. */
export function progressOf(
  attemptId: string,
  seq: number,
  fields: {
    step: CompileStepRecord['step'];
    state: CompileStepRecord['state'];
    detail: string;
    subject?: string;
    ok?: boolean;
  },
): CompileStepRecord {
  return {
    attemptId,
    seq,
    at: new Date(1_700_000_000_000 + seq).toISOString(),
    ...fields,
  };
}

export type FakePlane = CompileClient & {
  landings: { body: { target?: string; targets?: string[]; installed?: boolean } }[];
  submitted: unknown[];
  /** Which operation each submit went through. */
  verbs: ('compile' | 'deploy')[];
  watchesOpened: number;
  stopped: number;
  /** How many times the narration was read, and how many reads took it. */
  progressReads: number;
  taken: number;
  store: Map<string, Buffer>;
  /** What a landing refuses, by agent id. */
  refusals: Map<string, string>;
};

export function fakeCompileClient(script: {
  callId: string;
  /** The narration the document holds: every read answers all of it. */
  steps?: CompileStepRecord[];
  /** The harness streams' records, for the screen's activity lines. */
  stream?: TraceRecord[];
  /** The read on which the compile reads as ended. */
  doneAfter: number;
  response?: PlaneCompileResponse;
  error?: string;
}): FakePlane {
  const client: FakePlane = {
    submitted: [] as unknown[],
    verbs: [] as ('compile' | 'deploy')[],
    watchesOpened: 0,
    stopped: 0,
    progressReads: 0,
    taken: 0,
    refusals: new Map<string, string>(),
    compile: (request: unknown) => {
      client.submitted.push(request);
      client.verbs.push('compile');
      return Promise.resolve({ callId: script.callId });
    },
    deploy: (request: unknown) => {
      client.submitted.push(request);
      client.verbs.push('deploy');
      return Promise.resolve({ callId: script.callId });
    },
    // The compile's document: running until the scripted read, then done
    // with the answer or failed with the error.
    compileProgress: (compileId: string, options?: { take?: boolean; call?: string }) => {
      client.progressReads += 1;
      if (options?.take === true) client.taken += 1;
      const steps = script.steps ?? [];
      const ended = client.progressReads >= script.doneAfter;
      const answer: CompileProgressResponse = {
        compileId,
        callId: script.callId,
        status: !ended ? 'running' : script.error === undefined ? 'done' : 'failed',
        steps,
        ...(ended && script.response !== undefined ? { answer: script.response } : {}),
        ...(ended && script.error !== undefined ? { error: { message: script.error } } : {}),
      };
      return Promise.resolve(answer);
    },
    callsStream: (
      _agentId: string,
      options: {
        backlog?: number;
        onOpen?: () => void;
        onEnd?: (error?: unknown) => void;
      },
      onRecord: (record: TraceRecord) => void,
    ) => {
      client.watchesOpened += 1;
      options.onOpen?.();
      // The stream delivers a record per tick, the way a tail does.
      const stream = script.stream ?? [];
      let index = 0;
      const timer = setInterval(() => {
        const record = stream[index];
        index += 1;
        if (record === undefined) {
          clearInterval(timer);
          return;
        }
        onRecord(record);
      }, 1);
      return () => {
        client.stopped += 1;
        clearInterval(timer);
      };
    },
    store: new Map<string, Buffer>(),
    packageExists: (digest: string) => Promise.resolve(client.store.has(digest)),
    packagePut: (digest: string, bytes: Buffer) => {
      client.store.set(digest, bytes);
      return Promise.resolve();
    },
    packageGet: (digest: string) => {
      const bytes = client.store.get(digest);
      return bytes === undefined
        ? Promise.reject(new Error(`no artifact ${digest}`))
        : Promise.resolve(bytes);
    },
    landings: [] as { body: { target?: string; targets?: string[]; installed?: boolean } }[],
    land: (body: { target?: string; targets?: string[]; installed?: boolean }) => {
      client.landings.push({ body });
      const landed: { agentId: string; version: string; digest: string }[] = [];
      for (const target of body.targets ?? [body.target ?? '']) {
        const bytes = client.store.get(target);
        if (bytes === undefined) {
          return Promise.reject(new Error(`${target} is not a package the plane holds`));
        }
        const { manifest } = readCernPackage(bytes);
        const refused = client.refusals.get(manifest.name);
        if (refused !== undefined) return Promise.reject(new Error(refused));
        landed.push({ agentId: manifest.name, version: manifest.version, digest: target });
      }
      return Promise.resolve({ landed, resolved: [], warnings: [] });
    },
  };
  return client;
}
