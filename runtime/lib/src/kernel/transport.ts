// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The road between agents: HTTP from copy to copy, and nothing of a
// call in the store but the two logs. A caller chooses one live copy of
// the callee before its first send and keeps it through every resend
// (the logical destination, named in the request and in the caller's
// record); it posts the request to that copy's current address, read
// off the copy's record, and the copy's answer to the post is the ack,
// with the response beside it when one stands already. The callee posts
// the response to the inbox the request names, and the caller's answer
// to that post is the ack. Each side resends what it wrote until the
// other side acked it, every ten seconds, for as long as anything
// stands unacked: a request while the callee exists, a response for
// five minutes. A destination whose record is gone is answered for by a
// live sibling of its service from the dead log. A callee no copy of
// which is live is asked for from the controller (`need`), and the
// request waits for a copy. A plain caller (no journal: the cli through
// the gateway, a trace sink, the host job's words) keeps its request in
// memory and resends the same way.

import { freshUUID } from './entropy.js';
import { debuglog } from 'node:util';

import { sleepMs, untilAborted } from './lifetime.js';
import { CernantoError } from '../language/errors.js';
import { CONTROL_WAIT_MS, formTarget, processFacts } from './facts.js';
import { serviceNameOf } from '../language/naming.js';
import { ownInbox, stableInbox, substrate, substrateClosed } from './connection.js';
import { callServerAddress, ensureCallServer, holdCallServer } from './call-server.js';
import type { CallMessage, HandedMessage, PostAnswer } from './call-server.js';
import { encodeJson } from './json.js';
import type { CallEnvelope } from './envelope.js';
import { RESEND_EVERY_MS, requestIdFor } from './log.js';
import type { Destination, Outcome, RecordedError, RequestSent, ResponseSent } from './log.js';
import { errorFromRecord } from './journal.js';
import type { Journal } from './journal.js';
import { COPIES_PREFIX, agentKey, copiesPrefix, copyKey } from './substrate.js';
import { hostOf } from './plane.js';
import type { Records } from './substrate.js';
import { crashAt, faultAt } from './faults.js';
import { storyOf } from '../traces/story.js';

/** The identity a call carries, read by the callee for attribution. */
export interface CallIdentity {
  agentId: string;
  callId: string;
  hostAgentId?: string | undefined;
  hostCallId?: string | undefined;
  /** The agent a verification form stands for, when the caller is one
   * (the process facts' `target`). */
  target?: string | undefined;
  /** The story the call is a child of in the traces. */
  story?: string | undefined;
  /** The agent a model request made under the call is charged to. */
  charge?: { agentId: string; life: string } | undefined;
  observation?: boolean | undefined;
  /** The paths of the arguments that are credentials, which the
   * callee's records name without their values. */
  credentials?: string[] | undefined;
  /** The interface the call is bound through, which the callee checks
   * it implements. */
  bound?: { interface: string; sha: string } | undefined;
}

/** What a call has come to, as a reader asks it: nothing yet, its
 * result, or the failure it ended in. */
export type CallOutcome =
  | { done: false }
  | { done: true; result: unknown }
  | {
      done: true;
      error: { kind: string; message: string; status?: number; body?: unknown; secret?: true };
    };

/** What a request answers: the callee's answer, or its failure. */
/** A wire reply: the result or the error, and the generation of the
 * copy the request was sent to, which the handle a waiting caller is
 * handed names. */
export type WireReply = ({ result: unknown } | { error: RecordedError }) & {
  generation?: string;
  /** The story the call's records are kept under. */
  story?: string;
};

const debug = debuglog('cernanto-transport');

/** The inbox of an agent's copies on one host: a call named to a host
 * is posted to the copy of the agent placed there, so the host job's
 * acts and the block's ring of its `serve` reach the host job of the
 * host they name and no other. */
export function hostLaneInbox(service: string, host: string): string {
  return `${service}@${host}`;
}

/** The host a copy's record names, when it names one. */
function hostOfRecord(record: Record<string, unknown>): string | undefined {
  return hostOf(record);
}

/** The id a call from this process names as its caller: the process's
 * own served id reads as the agent it calls out as (a test form calls
 * as the agent it is the form of); any other id, a linked module's,
 * stays its own. */
function callsAs(agentId: string): string {
  const facts = processFacts();
  if (facts.callsAs !== undefined && agentId === facts.agentId) return facts.callsAs;
  // A module's test form is linked into its tester under its test-form
  // id: its calls name the module it stands for, the tester's target.
  if (
    facts.form === 'tester' &&
    facts.target !== undefined &&
    facts.testOf !== undefined &&
    agentId === facts.testOf
  )
    return facts.target;
  return agentId;
}

/** The target a verification form states beside its caller: on the
 * form's own calls, none on a linked module's. */
function targetField(callerAgentId: string): { target?: string } {
  const target = formTarget(callerAgentId);
  return target === undefined ? {} : { target };
}

/** The agents this process has seen in the directory, with the moment:
 * an agent that was ever served stays there until it is deleted, so
 * the sight is trusted for a while and asked again past it. */
const seenAgents = new Map<string, number>();

/** How long an agent's directory entry, once seen, is taken as standing
 * before it is looked for again. */
const LANE_SEEN_MS = 15_000;

/** Whether the plane names an agent: served at least once (its
 * directory entry stands), or placed and not yet served (a copy's
 * record or a generation's order names it, the copy on its way). */
export async function agentServed(agentId: string): Promise<boolean> {
  const { records } = await substrate();
  if ((await records.read(agentKey(agentId))).value !== null) return true;
  return agentPlanned(records, agentId);
}

/** Whether the plane has placed an agent nothing has served yet. */
async function agentPlanned(records: Records, agentId: string): Promise<boolean> {
  if ((await copiesOfAgent(records, agentId)).length > 0) return true;
  const { entries } = await records.list(ORDERS_PREFIX);
  return entries.some((entry) => {
    try {
      const order = JSON.parse(entry.value) as {
        launch?: { agentId?: unknown };
        retiredAt?: unknown;
      };
      return order.launch?.agentId === agentId && order.retiredAt === undefined;
    } catch {
      return false;
    }
  });
}

/** The records of the generations' orders, one per generation under its
 * port, written by the controller. */
const ORDERS_PREFIX = 'generations/';

/** Whether a target stands on the plane: served at least once or
 * placed. Asked before the first post and again once the last sight is
 * old. Refused in words, the target unavailable, otherwise. */
async function targetStanding(agentId: string): Promise<void> {
  const seen = seenAgents.get(agentId);
  if (seen !== undefined && Date.now() - seen < LANE_SEEN_MS) return;
  if (!(await agentServed(agentId))) {
    seenAgents.delete(agentId);
    throw new CernantoError({
      kind: 'target-unavailable',
      message: `agent "${agentId}" is not deployed yet; the call retries until it arrives`,
    });
  }
  seenAgents.set(agentId, Date.now());
}

/** The last look at each agent while calls wait on it: every call that
 * waits on an agent shares one look for half the sight's trust. */
const agentLooks = new Map<string, { at: number; standing: Promise<boolean> }>();

/** Whether an agent is still in the directory, as a recent look saw
 * it; a look that could not be made counts as standing. */
function agentStanding(agentId: string): Promise<boolean> {
  const look = agentLooks.get(agentId);
  if (look !== undefined && Date.now() - look.at < LANE_SEEN_MS / 2) return look.standing;
  const standing = agentServed(agentId).catch(() => true);
  agentLooks.set(agentId, { at: Date.now(), standing });
  return standing;
}

/** The failure of a call whose target left the directory: final, so
 * no caller asks it again of the agent deployed again under its id. */
function targetGone(agentId: string): RecordedError {
  seenAgents.delete(agentId);
  return {
    kind: 'terminal',
    message: `agent "${agentId}" is not deployed any more; the call that waited for it is over`,
  };
}

// --- The desk --------------------------------------------------------

/** A word to this copy, as the desk hands it to whoever serves: the
 * ask, and how to answer it. */
export interface Word {
  body: unknown;
  answer: (reply: unknown) => void;
}

/** Who serves the words to this copy. */
type WordServer = (word: Word) => void;

/** A response as it arrived: the outcome as the wire carries it. */
export interface ArrivedResponse {
  outcome: Outcome;
}

/** The journals of this process whose requests the desk acks: the
 * copy's own log and the dead logs it took over. */
const journals = new Set<Journal>();

/** Registers a journal with the desk: a response for a request it sent
 * is recorded in it. */
export function registerJournal(journal: Journal): () => void {
  journals.add(journal);
  // A request sent or a response sent arms the resend: a quiet loop
  // would otherwise never post again what a first post lost.
  const unlisten = journal.onEntry((entry) => {
    if (entry.type === 'request sent' || entry.type === 'response sent') resendLoop.consider();
  });
  resendLoop.consider();
  return () => {
    unlisten();
    journals.delete(journal);
  };
}

/** The journal a request was sent from, when one of this process's
 * holds it. */
function journalOfRequest(request: string): Journal | undefined {
  for (const journal of journals) if (journal.sentOf(request) !== undefined) return journal;
  return undefined;
}

/** The desk of this process: where the responses to every request it
 * sent and the words to it land. A response is recorded in the journal
 * that sent the request (write-ahead: before the post is answered),
 * then handed to the call that waits for it; one for a request no
 * journal here holds and nobody waits for is acked and dropped. */
class ReplyDesk {
  private readonly waiting = new Map<string, (arrived: ArrivedResponse) => void>();
  private onWord: WordServer | undefined;

  words(handler: WordServer | undefined): void {
    this.onWord = handler;
  }

  /** Resolves once this process can be answered: its call server
   * listens. */
  async open(): Promise<void> {
    if ((await ensureCallServer()) !== undefined) return;
    throw new CernantoError({
      kind: 'retryable',
      message:
        'this process has no call server (no call port is free), so no answer could reach it',
    });
  }

  /** A message the road brought to this process's own inbox: a
   * response, or a word to the copy. */
  hand(message: HandedMessage): void {
    if (message.kind === 'word') {
      const handler = this.onWord;
      if (handler === undefined) {
        message.release(1000);
        return;
      }
      const from = message.from;
      const id = message.id;
      try {
        handler({
          body: message.body,
          answer: (reply) => {
            if (from === '') return;
            void postWordAnswer(from, id, reply).catch(() => undefined);
          },
        });
      } catch {
        message.release(1000);
        return;
      }
      message.taken();
      return;
    }
    if (message.kind !== 'answer') {
      message.release();
      return;
    }
    const body = message.body as { outcome?: unknown } | undefined;
    const outcome = outcomeOf(body?.outcome);
    if (outcome === undefined) {
      message.taken();
      return;
    }
    void this.take(message.id, { outcome }).then(
      () => {
        message.taken();
      },
      () => {
        message.release(1000);
      },
    );
  }

  /** A response arrived, by the post or inside a post's answer: the
   * journal that sent the request records the ack, and the call
   * waiting for it is handed the outcome. */
  async take(request: string, arrived: ArrivedResponse): Promise<void> {
    const journal = journalOfRequest(request);
    if (journal !== undefined) {
      crashAt('response ack:before');
      await journal.ackResponse(request, arrived.outcome);
      crashAt('response ack:after');
    }
    const waiter = this.waiting.get(request);
    if (waiter === undefined) return;
    this.waiting.delete(request);
    waiter(arrived);
  }

  /** Waits for the response of one request: the one that names it,
   * when it lands. */
  wait(request: string): { arrived: Promise<ArrivedResponse>; leave: () => void } {
    const hold = holdCallServer();
    let leave: () => void = () => undefined;
    const arrived = new Promise<ArrivedResponse>((resolve) => {
      this.waiting.set(request, (answer) => {
        hold();
        resolve(answer);
      });
      leave = () => {
        hold();
        if (this.waiting.has(request)) this.waiting.delete(request);
      };
    });
    return { arrived, leave };
  }

  /** Whether a call of this process waits for a request's response. */
  waits(request: string): boolean {
    return this.waiting.has(request);
  }
}

const desk = new ReplyDesk();

/** The outcome a value spells, when it spells one. */
function outcomeOf(value: unknown): Outcome | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if ('result' in value) return { result: value.result };
  const error = (value as { error?: unknown }).error;
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { kind?: unknown }).kind === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
    return { error: error as RecordedError };
  // An outcome with no error and no result spelled is a result of
  // nothing: JSON spells an undefined result as no field at all, on the
  // wire and in the log alike.
  if (!('error' in value)) return { result: undefined };
  return undefined;
}

/** Opens this process's desk: its call server listens. */
export async function openDesk(): Promise<void> {
  await desk.open();
}

/** Hands the desk a message the road brought to this process's own
 * inbox: a response, or a word. */
export function deliverToDesk(message: HandedMessage): void {
  desk.hand(message);
}

/** Hands the words to this copy to whoever serves it. */
export function onWord(handler: WordServer | undefined): void {
  desk.words(handler);
}

/** A response that came inside a post's answer (the callee found it
 * standing): taken as one the post brought. */
export function takeResponse(request: string, arrived: ArrivedResponse): Promise<void> {
  return desk.take(request, arrived);
}

/** Waits for the response of a request this process sent: resolves when
 * the desk takes it, or ends with the signal. */
export function awaitResponse(
  request: string,
  signal?: AbortSignal,
): { arrived: Promise<ArrivedResponse>; leave: () => void } {
  const waiting = desk.wait(request);
  if (signal === undefined) return waiting;
  const arrived = untilAborted(waiting.arrived, signal);
  arrived.catch(() => undefined);
  return { arrived, leave: waiting.leave };
}

/** The inbox this process's requests name for their responses: a copy's
 * own, which its record resolves to its call server wherever the copy
 * runs; a process without a copy spells its call server's address into
 * its own, since no record names it. */
export function replyInbox(): string {
  const inbox = ownInbox();
  if (stableInbox(inbox)) return inbox;
  const address = callServerAddress();
  return address === undefined
    ? inbox
    : `${inbox}@${urlHost(address.host)}:${String(address.port)}`;
}

/** The inbox and the address a process without a copy spelled into its
 * own; nothing for a copy's inbox, which its record resolves. */
function spelledAddress(
  name: string,
): { inbox: string; address: { host: string; port: number } } | undefined {
  if (stableInbox(name)) return undefined;
  const at = name.indexOf('@');
  if (at === -1) return undefined;
  const where = name.slice(at + 1);
  const colon = where.lastIndexOf(':');
  if (colon === -1) return undefined;
  const port = Number(where.slice(colon + 1));
  let host = where.slice(0, colon);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!Number.isInteger(port) || host === '') return undefined;
  return { inbox: name.slice(0, at), address: { host, port } };
}

/** The copy a copy's own inbox names, `<service>/<generation>/<n>`. */
function copyOfInbox(name: string): { generation: number; copy: number } | undefined {
  const parts = name.split('/');
  if (parts.length < 3) return undefined;
  const generation = Number(parts[parts.length - 2]);
  const copy = Number(parts[parts.length - 1]);
  if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(copy)) return undefined;
  return { generation, copy };
}

// --- The destination --------------------------------------------------

/** How many asks no copy took before the controller is told of the
 * need, for a target whose live copies do not answer. */
const NEED_AFTER_ROUNDS = 5;

/** The longest pause between two looks for a copy. */
const ASK_PAUSE_MAX_MS = 2000;

/** How often a caller still waiting tells the controller its need
 * again. */
const NEED_RENEW_MS = 60_000;

/** The plane's controller: told what it starts a copy for. */
const CONTROLLER_AGENT = 'cernanto/controller';

/** The host job, on each host: told what happened to a copy there. */
export const HOST_AGENT = 'cernanto/host';

/** The road's patience for one post. */
const POST_TIMEOUT_MS = 5000;

/** Which copy of a target the next choice takes first among several. */
let nextCopy = 0;

/** A live, ready copy of an agent with a call server, as the records
 * hold it. */
interface LiveCopy {
  key: string;
  record: Record<string, unknown>;
  destination: Destination;
  address: { host: string; port: number };
}

/** The copies of an agent, as the records hold them: the directory
 * names the agent's generation (its port), whose copies are one
 * listing; an agent with no directory entry yet has its copies found
 * among every copy's record by the launch each carries, and so has an
 * agent whose every generation is asked for. */
async function copiesOfAgent(
  records: Records,
  agentId: string,
  everyGeneration = false,
): Promise<{ key: string; record: Record<string, unknown> }[]> {
  const entry = everyGeneration ? null : (await records.read(agentKey(agentId))).value;
  let generation: number | undefined;
  if (entry !== null) {
    try {
      const parsed = JSON.parse(entry) as { generation?: unknown; port?: unknown };
      const named = parsed.port ?? parsed.generation;
      if (typeof named === 'number') generation = named;
    } catch {
      generation = undefined;
    }
  }
  const { entries } = await records.list(
    generation === undefined ? COPIES_PREFIX : copiesPrefix(generation),
  );
  const service = serviceNameOf(agentId);
  const sameAgent = (named: unknown): boolean =>
    typeof named === 'string' && serviceNameOf(named) === service;
  const copies: { key: string; record: Record<string, unknown> }[] = [];
  for (const found of entries) {
    try {
      const record = JSON.parse(found.value) as Record<string, unknown>;
      const launch = record['launch'] as { agentId?: unknown } | undefined;
      if (generation !== undefined || sameAgent(launch?.agentId) || sameAgent(record['agentId']))
        copies.push({ key: found.key, record });
    } catch {
      // Not a record.
    }
  }
  return copies;
}

/** Where a copy's call server listens, as its record says. */
function addressOf(record: Record<string, unknown>): { host: string; port: number } | undefined {
  const address = record['address'];
  if (typeof address !== 'object' || address === null || Array.isArray(address)) return undefined;
  const { host, port } = address as { host?: unknown; port?: unknown };
  return typeof host === 'string' && typeof port === 'number' && Number.isInteger(port)
    ? { host, port }
    : undefined;
}

/** The live copies of an agent that can take a post now. */
async function liveCopies(agentId: string, host?: string): Promise<LiveCopy[]> {
  const { records } = await substrate();
  const service = serviceNameOf(agentId);
  const live: LiveCopy[] = [];
  for (const { key, record } of await copiesOfAgent(records, agentId)) {
    if (host !== undefined && hostOfRecord(record) !== host) continue;
    if (record['ready'] !== true || !liveRecord(JSON.stringify(record))) continue;
    // A copy on a host found gone is chosen by nobody, except by a call
    // named to that very host (the host job's words, the block's ring of
    // its serve): the host is gone until its host job takes a word
    // again, and one come back serves on that ring and beats, which
    // clears the mark.
    if (host === undefined && hostFoundGone(record)) continue;
    // A copy told to leave takes no new call: a call is posted to one
    // that stays, or waits for one, never pinned to a copy that will
    // only decline it. A call named to a host reaches the copy there.
    if (host === undefined && recordSaysLeave(record)) continue;
    const address = addressOf(record);
    const named = copyOfKey(key);
    if (address === undefined || named === undefined) continue;
    const life = record['life'];
    live.push({
      key,
      record,
      address,
      destination: {
        service,
        generation: String(named.generation),
        copy: named.copy,
        ...(typeof life === 'string' && life !== '' ? { life } : {}),
      },
    });
  }
  return live;
}

/** The copies on this process's own host when there are any, else all
 * of them: the nearest road first. */
function nearestFirst(copies: LiveCopy[]): LiveCopy[] {
  const facts = processFacts();
  const ownHost = facts.holder?.host ?? facts.host;
  if (ownHost === undefined) return copies;
  const near = copies.filter((copy) => hostOfRecord(copy.record) === ownHost);
  return near.length > 0 ? near : copies;
}

/** Whether a record's host was found gone by the plane: a word of the
 * controller's look on it (`hostGoneAt`), cleared once the host job
 * there beats again. A copy on such a host takes no post; a request pinned
 * to it goes the sibling road at once, as it does once the record is
 * removed. */
function hostFoundGone(record: Record<string, unknown>): boolean {
  return typeof record['hostGoneAt'] === 'number';
}

/** The agent a copy's record names, for the words to the controller:
 * the controller's look matches an agent's orders by its id, which
 * the destination's service name does not spell (`proof/counter` is
 * the service `proof_counter`). The service name when the record
 * names none. */
function agentIdOfRecord(record: Record<string, unknown> | undefined, service: string): string {
  const named = record?.['agentId'];
  if (typeof named === 'string' && named !== '') return named;
  // A slot before its copy's entry names the agent in its launch alone.
  const launched = (record?.['launch'] as { agentId?: unknown } | undefined)?.agentId;
  return typeof launched === 'string' && launched !== '' ? launched : service;
}

/** The agent a service's directory record names (`agents/<service>`,
 * written at a copy's boot), for the need of a service no copy of
 * which stands; the service name when the record names none. */
async function agentIdOfService(records: Records, service: string): Promise<string> {
  const read = await records.read(agentKey(service));
  if (read.value === null) return service;
  try {
    const named = (JSON.parse(read.value) as { agentId?: unknown }).agentId;
    return typeof named === 'string' && named !== '' ? named : service;
  } catch {
    return service;
  }
}

/** The generation and the copy a record's key names. */
function copyOfKey(key: string): { generation: number; copy: number } | undefined {
  const parts = key.split('/');
  const generation = Number(parts[parts.length - 2]);
  const copy = Number(parts[parts.length - 1]);
  if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(copy)) return undefined;
  return { generation, copy };
}

/** A host as a url spells it: an IPv6 address in brackets. */
function urlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/** Chooses the copy a request goes to, before its first send: one of
 * the live copies of the agent (the copy on the named host when one is
 * named), in turn, the copies on this process's own host before any
 * other's: a copy there lives while this process does, so the plane's
 * own roads (the controller's reads of the store and the
 * configuration, whose pass is what finds a host gone) never wait on
 * a host gone. None live: the controller is told the need, and the
 * choice waits for a copy, asked again a little later each time, for
 * as long as the target is deployed and the signal stands. */
export async function chooseDestination(
  agentId: string,
  options: {
    host?: string | undefined;
    signal?: AbortSignal | undefined;
    /** A copy passed over: this process's own, when it hands a request
     * on at its drain. */
    except?: string | undefined;
  } = {},
): Promise<Destination> {
  await targetStanding(agentId);
  let looked = Date.now();
  let needed: number | undefined;
  for (let round = 1; ; round += 1) {
    const live = nearestFirst(
      (await liveCopies(agentId, options.host)).filter(
        (copy) => options.except === undefined || copy.key !== options.except,
      ),
    );
    if (live.length > 0) {
      nextCopy = (nextCopy + 1) % live.length;
      const chosen = live[nextCopy % live.length];
      if (chosen !== undefined) return chosen.destination;
    }
    if (options.host !== undefined && round >= 5)
      throw new CernantoError({
        kind: 'target-unavailable',
        message: `no copy of agent "${agentId}" is placed on host ${options.host}: a call named to a host reaches the copy there alone`,
      });
    if (
      agentId !== CONTROLLER_AGENT &&
      (round >= NEED_AFTER_ROUNDS || live.length === 0) &&
      (needed === undefined || Date.now() - needed >= NEED_RENEW_MS)
    ) {
      needed = Date.now();
      await tellController('need', agentId).catch((error: unknown) => {
        debug(
          '%s: the controller could not be told of the need: %s',
          agentId,
          error instanceof Error ? error.message : String(error),
        );
      });
    }
    await sleepMs(Math.min(100 * 2 ** Math.min(round - 1, 5), ASK_PAUSE_MAX_MS), options.signal);
    if (Date.now() - looked >= LANE_SEEN_MS) {
      looked = Date.now();
      if (!(await agentStanding(agentId))) throw errorFromRecord(targetGone(agentId));
    }
  }
}

// --- The posts ----------------------------------------------------------

/** What a post of a request came to: acked (with the response when one
 * stood), refused in words (the callee serves no such handler: the
 * request's outcome), or not taken (the copy busy, draining, stale,
 * silent), with the pause it asks for. */
type RequestPost =
  | { acked: true; response?: ArrivedResponse | undefined }
  | {
      acked: false;
      refused?: RecordedError | undefined;
      retryInMs?: number | undefined;
      live: boolean;
      /** The copy declined the request in words, having recorded
       * nothing of it: no room, its lane stopped, or draining. A copy
       * that holds the request already hands it over instead, so a
       * decline proves the request was never accepted there. */
      declined?: 'busy' | 'stopped' | 'draining' | undefined;
      /** The post went to a sibling answering for the request's gone
       * destination, not to the destination itself: its decline proves
       * nothing of what the destination's log holds. */
      substitute?: boolean | undefined;
      /** The copy kept the post for room, for as long as its sender
       * said it waits, and had none: the wait was made there. */
      held?: boolean | undefined;
    };

/** Whether a post's decline proves the request was never accepted: the
 * request's own destination declined it. A sibling that declines a
 * request named to a gone copy has not read that copy's log, which may
 * hold the request taken and answered. */
function destinationDeclined(posted: Extract<RequestPost, { acked: false }>): boolean {
  return posted.declined !== undefined && posted.substitute !== true;
}

/** The least a sender waits after a copy declined its post: a copy
 * without room says ask again at once, and a sender asks at a pace. */
const DECLINED_PAUSE_MS = 100;

/** The pause a sender takes after a post that was not acked. */
export function pauseAfter(posted: Extract<RequestPost, { acked: false }>): number {
  const asked = posted.retryInMs ?? 500;
  return Math.min(
    Math.max(asked, posted.declined === undefined ? 0 : DECLINED_PAUSE_MS),
    RESEND_EVERY_MS,
  );
}

/** Another live copy of the agent than the one a declined post named,
 * when one stands: the next pin, moved before the next send. The
 * destination that declined recorded nothing of the request, so another
 * may take it with no duplicate. */
async function anotherCopy(
  agentId: string,
  than: Destination,
  host: string | undefined,
): Promise<Destination | undefined> {
  const key = copyKey(Number(than.generation), than.copy);
  const live = (await liveCopies(agentId, host)).filter((copy) => copy.key !== key);
  if (live.length === 0) return undefined;
  nextCopy = (nextCopy + 1) % live.length;
  return live[nextCopy % live.length]?.destination;
}

/** Posts one message to a call server; a copy is named by its record's
 * key and epoch, so that a stale address refuses it. */
async function postTo(
  address: { host: string; port: number },
  road: '/call' | '/reply',
  key: string | undefined,
  epoch: number | undefined,
  body: unknown,
): Promise<PostAnswer> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== undefined) headers['x-cernanto-key'] = key;
  if (epoch !== undefined) headers['x-cernanto-epoch'] = String(epoch);
  const token = processFacts().callToken;
  if (token !== undefined) headers['x-cernanto-token'] = token;
  const point = road === '/call' ? 'post request' : 'post response';
  const act = faultAt(point);
  if (act === 'drop') return { acked: false };
  if (act === 'delay') await sleepMs(RESEND_EVERY_MS / 2);
  const once = async (): Promise<PostAnswer> => {
    try {
      const response = await fetch(
        `http://${urlHost(address.host)}:${String(address.port)}${road}`,
        {
          method: 'POST',
          headers,
          body: encodeJson(body),
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        },
      );
      const text = await response.text();
      let said: PostAnswer;
      try {
        said = JSON.parse(text) as PostAnswer;
      } catch {
        said = { acked: false };
      }
      if (response.ok && said.acked) {
        debug('%s to %s:%d acked', road, address.host, address.port);
        return said;
      }
      debug(
        '%s to %s:%d not acked %d: %s',
        road,
        address.host,
        address.port,
        response.status,
        text,
      );
      return { ...said, acked: false };
    } catch (error) {
      debug(
        '%s to %s:%d failed: %s',
        road,
        address.host,
        address.port,
        error instanceof Error ? error.message : String(error),
      );
      // A post that failed on the way (the connection refused or cut, a
      // timeout) proves nothing of the earlier posts: the sender keeps
      // its pin, and the copy's record moves when its host finds it gone.
      return { acked: false };
    }
  };
  if (act === 'duplicate') void once();
  return once();
}

/** The message of a request as the road carries it. */
function requestMessage(sent: RequestSent): CallMessage {
  const envelope: CallEnvelope = {
    v: 1,
    request: sent.request,
    callId: callIdOf(sent.request),
    handler: sent.handler,
    args: sent.args,
    to: sent.to,
    ...(sent.caller === undefined
      ? {}
      : {
          caller: {
            agentId: callsAs(sent.caller.agentId),
            callId: sent.caller.callId,
            ...(sent.caller.hostAgentId === undefined
              ? {}
              : { hostAgentId: callsAs(sent.caller.hostAgentId) }),
            ...(sent.caller.hostCallId === undefined ? {} : { hostCallId: sent.caller.hostCallId }),
            ...targetField(sent.caller.agentId),
            ...(sent.caller.story === undefined ? {} : { story: sent.caller.story }),
            ...(sent.caller.charge === undefined ? {} : { charge: sent.caller.charge }),
          },
        }),
    ...(sent.observation === true ? { observation: true } : {}),
    ...(sent.credentials === undefined || sent.credentials.length === 0
      ? {}
      : { credentials: sent.credentials }),
    ...(sent.bound === undefined ? {} : { bound: sent.bound }),
    ...(sent.replyTo === undefined ? {} : { replyTo: sent.replyTo }),
  };
  // The body rides as the kernel's JSON spells it, bytes as base64
  // text: the callee revives every field by the handler's shape.
  const body: unknown = JSON.parse(encodeJson(envelope));
  return {
    id: sent.request,
    kind: 'call',
    call: envelope.callId,
    from: sent.replyTo ?? '',
    body,
  };
}

function callIdOf(request: string): string {
  const at = request.lastIndexOf(':');
  return at === -1 ? request : request.slice(0, at);
}

/** Posts one request to its destination: the copy the record names, at
 * its current address, or, the record gone, to a live sibling of the
 * service, which answers for the gone copy from its log. The message
 * carries the destination either way. `holdMs` says the sender waits at
 * the copy for room, that long at most: a copy with none keeps the post
 * and takes it the moment a slot comes back, where a post that says
 * nothing is declined at once, for its sender to ask another copy. */
export async function postRequest(
  sent: RequestSent,
  options: { holdMs?: number | undefined } = {},
): Promise<RequestPost> {
  const { records } = await substrate();
  const message = requestMessage(sent);
  const key = copyKey(Number(sent.to.generation), sent.to.copy);
  const read = await records.read(key);
  let candidates: LiveCopy[] = [];
  let gone = false;
  if (read.value !== null) {
    let record: Record<string, unknown> | undefined;
    try {
      record = JSON.parse(read.value) as Record<string, unknown>;
    } catch {
      record = undefined;
    }
    // A word to a host job goes to the named host's record whatever the
    // mark on it, and is diverted to no sibling: a gone host fails the
    // posts.
    const toHostJob = sent.to.service === serviceNameOf(HOST_AGENT);
    if (
      record !== undefined &&
      record['state'] !== 'stopped' &&
      (toHostJob || !hostFoundGone(record))
    ) {
      const address = addressOf(record);
      if (address !== undefined && record['ready'] === true && liveRecord(read.value))
        candidates = [{ key, record, address, destination: sent.to }];
      else {
        // The copy stands and is not serving this moment (parked,
        // paused, starting): the controller is told, and the resend
        // finds it serving.
        await tellController('need', agentIdOfRecord(record, sent.to.service)).catch(
          () => undefined,
        );
        return { acked: false, live: false, retryInMs: 1000 };
      }
    } else gone = true;
  } else gone = true;
  if (gone) {
    // The sibling road: a live copy of the service, carrying the
    // destination in the message. A request named to a host stays on
    // it: the copies there alone, whatever mark the host carries, and
    // none there is the host not answering, which the caller's patience
    // reads; a copy on another host never takes a host's own word.
    const service = sent.to.service;
    candidates =
      sent.host === undefined
        ? nearestFirst(await liveCopies(service))
        : await liveCopies(service, sent.host);
    if (candidates.length === 0) {
      if (!(await agentStanding(service)))
        return { acked: false, refused: targetGone(service), live: false };
      await needOnFailedPost(await agentIdOfService(records, service));
      return { acked: false, live: false, retryInMs: 1000 };
    }
    nextCopy = (nextCopy + 1) % candidates.length;
    const chosen = candidates[nextCopy % candidates.length];
    candidates = chosen === undefined ? [] : [chosen];
  }
  for (const candidate of candidates) {
    const epoch = candidate.record['epoch'];
    const answer = await postTo(
      candidate.address,
      '/call',
      candidate.key,
      typeof epoch === 'number' ? epoch : undefined,
      {
        inbox: sent.to.service,
        message,
        ...(options.holdMs === undefined ? {} : { hold: options.holdMs }),
      },
    );
    if (answer.acked) {
      heardAccepted(sent.request, {
        key: candidate.key,
        ...(typeof epoch === 'number' ? { epoch } : {}),
        address: candidate.address,
        destination: candidate.destination,
      });
      const response = answer.response;
      const outcome = response === undefined ? undefined : outcomeOf(response.outcome);
      if (response === undefined || outcome === undefined) return { acked: true };
      return { acked: true, response: { outcome } };
    }
    if (answer.refused !== undefined) return { acked: false, refused: answer.refused, live: true };
    const declined = answer.busy
      ? 'busy'
      : answer.stopped
        ? 'stopped'
        : answer.draining
          ? 'draining'
          : undefined;
    // A post that failed on the way to a copy whose record stands live
    // (nothing answered: the connection refused or cut, the timeout):
    // the copy may be dead, or its host gone, and the plane finds either
    // by the call that fails on it, through the controller's look.
    if (declined === undefined && answer.retryInMs === undefined && answer.stale !== true)
      await needOnFailedPost(agentIdOfRecord(candidate.record, sent.to.service));
    return {
      acked: false,
      retryInMs: answer.retryInMs,
      live: true,
      ...(declined === undefined ? {} : { declined }),
      ...(gone ? { substitute: true } : {}),
      ...(answer.held === true ? { held: true } : {}),
    };
  }
  return { acked: false, live: false };
}

/** The copy that took a request: its record's key and epoch and where
 * its call server listens, what a follower of the call reaches it by. */
interface AcceptedCopy {
  key: string;
  epoch?: number;
  address: { host: string; port: number };
  destination: Destination;
}

/** A call as its acceptance tells it: its id, the id of its request and
 * the copy that took it. */
export interface AcceptedCall {
  callId: string;
  requestId: string;
  copy: { key: string; epoch?: number; address: { host: string; port: number } };
}

/** Tells a caller that asked for it the moment its request is accepted,
 * by any post of it (the destination read at that moment, a plain pin
 * moved meanwhile included); answers the end of the telling. */
export function tellAcceptance(
  sent: RequestSent,
  accepted: ((call: AcceptedCall) => void) | undefined,
): () => void {
  if (accepted === undefined) return () => undefined;
  return onAccepted(sent.request, (copy) => {
    const at = sent.request.lastIndexOf(':');
    const callId = at === -1 ? sent.request : sent.request.slice(0, at);
    accepted({
      callId: `${copy.destination.service}:${copy.destination.generation}:${callId}`,
      requestId: storyOf(copy.destination, sent.request),
      copy: {
        key: copy.key,
        ...(copy.epoch === undefined ? {} : { epoch: copy.epoch }),
        address: copy.address,
      },
    });
  });
}

/** Who hears a request's acceptance, by the request. */
const acceptanceHearers = new Map<string, (copy: AcceptedCopy) => void>();

/** Hears the first ack of any post of a request, the first or a
 * resend's, with the copy that took it; answers the end of the hearing. */
export function onAccepted(request: string, hear: (copy: AcceptedCopy) => void): () => void {
  acceptanceHearers.set(request, hear);
  return () => {
    if (acceptanceHearers.get(request) === hear) acceptanceHearers.delete(request);
  };
}

function heardAccepted(request: string, copy: AcceptedCopy): void {
  const hear = acceptanceHearers.get(request);
  if (hear === undefined) return;
  acceptanceHearers.delete(request);
  hear(copy);
}

/** The message of a response as the road carries it. */
function responseMessage(response: ResponseSent, from: string): CallMessage {
  const body: unknown = JSON.parse(encodeJson({ outcome: response.outcome }));
  return {
    id: response.request,
    kind: 'answer',
    call: callIdOf(response.request),
    from,
    body,
  };
}

/** Posts one response to the inbox the request named: a copy by the
 * address its record names, a process without a copy by the address its
 * inbox spells. Answers whether the caller acked it. */
export async function postResponse(response: ResponseSent): Promise<boolean> {
  const replyTo = response.replyTo;
  if (replyTo === undefined) return true;
  const message = responseMessage(response, ownInbox());
  const spelled = spelledAddress(replyTo);
  if (spelled !== undefined) {
    return (
      await postTo(spelled.address, '/reply', undefined, undefined, {
        inbox: spelled.inbox,
        message,
      })
    ).acked;
  }
  return postToCopy(replyTo, '/reply', { inbox: replyTo, message });
}

/** Posts a message to a copy by its own inbox's name, at the address
 * its record names: the copy refuses it when its record moved on. */
async function postToCopy(
  copyInbox: string,
  road: '/call' | '/reply',
  body: unknown,
): Promise<boolean> {
  const copy = copyOfInbox(copyInbox);
  if (copy === undefined) return false;
  const { records } = await substrate();
  const key = copyKey(copy.generation, copy.copy);
  const read = await records.read(key);
  if (read.value === null) return false;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(read.value) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (record['state'] === 'parked' || record['park'] === true) return false;
  const address = addressOf(record);
  if (address === undefined) return false;
  const epoch = record['epoch'];
  return (await postTo(address, road, key, typeof epoch === 'number' ? epoch : undefined, body))
    .acked;
}

/** Posts a word's answer to the process that asked. */
function postWordAnswer(inboxName: string, id: string, reply: unknown): Promise<boolean> {
  const message: CallMessage = {
    id,
    kind: 'answer',
    call: id,
    from: ownInbox(),
    body: JSON.parse(encodeJson({ outcome: { result: reply } })),
  };
  const spelled = spelledAddress(inboxName);
  if (spelled !== undefined)
    return postTo(spelled.address, '/reply', undefined, undefined, {
      inbox: spelled.inbox,
      message,
    }).then((answer) => answer.acked);
  return postToCopy(inboxName, '/reply', { inbox: inboxName, message });
}

/** Hands a request that reached a copy which does not hold its log to
 * the live copy that does, by that copy's inbox. Answers the holder's
 * answer to the post. */
export async function forwardRequest(
  holderInbox: string,
  message: CallMessage,
): Promise<PostAnswer> {
  const copy = copyOfInbox(holderInbox);
  if (copy === undefined) return { acked: false };
  const { records } = await substrate();
  const key = copyKey(copy.generation, copy.copy);
  const read = await records.read(key);
  if (read.value === null) return { acked: false };
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(read.value) as Record<string, unknown>;
  } catch {
    return { acked: false };
  }
  const address = addressOf(record);
  if (address === undefined) return { acked: false };
  const epoch = record['epoch'];
  const service = serviceNameOf(holderInbox.split('/').slice(0, -2).join('/'));
  return postTo(address, '/call', key, typeof epoch === 'number' ? epoch : undefined, {
    inbox: service,
    message,
  });
}

/** The inboxes of the live, ready copies of an agent, every generation
 * of it: where a word to the agent goes. */
export async function liveCopyInboxes(agentId: string): Promise<string[]> {
  const { records } = await substrate();
  const service = serviceNameOf(agentId);
  const inboxes: string[] = [];
  for (const { key, record } of await copiesOfAgent(records, agentId, true)) {
    if (record['ready'] !== true || !liveRecord(JSON.stringify(record))) continue;
    const named = copyOfKey(key);
    if (named !== undefined)
      inboxes.push(`${service}/${String(named.generation)}/${String(named.copy)}`);
  }
  return inboxes;
}

// --- The resend ------------------------------------------------------------

/** THE RESEND: every ten seconds while anything stands unacked in a
 * journal of this process, every unacked request is posted to its
 * destination and every owed response to its caller; a plane at rest
 * ticks nothing. */
class ResendLoop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  /** Posts what is unacked now, not at the next tick: asked after a
   * resume took a tail in. */
  now(): void {
    void this.tickNow();
  }

  /** One tick now, awaited: a drain posts what it owes before the
   * process leaves. Nothing while a tick runs already. */
  async tickNow(): Promise<void> {
    if (this.running || substrateClosed()) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.tick();
  }

  /** Looks at the journals: a tick is armed when anything is unacked. */
  consider(): void {
    if (this.timer !== undefined || substrateClosed()) return;
    if (!this.anythingUnacked()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, RESEND_EVERY_MS);
    this.timer.unref();
  }

  private anythingUnacked(): boolean {
    const now = Date.now();
    for (const journal of journals) {
      const { requests, responses } = journal.unacked(now);
      if (requests.length > 0 || responses.length > 0) return true;
    }
    return false;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      for (const journal of [...journals]) {
        const { requests, responses } = journal.unacked(now);
        for (const sent of requests) {
          if (substrateClosed()) return;
          await this.resendRequest(journal, sent);
        }
        for (const response of responses) {
          if (substrateClosed()) return;
          if (await postResponse(response).catch(() => false))
            journal.noteResponseAcked(response.request);
        }
      }
    } finally {
      this.running = false;
      this.consider();
    }
  }

  private async resendRequest(journal: Journal, sent: RequestSent): Promise<void> {
    let posted: RequestPost;
    try {
      posted = await postRequest(sent);
    } catch (error) {
      debug(
        '%s: the resend failed: %s',
        sent.request,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (posted.acked) {
      if (posted.response !== undefined)
        await takeResponse(sent.request, posted.response).catch(() => undefined);
      else if (sent.replyTo === undefined)
        await takeAccepted(journal, sent.request).catch(() => undefined);
      return;
    }
    const refused = posted.refused ?? leavingDecline(posted, sent);
    if (refused !== undefined)
      await takeResponse(sent.request, { outcome: { error: refused } }).catch(() => undefined);
  }
}

const resendLoop = new ResendLoop();

/** A publish's acceptance: the callee acked the request nobody waits
 * for, and the caller's journal records the completion. */
async function takeAccepted(journal: Journal, request: string): Promise<void> {
  await journal.ackResponse(request, { accepted: true });
}

/** Wakes the resend: something was written that may need resending. */
export function considerResend(): void {
  resendLoop.consider();
}

/** Posts every unacked request and owed response now. */
export function resendNow(): void {
  resendLoop.now();
}

/** Posts every owed response and unacked request now, and answers once
 * the posts were made. */
export function postOwedNow(): Promise<void> {
  return resendLoop.tickNow();
}

// --- The plain roads ------------------------------------------------------

/** One request from a process without a journal (a tool, the cli
 * through the gateway, a proof, the host job's words): kept in memory,
 * posted and posted again every ten seconds until the response comes,
 * by the post's answer or by the desk. The signal ends the wait. */
export async function wireRequest(options: {
  agentId: string;
  handler: string;
  args: unknown;
  callId: string;
  identity?: CallIdentity | undefined;
  signal?: AbortSignal | undefined;
  /** The host the call was named to: the copy of the agent on that
   * host alone takes it. */
  host?: string | undefined;
  /** Told the moment the call is accepted. */
  accepted?: ((call: AcceptedCall) => void) | undefined;
  /** Told the request once, as the copy that took it was posted it: by
   * the first post it acked, else by its answer. */
  taken?: ((sent: RequestSent) => void) | undefined;
}): Promise<WireReply> {
  await desk.open();
  const request = requestIdFor(options.callId);
  const identity = options.identity;
  const to = await chooseDestination(options.agentId, {
    host: options.host,
    signal: options.signal,
  });
  const sent: RequestSent = {
    request,
    parent: 'plain',
    ordinal: 0,
    to,
    ...(options.host === undefined ? {} : { host: options.host }),
    handler: options.handler,
    args: options.args,
    replyTo: replyInbox(),
    ...(identity === undefined
      ? {}
      : {
          caller: {
            agentId: identity.agentId,
            callId: identity.callId,
            ...(identity.hostAgentId === undefined ? {} : { hostAgentId: identity.hostAgentId }),
            ...(identity.hostCallId === undefined ? {} : { hostCallId: identity.hostCallId }),
            ...(identity.target === undefined ? {} : { target: identity.target }),
            ...(identity.story === undefined ? {} : { story: identity.story }),
            ...(identity.charge === undefined ? {} : { charge: identity.charge }),
          },
          ...(identity.observation === true ? { observation: true } : {}),
          ...(identity.credentials === undefined || identity.credentials.length === 0
            ? {}
            : { credentials: identity.credentials }),
          ...(identity.bound === undefined ? {} : { bound: identity.bound }),
        }),
    at: Date.now(),
  };
  const waiting = awaitResponse(request, options.signal);
  const hearing = tellAcceptance(sent, options.accepted);
  try {
    let looked = Date.now();
    // The posts a host-named call found nobody answering: a connection
    // refused or cut, a timeout. A decline in words (busy, draining,
    // stopped) is the host answering, and counts for none.
    let silent = 0;
    // Whether a copy took the request: told once, of the copy it was
    // posted to then; a refusal is no taking.
    let took = false;
    let refused = false;
    const told = (): void => {
      if (took || refused) return;
      took = true;
      options.taken?.(sent);
    };
    for (let round = 1; ; round += 1) {
      const posted = await postRequest(sent);
      if (!posted.acked && posted.refused === undefined && posted.declined === undefined)
        silent += 1;
      if (posted.acked) told();
      if (posted.acked && posted.response !== undefined) {
        await takeResponse(request, posted.response);
      } else if (!posted.acked && posted.refused !== undefined) {
        refused = true;
        await takeResponse(request, { outcome: { error: posted.refused } });
      } else if (!posted.acked && options.host !== undefined && silent >= 5) {
        throw new CernantoError({
          kind: 'target-unavailable',
          message: `the copy of agent "${options.agentId}" on host ${options.host} does not take the call ${options.handler}: its host does not answer`,
        });
      } else if (!posted.acked && destinationDeclined(posted)) {
        // The destination declined and recorded nothing: the next post
        // goes to another live copy when one stands, the pin moved
        // before it. A sibling's decline for a gone destination moves
        // nothing: the next post takes the sibling road again.
        const other = await anotherCopy(options.agentId, sent.to, options.host).catch(
          () => undefined,
        );
        if (other !== undefined) sent.to = other;
      }
      const arrived = await Promise.race([
        waiting.arrived,
        sleepMs(posted.acked ? RESEND_EVERY_MS : pauseAfter(posted), options.signal).then(
          () => undefined,
        ),
      ]);
      if (arrived !== undefined) {
        // An answer that came by the desk alone is the request's taking.
        told();
        return {
          ...replyOf(arrived.outcome),
          generation: sent.to.generation,
          story: storyOf(sent.to, request),
        };
      }
      if (Date.now() - looked >= LANE_SEEN_MS) {
        looked = Date.now();
        if (!(await agentStanding(options.agentId)))
          throw errorFromRecord(targetGone(options.agentId));
      }
    }
  } finally {
    hearing();
    waiting.leave();
  }
}

function replyOf(outcome: Outcome): WireReply {
  return 'error' in outcome ? { error: outcome.error } : { result: outcome.result };
}

/** One request nobody waits for, from a process without a journal:
 * posted until a copy acks it. */
export async function wireStart(options: {
  agentId: string;
  handler: string;
  args: unknown;
  callId: string;
  identity?: CallIdentity | undefined;
  host?: string | undefined;
  signal?: AbortSignal | undefined;
  /** Told the request once a copy acked it, as it was posted to that
   * copy. */
  taken?: ((sent: RequestSent) => void) | undefined;
}): Promise<void> {
  const to = await chooseDestination(options.agentId, {
    host: options.host,
    signal: options.signal,
  });
  const identity = options.identity;
  const sent: RequestSent = {
    request: requestIdFor(options.callId),
    parent: 'plain',
    ordinal: 0,
    to,
    ...(options.host === undefined ? {} : { host: options.host }),
    handler: options.handler,
    args: options.args,
    ...(identity === undefined
      ? {}
      : {
          caller: {
            agentId: identity.agentId,
            callId: identity.callId,
            ...(identity.target === undefined ? {} : { target: identity.target }),
            ...(identity.story === undefined ? {} : { story: identity.story }),
            ...(identity.charge === undefined ? {} : { charge: identity.charge }),
          },
        }),
    at: Date.now(),
  };
  for (let round = 1; ; round += 1) {
    const posted = await postRequest(sent);
    if (posted.acked) {
      options.taken?.(sent);
      return;
    }
    if (posted.refused !== undefined) throw errorFromRecord(posted.refused);
    if (destinationDeclined(posted)) {
      const other = await anotherCopy(options.agentId, sent.to, options.host).catch(
        () => undefined,
      );
      if (other !== undefined) sent.to = other;
    }
    await sleepMs(pauseAfter(posted), options.signal);
    if (round % 10 === 0 && !(await agentStanding(options.agentId)))
      throw errorFromRecord(targetGone(options.agentId));
  }
}

/** Tells the host job of a host that something happened to a copy
 * there: one call of its function, named to the host. Answers whether
 * the host job took it. */
export async function tellHostJob(host: string, handler: string, args: unknown): Promise<boolean> {
  const reply = await wireRequest({
    agentId: HOST_AGENT,
    handler,
    args,
    callId: `c-${freshUUID()}`,
    host,
  });
  return !('error' in reply);
}

/** Tells the controller something it runs a pass for: the `need` of an
 * agent no copy of which takes a call, a copy ready, a copy gone. One
 * post nobody waits for, to a live copy of the controller; answers
 * whether one acked it (none is live at a plane's bring-up). */
export async function tellController(handler: string, args: unknown): Promise<boolean> {
  // Every live copy of the controller is tried until one acks, this
  // host's first: a copy's record stands live on a host that is gone
  // (stopped, paused) until the plane finds the host so, and a word
  // posted to that copy alone would reach nobody while the live copies
  // wait for it.
  const facts = processFacts();
  const ownHost = facts.holder?.host ?? facts.host;
  const live = (await liveCopies(CONTROLLER_AGENT)).sort((a, b) => {
    const aOwn = hostOfRecord(a.record) === ownHost ? 0 : 1;
    const bOwn = hostOfRecord(b.record) === ownHost ? 0 : 1;
    return aOwn - bOwn;
  });
  for (const chosen of live) {
    const sent: RequestSent = {
      request: requestIdFor(`c-${freshUUID()}`),
      parent: 'plain',
      ordinal: 0,
      to: chosen.destination,
      handler,
      args,
      at: Date.now(),
    };
    const epoch = chosen.record['epoch'];
    const answer = await postTo(
      chosen.address,
      '/call',
      chosen.key,
      typeof epoch === 'number' ? epoch : undefined,
      { inbox: serviceNameOf(CONTROLLER_AGENT), message: requestMessage(sent) },
    );
    if (answer.acked) return true;
  }
  return false;
}

/** When each agent's need was last told to the controller for a post
 * that failed on the way: told at once the first time, and again after
 * a while, so a dead copy or a gone host is found by the call that
 * fails on it and the resends do not storm the controller. */
const needsToldAt = new Map<string, number>();

/** Tells the controller the need of a service whose copy took no post:
 * the controller looks at the copies (each host's host job told
 * `start` for its record), and a host job finds a dead copy or takes no
 * word on a host that is gone. */
async function needOnFailedPost(agentId: string): Promise<void> {
  const now = Date.now();
  const told = needsToldAt.get(agentId);
  if (told !== undefined && now - told < NEED_RENEW_MS) return;
  needsToldAt.set(agentId, now);
  await tellController('need', agentId).catch(() => undefined);
}

/** A wire reply as the caller's error or value. */
export function unwrapReply(reply: WireReply): unknown {
  if ('error' in reply) throw errorFromRecord(reply.error);
  return reply.result;
}

/** Asks a copy to act on a call it holds (a cancellation): a word
 * posted to that copy, answered at this process's call server. The
 * answer is done when the copy says so, and not when the copy does not
 * answer in time. */
export async function control(
  holder: { inbox: string } | undefined,
  request: { operation: 'cancel' | 'kill'; callId: string },
): Promise<{ done: boolean }> {
  if (holder === undefined) return { done: false };
  await desk.open();
  const id = `word:${request.operation}:${request.callId}:${freshUUID().slice(0, 8)}`;
  const waiting = desk.wait(id);
  const timeout = new AbortController();
  try {
    const message: CallMessage = {
      id,
      kind: 'word',
      call: id,
      from: replyInbox(),
      body: request,
    };
    const spelled = spelledAddress(holder.inbox);
    const posted =
      spelled !== undefined
        ? (
            await postTo(spelled.address, '/reply', undefined, undefined, {
              inbox: spelled.inbox,
              message,
            })
          ).acked
        : await postToCopy(holder.inbox, '/reply', { inbox: holder.inbox, message });
    if (!posted) {
      waiting.leave();
      return { done: false };
    }
    const arrived = await Promise.race([
      waiting.arrived,
      sleepMs(CONTROL_WAIT_MS, timeout.signal).then(() => undefined),
    ]);
    if (arrived === undefined) {
      waiting.leave();
      return { done: false };
    }
    const said = arrived.outcome;
    return { done: 'result' in said && (said.result as { done?: unknown }).done === true };
  } finally {
    timeout.abort();
  }
}

/** Whether a copy's record tells the copy to leave: a drain, or a stop
 * word that stands for the attempt it runs (a word naming no attempt
 * and said before the launch stops nobody, as the copy reads it). Such
 * a copy takes no new call. */
function recordSaysLeave(record: Record<string, unknown>): boolean {
  if (record['draining'] === true) return true;
  const stop = record['stop'];
  if (stop === undefined || stop === false || stop === null) return false;
  const word =
    typeof stop === 'object' && !Array.isArray(stop)
      ? (stop as { attempt?: unknown; at?: unknown })
      : {};
  const launched = record['process'] as { attempt?: unknown; at?: unknown } | undefined;
  if (word.attempt !== undefined) return word.attempt === launched?.attempt;
  return !(
    typeof word.at === 'number' &&
    typeof launched?.at === 'number' &&
    word.at < launched.at
  );
}

/** A journaled request its pinned copy declined because the copy is
 * leaving: it recorded nothing of the request and never will take it,
 * so the request is answered that it is asked again, which closes the
 * pair, and the code's next attempt chooses a copy afresh. A busy copy
 * takes it once it has room, and keeps it. A sibling that declines a
 * request named to a gone copy proves nothing of that copy's log: the
 * request stays pending and its resend takes the sibling road again. */
export function leavingDecline(posted: RequestPost, sent: RequestSent): RecordedError | undefined {
  if (
    posted.acked ||
    !destinationDeclined(posted) ||
    (posted.declined !== 'draining' && posted.declined !== 'stopped')
  )
    return undefined;
  return {
    kind: 'retryable',
    message: `the copy ${String(sent.to.copy)} of ${sent.to.service}/${sent.to.generation} is leaving and took no call; the call is asked again of another`,
  };
}

/** Whether a copy's record says the copy is live: not parked and not
 * stopped by its own word, with a process named on it (the host job's
 * launch) or its own entry ready (a proof's copy, placed by nobody). */
function liveRecord(value: string): boolean {
  try {
    const record = JSON.parse(value) as {
      state?: unknown;
      park?: unknown;
      process?: unknown;
      ready?: unknown;
    };
    if (record.state === 'parked' || record.state === 'stopped' || record.park === true)
      return false;
    return record.process !== undefined || record.ready === true;
  } catch {
    return false;
  }
}

/** The inbox of the live copy of a service whose process runs under an
 * attempt, when one does: the holder of a dead log, read off the copies'
 * records (the entry's attempt, or the launcher's on the process). */
export async function liveCopyByAttempt(
  service: string,
  attempt: string,
): Promise<string | undefined> {
  const { records } = await substrate();
  for (const { key, record } of await copiesOfAgent(records, service, true)) {
    if (record['ready'] !== true || !liveRecord(JSON.stringify(record))) continue;
    // A copy on a host the plane found gone holds nothing a request
    // can be handed to: its log is taken over instead.
    if (hostFoundGone(record)) continue;
    const launched = record['process'] as { attempt?: unknown } | undefined;
    if (record['attempt'] !== attempt && launched?.attempt !== attempt) continue;
    const named = copyOfKey(key);
    if (named !== undefined) return `${service}/${String(named.generation)}/${String(named.copy)}`;
  }
  return undefined;
}
