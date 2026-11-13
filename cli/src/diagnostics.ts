// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The diagnostics: what a compile or a deploy ends on,
// rendered the way a compiler ends. One line per issue in the form
// every compiler prints and every editor parses: the author's file,
// the line when the issue names one, the level word, then the
// message; the notes beneath it, indented; and the count last.

function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The level word of a diagnostic's line: `error` where it refuses,
 * else `warning`. */
export function levelOf(line: string): 'warning' | 'error' {
  return /: error: /.test(line) ? 'error' : 'warning';
}

/**
 * The line with its level word colored the way compilers color theirs,
 * `warning:` bold yellow and `error:` bold red, when the output is a
 * terminal; a pipe gets the plain line.
 *
 * @param line - A warning line.
 * @param terminal - Whether the output is a terminal (stdout's by default).
 * @returns The line, colored or as it was.
 * @example
 * colored('ops/greeter.cern.md:3:14: warning: what is answered?');
 */
export function colored(line: string, terminal: boolean = process.stdout.isTTY): string {
  if (!terminal) return line;
  return line
    .replace(': warning: ', ': \u001b[1;33mwarning:\u001b[0m ')
    .replace(': error: ', ': \u001b[1;31merror:\u001b[0m ');
}

/** A diagnostic as the summary prints it: its line, then its notes
 * beneath it, indented (the plan's remedy for a spec issue). */
export interface Diagnostic {
  line: string;
  notes?: string[];
}

/**
 * A spec issue of the plan as a diagnostic: the author's page by its
 * path, the line when the plan read the issue from one, the severity
 * word, the message, and the plan's remedy as its note. The issue's
 * code is for programs and rides the json output alone.
 *
 * @param issue - The issue as the compile answered it.
 * @param pathOf - The author's page for an agent id, when the workspace holds one.
 * @returns The diagnostic.
 * @example
 * issueDiagnostic(issue, (id) => specPaths[id]);
 */
export function issueDiagnostic(
  issue: {
    severity: 'error' | 'warning';
    agentId: string;
    message: string;
    line?: number;
    hint?: string;
  },
  pathOf: (agentId: string) => string | undefined,
): Diagnostic {
  const path = pathOf(issue.agentId) ?? issue.agentId;
  const where = issue.line === undefined ? '' : `:${String(issue.line)}`;
  const hint = issue.hint?.trim() ?? '';
  return {
    line: `${path}${where}: ${issue.severity}: ${squeeze(issue.message)}`,
    ...(hint === '' ? {} : { notes: [hint] }),
  };
}

/**
 * The summary a compile or a deploy ends on: each
 * diagnostic's line, its notes indented beneath it, then the count on
 * the last line (`1 warning`, `2 errors`, `1 error, 2 warnings`), the
 * way compilers end. Empty when there are none.
 *
 * @param items - The diagnostics, in order: a bare line is a diagnostic without notes.
 * @param terminal - Whether the output is a terminal (stdout's by default).
 * @returns The text with its newlines, or an empty string.
 * @example
 * process.stdout.write(diagnosticsSummary([...warnings, ...issues]));
 */
export function diagnosticsSummary(
  items: (string | Diagnostic)[],
  terminal: boolean = process.stdout.isTTY,
): string {
  if (items.length === 0) return '';
  const diagnostics = items.map((item) => (typeof item === 'string' ? { line: item } : item));
  const lines: string[] = [];
  for (const item of diagnostics) {
    lines.push(colored(item.line, terminal));
    for (const note of item.notes ?? []) lines.push(`  ${note}`);
  }
  return `${lines.join('\n')}\n${diagnosticsCount(diagnostics.map((item) => item.line))}\n`;
}

/** The count of diagnostics by their level word: `1 error`, `2
 * warnings`, `1 error, 2 warnings`. */
export function diagnosticsCount(lines: string[]): string {
  const errors = lines.filter((line) => levelOf(line) === 'error').length;
  const warnings = lines.length - errors;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${String(errors)} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${String(warnings)} warning${warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
}
