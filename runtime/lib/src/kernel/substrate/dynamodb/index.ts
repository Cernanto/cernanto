// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The cloud substrate, `dynamodb-s3`: the journals, the records and the
// traces in one DynamoDB table, the objects in one S3 bucket. Nothing
// above the seam knows which store it speaks.

import type { Logs, Substrate } from '../../substrate.js';
import { DynamoLogs } from './logs.js';
import { S3Objects } from './objects.js';
import { DynamoRecords } from './records.js';
import { PlaneTable } from './table.js';
import type { DynamoSubstrateOptions } from './table.js';
import { DynamoTraces } from './traces.js';

export type { DynamoSubstrateOptions } from './table.js';

/** How long one removal ask of a life's logs works. */
const REMOVAL_BUDGET_MS = 20_000;

/** Opens the cloud substrate on a table and a bucket. */
export function openDynamoSubstrate(options: DynamoSubstrateOptions): Substrate {
  const table = new PlaneTable(options);
  const records = new DynamoRecords(table);
  const traces = new DynamoTraces(table);
  const logs = new Map<string, DynamoLogs>();
  const logsOf = (life: string): DynamoLogs => {
    let held = logs.get(life);
    if (held === undefined) {
      held = new DynamoLogs(table, life);
      logs.set(life, held);
    }
    return held;
  };
  return {
    logsOf: (life): Logs => logsOf(life),
    records,
    objects: new S3Objects(table),
    traces,
    // The record is the gate on the servers: a life keeps nothing before
    // it is named.
    beginLife: () => Promise.resolve(),
    removeLife: async (_service, life) => {
      // The journal's logs first, each head before its rows, then the
      // traces once their wait has passed.
      if (!(await logsOf(life).removeAll(Date.now() + REMOVAL_BUDGET_MS))) return false;
      return traces.remove(life);
    },
    close: () => {
      table.close();
      return Promise.resolve();
    },
  };
}
