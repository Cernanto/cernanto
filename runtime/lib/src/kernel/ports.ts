// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A fixed port is one agent's across the plane: the first bind of a
// fixed port by an agent writes `ports/<port>/<protocol>` in the
// plane's records with the agent's id, resting on absence, and the
// claim stays through failures, parks, rolls and upgrades until the
// agent's deletion or the operator's release. The wrapper around
// `listen` asks here before it binds: a port another agent holds is
// refused with the error every Node program handles, and the holder's
// name; one the agent holds already, or nobody does, is bound, so the
// copies and the generations of one agent share it. The write is a
// compare-and-set, so two agents binding at the same instant on two
// servers get one owner. A copy's own call port is never claimed here:
// it is the server's to give and the record's to publish.

import { substrate } from './connection.js';
import { processFacts } from './facts.js';

/** What a claim holds. */
interface PortClaim {
  agentId: string;
  since: number;
}

/** The outcome of a claim: the port is the agent's, or another's. */
type Claimed = { ok: true } | { ok: false; holder: string };

/** The key of a port's claim among the plane's records. */
export function portKey(port: number, protocol: 'tcp' | 'udp'): string {
  return `ports/${String(port)}/${protocol}`;
}

function claimOf(value: string | null): PortClaim | undefined {
  if (value === null) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<PortClaim>;
    return typeof parsed.agentId === 'string' && parsed.agentId !== ''
      ? { agentId: parsed.agentId, since: typeof parsed.since === 'number' ? parsed.since : 0 }
      : undefined;
  } catch {
    return undefined;
  }
}

/** The claim a key holds, when one does. */
export async function portHolder(
  port: number,
  protocol: 'tcp' | 'udp',
): Promise<PortClaim | undefined> {
  const { records } = await substrate();
  return claimOf((await records.read(portKey(port, protocol))).value);
}

/** Claims a port for this process's agent: made when nobody holds it,
 * kept when this agent does, refused with the holder's name otherwise.
 * The identity is the process's own: a tester speaks as its agent on
 * the wire and claims no port in that name. A read or a write the
 * store cannot answer throws, and the caller decides. */
export async function claimPort(port: number, protocol: 'tcp' | 'udp'): Promise<Claimed> {
  const agentId = processFacts().agentId;
  if (agentId === undefined) return { ok: true };
  const { records } = await substrate();
  const key = portKey(port, protocol);
  const claim: PortClaim = { agentId, since: Date.now() };
  const written = await records.write(key, JSON.stringify(claim), null);
  if (written.ok) return { ok: true };
  const held = claimOf(written.current.value);
  if (held === undefined) {
    // The write was refused by a record that does not read as a claim:
    // a stale or foreign value under the key. Asked again, resting on
    // what stands, so the key becomes this agent's.
    const over = await records.write(key, JSON.stringify(claim), written.current.value);
    if (over.ok) return { ok: true };
    const standing = claimOf(over.current.value);
    if (standing === undefined) throw new Error(`the claim of port ${key} could not be written`);
    return standing.agentId === agentId ? { ok: true } : { ok: false, holder: standing.agentId };
  }
  return held.agentId === agentId ? { ok: true } : { ok: false, holder: held.agentId };
}

/** Releases a port's claim when the agent given holds it: the agent's
 * deletion, or the operator's word. Answers whether a claim left. */
export async function releasePort(
  port: number,
  protocol: 'tcp' | 'udp',
  agentId?: string,
): Promise<boolean> {
  const { records } = await substrate();
  const key = portKey(port, protocol);
  const read = await records.read(key);
  const held = claimOf(read.value);
  if (held === undefined) return false;
  if (agentId !== undefined && held.agentId !== agentId) return false;
  return (await records.write(key, null, read.value)).ok;
}

/** The error a bind gets when the plane could not say who holds the
 * port: no claim stands, so no listener does. */
export function unconfirmedBind(port: number, protocol: 'tcp' | 'udp', why: string): Error {
  return Object.assign(
    new Error(
      `listen EAGAIN: the plane could not confirm who holds port ${String(port)}/${protocol} (${why}); the bind is refused until it can`,
    ),
    { code: 'EAGAIN', errno: -11, syscall: 'listen', port },
  );
}

/** The words a refused bind carries: the error every Node program
 * handles, with the holder's name. */
export function refusedBind(port: number, protocol: 'tcp' | 'udp', holder: string): Error {
  return Object.assign(
    new Error(
      `listen EADDRINUSE: port ${String(port)}/${protocol} is held by agent ${holder} on this plane`,
    ),
    { code: 'EADDRINUSE', errno: -98, syscall: 'listen', port, holder },
  );
}
