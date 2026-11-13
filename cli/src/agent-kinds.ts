// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

/** Author-facing names; serialized rows retain their wire kinds. */
export function agentKindName(kind: string | undefined): string {
  if (kind === 'task') return 'agent';
  if (kind === 'service' || kind === undefined) return 'stateful';
  return kind;
}
