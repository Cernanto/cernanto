// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The traces on a laptop: each life's in a SQLite file of its own,
// `<root>/traces/<service>.<life>.sqlite`, written by every process
// that runs the agent or charges it, and read by the trace agent
// alone. A part is one transaction: the save first, then the records,
// the facts and the links. The file is made at the life's birth and
// removed at its end. A writer opens it for a part and closes it after
// the part, since a file some process holds open is one a system may
// refuse to remove; it never makes the file, so a part for a life that
// ended is answered `ended` and writes nothing.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { LifePart, SaveAnswer, Traces } from '../../substrate.js';
import { NoSuchFile, TRIM_EVERY_MS, TracesDatabase } from './database.js';
import { lifeFileName } from './logs.js';

/** The folder each life's traces lie in under a root. */
export function tracesFolderOf(root: string): string {
  return join(root, 'traces');
}

/** Whether the database said it is busy or locked. */
function busy(error: unknown): boolean {
  const said = error as { errcode?: unknown; errstr?: unknown; message?: unknown } | undefined;
  return (
    said?.errcode === 5 ||
    said?.errcode === 6 ||
    (typeof said?.errstr === 'string' && /locked|busy/i.test(said.errstr)) ||
    (typeof said?.message === 'string' && /database is locked|busy/i.test(said.message))
  );
}

export class SqliteTraces implements Traces {
  private readonly folder: string;
  /** When this process last trimmed each life's file of its expired
   * rows: the next trim of a file comes a minute after its last. */
  private readonly trimmed = new Map<string, number>();

  constructor(folder: string) {
    this.folder = folder;
  }

  private pathOf(service: string, life: string): string {
    return join(this.folder, lifeFileName(service, life));
  }

  write(part: LifePart): Promise<SaveAnswer> {
    const path = this.pathOf(part.service, part.life);
    let file: TracesDatabase;
    try {
      file = new TracesDatabase(path);
    } catch (error) {
      if (!(error instanceof NoSuchFile)) return Promise.resolve('unknown');
      // The file is not there: the life ended.
      this.trimmed.delete(path);
      return Promise.resolve('ended');
    }
    try {
      const now = Date.now();
      const trim = now - (this.trimmed.get(path) ?? 0) >= TRIM_EVERY_MS;
      file.writePart(part, trim);
      if (trim) this.trimmed.set(path, now);
      return Promise.resolve('taken');
    } catch (error) {
      if (busy(error)) return Promise.resolve('unknown');
      // A file removed between the look and the write: the life ended.
      if (!existsSync(path)) return Promise.resolve('ended');
      return Promise.resolve('unknown');
    } finally {
      file.close();
    }
  }

  close(): Promise<void> {
    this.trimmed.clear();
    return Promise.resolve();
  }
}
