// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { z } from 'zod';

import { declaredAnswerOf } from './declared-answer.js';

/** The closed set of error classes every thrown platform error carries. */
export const ERROR_KINDS = [
  'terminal',
  'retryable',
  'judgment-inconclusive',
  'contract-violation',
  'target-unavailable',
] as const;

/** One of the platform error classes. */
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** The wire shape of a classified error. */
export const errorEnvelopeSchema = z.object({
  kind: z.enum(ERROR_KINDS),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  retryAfterMs: z.number().int().positive().optional(),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * The base error every component throws. The `kind` decides retry and
 * surfacing behavior everywhere; a plain error is terminal.
 *
 * @example
 * throw new CernantoError({ kind: 'retryable', message: 'gateway unreachable', retryAfterMs: 5000 });
 */
export class CernantoError extends Error {
  readonly kind: ErrorKind;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'CernantoError';
    this.kind = envelope.kind;
    this.details = envelope.details;
    this.retryAfterMs = envelope.retryAfterMs;
  }

  /** Returns the serializable wire shape of this error. */
  toEnvelope(): ErrorEnvelope {
    return {
      kind: this.kind,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }),
    };
  }
}

/**
 * The platform classification an error carries, whatever its class: a
 * {@link CernantoError}'s own kind, or a plain Error whose `kind`
 * property names one of the platform kinds. Generated code cannot
 * construct CernantoError (it imports no platform package), so a
 * plain `Error` tagged `error.kind = 'terminal'` is its way of saying
 * the same thing; an unknown or absent kind answers undefined and the
 * error keeps default semantics.
 */
export function errorKindOf(value: unknown): ErrorKind | undefined {
  if (value instanceof CernantoError) return value.kind;
  if (value instanceof Error) {
    const kind = (value as { kind?: unknown }).kind;
    if (typeof kind === 'string' && (ERROR_KINDS as readonly string[]).includes(kind)) {
      return kind as ErrorKind;
    }
  }
  return undefined;
}

/** Narrows an unknown thrown value to a {@link CernantoError}. */
export function isCernantoError(value: unknown): value is CernantoError {
  return value instanceof CernantoError;
}

/** The failure codes of a reach that never got an answer: the
 * connection refused or reset, the name unresolved, the peer gone, the
 * client's own connect and header deadlines. The captures and the
 * kernel tag such a failure retryable where they know its meaning; the
 * code's own abort or deadline is a different failure. */
const TRANSPORT_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** A thrown value's words: its message, and its cause's after a colon
 * when the cause says something the message does not (undici's `fetch
 * failed` names its reason there, and a caller reads the reason). A
 * chain of causes that comes back around ends where it does. */
export function errorWords(error: unknown): string {
  return wordsOf(error, new Set());
}

function wordsOf(error: unknown, seen: Set<unknown>): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: unknown } | null)?.cause;
  seen.add(error);
  if (cause === undefined || cause === null || seen.has(cause)) return message;
  const code = (cause as { code?: unknown }).code;
  const words =
    typeof cause === 'string'
      ? cause
      : `${wordsOf(cause, seen)}${typeof code === 'string' && !String((cause as { message?: unknown }).message).includes(code) ? ` (${code})` : ''}`;
  return words === '' || message.includes(words) ? message : `${message}: ${words}`;
}

/** The failures that came out of a secret call, kept beside them: a
 * thrown object is marked without being touched, so a frozen one is
 * marked like any other. */
const secretFailures = new WeakSet<object>();

/** Marks a failure that came out of a secret call (the contract's
 * `Secret<T>` mark on the function): its words may carry the secret,
 * so every record written of it from here on carries its kind alone.
 * The failure itself is untouched: the code that catches it, the
 * journal that replays it and the caller that is answered with it read
 * its own words. A thrown value that is no object cannot be told from
 * its equals, so it leaves as an Error carrying its words, as a
 * failure that crossed the wire does.
 * @param error - The thrown value as it left the secret call.
 * @returns The failure to throw on: the same object, marked, or an
 *   Error of the value's words.
 * @example throw markSecretFailure(error);
 */
export function markSecretFailure(error: unknown): unknown {
  const failure = typeof error === 'object' && error !== null ? error : new Error(String(error));
  secretFailures.add(failure);
  return failure;
}

/** Whether a failure came out of a secret call: itself, or, for a
 * failure that wraps another, the one it names as its cause, however
 * deep.
 * @param error - A thrown value.
 * @returns True when the value or a cause of it carries the mark.
 * @example if (isSecretFailure(error)) return;
 */
export function isSecretFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    if (secretFailures.has(current)) return true;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** A failure as a record carries it: its words and its stack, or, for
 * a failure that came out of a secret call, its kind alone.
 * @param error - The thrown value.
 * @returns The record's `error` words and, when it has one to show, its `stack`.
 * @example emitTrace({ ...record, ...failureForRecord(error) });
 */
export function failureForRecord(error: unknown): { error: string; stack?: string } {
  if (isSecretFailure(error)) {
    return {
      error: `a secret call failed (${errorKindOf(error) ?? 'terminal'}); its words stay out of the records`,
    };
  }
  return {
    error: errorWords(error),
    ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
  };
}

/** The transport code a thrown value carries, on itself or on its
 * cause, when it is one of the known codes. */
function transportCodeOf(error: unknown): string | undefined {
  for (const carrier of [error, (error as { cause?: unknown } | null)?.cause]) {
    const code = (carrier as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && TRANSPORT_CODES.has(code)) return code;
  }
  return undefined;
}

/** The one retry rule of the kernel, read by the journal for a
 * command's failure and by the runner for a handler's: a failure
 * tagged `retryable` or `target-unavailable` unwinds the attempt and
 * the plane runs it again; a declared answer (an integer http status
 * the contract declares) is the callee's word and stands, whatever
 * else it carries; every other failure is terminal, recorded as a
 * command's failed completion inside a handler and catchable there,
 * the call's end when the handler lets it out. */
export function retriesAttempt(error: unknown): boolean {
  if (declaredAnswerOf(error) !== undefined) return false;
  const kind =
    typeof error === 'object' && error !== null ? (error as { kind?: unknown }).kind : undefined;
  if (kind === 'retryable' || kind === 'target-unavailable') return true;
  // A reach that got no answer (the code on the error or its cause: a
  // refused or reset connection, a name unresolved, a timeout of the
  // transport) is the wire's trouble: the attempt is repeated, the road
  // the network road's failures take.
  return transportCodeOf(error) !== undefined;
}
