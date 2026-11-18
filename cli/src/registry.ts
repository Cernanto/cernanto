// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import {
  CernantoError,
  REGISTRY_GATE_DEFAULT,
  REGISTRY_INDEX_DEFAULT,
  REGISTRY_SUMMARY_PATH,
  RELEASE_VERSION_PATTERN,
  loginConfigSchema,
  loginResponseSchema,
  packageFileName,
  packageIndexSchema,
  packagesSummarySchema,
  parsePackageRef,
  pickVersion,
  publishBeginResponseSchema,
  publishCommitResponseSchema,
  registryErrorSchema,
  registryIndexPath,
  registryStatsPath,
  searchSummary,
  stampCernPackage,
  tokenCreatedSchema,
  tokenRowSchema,
  readCernPackage,
} from '@cernanto/package-format';
import type {
  LoginResponse,
  PackageIndex,
  PackagesSummary,
  PublishCommitResponse,
  TokenRow,
  TokenScopes,
} from '@cernanto/package-format';

import { agentsRootOf, resolveAgentSelector, treePackagePath } from './deploy/landing.js';
import { openInBrowser } from './open-url.js';
import { dateTime, fail } from './output.js';
import { writePrivateFile } from './private-file.js';
import { ServerClient } from './server-client.js';

// The registry client: the CLI's half of the gate protocol plus the
// static index reads. Reads go to the packages host (search and
// installs are files there); the gate serves identity and writes.
// Search runs here, client-side, over the static summary.

export interface RegistryEndpoints {
  gateUrl: string;
  indexUrl: string;
}

/** The one slice of the plane a registry verb reads: its settings,
 * through the config agent; a plane without the function, or none at
 * all, leaves the hosts at their defaults. */
export interface RegistrySettingsReader {
  invoke?(agentId: string, fn: string, args: unknown): Promise<unknown>;
}

/** The two hosts: the install module's settings
 * `cernanto/controller/install/registry-gate` and
 * `cernanto/controller/install/registry-index`, read as the operator,
 * the public registry's when unset or when the plane does not answer,
 * so one setting steers the cli and the plane's own landing alike. */
export async function registryEndpoints(
  plane?: RegistrySettingsReader,
): Promise<RegistryEndpoints> {
  const read = async (key: string): Promise<string | undefined> => {
    if (plane?.invoke === undefined) return undefined;
    try {
      const answer = (await plane.invoke('cernanto/config', 'getAt', key)) as { value?: unknown };
      return typeof answer.value === 'string' && answer.value !== '' ? answer.value : undefined;
    } catch {
      return undefined;
    }
  };
  const [gate, index] = await Promise.all([
    read('cernanto/controller/install/registry-gate'),
    read('cernanto/controller/install/registry-index'),
  ]);
  return {
    gateUrl: (gate ?? REGISTRY_GATE_DEFAULT).replace(/\/+$/, ''),
    indexUrl: (index ?? REGISTRY_INDEX_DEFAULT).replace(/\/+$/, ''),
  };
}

/** Where the registry sign-in lives: under the user's cernanto folder. */
export function registryAuthFile(): string {
  return join(homedir(), '.cernanto', 'registry-auth.json');
}

interface StoredAuth {
  token: string;
  publisher: { publisherId: string; login: string };
}

/** The saved registry sign-in for a gate url, when one exists. */
export function loadRegistryAuth(
  gateUrl: string,
  file: string = registryAuthFile(),
): StoredAuth | undefined {
  try {
    const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, StoredAuth>;
    return all[gateUrl];
  } catch {
    return undefined;
  }
}

export function saveRegistryAuth(
  gateUrl: string,
  auth: StoredAuth | undefined,
  file: string = registryAuthFile(),
): void {
  let all: Record<string, StoredAuth> = {};
  try {
    all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, StoredAuth>;
  } catch {
    all = {};
  }
  if (auth === undefined) {
    all = Object.fromEntries(Object.entries(all).filter(([key]) => key !== gateUrl));
  } else {
    all[gateUrl] = auth;
  }
  writePrivateFile(file, `${JSON.stringify(all, null, 2)}\n`);
}

function refuse(message: string): never {
  throw new CernantoError({ kind: 'terminal', message });
}

/** How long an index read waits: the files are small and static, and
 * a card that asks the registry on the side must not hang on it. */
const INDEX_PATIENCE_MS = 10_000;

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export class RegistryClient {
  private readonly endpoints: RegistryEndpoints;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(endpoints: RegistryEndpoints, token?: string, fetchImpl: typeof fetch = fetch) {
    this.endpoints = endpoints;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async gate(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.endpoints.gateUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.token === undefined ? {} : { authorization: `Bearer ${this.token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = await bodyOf(response);
    if (!response.ok) {
      const envelope = registryErrorSchema.safeParse(parsed);
      refuse(
        envelope.success
          ? envelope.data.error.message
          : `the registry answered ${String(response.status)}`,
      );
    }
    return parsed;
  }

  /** The packages host this client reads, for a line that names it. */
  get indexHost(): string {
    return this.endpoints.indexUrl;
  }

  /** A file of the packages host, or nothing when the host holds none
   * there: a host of static files answers 404 for a file it lacks, and
   * 403 where it may read its files and not list them. */
  private async index(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.endpoints.indexUrl}${path}`, {
      signal: AbortSignal.timeout(INDEX_PATIENCE_MS),
    });
    if (response.status === 404 || response.status === 403) return undefined;
    if (!response.ok) refuse(`the package index answered ${String(response.status)} for ${path}`);
    return response.json();
  }

  async loginConfig(): Promise<{ clientId: string; authorizeUrl: string }> {
    return loginConfigSchema.parse(await this.gate('GET', '/v1/login/config'));
  }

  async login(code: string, redirectUri: string): Promise<LoginResponse> {
    return loginResponseSchema.parse(await this.gate('POST', '/v1/login', { code, redirectUri }));
  }

  async whoami(): Promise<{ publisherId: string; login: string; email?: string }> {
    return (await this.gate('GET', '/v1/whoami')) as {
      publisherId: string;
      login: string;
      email?: string;
    };
  }

  async createToken(input: {
    name: string;
    expiresInDays?: number;
    scopes?: TokenScopes;
  }): Promise<{ tokenId: string; token: string }> {
    return tokenCreatedSchema.parse(await this.gate('POST', '/v1/tokens', input));
  }

  async listTokens(): Promise<TokenRow[]> {
    const body = (await this.gate('GET', '/v1/tokens')) as { tokens: unknown[] };
    return body.tokens.map((row) => tokenRowSchema.parse(row));
  }

  async revokeToken(tokenId: string): Promise<void> {
    await this.gate('DELETE', `/v1/tokens/${encodeURIComponent(tokenId)}`);
  }

  async claimNamespace(namespace: string): Promise<void> {
    await this.gate('POST', '/v1/namespaces', { namespace });
  }

  async listNamespaces(): Promise<{ namespace: string; owners: string[]; publishers: string[] }[]> {
    const body = (await this.gate('GET', '/v1/namespaces')) as {
      namespaces: { namespace: string; owners: string[]; publishers: string[] }[];
    };
    return body.namespaces;
  }

  async addMember(namespace: string, login: string, role: 'owner' | 'publisher'): Promise<void> {
    await this.gate('POST', `/v1/namespaces/${encodeURIComponent(namespace)}/members`, {
      login,
      role,
    });
  }

  async removeMember(namespace: string, login: string): Promise<void> {
    await this.gate(
      'DELETE',
      `/v1/namespaces/${encodeURIComponent(namespace)}/members/${encodeURIComponent(login)}`,
    );
  }

  async publishBegin(input: {
    name: string;
    version: string;
    size: number;
  }): Promise<{ publishId: string; uploadUrl: string }> {
    return publishBeginResponseSchema.parse(await this.gate('POST', '/v1/publish/begin', input));
  }

  async upload(uploadUrl: string, bytes: Buffer): Promise<void> {
    const response = await this.fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) refuse(`the upload answered ${String(response.status)}`);
  }

  async publishCommit(publishId: string): Promise<PublishCommitResponse> {
    return publishCommitResponseSchema.parse(
      await this.gate('POST', '/v1/publish/commit', { publishId }),
    );
  }

  async yank(name: string, version: string, reason?: string): Promise<void> {
    await this.gate(
      'POST',
      `/v1/packages/${name}/${version}/yank`,
      reason === undefined ? {} : { reason },
    );
  }

  async deprecate(name: string, message: string): Promise<void> {
    await this.gate('POST', `/v1/packages/${name}/deprecate`, { message });
  }

  async summary(): Promise<PackagesSummary> {
    const body = await this.index(REGISTRY_SUMMARY_PATH);
    if (body === undefined) {
      return { indexFormat: 1, generatedAt: new Date(0).toISOString(), packages: [] };
    }
    return packagesSummarySchema.parse(body);
  }

  async packageIndex(name: string): Promise<PackageIndex | undefined> {
    const body = await this.index(registryIndexPath(name));
    return body === undefined ? undefined : packageIndexSchema.parse(body);
  }

  async statsOf(name: string): Promise<{ downloads?: number; stars?: number } | undefined> {
    return (await this.index(registryStatsPath(name))) as
      { downloads?: number; stars?: number } | undefined;
  }

  async downloadBlob(urlPath: string): Promise<Buffer> {
    const response = await this.fetchImpl(`${this.endpoints.indexUrl}${urlPath}`);
    if (!response.ok) refuse(`downloading ${urlPath} answered ${String(response.status)}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

/** A resolved install source: which published version a ref picked
 * and where its verified bytes live. */
export interface ResolvedPackage {
  name: string;
  version: string;
  url: string;
  packageDigest: string;
  deprecated?: string;
  yankedOnly: boolean;
}

/** Resolves a parsed reference against an index already read: the
 * highest non-yanked version inside the range. */
export function resolveInIndex(
  index: PackageIndex,
  parsed: { name: string; range: string },
): ResolvedPackage {
  const live = index.versions.filter((version) => version.yanked !== true);
  const picked = pickVersion(
    live.map((version) => version.version),
    parsed.range,
  );
  if (picked === undefined) {
    const available = live.map((version) => version.version).join(', ');
    refuse(
      `no version of ${parsed.name} satisfies "${parsed.range}"${available === '' ? ' (every version is yanked)' : `; available: ${available}`}`,
    );
  }
  const row = live.find((version) => version.version === picked);
  if (row === undefined) refuse(`the index lost ${parsed.name}@${picked} mid-read; retry`);
  return {
    name: parsed.name,
    version: picked,
    url: row.url,
    packageDigest: row.packageDigest,
    ...(index.deprecated === undefined ? {} : { deprecated: index.deprecated }),
    yankedOnly: live.length === 0,
  };
}

/** Resolves `acme/fact-check[@range]` against the static index:
 * highest non-yanked version inside the range. */
export async function resolvePackageRef(
  client: RegistryClient,
  ref: string,
): Promise<ResolvedPackage> {
  const parsed = parsePackageRef(ref);
  if (parsed === undefined) refuse(`"${ref}" is not a package reference (name[@version|^x.y.z])`);
  const index = await client.packageIndex(parsed.name);
  if (index === undefined) {
    refuse(`no package "${parsed.name}" in the registry index`);
  }
  return resolveInIndex(index, parsed);
}

/** Downloads a resolved package, verifying the bytes are the exact
 * package the index named before anything reads them. */
export async function fetchPackage(
  client: RegistryClient,
  resolved: ResolvedPackage,
): Promise<Buffer> {
  const bytes = await client.downloadBlob(resolved.url);
  const pkg = readCernPackage(bytes);
  if (pkg.packageDigest !== resolved.packageDigest) {
    refuse(
      `the downloaded package does not match the index (${pkg.packageDigest} != ${resolved.packageDigest}); a mirror may be corrupt`,
    );
  }
  if (pkg.manifest.name !== resolved.name || pkg.manifest.version !== resolved.version) {
    refuse(
      `the downloaded package is ${pkg.manifest.name}@${pkg.manifest.version}, not the resolved one`,
    );
  }
  return bytes;
}

/** Downloads a resolved package to a file, verified before anything lands. */
export async function fetchPackageToFile(
  client: RegistryClient,
  resolved: ResolvedPackage,
  file: string,
): Promise<void> {
  writeFileSync(file, await fetchPackage(client, resolved));
}

/** The GitHub authorize url the login flow opens. */
export function authorizeUrlOf(
  base: string,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(base);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'read:user user:email');
  return url.toString();
}

/**
 * The browser sign-in: a loopback listener takes GitHub's redirect,
 * the gate exchanges the code, the token lands in the auth file. The
 * password stays with GitHub and the GitHub token with the gate.
 */
export async function registryLogin(
  client: RegistryClient,
  gateUrl: string,
  io: {
    write: (line: string) => void;
    openUrl?: (url: string) => void;
    authFile?: string;
    timeoutMs?: number;
  },
): Promise<LoginResponse> {
  const config = await client.loginConfig();
  const state = randomBytes(16).toString('hex');
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${String(port)}/callback`;
  const code = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        reject(new CernantoError({ kind: 'terminal', message: 'the sign-in timed out' }));
      },
      io.timeoutMs ?? 5 * 60_000,
    );
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const answered = url.searchParams.get('code');
      const answeredState = url.searchParams.get('state');
      response
        .writeHead(200, { 'content-type': 'text/plain' })
        .end('signed in; return to the terminal\n');
      if (answered === null || answeredState !== state) {
        clearTimeout(timer);
        reject(new CernantoError({ kind: 'terminal', message: 'the sign-in was refused' }));
        return;
      }
      clearTimeout(timer);
      resolve(answered);
    });
  });
  const authorize = authorizeUrlOf(config.authorizeUrl, config.clientId, redirectUri, state);
  io.write(`sign in with github: ${authorize}\n`);
  (io.openUrl ?? openInBrowser)(authorize);
  try {
    const granted = await code;
    const response = await client.login(granted, redirectUri);
    saveRegistryAuth(
      gateUrl,
      {
        token: response.token,
        publisher: { publisherId: response.publisher.publisherId, login: response.publisher.login },
      },
      io.authFile ?? registryAuthFile(),
    );
    return response;
  } finally {
    server.close();
  }
}

/**
 * The CI sign-in: a token minted by `registry token create`, handed
 * by the caller off standard input, is asked who it belongs to and
 * saved as the sign-in, so a pipeline publishes with no browser and no
 * secret on a command line.
 */
export async function registryTokenLogin(
  client: RegistryClient,
  gateUrl: string,
  token: string,
  authFile: string = registryAuthFile(),
): Promise<{ publisherId: string; login: string }> {
  if (!token.startsWith('cern_')) {
    refuse(
      'a registry token starts with cern_; mint one with: cernanto registry token create <name>',
    );
  }
  const who = await client.whoami();
  saveRegistryAuth(
    gateUrl,
    { token, publisher: { publisherId: who.publisherId, login: who.login } },
    authFile,
  );
  return { publisherId: who.publisherId, login: who.login };
}

/** One line per hit, ranked: the search verb's rendering. */
export function renderSearch(hits: PackagesSummary['packages']): string {
  if (hits.length === 0) return 'no packages matched\n';
  const nameWidth = Math.max('PACKAGE'.length, ...hits.map((row) => row.name.length));
  const versionWidth = Math.max('LATEST'.length, ...hits.map((row) => row.latest.length));
  const lines = [
    `${'PACKAGE'.padEnd(nameWidth)}  ${'LATEST'.padEnd(versionWidth)}  ${'DOWNLOADS'.padStart(9)}  ${'STARS'.padStart(5)}  DESCRIPTION`,
  ];
  for (const row of hits) {
    lines.push(
      `${row.name.padEnd(nameWidth)}  ${row.latest.padEnd(versionWidth)}  ${String(row.downloads).padStart(9)}  ${String(row.stars).padStart(5)}  ${row.description ?? ''}`.trimEnd(),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Why a package may not be published as it is: it carries no verified
 * stamp, the live proof a deploy gives, and the registry's card would
 * say so to everyone; nothing when it is stamped, or when the
 * publisher asked for it unverified. */
export function unverifiedPublishWords(
  manifest: { name: string; provenance?: { verified?: unknown } },
  unverified: boolean,
): string | undefined {
  if (unverified || manifest.provenance?.verified !== undefined) return undefined;
  return `${manifest.name} carries no verified stamp: deploy it first (cernanto deploy ${manifest.name}), or publish it as it is with --unverified`;
}

/** The tree's package of an agent, a version and a publisher stamped
 * into its manifest: the content and its digest stay, the package
 * digest becomes the stamped one. What `publish <id>` uploads. */
export function stampedPackage(
  agentsRoot: string,
  input: { agentId: string; version: string; publisher?: string },
): { bytes: Buffer; name: string; version: string; digest: string } {
  const source = treePackagePath(agentsRoot, input.agentId);
  if (source === undefined || !existsSync(source)) {
    refuse(
      `no package in the tree for ${input.agentId}; compile it first: cernanto compile ${input.agentId}`,
    );
  }
  const pkg = readCernPackage(readFileSync(source));
  if (pkg.manifest.name !== input.agentId) {
    refuse(
      `the package at ${source} names ${pkg.manifest.name}, not ${input.agentId}; a rename is a new agent`,
    );
  }
  // The stamp keeps the content and its digest; the package digest
  // alone becomes the stamped one.
  const bytes = stampCernPackage(readFileSync(source), {
    version: input.version,
    ...(input.publisher === undefined ? {} : { publisher: input.publisher }),
  });
  const readBack = readCernPackage(bytes);
  return {
    bytes,
    name: readBack.manifest.name,
    version: readBack.manifest.version,
    digest: readBack.packageDigest,
  };
}

/** The registry client with the saved sign-in; refuses plainly when
 * a verb needs one and nobody signed in. */
export async function registryClient(requireAuth: boolean): Promise<{
  client: RegistryClient;
  gateUrl: string;
  login?: string;
}> {
  const endpoints = await registryEndpoints(new ServerClient());
  const auth = loadRegistryAuth(endpoints.gateUrl);
  if (requireAuth && auth === undefined) {
    throw new CernantoError({
      kind: 'terminal',
      message: 'not signed in to the registry; run: cernanto registry login',
    });
  }
  return {
    client: new RegistryClient(endpoints, auth?.token),
    gateUrl: endpoints.gateUrl,
    ...(auth === undefined ? {} : { login: auth.publisher.login }),
  };
}

/** What the registry knows of a package, beneath its card: the latest
 * version with its downloads and stars, a deprecation, the last five
 * versions with their yank marks, the needs the registry cannot
 * resolve, and the deploy to paste for the version described. */
export async function registryLines(
  registry: RegistryClient,
  index: PackageIndex,
  version: string,
): Promise<string[]> {
  const stats = (await registry.statsOf(index.name).catch(() => undefined)) ?? {};
  const downloads = stats.downloads ?? 0;
  const stars = stats.stars ?? 0;
  const lines = [
    `registry ${index.latest === undefined ? 'no version to deploy' : `latest ${index.latest}`}, ${String(downloads)} download${downloads === 1 ? '' : 's'}, ${String(stars)} star${stars === 1 ? '' : 's'}`,
  ];
  if (index.deprecated !== undefined) lines.push(`DEPRECATED: ${index.deprecated}`);
  for (const row of index.versions.slice(-5).reverse()) {
    lines.push(
      `  ${row.version}  ${dateTime(row.publishedAt)}${row.yanked === true ? '  YANKED' : ''}`,
    );
  }
  // What a deploy lands beside the version: its dependencies and the
  // interfaces it implements; the ones the registry cannot resolve must
  // already be on the plane.
  const described = index.versions.find((row) => row.version === version);
  const needs = [
    ...(described?.uses ?? []),
    ...Object.keys(described?.usesContracts ?? {}),
    ...(described?.implements ?? []).map((entry) => entry.id),
  ];
  const missing: string[] = [];
  for (const id of [...new Set(needs)].sort()) {
    if ((await registry.packageIndex(id).catch(() => undefined)) === undefined) missing.push(id);
  }
  if (missing.length > 0) {
    lines.push(`not in the registry: ${missing.join(', ')}   (a deploy needs them on the plane)`);
  }
  lines.push(`deploy it with: cernanto deploy ${index.name}@${version}`);
  return lines;
}

/** The registry verbs: what a user does with the public registry, in
 * npm's and cargo's words. Answers the `registry` command, for a verb
 * that lives in a module of its own to register under it. */
export function registerRegistry(program: Command): Command {
  const registry = program
    .command('registry')
    .description('the registry: sign-in, tokens, namespaces, and your packages');
  registry
    .command('login')
    .option('--token-stdin', 'for CI: a registry token read from standard input, no browser')
    .description('sign in to the registry with github; the token lands in ~/.cernanto')
    .action(async (options: { tokenStdin?: boolean }) => {
      try {
        if (options.tokenStdin === true) {
          const endpoints = await registryEndpoints(new ServerClient());
          const token = readFileSync(0, 'utf8').trim();
          if (token === '') {
            throw new CernantoError({ kind: 'terminal', message: 'no token on standard input' });
          }
          const who = await registryTokenLogin(
            new RegistryClient(endpoints, token),
            endpoints.gateUrl,
            token,
          );
          process.stdout.write(`signed in as ${who.login} with a token\n`);
          return;
        }
        const { client: anonymous, gateUrl } = await registryClient(false);
        const response = await registryLogin(anonymous, gateUrl, {
          write: (line) => process.stdout.write(line),
        });
        process.stdout.write(`signed in as ${response.publisher.login}\n`);
      } catch (error) {
        fail(error);
      }
    });
  registry
    .command('logout')
    .description('forget the saved registry sign-in')
    .action(async () => {
      try {
        saveRegistryAuth((await registryEndpoints(new ServerClient())).gateUrl, undefined);
        process.stdout.write('signed out\n');
      } catch (error) {
        fail(error);
      }
    });
  registry
    .command('whoami')
    .description('who the registry thinks you are')
    .action(async () => {
      try {
        const { client: registryApi } = await registryClient(true);
        const who = await registryApi.whoami();
        process.stdout.write(
          `${who.login} (${who.publisherId})${who.email === undefined ? '' : `  ${who.email}`}\n`,
        );
      } catch (error) {
        fail(error);
      }
    });
  registry
    .command('publish')
    .argument(
      '<agent-id@version-or-file>',
      'an agent of the tree at the version to publish, acme/greeter@0.0.1, or a .cern package file',
    )
    .option('--publisher <name>', 'the publisher stamped on the published copy')
    .option('--unverified', 'publish a package that carries no verified stamp')
    .description('publish a package to the registry: begin, upload, commit through the gate')
    .action(async (source: string, options: { publisher?: string; unverified?: boolean }) => {
      try {
        const { client: registry, login } = await registryClient(true);
        let bytes: Buffer;
        if (source.endsWith('.cern') && existsSync(source)) {
          bytes = readFileSync(source);
        } else {
          // The version rides in the argument, as a deploy's and a
          // yank's do: a flag would be the root's --version.
          const at = source.lastIndexOf('@');
          if (at <= 0 || !RELEASE_VERSION_PATTERN.test(source.slice(at + 1))) {
            throw new CernantoError({
              kind: 'terminal',
              message: `publishing an agent of the tree names its version: cernanto registry publish ${at <= 0 ? source : source.slice(0, at)}@x.y.z`,
            });
          }
          const agentId = resolveAgentSelector(source.slice(0, at));
          // The published copy names its publisher: the one given, else
          // the login that signed in.
          const publisher = options.publisher ?? login;
          bytes = stampedPackage(agentsRootOf(), {
            agentId,
            version: source.slice(at + 1),
            ...(publisher === undefined ? {} : { publisher }),
          }).bytes;
        }
        const pkg = readCernPackage(bytes);
        const refusal = unverifiedPublishWords(pkg.manifest, options.unverified === true);
        if (refusal !== undefined) throw new CernantoError({ kind: 'terminal', message: refusal });
        const begin = await registry.publishBegin({
          name: pkg.manifest.name,
          version: pkg.manifest.version,
          size: bytes.length,
        });
        process.stdout.write(
          `uploading ${pkg.manifest.name}@${pkg.manifest.version} (${String(Math.round(bytes.length / 1024))} KB)\n`,
        );
        await registry.upload(begin.uploadUrl, bytes);
        const committed = await registry.publishCommit(begin.publishId);
        process.stdout.write(
          `published ${committed.name}@${committed.version}\npackage digest ${committed.packageDigest}\ndeploy it with: cernanto deploy ${committed.name}@${committed.version}\n`,
        );
      } catch (error) {
        fail(error);
      }
    });

  registry
    .command('search')
    .argument('<query...>', 'free text; keywords are categories by convention')
    .description('search the registry, client-side over the static package summary')
    .action(async (query: string[]) => {
      try {
        const { client: registry } = await registryClient(false);
        const summary = await registry.summary();
        const hits = searchSummary(summary, query.join(' '));
        process.stdout.write(renderSearch(hits));
      } catch (error) {
        fail(error);
      }
    });

  registry
    .command('yank')
    .argument('<ref>', 'name@version to yank')
    .option('--reason <reason>', 'why')
    .description('mark a published version as not-to-install; bytes are never deleted')
    .action(async (ref: string, options: { reason?: string }) => {
      try {
        const at = ref.lastIndexOf('@');
        if (at <= 0) {
          throw new CernantoError({ kind: 'terminal', message: 'yank takes name@version' });
        }
        const { client: registry } = await registryClient(true);
        await registry.yank(ref.slice(0, at), ref.slice(at + 1), options.reason);
        process.stdout.write(`yanked ${ref}\n`);
      } catch (error) {
        fail(error);
      }
    });

  registry
    .command('deprecate')
    .argument('<name>', 'a package name')
    .argument('<message...>', 'what installers should do instead')
    .description('mark a package deprecated; deploys print the message')
    .action(async (name: string, message: string[]) => {
      try {
        const { client: registry } = await registryClient(true);
        await registry.deprecate(name, message.join(' '));
        process.stdout.write(`deprecated ${name}\n`);
      } catch (error) {
        fail(error);
      }
    });

  const registryToken = registry.command('token').description('registry tokens (CI publishing)');
  registryToken
    .command('create')
    .argument('<name>', 'a label for the token')
    .option('--namespace <namespace...>', 'restrict to namespaces')
    .option('--days <days>', 'expiry in days')
    .description('mint a scoped token; it is shown once')
    .action(async (name: string, options: { namespace?: string[]; days?: string }) => {
      try {
        const { client: registryApi } = await registryClient(true);
        const created = await registryApi.createToken({
          name,
          ...(options.days === undefined ? {} : { expiresInDays: Number(options.days) }),
          ...(options.namespace === undefined ? {} : { scopes: { namespaces: options.namespace } }),
        });
        process.stdout.write(`token ${created.tokenId} (shown once):\n${created.token}\n`);
      } catch (error) {
        fail(error);
      }
    });
  registryToken
    .command('list')
    .description('your tokens')
    .action(async () => {
      try {
        const { client: registryApi } = await registryClient(true);
        for (const row of await registryApi.listTokens()) {
          process.stdout.write(
            `${row.tokenId}  ${row.name}  created ${dateTime(row.createdAt)}${row.expiresAt === undefined ? '' : `  expires ${dateTime(row.expiresAt)}`}\n`,
          );
        }
      } catch (error) {
        fail(error);
      }
    });
  registryToken
    .command('revoke')
    .argument('<token-id>', 'from: cernanto registry token list')
    .description('revoke a token, effective immediately')
    .action(async (tokenId: string) => {
      try {
        const { client: registryApi } = await registryClient(true);
        await registryApi.revokeToken(tokenId);
        process.stdout.write(`revoked ${tokenId}\n`);
      } catch (error) {
        fail(error);
      }
    });
  const registryNamespace = registry
    .command('namespace')
    .description('namespaces: the first path segment of your package names, and their members');
  registryNamespace
    .command('claim')
    .argument('<namespace>', 'one lowercase kebab segment')
    .description('claim a namespace, first come first served')
    .action(async (namespace: string) => {
      try {
        const { client: registryApi } = await registryClient(true);
        await registryApi.claimNamespace(namespace);
        process.stdout.write(`claimed "${namespace}"; publish under ${namespace}/<name>\n`);
      } catch (error) {
        fail(error);
      }
    });
  registryNamespace
    .command('list')
    .description('namespaces you belong to')
    .action(async () => {
      try {
        const { client: registryApi } = await registryClient(true);
        for (const row of await registryApi.listNamespaces()) {
          process.stdout.write(
            `${row.namespace}  owners ${String(row.owners.length)}  publishers ${String(row.publishers.length)}\n`,
          );
        }
      } catch (error) {
        fail(error);
      }
    });
  registryNamespace
    .command('add')
    .argument('<namespace>', 'the namespace')
    .argument('<login>', 'the github login')
    .option('--role <role>', 'owner or publisher', 'publisher')
    .description('add a member; they may be added before their first sign-in')
    .action(async (namespace: string, login: string, options: { role: string }) => {
      try {
        const { client: registryApi } = await registryClient(true);
        await registryApi.addMember(
          namespace,
          login,
          options.role === 'owner' ? 'owner' : 'publisher',
        );
        process.stdout.write(`added ${login} to "${namespace}" as ${options.role}\n`);
      } catch (error) {
        fail(error);
      }
    });
  registryNamespace
    .command('remove')
    .argument('<namespace>', 'the namespace')
    .argument('<login>', 'the github login')
    .description('remove a member')
    .action(async (namespace: string, login: string) => {
      try {
        const { client: registryApi } = await registryClient(true);
        await registryApi.removeMember(namespace, login);
        process.stdout.write(`removed ${login} from "${namespace}"\n`);
      } catch (error) {
        fail(error);
      }
    });
  return registry;
}

/** The file a registry package lands in, for a deploy by reference. */
export function registryPackageFileName(name: string, version: string): string {
  return packageFileName(name, version);
}
