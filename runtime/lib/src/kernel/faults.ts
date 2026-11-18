// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The fault seam: a proof arms a fault at a point of the kernel's road
// (a record about to be written or just written, a post about to be
// made), and the kernel meets it there once. Four acts: `crash` ends
// the process at the point (a thrown FaultCrash in process, an exit
// with the code 3 under the environment), `drop` loses a post, `duplicate`
// delivers a post twice, `delay` holds a post for a moment. The points
// are the seven records, each before and after its append (`request
// sent:before`, `request sent:after`, ...), and the two posts (`post
// request`, `post response`). A process the proofs spawn is armed by
// the environment, `CERNANTO_FAULT=<point>:<act>[,<point>:<act>]`; a
// proof in process arms by `armFault`. Nothing here runs outside a
// proof: an unarmed point is a map lookup.

type FaultAct = 'crash' | 'drop' | 'duplicate' | 'delay';

/** The points a fault can be armed at. */
export type FaultPoint =
  | 'request sent:before'
  | 'request sent:after'
  | 'request ack:before'
  | 'request ack:after'
  | 'response sent:before'
  | 'response sent:after'
  | 'response ack:before'
  | 'response ack:after'
  | 'observed:before'
  | 'observed:after'
  | 'checkpoint started:before'
  | 'checkpoint started:after'
  | 'checkpoint done:before'
  | 'checkpoint done:after'
  | 'post request'
  | 'post response';

const armed = new Map<string, FaultAct>();
let fired: string[] = [];

/** Arms a fault at a point, met once. */
export function armFault(point: FaultPoint, act: FaultAct): void {
  armed.set(point, act);
}

/** Disarms every fault and answers the points fired so far, forgotten
 * from here. */
export function disarmFaults(): string[] {
  armed.clear();
  const seen = fired;
  fired = [];
  return seen;
}

let environmentRead = false;
function readEnvironment(): void {
  if (environmentRead) return;
  environmentRead = true;
  const word = process.env['CERNANTO_FAULT'];
  if (word === undefined || word === '') return;
  for (const part of word.split(',')) {
    const at = part.lastIndexOf(':');
    if (at <= 0) continue;
    const act = part.slice(at + 1);
    if (act === 'crash' || act === 'drop' || act === 'duplicate' || act === 'delay')
      armed.set(part.slice(0, at), act);
  }
}

/** The act armed at a point, taken (the fault fires once); nothing
 * when none is armed there. */
export function faultAt(point: FaultPoint): FaultAct | undefined {
  readEnvironment();
  const act = armed.get(point);
  if (act === undefined) return undefined;
  armed.delete(point);
  fired.push(point);
  return act;
}

/** Ends the process here when a crash is armed at the point: an exit
 * under the environment (the process the proof spawned dies as a
 * killed one does), a thrown FaultCrash in process. */
export function crashAt(point: FaultPoint): void {
  const act = faultAt(point);
  if (act !== 'crash') return;
  if (process.env['CERNANTO_FAULT'] !== undefined) {
    process.stderr.write(`fault: crash at ${point}\n`);
    process.exit(3);
  }
  throw new FaultCrash(point);
}

/** The crash a fault armed in process throws. */
class FaultCrash extends Error {
  readonly point: string;

  constructor(point: string) {
    super(`fault: crash at ${point}`);
    this.name = 'FaultCrash';
    this.point = point;
  }
}
