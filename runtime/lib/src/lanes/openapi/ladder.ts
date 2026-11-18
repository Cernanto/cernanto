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
import { AcceptedAccounts, recordedAttempts } from '../attempts.js';
import type { Acceptance } from '../attempts.js';
import type { LaneOptions } from '../record.js';
import { enterSecured, fetchOf, recordOf } from '../record.js';

// The call-through every generated openapi module rides, and the
// secret ladder a secured one rides, as code: the operation attempted
// inside one record, the credential asked of the operator when the
// account is missing, asked again with the provider's words when the
// provider refused the stored one, and for an oauth2 flow the
// authorization run on the plane with the tokens saved as the
// account's state. The generated module is the grant's constants and
// one exported function per operation; it hands the safe's functions
// in and this ladder holds every rule.
//
// A RECORD HOLDS THE PROVIDER'S I/O ALONE, and the safe is asked
// between records: every call of the safe is a call of the journal,
// answered from its own record on a replay, so the operator is asked
// nothing twice and the ladder walks the rungs it walked, by the
// answers it was given. What the live world decides (the clock, a
// fresh verifier, what this process told the safe) is decided inside a
// record and recorded with it.

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
  /** Tells the safe the provider took the account's credential; handed
   * in when the plane's safe offers it. */
  accepted?(args: { name: string }): Promise<{ ok: boolean }>;
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

/** How close to its expiry a token is refreshed. */
const REFRESH_AHEAD_MS = 60_000;

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
  return recordedOperation(binding, args, secret, options, undefined);
}

/** The accounts this process told the safe were accepted: an account is
 * told once in a process's life, by the first operation the provider
 * answered with its credential. */
const acceptedAccounts = new AcceptedAccounts();

/** The wait a provider asked for before the next attempt, in a failure
 * that says again: an http answer's own word of when to ask again. */
function waitAskedBy(failure: unknown): number | undefined {
  return (failure as { retryAfterMs?: number }).retryAfterMs;
}

/** One operation's attempts inside its one record, which also keeps
 * whether the safe is owed the word; the word is told after it. The
 * request is made before each attempt and outside its watch: a binding
 * with no credential in hand says again as the operation, never as an
 * attempt of it. */
async function recordedOperation(
  binding: OpenApiOperationBinding,
  args: object,
  secret: string | undefined,
  options: LaneOptions | undefined,
  acceptance: Acceptance | undefined,
): Promise<unknown> {
  const outcome = await recordedAttempts<unknown>(
    `openapi ${binding.module}/${binding.operation}`,
    () => {
      const request = openApiRequestOf(binding, args, openApiAuthOf(binding, secret));
      return (signal) => attemptOpenApiRequest(request, fetchOf(options, signal));
    },
    options,
    { acceptance, waitAsked: waitAskedBy },
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
        ? `The "${secured.module}" api authenticates with ${carrierOf(security)}.${described}\n1. Sign in to the provider, ${secured.provider}, and open its developer or integrations settings.\n2. Create an access token for this api (an api key, a personal or a private app token) with the access it needs.\n3. Paste it below; it is stored in the platform's safe as this agent's "${secured.provider}" account and never appears in traces.`
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

/** A fresh authorization, each of the safe's calls between two records:
 * the state pinned; one record for the authorization url with its fresh
 * verifier; the operator's authorization in the browser, which the safe
 * holds until the callback lands; one record for the code exchanged,
 * which keeps the tokens with the moment they expire; the tokens saved
 * as the account's state. A replay answers every call of the safe from
 * the journal, so the operator is asked nothing again. Answers the
 * access token the exchange brought. */
async function authorizeAgain(
  secured: OpenApiSecured,
  custody: Required<OpenApiCustody>,
  flow: Oauth2,
  account: string | undefined,
  client: OauthClient,
  options: LaneOptions | undefined,
): Promise<string> {
  const record = recordOf(options);
  const server = oauthServerOfFlow(flow);
  const pinned = await custody.pin(accountOf(secured, account));
  const name = nameOf(secured, account);
  const started = await record(`oauth start ${secured.provider}`, () =>
    oauthAuthorizationUrl(server, client, {
      redirectUrl: pinned.redirectUrl,
      state: pinned.state,
      ...(flow.scopes.length === 0 ? {} : { scope: flow.scopes.join(' ') }),
    }),
  );
  const answer = await custody.authorize({
    ...accountOf(secured, account),
    authUrl: started.authorizationUrl,
    state: pinned.state,
    codeVerifier: started.codeVerifier,
    scopes: flow.scopes,
  });
  const saved = await record(
    `oauth exchange ${secured.provider}`,
    async (signal): Promise<SavedTokens> => {
      const obtainedAt = nowOf(options);
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
      return { ...tokens, expiresAt: oauthExpiresAt(tokens, obtainedAt) };
    },
  );
  await custody.saveState({ name, state: saved, grantedScopes: flow.scopes });
  return saved.access_token;
}

/** The bearer of an oauth2 account: a token the operator pasted, as
 * it is; else the saved tokens, refreshed when they near their expiry,
 * and a fresh authorization when there are none, they are stale for
 * the scopes, or the provider refused them. The safe is asked between
 * the records: what it answered stands in the journal, so a replay
 * walks the rungs the first run walked. The one choice the clock makes,
 * whether the tokens near their expiry, is made inside a record. */
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
  // The callback url the client ask names is pinned before the ask.
  const redirectUrl =
    secured.onboarding?.road === 'token'
      ? undefined
      : (await custody.pin(accountOf(secured, account))).redirectUrl;
  const asked = await oauthAsk(secured, custody, flow, security, account, refused, redirectUrl);
  if ('token' in asked) return asked.token;
  const client = asked.client;
  const name = nameOf(secured, account);
  const saved = await custody.state({ name, requiredScopes: flow.scopes });
  const kept = isSavedTokens(saved.state) ? saved.state : undefined;
  const road = await record(
    `oauth road ${provider}`,
    (): Promise<{ step: 'authorize' | 'refresh' | 'kept' }> => {
      if (kept === undefined || saved.stale || refused !== undefined)
        return Promise.resolve({ step: 'authorize' });
      const expiring =
        typeof kept.refresh_token === 'string' &&
        typeof kept.expiresAt === 'number' &&
        kept.expiresAt - nowOf(options) < REFRESH_AHEAD_MS;
      return Promise.resolve({ step: expiring ? 'refresh' : 'kept' });
    },
  );
  if (kept !== undefined && road.step === 'kept') return kept.access_token;
  if (kept !== undefined && road.step === 'refresh' && typeof kept.refresh_token === 'string') {
    const refreshToken = kept.refresh_token;
    // The record holds the provider's refresh alone and keeps the fresh
    // tokens with the moment they were obtained; the safe is told after.
    const refreshed = await record(`oauth refresh ${provider}`, async (signal) => {
      const obtainedAt = nowOf(options);
      const fresh = await oauthRefresh(
        oauthServerOfFlow(flow),
        client,
        refreshToken,
        fetchOf(options, signal),
      );
      return fresh === undefined
        ? { refreshed: false as const }
        : { refreshed: true as const, fresh, expiresAt: oauthExpiresAt(fresh, obtainedAt) };
    });
    if (refreshed.refreshed) {
      const merged: SavedTokens = {
        ...kept,
        ...refreshed.fresh,
        refresh_token: refreshed.fresh.refresh_token ?? refreshToken,
        expiresAt: refreshed.expiresAt,
      };
      await custody.saveState({ name, state: merged, grantedScopes: flow.scopes });
      return merged.access_token;
    }
  }
  return authorizeAgain(secured, custody, flow, account, client, options);
}

/**
 * The secret ladder a secured operation rides: the credential (asked
 * for, and parked on, when the account is missing), the call-through
 * with it, and on a refusal the credential read again, asked afresh
 * with the provider's words only when the stored one is still the
 * refused one, then the call-through again, as many times as the
 * provider refuses, since each ask needs the operator. Any other
 * failure is rethrown as it is. The first operation the provider
 * answers tells the safe the account was accepted. Every rung is
 * durable: the safe's calls are journaled wire calls, made between the
 * records, and each operation, exchange and refresh is one record. A
 * body taken under another recording shape is ended at the entry,
 * before any of them.
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
  enterSecured();
  const flow = secured.oauth2;
  const credentialOf = (refused?: string): Promise<string> =>
    flow === undefined
      ? pastedCredential(secured, custody, security, account, refused)
      : oauthCredential(secured, oauthCustody(custody), flow, security, account, refused, options);
  let secret = await credentialOf();
  for (;;) {
    try {
      return await recordedOperation(
        binding,
        args,
        secret,
        options,
        acceptedAccounts.of(custody, nameOf(secured, account)),
      );
    } catch (error) {
      if (!wasRefused(error, flow !== undefined)) throw error;
      // A refused credential is told again once the provider takes one.
      acceptedAccounts.refused(nameOf(secured, account));
      const words = error instanceof Error ? error.message : String(error);
      // The refusal rule: asked again with the provider's words only
      // when the stored credential is still the refused one; one another
      // call replaced meanwhile rides. Both values are the safe's
      // recorded answers, so a replay decides the same.
      const stored = await credentialOf();
      secret = stored === secret ? await credentialOf(words) : stored;
    }
  }
}
