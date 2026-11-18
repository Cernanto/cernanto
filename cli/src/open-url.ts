// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import open from 'open';

// The connect flows (harness sign-ins, MCP account consents) hand the
// operator an authorize url; this opens it in their default browser,
// through the package that knows each system's opener.

/** What opens a url: the package's own, or a proof's. */
type Opener = (url: string) => Promise<unknown>;

/** Opens a url in the operator's default browser. On a machine with no
 * opener (a server reached over ssh) the url is the operator's to open:
 * every caller prints it beside the ask, and a failure to open stops
 * nothing. */
export function openInBrowser(url: string, opener: Opener = open): void {
  void Promise.resolve()
    .then(() => opener(url))
    .catch(() => undefined);
}
