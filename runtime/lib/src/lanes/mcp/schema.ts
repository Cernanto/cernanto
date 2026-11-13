// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

import { createHash } from 'node:crypto';

/** A remote mcp server url: https only, with one exception, http on
 * the machine itself (the loopback), so local mock servers and tests
 * can stand in for a remote server without a certificate. */
export const MCP_URL_PATTERN =
  /^(?:https:\/\/[^\s]+|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s]*)?)$/;

// The MCP grant's shared seam, the openapi seam's twin: the compiler
// lists a granted server's tools itself and generates one typed module
// per server, each function carrying its tool binding as a plain
// literal, and the runtime executes the binding as a journaled step in
// the calling agent's own worker. The binding is the whole wire of this
// lane. The bearer, when the server wants one, comes from the plane's
// custody (the agent's account for the server), resolved by the rule
// below on both sides (the compile's listing and the runtime's call).

/** One tool as published by a remote MCP server. The annotations are
 * the server's own behavioral hints (read-only, destructive,
 * idempotent, open-world): untrusted per the MCP spec, so they ride
 * into the generated docs for the coder to weigh, as hints alone. */
interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

/** A listed tool kept to the fields a listing carries, the compiler's
 * rule: the name, the title and the description when strings, the input
 * schema when an object (else an object schema), the output schema when
 * an object, and the annotations reduced to the hints the server set,
 * absent when it set none. A tool without a name is refused. */
export function keptMcpToolOf(raw: unknown, where: string): McpTool {
  if (!isObject(raw) || typeof raw['name'] !== 'string' || raw['name'] === '') {
    throw new Error(`${where} listed a tool without a name`);
  }
  const annotations: NonNullable<McpTool['annotations']> = {};
  const given = raw['annotations'];
  if (isObject(given)) {
    if (typeof given['title'] === 'string') annotations.title = given['title'];
    for (const hint of HINTS) {
      const value = given[hint];
      if (typeof value === 'boolean') annotations[hint] = value;
    }
  }
  return {
    name: raw['name'],
    ...(typeof raw['title'] === 'string' ? { title: raw['title'] } : {}),
    ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
    inputSchema: isObject(raw['inputSchema']) ? raw['inputSchema'] : { type: 'object' },
    ...(isObject(raw['outputSchema']) ? { outputSchema: raw['outputSchema'] } : {}),
    ...(Object.keys(annotations).length === 0 ? {} : { annotations }),
  };
}

/** A value written canonically: object keys sorted, arrays in order,
 * undefined and non-finite numbers as null, no whitespace. */
function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return 'null';
}

/** The schema hash of a listing: the sha256 hex of its kept tools,
 * sorted by name in plain string order and written canonically. Two
 * listings of the same tools hash the same, whatever their order. */
export function mcpSchemaHashOf(tools: readonly McpTool[]): string {
  const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return createHash('sha256').update(canonical(sorted)).digest('hex');
}

/** The constants a generated module carries for a local server: the
 * command the grant names, the module's name, and the schema hash of
 * the listing the package carries, which the server's own listing is
 * held to at its start. */
export interface LocalMcpLane {
  command: string;
  module: string;
  schemaHash?: string;
}

/** One tool of a granted MCP server, embedded verbatim in the
 * generated module and executed by the runtime. */
export interface McpToolBinding {
  /** The generated module's name, `stripe` for mcp.stripe.com. */
  module: string;
  /** The server url: https, or http on a loopback host for mocks. */
  url: string;
  /** The tool's name exactly as the server publishes it. */
  tool: string;
}

/** What one tool call answered, as the server framed it: structured
 * content when the server returned any, the text items joined by
 * newlines when there were any, and whether the server flagged the
 * result as an error. */
export interface McpCallResult {
  structuredContent?: unknown;
  textContent?: string;
  isError: boolean;
}

/** The output ladder applied to one tool response: a declared schema
 * arrives structured; text that parses as json is the middle rung;
 * prose stays a string for the caller to judge. The generated module
 * applies it to what the server answered. */
export function mcpResultOf(response: {
  structuredContent?: unknown;
  textContent?: string | undefined;
}): unknown {
  if (response.structuredContent !== undefined) return response.structuredContent;
  if (response.textContent !== undefined) {
    try {
      return JSON.parse(response.textContent) as unknown;
    } catch {
      return response.textContent;
    }
  }
  return undefined;
}

/** The words of a sign-in demand: what the failure says when the
 * server refuses for want of authentication, before the generated
 * module refreshes or signs the account in. */
export function mcpSignInDemand(url: string): string {
  return `${url} demands a sign-in`;
}

/** The oauth material a signed-in MCP account stores: the token
 * payload the exchange answered, refreshed in place, with the client
 * the plane registered and the server it found beside it, so a refresh
 * needs no second discovery. */
interface McpOauthTokens {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  client?: { client_id: string; client_secret?: string };
  server?: {
    authorizationServerUrl: string;
    metadata?: Record<string, unknown>;
    resource?: string;
    scope?: string;
  };
}

/** The oauth token payload of a stored `oauth-mcp` credential, or
 * undefined when the stored value is not one. */
export function mcpOauthTokensOf(secret: string): McpOauthTokens | undefined {
  try {
    const parsed: unknown = JSON.parse(secret);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const tokens = parsed as Record<string, unknown>;
    return typeof tokens['access_token'] === 'string'
      ? (tokens as unknown as McpOauthTokens)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The bearer a stored value yields: an oauth payload's access token,
 * anything else the stored value itself (a pasted token is its own
 * bearer). */
export function mcpBearerOf(secret: string): string {
  return mcpOauthTokensOf(secret)?.access_token ?? secret;
}
