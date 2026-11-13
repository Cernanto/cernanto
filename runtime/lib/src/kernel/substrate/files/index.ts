// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The laptop's substrate, `files-sqlite`: the records in the plane's
// database, each life's journals and traces in databases of its own
// under the root's `journals` and `traces`, the objects on files under
// the root.

import { lchownSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import type { Logs, Substrate } from '../../substrate.js';
import { JournalDatabase, PlaneDatabase, TracesDatabase } from './database.js';
import { SqliteLogs, lifeFileName } from './logs.js';
import { FileObjects } from './objects.js';
import { FileRecords } from './records.js';
import { SqliteTraces, tracesFolderOf } from './traces.js';

/** What the opener is handed: the plane's root. */
export interface FilesSubstrateOptions {
  root: string;
}

/** The plane's database file under a root. */
export function databaseFileOf(root: string): string {
  return join(root, 'plane.sqlite');
}

/** The folder each life's journal database lies in under a root. */
export function journalsFolderOf(root: string): string {
  return join(root, 'journals');
}

export { tracesFolderOf };

/** Removes a database file with the companions its write-ahead mode
 * keeps, and answers whether they are gone. A file some process still
 * holds open is one a system may refuse to remove (`EBUSY`): it stays,
 * with its companions, for a later ask. */
function removeDatabaseFile(file: string): boolean {
  for (const path of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      unlinkSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY') return false;
      if (code !== 'ENOENT') throw error;
    }
  }
  return true;
}

/** What a process of root's made under the plane is handed to the
 * plane's owner, the owner of its root, so the agents' copies, which run
 * as that owner, open it to write; a link is never followed. */
function ownedByThePlane(paths: readonly string[], root: string): void {
  if (process.getuid?.() !== 0) return;
  const { uid, gid } = statSync(root);
  for (const path of paths) {
    try {
      lchownSync(path, uid, gid);
    } catch {
      // Gone meanwhile: nothing to hand over.
    }
  }
}

/** Opens the files substrate under a root. */
export function openFilesSubstrate(options: FilesSubstrateOptions): Substrate {
  const db = new PlaneDatabase(databaseFileOf(options.root));
  const journals = journalsFolderOf(options.root);
  const tracesFolder = tracesFolderOf(options.root);
  const logs = new Map<string, SqliteLogs>();
  const records = new FileRecords(db);
  const traces = new SqliteTraces(tracesFolder);
  const logsOf = (life: string): Logs => {
    let held = logs.get(life);
    if (held === undefined) {
      held = new SqliteLogs(journals, life);
      logs.set(life, held);
    }
    return held;
  };
  return {
    logsOf,
    records,
    objects: new FileObjects(options.root),
    traces,
    beginLife: (service, life) => {
      const journal = join(journals, lifeFileName(service, life));
      const traced = join(tracesFolder, lifeFileName(service, life));
      new JournalDatabase(journal, true).close();
      new TracesDatabase(traced, true).close();
      ownedByThePlane([journals, tracesFolder, journal, traced], options.root);
      return Promise.resolve();
    },
    removeLife: async (service, life) => {
      // The traces first: a writer's next part finds no file and stops.
      // The journal goes once the life's own copies, which hold it open
      // while they run, are gone; until then the answer asks again.
      const traced = removeDatabaseFile(join(tracesFolder, lifeFileName(service, life)));
      await logs.get(life)?.close();
      logs.delete(life);
      const journaled = removeDatabaseFile(join(journals, lifeFileName(service, life)));
      return traced && journaled;
    },
    close: async () => {
      for (const held of logs.values()) await held.close();
      logs.clear();
      await traces.close();
      db.close();
    },
  };
}
