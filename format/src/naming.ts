// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The naming rules several sides speak: the substrate's name for an
// agent and the shape of an agent path. The runtime keeps its own copy
// of the rule, since the plane runs without this kit.

/** The substrate's name for an agent: every foreign character an
 * underscore, so `cernanto/gateway` serves as `cernanto_gateway`. */
export function serviceNameOf(agentId: string): string {
  return agentId.replaceAll(/[^A-Za-z0-9]/g, '_');
}

/** Matches an agent path such as `payments/payment-retry`: kebab-case
 * segments joined by `/`, the spec's folder path from the workspace
 * root, at any depth; a single segment is a spec at the root. A last
 * segment `tests` is refused: `<agent id>/tests` is the place of an
 * agent's tester in the plane's configuration. */
export const AGENT_PATH_PATTERN =
  /^(?!(?:.*\/)?tests$)[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** Matches a registry package name such as `acme/fact-check`: a
 * publisher's scope, then the name, kebab-case segments joined by `/`,
 * at least two of them (a registry name always carries its scope). */
export const REGISTRY_NAME_PATTERN =
  /^(?!(?:.*\/)?tests$)[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
