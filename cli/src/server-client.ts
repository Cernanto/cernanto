// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { CernantoError } from '@cernanto/package-format';

import {
  accepted,
  currentPlane,
  gatewayClients,
  planeFetch,
  statusOf,
  unread,
  unwrap,
} from './gateway-client.js';
import type { GatewayClients, Plane } from './gateway-client.js';
import * as gateway from './gateway/sdk.gen.js';
import { localZone } from './output.js';
import type {
  AgentDeleteResult,
  AgentRow,
  AgentsResult,
  AgentStartResult,
  CancelResponse,
  CompileRequest,
  GenerationRow,
  HistoryEntry,
  LandResult,
  DrainHostResult,
  UpgradeResult,
  CompileProgressResponse,
  CallStarted,
  CallStreamEvent,
  CallSummary,
  InvokeStreamEvent,
  LiveRecord,
  TraceRecord,
  TokenCreated,
  TokenRevokeResult,
  TokensResult,
  LsResult,
  AuthListResult,
} from './gateway/types.gen.js';

/** How long a landing request and a package's put wait for the plane's
 * answer before they are made again by the landing: a request the
 * plane holds past that (a call it never answers) is not waited out. */
const LANDING_REQUEST_MS = 60_000;
const PACKAGE_REQUEST_MS = 120_000;

// The plane's client: one API, spoken through the functions generated
// from its OpenAPI document (src/gateway). One method per operation, named
// as the operation is, so a verb module, this file and the document
// read as one. Every shape here is the document's, and what the cli
// offers is what the API serves.

const enc = encodeURIComponent;

/**
 * The call's id of a request's id: a record's `callId` names one request
 * of a call (`<service>:<generation>:<call>:<request>`, a linked call's
 * with its link's mark after it, `~...`), and the language names the
 * call by the id without the request's part. The part before the first
 * `~`, when it is four parts, loses its last; the mark stays; any other
 * id is answered as it is.
 *
 * @param id - A request's id, or a call's.
 * @returns The call's id.
 * @example
 * callOfRequest('ops_bank:20001:c-7:5f2a9c1e0b3d4a6f~2'); // 'ops_bank:20001:c-7~2'
 */
export function callOfRequest(id: string): string {
  const mark = id.indexOf('~');
  const head = mark === -1 ? id : id.slice(0, mark);
  const tail = mark === -1 ? '' : id.slice(mark);
  const parts = head.split(':');
  return `${parts.length === 4 ? parts.slice(0, 3).join(':') : head}${tail}`;
}

/**
 * The key a follow shows each record once by: the request, the attempt,
 * the sequence and the kind, and for a handler's end the run as well,
 * so a request that ran again and ended again shows each end in its
 * turn.
 *
 * @param record - A record a stream or a read of the plane told.
 * @returns The key two tellings of one record share.
 * @example
 * if (!shown.has(recordKeyOf(record))) shown.add(recordKeyOf(record));
 */
export function recordKeyOf(record: TraceRecord): string {
  return JSON.stringify([
    record.callId,
    record.attemptId ?? '',
    record.seq,
    record.kind,
    record.kind === 'handler' ? (record.run ?? '') : '',
  ]);
}

/** A run's id as two numbers, its grant and its count: runs order by
 * them, and a record without a run comes before every run. */
function runOrder(run: string | undefined): [number, number] {
  if (run === undefined) return [-1, -1];
  const [grant = '0', count = '0'] = run.split('.');
  return [Number(grant), Number(count)];
}

/**
 * The order a request's records are shown in: run by run in the order of
 * runs (each run's grant, then its count), and inside one run by the
 * place the sink gave each record. A record's moment is shown beside it;
 * two runs' hosts keep different clocks, and a clock can step back
 * inside a run, so the runs and the places give the order.
 *
 * @param records - One request's records, as the plane answered them.
 * @returns The records' indexes, in the order they are told.
 * @example
 * for (const index of recordsAsTheyHappened(answer.records)) show(answer.records[index]);
 */
export function recordsAsTheyHappened(records: TraceRecord[]): number[] {
  return records
    .map((record, index) => ({ record, index, run: runOrder(record.run) }))
    .sort(
      (left, right) =>
        left.run[0] - right.run[0] ||
        left.run[1] - right.run[1] ||
        (left.record.place ?? left.index) - (right.record.place ?? right.index) ||
        left.index - right.index,
    )
    .map((placed) => placed.index);
}

/** The words a stream's refusal carries: the plane's own when it
 * answered its error envelope, the status otherwise. */
async function streamRefusal(response: Response, what: string): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch {
    // Not the plane's JSON: the status is the word.
  }
  return `${what} answered ${String(response.status)}`;
}

/** The zone a view read carries so the plane renders its clocks for
 * this reader: this machine's, unless utc was asked. */
function zoneQuery(options: { utc?: boolean }): { zone?: string } {
  if (options.utc === true) return {};
  const zone = localZone();
  return zone === undefined ? {} : { zone };
}

export class ServerClient {
  private readonly gateways: GatewayClients;

  constructor(plane: Plane = currentPlane()) {
    this.gateways = gatewayClients(plane);
  }

  private get plane(): Plane {
    return this.gateways.plane;
  }

  /** Every agent of the fleet, with the
   * figures the plane samples; focused on one agent, its functions
   * and outstanding runs. */
  async ls(agent?: string): Promise<LsResult> {
    return unwrap(
      await gateway.ls({
        client: this.gateways.client,
        query: { ...(agent === undefined ? {} : { agent }) },
      }),
      '/v1/ls',
    );
  }
  /** The fleet's rows as shipped, its generations and its
   * conditions. */
  async agents(): Promise<AgentsResult> {
    return unwrap(await gateway.agents({ client: this.gateways.client }), '/v1/agents');
  }

  /** The rows alone. */
  async rows(): Promise<AgentRow[]> {
    return (await this.agents()).agents;
  }

  /** The agents' accounts and the asks they are parked on; one
   * agent's alone when named. */
  async auth(agent?: string): Promise<AuthListResult> {
    return unwrap(
      await gateway.authList({
        client: this.gateways.client,
        ...(agent === undefined ? {} : { query: { agent } }),
      }),
      '/v1/auth/accounts',
    );
  }

  /** The agents parked on an ask, for a status column. */
  async waitingAgents(): Promise<string[]> {
    return [...new Set((await this.auth()).asks.map((ask) => ask.agent))];
  }

  /** The generations alone; polled, this watches old generations
   * retire and new ones activate. */
  async generations(): Promise<GenerationRow[]> {
    return (await this.agents()).generations;
  }

  /** One agent: its row and its contract. */
  async describe(agentId: string): Promise<{ agent: AgentRow; contract?: string }> {
    return unwrap(
      await gateway.describe({
        client: this.gateways.client,
        path: { agentId },
      }),
      `/v1/agents/${enc(agentId)}`,
    );
  }

  /** Undeploys one agent; dependents block it unless forced. */
  async agentDelete(agentId: string, force: boolean): Promise<AgentDeleteResult> {
    return unwrap(
      await gateway.agentDelete({
        client: this.gateways.client,
        path: { agentId },
        query: { ...(force ? { force: 'true' as const } : {}) },
      }),
      `/v1/agents/${enc(agentId)}${force ? '?force=true' : ''}`,
    );
  }

  /** The gateway's three config operations, marked secret in its
   * document as the config agent's asks are: no record on the plane
   * keeps a path, a value or the listing. */
  async configGet(key: string): Promise<{ value?: unknown }> {
    const body = unwrap(
      await gateway.configGet({ client: this.gateways.client, body: { key } }),
      '/v1/config/get',
    );
    return { value: body.value };
  }

  async configSet(key: string, value: unknown): Promise<{ present: boolean }> {
    const body = unwrap(
      await gateway.configSet({ client: this.gateways.client, body: { key, value } }),
      '/v1/config/set',
    );
    return { present: body.present };
  }

  async configList(place?: string): Promise<{ configuration?: unknown }> {
    const body = unwrap(
      await gateway.configList({
        client: this.gateways.client,
        query: place === undefined ? {} : { place },
      }),
      '/v1/config',
    );
    return { configuration: body.configuration };
  }

  /** Calls one exported function and answers its result. */
  async invoke(agentId: string, fn: string, args: unknown): Promise<unknown> {
    return (await this.invokeCall(agentId, fn, args)).result;
  }

  /** Calls one exported function and answers the result with the
   * run's id (the handle of its trace). The call rides the long-haul
   * client: a function lawfully runs for as long as it works. */
  async invokeCall(
    agentId: string,
    fn: string,
    args: unknown,
  ): Promise<{ result: unknown; callId?: string }> {
    const body = unwrap(
      await gateway.invoke({
        client: this.gateways.longHaul,
        path: { agentId, function: fn },
        body: { args },
      }),
      `/v1/agents/${enc(agentId)}/invoke/${enc(fn)}`,
    );
    return { result: body.result, callId: body.callId };
  }

  /**
   * Calls one exported function and follows it as it runs, the one that
   * makes the call following it: the plane tells the call's id once a
   * copy took it, each record as the copy makes it (with the lines the
   * plane rendered it as, under `view: 'live'`), then the answer. The
   * call rides the long-haul client; a refusal before any copy took the
   * call fails in the plane's words and status, as `invoke`'s does.
   */
  async invokeStream(
    agentId: string,
    fn: string,
    args: unknown,
    options: {
      view?: 'live';
      details?: boolean;
      debug?: boolean;
      utc?: boolean;
      onAccepted?: (callId: string) => void;
      onRecord?: (record: TraceRecord, lines?: string[]) => void;
    },
  ): Promise<{ result: unknown; callId?: string }> {
    const query = new URLSearchParams();
    if (options.view !== undefined) {
      query.set('view', options.view);
      if (options.details === true) query.set('details', 'true');
      if (options.debug === true) query.set('debug', 'true');
      const zone = zoneQuery(options).zone;
      if (zone !== undefined) query.set('zone', zone);
    }
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    const path = `/v1/agents/${enc(agentId)}/invoke/${enc(fn)}/stream`;
    const response = await planeFetch(this.plane, `${this.plane.baseUrl}${path}${suffix}`, {
      longHaul: true,
      json: { args },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let error: { kind?: string; message?: string } | undefined;
      try {
        error = (JSON.parse(text) as { error?: { kind?: string; message?: string } }).error;
      } catch {
        // Not the plane's JSON: the status is the word.
      }
      throw new CernantoError({
        kind: error?.kind === 'retryable' ? 'retryable' : 'terminal',
        message: error?.message ?? `the plane answered ${String(response.status)} for ${path}`,
      });
    }
    let callId: string | undefined;
    const frames = (response.body ?? []) as AsyncIterable<Uint8Array>;
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of frames) {
      buffer += decoder.decode(chunk, { stream: true });
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end < 0) break;
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!frame.startsWith('data: ')) continue;
        const event = JSON.parse(frame.slice(6)) as InvokeStreamEvent;
        if (event.accepted !== undefined) {
          callId = event.accepted.callId;
          options.onAccepted?.(callId);
        } else if (event.record !== undefined) {
          options.onRecord?.(event.record, event.lines);
        } else if (event.error !== undefined) {
          throw new CernantoError({
            kind: event.error.kind ?? 'terminal',
            message: event.error.message,
            ...(event.error.details === undefined ? {} : { details: event.error.details }),
          });
        } else if (event.lines === undefined) {
          // The answer: what the function answered, absent for a function
          // that answered nothing, which JSON drops as the plain invoke's
          // answer drops it.
          return { result: event.result, ...(callId === undefined ? {} : { callId }) };
        }
      }
    }
    throw new CernantoError({
      kind: 'retryable',
      message: `${path}: the stream ended before the call's answer`,
    });
  }

  /** Starts an agent's program: a new version of the same code runs
   * it from the top. */
  async agentStart(agentId: string): Promise<AgentStartResult> {
    return unwrap(
      await gateway.agentStart({
        client: this.gateways.client,
        path: { agentId },
      }),
      `/v1/agents/${enc(agentId)}/start`,
    );
  }
  /** Which package ran when, newest first. */
  async history(agent?: string): Promise<HistoryEntry[]> {
    return unwrap(
      await gateway.history_({
        client: this.gateways.client,
        query: { ...(agent === undefined ? {} : { agent }) },
      }),
      '/v1/history',
    ).entries;
  }

  /** Recent calls, newest first. */
  async calls(filter: { agent?: string; limit?: number }): Promise<CallSummary[]> {
    return unwrap(
      await gateway.calls({
        client: this.gateways.client,
        query: {
          ...(filter.agent === undefined ? {} : { agent: filter.agent }),
          ...(filter.limit === undefined ? {} : { limit: filter.limit }),
        },
      }),
      '/v1/calls',
    ).calls;
  }

  /** One call whole: its records page by page (the gateway answers a page
   * from `after` and names `next` while records remain), the calls it
   * caused as calls, and under `view: 'live'` the lines the plane
   * rendered each record as (an agent's live stream's reading). Each
   * page is a bounded read. */
  async call(
    callId: string,
    options: {
      view?: 'live';
      details?: boolean;
      debug?: boolean;
      /** Clocks in utc rather than this machine's zone. */
      utc?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<{
    call: CallSummary;
    records: TraceRecord[];
    children: CallSummary[];
    lines?: string[][];
  }> {
    const records: TraceRecord[] = [];
    const lines: string[][] = [];
    let after: number | undefined;
    for (;;) {
      const query = {
        ...(after === undefined ? {} : { after }),
        ...(options.view === undefined ? {} : { view: options.view }),
        ...(options.details === true ? { details: 'true' as const } : {}),
        ...(options.debug === true ? { debug: 'true' as const } : {}),
        ...(options.view === undefined ? {} : zoneQuery(options)),
      };
      const page = unwrap(
        await gateway.call({
          client:
            options.timeoutMs === undefined
              ? this.gateways.client
              : this.gateways.within(options.timeoutMs),
          path: { callId },
          ...(Object.keys(query).length === 0 ? {} : { query }),
        }),
        `/v1/calls/${enc(callId)}`,
      );
      records.push(...page.records);
      if (page.lines !== undefined) lines.push(...page.lines);
      if (page.next === undefined || page.records.length === 0) {
        return {
          call: page.call,
          records,
          children: page.children,
          ...(options.view === undefined ? {} : { lines }),
        };
      }
      after = page.next;
    }
  }

  /** One call as the gateway streams it, however large: the callback
   * sees each event in order (the call entered, each record with the
   * lines a view adds, the conversation's own lines, or the error that
   * ended the stream); `onEnd` hears the stream close, with the error
   * when it broke; the returned function stops the read. Server-sent
   * events over the API's own frames, read by hand as the agent
   * stream is. */
  callStream(
    callId: string,
    options: {
      tree?: boolean;
      view?: 'conversation' | 'live';
      details?: boolean;
      debug?: boolean;
      utc?: boolean;
      onOpen?: () => void;
      onEnd?: (error?: unknown) => void;
    },
    onEvent: (event: CallStreamEvent) => void,
  ): () => void {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (options.tree === true) query.set('tree', 'true');
    if (options.view !== undefined) {
      query.set('view', options.view);
      if (options.details === true) query.set('details', 'true');
      if (options.debug === true) query.set('debug', 'true');
      const zone = zoneQuery(options).zone;
      if (zone !== undefined) query.set('zone', zone);
    }
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    void (async () => {
      const response = await planeFetch(
        this.plane,
        `${this.plane.baseUrl}/v1/calls/${enc(callId)}/stream${suffix}`,
        { signal: controller.signal, longHaul: true },
      );
      if (!response.ok) {
        let words = await streamRefusal(response, 'the call stream');
        if (response.status === 404 && !words.includes('is recorded')) {
          words = `the plane serves no call stream for "${callId}"; its gateway predates the call stream and needs a deploy`;
        }
        throw new CernantoError({ kind: 'terminal', message: words });
      }
      options.onOpen?.();
      const frames = (response.body ?? []) as AsyncIterable<Uint8Array>;
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of frames) {
        buffer += decoder.decode(chunk, { stream: true });
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end < 0) break;
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith('data: ')) onEvent(JSON.parse(frame.slice(6)) as CallStreamEvent);
        }
      }
    })().then(
      () => {
        if (!controller.signal.aborted) options.onEnd?.();
      },
      (error: unknown) => {
        if (!controller.signal.aborted) options.onEnd?.(error);
      },
    );
    return () => {
      controller.abort();
    };
  }

  /** A compile's narration and outcome off its document: the steps so
   * far, its answer or its failure once it ended; `take` on an ended
   * compile removes the document as it is answered. */
  async compileProgress(
    compileId: string,
    options: { take?: boolean; call?: string; timeoutMs?: number } = {},
  ): Promise<CompileProgressResponse> {
    return unwrap(
      await gateway.compileProgress({
        client:
          options.timeoutMs === undefined
            ? this.gateways.client
            : this.gateways.within(options.timeoutMs),
        path: { compileId },
        query: {
          ...(options.take === true ? { take: 'true' as const } : {}),
          ...(options.call === undefined ? {} : { call: options.call }),
        },
      }),
      `/v1/compiles/${enc(compileId)}/progress`,
    );
  }

  /** Ends a call. */
  async cancel(callId: string): Promise<CancelResponse> {
    return unwrap(
      await gateway.cancel({ client: this.gateways.client, path: { callId } }),
      `/v1/calls/${enc(callId)}/cancel`,
    );
  }

  /** Names the release the plane's hosts upgrade to, one at a time. */
  async upgrade(version: string): Promise<UpgradeResult> {
    return unwrap(
      await gateway.upgrade({ client: this.gateways.client, body: { version } }),
      '/v1/upgrade',
    );
  }

  /** Tells one host to let its copies go for the others to take. */
  async drainHost(host: string): Promise<DrainHostResult> {
    return unwrap(
      await gateway.drainHost({ client: this.gateways.client, path: { host } }),
      `/v1/hosts/${enc(host)}/drain`,
    );
  }

  /** Lands packages the plane holds into the fleet, with what they
   * need: one target, or several as one landing. */
  async land(body: {
    target?: string;
    targets?: string[];
    noDeps?: boolean;
    installed?: boolean;
  }): Promise<LandResult> {
    return unwrap(
      await gateway.land({
        client: this.gateways.client,
        body,
        signal: AbortSignal.timeout(LANDING_REQUEST_MS),
      }),
      '/v1/land',
    );
  }

  /** Compiles the targets: the compile runs behind the API as a run of
   * its own and stops at the packages; the answer is the run to
   * follow. */
  async compile(request: CompileRequest): Promise<CallStarted> {
    return unwrap(
      await gateway.compile({ client: this.gateways.client, body: request }),
      '/v1/compile',
    );
  }

  /** The whole road: the plane compiles, verifies when asked and ships
   * the rows inside itself; the answer is the run to follow. */
  async deploy(request: CompileRequest): Promise<CallStarted> {
    return unwrap(
      await gateway.deploy({ client: this.gateways.client, body: request }),
      '/v1/deploy',
    );
  }

  /** The package whole, its slices joined and sha-verified. */
  async packageGet(digest: string): Promise<Buffer> {
    const result = await gateway.packageGet({
      client: this.gateways.client,
      path: { digest },
      parseAs: 'arrayBuffer',
    });
    const lost = unread(result, `/v1/packages/${enc(digest)}`);
    if (lost !== undefined) throw lost;
    if (!accepted(result)) {
      throw new CernantoError({
        kind: 'terminal',
        message: `no package "${digest}" on this plane (${statusOf(result)})`,
      });
    }
    return Buffer.from(result.data as unknown as ArrayBuffer);
  }

  /** Stores a package's bytes on the plane, idempotent. */
  async packagePut(digest: string, bytes: Buffer): Promise<void> {
    const result = await gateway.packagePut({
      client: this.gateways.client,
      signal: AbortSignal.timeout(PACKAGE_REQUEST_MS),
      path: { digest },
      body: new Blob([new Uint8Array(bytes)]),
    });
    const lost = unread(result, `/v1/packages/${enc(digest)}`);
    if (lost !== undefined) throw lost;
    if (!accepted(result)) {
      throw new CernantoError({
        kind: 'terminal',
        message: `the package put answered ${statusOf(result)}`,
      });
    }
  }

  /** Whether the plane holds a package of the digest. */
  async packageExists(digest: string): Promise<boolean> {
    return unwrap(
      await gateway.packageExists({ client: this.gateways.client, path: { digest } }),
      `/v1/packages/${enc(digest)}/exists`,
    ).exists;
  }

  /** Mints a named operator token; the plaintext comes back once. */
  async tokenCreate(name: string): Promise<TokenCreated> {
    return unwrap(
      await gateway.tokenCreate({ client: this.gateways.client, body: { name } }),
      '/v1/tokens',
    );
  }

  async tokenList(): Promise<TokensResult> {
    return unwrap(await gateway.tokenList({ client: this.gateways.client }), '/v1/tokens');
  }

  async tokenRevoke(name: string): Promise<TokenRevokeResult> {
    return unwrap(
      await gateway.tokenRevoke({ client: this.gateways.client, path: { name } }),
      `/v1/tokens/${enc(name)}`,
    );
  }

  /** Follows an agent's runs live; the callback sees each record and,
   * under `view: 'live'`, the lines the plane rendered it as (the
   * trace view's reading of one record of a live stream, the open
   * requests remembered for the stream's life); `onOpen` hears the
   * stream connect, `onEnd` hears it close (with the error when it
   * broke), and the returned function stops the watch. The stream is
   * the one operation read by hand: server-sent events over the API's
   * own frames, a socket held for hours. */
  callsStream(
    agentId: string,
    options: {
      backlog?: number;
      /** The ISO moment the stream reads from: a deploy names the
       * moment it began, so the agent's earlier history stays unread. */
      since?: string;
      /** Asks the plane to render each record as a live stream shows it. */
      view?: 'live';
      details?: boolean;
      debug?: boolean;
      utc?: boolean;
      onOpen?: () => void;
      onEnd?: (error?: unknown) => void;
    },
    onRecord: (record: TraceRecord, lines?: string[]) => void,
  ): () => void {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (options.backlog !== undefined) query.set('backlog', String(options.backlog));
    if (options.since !== undefined) query.set('since', options.since);
    if (options.view !== undefined) {
      query.set('view', options.view);
      if (options.details === true) query.set('details', 'true');
      if (options.debug === true) query.set('debug', 'true');
      const zone = zoneQuery(options).zone;
      if (zone !== undefined) query.set('zone', zone);
    }
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    void (async () => {
      const response = await planeFetch(
        this.plane,
        `${this.plane.baseUrl}/v1/agents/${enc(agentId)}/calls/stream${suffix}`,
        { signal: controller.signal, longHaul: true },
      );
      if (!response.ok) {
        throw new CernantoError({
          kind: 'terminal',
          message: await streamRefusal(response, `the call stream of ${agentId}`),
        });
      }
      options.onOpen?.();
      const frames = (response.body ?? []) as AsyncIterable<Uint8Array>;
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of frames) {
        buffer += decoder.decode(chunk, { stream: true });
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end < 0) break;
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith('data: ')) {
            if (options.view === undefined) {
              onRecord(JSON.parse(frame.slice(6)) as TraceRecord);
            } else {
              const event = JSON.parse(frame.slice(6)) as LiveRecord;
              onRecord(event.record, event.lines);
            }
          }
        }
      }
    })().then(
      () => {
        if (!controller.signal.aborted) options.onEnd?.();
      },
      (error: unknown) => {
        if (!controller.signal.aborted) options.onEnd?.(error);
      },
    );
    return () => {
      controller.abort();
    };
  }
}
