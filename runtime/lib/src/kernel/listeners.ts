// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The listeners a process opens, seen by the runtime: `net.Server.listen` and `dgram.Socket.bind` are
// wrapped the way the transparent globals are, which covers http,
// https, http2 and tls, and the servers seen are kept. A listener has
// three states, and the copy's entry on the plane carries them:
// `accepting` when a bind succeeds, with the bound address, the port
// and the protocol; `draining` the moment the code or the drain calls
// `close()`, since Node stops accepting at the call while the close
// event waits for the last connection; `closed` at that event or at
// the end of the process. What counts as an address: a port the code
// asked for, fixed and above zero, bound on a non-loopback address. A
// port the OS chose is observed and shown and never owned; a loopback
// bind is local; a UDP socket bound implicitly by a send is a client.
// A fixed port is one agent's across the plane: before a fixed,
// non-loopback bind the port is claimed in the plane's records
// (`ports.ts`), a port another agent holds refuses the bind with
// EADDRINUSE and the holder's name, and a port taken on the machine by
// a process that is not the plane's holder ends the copy with the
// bind's error. On Linux a fixed port is bound with reusePort, so two
// generations of one agent share a port on one host during a roll. A test form owns
// no port: its fixed bind, whatever the address, lands on the loopback
// at a port the OS chooses, shown like any ephemeral port and never
// owned, so the agent's own port stays the agent's on the machine the
// two share; the tester reaches the form by its calls.

import dgram from 'node:dgram';
import net from 'node:net';

import { system } from '@cernanto/system';

import { sayEntry } from './copy-entry.js';
import { substrateConfigured } from './connection.js';
import { processFacts } from './facts.js';
import { claimPort, refusedBind, unconfirmedBind } from './ports.js';
import { kernelSay } from '../traces/observe.js';

/** One listener as the copy's entry reports it. */
export interface ListenerFact {
  protocol: 'tcp' | 'udp';
  port: number;
  address: string;
  family: string;
  state: 'accepting' | 'draining' | 'closed';
  fixed: boolean;
  bound: 'any' | 'loopback' | 'address';
  refused?: string | undefined;
  since: number;
}

interface Tracked {
  fact: ListenerFact;
  /** The server or socket, for the fence's close and the announce. */
  handle: net.Server | dgram.Socket;
  /** The port and host the code asked for. */
  asked: { port: number; host: string | undefined };
}

let installed = false;
/** What ends the copy whose fixed port is taken: the bind's error,
 * written to the error stream, and the exit after the line's flush (a
 * pipe writes asynchronously on some systems, and the line is what the
 * host job keeps of the end). A proof hands its own. */
let end: (error: Error) => void = (error) => {
  kernelSay(`${error.message}; the copy ends\n`, () => {
    closeListeners();
    process.exit(1);
  });
};

/** The bind's error when a fixed port is taken on this machine by a
 * process that is not the plane's holder (a copy of a previous life
 * still on the port, a program of the machine's own): the copy ends
 * with it, as one whose port another agent holds does, and the start
 * after the holder is gone binds. A copy that stayed up without its
 * listener would report ready and serve nobody. */
function inUse(port: number, protocol: 'tcp' | 'udp', cause: Error): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    `port ${String(port)}/${protocol} is in use on this machine: ${cause.message}`,
  );
  error.code = 'EADDRINUSE';
  return error;
}

/** How long a copy waits on a fixed port that is taken before it ends:
 * the holder is most often this agent's previous generation, which the
 * controller removes within a pass once this copy reported ready, and
 * the code's own retry of the bind (the gateway's, every generated
 * server's) lands as soon as the port frees; a holder that is a
 * stranger keeps the port past the patience, and the copy ends with the
 * bind's words as it would have at once. */
const DEFAULT_TAKEN_PORT_PATIENCE_MS = 120_000;
let patienceMs = DEFAULT_TAKEN_PORT_PATIENCE_MS;
/** The deadlines armed for taken fixed ports, one per port. */
const waiting = new Map<string, NodeJS.Timeout>();

function portKey(protocol: 'tcp' | 'udp', port: number): string {
  return `${protocol}:${String(port)}`;
}

/** A bind that landed on a port ends the wait for it. */
function waitEnded(protocol: 'tcp' | 'udp', port: number): void {
  const key = portKey(protocol, port);
  const timer = waiting.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  waiting.delete(key);
}

/** Ends the copy when the bind the OS performs fails for a fixed port
 * that is taken and stays taken past the patience: the handle's error
 * is read once per attempt, before the code's own listeners, which may
 * swallow it; the refused bind is not listed, and the code's own retry
 * is left to land once the holder is gone. */
function endOnTakenPort(
  handle: net.Server | dgram.Socket,
  entry: Tracked,
  protocol: 'tcp' | 'udp',
): void {
  if (entry.asked.port <= 0) return;
  handle.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EADDRINUSE') return;
    untrack(entry);
    scheduleWrite();
    const port = entry.asked.port;
    const key = portKey(protocol, port);
    if (waiting.has(key)) return;
    // A bind that lands on the port meanwhile clears the deadline; a
    // deadline that fires found none.
    const timer = setTimeout(() => {
      waiting.delete(key);
      end(inUse(port, protocol, error));
    }, patienceMs);
    timer.unref();
    waiting.set(key, timer);
  });
}
const tracked: Tracked[] = [];
/** Whether the entry is being said again soon: the words coalesce. */
let writeQueued = false;

/** Says the listeners anew in the copy's entry on the plane, whole:
 * a reader sees all of them or the ones before. Coalesced to one word
 * per turn. */
function scheduleWrite(): void {
  if (writeQueued) return;
  writeQueued = true;
  queueMicrotask(() => {
    writeQueued = false;
    writeNow();
  });
}

function writeNow(): void {
  sayEntry({ listens: tracked.map((entry) => ({ ...entry.fact })) });
}

/** Whether an address is the loopback's. */
function isLoopback(address: string | undefined): boolean {
  if (address === undefined || address === '') return false;
  return (
    address === 'localhost' ||
    address.startsWith('127.') ||
    address === '::1' ||
    address === '0:0:0:0:0:0:0:1' ||
    address === '::ffff:127.0.0.1'
  );
}

/** How an address is bound: every interface, the loopback, or one
 * interface's own address. */
function boundOf(address: string | undefined): ListenerFact['bound'] {
  if (address === undefined || address === '' || address === '0.0.0.0' || address === '::')
    return 'any';
  return isLoopback(address) ? 'loopback' : 'address';
}

/** The port and host a listen or a bind asked for, read off its
 * arguments; nothing for a path, a handle or a descriptor. */
function requestedOf(args: unknown[]): { port: number; host: string | undefined } | undefined {
  const first = args[0];
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    const host = typeof args[1] === 'string' ? args[1] : undefined;
    return { port: Number(first), host };
  }
  if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
    const options = first as { port?: unknown; host?: unknown; address?: unknown; path?: unknown };
    if (options.path !== undefined) return undefined;
    const port = options.port;
    if (port === undefined || port === null) return { port: 0, host: undefined };
    const number = typeof port === 'string' ? Number(port) : port;
    if (typeof number !== 'number' || !Number.isFinite(number)) return undefined;
    const host =
      typeof options.host === 'string'
        ? options.host
        : typeof options.address === 'string'
          ? options.address
          : undefined;
    return { port: number, host };
  }
  if (first === undefined || typeof first === 'function') return { port: 0, host: undefined };
  return undefined;
}

/** A test form's fixed bind lands on the loopback at a port the OS
 * chooses: the form stands in for its agent and owns no port. The
 * agent's own copy may hold the port on the same machine, and a bind
 * of it beside that copy would share the port, or take the machine's
 * loopback connections to the agent (a loopback bind sits beside a
 * bind on every interface and wins them), or fail (UDP); any other
 * fixed port is as much another agent's. The tester reaches the form
 * by its calls, and the verify leaves the port alone. */
function localized(
  args: unknown[],
  asked: { port: number; host: string | undefined },
  protocol: 'tcp' | 'udp',
  family: 4 | 6,
): { args: unknown[]; asked: { port: number; host: string | undefined } } {
  if (processFacts().callsAs === undefined || asked.port <= 0) return { args, asked };
  const local = { port: 0, host: family === 6 ? '::1' : '127.0.0.1' };
  const first = args[0];
  if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
    const options = first as Record<string, unknown>;
    const named = protocol === 'tcp' ? { host: local.host } : { address: local.host };
    return { args: [{ ...options, port: 0, ...named }, ...args.slice(1)], asked: local };
  }
  // The positional form: the port, then whatever was given but a host.
  const rest = args.slice(1).filter((value) => typeof value !== 'string');
  return { args: [0, local.host, ...rest], asked: local };
}

/** The family a UDP socket was made for. */
function familyOf(socket: dgram.Socket): 4 | 6 {
  return (socket as unknown as { type?: unknown }).type === 'udp6' ? 6 : 4;
}

/** Whether the plane's claims apply to this process: it speaks a
 * substrate and serves an agent. A tool, a proof's world or a package
 * run on its own claims nothing. */
function claimsApply(): boolean {
  return substrateConfigured() && processFacts().agentId !== undefined;
}

/** The claim before a fixed, non-loopback bind: the bind goes on when
 * the port is this agent's or nobody's; a port another agent holds
 * refuses the bind with EADDRINUSE and the holder's name; a plane that
 * cannot answer is asked once more, then refuses the bind: no claim,
 * no listener, since a fixed port is bound with reusePort and the OS
 * guards nothing. The start that fails asks again when it is tried
 * again, and a copy without the plane is fenced within two leases. */
function claimed(
  entry: Tracked,
  protocol: 'tcp' | 'udp',
  go: () => void,
  refuse: (error: Error) => void,
): void {
  const { port, host } = entry.asked;
  if (port <= 0 || isLoopback(host) || !claimsApply()) {
    go();
    return;
  }
  const attempt = (tries: number): void => {
    void claimPort(port, protocol).then(
      (outcome) => {
        if (outcome.ok) {
          go();
          return;
        }
        // The bind never happened, so nothing of it is listed. A fixed
        // port another agent holds is not this copy's to wait for: the
        // copy ends with the bind's error, the holder's name in it, the
        // plane shows the failed start, and a start after the holder is
        // gone binds. Neither parked as idle nor kept up.
        untrack(entry);
        scheduleWrite();
        end(refusedBind(port, protocol, outcome.holder));
      },
      (error: unknown) => {
        if (tries < 2) {
          setTimeout(() => {
            attempt(tries + 1);
          }, 1000).unref();
          return;
        }
        const why = error instanceof Error ? error.message : String(error);
        entry.fact.refused = 'unconfirmed';
        entry.fact.state = 'closed';
        scheduleWrite();
        refuse(unconfirmedBind(port, protocol, why));
      },
    );
  };
  attempt(1);
}

/** The arguments of a listen with reusePort added for a fixed port, on
 * the systems that take it (Linux): two generations of one agent share
 * a port on one host during a roll. */
function withReusePort(
  args: unknown[],
  asked: { port: number; host: string | undefined },
): unknown[] {
  if (system.name !== 'linux' || asked.port <= 0) return args;
  const first = args[0];
  if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
    const options = first as Record<string, unknown>;
    if (options['reusePort'] !== undefined || options['exclusive'] === true) return args;
    return [{ ...options, reusePort: true }, ...args.slice(1)];
  }
  // The positional form: the port, the host, a backlog and a callback
  // in any order after the port; rewritten as the options form.
  const rest = args.slice(1);
  const host = rest.find((value): value is string => typeof value === 'string');
  const backlog = rest.find((value): value is number => typeof value === 'number');
  const callback = rest.find((value): value is () => void => typeof value === 'function');
  const options: Record<string, unknown> = { port: asked.port, reusePort: true };
  if (host !== undefined) options['host'] = host;
  if (backlog !== undefined) options['backlog'] = backlog;
  return callback === undefined ? [options] : [options, callback];
}

function track(
  handle: net.Server | dgram.Socket,
  protocol: 'tcp' | 'udp',
  asked: { port: number; host: string | undefined },
): Tracked {
  const entry: Tracked = {
    handle,
    asked,
    fact: {
      protocol,
      port: asked.port,
      address: asked.host ?? '',
      family: '',
      state: 'closed',
      fixed: asked.port > 0,
      bound: boundOf(asked.host),
      since: Date.now(),
    },
  };
  tracked.push(entry);
  return entry;
}

function untrack(entry: Tracked): void {
  const at = tracked.indexOf(entry);
  if (at !== -1) tracked.splice(at, 1);
}

/** What the bind landed on: the address, the family and the port. */
function landed(entry: Tracked, address: net.AddressInfo | string | null): void {
  waitEnded(entry.fact.protocol, entry.fact.port);
  if (typeof address === 'object' && address !== null) {
    entry.fact.address = address.address;
    entry.fact.family = address.family;
    entry.fact.port = address.port;
    entry.fact.bound = boundOf(address.address);
  }
  entry.fact.state = 'accepting';
  entry.fact.since = Date.now();
  delete entry.fact.refused;
  scheduleWrite();
}

/** Whether a server ends its open connections on its own (an http
 * server does; a plain net server has no such method). */
function closesConnections(
  server: net.Server,
): server is net.Server & { closeAllConnections(): void } {
  return (
    typeof (server as Partial<Record<'closeAllConnections', unknown>>).closeAllConnections ===
    'function'
  );
}

/** The real methods, read to be wrapped and called with their own
 * receiver, never as methods of this module. */
type Method<T> = (this: T, ...args: unknown[]) => T;
// eslint-disable-next-line @typescript-eslint/unbound-method
const realListen = net.Server.prototype.listen as unknown as Method<net.Server>;
// eslint-disable-next-line @typescript-eslint/unbound-method
const realServerClose = net.Server.prototype.close as unknown as Method<net.Server>;
// eslint-disable-next-line @typescript-eslint/unbound-method
const realBind = dgram.Socket.prototype.bind as unknown as Method<dgram.Socket>;
// eslint-disable-next-line @typescript-eslint/unbound-method
const realSocketClose = dgram.Socket.prototype.close as unknown as Method<dgram.Socket>;

/** The servers the kernel opens for itself (the copy's call server): no
 * listener of the agent's, never claimed, never listed, and a port of
 * the plane's range taken by another copy is the next port's turn, not
 * the copy's end. */
const kernelOwned = new WeakSet<net.Server>();

/** Marks a server as the kernel's own: its binds pass the observer by. */
export function ownedByKernel(server: net.Server): void {
  kernelOwned.add(server);
}

/** How long a connection an agent's listener accepted may stay silent
 * before the system probes it. */
export const LISTENER_KEEP_ALIVE_MS = 60_000;

/** The servers whose connections are kept alive, each once. */
const keepingAlive = new WeakSet<net.Server>();

/** Keeps every connection a listener accepts alive by TCP. A call that
 * waits answers nothing for as long as it waits, and what stands
 * between a client and the listener (a load balancer, a network's own
 * tables) ends a flow that stays silent past its idle time; a probe a
 * minute keeps the flow, so the answer finds its way back. */
function keptAlive(server: net.Server): void {
  if (keepingAlive.has(server)) return;
  keepingAlive.add(server);
  server.on('connection', (socket: net.Socket) => {
    socket.setKeepAlive(true, LISTENER_KEEP_ALIVE_MS);
  });
}

function patchedListen(this: net.Server, ...givenArgs: unknown[]): net.Server {
  if (kernelOwned.has(this)) return realListen.apply(this, givenArgs);
  const requested = requestedOf(givenArgs);
  if (requested === undefined) return realListen.apply(this, givenArgs);
  const { args, asked } = localized(
    givenArgs,
    requested,
    'tcp',
    net.isIPv6(requested.host ?? '') ? 6 : 4,
  );
  const entry = track(this, 'tcp', asked);
  this.once('listening', () => {
    landed(entry, this.address());
  });
  this.once('close', () => {
    entry.fact.state = 'closed';
    untrack(entry);
    scheduleWrite();
  });
  keptAlive(this);
  claimed(
    entry,
    'tcp',
    () => {
      endOnTakenPort(this, entry, 'tcp');
      try {
        realListen.apply(this, withReusePort(args, asked));
      } catch (error) {
        untrack(entry);
        scheduleWrite();
        throw error;
      }
    },
    (error) => {
      untrack(entry);
      process.nextTick(() => {
        this.emit('error', error);
      });
    },
  );
  return this;
}

function patchedServerClose(this: net.Server, ...args: unknown[]): net.Server {
  const entry = tracked.find((candidate) => candidate.handle === this);
  if (entry !== undefined && entry.fact.state === 'accepting') {
    entry.fact.state = 'draining';
    scheduleWrite();
  }
  return realServerClose.apply(this, args);
}

function patchedBind(this: dgram.Socket, ...givenArgs: unknown[]): dgram.Socket {
  const requested = requestedOf(givenArgs);
  // A socket bound implicitly by a send, or on a port the OS chooses,
  // is a client: it is neither owned nor shown.
  if (requested === undefined || requested.port <= 0) return realBind.apply(this, givenArgs);
  const { args, asked } = localized(givenArgs, requested, 'udp', familyOf(this));
  const entry = track(this, 'udp', asked);
  this.once('listening', () => {
    landed(entry, this.address());
  });
  this.once('close', () => {
    entry.fact.state = 'closed';
    untrack(entry);
    scheduleWrite();
  });
  claimed(
    entry,
    'udp',
    () => {
      endOnTakenPort(this, entry, 'udp');
      try {
        realBind.apply(this, args);
      } catch (error) {
        untrack(entry);
        scheduleWrite();
        throw error;
      }
    },
    (error) => {
      untrack(entry);
      process.nextTick(() => {
        this.emit('error', error);
      });
    },
  );
  return this;
}

function patchedSocketClose(this: dgram.Socket, ...args: unknown[]): dgram.Socket {
  const entry = tracked.find((candidate) => candidate.handle === this);
  if (entry !== undefined && entry.fact.state === 'accepting') {
    entry.fact.state = 'draining';
    scheduleWrite();
  }
  return realSocketClose.apply(this, args);
}

/** What the observer is told: the block installs it before the
 * agent's code loads, since a server opened at the agent's load is a
 * listener too. */
interface ListenerObserverOptions {
  /** What ends the copy on a port that is taken; the process's own
   * exit by default. */
  end?: ((error: Error) => void) | undefined;
  /** How long a taken fixed port is waited for before the copy ends;
   * two minutes by default. */
  takenPortPatienceMs?: number | undefined;
}

/** Installs the wrappers once; a process the plane placed nowhere keeps
 * its listeners in memory alone. */
export function installListenerObserver(options: ListenerObserverOptions = {}): void {
  end = options.end ?? end;
  patienceMs = options.takenPortPatienceMs ?? patienceMs;
  if (installed) return;
  installed = true;
  Object.assign(net.Server.prototype, { listen: patchedListen, close: patchedServerClose });
  Object.assign(dgram.Socket.prototype, { bind: patchedBind, close: patchedSocketClose });
  process.once('exit', () => {
    for (const entry of tracked) entry.fact.state = 'closed';
    writeNow();
  });
}

/** The listeners seen so far, as the entry reports them. */
export function listenersSeen(): ListenerFact[] {
  return tracked.map((entry) => ({ ...entry.fact }));
}

/** Closes every listener the process holds: no new connection lands,
 * the open ones are ended. The fence's road, and the end of a process
 * that must stop serving at once. */
export function closeListeners(): void {
  for (const entry of [...tracked]) {
    entry.fact.state = 'closed';
    const handle = entry.handle;
    try {
      if (handle instanceof net.Server) {
        realServerClose.call(handle);
        if (closesConnections(handle)) handle.closeAllConnections();
      } else {
        realSocketClose.call(handle);
      }
    } catch {
      // Already closed.
    }
    untrack(entry);
  }
  writeNow();
}

/** Announces the listeners again after a restore elsewhere: the
 * ownership of every fixed port is confirmed (a port the operator
 * released meanwhile closes its listener and says why), and the record
 * says them anew where the process now runs, since a restored process
 * runs no `listen` again. */
export async function announceListeners(): Promise<void> {
  for (const entry of [...tracked]) {
    const { fact } = entry;
    fact.since = Date.now();
    if (!fact.fixed || fact.bound === 'loopback' || fact.state !== 'accepting') continue;
    if (!claimsApply()) continue;
    try {
      const outcome = await claimPort(fact.port, fact.protocol);
      if (outcome.ok) continue;
      kernelSay(
        `port ${String(fact.port)}/${fact.protocol} is held by agent ${outcome.holder} now; the restored listener closes\n`,
      );
      fact.refused = outcome.holder;
      fact.state = 'closed';
      const handle = entry.handle;
      if (handle instanceof net.Server) realServerClose.call(handle);
      else realSocketClose.call(handle);
      untrack(entry);
    } catch (error) {
      kernelSay(
        `port ${String(fact.port)}/${fact.protocol}: the plane could not confirm its holder after the restore (${error instanceof Error ? error.message : String(error)}); the listener stays\n`,
      );
    }
  }
  writeNow();
}
