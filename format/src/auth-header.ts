// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The one convention every component shares: a bearer token rides the
// authorization header, and the token's absence means an open local
// plane. Callers resolve the token their own way and pass it through
// here, so every fetch site builds the header the same way.

/** Headers for a token-bearing request; empty when there is no token. */
export function bearerHeaders(token: string | undefined): Record<string, string> {
  return token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` };
}
