// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The lane modules an agent imports for its openapi and mcp grants,
// written at materialize from the documents the package carries
// (`openapi/`, `mcp/`): one function per operation or tool over
// runtime-lib's lane wires, the call-through and the auth ladders
// beside them. The types the coder saw are the compiler's twins and are
// erased here; the names are the document's own by one naming rule, so
// the twins and this glue agree without the type engine. An mcp grant
// names a remote server by its url or a local one by its command; a
// local server's module is named by the compiler alone, read here off
// the file its listing is filed under in the package.

import {
  MCP_URL_PATTERN,
  commandLabelOf,
  keptMcpToolOf,
  mcpSchemaHashOf,
  parseMcpCommand,
} from '@cernanto/runtime-lib/mcp';
import { parse as parseYaml } from 'yaml';

import { assertName, exportedFunction, imported, localsOf } from './glue.js';
import type { Onboarding, ReadPackage } from './manifest.js';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function cleanLabel(host: string, fallback: string): string {
  const label = host.split('.')[0] ?? '';
  const cleaned = label.replace(/[^A-Za-z0-9-]/g, '-').toLowerCase();
  return cleaned === '' ? fallback : cleaned;
}

/** The module name an mcp grant derives from its server url (the
 * host's first label: `mcp.stripe.com` reads `stripe`). */
export function mcpModuleName(url: string): string {
  const parsed = URL.parse(url);
  if (parsed === null) return 'server';
  const host = parsed.hostname.startsWith('mcp.') ? parsed.hostname.slice(4) : parsed.hostname;
  return cleanLabel(host, 'server');
}

/** The module name an openapi grant derives from its url and document. */
export function openApiModuleName(specUrl: string, document: unknown): string {
  let hostname: string | undefined;
  if (isRecord(document)) {
    const first = listOf(document['servers'])[0];
    if (isRecord(first) && typeof first['url'] === 'string') {
      hostname = URL.parse(first['url'])?.hostname;
    }
  }
  hostname ??= URL.parse(specUrl)?.hostname;
  if (hostname === undefined) return 'api';
  const host = hostname.startsWith('api.')
    ? hostname.slice(4)
    : hostname.startsWith('www.')
      ? hostname.slice(4)
      : hostname;
  return cleanLabel(host, 'api');
}

function splitWords(text: string): string[] {
  return text.split(/[^A-Za-z0-9]+/).filter((part) => part !== '');
}

/** A name's words camel-cased. */
export function camelCase(text: string): string {
  return splitWords(text)
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('');
}

/** A tool's function name: its name's words camel-cased, `tool` when
 * nothing remains. */
export function toolFunctionName(name: string): string {
  const joined = camelCase(name);
  return joined === '' ? 'tool' : joined;
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An operation's function name from the document alone: its
 * operationId's words when it has one, else the method and path's, the
 * first word lower-cased at its first letter and the rest upper-cased
 * at theirs; `operation` when nothing remains, `op` prefixed when it
 * starts with a digit. */
export function operationIdentifier(
  operationId: string | undefined,
  method: string,
  path: string,
): string {
  const source = operationId ?? `${method} ${path}`;
  const joined = splitWords(source)
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
  if (joined === '') return 'operation';
  return /^[0-9]/.test(joined) ? `op${joined}` : joined;
}

function originOf(url: string): string | undefined {
  const parsed = URL.parse(url);
  return parsed === null ? undefined : parsed.origin;
}

function resolvePointer(document: Json, ref: string): unknown {
  let current: unknown = document;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) current = (current as unknown[])[Number(segment)];
    else if (isRecord(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

function deref(document: Json, schema: unknown): Json | undefined {
  let current = schema;
  const seen = new Set<string>();
  while (isRecord(current) && typeof current['$ref'] === 'string') {
    const ref = current['$ref'];
    if (!ref.startsWith('#/') || seen.has(ref)) return undefined;
    seen.add(ref);
    const target = resolvePointer(document, ref);
    if (!isRecord(target)) return undefined;
    current = target;
  }
  return isRecord(current) ? current : undefined;
}

const METHOD_ORDER = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

interface WalkedOperation {
  path: string;
  method: string;
  operation: Json;
  pathItem: Json;
}

/** The document's operations, paths in sorted order: a path item named
 * by reference is read where the reference points, and an operation
 * two paths reach through one reference is walked once, at its first
 * path. */
function walkOperations(document: Json, paths: Json): WalkedOperation[] {
  const walked: WalkedOperation[] = [];
  const seen = new Set<object>();
  for (const path of Object.keys(paths).sort((a, b) => a.localeCompare(b))) {
    const pathItem = deref(document, paths[path]);
    if (pathItem === undefined) continue;
    for (const method of METHOD_ORDER) {
      const operation = pathItem[method];
      if (!isRecord(operation) || seen.has(operation)) continue;
      seen.add(operation);
      walked.push({ path, method, operation, pathItem });
    }
  }
  return walked;
}

interface BindingParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
}

function collectParameters(document: Json, walked: WalkedOperation): BindingParameter[] {
  const shared = listOf(walked.pathItem['parameters']);
  const own = listOf(walked.operation['parameters']);
  const byKey = new Map<string, BindingParameter>();
  for (const entry of [...shared, ...own]) {
    const parameter = deref(document, entry);
    if (parameter === undefined) continue;
    const name = parameter['name'];
    const where = parameter['in'];
    if (typeof name !== 'string' || typeof where !== 'string') continue;
    if (where !== 'path' && where !== 'query' && where !== 'header') continue;
    byKey.set(`${where}:${name}`, {
      name,
      in: where,
      required: where === 'path' ? true : parameter['required'] === true,
    });
  }
  return [...byKey.values()];
}

function hasJsonBody(document: Json, operation: Json): boolean {
  const body = deref(document, operation['requestBody']);
  if (body === undefined) return false;
  const content = body['content'];
  return isRecord(content) && isRecord(content['application/json']);
}

/** An oauth2 scheme's authorization-code flow, as the document
 * declares it: the module runs it on the plane. */
interface Oauth2Flow {
  authorizationUrl: string;
  tokenUrl: string;
}

interface Security {
  scheme: 'bearer' | 'apiKeyHeader' | 'apiKeyQuery';
  name?: string;
  description?: string;
  oauth2?: Oauth2Flow;
  /** The scopes an oauth2 requirement names, else the flow's own. */
  scopes?: string[];
}

/** The first security requirement with any key: its first key in
 * sorted order, and the scopes it names for that key. */
function securityRequirement(requirements: unknown): { key: string; scopes: string[] } | undefined {
  for (const requirement of listOf(requirements)) {
    if (!isRecord(requirement)) continue;
    const key = Object.keys(requirement).sort()[0];
    if (key === undefined) continue;
    const scopes = listOf(requirement[key]).filter(
      (scope): scope is string => typeof scope === 'string',
    );
    return { key, scopes };
  }
  return undefined;
}

function readScheme(scheme: unknown): Security | undefined {
  if (!isRecord(scheme)) return undefined;
  const type = scheme['type'];
  const description =
    typeof scheme['description'] === 'string'
      ? scheme['description'].trim().slice(0, 500)
      : undefined;
  const carry = (resolved: Security): Security =>
    description !== undefined && description !== '' ? { ...resolved, description } : resolved;
  if (type === 'oauth2') {
    const flows = scheme['flows'];
    const code = isRecord(flows) ? flows['authorizationCode'] : undefined;
    if (
      isRecord(code) &&
      typeof code['authorizationUrl'] === 'string' &&
      typeof code['tokenUrl'] === 'string'
    ) {
      return carry({
        scheme: 'bearer',
        oauth2: { authorizationUrl: code['authorizationUrl'], tokenUrl: code['tokenUrl'] },
        scopes: Object.keys(isRecord(code['scopes']) ? code['scopes'] : {}),
      });
    }
    return carry({ scheme: 'bearer' });
  }
  if (
    (type === 'http' && String(scheme['scheme']).toLowerCase() === 'bearer') ||
    type === 'openIdConnect'
  ) {
    return carry({ scheme: 'bearer' });
  }
  if (type === 'apiKey' && typeof scheme['name'] === 'string') {
    if (scheme['in'] === 'header') return carry({ scheme: 'apiKeyHeader', name: scheme['name'] });
    if (scheme['in'] === 'query') return carry({ scheme: 'apiKeyQuery', name: scheme['name'] });
  }
  return undefined;
}

function operationSecurity(document: Json, operation: Json): Security | undefined {
  const requirements = Array.isArray(operation['security'])
    ? operation['security']
    : document['security'];
  const requirement = securityRequirement(requirements);
  if (requirement === undefined) return undefined;
  const components = document['components'];
  const schemes = isRecord(components) ? components['securitySchemes'] : undefined;
  const security = readScheme(
    isRecord(schemes) ? deref(document, schemes[requirement.key]) : undefined,
  );
  if (security?.oauth2 !== undefined && requirement.scopes.length > 0) {
    return { ...security, scopes: requirement.scopes };
  }
  return security;
}

/** The security a binding carries on the wire: the scheme and its
 * carrier; the flow and the scopes stay at the module's level. */
function wireSecurity(security: Security): Record<string, unknown> {
  return {
    scheme: security.scheme,
    ...(security.name === undefined ? {} : { name: security.name }),
    ...(security.description === undefined ? {} : { description: security.description }),
  };
}

function baseUrlOf(specUrl: string, document: Json): string {
  const first = listOf(document['servers'])[0];
  if (isRecord(first) && typeof first['url'] === 'string') {
    const variables = isRecord(first['variables']) ? first['variables'] : undefined;
    const filled = first['url'].replace(/\{([^}]+)\}/g, (whole: string, variable: string) => {
      const declared = variables?.[variable];
      const fallback = isRecord(declared) ? declared['default'] : undefined;
      return typeof fallback === 'string' ? fallback : whole;
    });
    const resolved = URL.parse(filled, specUrl);
    if (resolved !== null) return resolved.href.replace(/\/$/, '');
  }
  return originOf(specUrl) ?? '';
}

export interface OpenApiLane {
  module: string;
  url: string;
  document: Json;
  secured: boolean;
  /** The words the account is asked with, pinned at the compile. */
  onboarding?: Onboarding | undefined;
}

export interface McpLane {
  module: string;
  /** The server as the grant names it: its url, or the command that
   * runs it. */
  server: string;
  tools: { name: string }[];
  /** The schema hash of the listing the package carries, which a local
   * server's own listing is held to at its start; a remote server's
   * lane carries none. */
  schemaHash?: string | undefined;
}

/** Whether an mcp grant names a local server: anything that is not a
 * remote server's url is the command that runs one. */
export function isLocalMcpServer(server: string): boolean {
  return !MCP_URL_PATTERN.test(server);
}

/** A server as words and headers may name it: a url as it is, a
 * command by its program and arguments alone, so the values its
 * environment words carry are written nowhere else. */
export function shownServer(server: string): string {
  if (!isLocalMcpServer(server)) return server;
  try {
    return commandLabelOf(parseMcpCommand(server));
  } catch {
    return 'a local server';
  }
}

/** The module an mcp listing is filed under in its package
 * (`mcp/<module>.listing.json`): the compiler's name for the grant. */
function listingModuleOf(file: string): string | undefined {
  const match = /(?:^|\/)([^/]+)\.listing\.json$/.exec(file);
  return match?.[1];
}

function parseDocument(text: string, where: string): Json {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = parseYaml(text);
  }
  if (!isRecord(parsed)) throw new Error(`the openapi document ${where} is not an object`);
  return parsed;
}

/** The lanes a package grants, with their documents read off it. */
/** A document's path inside its package folder: the manifest names it
 * with the folder (`openapi/<name>`), the reader keys the folder's
 * files by the name alone. */
function insideFolder(file: string, folder: string): string {
  return file.startsWith(`${folder}/`) ? file.slice(folder.length + 1) : file;
}

/** Refuses a package whose grants of one lane name one module twice:
 * the module of the second would be written over the first's. */
function refuseSharedModules(
  agent: string,
  lane: 'openapi' | 'mcp',
  lanes: readonly { module: string; url: string }[],
): void {
  const byModule = new Map<string, string>();
  for (const { module, url } of lanes) {
    const other = byModule.get(module);
    if (other !== undefined) {
      throw new Error(
        `${agent}: the ${lane} grants ${other} and ${url} both name the module ${lane}/${module}.js: one package cannot grant both`,
      );
    }
    byModule.set(module, url);
  }
}

export function lanesOf(pkg: ReadPackage): { openapi: OpenApiLane[]; mcp: McpLane[] } {
  const openapi: OpenApiLane[] = [];
  const openapiEntries = Object.entries(pkg.manifest.openapi).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [url, entry] of openapiEntries) {
    const bytes = pkg.openapi[insideFolder(entry.file, 'openapi')];
    if (bytes === undefined) {
      throw new Error(
        `${pkg.manifest.name}: the openapi document ${entry.file} for ${url} is not in the package`,
      );
    }
    const document = parseDocument(bytes.toString('utf8'), `at ${url}`);
    const paths = document['paths'];
    const secured = isRecord(paths)
      ? walkOperations(document, paths).some(
          (walked) => operationSecurity(document, walked.operation) !== undefined,
        )
      : false;
    openapi.push({
      module: openApiModuleName(url, document),
      url,
      document,
      secured,
      ...(entry.onboarding === undefined ? {} : { onboarding: entry.onboarding }),
    });
  }
  const mcp: McpLane[] = [];
  const mcpEntries = Object.entries(pkg.manifest.mcp).sort(([a], [b]) => a.localeCompare(b));
  for (const [server, entry] of mcpEntries) {
    const bytes = pkg.mcp[insideFolder(entry.file, 'mcp')];
    if (bytes === undefined) {
      throw new Error(
        `${pkg.manifest.name}: the mcp listing ${entry.file} for ${shownServer(server)} is not in the package`,
      );
    }
    const listing: unknown = JSON.parse(bytes.toString('utf8'));
    const tools = isRecord(listing) ? listOf(listing['tools']) : [];
    const named = tools.flatMap((tool) =>
      isRecord(tool) && typeof tool['name'] === 'string' ? [{ name: tool['name'] }] : [],
    );
    if (!isLocalMcpServer(server)) {
      mcp.push({ module: mcpModuleName(server), server, tools: named });
      continue;
    }
    // A local server's module is the compiler's name for its command,
    // read off the file its listing is filed under.
    const module = listingModuleOf(entry.file);
    if (module === undefined) {
      throw new Error(
        `${pkg.manifest.name}: the mcp listing ${entry.file} for ${shownServer(server)} is not filed as mcp/<module>.listing.json`,
      );
    }
    mcp.push({
      module,
      server,
      tools: named,
      schemaHash: mcpSchemaHashOf(
        tools.map((tool) => keptMcpToolOf(tool, `the listing ${entry.file}`)),
      ),
    });
  }
  refuseSharedModules(pkg.manifest.name, 'openapi', openapi);
  refuseSharedModules(
    pkg.manifest.name,
    'mcp',
    mcp.map((lane) => ({ module: lane.module, url: shownServer(lane.server) })),
  );
  return { openapi, mcp };
}

/** The function names an openapi module exports, in document order: the
 * naming rule above, with a taken name gaining the pascal method and
 * then a counter. */
export function openApiFunctionNames(document: Json): string[] {
  const paths = document['paths'];
  if (!isRecord(paths)) return [];
  const taken = new Set<string>();
  return walkOperations(document, paths).map((entry) => {
    const operationId = entry.operation['operationId'];
    const base = operationIdentifier(
      typeof operationId === 'string' ? operationId : undefined,
      entry.method,
      entry.path,
    );
    let fn = base;
    if (taken.has(fn)) {
      fn = `${base}${upperFirst(entry.method)}`;
      let suffix = 2;
      while (taken.has(fn)) {
        fn = `${base}${upperFirst(entry.method)}${String(suffix)}`;
        suffix += 1;
      }
    }
    taken.add(fn);
    return fn;
  });
}

/** The openapi module of one grant: the grant's constants and one
 * function per operation over the runtime's call-through, secured
 * operations through the runtime's secret ladder with the safe's
 * functions handed in (the custody agent's stub under `agents/`,
 * named for the agent the deployer's seam names). */
export function openApiModuleSource(lane: OpenApiLane, custodyStub: string): string {
  const { document, url, module, onboarding } = lane;
  const paths = document['paths'];
  if (!isRecord(paths)) throw new Error(`the openapi document at ${url} declares no paths`);
  const walked = walkOperations(document, paths);
  if (walked.length === 0) throw new Error(`the openapi document at ${url} declares no operations`);
  const baseUrl = baseUrlOf(url, document);
  const names = openApiFunctionNames(document);
  const operations = walked.map((entry, index) => {
    const fn = names[index] ?? 'operation';
    const security = operationSecurity(document, entry.operation);
    const binding: Record<string, unknown> = {
      module,
      operation: fn,
      baseUrl,
      method: entry.method,
      path: entry.path,
      parameters: collectParameters(document, entry),
      hasBody: hasJsonBody(document, entry.operation),
    };
    if (security !== undefined) binding['security'] = wireSecurity(security);
    return { fn, binding, security };
  });
  const moduleSecurity = operations.find((entry) => entry.security !== undefined)?.security;
  const oauth2 = moduleSecurity?.oauth2;
  const scopes = [...new Set(operations.flatMap((entry) => entry.security?.scopes ?? []))].sort(
    (a, b) => a.localeCompare(b),
  );
  const custodyNames =
    oauth2 === undefined ? ['login'] : ['authorize', 'login', 'pin', 'saveState', 'state'];
  // The operations' names are the document's: what the module imports
  // and holds for itself goes under names none of them takes.
  const local = localsOf([...operations.map((entry) => entry.fn), 'args', 'account']);
  const callThrough = local('callThroughOpenApi');
  const securedCall = local('securedOpenApiCall');
  const lines = [
    `// Generated by the platform from ${url}. Do not edit.`,
    `import { ${imported('callThroughOpenApi', callThrough)}, ${imported('securedOpenApiCall', securedCall)} } from '@cernanto/runtime-lib/openapi';`,
  ];
  const secured = local('SECURED');
  const custody = local('CUSTODY');
  if (moduleSecurity !== undefined) {
    const safe = custodyNames.map((name) => ({ name, own: local(name) }));
    lines.push(
      `import { ${safe.map((entry) => imported(entry.name, entry.own)).join(', ')} } from '../agents/${custodyStub}.js';`,
      '',
      `const ${secured} = ${JSON.stringify({
        module,
        provider: URL.parse(baseUrl)?.host ?? '',
        ...(onboarding === undefined ? {} : { onboarding }),
        ...(oauth2 === undefined ? {} : { oauth2: { ...oauth2, scopes } }),
      })};`,
      `const ${custody} = { ${safe.map((entry) => safeMember(entry.name, entry.own)).join(', ')} };`,
    );
  }
  lines.push('');
  for (const entry of operations) {
    const literal = JSON.stringify(entry.binding);
    const fn = assertName(entry.fn, `an operation of ${url}`);
    lines.push(
      ...(entry.security === undefined
        ? exportedFunction(fn, local, 'args', [`  return await ${callThrough}(${literal}, args);`])
        : exportedFunction(fn, local, 'args, account', [
            `  return await ${securedCall}(${secured}, ${custody}, ${literal}, args, account);`,
          ])),
      '',
    );
  }
  return lines.join('\n');
}

/** An object literal's member: the name itself, or the name with the
 * local that holds it. */
function member(name: string, local: string): string {
  return name === local ? name : `${name}: ${local}`;
}

/** One member of the safe the ladder is handed: the ladder speaks in
 * records, the custody agent declares its parameters in order, and the
 * generated module maps the one to the other, the optional settings
 * gathered last. A function the map does not know is handed through. */
function safeMember(name: string, local: string): string {
  const settings = (keys: string[]): string =>
    `{ ${keys.map((key) => `...(a.${key} === undefined ? {} : { ${key}: a.${key} })`).join(', ')} }`;
  switch (name) {
    case 'login':
      return `login: (a) => ${local}(a.provider, a.instructions, a.fields, a.helpUrl ?? '', ${settings(['name', 'scopes', 'refused'])})`;
    case 'pin':
      return `pin: (a) => ${local}(a.provider, a.name)`;
    case 'authorize':
      return `authorize: (a) => ${local}(a.provider, a.authUrl, a.scopes, a.name, ${settings(['state', 'codeVerifier'])})`;
    case 'read':
      return `read: (a) => ${local}(a.name)`;
    case 'store':
      return `store: (a) => ${local}(a.provider, a.kind, a.value, a.name)`;
    case 'saveState':
      return `saveState: (a) => ${local}(a.name, a.state, a.grantedScopes)`;
    case 'state':
      return `state: (a) => ${local}(a.name, a.requiredScopes)`;
    default:
      return member(name, local);
  }
}

/** The tools of an mcp grant as the module exports them, in name
 * order: each under its function's name, refused in words before a
 * module is written when two read as one function or one reads as no
 * function. */
function mcpToolsOf(lane: McpLane): { name: string; fn: string }[] {
  const shown = shownServer(lane.server);
  const tools = [...lane.tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({ name: tool.name, fn: toolFunctionName(tool.name) }));
  // Two tools that read as one function would be one name declared
  // twice: the module is refused in words before it is written.
  const byFunction = new Map<string, string>();
  for (const tool of tools) {
    assertName(tool.fn, `the tool ${JSON.stringify(tool.name)} of ${shown}`);
    const other = byFunction.get(tool.fn);
    if (other !== undefined) {
      throw new Error(
        `the tools ${JSON.stringify(other)} and ${JSON.stringify(tool.name)} of ${shown} both read as the function ${tool.fn}`,
      );
    }
    byFunction.set(tool.fn, tool.name);
  }
  return tools;
}

/** The mcp module of one grant: the grant's constants and a function
 * per tool over the runtime's ladder; a remote server's has the safe's
 * functions handed in through the custody agent's stub (named as
 * above), a local server's needs none. */
export function mcpModuleSource(lane: McpLane, custodyStub: string): string {
  if (isLocalMcpServer(lane.server)) return localMcpModuleSource(lane);
  const parsed = URL.parse(lane.server);
  const tools = mcpToolsOf(lane);
  // The tools' names are the server's: what the module imports and
  // holds for itself goes under names none of them takes.
  const local = localsOf([...tools.map((tool) => tool.fn), 'args', 'account']);
  const callThrough = local('mcpCallThrough');
  const safe = ['authorize', 'login', 'pin', 'read', 'store'].map((name) => ({
    name,
    own: local(name),
  }));
  const laneConstant = local('LANE');
  const custody = local('CUSTODY');
  const lines = [
    `// Generated by the platform from ${lane.server}. Do not edit.`,
    `import { ${imported('mcpCallThrough', callThrough)} } from '@cernanto/runtime-lib/mcp';`,
    `import { ${safe.map((entry) => imported(entry.name, entry.own)).join(', ')} } from '../agents/${custodyStub}.js';`,
    '',
    `const ${laneConstant} = ${JSON.stringify({ server: lane.server, module: lane.module, host: parsed?.host ?? '' })};`,
    `const ${custody} = { ${safe.map((entry) => safeMember(entry.name, entry.own)).join(', ')} };`,
    '',
  ];
  for (const tool of tools) {
    lines.push(
      ...exportedFunction(tool.fn, local, 'args, account', [
        `  return await ${callThrough}(${laneConstant}, ${custody}, ${JSON.stringify(tool.name)}, args, account);`,
      ]),
      '',
    );
  }
  return lines.join('\n');
}

/** The mcp module of a local server's grant: its command, its module's
 * name and the schema hash of the listing the package carries, and a
 * function per tool over the runtime's local road, which keeps the
 * server as a child of the agent's own process with the environment
 * its command carries. */
function localMcpModuleSource(lane: McpLane): string {
  const tools = mcpToolsOf(lane);
  const local = localsOf([...tools.map((tool) => tool.fn), 'args']);
  const callThrough = local('localMcpCallThrough');
  const laneConstant = local('LANE');
  const lines = [
    `// Generated by the platform from the local MCP server ${shownServer(lane.server)}. Do not edit.`,
    `import { ${imported('localMcpCallThrough', callThrough)} } from '@cernanto/runtime-lib/mcp';`,
    '',
    `const ${laneConstant} = ${JSON.stringify({
      command: lane.server,
      module: lane.module,
      ...(lane.schemaHash === undefined ? {} : { schemaHash: lane.schemaHash }),
    })};`,
    '',
  ];
  for (const tool of tools) {
    lines.push(
      ...exportedFunction(tool.fn, local, 'args', [
        `  return await ${callThrough}(${laneConstant}, ${JSON.stringify(tool.name)}, args);`,
      ]),
      '',
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The server module of an implemented document.

/** An implemented document a package carries: the module the server
 * lane generates for it binds the document to the agent's own
 * operations and serves it on the agent's listener. */
export interface OpenApiServerLane {
  module: string;
  target: string;
  document: Json;
}

/** The module name of an implemented document: the base name of the
 * target's file without its extension, or a url's host, cleaned to a
 * module name; `api` when nothing remains. */
export function openApiServerModuleName(target: string): string {
  const rest = target.startsWith('openapi:') ? target.slice('openapi:'.length) : target;
  const parsed = /^[a-z]+:\/\//i.test(rest) ? URL.parse(rest) : undefined;
  const [firstLabel = ''] = parsed?.hostname === undefined ? [] : parsed.hostname.split('.');
  const base =
    parsed?.hostname !== undefined
      ? firstLabel
      : (rest.split('/').pop() ?? '').replace(/\.[^.]*$/, '');
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'api' : cleaned;
}

/** The implemented documents a package carries, with their documents
 * read off it (`files/<name>`, as the manifest's implements entries name
 * them). */
export function openApiServerLanesOf(pkg: ReadPackage): OpenApiServerLane[] {
  const lanes: OpenApiServerLane[] = [];
  for (const entry of pkg.manifest.implements) {
    if (!('file' in entry) || typeof entry.file !== 'string') continue;
    const bytes = pkg.files[insideFolder(entry.file, 'files')];
    if (bytes === undefined) {
      throw new Error(
        `${pkg.manifest.name}: the implemented document ${entry.file} is not in the package`,
      );
    }
    const document = parseDocument(bytes.toString('utf8'), `${entry.id} of ${pkg.manifest.name}`);
    lanes.push({ module: openApiServerModuleName(entry.id), target: entry.id, document });
  }
  return lanes;
}

/** The server module of an implemented document: the document itself
 * and `createHandler`, which binds the server lane to the agent's own
 * operations (imported from the agent's module beside it) and to a
 * call of the agent's own function for an operation that answers a
 * value, so a served request is a call like any other, its credentials
 * named for the call's records to leave out. */
export function openApiServerModuleSource(lane: OpenApiServerLane): string {
  const literal = JSON.stringify(lane.document);
  return [
    `// Generated by the platform from ${lane.target}. Do not edit.`,
    "import { createOpenApiHandler, invokeOperation } from '@cernanto/runtime-lib/openapi-server';",
    "import { agentId } from '../os.js';",
    '',
    `export const document = ${literal};`,
    '',
    "const own = '../index.js';",
    '',
    'export function createHandler(options) {',
    '  return createOpenApiHandler({',
    '    document,',
    '    operations: () => import(own),',
    '    call: async (operationId, args, credentials) =>',
    '      (await invokeOperation(agentId(), operationId, args, credentials ?? [])).result,',
    '    ...(options !== undefined && options.admit !== undefined ? { admit: options.admit } : {}),',
    '    ...(options !== undefined && options.bodyCap !== undefined ? { bodyCap: options.bodyCap } : {}),',
    '  });',
    '}',
    '',
  ].join('\n');
}
