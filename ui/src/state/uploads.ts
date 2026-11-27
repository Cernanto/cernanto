// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { readPackageBytes, readPackageFile } from '../api/queries.js';
import { fileStandings, filesTrouble, MAX_UPLOAD_BYTES, namedFiles } from '../model/files.js';
import type { PackageRecord, WaitingFile } from '../model/files.js';
import { MANIFEST, weightWord } from '../model/package.js';
import type { Uploads } from './compiles.js';
import { base64Of, readBytes } from './files.js';

/**
 * Gathers the files a source names, as a deploy sends them: each at its
 * place in a workspace. A file chosen in this browser is read from where
 * the browser keeps it; any other is read back from the package the
 * agent runs, which carries it. A line with no file behind it, a file
 * the browser no longer keeps and files heavier together than a deploy
 * takes each fail the gathering in words, before anything is sent.
 *
 * @param base - The package the agent runs; none for an agent never deployed.
 * @param waiting - The files chosen in this browser that wait for the deploy.
 */
export async function gatherUploads(options: {
  agentId: string;
  text: string;
  waiting: readonly WaitingFile[];
  base: string | undefined;
}): Promise<Uploads> {
  const { agentId, text, waiting, base } = options;
  // What the package carries is asked only of a source that names a file.
  if (namedFiles(text, agentId).length === 0) return { files: {}, sent: [] };
  let record: PackageRecord | undefined;
  if (base !== undefined) {
    const manifest = JSON.parse(await readPackageFile(base, MANIFEST)) as {
      record?: PackageRecord;
    };
    record = manifest.record;
  }
  const standings = fileStandings(text, agentId, waiting, record);
  const trouble = filesTrouble(standings);
  if (trouble !== undefined) throw new Error(trouble);
  const files: Record<string, string> = {};
  const sent: string[] = [];
  let weight = 0;
  for (const line of standings) {
    for (const file of line.files) {
      weight += file.size;
      if (weight > MAX_UPLOAD_BYTES) {
        throw new Error(
          `The files this source names weigh more than ${weightWord(MAX_UPLOAD_BYTES)} together, which is all a deploy takes.`,
        );
      }
      let bytes: Blob | undefined;
      if ('waiting' in file.from) {
        bytes = await readBytes(file.from.waiting);
        if (bytes === undefined) {
          throw new Error(
            `${line.named.entry}: this browser no longer keeps the file chosen for it. Choose it again.`,
          );
        }
        sent.push(file.from.waiting);
      } else if (base !== undefined) {
        bytes = await readPackageBytes(base, file.from.carried);
      }
      if (bytes !== undefined) files[file.place] = await base64Of(bytes);
    }
  }
  return { files, sent };
}
