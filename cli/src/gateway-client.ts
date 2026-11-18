// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { LookupFunction } from 'node:net';

import { CernantoError, ERROR_KINDS, bearerHeaders } from '@cernanto/package-format';
import type { ErrorKind } from '@cernanto/package-format';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';

import { currentContext } from './context.js';
import { createClient, createConfig } from './gateway/client/index.js';
import type { Client } from './gateway/client/index.js';

// The transport under the generated gateway client (src/gateway, from the
// gateway's OpenAPI document): the plane this process talks to, the one
// send every request to the plane goes through (its bearer, an
// unreachable plane named in the operator's
// words), the long-haul dispatcher for calls that lawfully run for an
// hour, and the mapping of the error envelope onto the platform's error
// kinds. Every command speaks to the plane through the generated
// functions over one of the two clients made here, and the streams read
// by hand go through the same send.

/** The plane a client talks to: its url and its bearer token. A plane
 * behind TLS is held to this machine's own trust. */
export interface Plane {
  baseUrl: string;
  token: string | undefined;
}

/** The plane on this machine, when no context names one. */
const LOCAL_DOOR = 'http://127.0.0.1:7434';

/** The plane this process targets: the current context, else the
 * plane on this machine. */
export function currentPlane(): Plane {
  const context = currentContext();
  return context === undefined
    ? { baseUrl: LOCAL_DOOR, token: undefined }
    : { baseUrl: context.server, token: context.token };
}

/** True for a plane reached on this machine's loopback: the local
 * plane. A cluster is reached by a name. */
export function isLoopbackPlane(plane: Plane): boolean {
  try {
    const host = new URL(plane.baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

/** How a plane failed to answer, in the operator's words. */
function unreachableWord(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } } | undefined)?.cause;
  const code = cause?.code;
  if (code === 'ECONNREFUSED') return 'connection refused (nothing listens on the port)';
  if (
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    (error as { name?: string } | undefined)?.name === 'TimeoutError'
  ) {
    return 'timed out (a firewall or a wrong address)';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'the name does not resolve';
  if (code !== undefined && code.startsWith('ERR_TLS')) return `tls: ${cause?.message ?? code}`;
  if (cause?.message !== undefined && /certificate|tls|ssl/i.test(cause.message))
    return `tls: ${cause.message}`;
  return cause?.message ?? (error instanceof Error ? error.message : String(error));
}

/** The failure of a plane that did not answer at all. The local plane
 * is "not running" only when nothing listens on its port; any other
 * failure (a connection the gateway reset mid-request, a timeout) is
 * named by its cause, so it is told from a parked plane. */
export function unreachable(plane: Plane, error: unknown): CernantoError {
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return new CernantoError({
    kind: 'retryable',
    message: !isLoopbackPlane(plane)
      ? `the plane at ${plane.baseUrl} did not answer: ${unreachableWord(error)}`
      : code === 'ECONNREFUSED'
        ? `the local plane is not running; start it with: cernanto dev`
        : `the local plane did not answer: ${unreachableWord(error)}`,
  });
}

/** What the cli does when the local plane does not answer: starts it,
 * once per process, and the request goes again. The dev verb registers
 * it. */
let onLoopbackDown: (() => Promise<boolean>) | undefined;
let loopbackTried = false;

export function whenLoopbackDown(handler: (() => Promise<boolean>) | undefined): void {
  onLoopbackDown = handler;
  loopbackTried = false;
}

/** Whether the fetch may go again after the local plane was started:
 * only a refused connection to a loopback plane, only once. */
async function startedLoopback(plane: Plane, error: unknown): Promise<boolean> {
  if (onLoopbackDown === undefined || loopbackTried || !isLoopbackPlane(plane)) return false;
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  if (code !== 'ECONNREFUSED') return false;
  loopbackTried = true;
  try {
    return await onLoopbackDown();
  } catch {
    return false;
  }
}

/** The plane's token as its context holds it now: the local
 * plane's start saves a context, and the requests after it carry that
 * token. */
function refreshed(plane: Plane): void {
  let context: ReturnType<typeof currentContext>;
  try {
    context = currentContext();
  } catch {
    return;
  }
  if (context === undefined || context.server !== plane.baseUrl) return;
  plane.token = context.token;
}

/** The dispatchers of this process, one per kind: the ordinary
 * one, and the long-haul one for calls that wait on a handler (an
 * invoke, a stream), an hour on headers and body in place of undici's
 * five minutes, so a long tester or worker run answers. */
const dispatchers = new Map<string, UndiciAgent>();
function dispatcherOf(longHaul: boolean): UndiciAgent {
  const key = longHaul ? 'long' : 'ordinary';
  let dispatcher = dispatchers.get(key);
  if (dispatcher === undefined) {
    dispatcher = new UndiciAgent({
      // An ordinary request the plane holds without an answer ends in
      // two minutes, as a failure the caller may make again; a long-haul
      // one waits an hour for its handler.
      ...(longHaul
        ? { headersTimeout: 60 * 60_000, bodyTimeout: 60 * 60_000 }
        : { headersTimeout: 120_000, bodyTimeout: 120_000 }),
      connect: { lookup: walkingLookup, timeout: 5000 },
    });
    dispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

/** The address walk: a plane's name
 * resolves to every server's address, and Node's fetch connects
 * to the first alone. The dispatcher resolves the name to all of its
 * addresses, tries them in the order the walk keeps, remembers the one
 * that answered for the session and moves on to the next when a
 * connection fails. The local plane, reached on the loopback, resolves
 * to one address and walks nothing. */
const preferred = new Map<string, string>();
const resolved = new Map<string, string[]>();

async function addressesOf(hostname: string): Promise<string[]> {
  const known = resolved.get(hostname);
  if (known !== undefined) return known;
  const { lookup } = await import('node:dns/promises');
  const found = await lookup(hostname, { all: true, verbatim: true });
  const addresses = found.map((entry) => entry.address);
  resolved.set(hostname, addresses);
  return addresses;
}

/** The lookup the dispatcher connects with: the preferred address of
 * the name first. */
const walkingLookup: LookupFunction = (hostname, options, callback) => {
  const answer = callback;
  void addressesOf(hostname).then(
    (addresses) => {
      const first = preferred.get(hostname) ?? addresses[0];
      if (first === undefined) {
        answer(
          Object.assign(new Error(`${hostname} resolves to no address`), { code: 'ENOTFOUND' }),
          '',
        );
        return;
      }
      const family = first.includes(':') ? 6 : 4;
      if ((options as { all?: boolean }).all === true) answer(null, [{ address: first, family }]);
      else answer(null, first, family);
    },
    (error: unknown) => {
      answer(error as NodeJS.ErrnoException, '');
    },
  );
};

/** Moves the walk on to the next address of a name after a connection
 * failed; answers whether there was one to move to. */
function walkOn(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  const addresses = resolved.get(hostname);
  if (addresses === undefined || addresses.length < 2) return false;
  const current = preferred.get(hostname) ?? addresses[0];
  const at = addresses.indexOf(current ?? '');
  const next = addresses[(at + 1) % addresses.length];
  if (next === undefined || next === current) return false;
  preferred.set(hostname, next);
  return true;
}

/** Whether a failure is a connection that never opened: the walk moves
 * on for these alone. */
function connectionFailed(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

/** Whether the other side closed the connection before it answered: a
 * gateway copy leaving while the next takes its place, a connection
 * the plane had kept open and then dropped. */
function closedBeforeAnAnswer(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === 'UND_ERR_SOCKET' || code === 'ECONNRESET' || code === 'EPIPE';
}

/** How often a read goes again after the plane closed its connection
 * unanswered, and the pause before each, a multiple of it. */
const CLOSED_READ_TRIES = 3;
const CLOSED_READ_PAUSE_MS = 400;

/** The parts of one request, kept so that it can be issued again. */
interface RequestParts {
  url: string;
  method: string;
  headers: [string, string][];
  body: Uint8Array | undefined;
  signal: AbortSignal | undefined;
}

/** The request the generated client compiled, as its parts: a request's
 * body can be read once, and the undici package's fetch reads only its
 * own Request class. */
async function partsOf(request: Request): Promise<RequestParts> {
  const bodyless = request.method === 'GET' || request.method === 'HEAD';
  const body = bodyless ? undefined : new Uint8Array(await request.arrayBuffer());
  return {
    url: request.url,
    method: request.method,
    headers: [...request.headers.entries()],
    body: body === undefined || body.byteLength === 0 ? undefined : body,
    signal: request.signal,
  };
}

/** How one request is sent: over the long-haul dispatcher or the
 * ordinary one, and under a time limit when it has one. */
interface SendOptions {
  longHaul: boolean;
  timeoutMs?: number | undefined;
}

/** The signal one issue of a request runs under: the caller's own
 * stop, and a time limit that starts at the issue. */
function limitOf(
  stop: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (timeoutMs === undefined) return stop;
  const limit = AbortSignal.timeout(timeoutMs);
  return stop === undefined ? limit : AbortSignal.any([stop, limit]);
}

/** One request to the plane: the plane's bearer on it, and a plane
 * that did not answer named in the operator's
 * words. A refused connection to the local plane starts it once, and
 * the request goes again with the token the start saved. A read whose
 * connection the plane closed before it answered goes again, a few
 * times; a request that changes the plane never does. A time limit
 * runs from each issue, so the request that goes again has the whole
 * of it. */
async function send(plane: Plane, parts: RequestParts, options: SendOptions): Promise<Response> {
  const issue = (): Promise<Response> => {
    const signal = limitOf(parts.signal, options.timeoutMs);
    return undiciFetch(parts.url, {
      method: parts.method,
      headers: [
        ...parts.headers.filter(([name]) => name.toLowerCase() !== 'authorization'),
        ...Object.entries(bearerHeaders(plane.token)),
      ],
      ...(parts.body === undefined ? {} : { body: parts.body }),
      ...(signal === undefined ? {} : { signal }),
      dispatcher: dispatcherOf(options.longHaul),
    });
  };
  // The walk: a connection that never opened goes again at the next
  // address of the plane's name, once per address.
  let walked = 0;
  // A read the plane closed its connection on, unanswered, goes again:
  // a gateway copy that leaves while the next takes its place drops the
  // connections it had not answered yet, and a read asks for the same
  // thing twice at no cost. A request that changes the plane never goes
  // again by itself: whether it arrived is not known.
  const read = parts.method === 'GET' || parts.method === 'HEAD';
  let closed = 0;
  for (;;) {
    try {
      return await issue();
    } catch (error) {
      if (connectionFailed(error) && walked < 8 && walkOn(parts.url)) {
        walked += 1;
        continue;
      }
      if (
        read &&
        closedBeforeAnAnswer(error) &&
        closed < CLOSED_READ_TRIES &&
        parts.signal?.aborted !== true
      ) {
        closed += 1;
        await new Promise((resolve) => {
          setTimeout(resolve, CLOSED_READ_PAUSE_MS * closed);
        });
        continue;
      }
      if (await startedLoopback(plane, error)) {
        refreshed(plane);
        try {
          return await issue();
        } catch (retried) {
          throw unreachable(plane, retried);
        }
      }
      throw unreachable(plane, error);
    }
  }
}

/** One read of the plane outside the generated client (a stream read
 * by hand), through the same send as every other request.
 * @param plane - The plane to ask.
 * @param url - The whole url of the read.
 * @param options - `signal` stops the read; `longHaul` holds it open
 *   for as long as a handler may run.
 * @example const response = await planeFetch(plane, `${plane.baseUrl}/healthz`);
 */
export async function planeFetch(
  plane: Plane,
  url: string,
  options: { signal?: AbortSignal; longHaul?: boolean; json?: unknown } = {},
): Promise<Response> {
  // A request with a JSON body is a post; one without, a read.
  const posted = 'json' in options;
  return send(
    plane,
    {
      url,
      method: posted ? 'POST' : 'GET',
      headers: posted ? [['content-type', 'application/json']] : [],
      body: posted ? new TextEncoder().encode(JSON.stringify(options.json ?? {})) : undefined,
      signal: options.signal,
    },
    { longHaul: options.longHaul === true },
  );
}

/** The clients of one plane: `client` for ordinary calls, `longHaul`
 * for the ones that wait on a handler, and `within` for a call under
 * a time limit. All name an unreachable plane the same way and send
 * the bearer when the plane has one. */
export interface GatewayClients {
  plane: Plane;
  client: Client;
  longHaul: Client;
  /** The ordinary client under a time limit: each request has `ms`
   * from the moment it is issued, the one that goes again after the
   * local plane started included. */
  within(ms: number): Client;
}

export function gatewayClients(plane: Plane): GatewayClients {
  const make = (options: SendOptions): Client =>
    createClient(
      createConfig({
        baseUrl: plane.baseUrl,
        throwOnError: false,
        fetch: (async (request: Request) =>
          send(plane, await partsOf(request), options)) as typeof fetch,
      }),
    );
  const limited = new Map<number, Client>();
  return {
    plane,
    client: make({ longHaul: false }),
    longHaul: make({ longHaul: true }),
    within: (ms: number): Client => {
      let client = limited.get(ms);
      if (client === undefined) {
        client = make({ longHaul: false, timeoutMs: ms });
        limited.set(ms, client);
      }
      return client;
    },
  };
}

/** What a generated function answers: the parsed body when the plane
 * said ok and the body was read, else what went wrong beside the
 * response: the error body of a refusal, or the failure of the read of
 * an answer the plane gave. */
export interface GatewayResult<T> {
  data?: T | undefined;
  error?: unknown;
  /** Absent only when the request never reached a response, which
   * the transport turns into an error before the result exists. */
  response?: Response | undefined;
}

/** The error envelope, as every route answers it. */
interface ErrorBody {
  error?: { kind?: string; message?: string };
  dependents?: string[];
}

/** The kind an envelope names when it is one of the platform's, so a
 * caller that retries reads the plane's own word; terminal otherwise. */
function kindOf(body: ErrorBody): ErrorKind {
  const kind = body.error?.kind;
  return typeof kind === 'string' && (ERROR_KINDS as readonly string[]).includes(kind)
    ? (kind as ErrorKind)
    : 'terminal';
}

/** The failure of an answer the plane gave and this process could not
 * read, undefined for any other result: the plane said ok, and its
 * body was cut on the way or is not what the route answers. Nothing of
 * the answer is known, so the same request may go again. */
export function unread(result: GatewayResult<unknown>, path: string): CernantoError | undefined {
  if (result.response?.ok !== true || result.error === undefined) return undefined;
  const cause = result.error instanceof Error ? result.error.message : '';
  return new CernantoError({
    kind: 'retryable',
    message: `the plane's answer for ${path} could not be read${cause === '' ? '' : `: ${cause}`}`,
  });
}

/** The answer of a call the plane accepted; a refusal becomes the
 * platform's error with the plane's own kind and words (the dependents
 * of a refused removal named beside them), and an answer that could
 * not be read a failure of its own, never an empty answer. */
export function unwrap<T>(result: GatewayResult<T>, path: string): T {
  const lost = unread(result, path);
  if (lost !== undefined) throw lost;
  if (result.response?.ok === true) return result.data as T;
  // No response at all: the transport's own failure (the plane did not
  // answer), kept in the generated client's error slot; it is the error
  // to throw.
  if (result.response === undefined && result.error instanceof Error) throw result.error;
  const body = (
    typeof result.error === 'object' && result.error !== null ? result.error : {}
  ) as ErrorBody;
  const dependents =
    body.dependents === undefined || body.dependents.length === 0
      ? ''
      : ` (dependents: ${body.dependents.join(', ')})`;
  throw new CernantoError({
    kind: kindOf(body),
    message:
      (body.error?.message ?? `the plane answered ${statusOf(result)} for ${path}`) + dependents,
  });
}

/** Whether the plane accepted the call and its answer was read. */
export function accepted(result: GatewayResult<unknown>): boolean {
  return result.response?.ok === true && result.error === undefined;
}

/** The status the plane answered, as text; `nothing` when no response
 * came back. */
export function statusOf(result: GatewayResult<unknown>): string {
  return result.response === undefined ? 'nothing' : String(result.response.status);
}
