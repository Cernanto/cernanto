// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  selectResourceURL,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

// The oauth dance a lane runs on the plane, spoken through the MCP
// SDK's client functions (the specification's discovery through the
// resource metadata and the authorization server's metadata, the
// resource indicator, dynamic registration, PKCE, the exchange, the
// refresh): the emitted mcp and openapi modules compose these into
// their ladders around the safe's `pin` and `authorize`, which pin the
// state and hold for the callback at the plane's own url. Every token
// answered is the caller's to hand to the safe.

/** An authorization server as a lane found it, kept beside the tokens
 * it minted so a refresh needs no second discovery. */
export interface OauthServer {
  /** The authorization server's url. */
  authorizationServerUrl: string;
  /** Its metadata when it publishes any; absent, the conventional
   * `/authorize`, `/token` and `/register` under the url. */
  metadata?: AuthorizationServerMetadata;
  /** The resource indicator (RFC 8707) the requests carry, when the
   * resource metadata named one. */
  resource?: string;
  /** The scope the resource metadata advertises, when it does. */
  scope?: string;
}

/** What a discovery answers: the server found, or `none` when the
 * mcp server publishes no authorization server at all (a server that
 * wants a static bearer). */
type McpDiscovery = { kind: 'server'; server: OauthServer } | { kind: 'none' };

/** The client metadata every registration presents: a public client
 * (no secret at the token endpoint), the callback at the plane as its
 * one redirect. */
function oauthClientMetadata(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: 'Cernanto',
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/**
 * Discovers an mcp server's authorization server the way the MCP
 * authorization specification says: the protected resource metadata
 * (at the url a `WWW-Authenticate` header named, else the well-known
 * locations) naming the authorization server, whose metadata names
 * its endpoints; the server's own origin stands in when it publishes
 * no resource metadata. A server that publishes no authorization
 * server metadata anywhere answers `none`.
 */
export async function discoverMcpAuthorization(
  serverUrl: string,
  resourceMetadataUrl: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<McpDiscovery> {
  const info = await discoverOAuthServerInfo(serverUrl, {
    ...(resourceMetadataUrl === undefined
      ? {}
      : { resourceMetadataUrl: new URL(resourceMetadataUrl) }),
    fetchFn,
  });
  if (info.authorizationServerMetadata === undefined) return { kind: 'none' };
  const resource = await selectResourceURL(
    serverUrl,
    {} as OAuthClientProvider,
    info.resourceMetadata,
  );
  const scope = info.resourceMetadata?.scopes_supported?.join(' ');
  return {
    kind: 'server',
    server: {
      authorizationServerUrl: info.authorizationServerUrl,
      metadata: info.authorizationServerMetadata,
      ...(resource === undefined ? {} : { resource: resource.href }),
      ...(scope === undefined || scope === '' ? {} : { scope }),
    },
  };
}

/** Whether the server registers clients dynamically. */
export function registersClients(server: OauthServer): boolean {
  return server.metadata === undefined || server.metadata.registration_endpoint !== undefined;
}

/** Registers a public client with the plane's callback as its
 * redirect; the caller asks the operator for a client when the server
 * registers none (`registersClients` says so beforehand). */
export async function registerOauthClient(
  server: OauthServer,
  redirectUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<OAuthClientInformationMixed> {
  return registerClient(server.authorizationServerUrl, {
    ...(server.metadata === undefined ? {} : { metadata: server.metadata }),
    clientMetadata: oauthClientMetadata(redirectUrl),
    ...(server.scope === undefined ? {} : { scope: server.scope }),
    fetchFn,
  });
}

/** The authorization url the browser opens, built locally with a fresh
 * PKCE pair and the state the safe pinned. The verifier is the
 * caller's to hand to the safe with the url, so a call resumed after a
 * restart still holds the verifier its challenge was made from. */
export async function oauthAuthorizationUrl(
  server: OauthServer,
  client: OAuthClientInformationMixed,
  input: { redirectUrl: string; state: string; scope?: string },
): Promise<{ authorizationUrl: string; codeVerifier: string }> {
  const started = await startAuthorization(server.authorizationServerUrl, {
    ...(server.metadata === undefined ? {} : { metadata: server.metadata }),
    clientInformation: client,
    redirectUrl: input.redirectUrl,
    state: input.state,
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(server.resource === undefined ? {} : { resource: new URL(server.resource) }),
  });
  return {
    authorizationUrl: started.authorizationUrl.toString(),
    codeVerifier: started.codeVerifier,
  };
}

/** Exchanges the code the callback brought for tokens. */
export async function oauthExchange(
  server: OauthServer,
  client: OAuthClientInformationMixed,
  input: { code: string; codeVerifier: string; redirectUrl: string },
  fetchFn: typeof fetch = fetch,
): Promise<OAuthTokens> {
  return exchangeAuthorization(server.authorizationServerUrl, {
    ...(server.metadata === undefined ? {} : { metadata: server.metadata }),
    clientInformation: client,
    authorizationCode: input.code,
    codeVerifier: input.codeVerifier,
    redirectUri: input.redirectUrl,
    ...(server.resource === undefined ? {} : { resource: new URL(server.resource) }),
    fetchFn,
  });
}

/**
 * Asks the server for fresh tokens with a refresh token. Answers the
 * payload the server handed back (the old refresh token kept when the
 * server sent no new one), or undefined when the server refused the
 * grant, which means the account needs the operator's authorization
 * again. A server that cannot be reached throws, as fetch throws, for
 * the caller's retry.
 */
export async function oauthRefresh(
  server: OauthServer,
  client: OAuthClientInformationMixed,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<OAuthTokens | undefined> {
  try {
    return await refreshAuthorization(server.authorizationServerUrl, {
      ...(server.metadata === undefined ? {} : { metadata: server.metadata }),
      clientInformation: client,
      refreshToken,
      ...(server.resource === undefined ? {} : { resource: new URL(server.resource) }),
      fetchFn,
    });
  } catch (error) {
    // The SDK parses the token endpoint's refusal into an OAuthError;
    // a refusal is the grant's end, anything else the wire's trouble.
    if (error instanceof Error && error.name !== 'TypeError' && 'errorCode' in error)
      return undefined;
    throw error;
  }
}

/** An openapi document's oauth2 flow as a server description, so the
 * openapi lane runs the same dance over the document's own urls. */
export function oauthServerOfFlow(flow: {
  authorizationUrl: string;
  tokenUrl: string;
}): OauthServer {
  return {
    authorizationServerUrl: new URL(flow.tokenUrl).origin,
    metadata: {
      issuer: new URL(flow.tokenUrl).origin,
      authorization_endpoint: flow.authorizationUrl,
      token_endpoint: flow.tokenUrl,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    },
  };
}

/** The moment a token payload expires, from its `expires_in` and the
 * moment it was obtained; a payload without an expiry reads as an
 * hour from then. */
export function oauthExpiresAt(
  tokens: { expires_in?: number | undefined },
  obtainedAtMs: number,
): number {
  const seconds =
    typeof tokens.expires_in === 'number' && tokens.expires_in > 0 ? tokens.expires_in : 3600;
  return obtainedAtMs + seconds * 1000;
}
