// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The records on the plane's database: compare-and-set on the exact
// value a write rests on. A removed document stays a minute as a row
// with no value, so its revision goes on growing, and every read leaves
// it out. Nothing reads the file on a clock: the removed documents are
// swept inside a write that lands, at most once a minute in a process.

import type { PlaneDatabase } from './database.js';
import type { RecordRead, Records } from '../../substrate.js';

/** How long after one sweep the next may run. */
const SWEEP_EVERY_MS = 60_000;

export class FileRecords implements Records {
  private readonly db: PlaneDatabase;
  private swept = 0;

  constructor(db: PlaneDatabase) {
    this.db = db;
  }

  read(key: string): Promise<RecordRead> {
    const row = this.db.document(key);
    return Promise.resolve(
      row === undefined
        ? { value: null, revision: 0 }
        : { value: row.value, revision: row.revision },
    );
  }

  write(
    key: string,
    value: string | null,
    expected: string | null,
  ): Promise<{ ok: boolean; current: RecordRead }> {
    return Promise.resolve(
      this.db.transaction(() => {
        const row = this.db.document(key);
        const standing = row?.value ?? null;
        if (standing !== expected) {
          return { ok: false, current: { value: standing, revision: row?.revision ?? 0 } };
        }
        if (value === null && row === undefined)
          return { ok: true, current: { value: null, revision: 0 } };
        const revision = this.db.putDocument(key, value);
        this.sweepNow();
        return { ok: true, current: { value, revision } };
      }),
    );
  }

  list(prefix: string): Promise<{ entries: { key: string; value: string; revision: number }[] }> {
    return Promise.resolve({
      entries: this.db
        .documents(prefix)
        .map((row) => ({ key: row.key, value: row.value ?? '', revision: row.revision })),
    });
  }

  /** Sweeps the removed documents inside the write under way, once the
   * minute since the last sweep is over. */
  private sweepNow(): void {
    const now = Date.now();
    if (now - this.swept < SWEEP_EVERY_MS) return;
    this.swept = now;
    try {
      this.db.sweep(now);
    } catch {
      // Swept at a later write.
    }
  }
}
