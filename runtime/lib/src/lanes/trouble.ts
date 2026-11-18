// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What an http answer says of trouble that may pass, read the same way
// by the two lanes: which statuses are asked again, and the wait a
// server asked for. What each lane does with them stays that lane's:
// the words of its failure, and whether its ladder keeps the wait.

/** Whether a status is trouble that may pass: a timeout, a request
 * come too early, too many requests, or a failure of the server's own.
 * The request is asked again, where any other refusal will not change
 * on a retry. */
export function statusMayPass(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** The wait a server asked for before the next request, in
 * milliseconds: its `retry-after`, where it gives seconds above zero. */
export function retryAfterMsOf(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
}
