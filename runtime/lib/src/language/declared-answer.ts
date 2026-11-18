// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A declared answer: an agent that implements an openapi document
// answers one of the document's error statuses by throwing an Error
// carrying that `status` (and the declared `body`, when any). The
// substrate carries a failure as a message alone, so the answer rides
// the message's tail as one marked line, and every reader of a failure
// takes it back off: the caller sees the words the code threw, with
// `status` and `body` beside them, and the gateway answers the status the
// document declares.

/** What a thrown error declares: an integer status in the http range
 * and, when the error carries one, a body. */
interface DeclaredAnswer {
  status: number;
  body?: unknown;
}

/** The declared answer a thrown value carries, when it carries one:
 * an object (an Error or not) with an integer `status` from 100 to
 * 599; `body` is taken as it is when present. */
export function declaredAnswerOf(error: unknown): DeclaredAnswer | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    return undefined;
  }
  const body = (error as { body?: unknown }).body;
  return body === undefined ? { status } : { status, body };
}

/** The message a failure travels with: the words, then the declared
 * answer on its own marked line. A body that cannot be serialized
 * (a cycle) travels without the body. */
