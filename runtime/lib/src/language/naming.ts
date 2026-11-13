// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
// The naming rule as the runtime runs it: the substrate service of an
// agent id. The client kit spells the same rule for the package format,
// in a package of its own.

/** The substrate service name of an agent id. */
export function serviceNameOf(agentId: string): string {
  return agentId.replaceAll(/[^A-Za-z0-9]/g, '_');
}
