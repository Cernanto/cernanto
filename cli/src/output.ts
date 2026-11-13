// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { relative, sep } from 'node:path';

import { CernantoError, isCernantoError } from '@cernanto/package-format';
import { system } from '@cernanto/system';

// The output contract: human tables by default, `-o json` with the
// api's own stable shapes, `--no-headers` for scripts. Exit codes: 0
// success, 1 failure, 2 usage, 3 problems found.

export interface OutputOptions {
  output?: string;
  noHeaders?: boolean;
}

/** The output options a command's flags name. */
export function outputOf(options: { output?: string; headers?: boolean }): OutputOptions {
  return {
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.headers === false ? { noHeaders: true } : {}),
  };
}

/** Whether a person sits at this terminal: the prompts and the
 * narrated forms are for a person; a pipe gets the plain form. */
export function interactive(): boolean {
  return process.stdout.isTTY && process.stdin.isTTY;
}

/** The shell a command the cli prints is pasted into on this machine. */
export function commandShell(): 'posix' | 'windows' {
  return system.name === 'windows' ? 'windows' : 'posix';
}

/** A file under the folder a command runs from, as the cli prints it:
 * relative to that folder and spelled with `/` on every system, the
 * way an agent's id is. */
export function shownPath(path: string): string {
  return relative(process.cwd(), path).split(sep).join('/');
}

/** The exit a failure ends the command with: 1, or the one a failure
 * names for itself (`exit`, a whole number above zero), so a script
 * tells that failure from every other. */
export function exitOf(error: unknown): number {
  const named =
    error !== null && typeof error === 'object' && 'exit' in error ? error.exit : undefined;
  return typeof named === 'number' && Number.isInteger(named) && named > 0 ? named : 1;
}

/** Prints a failure in the platform's words and exits, by `exitOf`. */
export function fail(error: unknown): never {
  if (isCernantoError(error)) {
    process.stderr.write(`error (${error.kind}): ${error.message}\n`);
  } else {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(exitOf(error));
}

/** The plane's refusal of an id nothing is deployed as, in the words a
 * person reads; any other failure as it is. */
export function asNotDeployed(error: unknown, agentId: string): unknown {
  if (!isCernantoError(error) || !error.message.includes(`no agent "${agentId}"`)) return error;
  return new CernantoError({
    kind: 'terminal',
    message: `nothing is deployed as "${agentId}" (list what runs with: cernanto ls)`,
  });
}

/** A refused call in the cli's words: an id nothing is deployed as
 * names the listing, and a function the agent does not have names the
 * card that lists its functions. Any other refusal keeps the plane's
 * own words. */
export function asRefusedCall(error: unknown, agentId: string, fn: string): unknown {
  const words = asNotDeployed(error, agentId);
  if (words !== error || !isCernantoError(error)) return words;
  const missing = `agent "${agentId}" has no function "${fn}"`;
  if (!error.message.startsWith(missing)) return error;
  return new CernantoError({
    kind: 'terminal',
    message: `${missing} (list its functions with: cernanto contract ${agentId})`,
  });
}

/** Renders rows as an aligned table, or the raw value as json. */
export function render(
  value: unknown,
  table: { headers: string[]; rows: string[][] },
  options: OutputOptions,
): string {
  if (options.output === 'json') {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  const lines: string[][] =
    options.noHeaders === true ? table.rows : [table.headers, ...table.rows];
  if (lines.length === 0) return '';
  const widths: number[] = [];
  for (const line of lines) {
    line.forEach((cell, column) => {
      widths[column] = Math.max(widths[column] ?? 0, cell.length);
    });
  }
  return `${lines
    .map((line) =>
      line
        .map((cell, column) =>
          column === line.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n')}\n`;
}

// The small formatters the verbs share: the clock, the date, an
// elapsed span, and a name or a handler spelled as words. The chat of
// a trace is rendered on the plane (the gateway's `view`); these shape
// the cli's own tables and headers only.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseTime(at: string): number | undefined {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? undefined : ms;
}

/** `HH:MM:SS`, local or utc; eight spaces for a text that is not a time. */
export function timeOfDay(at: string, utc?: boolean): string {
  const ms = parseTime(at);
  if (ms === undefined) return '        ';
  const date = new Date(ms);
  return utc === true
    ? `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
    : `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** The IANA name of this machine's time zone (`Asia/Tokyo`), what
 * the plane's view renders its clocks in for this reader; none when
 * the system cannot say. */
export function localZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone === '' ? undefined : zone;
  } catch {
    return undefined;
  }
}

/** `YYYY-MM-DD HH:MM:SS`, local, or utc marked ` UTC`; the text itself
 * when it is not a time. */
export function dateTime(at: string, utc?: boolean): string {
  const ms = parseTime(at);
  if (ms === undefined) return at;
  const date = new Date(ms);
  if (utc === true) {
    const day = `${String(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
    return `${day} ${timeOfDay(at, true)} UTC`;
  }
  const day = `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `${day} ${timeOfDay(at)}`;
}

/** An elapsed span as the tables show it: whole seconds, then minutes
 * and seconds, then hours and minutes; never below zero. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m${pad2(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h${pad2(minutes % 60)}m`;
}

/** A camelCase, snake_case or kebab-case name as capitalized words. */
export function readableName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** A handler's name as words: an `ai` prefix dropped, the words spaced
 * and lowercased, the first capitalized. */
export function spokenHandler(handler: string): string {
  const words = readableName(handler.replace(/^ai(?=[A-Z])/, '')).toLowerCase();
  return words === '' ? '' : words.charAt(0).toUpperCase() + words.slice(1);
}

/** An agent id as a display name: an api or mcp agent by its kind, any
 * other by its last segment. */
export function agentDisplayName(agentId: string): string {
  if (agentId.startsWith('openapi/'))
    return `${readableName(agentId.slice('openapi/'.length))} API`;
  if (agentId.startsWith('mcp/')) return `${readableName(agentId.slice('mcp/'.length))} MCP`;
  const segments = agentId.split('/');
  return readableName(segments[segments.length - 1] ?? agentId);
}
