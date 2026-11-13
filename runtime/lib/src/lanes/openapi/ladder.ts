// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { attemptOpenApiRequest, openApiRequestOf, openApiAuthOf } from './http.js';
import type { OpenApiOperationBinding } from './schema.js';
import {
  oauthAuthorizationUrl,
  oauthExchange,
  oauthExpiresAt,
  oauthRefresh,
  oauthServerOfFlow,
} from '../oauth.js';
import type { LaneOptions } from '../record.js';
import { fetchUnder, recordLane, sleepUnder } from '../record.js';
import type { CernantoError } from '../../language/errors.js';

// The call-through every generated openapi module rides, and the
// secret ladder a secured one rides, as code: the operation attempted
// inside one record, the credential asked of the operator when the
// account is missing, asked again with the provider's words when the
// provider refused the stored one, and for an oauth2 flow the
// authorization run on the plane with the tokens saved as the
// account's state. The generated module is the grant's constants and
// one exported function per operation; it hands the safe's functions
// in and this ladder holds every rule.

/** One credential field the operator fills. */
export interface AskedField {
  name: string;
  label: string;
  secret?: boolean;
}

/** The safe's functions a generated module hands in: its own account,
 * keyed by the calling agent and a name. The oauth2 four are needed
 * for an oauth2 flow alone. */
export interface OpenApiCustody {
  login(args: {
    name?: string;
    provider: string;
    instructions: string;
    fields: AskedField[];
    helpUrl?: string;
    scopes?: string[];
    refused?: string;
  }): Promise<{ fields: Record<string, string>; scopes: string[] }>;
  pin?(args: { name?: string; provider: string }): Promise<{ state: string; redirectUrl: string }>;
  authorize?(args: {
    name?: string;
    provider: string;
    authUrl: string;
    state?: string;
    codeVerifier?: string;
    scopes?: string[];
  }): Promise<{ code: string; codeVerifier?: string }>;
  saveState?(args: {
    name: string;
    state: unknown;
    grantedScopes?: string[];
  }): Promise<{ ok: boolean }>;
  state?(args: {
    name: string;
    requiredScopes?: string[];
  }): Promise<{ state: unknown; stale: boolean }>;
}

/** The secured module's constants: the module's name, the provider
 * word (the document's server host, the name of the agent's account
 * for the api when the caller names none), and the document's oauth2
 * flow when its scheme declares one. */
export interface OpenApiSecured {
  module: string;
  provider: string;
  /** The page an operator opens to get the credential: the document's
   * own documentation url when it names one, else the provider's site. */
  helpUrl?: string;
  /** The words the account is asked with, judged at the compile from the
   * agent's specification and the document and pinned in the package:
   * the page to open, numbered steps, the scopes the agent's work
   * needs, and, when judged, the road the operator walks (`token`: a
   * credential the provider issues for direct use is pasted; `client`:
   * an OAuth client is registered and the lane runs the browser flow)
   * and the provider's name for what is pasted, the field's label.
   * Absent, the asks fall back to their generic steps and offer both
   * roads. */
  onboarding?: {
    helpUrl: string;
    instructions: string;
    scopes: string[];
    road?: 'token' | 'client';
    credential?: string;
  };
  oauth2?: { authorizationUrl: string; tokenUrl: string; scopes: string[] };
}

/** The page the ask points the operator to. */
function helpUrlOf(secured: OpenApiSecured): string {
  return secured.onboarding?.helpUrl ?? secured.helpUrl ?? `https://${secured.provider}/`;
}

/** The ask's steps: the pinned onboarding words when the compile judged
 * them, else the generic steps given. */
function stepsOf(secured: OpenApiSecured, generic: string): string {
  return secured.onboarding?.instructions ?? generic;
}

const MAX_ATTEMPTS = 5;
/** How close to its expiry a token is refreshed. */
const REFRESH_AHEAD_MS = 60_000;

function recordOf(options: LaneOptions | undefined): NonNullable<LaneOptions['record']> {
  return options?.record ?? recordLane;
}

function fetchOf(options: LaneOptions | undefined, signal: AbortSignal): typeof fetch {
  return fetchUnder(signal, options?.fetch ?? fetch);
}

function nowOf(options: LaneOptions | undefined): number {
  return options?.now?.() ?? Date.now();
}

/**
 * One operation, attempted until the server answers or the budget is
 * spent, inside one record: a replay answers the recorded outcome in
 * place of the server. The request and the wait between attempts run
 * under the record's signal, so an ended attempt ends them with its own
 * reason, unrecorded. A refusal throws an Error carrying the http
 * `status`, so a ladder can tell a refused credential from any other
 * refusal.
 */
export async function callThroughOpenApi(
  binding: OpenApiOperationBinding,
  args: object,
  secret?: string,
  options?: LaneOptions,
): Promise<unknown> {
  const outcome = await recordOf(options)(
    `openapi ${binding.module}/${binding.operation}`,
    async (signal) => {
      for (let attempt = 1; ; attempt += 1) {
        const request = openApiRequestOf(binding, args, openApiAuthOf(binding, secret));
        try {
          return await attemptOpenApiRequest(request, fetchOf(options, signal));
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          const failure = error as Partial<CernantoError> & { retryAfterMs?: number };
          if (failure.kind !== 'retryable' || attempt >= MAX_ATTEMPTS) {
            return {
              failed: { kind: 'terminal' as const, message: failure.message ?? String(error) },
            };
          }
          await sleepUnder(failure.retryAfterMs ?? 1000 * 2 ** (attempt - 1), signal);
        }
      }
    },
  );
  if ('ok' in outcome) return outcome.ok;
  throw Object.assign(new Error(outcome.failed.message), {
    ...(outcome.failed.status === undefined ? {} : { status: outcome.failed.status }),
  });
}

/** A refused credential: the provider says the credential itself is bad
 * (401); for an oauth2 flow also a grant too narrow (403 naming
 * `insufficient_scope`). A permission denial, a connection failure or
 * a timeout is something else: re-entering a credential cannot fix
 * those. */
export function wasRefused(error: unknown, oauth2: boolean): boolean {
  const status = (error as { status?: unknown }).status;
  if (status === 401) return true;
  if (!oauth2 || status !== 403) return false;
  const words = error instanceof Error ? error.message : String(error);
  return /insufficient_scope/.test(words);
}

function nameOf(secured: OpenApiSecured, account: string | undefined): string {
  return account ?? secured.provider;
}

function accountOf(
  secured: OpenApiSecured,
  account: string | undefined,
): { name?: string; provider: string } {
  return { ...(account === undefined ? {} : { name: account }), provider: secured.provider };
}

/** The words for how the api authenticates, from the binding's scheme. */
function carrierOf(security: NonNullable<OpenApiOperationBinding['security']>): string {
  if (security.scheme === 'bearer') return 'a bearer token in the authorization header';
  if (security.scheme === 'apiKeyHeader') {
    return `an api key in the "${security.name ?? 'x-api-key'}" header`;
  }
  return `an api key in the "${security.name ?? 'key'}" query parameter`;
}

/** The pasted credential of the account: asked of the operator when
 * the account is missing, and asked again with the provider's words
 * when the provider refused the stored one. */
async function pastedCredential(
  secured: OpenApiSecured,
  custody: OpenApiCustody,
  security: NonNullable<OpenApiOperationBinding['security']>,
  account: string | undefined,
  refused: string | undefined,
): Promise<string> {
  const described = security.description === undefined ? '' : `\n${security.description}`;
  const judged = secured.onboarding;
  const label = judged?.credential ?? (security.scheme === 'bearer' ? 'Token' : 'API key');
  const { fields } = await custody.login({
    ...accountOf(secured, account),
    instructions:
      judged === undefined
        ? `The "${secured.module}" api authenticates with ${carrierOf(security)}.${described}\n1. Sign in to the provider, ${secured.provider}, and open its developer or integrations settings.\n2. Create an access token for this api (an api key, a personal or a private app token) with the access it needs.\n3. Paste it below; it is stored in the platform's safe as this agent's "${secured.provider}" account and never appears in journals or traces.`
        : judged.instructions,
    fields: [{ name: 'secret', label, secret: true }],
    helpUrl: helpUrlOf(secured),
    ...(secured.onboarding === undefined ? {} : { scopes: secured.onboarding.scopes }),
    ...(refused === undefined ? {} : { refused }),
  });
  const value = fields['secret'];
  if (value === undefined || value === '') {
    throw new Error(`the ${secured.provider} account holds no usable credential; log it in again`);
  }
  return value;
}

type Oauth2 = NonNullable<OpenApiSecured['oauth2']>;

interface SavedTokens {
  access_token: string;
  refresh_token?: string | undefined;
  expires_in?: number | undefined;
  expiresAt?: number | undefined;
  [extra: string]: unknown;
}

function isSavedTokens(value: unknown): value is SavedTokens {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { access_token?: unknown }).access_token === 'string'
  );
}

/** The oauth2 functions of the safe, present for an oauth2 module. */
function oauthCustody(custody: OpenApiCustody): Required<OpenApiCustody> {
  if (
    custody.pin === undefined ||
    custody.authorize === undefined ||
    custody.saveState === undefined ||
    custody.state === undefined
  ) {
    throw new Error("an oauth2 module hands the safe's pin, authorize, saveState and state in");
  }
  return custody as Required<OpenApiCustody>;
}

type OauthClient = { client_id: string; client_secret?: string };

/** What the operator gave for an oauth2 api, asked for once in one
 * ask: a token they already hold (a personal or a private app access
 * token), which rides as the bearer and runs no flow, or the client
 * they registered with the provider, whose flow runs in the browser;
 * the plane's callback url rides the instructions. A pasted token the
 * provider refused is asked for again with the provider's words; a
 * refusal on the flow's road is the caller's to answer with a fresh
 * authorization. */
async function oauthAsk(
  secured: OpenApiSecured,
  custody: Required<OpenApiCustody>,
  flow: Oauth2,
  security: NonNullable<OpenApiOperationBinding['security']>,
  account: string | undefined,
  refused: string | undefined,
  redirectUrl: string | undefined,
): Promise<{ token: string } | { client: OauthClient }> {
  const described = security.description === undefined ? '' : `\n${security.description}`;
  // The judged road, when the compile pinned one: the token road asks for
  // the provider's credential alone, named as the provider names it;
  // the client road asks for the client alone. Unjudged, the ask offers
  // both roads with the runtime's generic words. The plane's callback
  // url is pinned for the words that name it alone: the token road
  // registers no OAuth state.
  const judged = secured.onboarding;
  const road = judged?.road;
  const tokenLabel = judged?.credential ?? 'Token';
  let instructions: string;
  if (judged !== undefined && road === 'token') {
    instructions = judged.instructions;
  } else {
    instructions =
      judged !== undefined && road === 'client'
        ? `${judged.instructions}\nThe client's redirect url is this plane's callback url, ${redirectUrl}.`
        : `The "${secured.module}" api authenticates with OAuth 2.0.${described}\n${stepsOf(
            secured,
            `1. Sign in to the provider, ${secured.provider}, and open its developer or integrations settings.\n2. Paste a token you already hold for this api (a personal or a private app access token) as the token, and leave the client fields empty.\n3. Otherwise leave the token empty, register an OAuth client with the provider with this plane's callback url as its redirect, ${redirectUrl}, and paste the client id and the client secret it issued.`,
          )}\nA token you already hold goes in the token field and the client fields stay empty; an OAuth client goes in the client fields with the token empty, its redirect this plane's callback url, ${redirectUrl}.`;
  }
  const askedFields =
    road === 'token'
      ? [{ name: 'secret', label: tokenLabel, secret: true }]
      : road === 'client'
        ? [
            { name: 'clientId', label: 'Client ID' },
            { name: 'clientSecret', label: 'Client secret', secret: true },
          ]
        : [
            { name: 'secret', label: 'Token (empty to sign in through the browser)', secret: true },
            { name: 'clientId', label: 'OAuth client ID (when no token)' },
            { name: 'clientSecret', label: 'OAuth client secret (when no token)', secret: true },
          ];
  const ask = (again: string | undefined): ReturnType<OpenApiCustody['login']> =>
    custody.login({
      ...accountOf(secured, account),
      instructions,
      fields: askedFields,
      helpUrl: helpUrlOf(secured),
      scopes: secured.onboarding?.scopes ?? flow.scopes,
      ...(again === undefined ? {} : { refused: again }),
    });
  let { fields } = await ask(undefined);
  const pasted = road === 'client' ? undefined : fields['secret'];
  if (pasted !== undefined && pasted !== '') {
    if (refused === undefined) return { token: pasted };
    ({ fields } = await ask(refused));
    const fresh = fields['secret'];
    if (fresh === undefined || fresh === '') {
      throw new Error(
        `the ${secured.provider} account holds no usable ${tokenLabel.toLowerCase()}; log it in again`,
      );
    }
    return { token: fresh };
  }
  if (road === 'token') {
    throw new Error(
      `the ${secured.provider} account holds no usable ${tokenLabel.toLowerCase()}; log it in again`,
    );
  }
  const clientId = fields['clientId'];
  if (clientId === undefined || clientId === '') {
    throw new Error(
      `the ${secured.provider} account holds neither a token nor a client id; log it in again`,
    );
  }
  const clientSecret = fields['clientSecret'];
  return {
    client: {
      client_id: clientId,
      ...(clientSecret === undefined || clientSecret === '' ? {} : { client_secret: clientSecret }),
    },
  };
}

/** A fresh authorization: the state pinned by a plain call, then one
 * recorded step that holds the whole sign-in (the authorization url,
 * the operator's authorization in the browser, the code exchanged, the
 * tokens saved as the account's state with the moment they expire) and
 * records only that it signed in, so a replay never asks the operator
 * again and the journal never holds a code or a token. */
async function authorizeAgain(
  secured: OpenApiSecured,
  custody: Required<OpenApiCustody>,
  flow: Oauth2,
  account: string | undefined,
  client: () => Promise<OauthClient>,
  options: LaneOptions | undefined,
): Promise<void> {
  const server = oauthServerOfFlow(flow);
  const pinned = await custody.pin(accountOf(secured, account));
  const name = nameOf(secured, account);
  await recordOf(options)(`oauth sign-in ${secured.provider}`, async (signal) => {
    const own = await client();
    const started = await oauthAuthorizationUrl(server, own, {
      redirectUrl: pinned.redirectUrl,
      state: pinned.state,
      ...(flow.scopes.length === 0 ? {} : { scope: flow.scopes.join(' ') }),
    });
    const answer = await custody.authorize({
      ...accountOf(secured, account),
      authUrl: started.authorizationUrl,
      state: pinned.state,
      codeVerifier: started.codeVerifier,
      scopes: flow.scopes,
    });
    const obtainedAt = nowOf(options);
    const tokens = await oauthExchange(
      server,
      own,
      {
        code: answer.code,
        codeVerifier: answer.codeVerifier ?? started.codeVerifier,
        redirectUrl: pinned.redirectUrl,
      },
      fetchOf(options, signal),
    );
    const saved: SavedTokens = { ...tokens, expiresAt: oauthExpiresAt(tokens, obtainedAt) };
    await custody.saveState({ name, state: saved, grantedScopes: flow.scopes });
    return { signedIn: true };
  });
}

/** The access token the safe holds for the account now, read without
 * holding; empty when it holds none, which the provider refuses and the
 * ladder answers. */
async function heldToken(
  secured: OpenApiSecured,
  custody: Required<OpenApiCustody>,
  flow: Oauth2,
  account: string | undefined,
): Promise<string> {
  const kept = await custody.state({ name: nameOf(secured, account), requiredScopes: flow.scopes });
  return isSavedTokens(kept.state) ? kept.state.access_token : '';
}

/** The bearer of an oauth2 account: a token the operator pasted, as
 * it is; else the saved tokens, refreshed when they near their expiry,
 * and a fresh authorization when there are none, they are stale for
 * the scopes, or the provider refused them. Every road is chosen inside
 * a recorded step that keeps the choice and none of the values, the
 * values read live from the safe: a replay walks the steps the first
 * run walked, whatever the safe holds by then, and the journal holds no
 * credential. */
async function oauthCredential(
  secured: OpenApiSecured,
  custody: Required<OpenApiCustody>,
  flow: Oauth2,
  security: NonNullable<OpenApiOperationBinding['security']>,
  account: string | undefined,
  refused: string | undefined,
  options: LaneOptions | undefined,
): Promise<string> {
  const record = recordOf(options);
  const provider = secured.provider;
  // The callback url the client ask names is pinned by a plain call,
  // journaled, before the ask.
  const redirectUrl =
    secured.onboarding?.road === 'token'
      ? undefined
      : (await custody.pin(accountOf(secured, account))).redirectUrl;
  const ask = (again: string | undefined): ReturnType<typeof oauthAsk> =>
    oauthAsk(secured, custody, flow, security, account, again, redirectUrl);
  let asked: Awaited<ReturnType<typeof oauthAsk>> | undefined;
  const road = await record(`oauth ask ${provider}`, async () => {
    asked = await ask(refused);
    return { road: 'token' in asked ? 'token' : 'client' };
  });
  // A replay reads what the ask answered back from the safe, without
  // holding: the stored fields answer a plain ask at once.
  const answered = async (): Promise<{ token: string } | { client: OauthClient }> =>
    asked ?? (await ask(undefined));
  if (road.road === 'token') {
    const held = await answered();
    return 'token' in held ? held.token : '';
  }
  const client = async (): Promise<OauthClient> => {
    const held = await answered();
    if ('client' in held) return held.client;
    throw new Error(`the ${provider} account changed under this call; log it in again`);
  };
  const name = nameOf(secured, account);
  const step = await record(`oauth road ${provider}`, async () => {
    const saved = await custody.state({ name, requiredScopes: flow.scopes });
    const kept = isSavedTokens(saved.state) ? saved.state : undefined;
    if (kept === undefined || saved.stale || refused !== undefined) return { step: 'authorize' };
    const expiring =
      typeof kept.refresh_token === 'string' &&
      typeof kept.expiresAt === 'number' &&
      kept.expiresAt - nowOf(options) < REFRESH_AHEAD_MS;
    return { step: expiring ? 'refresh' : 'kept' };
  });
  if (step.step === 'kept') return heldToken(secured, custody, flow, account);
  if (step.step === 'refresh') {
    // As the sign-in: the refreshed tokens go to the safe inside the
    // recorded step, the record keeps whether the refresh went through.
    const refreshed = await record(`oauth refresh ${provider}`, async (signal) => {
      const saved = await custody.state({ name, requiredScopes: flow.scopes });
      const kept = isSavedTokens(saved.state) ? saved.state : undefined;
      if (kept === undefined || typeof kept.refresh_token !== 'string') return { refreshed: false };
      const refreshToken = kept.refresh_token;
      const obtainedAt = nowOf(options);
      const fresh = await oauthRefresh(
        oauthServerOfFlow(flow),
        await client(),
        refreshToken,
        fetchOf(options, signal),
      );
      if (fresh === undefined) return { refreshed: false };
      const merged: SavedTokens = {
        ...kept,
        ...fresh,
        refresh_token: fresh.refresh_token ?? refreshToken,
        expiresAt: oauthExpiresAt(fresh, obtainedAt),
      };
      await custody.saveState({ name, state: merged, grantedScopes: flow.scopes });
      return { refreshed: true };
    });
    if (refreshed.refreshed) return heldToken(secured, custody, flow, account);
  }
  await authorizeAgain(secured, custody, flow, account, client, options);
  return heldToken(secured, custody, flow, account);
}

/**
 * The secret ladder a secured operation rides: the credential (asked
 * for, and parked on, when the account is missing), the call-through
 * with it, and on a refusal the credential read again, asked afresh
 * with the provider's words only when the stored one is still the
 * refused one, then the call-through again, as many times as the
 * provider refuses, since each ask needs the operator. Any other
 * failure is rethrown as it is. Every rung is durable: the safe's
 * calls are journaled wire calls and each operation, exchange and
 * refresh is one record.
 */
export async function securedOpenApiCall(
  secured: OpenApiSecured,
  custody: OpenApiCustody,
  binding: OpenApiOperationBinding,
  args: object,
  account?: string,
  options?: LaneOptions,
): Promise<unknown> {
  const security = binding.security;
  if (security === undefined) return callThroughOpenApi(binding, args, undefined, options);
  const flow = secured.oauth2;
  const record = recordOf(options);
  // A pasted credential is asked inside a recorded step that keeps that
  // it was asked, the value read back from the safe on a replay (the
  // stored fields answer a plain ask at once).
  const pasted = async (refused: string | undefined): Promise<string> => {
    let value: string | undefined;
    await record(`credential ${secured.provider}`, async () => {
      value = await pastedCredential(secured, custody, security, account, refused);
      return { asked: true };
    });
    return value ?? (await pastedCredential(secured, custody, security, account, undefined));
  };
  const credentialOf = (refused?: string): Promise<string> =>
    flow === undefined
      ? pasted(refused)
      : oauthCredential(secured, oauthCustody(custody), flow, security, account, refused, options);
  let secret = await credentialOf();
  for (;;) {
    try {
      return await callThroughOpenApi(binding, args, secret, options);
    } catch (error) {
      if (!wasRefused(error, flow !== undefined)) throw error;
      const words = error instanceof Error ? error.message : String(error);
      const stored = await credentialOf();
      // The refusal rule, decided once and recorded: asked again with
      // the provider's words only when the stored credential is still
      // the refused one; one another call replaced meanwhile rides.
      const unchanged = await record(`credential refused ${secured.provider}`, () =>
        Promise.resolve({ same: stored === secret }),
      );
      secret = unchanged.same ? await credentialOf(words) : stored;
    }
  }
}
