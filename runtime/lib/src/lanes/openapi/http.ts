// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { processFacts } from '../../kernel/facts.js';
import { CernantoError } from '../../language/errors.js';
import { openApiCallArgsSchema, openApiOperationBindingSchema } from './schema.js';
import type { OpenApiCallArgs, OpenApiOperationBinding } from './schema.js';
import type { OutsideOutcome } from '../../language/outside.js';

// The openapi lane's wire, pure on purpose: placing a credential and
// building a request from a binding are deterministic, and the one
// attempt that touches the network takes its fetch injected so tests
// classify outcomes without a server. The generated module hands the
// attempt to the outside-call step, which journals only its outcome;
// the request itself, which may carry a resolved secret, lives in
// memory for exactly one execution.

/** A resolved credential, already placed where the scheme wants it. */
interface OpenApiAuth {
  header?: { name: string; value: string };
  query?: { name: string; value: string };
}

/** One ready-to-send request. `describe` is the safe display form
 * (method and path, query stripped) used in every error message, so an
 * api key riding a query parameter stays out of every journal and
 * trace a failure text reaches. */
interface OpenApiHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  describe: string;
}

/**
 * The binding's declared scheme applied to a resolved wire value:
 * pure, the secret rides only the caller's memory. A secured binding
 * with no credential in hand throws retryable (the account is not
 * connected yet; the call retries once it is), and a binding
 * whose api-key scheme names no carrier is a terminal mistake of the
 * document.
 */
export function openApiAuthOf(
  binding: OpenApiOperationBinding,
  secret: string | undefined,
): OpenApiAuth {
  const security = binding.security;
  if (security === undefined) return {};
  if (secret === undefined || secret === '') {
    throw new CernantoError({
      kind: 'retryable',
      message: `the ${binding.module} api authenticates with ${security.scheme} and no credential arrived; connect the "${binding.module}" account`,
    });
  }
  if (security.scheme === 'bearer') {
    return { header: { name: 'authorization', value: `Bearer ${bearerOf(secret)}` } };
  }
  const carrier = security.name;
  if (carrier === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: `the binding of ${binding.module}.${binding.operation} names no parameter for its api key`,
    });
  }
  return security.scheme === 'apiKeyHeader'
    ? { header: { name: carrier, value: secret } }
    : { query: { name: carrier, value: secret } };
}

const REQUEST_TIMEOUT_MS = 120_000;

/** The bound on one request to the outside world: the rule's, or the
 * shorter one a proof hands the process. It rides the machine's own
 * timer, never the journal's: the request's outcome is what the step
 * records, and a replay never makes the request again. */
function requestTimeoutMs(): number {
  const named = processFacts().requestTimeoutMs;
  return named !== undefined && Number.isFinite(named) && named > 0 ? named : REQUEST_TIMEOUT_MS;
}

function queryValueOf(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/** The bearer value of a stored secret: an oauth token payload yields
 * its access token, anything else is the token itself, so a static
 * bearer key and a custody-refreshed oauth account both just work. */
export function bearerOf(secret: string): string {
  try {
    const parsed = JSON.parse(secret) as { access_token?: string };
    if (typeof parsed.access_token === 'string' && parsed.access_token.length > 0) {
      return parsed.access_token;
    }
  } catch {
    // A plain string key is the common case.
  }
  return secret;
}

/**
 * Builds the request for one operation call: path template filled,
 * declared query and header parameters placed, the json body
 * serialized, and the resolved credential attached last. Only
 * parameters the binding declares ride the wire.
 */
export function openApiRequestOf(
  rawBinding: OpenApiOperationBinding,
  rawArgs: OpenApiCallArgs,
  auth: OpenApiAuth,
): OpenApiHttpRequest {
  // The literals a generated module carries are validated here, once,
  // so a malformed binding is refused before any execution.
  const binding = openApiOperationBindingSchema.parse(rawBinding);
  const args = openApiCallArgsSchema.parse(rawArgs);
  let path = binding.path;
  for (const parameter of binding.parameters) {
    if (parameter.in !== 'path') continue;
    const value = args.path?.[parameter.name];
    if (value === undefined) {
      throw new CernantoError({
        kind: 'terminal',
        message: `the path parameter "${parameter.name}" of ${binding.module}.${binding.operation} has no value`,
      });
    }
    path = path.replaceAll(`{${parameter.name}}`, encodeURIComponent(queryValueOf(value)));
  }

  const query = new URLSearchParams();
  for (const parameter of binding.parameters) {
    if (parameter.in !== 'query') continue;
    const value = args.query?.[parameter.name];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) query.append(parameter.name, queryValueOf(entry));
    } else {
      query.append(parameter.name, queryValueOf(value));
    }
  }
  if (auth.query !== undefined) query.append(auth.query.name, auth.query.value);

  const headers: Record<string, string> = { accept: 'application/json' };
  for (const parameter of binding.parameters) {
    if (parameter.in !== 'header') continue;
    // `headers` is the plural alias the generated operation types use.
    const value = args.header?.[parameter.name] ?? args.headers?.[parameter.name];
    if (value === undefined) continue;
    headers[parameter.name.toLowerCase()] = queryValueOf(value);
  }
  const body = binding.hasBody && args.body !== undefined ? JSON.stringify(args.body) : undefined;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth.header !== undefined) headers[auth.header.name.toLowerCase()] = auth.header.value;

  const base = binding.baseUrl.replace(/\/$/, '');
  const queryString = query.toString();
  return {
    url: `${base}${path}${queryString.length === 0 ? '' : `?${queryString}`}`,
    method: binding.method.toUpperCase(),
    headers,
    ...(body === undefined ? {} : { body }),
    describe: `${binding.method.toUpperCase()} ${base}${path}`,
  };
}

function retryAfterMsOf(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
}

/**
 * Runs one attempt: transient troubles (network failures, timeouts,
 * 408/425/429, every 5xx) throw retryable so the substrate retries;
 * everything else lands in the journal as a value, success and
 * terminal refusals alike.
 */
export async function attemptOpenApiRequest(
  request: OpenApiHttpRequest,
  fetchFn: typeof fetch = fetch,
): Promise<OutsideOutcome<unknown>> {
  // The answer is the status line and the body both: a connection that
  // fails while the body arrives never answered, as one that fails
  // before the headers did not.
  let response: Response;
  let text: string;
  try {
    response = await fetchFn(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
    text = await response.text();
  } catch (error) {
    throw new CernantoError({
      kind: 'retryable',
      message: `${request.describe} failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  let body: unknown;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (response.ok) {
    return { ok: body };
  }
  const snippet = text.slice(0, 300);
  if (
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    const retryAfterMs = retryAfterMsOf(response);
    throw new CernantoError({
      kind: 'retryable',
      message: `${request.describe} answered ${String(response.status)}: ${snippet}`,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  return {
    failed: {
      kind: 'terminal',
      message: `${request.describe} answered ${String(response.status)}: ${snippet}`,
      status: response.status,
    },
  };
}
