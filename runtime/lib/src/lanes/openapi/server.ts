// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
// The openapi lane's server half: what a generated server module
// imports. A request to one of a document's paths is matched to its
// operation, validated against the document, composed into the typed
// input the operation's contract declares, handed to the operation,
// and answered by the declared responses; a request to any other path
// is left untouched, so the agent's own listener serves it.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { OpenAPIBackend } from 'openapi-backend';

import type { Document, Operation, Request as RouterRequest } from 'openapi-backend';

// The call a generated server module makes of the agent's own
// operation, its credentials named.
export { invokeOperation } from '../../language/core.js';

export type Json = Record<string, unknown>;

/** The arguments an operation takes, grouped as its contract declares them. */
interface OpenApiOperationArgs {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  header?: Record<string, string>;
  body?: unknown;
  /** The request's bytes as base64, beside the parsed body, for an
   * operation whose request content declares a type besides json: the
   * bytes a webhook's signature is over, as the provider sent them. */
  rawBody?: string;
  /** Aborted when the client goes: an operation served in process (a
   * stream, bytes) reads it to stop what it does for the request, a
   * poller with nothing to say among them, since a generator that never
   * yields cannot be returned. Absent on an operation served by a call,
   * which answers once and crosses the wire. */
  signal?: AbortSignal;
}

/** A request the document refuses before any operation runs. */
interface OpenApiRefusal {
  status: number;
  message: string;
  headers?: Record<string, string>;
}

/** A request read off the socket: its method, its path without the
 * query, the query text, the headers and the body as the operation's
 * declared content reads it (parsed json, text, or bytes). */
interface OpenApiServerRequest {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string | string[]>;
  body?: unknown;
  /** The body's bytes as read, handed on to the operation beside the
   * parsed body when the operation takes them. */
  rawBody?: Buffer;
}

/** A request the document takes: the operation, its typed input, and
 * the paths of that input the security schemes name as credentials. */
type OpenApiMatch =
  | { operationId: string; operation: Operation; args: OpenApiOperationArgs; credentials: string[] }
  | { refused: OpenApiRefusal };

/** What an operation came to: a value with the success status it names
 * when the document declares several, or a failure classified by its
 * kind and, for a declared answer, carrying its status and body. */
interface OpenApiCallFailure {
  kind: string;
  message: string;
  status?: number;
  body?: unknown;
}
type OpenApiOutcome = { result: unknown; status?: number } | { error: OpenApiCallFailure };

interface OpenApiAnswer {
  status: number;
  contentType: string;
  body: string | Uint8Array;
}

/** The security scheme an operation resolves to, with the credential the
 * request carried for it: what `admit` is asked about. */
interface OpenApiCredential {
  scheme: string;
  type: string;
  name?: string;
  in?: string;
  credential: string | undefined;
}

/** What an implementor admits a request by, when its document asks: the
 * generated server module hands the credential and the request to it. */
export type OpenApiAdmit = (credential: OpenApiCredential, request: IncomingMessage) => unknown;

const STATUS_OF_KIND: Readonly<Record<string, number>> = {
  terminal: 400,
  'contract-violation': 400,
  'judgment-inconclusive': 422,
  retryable: 503,
  'target-unavailable': 503,
};

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** The ping that keeps a server-sent stream open between events. */
const OPENAPI_STREAM_PING_MS = 15_000;

/** The cap a body is read under when the handler names none. */
const OPENAPI_DEFAULT_BODY_CAP = 16 * 1024 * 1024;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveRef(document: Json, node: unknown): unknown {
  if (!isRecord(node) || typeof node['$ref'] !== 'string') return node;
  const ref = node['$ref'];
  if (!ref.startsWith('#/')) return node;
  let current: unknown = document;
  for (const segment of ref.slice(2).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * The document's router, prepared once per document: the routing
 * package over a copy of the document (its `init` dereferences in
 * place), request validation on with the values coerced to their
 * declared types, unknown formats and keywords allowed, and the
 * package's own definition check disarmed (it refuses OpenAPI 3.1
 * constructs a valid document uses; the compiler validated the
 * document when it held the agent to it).
 *
 * @param document - The document, parsed.
 * @returns The initialized router.
 * @example const api = await openApiRouter(document);
 */
export async function openApiRouter(document: Json): Promise<OpenAPIBackend> {
  const copy = JSON.parse(JSON.stringify(document)) as Document;
  const api = new OpenAPIBackend({
    definition: copy,
    validate: true,
    coerceTypes: true,
    ajvOpts: { strict: false, strictSchema: false, validateFormats: false },
  });
  api.validateDefinition = () => api.document;
  await api.init();
  return api;
}

function parametersOf(operation: Operation): Json[] {
  const list = (operation as unknown as Json)['parameters'];
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return Array.isArray(value) ? value.join(', ') : value;
  }
  return undefined;
}

function securityOf(definition: Json, op: Json): Json[] {
  const security = Array.isArray(op['security'])
    ? op['security']
    : Array.isArray(definition['security'])
      ? definition['security']
      : [];
  return security.filter(isRecord);
}

function schemeOf(definition: Json, schemeName: string): Json | undefined {
  const components = isRecord(definition['components']) ? definition['components'] : {};
  const schemes = isRecord(components['securitySchemes']) ? components['securitySchemes'] : {};
  const scheme = resolveRef(definition, schemes[schemeName]);
  return isRecord(scheme) ? scheme : undefined;
}

function isBearerLike(scheme: Json): boolean {
  const type = scheme['type'];
  return (
    (type === 'http' && String(scheme['scheme']).toLowerCase() === 'bearer') ||
    type === 'oauth2' ||
    type === 'openIdConnect'
  );
}

/** Composes the operation's arguments as its rendered contract declares them. */
function composeArgs(
  definition: Json,
  operation: Operation,
  pathValues: Record<string, unknown>,
  queryValues: Record<string, unknown>,
  headers: Record<string, string | string[]>,
  body: unknown,
  rawBody?: Buffer,
): { args: OpenApiOperationArgs; credentials: string[] } {
  const op = operation as unknown as Json;
  const parameters = parametersOf(operation);
  const args: OpenApiOperationArgs = {};
  // The credentials the security schemes name, by where the input
  // carries them: the call's records name these paths, never values.
  const named: string[] = [];

  const pathNames = parameters.filter((p) => p['in'] === 'path').map((p) => String(p['name']));
  if (pathNames.length > 0) {
    const path: Record<string, unknown> = {};
    for (const name of pathNames) if (pathValues[name] !== undefined) path[name] = pathValues[name];
    args.path = path;
  }

  const queryNames = parameters.filter((p) => p['in'] === 'query').map((p) => String(p['name']));
  const headerNames = parameters.filter((p) => p['in'] === 'header').map((p) => String(p['name']));
  for (const requirement of securityOf(definition, op)) {
    for (const schemeName of Object.keys(requirement)) {
      const scheme = schemeOf(definition, schemeName);
      if (scheme === undefined) continue;
      if (isBearerLike(scheme)) {
        if (!headerNames.includes('authorization')) headerNames.push('authorization');
        named.push('header.authorization');
      } else if (scheme['type'] === 'apiKey' && typeof scheme['name'] === 'string') {
        if (scheme['in'] === 'header' && !headerNames.includes(scheme['name']))
          headerNames.push(scheme['name']);
        if (scheme['in'] === 'query' && !queryNames.includes(scheme['name']))
          queryNames.push(scheme['name']);
        if (scheme['in'] === 'header' || scheme['in'] === 'query')
          named.push(`${scheme['in']}.${scheme['name']}`);
      }
    }
  }

  if (queryNames.length > 0) {
    const query: Record<string, unknown> = {};
    for (const name of queryNames)
      if (queryValues[name] !== undefined) query[name] = queryValues[name];
    args.query = query;
  }
  if (headerNames.length > 0) {
    const header: Record<string, string> = {};
    for (const name of headerNames) {
      const value = headerValue(headers, name);
      if (value !== undefined) header[name] = value;
    }
    args.header = header;
  }
  if (op['requestBody'] !== undefined && body !== undefined) args.body = body;
  if (rawBody !== undefined && args.body !== undefined && !Buffer.isBuffer(args.body))
    args.rawBody = rawBody.toString('base64');
  const carried = (path: string): boolean => {
    const dot = path.indexOf('.');
    const values = args[path.slice(0, dot) as 'header' | 'query'] as
      Record<string, unknown> | undefined;
    return values !== undefined && values[path.slice(dot + 1)] !== undefined;
  };
  return { args, credentials: [...new Set(named)].filter(carried) };
}

function securityQueryNames(definition: Json, op: Json): string[] {
  const names: string[] = [];
  for (const requirement of securityOf(definition, op)) {
    for (const schemeName of Object.keys(requirement)) {
      const scheme = schemeOf(definition, schemeName);
      if (
        scheme !== undefined &&
        scheme['type'] === 'apiKey' &&
        scheme['in'] === 'query' &&
        typeof scheme['name'] === 'string'
      ) {
        names.push(scheme['name']);
      }
    }
  }
  return names;
}

/** Matches the path against a wildcard operation's template before its
 * last parameter: a parameter the document marks `x-cernanto-wildcard`
 * takes the rest of the path, slashes and all. */
function matchWildcard(
  operation: Operation,
  method: string,
  path: string,
): Record<string, unknown> | undefined {
  if (operation.method !== method) return undefined;
  const last = /\{([^}]+)\}$/.exec(operation.path);
  if (last === null) return undefined;
  const wildName = last[1] ?? '';
  const wild = parametersOf(operation).find((p) => p['in'] === 'path' && p['name'] === wildName);
  if (wild === undefined || wild['x-cernanto-wildcard'] !== true) return undefined;
  const prefix = operation.path.slice(0, last.index);
  const values: Record<string, unknown> = {};
  let pos = 0;
  for (const part of prefix.split(/(\{[^}]+\})/)) {
    if (part === '') continue;
    const param = /^\{([^}]+)\}$/.exec(part);
    if (param !== null) {
      const slash = path.indexOf('/', pos);
      const end = slash === -1 ? path.length : slash;
      if (end === pos) return undefined;
      try {
        values[param[1] ?? ''] = decodeURIComponent(path.slice(pos, end));
      } catch {
        return undefined;
      }
      pos = end;
    } else {
      if (!path.startsWith(part, pos)) return undefined;
      pos += part.length;
    }
  }
  values[wildName] = path.slice(pos);
  return values;
}

/** Whether a path template of the document fits the request's path,
 * whatever the method: the test that says whether the request is the
 * document's at all. */
function templateFits(operation: Operation, path: string): boolean {
  const parameters = parametersOf(operation);
  const pattern = operation.path
    .split(/(\{[^}]+\})/)
    .map((part) => {
      const param = /^\{([^}]+)\}$/.exec(part);
      if (param === null) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wild = parameters.find((p) => p['in'] === 'path' && p['name'] === param[1]);
      return wild !== undefined && wild['x-cernanto-wildcard'] === true ? '.*' : '[^/]+';
    })
    .join('');
  return new RegExp(`^${pattern}$`).test(path);
}

/**
 * Whether a request's path is one the document declares, whatever its
 * method. A handler answers false for any other path and touches
 * nothing, so the listener serves it itself.
 *
 * @param api - The document's router.
 * @param path - The request's path, without the query.
 * @returns True when some operation's path template fits the path.
 */
export function openApiOwnsPath(api: OpenAPIBackend, path: string): boolean {
  return api.getOperations().some((operation) => templateFits(operation, path));
}

/**
 * Which operation of the document a request is, by its method and path
 * alone, with nothing validated: what the handler asks before it reads
 * the body, since the operation says how the body is read.
 *
 * @returns The operation, or the refusal: `405` when the path is the
 *   document's and the method is not, `404` when no path fits.
 */
function openApiOperationOf(
  api: OpenAPIBackend,
  method: string,
  path: string,
): { operationId: string; operation: Operation } | { refused: OpenApiRefusal } {
  const lower = method.toLowerCase();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  for (const operation of api.getOperations()) {
    if (typeof operation.operationId !== 'string') continue;
    if (matchWildcard(operation, lower, normalized) !== undefined) {
      return { operationId: operation.operationId, operation };
    }
  }
  const operation = api.matchOperation({ method: lower, path: normalized, headers: {} });
  if (operation !== undefined && typeof operation.operationId === 'string') {
    return { operationId: operation.operationId, operation };
  }
  const allowed = api
    .getOperations()
    .filter((candidate) => templateFits(candidate, normalized))
    .map((candidate) => candidate.method.toUpperCase());
  if (allowed.length > 0) {
    return {
      refused: {
        status: 405,
        message: `no operation at ${method.toUpperCase()} ${normalized}; the document declares ${allowed.join(', ')}`,
        headers: { allow: allowed.join(', ') },
      },
    };
  }
  return {
    refused: { status: 404, message: `no operation at ${method.toUpperCase()} ${normalized}` },
  };
}

/**
 * Decides which operation of the document a request is and composes
 * the operation's arguments as the document's rendered contract
 * declares them: a wildcard operation is matched by hand, everything
 * else by the document's router, which validates the request before
 * its arguments are composed. An operation its document marks
 * `x-cernanto-open-query: true` is validated with the request's query
 * left aside: a provider's query parameters are the provider's,
 * whatever the operation declares.
 *
 * @param api - The document's router.
 * @param request - The request's method, path, query, headers and body.
 * @returns The operation and its composed arguments, or the refusal:
 *   `405` when the path is the document's and the method is not, `400`
 *   with the validator's words when the request does not validate.
 * @example
 * const match = matchOpenApiRequest(api, { method: 'GET', path: '/orders/7', query: '', headers: {} });
 * // => { operationId: 'getOrder', operation, args: { path: { id: '7' } } }
 */
export function matchOpenApiRequest(
  api: OpenAPIBackend,
  request: OpenApiServerRequest,
): OpenApiMatch {
  const definition = api.definition as unknown as Json;
  const method = request.method.toLowerCase();
  const path = request.path.startsWith('/') ? request.path : `/${request.path}`;
  const headers = request.headers;
  const apiRequest: RouterRequest = {
    method,
    path,
    headers,
    query: request.query,
    ...(request.body === undefined ? {} : { body: request.body }),
  };

  for (const operation of api.getOperations()) {
    const values = matchWildcard(operation, method, path);
    if (values === undefined || typeof operation.operationId !== 'string') continue;
    const wildName = /\{([^}]+)\}$/.exec(operation.path)?.[1] ?? '';
    if (request.query !== '') values[wildName] = `${String(values[wildName])}?${request.query}`;
    const parsed = api.router.parseRequest(apiRequest, operation);
    const composed = composeArgs(
      definition,
      operation,
      values,
      isRecord(parsed.query) ? parsed.query : {},
      headers,
      parsed.requestBody,
      request.rawBody,
    );
    return { operationId: operation.operationId, operation, ...composed };
  }

  const operation = api.matchOperation(apiRequest);
  if (operation === undefined || typeof operation.operationId !== 'string') {
    const allowed = api
      .getOperations()
      .filter((candidate) => templateFits(candidate, path))
      .map((candidate) => candidate.method.toUpperCase());
    if (allowed.length > 0) {
      return {
        refused: {
          status: 405,
          message: `no operation at ${request.method.toUpperCase()} ${path}; the document declares ${allowed.join(', ')}`,
          headers: { allow: allowed.join(', ') },
        },
      };
    }
    return {
      refused: { status: 404, message: `no operation at ${request.method.toUpperCase()} ${path}` },
    };
  }
  const operationId = operation.operationId;
  const openQuery = (operation as unknown as Json)['x-cernanto-open-query'] === true;
  const validated: RouterRequest = openQuery ? { ...apiRequest, query: '' } : apiRequest;
  const validation = api.validateRequest(validated, operation);
  const keyNames = securityQueryNames(definition, operation);
  const errors = (validation.errors ?? []).filter((error) => {
    if (openQuery && (error.instancePath === '/query' || error.instancePath.startsWith('/query/')))
      return false;
    const extra = (error.params as unknown as Json | undefined)?.['additionalProperty'];
    return !(
      error.instancePath === '/query' &&
      typeof extra === 'string' &&
      keyNames.includes(extra)
    );
  });
  if (errors.length > 0) {
    const message = errors
      .map((error) => `${error.instancePath} ${error.message ?? ''}`)
      .join('; ');
    return { refused: { status: 400, message } };
  }

  const parsed = api.router.parseRequest(apiRequest, operation);
  const coerced: unknown = validation.coerced;
  const coercedParams =
    isRecord(coerced) && isRecord(coerced['params']) ? coerced['params'] : undefined;
  const coercedQuery =
    isRecord(coerced) && isRecord(coerced['query']) ? coerced['query'] : undefined;
  const pathValues = coercedParams ?? (isRecord(parsed.params) ? parsed.params : {});
  const queryValues =
    (openQuery ? undefined : coercedQuery) ?? (isRecord(parsed.query) ? parsed.query : {});
  const composed = composeArgs(
    definition,
    operation,
    pathValues,
    queryValues,
    headers,
    parsed.requestBody,
    request.rawBody,
  );
  return { operationId, operation, ...composed };
}

function findOperation(document: Json, operationId: string): Json | undefined {
  const paths = isRecord(document['paths']) ? document['paths'] : {};
  for (const item of Object.values(paths)) {
    const pathItem = resolveRef(document, item);
    if (!isRecord(pathItem)) continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (isRecord(operation) && operation['operationId'] === operationId) return operation;
    }
  }
  return undefined;
}

function responseContent(
  document: Json,
  operation: Json | undefined,
  status: number,
): Json | undefined {
  if (operation === undefined) return undefined;
  const responses = isRecord(operation['responses']) ? operation['responses'] : {};
  const response = resolveRef(document, responses[String(status)]);
  if (!isRecord(response)) return undefined;
  return isRecord(response['content']) ? response['content'] : undefined;
}

function textType(content: Json | undefined): string | undefined {
  return content === undefined
    ? undefined
    : Object.keys(content).find((type) => type.startsWith('text/'));
}

function json(value: unknown): string {
  // An undefined value serializes as null: JSON.stringify answers no text for it.
  return JSON.stringify(value === undefined ? null : value);
}

/** The success status an operation answers: the one the outcome names
 * when the document declares it, else the lowest `2xx` declared, else 200. */
function openApiSuccessStatus(document: Json, operationId: string, named?: number): number {
  const operation = findOperation(document, operationId);
  const responses =
    operation !== undefined && isRecord(operation['responses']) ? operation['responses'] : {};
  const successes = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .map(Number)
    .sort((a, b) => a - b);
  return named !== undefined && successes.includes(named) ? named : (successes[0] ?? 200);
}

/** The content types an operation's success response declares. */
function openApiSuccessContent(document: Json, operationId: string): Json | undefined {
  const operation = findOperation(document, operationId);
  return responseContent(document, operation, openApiSuccessStatus(document, operationId));
}

/**
 * Turns what an operation came to into the response to write, per the
 * document: a value answers the operation's success response, a
 * failure the status it asks for, or the status its kind stands for.
 *
 * @param document - The document, parsed.
 * @param operationId - The operation the request was of.
 * @param outcome - `{result, status?}` or `{error: {kind, message, status?, body?}}`.
 * @returns `{status, contentType, body}`, the body empty for a `204` or a
 *   response without content, bytes for a declared octet-stream, text
 *   under the declared `text/*` type, json otherwise.
 * @example
 * const answer = answerOfOpenApi(document, 'getOrder', { result: { id: 7 } });
 * // => { status: 200, contentType: 'application/json', body: '{"id":7}' }
 */
export function answerOfOpenApi(
  document: Json,
  operationId: string,
  outcome: OpenApiOutcome,
): OpenApiAnswer {
  const operation = findOperation(document, operationId);
  if ('error' in outcome) {
    const failure = outcome.error;
    const failureBody = { error: { kind: failure.kind, message: failure.message } };
    if (failure.status !== undefined) {
      const text = textType(responseContent(document, operation, failure.status));
      if (failure.body === undefined) {
        return { status: failure.status, contentType: 'application/json', body: json(failureBody) };
      }
      if (text !== undefined && typeof failure.body === 'string') {
        return { status: failure.status, contentType: text, body: failure.body };
      }
      return { status: failure.status, contentType: 'application/json', body: json(failure.body) };
    }
    const status = STATUS_OF_KIND[failure.kind] ?? 500;
    return { status, contentType: 'application/json', body: json(failureBody) };
  }
  const status = openApiSuccessStatus(document, operationId, outcome.status);
  const content = responseContent(document, operation, status);
  if (status === 204 || content === undefined || Object.keys(content).length === 0) {
    return { status, contentType: 'application/json', body: '' };
  }
  if ('application/octet-stream' in content && outcome.result instanceof Uint8Array) {
    return { status, contentType: 'application/octet-stream', body: outcome.result };
  }
  if ('application/json' in content) {
    return { status, contentType: 'application/json', body: json(outcome.result) };
  }
  const text = textType(content);
  if (text !== undefined && typeof outcome.result === 'string') {
    return { status, contentType: text, body: outcome.result };
  }
  if ('text/html' in content && typeof outcome.result === 'string') {
    return { status, contentType: 'text/html', body: outcome.result };
  }
  return { status, contentType: 'application/json', body: json(outcome.result) };
}

/** Whether an operation takes the request's bytes beside its parsed
 * body: its request content declares a type besides `application/json`
 * (a form, text, anything), so what the handler reads as the body is
 * not the bytes the sender signed. */
function openApiHandsRawBody(document: Json, operationId: string): boolean {
  const operation = findOperation(document, operationId);
  const requestBody =
    operation === undefined ? undefined : resolveRef(document, operation['requestBody']);
  const content =
    isRecord(requestBody) && isRecord(requestBody['content']) ? requestBody['content'] : undefined;
  return content !== undefined && Object.keys(content).some((type) => type !== 'application/json');
}

/** Whether an operation runs in the serving process directly, never as
 * a call of the agent: the document, or the operation, says
 * `x-cernanto-direct: true`. The plane's own routes are such (the host
 * job's document): a poke, a lease or a wake is an act on the host's
 * memory and the plane's records, and a call of the host job for each
 * would poke the host job again. */
function openApiRunsDirect(document: Json, operationId: string): boolean {
  if (document['x-cernanto-direct'] === true) return true;
  const operation = findOperation(document, operationId);
  return operation !== undefined && operation['x-cernanto-direct'] === true;
}

/** Whether an operation's success is a server-sent stream. */
function openApiAnswersStream(document: Json, operationId: string): boolean {
  const content = openApiSuccessContent(document, operationId);
  return content !== undefined && 'text/event-stream' in content;
}

/** Whether an operation's success is bytes. */
function openApiAnswersBytes(document: Json, operationId: string): boolean {
  const content = openApiSuccessContent(document, operationId);
  return content !== undefined && 'application/octet-stream' in content;
}

/**
 * Reads a request's body whole, under the cap.
 *
 * @throws An Error carrying `status: 413` when the body runs past the cap.
 */
async function readOpenApiBody(req: IncomingMessage, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += piece.byteLength;
    if (size > cap) {
      throw Object.assign(new Error(`the body is over the cap of ${cap} bytes`), { status: 413 });
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

/** The body as the operation's declared request content reads it:
 * parsed json for `application/json`, text for `text/*`, the bytes
 * for anything else; undefined for an empty body. */
function openApiBodyOf(
  document: Json,
  operationId: string,
  bytes: Buffer,
  contentType: string | undefined,
): { body?: unknown; refused?: OpenApiRefusal } {
  if (bytes.byteLength === 0) return {};
  const operation = findOperation(document, operationId);
  const requestBody =
    operation === undefined ? undefined : resolveRef(document, operation['requestBody']);
  const content =
    isRecord(requestBody) && isRecord(requestBody['content']) ? requestBody['content'] : undefined;
  const declared = content === undefined ? [] : Object.keys(content);
  const type = (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  const wantsJson =
    declared.includes('application/json') && (type === '' || type === 'application/json');
  if (wantsJson) {
    try {
      return { body: JSON.parse(bytes.toString('utf8')) as unknown };
    } catch {
      return { refused: { status: 400, message: 'the body is not json' } };
    }
  }
  if (declared.some((entry) => entry.startsWith('text/')) || type.startsWith('text/')) {
    return { body: bytes.toString('utf8') };
  }
  return { body: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

/** Writes an answer to the response. */
function writeOpenApiAnswer(
  res: ServerResponse,
  answer: OpenApiAnswer,
  headers?: Record<string, string>,
): void {
  res.statusCode = answer.status;
  for (const [name, value] of Object.entries(headers ?? {})) res.setHeader(name, value);
  if (answer.body !== '' || answer.status === 200) {
    if (answer.body !== '') res.setHeader('content-type', answer.contentType);
  }
  res.end(answer.body);
}

/**
 * Writes an operation's stream as server-sent events: the stream opened
 * by a `: stream open` comment line, one `data: <the item as JSON>`
 * event per item, a `: ping` comment every fifteen seconds, and the
 * stream ended when the items end or the client goes, the iterable
 * returned when the client goes first.
 */
async function writeOpenApiStream(
  res: ServerResponse,
  items: AsyncIterable<unknown>,
  pingMs: number = OPENAPI_STREAM_PING_MS,
): Promise<void> {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders();
  const state = { gone: false };
  const iterator = items[Symbol.asyncIterator]();
  const send = (text: string): void => {
    if (state.gone) return;
    try {
      res.write(text);
    } catch {
      state.gone = true;
    }
  };
  res.once('close', () => {
    state.gone = true;
    void iterator.return?.();
  });
  send(': stream open\n\n');
  const ping = setInterval(() => {
    send(': ping\n\n');
  }, pingMs);
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done === true || state.gone) break;
      send(`data: ${JSON.stringify(next.value)}\n\n`);
    }
  } catch (error) {
    send(
      `data: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`,
    );
  } finally {
    clearInterval(ping);
    try {
      res.end();
    } catch {
      // The client is gone; nothing to end.
    }
  }
}

/** A failure as an operation's outcome: an Error carrying a declared
 * `status` (and `body`) answers that status; a classified error its
 * kind's; anything else is unexpected. */
function openApiFailureOf(error: unknown): OpenApiCallFailure {
  const record = isRecord(error) ? error : {};
  const message = error instanceof Error ? error.message : String(error);
  const kind = typeof record['kind'] === 'string' ? record['kind'] : 'unexpected';
  const status = typeof record['status'] === 'number' ? record['status'] : undefined;
  return {
    kind,
    message,
    ...(status === undefined ? {} : { status }),
    ...(record['body'] === undefined ? {} : { body: record['body'] }),
  };
}

/** The credential the request carries for the first security scheme the
 * operation resolves to, or undefined when the operation is open. */
function openApiCredentialOf(
  document: Json,
  operation: Operation,
  headers: Record<string, string | string[]>,
  query: URLSearchParams,
): OpenApiCredential | undefined {
  const requirements = securityOf(document, operation);
  for (const requirement of requirements) {
    for (const schemeName of Object.keys(requirement)) {
      const scheme = schemeOf(document, schemeName);
      if (scheme === undefined) continue;
      const type = String(scheme['type']);
      if (isBearerLike(scheme)) {
        const header = headerValue(headers, 'authorization');
        const token =
          header === undefined ? undefined : /^bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
        return { scheme: schemeName, type, credential: token };
      }
      if (type === 'apiKey' && typeof scheme['name'] === 'string') {
        const name = scheme['name'];
        const where = String(scheme['in']);
        const credential =
          where === 'header'
            ? headerValue(headers, name)
            : where === 'query'
              ? (query.get(name) ?? undefined)
              : undefined;
        return { scheme: schemeName, type, name, in: where, credential };
      }
    }
  }
  return undefined;
}

interface OpenApiHandlerOptions {
  /** The document, parsed. */
  document: Json;
  /** The operations by id: the agent's own exported functions, for the
   * operations answered in process (a stream, bytes). */
  operations: () => Promise<Record<string, unknown>>;
  /** The road for an operation that answers a value: a call of the
   * agent's own function, journaled and traced like any call, handed
   * the paths of its input that are credentials. Absent, every
   * operation is called in process. */
  call?: (
    operationId: string,
    args: OpenApiOperationArgs,
    credentials: string[],
  ) => Promise<unknown>;
  /** Decides who is admitted to a secured operation: answers nothing to
   * refuse. Absent, a secured operation admits every request and the
   * function's own checks stand. */
  admit?: OpenApiAdmit;
  /** The cap a body is read under. */
  bodyCap?: number;
}

/**
 * The document's request handler, for node's http or https server or
 * any framework over it: answers whether the request was one of the
 * document's. For a path the document declares it reads the body under
 * the cap, matches the operation, validates the request, asks `admit`
 * when the operation is secured, composes the typed input, calls the
 * operation, and writes what it answered or threw by the declared
 * responses, a stream as server-sent events; it then answers true. For
 * any other path it touches nothing and answers false.
 *
 * @example
 * const api = createOpenApiHandler({ document, operations, call });
 * createServer(async (req, res) => { if (await api(req, res)) return; res.writeHead(404).end(); }).listen(8080);
 */
/** The routers prepared so far, one per document object: a handler
 * created for a document again, by a listener that creates one per
 * request, shares the router the first one prepared. */
const ROUTERS = new WeakMap<Json, Promise<OpenAPIBackend>>();

function preparedRouter(document: Json): Promise<OpenAPIBackend> {
  const known = ROUTERS.get(document);
  if (known !== undefined) return known;
  const router = openApiRouter(document).catch((error: unknown) => {
    ROUTERS.delete(document);
    throw error;
  });
  ROUTERS.set(document, router);
  return router;
}

export function createOpenApiHandler(
  options: OpenApiHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { document } = options;
  const cap = options.bodyCap ?? OPENAPI_DEFAULT_BODY_CAP;
  const prepared = (): Promise<OpenAPIBackend> => preparedRouter(document);
  const refuse = (res: ServerResponse, refusal: OpenApiRefusal): void => {
    const kind =
      refusal.status === 400
        ? { kind: 'contract-violation' }
        : refusal.status === 401
          ? { kind: 'terminal' }
          : {};
    writeOpenApiAnswer(
      res,
      {
        status: refusal.status,
        contentType: 'application/json',
        body: json({ error: { ...kind, message: refusal.message } }),
      },
      refusal.headers,
    );
  };

  return async (req, res) => {
    const api = await prepared();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (!openApiOwnsPath(api, path)) return false;
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers))
      if (value !== undefined) headers[name] = value;
    const method = (req.method ?? 'GET').toUpperCase();
    const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;

    // The operation first, by method and path alone and with nothing
    // validated, so the body is read as its declared content and a
    // request to no operation is refused before any body is read.
    const probe = openApiOperationOf(api, method, path);
    if ('refused' in probe) {
      refuse(res, probe.refused);
      return true;
    }
    const operationId = probe.operationId;
    let body: unknown;
    let bytes: Buffer | undefined;
    try {
      bytes = await readOpenApiBody(req, cap);
      const read = openApiBodyOf(
        document,
        operationId,
        bytes,
        headerValue(headers, 'content-type'),
      );
      if (read.refused !== undefined) {
        refuse(res, read.refused);
        return true;
      }
      body = read.body;
    } catch (error) {
      const status = isRecord(error) && typeof error['status'] === 'number' ? error['status'] : 400;
      refuse(res, { status, message: error instanceof Error ? error.message : String(error) });
      return true;
    }
    const match = matchOpenApiRequest(api, {
      method,
      path,
      query,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(openApiHandsRawBody(document, operationId) ? { rawBody: bytes } : {}),
    });
    if ('refused' in match) {
      refuse(res, match.refused);
      return true;
    }
    if (options.admit !== undefined) {
      const credential = openApiCredentialOf(document, match.operation, headers, url.searchParams);
      if (credential !== undefined) {
        let principal: unknown;
        try {
          principal = await options.admit(credential, req);
        } catch (error) {
          principal = undefined;
          if (!(isRecord(error) && error['status'] === 401)) {
            writeOpenApiAnswer(
              res,
              answerOfOpenApi(document, match.operationId, { error: openApiFailureOf(error) }),
            );
            return true;
          }
        }
        if (principal === undefined) {
          refuse(res, {
            status: 401,
            message: `unauthorized: the ${credential.scheme} credential is missing or not admitted`,
            ...(credential.type === 'http' ? { headers: { 'www-authenticate': 'Bearer' } } : {}),
          });
          return true;
        }
      }
    }
    const call = options.call;
    const byCall =
      call !== undefined &&
      !openApiRunsDirect(document, match.operationId) &&
      !openApiAnswersStream(document, match.operationId) &&
      !openApiAnswersBytes(document, match.operationId);
    let outcome: OpenApiOutcome;
    try {
      let result: unknown;
      if (byCall) {
        result = await call(match.operationId, match.args, match.credentials);
      } else {
        const operations = await options.operations();
        const fn = operations[match.operationId];
        if (typeof fn !== 'function') {
          throw Object.assign(new Error(`the operation ${match.operationId} is not exported`), {
            kind: 'terminal',
          });
        }
        // The client's going reaches the operation as its signal: the
        // response closes when the connection does, and an aborted
        // signal after a finished answer changes nothing.
        const control = new AbortController();
        res.once('close', () => {
          control.abort();
        });
        result = await (fn as (args: OpenApiOperationArgs) => Promise<unknown>)({
          ...match.args,
          signal: control.signal,
        });
      }
      outcome = { result };
    } catch (error) {
      outcome = { error: openApiFailureOf(error) };
    }
    if (
      'result' in outcome &&
      openApiAnswersStream(document, match.operationId) &&
      isAsyncIterable(outcome.result)
    ) {
      await writeOpenApiStream(res, outcome.result);
      return true;
    }
    writeOpenApiAnswer(res, answerOfOpenApi(document, match.operationId, outcome));
    return true;
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}
