// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The process's substrate: one implementor per process, opened lazily
// by the facts the process was handed (the implementor's name and the
// plane's root), let go for a pause and taken back after it, closed at
// the end. Every name the runtime spells beside the records' keys (a
// call's handle, a process's own inbox) is minted here, so the naming
// lives in one place.

import { freshUUID } from './entropy.js';
import { fileURLToPath } from 'node:url';

import { CernantoError, retriesAttempt } from '../language/errors.js';
import { serviceNameOf } from '../language/naming.js';
import { processFacts } from './facts.js';
import { subjectToken } from './subjects.js';
import { PLANE_FORMAT, PLANE_FORMAT_KEY } from './substrate.js';
import type { Substrate, SubstrateName } from './substrate.js';
import { openFilesSubstrate } from './substrate/files/index.js';
import { openDynamoSubstrate } from './substrate/dynamodb/index.js';

export { subjectToken };

/** The id a call is known by outside its callee: the callee's service
 * and the call id, one string, with the generation that ran the call
 * once one has. A call's records are filed under it. */
export function callHandle(service: string, callId: string, generation?: string): string {
  return `${service}:${generation ?? ''}:${callId}`;
}

/** The parts of a handle; undefined for a string that is none. The
 * shape `<service>:<generation>:<callId>` (the generation empty when
 * unknown) keeps a handle safe in a url path, a header and an id
 * pattern: a service name, a generation and a call id never carry a
 * colon themselves. */
export function parseHandle(
  handle: string,
): { service: string; callId: string; generation?: string } | undefined {
  const first = handle.indexOf(':');
  if (first <= 0) return undefined;
  const second = handle.indexOf(':', first + 1);
  if (second === -1 || second === handle.length - 1) return undefined;
  const generation = handle.slice(first + 1, second);
  return {
    service: handle.slice(0, first),
    callId: handle.slice(second + 1),
    ...(generation === '' ? {} : { generation }),
  };
}

/** The inbox of this process: the name its answers and its words are
 * posted to. A copy the plane runs takes the inbox spelled from its
 * service, its generation and its copy number, which its record
 * resolves to its call server wherever it runs; a process without a
 * copy (a tool, a proof) takes a random inbox for its life, because
 * nothing else names it uniquely, and a call that outlives such a
 * process is asked again from the next one. Read when first needed:
 * the facts are set after this module loads. */
let ownInboxValue: string | undefined;
export function ownInbox(): string {
  // A copy's own inbox follows its facts whenever they name it: the
  // block asks the plane before a copy's facts are set (the tar it
  // boots from), under a random inbox of the process's, and the copy
  // then serves under its own; the random one is kept for a process
  // whose facts never name a copy.
  const { copy, generationPort, agentId } = processFacts();
  if (copy !== undefined && generationPort !== undefined && agentId !== undefined)
    return `${serviceNameOf(agentId)}/${String(generationPort)}/${String(copy)}`;
  ownInboxValue ??= `~${freshUUID().replaceAll('-', '')}`;
  return ownInboxValue;
}

/** Whether an inbox is a copy's own, kept across its process's lives,
 * rather than one a process took at random for its life. */
export function stableInbox(name: string): boolean {
  return !name.startsWith('~');
}

/** The substrate implementor the facts name, and the root the files
 * one works under; nothing when the process was handed no substrate.
 * The plane's place, a `file:` url, names the folder the plane's files
 * live under when the block hands one: several host jobs on one
 * machine (a proof's tier) share one plane there while each keeps the
 * agents' folders under a root of its own. */
export function substrateNamed():
  { name: SubstrateName; root: string | undefined; cloud?: CloudPlace | undefined } | undefined {
  const facts = processFacts();
  const url = facts.substrateUrl;
  const rootOfUrl =
    url !== undefined && url.startsWith('file:') ? fileURLToPath(new URL(url)) : undefined;
  const root = rootOfUrl ?? facts.root;
  const cloud = cloudPlaceOf(url) ?? cloudPlaceOfFacts();
  const place = cloud === undefined ? {} : { cloud };
  if (facts.substrate !== undefined) return { name: facts.substrate, root, ...place };
  if (cloud !== undefined) return { name: 'dynamodb-s3', root, cloud };
  if (root !== undefined) return { name: 'files-sqlite', root };
  return undefined;
}

/** Where a cloud plane keeps its store: the region, the table and the
 * bucket, which the plane's place names as
 * `dynamodb://<region>/<table>?bucket=<bucket>`, or the facts do. */
interface CloudPlace {
  region: string;
  table: string;
  bucket: string;
}

export function cloudPlaceOf(url: string | undefined): CloudPlace | undefined {
  if (url === undefined || !url.startsWith('dynamodb:')) return undefined;
  const parsed = new URL(url);
  const region = parsed.hostname;
  const table = parsed.pathname.replace(/^\/+/, '');
  const bucket = parsed.searchParams.get('bucket') ?? '';
  if (region === '' || table === '' || bucket === '') {
    throw new CernantoError({
      kind: 'terminal',
      message: `the plane's place ${url} names no region, table or bucket: dynamodb://<region>/<table>?bucket=<bucket>`,
    });
  }
  return { region, table, bucket };
}

function cloudPlaceOfFacts(): CloudPlace | undefined {
  const plane = processFacts().plane;
  if (plane?.table === undefined || plane.bucket === undefined || plane.region === undefined)
    return undefined;
  return { region: plane.region, table: plane.table, bucket: plane.bucket };
}

/** Whether this process was handed a substrate: a process the plane
 * runs, or a proof that stands in for one. */
export function substrateConfigured(): boolean {
  return substrateNamed() !== undefined;
}

/** The substrate's own trouble, as an implementor reports it: the
 * database locked past its patience, a file the system could not
 * write, the network away or slow (a request that timed out, a
 * connection reset, a name not resolved) and a cloud store's transient
 * answers. Such a failure says nothing of
 * what was asked: the write may stand, and an ask again finds out. */
export function substrateTrouble(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && TROUBLE_CODES.has(code)) return true;
    if (current.name === 'TimeoutError' || current.name === 'AbortError') return true;
    if (TROUBLE_NAMES.has(current.name)) return true;
    if (
      /database is locked|SQLITE_BUSY|fetch failed|socket hang up|throttl|service unavailable|internal server error/i.test(
        current.message,
      )
    )
      return true;
    current = current.cause;
  }
  return false;
}

/** The names of a cloud store's passing troubles, as its SDK throws
 * them: a table or a bucket throttled, a transaction that met another,
 * the service's own moment of trouble. */
const TROUBLE_NAMES: ReadonlySet<string> = new Set([
  'ProvisionedThroughputExceededException',
  'ThrottlingException',
  'RequestLimitExceeded',
  'TransactionConflictException',
  'LimitExceededException',
  'InternalServerError',
  'ServiceUnavailable',
  'SlowDown',
]);

/** The codes of the store's and the network's passing troubles: the
 * files' store busy or out of room, a connection reset, refused or
 * timed out, a name not resolved, a socket the client gave up on. */
const TROUBLE_CODES: ReadonlySet<string> = new Set([
  'SQLITE_BUSY',
  'ERR_SQLITE_ERROR',
  'EAGAIN',
  'EBUSY',
  'ENOSPC',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_SOCKET_CLOSED',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** The kernel's retry rule with the substrate in it: a failure that
 * repeats the attempt by the language's rule, or the substrate's own
 * trouble met on the way, which is never the call's failure. */
export function repeatsAttempt(error: unknown): boolean {
  return retriesAttempt(error) || substrateTrouble(error);
}

let opening: Promise<Substrate> | undefined;
let opened: Substrate | undefined;
let closed = false;

/** Whether this process closed its substrate: once closed, it stays
 * closed. */
export function substrateClosed(): boolean {
  return closed;
}

/** The process's substrate, opened on first use. */
export function substrate(): Promise<Substrate> {
  if (closed) {
    return Promise.reject(
      new CernantoError({ kind: 'terminal', message: 'the substrate is closed' }),
    );
  }
  // A suspended process (paused by whoever runs it) holds every reach
  // until it resumes: nothing of it fails, nothing of it leaves while
  // the substrate is let go.
  if (suspended !== undefined) return suspended.then(() => substrate());
  return openOnce();
}

/** The substrate, opened on first use, the gate of a pause not asked. */
function openOnce(): Promise<Substrate> {
  opening ??= open()
    .then((handles) => {
      opened = handles;
      return handles;
    })
    .catch((error: unknown) => {
      // An opening that failed is nobody's substrate: the next ask
      // opens anew.
      opening = undefined;
      opened = undefined;
      throw error;
    });
  return opening;
}

/** Puts the substrate down without closing it for good: a road opened
 * for one piece of work (the materialize's reads of the store) whose
 * substrate has no business in what the same process does next. The
 * next ask opens anew. */
export async function putDownSubstrate(): Promise<void> {
  const current = opening;
  opening = undefined;
  opened = undefined;
  if (current === undefined) return;
  const handles = await current.catch(() => undefined);
  if (handles === undefined) return;
  await handles.close().catch(() => undefined);
}

/** Opens the substrate for this process, once: boot calls it before the
 * agent's code loads, so a module-scope call finds it open; a process
 * outside the plane, a tool or a test, opens it at its first use
 * through `substrate`. */
export function openSubstrate(): Promise<Substrate> {
  return substrate();
}

/** Whether this process read the plane's format already: once per
 * process, at its first opening. */
let formatChecked = false;

/** The plane's shape, read once at the first opening: a plane that
 * names the shape this release reads is opened; one that names
 * another, or one with records and no shape named, is not read, in
 * words that say how to start it afresh, since nothing of its calls is
 * carried over; a fresh plane is stamped with this release's shape. */
async function assertPlaneFormat(handles: Substrate): Promise<void> {
  if (formatChecked) return;
  const reset =
    'its calls cannot be carried over; run `cernanto dev reset` to start the plane afresh (on servers, stop every host and empty the store first)';
  const refuse = (found: unknown): never => {
    throw new CernantoError({
      kind: 'terminal',
      message: `the plane was written in another shape (format ${String(found)}; this release reads format ${String(PLANE_FORMAT)}): ${reset}`,
    });
  };
  for (;;) {
    const read = await handles.records.read(PLANE_FORMAT_KEY);
    if (read.value !== null) {
      let found: unknown;
      try {
        found = (JSON.parse(read.value) as { format?: unknown }).format;
      } catch {
        found = read.value;
      }
      if (found !== PLANE_FORMAT) refuse(found);
      formatChecked = true;
      return;
    }
    const standing = await handles.records.list('agents/');
    if (standing.entries.length > 0) refuse('unnamed, an earlier release');
    const written = await handles.records.write(
      PLANE_FORMAT_KEY,
      JSON.stringify({ format: PLANE_FORMAT, since: Date.now() }),
      null,
    );
    if (written.ok) {
      formatChecked = true;
      return;
    }
    // Another process of a fresh plane stamped it first: read again.
  }
}

async function open(): Promise<Substrate> {
  const handles = await openNamed();
  try {
    await assertPlaneFormat(handles);
  } catch (error) {
    await handles.close().catch(() => undefined);
    throw error;
  }
  return handles;
}

function openNamed(): Promise<Substrate> {
  const named = substrateNamed();
  if (named === undefined) {
    return Promise.reject(
      new CernantoError({
        kind: 'terminal',
        message:
          'this process has no substrate: nobody handed it the implementor and the root of the plane it journals on',
      }),
    );
  }
  if (named.name === 'dynamodb-s3') {
    if (named.cloud === undefined) {
      return Promise.reject(
        new CernantoError({
          kind: 'terminal',
          message:
            'the cloud substrate needs the region, the table and the bucket of the plane, and the facts name none',
        }),
      );
    }
    return Promise.resolve(openDynamoSubstrate(named.cloud));
  }
  if (named.root === undefined) {
    return Promise.reject(
      new CernantoError({
        kind: 'terminal',
        message: 'the files substrate needs the root of the plane, and the facts name none',
      }),
    );
  }
  return Promise.resolve(openFilesSubstrate({ root: named.root }));
}

/** Resolves once the process resumes; undefined while it runs. */
let suspended: Promise<void> | undefined;
let resumeNow: () => void = () => undefined;

/** Lets go of the substrate for a pause of the process, and holds every
 * reach until `releaseSubstrate`: a paused process holds nothing open,
 * and what it asks of the substrate meanwhile waits rather than fails. */
export async function suspendSubstrate(): Promise<void> {
  if (closed || suspended !== undefined) return;
  suspended = new Promise<void>((resolve) => {
    resumeNow = resolve;
  });
  const current = opening;
  opening = undefined;
  opened = undefined;
  if (current === undefined) return;
  const handles = await current.catch(() => undefined);
  if (handles === undefined) return;
  await handles.close().catch(() => undefined);
}

/** Opens the substrate anew after a pause, on this or another machine,
 * for whoever resumes the process alone: every other reach stays held
 * until `releaseSubstrate`, so what the journals gained meanwhile is
 * read before anything of the process writes again. */
export function reopenSubstrate(): Promise<Substrate> {
  if (closed) {
    return Promise.reject(
      new CernantoError({ kind: 'terminal', message: 'the substrate is closed' }),
    );
  }
  return openOnce();
}

/** The substrate a resume reopened and has not released yet: the
 * resume's own reads (where and as whom the process came back) ride
 * it, while every other reach stays held behind the accessor; nothing
 * while the process is not suspended, or nothing is reopened yet. */
export function reopenedSubstrate(): Substrate | undefined {
  return suspended === undefined ? undefined : opened;
}

/** Lets every held reach go on, the substrate open. */
export function releaseSubstrate(): void {
  if (suspended === undefined) return;
  const wake = resumeNow;
  suspended = undefined;
  resumeNow = () => undefined;
  wake();
}

/** Whether the process holds its reaches for a pause. */
export function substrateSuspended(): boolean {
  return suspended !== undefined;
}

/** Closes the process's substrate for good. */
export async function closeSubstrate(): Promise<void> {
  closed = true;
  if (opening === undefined) return;
  const handles = await opening.catch(() => undefined);
  opening = undefined;
  opened = undefined;
  if (handles === undefined) return;
  await handles.close().catch(() => undefined);
}
