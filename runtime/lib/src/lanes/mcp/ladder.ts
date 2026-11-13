// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { attemptLocalMcpCall, localMcpServers } from './local.js';
import { attemptMcpCall } from './protocol.js';
import { mcpBearerOf, mcpOauthTokensOf, mcpResultOf } from './schema.js';
import type { LocalMcpLane, McpCallResult } from './schema.js';
import type { OutsideOutcome } from '../../language/outside.js';
import {
  discoverMcpAuthorization,
  oauthAuthorizationUrl,
  oauthExchange,
  oauthRefresh,
  registerOauthClient,
  registersClients,
} from '../oauth.js';
import type { OauthServer } from '../oauth.js';
import type { OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { LaneOptions } from '../record.js';
import { fetchUnder, recordLane, sleepUnder } from '../record.js';
import type { CernantoError } from '../../language/errors.js';

// The auth ladder every generated mcp module of a remote server rides,
// as code: the stored value read fresh before every call, the attempt
// inside one record, a refresh once for a stale token, and the sign-in
// on the plane when the server demands one that nothing stored can
// answer. The generated module is the grant's constants and one
// exported function per tool; it hands the safe's functions in (its
// own account, under its own name) and this ladder holds every rule. A
// local server's module rides the same attempts inside one record, the
// attempts alone: its environment is its command's.

/** The grant's constants a generated module carries. */
export interface McpLane {
  /** The server url the tools are called on. */
  server: string;
  /** The module's name, the label its records carry. */
  module: string;
  /** The server url's host: the provider word, and the name of the
   * agent's account for the server when the caller names none. */
  host: string;
}

/** One credential field the operator fills. */
export interface AskedField {
  name: string;
  label: string;
  secret?: boolean;
}

/** The safe's functions a generated module hands in: its own account,
 * keyed by the calling agent and a name. */
export interface McpCustody {
  login(args: {
    name?: string;
    provider: string;
    instructions: string;
    fields: AskedField[];
    helpUrl?: string;
    scopes?: string[];
    refused?: string;
  }): Promise<{ fields: Record<string, string>; scopes: string[] }>;
  pin(args: { name?: string; provider: string }): Promise<{ state: string; redirectUrl: string }>;
  authorize(args: {
    name?: string;
    provider: string;
    authUrl: string;
    state?: string;
    codeVerifier?: string;
    scopes?: string[];
  }): Promise<{ code: string; codeVerifier?: string }>;
  read(args: { name: string }): Promise<{ value: string | null }>;
  store(args: {
    name?: string;
    provider: string;
    kind: string;
    value: string;
  }): Promise<{ ok: boolean }>;
}

const MAX_ATTEMPTS = 5;

function recordOf(options: LaneOptions | undefined): NonNullable<LaneOptions['record']> {
  return options?.record ?? recordLane;
}

function fetchOf(options: LaneOptions | undefined, signal: AbortSignal): typeof fetch {
  return fetchUnder(signal, options?.fetch ?? fetch);
}

function nameOf(lane: McpLane, name: string | undefined): string {
  return name ?? lane.host;
}

function accountOf(lane: McpLane, name: string | undefined): { name?: string; provider: string } {
  return { ...(name === undefined ? {} : { name }), provider: lane.host };
}

/** The server demanding a sign-in, thrown out of an attempt for the
 * ladder to answer with a refresh or the operator's authorization. */
class SignInDemanded extends Error {
  readonly demand: { resourceMetadataUrl?: string };

  constructor(message: string, demand: { resourceMetadataUrl?: string }) {
    super(message);
    this.name = 'SignInDemanded';
    this.demand = demand;
  }
}

/** The stored value of the account, read fresh before every call and
 * held for that call alone. */
async function storedValue(
  lane: McpLane,
  custody: McpCustody,
  name: string | undefined,
): Promise<string | undefined> {
  const { value } = await custody.read({ name: nameOf(lane, name) });
  return value === null || value === '' ? undefined : value;
}

/** One tool call, retried inside a single record: a replay answers the
 * recorded outcome in place of the server. The attempt and the wait
 * between attempts run under the record's signal, so an ended attempt
 * ends them with its own reason, unrecorded. */
function recordedAttempts(
  module: string,
  tool: string,
  attempt: (signal: AbortSignal) => Promise<OutsideOutcome<McpCallResult>>,
  options: LaneOptions | undefined,
): Promise<OutsideOutcome<McpCallResult>> {
  return recordOf(options)(`mcp ${module}/${tool}`, async (signal) => {
    for (let tried = 1; ; tried += 1) {
      try {
        return await attempt(signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const failure = error as Partial<CernantoError>;
        if (failure.kind !== 'retryable' || tried >= MAX_ATTEMPTS) {
          return {
            failed: { kind: 'terminal' as const, message: failure.message ?? String(error) },
          };
        }
        await sleepUnder(1000 * 2 ** (tried - 1), signal);
      }
    }
  });
}

/** What a tool call's recorded outcome answers the calling code: the
 * result by the output ladder, or the failure thrown in its words. */
function answerOf(module: string, tool: string, outcome: OutsideOutcome<McpCallResult>): unknown {
  if ('ok' in outcome) {
    // A result the server flagged as an error is the tool's failure,
    // in the tool's own words: the caller's code does not go on as if
    // the tool had done its work.
    if (outcome.ok.isError) {
      const said = mcpResultOf(outcome.ok);
      const words =
        typeof said === 'string' ? said : said === undefined ? '' : JSON.stringify(said);
      throw Object.assign(
        new Error(`mcp ${module}.${tool} failed${words === '' ? '' : `: ${words.slice(0, 2000)}`}`),
        { kind: 'terminal' as const },
      );
    }
    return mcpResultOf(outcome.ok);
  }
  throw Object.assign(new Error(outcome.failed.message), { kind: outcome.failed.kind });
}

/** One tool call of a remote server under one bearer: the attempts in
 * one record, a sign-in demand lifted for the ladder to answer. */
async function attemptOn(
  lane: McpLane,
  tool: string,
  args: Record<string, unknown>,
  bearer: string | undefined,
  options: LaneOptions | undefined,
): Promise<unknown> {
  const binding = { module: lane.module, url: lane.server, tool };
  const outcome = await recordedAttempts(
    lane.module,
    tool,
    (signal) => attemptMcpCall(binding, args, bearer, fetchOf(options, signal)),
    options,
  );
  if ('failed' in outcome && outcome.failed.signIn !== undefined) {
    throw new SignInDemanded(outcome.failed.message, outcome.failed.signIn);
  }
  return answerOf(lane.module, tool, outcome);
}

/**
 * A tool call of a local server, the road every generated module of a
 * local server rides: the attempts in one record, each on the server
 * this process keeps for the command (started when there is none), the
 * command carrying the server's environment.
 */
export async function localMcpCallThrough(
  lane: LocalMcpLane,
  tool: string,
  args: object,
  options?: LaneOptions,
): Promise<unknown> {
  const keeper = options?.keeper ?? localMcpServers;
  const outcome = await recordedAttempts(
    lane.module,
    tool,
    (signal) => attemptLocalMcpCall(lane, tool, args as Record<string, unknown>, keeper, signal),
    options,
  );
  return answerOf(lane.module, tool, outcome);
}

/** A stale oauth token, refreshed once with the client and the server
 * the sign-in kept beside it; undefined when nothing can be refreshed
 * or the server refused the grant. The stored value is read and the
 * refreshed tokens stored inside the recorded step, which keeps only
 * whether the refresh went through. */
async function refreshedBearer(
  lane: McpLane,
  custody: McpCustody,
  name: string | undefined,
  options: LaneOptions | undefined,
  known: string | undefined,
): Promise<string | undefined> {
  const refreshed = await recordOf(options)(`oauth refresh ${lane.host}`, async (signal) => {
    const secret = known ?? (await storedValue(lane, custody, name));
    const payload = secret === undefined ? undefined : mcpOauthTokensOf(secret);
    if (
      payload === undefined ||
      typeof payload.refresh_token !== 'string' ||
      payload.client === undefined ||
      payload.server === undefined
    ) {
      return { refreshed: false };
    }
    const { refresh_token: refreshToken, client, server } = payload;
    const fresh = await oauthRefresh(
      server as OauthServer,
      client,
      refreshToken,
      fetchOf(options, signal),
    );
    if (fresh === undefined) return { refreshed: false };
    const merged = { ...payload, ...fresh, refresh_token: fresh.refresh_token ?? refreshToken };
    await custody.store({
      ...accountOf(lane, name),
      kind: 'oauth-mcp',
      value: JSON.stringify(merged),
    });
    return { refreshed: true };
  });
  if (!refreshed.refreshed) return undefined;
  const stored = await custody.read({ name: nameOf(lane, name) });
  const again = stored.value === null ? undefined : mcpOauthTokensOf(stored.value);
  return again === undefined || typeof again.access_token !== 'string'
    ? undefined
    : again.access_token;
}

/** The client this plane registers with the server, else the one the
 * operator registered by hand when the server registers none: run
 * inside the sign-in's recorded step, so the client's secret reaches no
 * record. */
async function clientFor(
  lane: McpLane,
  custody: McpCustody,
  name: string | undefined,
  server: OauthServer,
  redirectUrl: string,
  options: LaneOptions | undefined,
  signal: AbortSignal,
): Promise<OAuthClientInformationMixed> {
  if (registersClients(server)) {
    return registerOauthClient(server, redirectUrl, fetchOf(options, signal));
  }
  const { fields } = await custody.login({
    ...accountOf(lane, name),
    instructions: `${lane.host} registers no clients of its own.\n1. Sign in to the provider, ${lane.host}, and open its developer or integrations settings.\n2. Register an OAuth client (an app) with this plane's callback url as its redirect: ${redirectUrl}\n3. Paste the client id, and the client secret when it issued one.`,
    fields: [
      { name: 'clientId', label: 'Client ID' },
      { name: 'clientSecret', label: 'Client secret', secret: true },
    ],
    helpUrl: `https://${lane.host}/`,
  });
  const clientId = fields['clientId'];
  if (clientId === undefined || clientId === '') {
    throw new Error(`the ${lane.host} account holds no client id; log it in again`);
  }
  const clientSecret = fields['clientSecret'];
  return {
    client_id: clientId,
    ...(clientSecret === undefined || clientSecret === '' ? {} : { client_secret: clientSecret }),
  };
}

/** The sign-in, run on the plane: the server's authorization server
 * found, then a pasted token asked of the operator and stored when the
 * server publishes no authorization server, else the state pinned by a
 * plain call and one recorded step that holds the whole flow (a client
 * registered or asked of the operator, the operator's authorization in
 * the browser, which the safe holds until the callback lands at the
 * plane, the code exchanged, the tokens stored under the account with
 * the client and the server beside them). Each step records only that
 * it went through: a replay asks the operator nothing again and reads
 * the bearer back from the safe, and no record holds a token, a code
 * or a client's secret. */
async function signedInBearer(
  lane: McpLane,
  custody: McpCustody,
  name: string | undefined,
  demand: { resourceMetadataUrl?: string },
  refused: string | undefined,
  options: LaneOptions | undefined,
): Promise<string> {
  const record = recordOf(options);
  const found = await record(`oauth discover ${lane.host}`, (signal) =>
    discoverMcpAuthorization(lane.server, demand.resourceMetadataUrl, fetchOf(options, signal)),
  );
  if (found.kind === 'none') {
    let token: string | undefined;
    await record(`oauth token ${lane.host}`, async () => {
      const { fields } = await custody.login({
        ...accountOf(lane, name),
        instructions: `${lane.host} authenticates with a bearer token and publishes no authorization server.\n1. Sign in to the provider, ${lane.host}, and open its developer or integrations settings.\n2. Create an access token for this server with the access it needs.\n3. Paste it below.`,
        fields: [{ name: 'token', label: 'Token', secret: true }],
        helpUrl: `https://${lane.host}/`,
        ...(refused === undefined ? {} : { refused }),
      });
      const pasted = fields['token'];
      if (pasted === undefined || pasted === '') {
        throw new Error(`the ${lane.host} account holds no usable token; log it in again`);
      }
      await custody.store({ ...accountOf(lane, name), kind: 'api-key', value: pasted });
      token = pasted;
      return { stored: true };
    });
    if (token !== undefined) return token;
    const stored = await storedValue(lane, custody, name);
    return stored === undefined ? '' : mcpBearerOf(stored);
  }
  const server = found.server;
  const pinned = await custody.pin(accountOf(lane, name));
  await record(`oauth sign-in ${lane.host}`, async (signal) => {
    const client = await clientFor(
      lane,
      custody,
      name,
      server,
      pinned.redirectUrl,
      options,
      signal,
    );
    const started = await oauthAuthorizationUrl(server, client, {
      redirectUrl: pinned.redirectUrl,
      state: pinned.state,
      ...(server.scope === undefined ? {} : { scope: server.scope }),
    });
    const answer = await custody.authorize({
      ...accountOf(lane, name),
      authUrl: started.authorizationUrl,
      state: pinned.state,
      codeVerifier: started.codeVerifier,
    });
    const tokens = await oauthExchange(
      server,
      client,
      {
        code: answer.code,
        codeVerifier: answer.codeVerifier ?? started.codeVerifier,
        redirectUrl: pinned.redirectUrl,
      },
      fetchOf(options, signal),
    );
    await custody.store({
      ...accountOf(lane, name),
      kind: 'oauth-mcp',
      value: JSON.stringify({ ...tokens, client, server }),
    });
    return { signedIn: true };
  });
  const stored = await custody.read({ name: nameOf(lane, name) });
  const payload = stored.value === null ? undefined : mcpOauthTokensOf(stored.value);
  return payload === undefined || typeof payload.access_token !== 'string'
    ? ''
    : payload.access_token;
}

/**
 * The ladder every tool function rides: the stored value, the
 * attempt, a refresh once for a stale token, the sign-in when the
 * server demands one and nothing stored can answer it, then the
 * attempt again. Every rung is durable on its own: the safe's calls,
 * the park among them, are journaled wire calls, and the attempts,
 * the discovery, the registration, the exchange and the refresh are
 * records, so a replay walks the same ladder.
 */
export async function mcpCallThrough(
  lane: McpLane,
  custody: McpCustody,
  tool: string,
  args: object,
  name?: string,
  options?: LaneOptions,
): Promise<unknown> {
  const record = recordOf(options);
  const attempt = (bearer: string | undefined): Promise<unknown> =>
    attemptOn(lane, tool, args as Record<string, unknown>, bearer, options);
  // What the safe holds is read live inside a recorded step that keeps
  // whether it held a value, never the value: a replay walks the same
  // ladder, whatever the safe holds by then, and reads the value back.
  let stored: string | undefined;
  const holds = await record(`oauth held ${lane.host}`, async () => {
    stored = await storedValue(lane, custody, name);
    return { held: stored !== undefined };
  });
  const held = async (): Promise<string | undefined> =>
    stored ?? (await storedValue(lane, custody, name));
  try {
    const value = holds.held ? await held() : undefined;
    return await attempt(value === undefined ? undefined : mcpBearerOf(value));
  } catch (error) {
    if (!(error instanceof SignInDemanded)) throw error;
    if (holds.held) {
      const refreshed = await refreshedBearer(lane, custody, name, options, stored);
      if (refreshed !== undefined) return attempt(refreshed);
      // The refusal rule, decided once and recorded: asked again only
      // once a plain read shows the stored value is still the refused
      // one; a value another call replaced meanwhile rides as it is.
      let current: string | undefined;
      const changed = await record(`oauth changed ${lane.host}`, async () => {
        current = await storedValue(lane, custody, name);
        return { changed: current !== undefined && stored !== undefined && current !== stored };
      });
      if (changed.changed) {
        const value = current ?? (await storedValue(lane, custody, name));
        return attempt(value === undefined ? undefined : mcpBearerOf(value));
      }
    }
    const refused = holds.held ? error.message : undefined;
    return attempt(await signedInBearer(lane, custody, name, error.demand, refused, options));
  }
}
