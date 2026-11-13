// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { fail } from './output.js';
import { writePrivateFile } from './private-file.js';

// Contexts: each names a plane
// (its url and its bearer token). `cernanto dev` saves one for the box
// it brings up and `cernanto login` one for a plane the user did not
// start; `context` lists them or switches, `--context <name>` picks one
// for a single run. The file is the one place the cli remembers a
// plane.

export interface PlaneContext {
  server: string;
  token?: string;
}

interface ContextsFile {
  current?: string;
  contexts: Record<string, PlaneContext>;
}

/** Where the contexts live: under the user's cernanto folder. */
export function contextsPath(): string {
  return join(homedir(), '.cernanto', 'contexts.json');
}

/** The refusal of a contexts file that does not read: the planes it
 * names stay in it for the operator to recover. */
function unreadable(file: string, why: string): Error {
  return new Error(
    `${file} does not read as the cli's contexts (${why}); it is left as it is: fix it, or move it away and log in again`,
  );
}

/** Whether a parsed value has the shape of the contexts file: a
 * mapping of planes, each with its url, and the current one's name. */
function isContextsFile(value: unknown): value is ContextsFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (data['current'] !== undefined && typeof data['current'] !== 'string') return false;
  const contexts = data['contexts'];
  if (typeof contexts !== 'object' || contexts === null || Array.isArray(contexts)) return false;
  return Object.values(contexts).every((context: unknown) => {
    if (typeof context !== 'object' || context === null) return false;
    const row = context as Record<string, unknown>;
    return (
      typeof row['server'] === 'string' &&
      row['server'] !== '' &&
      (row['token'] === undefined || typeof row['token'] === 'string')
    );
  });
}

/** The contexts a file holds: none when the file is absent. A file
 * that is there and does not read as contexts is refused in words, so
 * a command neither falls back to the local plane nor writes over it. */
function read(file: string): ContextsFile {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { contexts: {} };
    throw unreadable(file, error instanceof Error ? error.message : String(error));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw unreadable(file, error instanceof Error ? error.message : String(error));
  }
  if (!isContextsFile(parsed)) {
    throw unreadable(file, 'a "contexts" mapping of planes, each with its "server", was expected');
  }
  return parsed;
}

function write(file: string, data: ContextsFile): void {
  writePrivateFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Saves a context and makes it current. */
export function saveContext(
  name: string,
  context: PlaneContext,
  file: string = contextsPath(),
): void {
  const data = read(file);
  data.contexts[name] = context;
  data.current = name;
  write(file, data);
}

/** Switches the current context; throws when it does not exist. */
export function useContext(name: string, file: string = contextsPath()): PlaneContext {
  const data = read(file);
  const context = data.contexts[name];
  if (context === undefined) {
    throw new Error(
      `no context named "${name}"; create one with: cernanto login <url> --token <token> --name ${name}`,
    );
  }
  data.current = name;
  write(file, data);
  return context;
}

/** Every context with the current one marked. */
export function listContexts(
  file: string = contextsPath(),
): { name: string; server: string; current: boolean }[] {
  const data = read(file);
  return Object.entries(data.contexts)
    .map(([name, context]) => ({ name, server: context.server, current: name === data.current }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A context named for this process only (`--context <name>`): the file
 * stays as it is. */
let overridden: string | undefined;

export function overrideContext(name: string | undefined): void {
  overridden = name;
}

/** The context selected for this process, including a command-line override. */
export function currentContextName(file: string = contextsPath()): string | undefined {
  return overridden ?? read(file).current;
}

/** The current context, when one is selected. A selection that names
 * no saved context is refused, whether the command line or the file
 * made it, so a command reaches only the plane that was meant. */
export function currentContext(file: string = contextsPath()): PlaneContext | undefined {
  const data = read(file);
  const name = overridden ?? data.current;
  if (name === undefined) return undefined;
  const context = data.contexts[name];
  if (context === undefined) {
    throw new Error(
      overridden === undefined
        ? `the current context "${name}" names no plane in ${file}; switch to one with: cernanto context <name>, or save it again with: cernanto login <url> --token <token> --name ${name}`
        : `no context named "${overridden}"; cernanto context lists them`,
    );
  }
  return context;
}

/** The name a context takes when the login names none: the plane's
 * host, with its port when it is not the usual one. */
export function contextNameOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port === '' || parsed.port === '7434'
      ? parsed.hostname
      : `${parsed.hostname}:${parsed.port}`;
  } catch {
    return url;
  }
}

/** `cernanto context [name]`: list the planes this machine knows, or
 * switch to one. */
export function registerContext(program: Command): void {
  program
    .command('context')
    .argument('[name]', 'context to switch to; empty lists them')
    .description('the planes this machine knows; switch the current one')
    .action((name: string | undefined) => {
      try {
        if (name !== undefined) {
          const context = useContext(name);
          process.stdout.write(`context "${name}" -> ${context.server} (current)\n`);
          return;
        }
        const contexts = listContexts();
        if (contexts.length === 0) {
          process.stdout.write('no contexts; the cli talks to the local plane\n');
          return;
        }
        for (const context of contexts) {
          process.stdout.write(
            `${context.current ? '*' : ' '} ${context.name}\t${context.server}\n`,
          );
        }
      } catch (error) {
        fail(error);
      }
    });
}
