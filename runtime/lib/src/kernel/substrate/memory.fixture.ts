// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The logs in memory: the seam's rules with no store behind them, for
// the model of the proofs and the unit tier, and for them alone: a
// fixture by its name, which no package ships. The same meanings as the
// two implementors keep (files and SQLite on a laptop, DynamoDB on a
// server): one head per log, a grant issued by the head, the ownership
// taken by the grant, the append under the head's three conditions,
// the truncation to the floor, the retirement against the captured
// head, the head never deleted.

import { LogRefusal } from '../substrate.js';
import type { CapturedHead, LogHead, LogRow, LogType, Logs } from '../substrate.js';

interface MemoryLog {
  head: LogHead;
  rows: Map<number, LogRow>;
}

export class MemoryLogs implements Logs {
  private readonly logs = new Map<string, MemoryLog>();

  private logOf(log: string): MemoryLog | undefined {
    return this.logs.get(log);
  }

  issue(log: string): Promise<number> {
    let held = this.logs.get(log);
    if (held === undefined) {
      held = { head: { owner: '', launch: 0, issued: 0, last: 0, floor: 0 }, rows: new Map() };
      this.logs.set(log, held);
    }
    held.head.issued += 1;
    return Promise.resolve(held.head.issued);
  }

  own(log: string, attempt: string, launch: number): Promise<LogHead> {
    const held = this.logOf(log);
    if (held === undefined)
      return Promise.reject(
        new LogRefusal('grant', `the log ${log} issued no grant: nothing owns it`),
      );
    const { head } = held;
    if (head.owner === attempt && head.launch === launch) return Promise.resolve({ ...head });
    if (launch > head.launch && launch <= head.issued) {
      head.owner = attempt;
      head.launch = launch;
      return Promise.resolve({ ...head });
    }
    return Promise.reject(
      new LogRefusal(
        'grant',
        `the grant ${String(launch)} cannot take the log ${log}: its owner holds ${String(head.launch)} and ${String(head.issued)} were issued`,
        { ...head },
      ),
    );
  }

  append(log: string, attempt: string, seq: number, type: LogType, text: string): Promise<void> {
    const held = this.logOf(log);
    if (held === undefined || held.head.owner !== attempt)
      return Promise.reject(
        new LogRefusal(
          'owner',
          `the log ${log} is owned by ${held?.head.owner ?? 'nobody'}, not by ${attempt}`,
          held === undefined ? undefined : { ...held.head },
        ),
      );
    const { head } = held;
    if (head.last !== seq - 1 || seq <= head.floor)
      return Promise.reject(
        new LogRefusal(
          'moved',
          `the log ${log} stands at ${String(head.last)} (floor ${String(head.floor)}), not at ${String(seq - 1)}`,
          { ...head },
        ),
      );
    held.rows.set(seq, { seq, type, text });
    head.last = seq;
    return Promise.resolve();
  }

  read(log: string, from: number): Promise<{ head: LogHead | undefined; rows: LogRow[] }> {
    const held = this.logOf(log);
    if (held === undefined) return Promise.resolve({ head: undefined, rows: [] });
    const start = Math.max(from, held.head.floor);
    const rows = [...held.rows.values()].filter((row) => row.seq >= start);
    rows.sort((a, b) => a.seq - b.seq);
    return Promise.resolve({ head: { ...held.head }, rows });
  }

  truncate(log: string, attempt: string, below: number): Promise<void> {
    const held = this.logOf(log);
    if (held === undefined || held.head.owner !== attempt)
      return Promise.reject(
        new LogRefusal(
          'owner',
          `the log ${log} is owned by ${held?.head.owner ?? 'nobody'}, not by ${attempt}`,
        ),
      );
    if (below <= held.head.floor) return Promise.resolve();
    held.head.floor = below;
    for (const seq of [...held.rows.keys()]) if (seq < below) held.rows.delete(seq);
    return Promise.resolve();
  }

  retire(log: string, captured: CapturedHead): Promise<boolean> {
    const held = this.logOf(log);
    if (held === undefined) return Promise.resolve(false);
    const { head } = held;
    if (head.launch !== captured.launch || head.last !== captured.last)
      return Promise.resolve(false);
    for (const seq of [...held.rows.keys()]) if (seq <= captured.last) held.rows.delete(seq);
    head.floor = Math.max(head.floor, captured.last);
    return Promise.resolve(true);
  }

  list(prefix: string): Promise<{ log: string; head: LogHead }[]> {
    const found: { log: string; head: LogHead }[] = [];
    for (const [log, held] of this.logs) {
      if (log.startsWith(prefix)) found.push({ log, head: { ...held.head } });
    }
    return Promise.resolve(found);
  }

  count(log: string, from: number): Promise<number> {
    const held = this.logOf(log);
    if (held === undefined) return Promise.resolve(0);
    const start = Math.max(from, held.head.floor);
    let count = 0;
    for (const seq of held.rows.keys()) if (seq >= start) count += 1;
    return Promise.resolve(count);
  }

  /** The heads, for a proof's reading. */
  headOf(log: string): LogHead | undefined {
    const held = this.logOf(log);
    return held === undefined ? undefined : { ...held.head };
  }
}
