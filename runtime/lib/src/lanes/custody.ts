// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The safe as the ladders are handed it. A ladder speaks to the safe in
// its own records (`OpenApiCustody`, `McpCustody`); the safe's contract
// declares each function's parameters by name. A generated module hands
// in THE SAFE BY NAME, each function taking the one record keyed by the
// contract's parameter names as the seam says it, and the shaping here
// answers the custody the ladder takes: the optional settings gathered
// into one record, the help url left empty where the ladder names none.
// The seam's entries type one side and the custody interfaces the
// other, so a change of either that the other does not follow is
// refused by the type-check.

import type { ReadsOf, SEAM, SendsOf } from '../kernel/seam.js';
import type { McpCustody } from './mcp/ladder.js';
import type { OpenApiCustody } from './openapi/ladder.js';

type Safe = typeof SEAM.safe;

/** One function of the safe by name: handed what the seam's entry
 * sends, answering what the runtime reads of it. */
type ByName<Entry> = (sends: SendsOf<Entry>) => Promise<ReadsOf<Entry>>;

/** The safe by name as an openapi module hands it in: the oauth2 four
 * for an oauth2 flow alone, the accepted word when the plane's safe
 * offers it. */
export interface OpenApiSafe {
  login: ByName<Safe['login']>;
  pin?: ByName<Safe['pin']>;
  authorize?: ByName<Safe['authorize']>;
  saveState?: ByName<Safe['saveState']>;
  state?: ByName<Safe['state']>;
  accepted?: ByName<Safe['accepted']>;
}

/** The safe by name as an mcp module hands it in: the accepted word
 * when the plane's safe offers it. */
export interface McpSafe {
  login: ByName<Safe['login']>;
  pin: ByName<Safe['pin']>;
  authorize: ByName<Safe['authorize']>;
  read: ByName<Safe['read']>;
  store: ByName<Safe['store']>;
  accepted?: ByName<Safe['accepted']>;
}

/** A member a record carries only when it is given. */
function given<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { [K in Key]?: Value } {
  return (value === undefined ? {} : { [key]: value }) as { [K in Key]?: Value };
}

function loginOf(login: ByName<Safe['login']>): McpCustody['login'] {
  return (asked) =>
    login({
      provider: asked.provider,
      instructions: asked.instructions,
      fields: asked.fields,
      helpUrl: asked.helpUrl ?? '',
      settings: {
        ...given('name', asked.name),
        ...given('scopes', asked.scopes),
        ...given('refused', asked.refused),
      },
    });
}

function pinOf(pin: ByName<Safe['pin']>): McpCustody['pin'] {
  return (asked) => pin({ provider: asked.provider, ...given('name', asked.name) });
}

function authorizeOf(authorize: ByName<Safe['authorize']>): McpCustody['authorize'] {
  return (asked) =>
    authorize({
      provider: asked.provider,
      authUrl: asked.authUrl,
      ...given('scopes', asked.scopes),
      ...given('name', asked.name),
      settings: {
        ...given('state', asked.state),
        ...given('codeVerifier', asked.codeVerifier),
      },
    });
}

function acceptedOf(accepted: ByName<Safe['accepted']>): NonNullable<McpCustody['accepted']> {
  return (asked) => accepted({ name: asked.name });
}

/** The custody an openapi ladder is handed, from the safe by name: a
 * member the module hands in none of is none of the custody's.
 * @example const CUSTODY = openApiCustodyOf({ login: (a) => login(a.provider, a.instructions, a.fields, a.helpUrl, a.settings) });
 */
export function openApiCustodyOf(safe: OpenApiSafe): OpenApiCustody {
  const { pin, authorize, saveState, state, accepted } = safe;
  return {
    login: loginOf(safe.login),
    ...(pin === undefined ? {} : { pin: pinOf(pin) }),
    ...(authorize === undefined ? {} : { authorize: authorizeOf(authorize) }),
    ...(saveState === undefined
      ? {}
      : {
          saveState: (asked: Parameters<NonNullable<OpenApiCustody['saveState']>>[0]) =>
            saveState({
              name: asked.name,
              state: asked.state,
              ...given('grantedScopes', asked.grantedScopes),
            }),
        }),
    ...(state === undefined
      ? {}
      : {
          state: (asked: Parameters<NonNullable<OpenApiCustody['state']>>[0]) =>
            state({ name: asked.name, ...given('requiredScopes', asked.requiredScopes) }),
        }),
    ...(accepted === undefined ? {} : { accepted: acceptedOf(accepted) }),
  };
}

/** The custody an mcp ladder is handed, from the safe by name.
 * @example const CUSTODY = mcpCustodyOf({ login, pin, authorize, read, store });
 */
export function mcpCustodyOf(safe: McpSafe): McpCustody {
  const { read, store, accepted } = safe;
  return {
    login: loginOf(safe.login),
    pin: pinOf(safe.pin),
    authorize: authorizeOf(safe.authorize),
    read: (asked) => read({ name: asked.name }),
    store: (asked) =>
      store({
        provider: asked.provider,
        kind: asked.kind,
        value: asked.value,
        ...given('name', asked.name),
      }),
    ...(accepted === undefined ? {} : { accepted: acceptedOf(accepted) }),
  };
}
