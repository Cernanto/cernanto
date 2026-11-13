// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { CernantoError } from '../../language/errors.js';
import { mcpSignInDemand } from './schema.js';
import type { McpCallResult, McpToolBinding } from './schema.js';
import type { OutsideOutcome } from '../../language/outside.js';

// The MCP wire, spoken with fetch alone: JSON-RPC over the streamable
// HTTP transport, one fresh session per operation (initialize, the
// initialized notification, the request, a best-effort close), the
// answer read from a json body or an event stream alike. Written
// without an SDK: the tool-call subset of the protocol is three
// requests, and a dependency-free client rides every artifact and the
// build the way the openapi lane's fetch does. The oauth dance that
// signs an account in, and the refresh that keeps it alive, are the
// lane's oauth module's, run by the generated module on the plane; a
// sign-in demand is this file's to recognize and hand up as a value.
// The handshake, the tools' listing and the framing of a tool's result
// are the protocol's whatever carries it: written once over a wire of
// two words, and spoken over a local server's stdio too (local.ts).

/** The protocol version this client proposes; the server answers the
 * version it settles on and every later request of the session names
 * it in the `mcp-protocol-version` header. */
const MCP_PROTOCOL_VERSION = '2025-06-18';

const CLIENT_INFO = { name: 'cernanto', version: '0.0.0' };
const DEFAULT_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 5_000;

interface McpClientOptions {
  /** The fetch to reach the server with; the global one by default.
   * Injected so the runtime can bind the real network and tests a
   * scripted one. */
  fetch?: typeof fetch;
  /** The bearer riding `authorization: Bearer <token>`, when one is in
   * hand; absent, the session is anonymous. */
  bearer?: string;
  /** One request's whole budget, the body read included. */
  timeoutMs?: number;
}

/** A non-2xx answer from the server's transport, with the pause the
 * server asked for when it sent one (`retry-after`, in seconds). */
class McpHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfterMs: number | undefined;
  /** The `www-authenticate` header of a refusal, when the server sent
   * one: a sign-in demand names its resource metadata there. */
  readonly wwwAuthenticate: string | undefined;

  constructor(
    url: string,
    status: number,
    body: string,
    retryAfterMs?: number,
    wwwAuthenticate?: string,
  ) {
    super(`${url} answered ${String(status)}${body === '' ? '' : `: ${body.slice(0, 300)}`}`);
    this.name = 'McpHttpError';
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

/** The resource metadata url a `www-authenticate` header names
 * (`Bearer resource_metadata="<url>"`), when it names one. */
function resourceMetadataUrlOf(wwwAuthenticate: string | undefined): string | undefined {
  if (wwwAuthenticate === undefined) return undefined;
  const match = /resource_metadata="([^"]+)"/.exec(wwwAuthenticate);
  return match?.[1];
}

function retryAfterMsOf(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
}

/** A JSON-RPC error the server answered to a request: a tool it does
 * not have, arguments it refused, a method it does not serve. */
export class McpRpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(method: string, code: number, message: string, data: unknown) {
    super(`${method} was refused (${String(code)}): ${message}`);
    this.name = 'McpRpcError';
    this.code = code;
    this.data = data;
  }
}

const AUTH_WORDS = ['401', 'unauthorized', 'invalid_token', 'invalid access token'];

/** Whether a failure is the server refusing for want of
 * authentication: the transport's status says 401 or 403, or the
 * words say so (some servers answer only `invalid_token` and never
 * name a status). */
function isMcpAuthRefusal(error: unknown): boolean {
  if (error instanceof McpHttpError && (error.status === 401 || error.status === 403)) return true;
  const words = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return AUTH_WORDS.some((word) => words.includes(word));
}

/** How a failed operation classifies: a sign-in the server wants
 * (`auth`, the caller decides whether custody can answer it), a
 * refusal that will not change on a retry (`terminal`), or trouble
 * reaching the server that a retry may fix (`retryable`). */
type McpFailure =
  | { kind: 'auth'; resourceMetadataUrl?: string }
  | { kind: 'terminal'; message: string }
  | { kind: 'retryable'; message: string; retryAfterMs?: number };

function classifyMcpFailure(url: string, error: unknown): McpFailure {
  if (isMcpAuthRefusal(error)) {
    const named =
      error instanceof McpHttpError ? resourceMetadataUrlOf(error.wwwAuthenticate) : undefined;
    return { kind: 'auth', ...(named === undefined ? {} : { resourceMetadataUrl: named }) };
  }
  if (error instanceof McpRpcError) return { kind: 'terminal', message: error.message };
  if (error instanceof McpHttpError) {
    const transient =
      error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
    return transient
      ? {
          kind: 'retryable',
          message: `could not reach MCP server ${url}: ${error.message}`,
          ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        }
      : { kind: 'terminal', message: error.message };
  }
  if (error instanceof CernantoError && error.kind !== 'retryable') {
    return { kind: 'terminal', message: error.message };
  }
  return {
    kind: 'retryable',
    message: `could not reach MCP server ${url}: ${error instanceof Error ? error.message : String(error)}`,
  };
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

function responseFor(message: unknown, id: number): JsonRpcResponse | undefined {
  if (Array.isArray(message)) {
    for (const entry of message) {
      const found = responseFor(entry, id);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof message !== 'object' || message === null) return undefined;
  const record = message as Record<string, unknown>;
  if (record['id'] !== id) return undefined;
  if (!('result' in record) && !('error' in record)) return undefined;
  return record as unknown as JsonRpcResponse;
}

/** The data lines of one server-sent event, joined; undefined for a
 * comment or an event without data. */
function eventDataOf(raw: string): string | undefined {
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice('data:'.length);
    lines.push(value.startsWith(' ') ? value.slice(1) : value);
  }
  return lines.length === 0 ? undefined : lines.join('\n');
}

/** Reads an event stream until the response to the request arrives,
 * then lets the rest of the stream go: notifications and other traffic
 * on the way are skipped. */
async function readSseResponse(
  url: string,
  body: ReadableStream<Uint8Array> | null,
  id: number,
): Promise<JsonRpcResponse> {
  if (body === null) {
    throw new CernantoError({
      kind: 'retryable',
      message: `${url} answered an empty event stream`,
    });
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.value !== undefined) buffer += decoder.decode(chunk.value, { stream: true });
      // Line ends normalize to \n; a trailing \r waits for its \n.
      const holdback = !chunk.done && buffer.endsWith('\r') ? 1 : 0;
      const scanned = buffer.slice(0, buffer.length - holdback).replaceAll(/\r\n|\r/g, '\n');
      buffer = buffer.slice(buffer.length - holdback);
      let rest = scanned;
      for (;;) {
        const boundary = rest.indexOf('\n\n');
        if (boundary === -1) break;
        const raw = rest.slice(0, boundary);
        rest = rest.slice(boundary + 2);
        const data = eventDataOf(raw);
        if (data === undefined) continue;
        let message: unknown;
        try {
          message = JSON.parse(data);
        } catch {
          continue;
        }
        const found = responseFor(message, id);
        if (found !== undefined) return found;
      }
      buffer = rest + buffer;
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throw new CernantoError({
    kind: 'retryable',
    message: `${url} closed the stream before answering request ${String(id)}`,
  });
}

async function readJsonResponse(
  url: string,
  response: Response,
  id: number,
): Promise<JsonRpcResponse> {
  const text = await response.text();
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    throw new CernantoError({
      kind: 'retryable',
      message: `${url} answered a body that is not json: ${text.slice(0, 200)}`,
    });
  }
  const found = responseFor(message, id);
  if (found === undefined) {
    throw new CernantoError({
      kind: 'retryable',
      message: `${url} answered without responding to request ${String(id)}`,
    });
  }
  return found;
}

/** What a session speaks over, whatever carries it: a request answered
 * by its result (a refusal thrown as McpRpcError), and a notification. */
export interface McpWire {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  notify(method: string): Promise<void>;
}

/** What the handshake settled: the version the server answered and its
 * own usage instructions, when it publishes them. */
interface McpHandshake {
  protocolVersion: string;
  instructions: string | undefined;
}

/**
 * The handshake every session opens with, over any wire: initialize
 * with the version this client proposes and no capabilities, the
 * version the server answers (the proposed one when it answers none)
 * handed to `settle` before anything else is sent, then the initialized
 * notification.
 */
export async function handshakeOver(
  wire: McpWire,
  settle?: (protocolVersion: string) => void,
): Promise<McpHandshake> {
  const initialized = (await wire.request('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  })) as { protocolVersion?: unknown; instructions?: unknown } | null;
  const protocolVersion =
    typeof initialized?.protocolVersion === 'string'
      ? initialized.protocolVersion
      : MCP_PROTOCOL_VERSION;
  settle?.(protocolVersion);
  const instructions =
    typeof initialized?.instructions === 'string' && initialized.instructions.trim() !== ''
      ? initialized.instructions
      : undefined;
  await wire.notify('notifications/initialized');
  return { protocolVersion, instructions };
}

/** The server's tools as it lists them, every page read in order: the
 * first ask carries no cursor, each next one the cursor the answer
 * before it named, until an answer names none. */
export async function listToolsOver(wire: McpWire): Promise<unknown[]> {
  const tools: unknown[] = [];
  let cursor: string | undefined;
  for (;;) {
    const answer = (await wire.request('tools/list', cursor === undefined ? {} : { cursor })) as {
      tools?: unknown;
      nextCursor?: unknown;
    } | null;
    if (Array.isArray(answer?.tools)) tools.push(...(answer.tools as unknown[]));
    const next = answer?.nextCursor;
    if (typeof next !== 'string' || next === '') return tools;
    cursor = next;
  }
}

/** A tool call's result as the server framed it: `structuredContent`
 * when the server returned any, `textContent` as every text item's text
 * joined by newlines when there was any, and `isError` true exactly
 * when the server flagged the result. */
export function toolCallResultOf(answer: unknown): McpCallResult {
  const result = answer as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: unknown;
  } | null;
  const content = Array.isArray(result?.content) ? (result.content as unknown[]) : [];
  const texts = content.flatMap((item: unknown) =>
    isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string'
      ? [item['text']]
      : [],
  );
  return {
    ...(result?.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent }),
    ...(texts.length === 0 ? {} : { textContent: texts.join('\n') }),
    isError: result?.isError === true,
  };
}

/** One open session: the initialize handshake done, ready for the
 * requests of one operation. */
interface McpSession {
  /** The version the server settled on. */
  readonly protocolVersion: string;
  /** The server's own usage instructions, when it publishes them. */
  readonly instructions: string | undefined;
  /** One JSON-RPC request; the result, or a thrown McpRpcError. */
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Ends the session on the server when it minted one; a failure to
   * end it is swallowed. */
  close(): Promise<void>;
}

/**
 * Opens a session on a server: initialize with the version this
 * client proposes, then the initialized notification. Every
 * transport refusal throws McpHttpError (an auth demand reads 401 or
 * 403 there), a refused initialize throws McpRpcError, and reaching
 * failures throw as fetch throws them.
 */
async function openMcpSession(url: string, options: McpClientOptions = {}): Promise<McpSession> {
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let nextId = 1;
  // What the handshake settles: the session the server minted, if
  // any, and the protocol version it answered; both absent on the
  // initialize request itself.
  const settled: { sessionId?: string; protocolVersion?: string } = {};

  const headersOf = (): Record<string, string> => ({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...(options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` }),
    ...(settled.sessionId === undefined ? {} : { 'mcp-session-id': settled.sessionId }),
    ...(settled.protocolVersion === undefined
      ? {}
      : { 'mcp-protocol-version': settled.protocolVersion }),
  });

  const post = async (message: Record<string, unknown>): Promise<Response> => {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: headersOf(),
      body: JSON.stringify({ jsonrpc: '2.0', ...message }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new McpHttpError(
        url,
        response.status,
        text,
        retryAfterMsOf(response),
        response.headers.get('www-authenticate') ?? undefined,
      );
    }
    return response;
  };

  const request = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    const response = await post({ id, method, ...(params === undefined ? {} : { params }) });
    const minted = response.headers.get('mcp-session-id');
    if (minted !== null && minted !== '') settled.sessionId = minted;
    const type = response.headers.get('content-type') ?? '';
    const answer = type.includes('text/event-stream')
      ? await readSseResponse(url, response.body, id)
      : await readJsonResponse(url, response, id);
    if (answer.error !== undefined) {
      throw new McpRpcError(method, answer.error.code, answer.error.message, answer.error.data);
    }
    return answer.result;
  };

  const notify = async (method: string): Promise<void> => {
    const response = await post({ method });
    // A notification's answer carries nothing; the body, if any, is
    // let go so the connection can close.
    await response.text().catch(() => '');
  };

  // The settled version rides every request after the initialize, the
  // initialized notification among them.
  const { protocolVersion, instructions } = await handshakeOver({ request, notify }, (version) => {
    settled.protocolVersion = version;
  });

  return {
    protocolVersion,
    instructions,
    request,
    close: async (): Promise<void> => {
      if (settled.sessionId === undefined) return;
      try {
        const response = await fetchFn(url, {
          method: 'DELETE',
          headers: headersOf(),
          signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
        });
        await response.text().catch(() => '');
      } catch {
        // A server that keeps no sessions answers 405 or nothing;
        // either way the session is ours no longer.
      }
    },
  };
}

/** Opens a session, runs one operation in it, and closes it whether
 * the operation succeeded or failed. */
async function withMcpSession<T>(
  url: string,
  options: McpClientOptions,
  operation: (session: McpSession) => Promise<T>,
): Promise<T> {
  const session = await openMcpSession(url, options);
  try {
    return await operation(session);
  } finally {
    await session.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Calls one tool and answers the result as the server framed it:
 * `structuredContent` when the server returned any, `textContent` as
 * every text item's text joined by newlines when there was any, and
 * `isError` true exactly when the server flagged the result.
 */
function callMcpToolOnServer(
  url: string,
  tool: string,
  args: Record<string, unknown>,
  options: McpClientOptions = {},
): Promise<McpCallResult> {
  return withMcpSession(url, options, async (session) =>
    toolCallResultOf(await session.request('tools/call', { name: tool, arguments: args })),
  );
}

/**
 * One attempt at a tool call, as the outside-call step runs it: a
 * fresh session on the server, the tool called, the session closed,
 * the outcome a journal value. The server's demand for a sign-in is a
 * terminal value marked `signIn` (the generated module reads it back
 * and answers with a refresh or the operator's authorization); a
 * refusal that will not change is a terminal value; reaching failures
 * throw retryable for the substrate's retry. The bearer rides only the
 * attempt's request, in memory for exactly one execution.
 */
export async function attemptMcpCall(
  binding: McpToolBinding,
  args: Record<string, unknown>,
  bearer: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<OutsideOutcome<McpCallResult>> {
  try {
    const result = await callMcpToolOnServer(binding.url, binding.tool, args, {
      fetch: fetchFn,
      ...(bearer === undefined ? {} : { bearer }),
    });
    return { ok: result };
  } catch (error) {
    const failure = classifyMcpFailure(binding.url, error);
    if (failure.kind === 'auth') {
      return {
        failed: {
          kind: 'terminal',
          message: mcpSignInDemand(binding.url),
          signIn:
            failure.resourceMetadataUrl === undefined
              ? {}
              : { resourceMetadataUrl: failure.resourceMetadataUrl },
        },
      };
    }
    if (failure.kind === 'terminal') {
      return {
        failed: {
          kind: 'terminal',
          message: `mcp ${binding.module}.${binding.tool}: ${failure.message}`,
        },
      };
    }
    throw new CernantoError({
      kind: 'retryable',
      message: failure.message,
      ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
    });
  }
}
