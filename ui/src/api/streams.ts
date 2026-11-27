// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type {
  CallStreamEvent,
  ErrorEnvelope,
  InvokeStreamEvent,
  LiveRecord,
  TraceRecord,
} from '../gateway/types.gen.js';
import { askPlane, PLANE_ORIGIN, PlaneError, refusalOf } from './plane.js';

// The gateway's three streams, read with `fetch` and a reader: the
// browser's own event source can send neither a bearer nor a POST, and
// a call that answers as a stream is a POST. Each is asked through the
// one way the page asks the plane, so a stream that cannot be opened
// says the plane is not reached, and one that opens says it is.

const enc = encodeURIComponent;

/** The zone the plane writes its clocks in for this reader. */
function zoneOf(utc: boolean): string | undefined {
  if (utc) return undefined;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Reads a response's server-sent events, one parsed `data:` frame at
 * a time, until the stream ends or the signal aborts. */
async function readEvents(response: Response, onData: (data: unknown) => void): Promise<void> {
  const body = response.body;
  if (body === null) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end < 0) break;
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (frame.startsWith('data: ')) onData(JSON.parse(frame.slice(6)));
    }
  }
}

/** The failure a stream's refusal says. */
async function refused(response: Response, what: string): Promise<PlaneError> {
  const text = await response.text().catch(() => '');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return refusalOf(response.status, body, what);
}

/** How a stream is followed. */
export interface StreamHandle {
  /** Stops the read. */
  stop: () => void;
}

/** What a view's reading takes. A conversation is told by several
 * readers (the agent's stream, a sent call's own request, a call read
 * again in detail or for its export) and keeps the first telling of a
 * record, so every reader of lines says the clock and the debug lines
 * it reads by: neither is left out. */
export interface ViewOptions {
  /** The view's detailed reading: contexts, reasoning, whole values. */
  details?: boolean;
  /** The agent's own debug lines too: read wherever the agent's traces
   * stand at debug. */
  debug: boolean;
  /** Clocks in UTC rather than this machine's zone. */
  utc: boolean;
}

function viewQuery(query: URLSearchParams, view: string, options: ViewOptions): void {
  query.set('view', view);
  if (options.details === true) query.set('details', 'true');
  if (options.debug) query.set('debug', 'true');
  const zone = zoneOf(options.utc);
  if (zone !== undefined) query.set('zone', zone);
}

/**
 * Follows an agent's records as they are made, each with the lines the
 * trace view reads it as. `onOpen` hears the stream connect, `onEnd`
 * hears it close, with the failure when it broke.
 */
export function followAgent(
  agentId: string,
  options: ViewOptions & {
    /** How many recent records to tell first. */
    backlog?: number;
    /** The moment the stream reads from. */
    since?: string;
    onOpen?: () => void;
    onEnd?: (error?: unknown) => void;
  },
  onRecord: (record: TraceRecord, lines: string[]) => void,
): StreamHandle {
  const controller = new AbortController();
  const query = new URLSearchParams();
  if (options.backlog !== undefined) query.set('backlog', String(options.backlog));
  if (options.since !== undefined) query.set('since', options.since);
  viewQuery(query, 'live', options);
  const what = `the stream of ${agentId}`;
  void (async () => {
    const response = await askPlane(
      `${PLANE_ORIGIN}/v1/agents/${enc(agentId)}/calls/stream?${query.toString()}`,
      { signal: controller.signal, headers: { accept: 'text/event-stream' } },
    );
    if (!response.ok) throw await refused(response, what);
    options.onOpen?.();
    await readEvents(response, (data) => {
      const event = data as LiveRecord;
      onRecord(event.record, event.lines);
    });
  })().then(
    () => {
      if (!controller.signal.aborted) options.onEnd?.();
    },
    (error: unknown) => {
      if (!controller.signal.aborted) options.onEnd?.(error);
    },
  );
  return {
    stop: () => {
      controller.abort();
    },
  };
}

/**
 * Follows one call as the gateway tells it, however large: each call
 * entered, each record with its lines, until the call is told.
 */
export function followCall(
  callId: string,
  options: ViewOptions & {
    /** The calls this call caused as well, each entered before its records. */
    tree?: boolean;
    /** The reading asked for beside the records. */
    view?: 'live' | 'conversation';
    onOpen?: () => void;
    onEnd?: (error?: unknown) => void;
  },
  onEvent: (event: CallStreamEvent) => void,
): StreamHandle {
  const controller = new AbortController();
  const query = new URLSearchParams();
  if (options.tree === true) query.set('tree', 'true');
  if (options.view !== undefined) viewQuery(query, options.view, options);
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  void (async () => {
    const response = await askPlane(`${PLANE_ORIGIN}/v1/calls/${enc(callId)}/stream${suffix}`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    if (!response.ok) throw await refused(response, 'the stream of this call');
    options.onOpen?.();
    await readEvents(response, (data) => {
      onEvent(data as CallStreamEvent);
    });
  })().then(
    () => {
      if (!controller.signal.aborted) options.onEnd?.();
    },
    (error: unknown) => {
      if (!controller.signal.aborted) options.onEnd?.(error);
    },
  );
  return {
    stop: () => {
      controller.abort();
    },
  };
}

/** How a call that was sent ended. */
export type SendOutcome =
  | { state: 'completed'; result: unknown; callId?: string }
  | { state: 'failed'; error: ErrorEnvelope; callId?: string }
  | { state: 'refused'; error: PlaneError }
  | { state: 'lost'; callId?: string; error: unknown };

/**
 * Calls one function and follows the call as it runs: `onAccepted`
 * hears the call's id once a copy took it, `onRecord` each record as
 * the copy makes it, and the answer says how the call ended. A refusal
 * before any copy took the call is `refused`, in the plane's words; a
 * stream that broke before the call's end is `lost`, and the call may
 * still run.
 */
export async function sendCall(
  agentId: string,
  fn: string,
  args: unknown,
  options: ViewOptions & {
    signal?: AbortSignal;
    /** For a module's function: the agent to run it inside. */
    in?: string | undefined;
    /** The contract the arguments were laid out against, the sha256 hex
     * of its text: the plane refuses the call when the agent was
     * deployed again since under a contract this one does not fit. */
    contractSha?: string | undefined;
    onAccepted?: (callId: string) => void;
    /** Hears the module's standalone agent when this call started the
     * module by itself: the fleet has one agent more from that moment. */
    onStarted?: (standaloneId: string) => void;
    onRecord?: (record: TraceRecord, lines: string[]) => void;
  },
): Promise<SendOutcome> {
  const query = new URLSearchParams();
  viewQuery(query, 'live', options);
  const what = `the call of ${fn}`;
  const body = {
    ...(args === undefined ? {} : { args }),
    ...(options.in === undefined ? {} : { in: options.in }),
    ...(options.contractSha === undefined ? {} : { contractSha: options.contractSha }),
  };
  let callId: string | undefined;
  const withCall = (): { callId?: string } => (callId === undefined ? {} : { callId });
  let response: Response;
  try {
    response = await askPlane(
      `${PLANE_ORIGIN}/v1/agents/${enc(agentId)}/invoke/${enc(fn)}/stream?${query.toString()}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error) {
    return { state: 'lost', error };
  }
  if (!response.ok) return { state: 'refused', error: await refused(response, what) };
  let outcome: SendOutcome | undefined;
  try {
    await readEvents(response, (data) => {
      const event = data as InvokeStreamEvent;
      if (event.accepted !== undefined) {
        callId = event.accepted.callId;
        if (event.accepted.started !== undefined) options.onStarted?.(event.accepted.started);
        options.onAccepted?.(callId);
      } else if (event.record !== undefined) {
        options.onRecord?.(event.record, event.lines ?? []);
      } else if (event.error !== undefined) {
        outcome = { state: 'failed', error: event.error, ...withCall() };
      } else if (event.lines === undefined) {
        outcome = { state: 'completed', result: event.result, ...withCall() };
      }
    });
  } catch (error) {
    return outcome ?? { state: 'lost', error, ...withCall() };
  }
  return (
    outcome ?? {
      state: 'lost',
      error: new PlaneError("The stream ended before the call's answer."),
      ...withCall(),
    }
  );
}
