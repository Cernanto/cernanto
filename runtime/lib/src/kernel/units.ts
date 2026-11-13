// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The one served agent of a process and what every road of it shares:
// its own log and the dead logs it took over, the bodies in flight, its
// lanes (the service's calls, taken while there is room) and the
// requests as the call server hands them over.

import { freshUUID } from './entropy.js';

import { debuglog } from 'node:util';

import { admissionState, isDraining, onRoom } from './admission.js';
import { outsideExecution } from './execution.js';
import { serviceNameOf } from '../language/naming.js';
import { ownInbox, substrateClosed } from './connection.js';
import { CallLifetime } from './lifetime.js';
import { recordedError } from './journal.js';
import type { Journal } from './journal.js';
import type { RecordedError } from './log.js';
import { callParentOf } from './envelope.js';
import { sayEntry } from './copy-entry.js';
import type { HandedMessage } from './call-server.js';
import type { HandlerFn } from '../language/handler-types.js';
import type { Definition } from '../language/core.js';
import type { WireReply } from './transport.js';
import type { CallEnvelope } from './envelope.js';
import type { ProgramUnit } from './program.js';

const debug = debuglog('cernanto-transport');

/** The recorded shape of a terminal failure, its kind spelled the way
 * every reader of an answer expects. */
export function failureRecord(error: unknown): RecordedError {
  const recorded = recordedError(error);
  if (error instanceof Error && error.name === 'ZodError') {
    return { ...recorded, kind: 'contract-violation' };
  }
  return recorded;
}

/** A request as an incoming post handed it to this process: the post's
 * message, answered once the process came to its word on it. */
export interface PostedCall {
  /** The request's id. */
  readonly id: string;
  /** The inbox the caller waits in; empty for a request nobody waits
   * for. */
  readonly from: string;
  /** The post is acked: the request is taken here (its ack durable),
   * or was taken before, with its response when one stands. */
  confirm(response?: { outcome: unknown }): void;
  /** The post is refused in words: the request's outcome, which the
   * caller records. */
  refuse(error: RecordedError): void;
  /** The post is not acked: this process cannot take the request now,
   * and its caller posts it again after the pause. */
  giveBack(delayMs?: number): void;
}

/** The call a post handed to a lane; `decided` is told once the
 * process came to its word on the post, whichever. */
function postedCallOf(message: HandedMessage, decided: () => void = () => undefined): PostedCall {
  let settled = false;
  return {
    id: message.id,
    from: message.from,
    confirm: (response) => {
      if (settled) return;
      settled = true;
      message.taken(response);
      decided();
    },
    refuse: (error) => {
      if (settled) return;
      settled = true;
      message.refuse(error);
      decided();
    },
    giveBack: (delayMs) => {
      if (settled) return;
      settled = true;
      message.release(delayMs);
      decided();
    },
  };
}

/** Whether the process leaves: it drains, or its substrate is closed
 * for good. Nothing is asked of the substrate again from here. */
export function processLeaves(): boolean {
  return isDraining() || substrateClosed();
}

/** The context field naming the call this one is a child of, when
 * there is one. */
export function callParentField(envelope: { caller?: CallEnvelope['caller'] }): {
  callParentId?: string;
} {
  const parent = callParentOf(envelope);
  return parent === undefined ? {} : { callParentId: parent };
}

/** The backoff before the next attempt of a retryably failed
 * call, capped like the substrate's own handler backoff. */
export function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** Math.max(0, attempt - 1), 30_000);
}

/** The handlers a definition names itself, each under its own name: a
 * name the object only inherits (`constructor`, `toString`) is no
 * handler, and neither is a member that is no function. */
function ownHandlers(handlers: object): Record<string, HandlerFn> {
  const own = Object.create(null) as Record<string, HandlerFn>;
  for (const [name, fn] of Object.entries(handlers)) {
    if (typeof fn === 'function') own[name] = fn as HandlerFn;
  }
  return own;
}

/** How many calls a unit holds in flight at most, at work or waiting:
 * the whole bound of a process that names no slots (a fixture), and the
 * bound over the slots of one that does, whose calls that only wait
 * hold no slot. */
const UNBOUNDED_CALLS_IN_HAND = 1024;

/** The lanes waiting for room: slots are the process's, so a slot that
 * comes back in one unit is room for every unit's lane. */
const roomWaiters: (() => void)[] = [];

export function noteRoom(): void {
  for (const wake of roomWaiters.splice(0)) wake();
}
// A slot comes back at a call's end and at its wait for another agent's
// answer: either is room for a lane.
onRoom(noteRoom);

/** One served agent: its logs, its lanes and its bodies in flight. */
export class ServedUnit {
  readonly agentId: string;
  readonly service: string;
  readonly definition: Definition;
  /** The handlers as the wire calls them: each hands unknown. */
  readonly handlers: Record<string, HandlerFn>;
  readonly generation: string;
  /** This process's own inbox: where the responses to its requests and
   * the words to it land, and the name of its log. */
  readonly inbox: string;
  /** This life of the process: a name of its own for each boot. */
  readonly life = freshUUID();
  /** The copy's own log, opened at boot. */
  journal: Journal | undefined;
  /** The dead logs this process took over (a gone sibling's, a retired
   * generation's), by name. */
  readonly taken = new Map<string, Journal>();
  /** The bodies in this process's keeping, by request: each with its
   * log and what lets it go. */
  readonly bodies = new Map<string, { log: string; end: () => void }>();
  readonly cancelled = new Set<string>();
  readonly owners = new Map<string, CallLifetime>();
  /** A worker's run: the request it runs under once this process
   * started it or found it, and whether it is over. */
  runRequest: string | undefined;
  readonly runsEnded = new Set<string>();
  /** The process's end once a worker's run is over, its exit code the
   * run's; boot hands it the drain. */
  endProcess: ((code: number) => void) | undefined;
  /** The service's calls, taken while this process serves, let go at
   * its drain. */
  lane: CallLane | undefined;
  /** The lane of the calls named to this copy's host, which this copy
   * alone takes. */
  hostLane: CallLane | undefined;
  /** The working folder of this process, when the serve call names
   * one. */
  readonly workingDir: string | undefined;
  /** The requests taken whose body has not been given a slot yet. */
  readonly starting = new Set<string>();
  /** The program of a service unit, when it has one. */
  program: ProgramUnit | undefined;

  constructor(
    agentId: string,
    definition: Definition,
    generation: string,
    serving: { workingDir: string | undefined },
  ) {
    this.agentId = agentId;
    this.workingDir = serving.workingDir;
    this.service = serviceNameOf(agentId);
    this.definition = definition;
    this.handlers = ownHandlers(definition.handlers);
    this.generation = generation;
    this.inbox = ownInbox();
  }

  /** Every journal this process holds: its own and the taken ones. */
  openJournals(): Journal[] {
    return [...(this.journal === undefined ? [] : [this.journal]), ...this.taken.values()];
  }

  /** The journal a log's name names here, own or taken. */
  journalOf(log: string): Journal | undefined {
    if (this.journal?.log === log) return this.journal;
    return this.taken.get(log);
  }

  /** The journal that took a request, own or taken. */
  journalOfTaken(request: string): Journal | undefined {
    for (const journal of this.openJournals())
      if (journal.takenOf(request) !== undefined) return journal;
    return undefined;
  }

  /** A worker's run is over for good: the copy's record says the exit
   * code and, once the caller says so, the process ends with it. */
  runEnded(request: string, reply: WireReply): number {
    this.runsEnded.add(request);
    const code = 'error' in reply ? 1 : 0;
    sayEntry({ exitCode: code });
    return code;
  }

  /** Resolves once this unit may take one more call. */
  whenRoom(): Promise<void> {
    if (this.hasRoom()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      roomWaiters.push(() => {
        void this.whenRoom().then(resolve);
      });
    });
  }

  /** Whether there is room for one more call beside the bodies in
   * flight, the ones starting and `pending` more the lane has handed
   * over and nothing has registered yet. */
  /** Whether a request's ack stands in a log this process holds: its
   * own, or a dead sibling's taken over. */
  holdsRequest(request: string): boolean {
    // A take on its way, or one the log did not confirm, holds the
    // request too: never declined, so its sender pins nowhere else.
    if (this.starting.has(request)) return true;
    if (this.journal?.takenOf(request) !== undefined) return true;
    for (const journal of this.taken.values())
      if (journal.takenOf(request) !== undefined) return true;
    return false;
  }

  hasRoom(pending = 0): boolean {
    const { slots, inFlight, waiting } = admissionState();
    if (slots > 0) {
      // The slots count the calls at work: a call that only waits for
      // another agent's answer holds none, so a copy whose calls all
      // wait still takes the call that answers them. Every call in
      // flight counts against the whole bound.
      const held = inFlight + this.starting.size + pending;
      return held - waiting < slots && held < UNBOUNDED_CALLS_IN_HAND;
    }
    return this.bodies.size + pending < UNBOUNDED_CALLS_IN_HAND;
  }

  /** A body leaves this process's keeping: answered, or let go. */
  letGo(request: string): void {
    const held = this.bodies.get(request);
    this.bodies.delete(request);
    held?.end();
    this.starting.delete(request);
    noteRoom();
  }

  /** Takes or leaves the service's calls: on while this process serves,
   * off at its drain. */
  setServing(on: boolean): void {
    if (on) {
      this.lane?.start();
      this.hostLane?.start();
    } else {
      this.lane?.stop();
      this.hostLane?.stop();
    }
  }
}

/** What a lane came to on a call a post handed it: handed over, busy
 * (no room for one more call), or stopped (the copy takes no calls). */
export type Handing = 'handed' | 'busy' | 'stopped';

/** A post a lane keeps for room: what it comes to (`left` when its
 * sender went before the lane decided, and nothing was taken), whether
 * the lane kept it at all, and the sender's leaving. */
export interface KeptPost {
  handing: Promise<Handing | 'left'>;
  kept: boolean;
  leave(): void;
}

/** Takes the calls the call server is posted for one inbox name (the
 * service's own, or the calls named to the copy's host), only while
 * there is room: `room` says whether the unit may take one more beside
 * the calls this lane handed over and nothing has registered yet;
 * `handle` is handed each call, and what it returns is awaited before
 * the call counts as registered. A post whose sender waits for room is
 * kept in the lane's line and handed over the moment a slot comes
 * back. */
export class CallLane {
  private stopped = true;
  private readonly inboxName: string;
  private readonly room: { has(pending: number): boolean; holds?(id: string): boolean };
  private readonly handle: (message: PostedCall, handed: HandedMessage) => Promise<void> | void;
  /** The requests handed over whose handling has not settled, each
   * with how many holds it has: a post of a request handed already is
   * handed too, and its settling leaves the first's hold standing, so
   * the request stays held until its own acceptance is decided. Room
   * is kept for them. */
  private readonly handing = new Map<string, number>();
  /** THE LINE: the posts kept for room, in the order they came. Nothing
   * of them is recorded; each is handed over when the lane has room for
   * it, declined when its sender's patience ends first, and dropped
   * when its sender goes. */
  private readonly line: { id: string; hand: () => void }[] = [];
  /** Whether the lane waits to hear of the next slot that comes back. */
  private watching = false;
  /** Whether the line is being gone through now. */
  private sweeping = false;

  constructor(
    inboxName: string,
    room: { has(pending: number): boolean; holds?(id: string): boolean },
    handle: (message: PostedCall, handed: HandedMessage) => Promise<void> | void,
  ) {
    this.inboxName = inboxName;
    this.room = room;
    this.handle = handle;
  }

  /** The inbox name this lane takes. */
  get inbox(): string {
    return this.inboxName;
  }

  start(): void {
    this.stopped = false;
  }

  /** Hands this process a request a post brought, under the lane's own
   * rule of room: handed when there is room, and let go (its caller
   * posts again, here or at another copy) when there is none or the
   * lane is stopped. The handling is the kernel's own: it runs outside
   * any execution. A request this process holds already is handed over
   * too: the handler answers it from its log, taken. */
  handDirect(message: HandedMessage): Handing {
    // A request this process holds already (its ack in a log of this
    // process's, or on its way there) is handed over whatever the room,
    // the drain or the lane's stop: the handler answers it from the
    // log, a duplicate post shares the first's decision, and a decline
    // from here proves the request was never accepted here, so its
    // sender may pin elsewhere with no duplicate.
    const held = this.room.holds?.(message.id) === true || this.handing.has(message.id);
    if (!held && (this.stopped || isDraining())) {
      message.release(1000);
      return 'stopped';
    }
    if (!held && !this.room.has(this.handing.size)) {
      const { inFlight, waiting, slots } = admissionState();
      debug(
        '%s: no room for %s: %d in flight, %d of them waiting, %d handed, %d slots',
        this.inboxName,
        message.id,
        inFlight,
        waiting,
        this.handing.size,
        slots,
      );
      message.release(0);
      return 'busy';
    }
    this.handing.set(message.id, (this.handing.get(message.id) ?? 0) + 1);
    // This hold lets go once: when the post is decided, or when its
    // handling ends, whichever comes first.
    let holding = true;
    const letGo = (): void => {
      if (!holding) return;
      holding = false;
      const hands = (this.handing.get(message.id) ?? 1) - 1;
      if (hands <= 0) this.handing.delete(message.id);
      else this.handing.set(message.id, hands);
      // A hold that ends is room no slot's return tells of: the line
      // looks again, on a turn of its own.
      if (this.line.length > 0)
        queueMicrotask(() => {
          this.roomCame();
        });
    };
    const stored = postedCallOf(message, letGo);
    outsideExecution(() => {
      void Promise.resolve(this.handle(stored, message))
        .catch(() => undefined)
        .finally(letGo);
    });
    return 'handed';
  }

  /** Whether a post of this request would be declined for room now: a
   * request this process holds already is handed over whatever the
   * room, and a lane that takes no calls declines in its own words. */
  private full(id: string): boolean {
    if (this.room.holds?.(id) === true || this.handing.has(id)) return false;
    if (this.stopped || isDraining()) return false;
    return !this.room.has(this.handing.size);
  }

  /** Hands over a request whose sender waits here for room. With room,
   * or for a request held already, it is handed over at once, as
   * `handDirect` hands it. With none it is KEPT in the lane's line,
   * behind the posts kept before it, nothing of it recorded: handed
   * over the moment a slot comes back and its turn has come; declined
   * as busy when `holdMs` passes first, having been kept; let go in the
   * lane's own words when the lane stops; and dropped, never taken,
   * when its sender leaves. A sender that waits here hears of a slot
   * when it comes back, where one that is declined and asks again at a
   * pace finds it only at its next ask, long after the calls that held
   * the slots ended. */
  keepForRoom(message: HandedMessage, holdMs: number): KeptPost {
    // The posts kept before this one come first.
    this.roomCame();
    if (!this.full(message.id) || this.line.length >= UNBOUNDED_CALLS_IN_HAND) {
      return {
        handing: Promise.resolve(this.handDirect(message)),
        kept: false,
        leave: () => undefined,
      };
    }
    let settle: (handing: Handing | 'left') => void = () => undefined;
    const handing = new Promise<Handing | 'left'>((resolve) => {
      settle = resolve;
    });
    const entry = { id: message.id, hand: (): void => undefined };
    const wait: { open: boolean; patience?: ReturnType<typeof setTimeout> } = { open: true };
    const end = (left: boolean): void => {
      if (!wait.open) return;
      wait.open = false;
      clearTimeout(wait.patience);
      const at = this.line.indexOf(entry);
      if (at !== -1) this.line.splice(at, 1);
      settle(left ? 'left' : this.handDirect(message));
    };
    entry.hand = (): void => {
      end(false);
    };
    // The sender's patience: the post is declined as busy at its end,
    // unless room came at that very moment.
    wait.patience = setTimeout(() => {
      end(false);
    }, holdMs);
    this.line.push(entry);
    this.watchRoom();
    return {
      handing,
      kept: true,
      leave: () => {
        end(true);
      },
    };
  }

  /** Room may have come back: the kept posts are handed over in the
   * order they came, for as long as there is room. A lane that takes
   * no calls any more lets each go in its own words. */
  private roomCame(): void {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (;;) {
        const head = this.line[0];
        if (head === undefined || this.full(head.id)) break;
        head.hand();
      }
    } finally {
      this.sweeping = false;
    }
    this.watchRoom();
  }

  /** Hears of the next slot that comes back, while a post is kept. */
  private watchRoom(): void {
    if (this.watching || this.line.length === 0) return;
    this.watching = true;
    roomWaiters.push(() => {
      this.watching = false;
      this.roomCame();
    });
  }

  /** No new call from here: the posts kept for room are let go at
   * once, each as a stopped lane declines it. */
  stop(): void {
    this.stopped = true;
    this.roomCame();
  }
}
