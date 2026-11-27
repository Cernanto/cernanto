// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { createClient, createConfig } from '../gateway/client/index.js';
import type { Client } from '../gateway/client/index.js';
import type { ErrorEnvelope } from '../gateway/types.gen.js';

// The plane this page was served by: the UI speaks to the gateway at
// its own origin and to nothing else, through the functions made from
// the gateway's own document.

/** Where the page stands. Outside a browser there is no page, and the
 * address is a local plane's. */
const here: { origin: string; host: string } =
  typeof window === 'undefined'
    ? { origin: 'http://127.0.0.1:7434', host: '127.0.0.1:7434' }
    : window.location;

/** The address the browser reached the plane at. */
export const PLANE_ORIGIN: string = here.origin;

/** The address as a reader says it: the host and the port. */
export const PLANE_ADDRESS: string = here.host;

// WHETHER THE PLANE IS REACHED is known from what the page asks of it,
// and from nothing asked for that alone: every request the page makes
// of the plane is heard. One that gets no answer says the plane is not
// reached, and the next that gets one, of any kind, says it is again.

/** Whether the plane answered the last thing this page asked of it. */
export interface PlaneReach {
  answered: boolean;
  /** What the browser said of the request that got no answer. */
  cause?: string;
}

let reach: PlaneReach = { answered: true };
const reachHeard = new Set<() => void>();

function tellReach(next: PlaneReach): void {
  if (next.answered === reach.answered && next.cause === reach.cause) return;
  reach = next;
  for (const listener of reachHeard) listener();
}

/** The reach as it stands. */
export function planeReach(): PlaneReach {
  return reach;
}

/** Hears every change of the reach, and answers the way to stop hearing. */
export function onPlaneReach(listener: () => void): () => void {
  reachHeard.add(listener);
  return () => {
    reachHeard.delete(listener);
  };
}

/** The words of a request the plane did not answer. */
export function unansweredWords(cause: string): string {
  return `The plane did not answer${cause === '' ? '' : ` (${cause})`}.`;
}

/**
 * Asks the plane as `fetch` does, and hears what came of it: an answer
 * of any kind says the plane is reached, and a request that got none
 * says it is not. A request the page itself gave up says nothing.
 */
export const askPlane: typeof fetch = async (input, init) => {
  try {
    const response = await globalThis.fetch(input, init);
    tellReach({ answered: true });
    return response;
  } catch (error) {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted !== true) {
      tellReach({ answered: false, cause: error instanceof Error ? error.message : '' });
    }
    throw error;
  }
};

/** The client every generated function is called with. */
export const plane: Client = createClient(
  createConfig({ baseUrl: PLANE_ORIGIN, throwOnError: false, fetch: askPlane }),
);

/** A failure the plane answered, or the failure to reach it. */
export class PlaneError extends Error {
  /** The plane's own kind, absent when it named none. */
  readonly kind: ErrorEnvelope['kind'];
  /** The status the plane answered; 0 when nothing came back. */
  readonly status: number;
  /** The agents that depend on one whose removal was refused. */
  readonly dependents: string[];

  constructor(
    message: string,
    options: { kind?: ErrorEnvelope['kind']; status?: number; dependents?: string[] } = {},
  ) {
    super(message);
    this.name = 'PlaneError';
    this.kind = options.kind;
    this.status = options.status ?? 0;
    this.dependents = options.dependents ?? [];
  }

  /** Whether the plane did not answer at all. */
  get unreachable(): boolean {
    return this.status === 0;
  }
}

/** What a generated function answers. */
export interface GatewayResult<T> {
  data?: T | undefined;
  error?: unknown;
  response?: Response | undefined;
}

interface ErrorBody {
  error?: { kind?: ErrorEnvelope['kind']; message?: string };
  dependents?: string[];
}

/** The failure a refusal's body and status say, in the plane's own
 * words when it gave any. */
export function refusalOf(status: number, body: unknown, what: string): PlaneError {
  const envelope = (typeof body === 'object' && body !== null ? body : {}) as ErrorBody;
  return new PlaneError(
    envelope.error?.message ?? `The plane answered ${String(status)} for ${what}.`,
    {
      status,
      ...(envelope.error?.kind === undefined ? {} : { kind: envelope.error.kind }),
      ...(envelope.dependents === undefined ? {} : { dependents: envelope.dependents }),
    },
  );
}

/**
 * The answer of a request the plane accepted. A refusal is thrown with
 * the plane's own kind and words; a plane that did not answer is
 * thrown as unreachable.
 */
export function unwrap<T>(result: GatewayResult<T>, what: string): T {
  const response = result.response;
  if (response === undefined) {
    const cause = result.error instanceof Error ? result.error.message : '';
    throw new PlaneError(unansweredWords(cause));
  }
  if (response.ok && result.error === undefined) return result.data as T;
  if (response.ok) {
    throw new PlaneError(`The plane's answer for ${what} could not be read.`, {
      status: response.status,
      kind: 'retryable',
    });
  }
  throw refusalOf(response.status, result.error, what);
}

/** The words of any failure, for a line on the screen. */
export function wordsOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something went wrong.';
}
