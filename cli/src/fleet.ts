// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// What several verbs read off the fleet listing: which rows are a
// verify's testers, which agents compose a module, and the age word
// of a table.

/** Whether a row is a verify's tester, `<target>-tester-<compile>-r<round>`:
 * machinery, not the operator's fleet. */
export function isTesterRow(agentId: string): boolean {
  return /-tester-[^/]+-r\d+$/.test(agentId);
}

/** The agents whose newest generation composes each module, off the
 * fleet's generations: the carriers the plane itself names, by
 * module, each list sorted. */
export function carriersByComposition(
  generations: { agentId?: string; gen: number; composition?: Record<string, string> }[],
): Map<string, string[]> {
  const newest = new Map<string, (typeof generations)[number]>();
  for (const generation of generations) {
    if (generation.agentId === undefined) continue;
    const known = newest.get(generation.agentId);
    if (known === undefined || generation.gen > known.gen) {
      newest.set(generation.agentId, generation);
    }
  }
  const carriers = new Map<string, string[]>();
  for (const [agentId, generation] of newest) {
    for (const moduleId of Object.keys(generation.composition ?? {})) {
      carriers.set(moduleId, [...(carriers.get(moduleId) ?? []), agentId]);
    }
  }
  for (const list of carriers.values()) list.sort();
  return carriers;
}

/** The deployed agents whose newest generation composes a module: what
 * the card names as "composed into" for a module row. */
export function composedIntoOf(
  generations: { agentId?: string; gen: number; composition?: Record<string, string> }[],
  moduleId: string,
): string[] {
  return carriersByComposition(generations).get(moduleId) ?? [];
}

/** The age word of a table: the largest single unit, `-` when
 * it never happened. Tables show age; `-o json` keeps the iso. */
export function age(iso: string | undefined, now: Date): string {
  if (iso === undefined) return '-';
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}
