// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

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
