// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The one shape an outside attempt answers: a generated module reaching
// a service that is not an agent (an OpenAPI document's operation, an
// MCP server's tool) sends plain http whose fetches journal beneath the
// standard forms, and each lane's wire helper (lanes/openapi/http.ts,
// lanes/mcp/protocol.ts) answers this outcome: the value, or a refusal
// that will not change on a retry. Transient trouble is thrown instead:
// the helper throws retryable and the module's ordinary retry loop
// tries again with a fresh request.

/** One attempt's outcome: the answer, or a refusal that will not
 * change on a retry. */
export type OutsideOutcome<T> =
  | { ok: T }
  | {
      failed: {
        kind: 'terminal';
        message: string;
        /** The http status behind an http refusal, when there is one:
         * a generated module tells a refused credential (401/403) from
         * any other refusal by it. */
        status?: number;
        /** An mcp server demanding a sign-in: the generated module
         * refreshes or signs the account in and tries again; the
         * resource metadata url the server named, when it named one. */
        signIn?: { resourceMetadataUrl?: string };
      };
    };
