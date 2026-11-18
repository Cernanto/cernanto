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
// five minutes; each copy is posted to by itself, so one that is silent
// holds back nothing owed to another. A destination whose record is gone is answered for by a
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
import { wallElapsedMs } from './clock.js';
import { callServerAddress, ensureCallServer, holdCallServer } from './call-server.js';
import type { CallMessage, HandedMessage, PostAnswer } from './call-server.js';
import { encodeJson } from './json.js';
import type { CallEnvelope } from './envelope.js';
import { RESEND_EVERY_MS, callIdOfRequest, failureIn, logNameOf, requestIdFor } from './log.js';
import type {
  Destination,
  Outcome,
  RecordedError,
  RequestSent,
  ResponseAck,
  ResponseSent,
} from './log.js';
import { errorFromRecord } from './journal.js';
import type { Journal } from './journal.js';
import { COPIES_PREFIX, agentKey, copyKey, lifeKey, lifeOfRecord } from './substrate.js';
import {
  agentOfCopy,
  hostFoundGone,
  lifeOfCopy,
  readCopyRecord,
  saysLeave,
  saysServing,
} from './copy-record.js';
import type { CopyRead } from './copy-record.js';
import {
  CONTROLLER_AGENT,
  HAND_ON_HANDLER,
  HOST_AGENT,
  ORDERS_PREFIX,
  SEAM,
  handOnAsked,
} from './seam.js';
import type { OrderRecord, SeamFunction } from './seam.js';
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

// --- Deployed, and of one life ---------------------------------------
//
// An id is used again, a life never: a delete and a deploy put another
// agent under the same id. So an agent is DEPLOYED when its name's
// record names a life and an order that stands, or a copy's record,
// names the agent under that life; and A CALL IS OF ONE LIFE, fixed at
// its first look and matched at every choice of a copy after it. No
// life continues another.

/** How long a call that waits goes between two looks at whether its
 * agent is still deployed under its life. */
const LANE_SEEN_MS = 15_000;

/** A copy's record as a listing found it, under its key. */
interface CopyFound {
  key: string;
  record: CopyRead;
}

/** One listing of every copy's record: each agent's copies under its
 * service's name, in the order of their keys. */
type CopiesByAgent = Map<string, CopyFound[]>;

/** The listing that has not begun yet, and the one under way. A copy's
 * record names its generation and never its agent in its key, so an
 * agent's copies are found among every copy's record, and every choice
 * of a copy reads them all. EVERY CHOICE IS MADE ON A LISTING THAT
 * BEGAN AFTER IT WAS ASKED, so a copy that came to serve is seen by
 * the very next choice; and the choices that wait at the same moment
 * share one: whoever asks while a listing runs waits for the next,
 * with everyone else who asked meanwhile. */
let listingNext: { of: Records; found: Promise<CopiesByAgent> } | undefined;
let listingUnderWay: Promise<void> = Promise.resolve();

/** Every copy's record, by a listing that begins after this ask. */
function readCopies(records: Records): Promise<CopiesByAgent> {
  if (listingNext?.of === records) return listingNext.found;
  const waited = listingUnderWay;
  const mine: { of: Records; found: Promise<CopiesByAgent> } = {
    of: records,
    found: waited.then(async () => {
      if (listingNext === mine) listingNext = undefined;
      const { entries } = await records.list(COPIES_PREFIX);
      const copies: CopiesByAgent = new Map();
      for (const entry of entries) {
        const record = readCopyRecord(entry.value);
        if (record === undefined) continue;
        // A record names its agent in its entry, in its launch, or in
        // both: it is found under each service's name it spells.
        const services = new Set<string>();
        for (const named of [record.launch?.agentId, record.agentId])
          if (named !== undefined) services.add(serviceNameOf(named));
        for (const service of services) {
          const of = copies.get(service);
          if (of === undefined) copies.set(service, [{ key: entry.key, record }]);
          else of.push({ key: entry.key, record });
        }
      }
      return copies;
    }),
  };
  listingNext = mine;
  listingUnderWay = mine.found.then(
    () => undefined,
    () => undefined,
  );
  return mine.found;
}

/** The copies of an agent, as the records hold them now. */
async function copiesOfAgent(records: Records, agentId: string): Promise<CopyFound[]> {
  return (await readCopies(records)).get(serviceNameOf(agentId)) ?? [];
}

/** The life an agent is deployed under, given its copies as one listing
 * found them, or nothing: the life its name's record names, when a copy's
 * record or an order that stands names the agent under it. One of
 * either that names no life counts for the life that stands. The copies
 * are read first, which every choice of a copy lists anyway, and the
 * orders only where no copy names the agent. */
async function deployedAmong(
  records: Records,
  agentId: string,
  copies: readonly { record: CopyRead }[],
): Promise<string | undefined> {
  const service = serviceNameOf(agentId);
  const standing = lifeOfRecord((await records.read(lifeKey(service))).value);
  if (standing === undefined) return undefined;
  const under = (named: string | undefined): boolean => named === undefined || named === standing;
  if (copies.some(({ record }) => under(lifeOfCopy(record)))) return standing;
  // An order names its agent by its id, and a request its service: the
  // one spells the other, so either finds the order.
  const { entries } = await records.list(ORDERS_PREFIX);
  const ordered = entries.some((entry) => {
    try {
      const order = JSON.parse(entry.value) as OrderRecord;
      const named = order.launch?.agentId;
      const life = order.launch?.life;
      return (
        typeof named === 'string' &&
        serviceNameOf(named) === service &&
        order.retiredAt === undefined &&
        under(typeof life === 'string' && life !== '' ? life : undefined)
      );
    } catch {
      return false;
    }
  });
  return ordered ? standing : undefined;
}

/** The life an agent is deployed under, or nothing when it is not
 * deployed: a module, which has a life and neither an order nor a copy,
 * is not, and neither is an id whose orders and copies are of a life
 * its name no longer stands under. */
export async function deployedLife(agentId: string): Promise<string | undefined> {
  const { records } = await substrate();
  return deployedAmong(records, agentId, await copiesOfAgent(records, agentId));
}

/** Whether an agent is deployed. */
export async function agentDeployed(agentId: string): Promise<boolean> {
  return (await deployedLife(agentId)) !== undefined;
}

/** The last look at each agent while calls wait on it: every call that
 * waits on an agent shares one look for half the time between two. The
 * time between two looks, here and for a call that waits, is time that
 * passed: counted on the monotonic clock, from a mark taken on it. */
const agentLooks = new Map<
  string,
  { at: number; found: Promise<{ life: string | undefined } | undefined> }
>();

/** Whether an agent is still deployed under a life, as a recent look
 * saw it: not when no life stands, or another does. A request that
 * names no life asks whether the agent is deployed at all, and a look
 * that could not be made counts as standing. */
async function stillDeployed(agentId: string, life: string | undefined): Promise<boolean> {
  let look = agentLooks.get(agentId);
  if (look === undefined || wallElapsedMs() - look.at >= LANE_SEEN_MS / 2) {
    look = {
      at: wallElapsedMs(),
      found: deployedLife(agentId).then(
        (found) => ({ life: found }),
        () => undefined,
      ),
    };
    agentLooks.set(agentId, look);
  }
  const found = await look.found;
  if (found === undefined) return true;
  return life === undefined ? found.life !== undefined : found.life === life;
}

/** The failure of a call whose agent is no longer deployed under the
 * call's life: final, so no caller asks it again of the agent deployed
 * again under its id. */
function targetGone(agentId: string): RecordedError {
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
    void this.take(message.id, outcome).then(
      () => {
        message.taken();
      },
      () => {
        message.release(1000);
      },
    );
  }

  /** The end of a request this process sent, as a post of the response
   * or the answer to a post of the request brought it: the journal that
   * sent the request records it under the request, and the call that
   * waits for an answer is handed the outcome. Nobody waits for a
   * publish's end: its record is all of it. */
  async take(request: string, end: ResponseAck['outcome']): Promise<void> {
    const journal = journalOfRequest(request);
    if (journal !== undefined) {
      crashAt('response ack:before');
      await journal.ackResponse(request, end);
      crashAt('response ack:after');
    }
    if ('accepted' in end) return;
    const waiter = this.waiting.get(request);
    if (waiter === undefined) return;
    this.waiting.delete(request);
    waiter({ outcome: end });
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

/** Takes the end a post brought of a request this process sent, as the
 * desk takes one a response's own post brought: recorded by the one
 * writer, whichever post heard it. */
export function takeEnd(request: string, end: ResponseAck['outcome']): Promise<void> {
  return desk.take(request, end);
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

// --- The destination --------------------------------------------------

/** The longest pause between two looks for a copy. */
const ASK_PAUSE_MAX_MS = 2000;

/** How often a caller still waiting tells the controller its need
 * again. */
const NEED_RENEW_MS = 60_000;

/** The road's patience for one post. */
const POST_TIMEOUT_MS = 5000;

/** A live, ready copy of an agent with a call server, as the records
 * hold it. */
interface LiveCopy {
  key: string;
  record: CopyRead;
  destination: Destination;
  address: { host: string; port: number };
}

/** The copies among an agent's that can take a post now: on the host
 * named, when one is, and of the life named, when one is (a copy whose
 * record names no life counts for it). */
function liveAmong(
  copies: readonly { key: string; record: CopyRead }[],
  service: string,
  host: string | undefined,
  life: string | undefined,
): LiveCopy[] {
  const live: LiveCopy[] = [];
  for (const { key, record } of copies) {
    if (host !== undefined && record.host !== host) continue;
    if (!saysServing(record)) continue;
    const ofLife = lifeOfCopy(record);
    if (life !== undefined && ofLife !== undefined && ofLife !== life) continue;
    // A copy on a host found gone is chosen by nobody, except by a call
    // named to that very host (the host job's words, the block's ring of
    // its serve): the host is gone until its host job takes a word
    // again, and one come back serves on that ring and beats, which
    // clears the mark.
    if (host === undefined && hostFoundGone(record)) continue;
    // A copy told to leave takes no new call: a call is posted to one
    // that stays, or waits for one, never pinned to a copy that will
    // only decline it. A call named to a host reaches the copy there.
    if (host === undefined && saysLeave(record)) continue;
    const { address } = record;
    const named = copyOfKey(key);
    if (address === undefined || named === undefined) continue;
    // The request names the life it is of: the call's when it is of
    // one, else the copy's own.
    const names = life ?? record.life;
    live.push({
      key,
      record,
      address,
      destination: {
        service,
        generation: String(named.generation),
        copy: named.copy,
        ...(names === undefined ? {} : { life: names }),
      },
    });
  }
  return live;
}

/** The live copies of an agent that can take a post now, of a life when
 * one is named, as the records hold them now. */
async function liveCopies(agentId: string, host?: string, life?: string): Promise<LiveCopy[]> {
  const { records } = await substrate();
  return liveAmong(await copiesOfAgent(records, agentId), serviceNameOf(agentId), host, life);
}

/** ONE LIVE COPY OF AN AGENT, CHOSEN FOR A POST: among the agent's
 * copies that can take a post now, as the records hold them, and that
 * may take what this post asks, narrowed and ordered as its asker says
 * (this host's first, one passed over), in the agent's turn. Nothing
 * when none can. */
async function chooseLive(
  records: Records,
  agentId: string,
  options: {
    host?: string | undefined;
    life?: string | undefined;
    among?: ((live: LiveCopy[]) => LiveCopy[]) | undefined;
    /** What the post asks, when the choice depends on it. */
    asked?: Asked | undefined;
    /** The agent's copies as its asker read them for this choice. */
    copies?: readonly CopyFound[] | undefined;
  } = {},
): Promise<LiveCopy | undefined> {
  const service = serviceNameOf(agentId);
  const takes = takersOf(options.asked);
  const copies = options.copies ?? (await copiesOfAgent(records, agentId));
  const taking = liveAmong(copies, service, options.host, options.life).filter((copy) =>
    takes(copy.key),
  );
  const live = options.among === undefined ? taking : options.among(taking);
  if (live.length === 0) return undefined;
  const turn = ((turns.get(service) ?? 0) + 1) % live.length;
  turns.set(service, turn);
  return live[turn];
}

/** What a post asks of its agent: the function and its arguments. */
interface Asked {
  handler: string;
  args?: unknown;
}

/** WHOSE TURN IT IS among each agent's copies: the place last taken,
 * by the agent's service name. One count for each agent, so the calls
 * to an agent go round its copies whatever is called between them. */
const turns = new Map<string, number>();

/** The copies that may take what a post asks. Any copy may take a call
 * of its agent's own function. THE HAND-ON IS ASKED OF A COPY THAT CAN
 * TAKE IT, never of a copy it hands on, which is gone whatever its
 * record still says of it: the logs of a whole generation go to a copy
 * of another, and the log of the one dead copy it names with its owner
 * goes to a sibling of that copy's own generation, under whose code its
 * unfinished calls run on. */
function takersOf(asked: Asked | undefined): (key: string) => boolean {
  const on = asked?.handler === HAND_ON_HANDLER ? handOnAsked(asked.args) : undefined;
  if (on === undefined) return () => true;
  return (key) => {
    const named = copyOfKey(key);
    if (named === undefined) return false;
    const sibling = String(named.generation) === on.generation;
    return on.copy === undefined ? !sibling : sibling && named.copy !== on.copy;
  };
}

/** The copies on this process's own host when there are any, else all
 * of them: the nearest road first. */
function nearestFirst(copies: LiveCopy[]): LiveCopy[] {
  const facts = processFacts();
  const ownHost = facts.holder?.host ?? facts.host;
  if (ownHost === undefined) return copies;
  const near = copies.filter((copy) => copy.record.host === ownHost);
  return near.length > 0 ? near : copies;
}

/** The agent a copy's record names, for the words to the controller:
 * the controller's look matches an agent's orders by its id, which
 * the destination's service name does not spell (`proof/counter` is
 * the service `proof_counter`). The service name when the record
 * names none. */
function agentIdOfRecord(record: CopyRead | undefined, service: string): string {
  return agentOfCopy(record) ?? service;
}

/** The agent a service's directory record names (`agents/<service>`,
 * written at a copy's boot), the one thing the directory still says:
 * for the need of a service no copy of which stands, and for the words
 * a request of such a service ends in; the service name when the
 * record names none. */
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

/** The generation and the copy a name ends with: a copy's record key,
 * `copies/<generation>/<n>`, and a copy's own inbox,
 * `<service>/<generation>/<n>`. */
function copyOfKey(key: string): { generation: number; copy: number } | undefined {
  const parts = key.split('/');
  if (parts.length < 3) return undefined;
  const generation = Number(parts[parts.length - 2]);
  const copy = Number(parts[parts.length - 1]);
  if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(copy)) return undefined;
  return { generation, copy };
}

/** A host as a url spells it: an IPv6 address in brackets. */
function urlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/** Chooses the copy a request goes to, before its first send. THE FIRST
 * LOOK fixes the call's life: the life the agent is deployed under
 * then, and an agent that is not deployed fails the attempt in the
 * missing target's words, which its caller tries again. Every choice is
 * among the live copies of that life (the copy on the named host when
 * one is named), in turn, the copies on this process's own host before
 * any other's: a copy there lives while this process does, so the
 * plane's own roads (the controller's reads of the store and the
 * configuration, whose pass is what finds a host gone) never wait on a
 * host gone. None live: the controller is told the need, and the
 * choice waits for a copy, asked again a little later each time, for as
 * long as the agent is deployed under that life and the signal stands.
 * The destination names the life. */
export async function chooseDestination(
  agentId: string,
  options: {
    host?: string | undefined;
    signal?: AbortSignal | undefined;
    /** A copy passed over: this process's own, when it hands a request
     * on at its drain. */
    except?: string | undefined;
    /** The life the request is of already: a service that hands a
     * request on at its drain chooses among the copies of its own. */
    life?: string | undefined;
    /** What the request asks: a hand-on is pinned to no copy it hands
     * on. */
    asked?: Asked | undefined;
  } = {},
): Promise<Destination> {
  const { records } = await substrate();
  let life = options.life;
  let looked = wallElapsedMs();
  let needed: number | undefined;
  for (let round = 1; ; round += 1) {
    const copies = await copiesOfAgent(records, agentId);
    if (life === undefined) {
      life = await deployedAmong(records, agentId, copies);
      if (life === undefined)
        throw new CernantoError({
          kind: 'target-unavailable',
          message: `agent "${agentId}" is not deployed yet; the call retries until it arrives`,
        });
    }
    const chosen = await chooseLive(records, agentId, {
      host: options.host,
      life,
      among: (live) =>
        nearestFirst(
          live.filter((copy) => options.except === undefined || copy.key !== options.except),
        ),
      asked: options.asked,
      copies,
    });
    if (chosen !== undefined) return chosen.destination;
    if (options.host !== undefined && round >= 5)
      throw new CernantoError({
        kind: 'target-unavailable',
        message: `no copy of agent "${agentId}" is placed on host ${options.host}: a call named to a host reaches the copy there alone`,
      });
    if (
      agentId !== CONTROLLER_AGENT &&
      (needed === undefined || wallElapsedMs() - needed >= NEED_RENEW_MS)
    ) {
      needed = wallElapsedMs();
      await tellController(SEAM.controller.need, agentId).catch((error: unknown) => {
        debug(
          '%s: the controller could not be told of the need: %s',
          agentId,
          error instanceof Error ? error.message : String(error),
        );
      });
    }
    await sleepMs(Math.min(100 * 2 ** Math.min(round - 1, 5), ASK_PAUSE_MAX_MS), options.signal);
    if (wallElapsedMs() - looked >= LANE_SEEN_MS) {
      looked = wallElapsedMs();
      if (!(await stillDeployed(agentId, life))) throw errorFromRecord(targetGone(agentId));
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

/** The pause a sender takes after a post that ended nothing: the
 * resend's period once a copy took the request, whose answer comes by
 * the desk, and else what the copy asked for. */
export function pauseAfter(posted: RequestPost): number {
  if (posted.acked) return RESEND_EVERY_MS;
  const asked = posted.retryInMs ?? 500;
  return Math.min(
    Math.max(asked, posted.declined === undefined ? 0 : DECLINED_PAUSE_MS),
    RESEND_EVERY_MS,
  );
}

/** WHAT A POST BROUGHT OF ITS REQUEST'S END, read one way by every
 * sender of a request: its first post and the resend, a call's and a
 * publish's, a process that keeps no log and a copy that hands a call
 * on at its drain. The answer is what completes the request, as its
 * record carries it, or nothing while the request stands and is posted
 * again.
 *
 * A copy acked it. A call that waits ends with the response that stood
 * beside the ack, and goes on waiting for its answer when none did. A
 * publish ends there, taken, whatever stood beside the ack: nobody
 * waits for its answer, and what becomes of a publish a copy took is
 * the callee's side to see to (a copy that ends one at its drain as
 * replaced hands the call on first), so that word read as the
 * publish's own end would publish a second time what a copy took.
 *
 * No copy takes it, in words: the agent serves no such handler, or is
 * no longer deployed under the call's life. The request ends with the
 * refusal.
 *
 * Its own destination is leaving and recorded nothing of it. A request
 * `pinned` in a log cannot move, so it ends as asked again, which
 * closes the pair, and the code's next attempt chooses a copy afresh;
 * a sender that keeps no log moves its pin and posts again. A busy
 * copy takes the request once it has room, and a sibling that declines
 * a request named to a gone copy proves nothing of that copy's log:
 * either way the request stands. */
export function endOfPost(
  posted: RequestPost,
  sent: RequestSent,
  pinned: boolean,
): ResponseAck['outcome'] | undefined {
  const waits = sent.replyTo !== undefined;
  if (posted.acked) return waits ? posted.response?.outcome : { accepted: true };
  const refused = posted.refused ?? (pinned ? leavingDecline(posted, sent) : undefined);
  if (refused === undefined) return undefined;
  return waits ? { error: refused } : { accepted: false, error: refused };
}

/** What a request pinned in a log is refused with when its own
 * destination declined it because the copy is leaving: the copy
 * recorded nothing of the request and never will take it, so the
 * request is asked again of another. */
function leavingDecline(
  posted: Extract<RequestPost, { acked: false }>,
  sent: RequestSent,
): RecordedError | undefined {
  if (
    !destinationDeclined(posted) ||
    (posted.declined !== 'draining' && posted.declined !== 'stopped')
  )
    return undefined;
  return {
    kind: 'retryable',
    message: `the copy ${String(sent.to.copy)} of ${sent.to.service}/${sent.to.generation} is leaving and took no call; the call is asked again of another`,
  };
}

/** Another live copy of the agent than the one a declined post named,
 * of the request's own life, when one stands: the next pin, moved
 * before the next send. The destination that declined recorded nothing
 * of the request, so another may take it with no duplicate. */
async function anotherCopy(
  agentId: string,
  than: Destination,
  host: string | undefined,
  asked: Asked,
): Promise<Destination | undefined> {
  const key = copyKey(Number(than.generation), than.copy);
  const { records } = await substrate();
  const other = await chooseLive(records, agentId, {
    host,
    life: than.life,
    among: (live) => live.filter((copy) => copy.key !== key),
    asked,
  });
  return other?.destination;
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
    callId: callIdOfRequest(sent.request),
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
    const record = readCopyRecord(read.value);
    // A word to a host job goes to the named host's record whatever the
    // mark on it, and is diverted to no sibling: a gone host fails the
    // posts.
    const toHostJob = sent.to.service === serviceNameOf(HOST_AGENT);
    if (
      record !== undefined &&
      record.state !== 'stopped' &&
      (toHostJob || !hostFoundGone(record))
    ) {
      const { address } = record;
      if (address !== undefined && saysServing(record))
        candidates = [{ key, record, address, destination: sent.to }];
      else {
        // The copy stands and is not serving this moment (parked,
        // paused, starting): the controller is told, and the resend
        // finds it serving.
        await tellController(SEAM.controller.need, agentIdOfRecord(record, sent.to.service)).catch(
          () => undefined,
        );
        return { acked: false, live: false, retryInMs: 1000 };
      }
    } else gone = true;
  } else gone = true;
  if (gone) {
    // The sibling road: a live copy of the service, of the request's
    // own life, carrying the destination in the message. A request
    // named to a host stays on it: the copies there alone, whatever
    // mark the host carries, and none there is the host not answering,
    // which the caller's patience reads; a copy on another host never
    // takes a host's own word.
    const service = sent.to.service;
    const chosen = await chooseLive(records, service, {
      host: sent.host,
      life: sent.to.life,
      among: sent.host === undefined ? nearestFirst : undefined,
      asked: sent,
    });
    if (chosen === undefined) {
      if (!(await stillDeployed(service, sent.to.life)))
        return {
          acked: false,
          refused: targetGone(await agentIdOfService(records, service)),
          live: false,
        };
      await needOnFailedPost(await agentIdOfService(records, service));
      return { acked: false, live: false, retryInMs: 1000 };
    }
    candidates = [chosen];
  }
  for (const candidate of candidates) {
    const { epoch } = candidate.record;
    const answer = await postTo(candidate.address, '/call', candidate.key, epoch, {
      inbox: sent.to.service,
      message,
      ...(options.holdMs === undefined ? {} : { hold: options.holdMs }),
    });
    if (answer.acked) {
      heardAccepted(sent.request, {
        key: candidate.key,
        ...(epoch === undefined ? {} : { epoch }),
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
    const callId = callIdOfRequest(sent.request);
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
    call: callIdOfRequest(response.request),
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
  const copy = copyOfKey(copyInbox);
  if (copy === undefined) return false;
  const { records } = await substrate();
  const key = copyKey(copy.generation, copy.copy);
  const record = readCopyRecord((await records.read(key)).value);
  if (record === undefined) return false;
  if (record.state === 'parked' || record.park === true) return false;
  if (record.address === undefined) return false;
  return (await postTo(record.address, road, key, record.epoch, body)).acked;
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
  const copy = copyOfKey(holderInbox);
  if (copy === undefined) return { acked: false };
  const { records } = await substrate();
  const key = copyKey(copy.generation, copy.copy);
  const record = readCopyRecord((await records.read(key)).value);
  if (record?.address === undefined) return { acked: false };
  const service = serviceNameOf(holderInbox.split('/').slice(0, -2).join('/'));
  return postTo(record.address, '/call', key, record.epoch, { inbox: service, message });
}

/** The inboxes of the live, ready copies of an agent, every generation
 * of it: where a word to the agent goes. */
export async function liveCopyInboxes(agentId: string): Promise<string[]> {
  const { records } = await substrate();
  const service = serviceNameOf(agentId);
  const inboxes: string[] = [];
  for (const { key, record } of await copiesOfAgent(records, agentId)) {
    if (!saysServing(record)) continue;
    const named = copyOfKey(key);
    if (named !== undefined)
      inboxes.push(`${service}/${String(named.generation)}/${String(named.copy)}`);
  }
  return inboxes;
}

// --- The resend ------------------------------------------------------------

/** How many copies a round of the resend posts to side by side. */
const RESEND_SIDE_BY_SIDE = 16;

/** THE RESEND: every ten seconds while anything stands unacked in a
 * journal of this process, a round posts every unacked request to its
 * destination and every owed response to its caller; a plane at rest
 * ticks nothing. EACH COPY IS POSTED TO BY ITSELF: what is owed to one
 * copy, requests and responses, goes to it in turn, and the copies are
 * posted to side by side, sixteen at a time, so the silence of one is
 * the wait of no other. A copy that took nothing of one post is asked
 * nothing more that round, since what else is owed to it would meet
 * the same silence, each post for the road's whole patience; and the
 * copies that took nothing in the round before are posted to after the
 * others. A record is read again at the moment of its post: one acked
 * since the round began is posted no more. */
class ResendLoop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The round under way. */
  private round: Promise<void> | undefined;
  /** The copies that took nothing in the round before. */
  private silent = new Set<string>();

  /** Posts what is unacked now, not at the next tick: asked after a
   * resume took a tail in. */
  now(): void {
    void this.tickNow().catch(() => undefined);
  }

  /** One round now, awaited: a drain posts what it owes before the
   * process leaves. A round under way is waited for first, since it
   * began before whatever is owed now was written. */
  async tickNow(): Promise<void> {
    if (substrateClosed()) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const under = this.round;
    if (under !== undefined) await under.catch(() => undefined);
    if (substrateClosed()) return;
    await this.tick();
  }

  /** Looks at the journals: a tick is armed when anything is unacked. */
  consider(): void {
    if (this.timer !== undefined || substrateClosed()) return;
    if (!this.anythingUnacked()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().catch(() => undefined);
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

  /** The round under way, or a new one. */
  private tick(): Promise<void> {
    if (this.round !== undefined) return this.round;
    const round = this.post().finally(() => {
      this.round = undefined;
      this.consider();
    });
    this.round = round;
    return round;
  }

  /** One round: what is unacked now, by the copy it is owed to. */
  private async post(): Promise<void> {
    const now = Date.now();
    const owed = new Map<string, (() => Promise<boolean>)[]>();
    const to = (copy: string): (() => Promise<boolean>)[] => {
      let posts = owed.get(copy);
      if (posts === undefined) {
        posts = [];
        owed.set(copy, posts);
      }
      return posts;
    };
    for (const journal of [...journals]) {
      const { requests, responses } = journal.unacked(now);
      for (const sent of requests)
        to(logNameOf(sent.to)).push(() => this.resendRequest(journal, sent));
      for (const response of responses)
        to(response.replyTo ?? '').push(() => this.resendResponse(journal, response));
    }
    const before = this.silent;
    const copies = [...owed.keys()].sort((a, b) => Number(before.has(a)) - Number(before.has(b)));
    const silent = new Set<string>();
    let next = 0;
    const lane = async (): Promise<void> => {
      for (;;) {
        const copy = copies[next];
        next += 1;
        if (copy === undefined) return;
        for (const post of owed.get(copy) ?? []) {
          if (substrateClosed()) return;
          if (await post()) continue;
          silent.add(copy);
          break;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(RESEND_SIDE_BY_SIDE, copies.length) }, () => lane()),
    );
    this.silent = silent;
  }

  /** Posts one unacked request again. Answers whether its copy took
   * the post: acked it, refused it or declined it in words. */
  private async resendRequest(journal: Journal, sent: RequestSent): Promise<boolean> {
    if (!journal.requestUnacked(sent.request)) return true;
    let posted: RequestPost;
    try {
      posted = await postRequest(sent);
    } catch (error) {
      debug(
        '%s: the resend failed: %s',
        sent.request,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
    const end = endOfPost(posted, sent, true);
    if (end === undefined) return posted.acked || posted.declined !== undefined;
    await takeEnd(sent.request, end).catch(() => undefined);
    return true;
  }

  /** Posts one owed response again. Answers whether its caller took
   * it. */
  private async resendResponse(journal: Journal, response: ResponseSent): Promise<boolean> {
    if (!journal.responseOwed(response.request)) return true;
    const acked = await postResponse(response).catch(() => false);
    if (acked) journal.noteResponseAcked(response.request);
    return acked;
  }
}

const resendLoop = new ResendLoop();

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
    asked: options,
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
    let looked = wallElapsedMs();
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
      const end = endOfPost(posted, sent, false);
      if (posted.acked) told();
      else if (end === undefined && posted.declined === undefined) silent += 1;
      if (end !== undefined) {
        if (!posted.acked) refused = true;
        await takeEnd(request, end);
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
        const other = await anotherCopy(options.agentId, sent.to, options.host, options).catch(
          () => undefined,
        );
        if (other !== undefined) sent.to = other;
      }
      const arrived = await Promise.race([
        waiting.arrived,
        sleepMs(pauseAfter(posted), options.signal).then(() => undefined),
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
      if (wallElapsedMs() - looked >= LANE_SEEN_MS) {
        looked = wallElapsedMs();
        if (!(await stillDeployed(options.agentId, sent.to.life)))
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
    asked: options,
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
    const end = endOfPost(posted, sent, false);
    if (end !== undefined) {
      const refused = failureIn(end);
      if (refused !== undefined) throw errorFromRecord(refused);
      options.taken?.(sent);
      return;
    }
    if (!posted.acked && destinationDeclined(posted)) {
      const other = await anotherCopy(options.agentId, sent.to, options.host, options).catch(
        () => undefined,
      );
      if (other !== undefined) sent.to = other;
    }
    await sleepMs(pauseAfter(posted), options.signal);
    if (round % 10 === 0 && !(await stillDeployed(options.agentId, sent.to.life)))
      throw errorFromRecord(targetGone(options.agentId));
  }
}

/** Tells the host job of a host that something happened to a copy
 * there: one call of its function, named to the host, sent as the
 * seam's entry types it. Answers whether the host job took it. */
export async function tellHostJob<Sends>(
  host: string,
  entry: SeamFunction<Sends, unknown>,
  sends: Sends,
): Promise<boolean> {
  const reply = await wireRequest({
    agentId: entry.agentId,
    handler: entry.handler,
    args: sends,
    callId: `c-${freshUUID()}`,
    host,
  });
  return !('error' in reply);
}

/** Tells the controller something it runs a pass for: the `need` of an
 * agent no copy of which takes a call, a copy ready, a copy gone, sent
 * as the seam's entry types it. One post nobody waits for, to a live
 * copy of the controller; answers whether one acked it (none is live at
 * a plane's bring-up). */
export async function tellController<Sends>(
  entry: SeamFunction<Sends, unknown>,
  sends: Sends,
): Promise<boolean> {
  const { handler } = entry;
  const args: unknown = sends;
  // Every live copy of the controller is tried until one acks, this
  // host's first: a copy's record stands live on a host that is gone
  // (stopped, paused) until the plane finds the host so, and a word
  // posted to that copy alone would reach nobody while the live copies
  // wait for it.
  const facts = processFacts();
  const ownHost = facts.holder?.host ?? facts.host;
  const live = (await liveCopies(CONTROLLER_AGENT)).sort((a, b) => {
    const aOwn = a.record.host === ownHost ? 0 : 1;
    const bOwn = b.record.host === ownHost ? 0 : 1;
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
    const answer = await postTo(chosen.address, '/call', chosen.key, chosen.record.epoch, {
      inbox: serviceNameOf(CONTROLLER_AGENT),
      message: requestMessage(sent),
    });
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
  const now = wallElapsedMs();
  const told = needsToldAt.get(agentId);
  if (told !== undefined && now - told < NEED_RENEW_MS) return;
  needsToldAt.set(agentId, now);
  await tellController(SEAM.controller.need, agentId).catch(() => undefined);
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
  request: { operation: 'cancel'; callId: string },
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

/** The inbox of the live copy of a service whose process runs under an
 * attempt, when one does: the holder of a dead log, read off the copies'
 * records (the entry's attempt, or the launcher's on the process). */
export async function liveCopyByAttempt(
  service: string,
  attempt: string,
): Promise<string | undefined> {
  const { records } = await substrate();
  for (const { key, record } of await copiesOfAgent(records, service)) {
    if (!saysServing(record)) continue;
    // A copy on a host the plane found gone holds nothing a request
    // can be handed to: its log is taken over instead.
    if (hostFoundGone(record)) continue;
    if (record.attempt !== attempt && record.process?.attempt !== attempt) continue;
    const named = copyOfKey(key);
    if (named !== undefined) return `${service}/${String(named.generation)}/${String(named.copy)}`;
  }
  return undefined;
}
