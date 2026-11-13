// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A dead log taken over: a request for a gone sibling (its slot
// removed) reaches a live copy of the service, and that copy answers
// for the sibling from the sibling's log, which the plane keeps a day;
// the controller's hand-on of a retired generation has the agent's
// newest copy take over every log of that generation. The taker asks
// the dead log's head for a grant of its own and owns the log with it,
// so any process of the sibling still alive, or a launch of it delayed
// on its way, is refused at its next write; reads it from its mark;
// finishes every request acked there and not answered as its type says,
// writing its response into the dead log under the same request; and
// posts again every response there whose caller may still wait. A dead
// log a live sibling holds already is that sibling's: the request is
// handed to it. The cleanup retires a dead log's rows a day after its
// slot went, against the head it captured, the head staying.

import { substrate } from './connection.js';
import { Journal, newerHolderOwns } from './journal.js';
import { failureForRecord } from '../language/errors.js';
import { processFacts, processIdentity } from './facts.js';
import {
  DEAD_LOG_RETENTION_MS,
  destinationOfLog,
  entryOf,
  generationLogsPrefix,
  serviceLogsPrefix,
  stateOf,
  unfinishedWork,
} from './log.js';
import { copyKey } from './substrate.js';
import { considerResend, liveCopyByAttempt, registerJournal } from './transport.js';
import type { ServedUnit } from './units.js';
import type { PostedCall } from './units.js';
import type { CallEnvelope } from './envelope.js';
import { meetTaken } from './serve.js';
import { restoreOwed } from './image.js';
import { kernelSay } from '../traces/observe.js';
import { HAND_ON_HANDLER } from '../language/program.js';

/** The life this process's agent runs under, whose logs a takeover and
 * a sweep reach: a sibling's log of another life is never this one's. */
function ownLifeId(): string {
  const life = processFacts().life;
  if (life === undefined) throw new Error('this process runs under no life yet');
  return life;
}

/** Takes over a dead sibling's log: owned by a grant of this process's
 * own, read, every request acked there and not answered met, every
 * response there posted again. Answers the journal, or the inbox of
 * the live sibling that holds the log already. */
export async function takeOverLog(
  unit: ServedUnit,
  log: string,
): Promise<Journal | { forward: string }> {
  const held = unit.taken.get(log);
  if (held !== undefined) return held;
  const handles = await substrate();
  const life = ownLifeId();
  const standing = await handles.logsOf(life).read(log, 0);
  const owner = standing.head?.owner;
  if (owner !== undefined && owner !== '' && owner !== unit.journal?.attempt) {
    const holder = await liveCopyByAttempt(destinationOfLog(log)?.service ?? unit.service, owner);
    if (holder !== undefined && holder !== unit.inbox) return { forward: holder };
  }
  // A copy whose record names an image is restored by the host job wherever
  // its process is gone, and its log is nobody's to take meanwhile: a
  // takeover would answer in words what the image continues, and its
  // grant would fence the restore.
  const named = destinationOfLog(log);
  if (named !== undefined && (await restoreOwed(named.generation, named.copy)))
    throw new Error(
      `the log ${log} is continued by the image its record names: the host job restores the copy, and the log is taken over by nobody meanwhile`,
    );
  const attempt = unit.journal?.attempt ?? processFacts().attempt ?? processIdentity();
  const journal = await Journal.open(log, { attempt, life });
  // A second take of the same log while the first was on its way: the
  // first stands.
  const meanwhile = unit.taken.get(log);
  if (meanwhile !== undefined) return meanwhile;
  unit.taken.set(log, journal);
  const unregister = registerJournal(journal);
  journal.onEnd = unregister;
  kernelSay(
    `${unit.service}: the log ${log} is taken over (${String(journal.state.taken.size)} requests, ${String(journal.unacked().responses.length)} responses owed)\n`,
  );
  for (const taken of journal.state.taken.values()) meetTaken(unit, journal, taken);
  considerResend();
  return journal;
}

/** Lets a taken log go: another process owns it now, or this process
 * resumed under a new life. */
export function dropTakenLog(unit: ServedUnit, log: string): void {
  const journal = unit.taken.get(log);
  if (journal === undefined) return;
  unit.taken.delete(log);
  journal.end();
  journal.onEnd?.();
  for (const [request, body] of [...unit.bodies]) {
    if (body.log !== log) continue;
    unit.letGo(request);
  }
}

/** Answers the runtime's hand-on function: `{generation}` names the
 * generation, by its port, whose logs this process takes over, every
 * copy's, or with `owner` (`copy-<n>`) one dead copy's of this
 * process's own generation; the answer is `{handedOn}`, how many logs
 * it took. The request is answered in the post's own answer: nothing of
 * it is recorded, and a hand-on asked again takes over nothing twice. */
export async function serveHandOn(
  unit: ServedUnit,
  posted: PostedCall,
  envelope: CallEnvelope,
): Promise<void> {
  const args = envelope.args as { generation?: unknown; owner?: unknown } | undefined;
  const named = args?.generation;
  const generation =
    typeof named === 'string' ? named : typeof named === 'number' ? String(named) : undefined;
  const copy =
    typeof args?.owner === 'string' && args.owner.startsWith('copy-')
      ? Number(args.owner.slice('copy-'.length))
      : typeof args?.owner === 'number'
        ? args.owner
        : undefined;
  if (generation === undefined) {
    posted.confirm({
      outcome: {
        error: {
          kind: 'contract-violation',
          message: `${HAND_ON_HANDLER} takes the generation's port as {generation}, and the dead copy as {owner} for one of this generation's own`,
        },
      },
    });
    return;
  }
  try {
    const handedOn = await takeOverGeneration(unit, generation, copy);
    posted.confirm({ outcome: { result: { handedOn } } });
  } catch (error) {
    posted.confirm({
      outcome: {
        error: {
          kind: 'retryable',
          message: `the logs of generation ${generation} could not be taken over: ${failureForRecord(error).error}`,
        },
      },
    });
  }
}

/** Takes over the logs of a generation of this agent (every copy's, or
 * one copy's of this process's own generation). Answers how many. */
async function takeOverGeneration(
  unit: ServedUnit,
  generation: string,
  copy?: number,
): Promise<number> {
  const own = unit.journal?.log;
  const logs =
    copy === undefined
      ? (
          await (
            await substrate()
          )
            .logsOf(ownLifeId())
            .list(generationLogsPrefix(unit.service, generation))
        ).map((entry) => entry.log)
      : [`${unit.service}/${generation}/${String(copy)}`];
  let taken = 0;
  for (const log of logs) {
    if (log === own) continue;
    try {
      const result = await takeOverLog(unit, log);
      if (!('forward' in result)) taken += 1;
    } catch (error) {
      if (newerHolderOwns(error)) continue;
      throw error;
    }
  }
  return taken;
}

/** THE CLEANUP: every dead log of this service (its slot gone) whose
 * last row is older than the retention is retired against the head
 * the sweep read; the head stays. Answers the logs retired. */
export async function sweepDeadLogs(unit: ServedUnit): Promise<string[]> {
  const handles = await substrate();
  const logs = handles.logsOf(ownLifeId());
  const retired: string[] = [];
  const own = unit.journal?.log;
  const now = Date.now();
  for (const { log, head } of await logs.list(serviceLogsPrefix(unit.service))) {
    if (log === own || unit.taken.has(log) || head.last === 0) continue;
    const named = destinationOfLog(log);
    if (named === undefined) continue;
    const slot = await handles.records.read(copyKey(Number(named.generation), named.copy));
    if (slot.value !== null) continue;
    const tail = await logs.read(log, head.last);
    const last = tail.rows.at(-1);
    if (last === undefined) {
      // Retired already: the head stays with nothing under it.
      continue;
    }
    let at = 0;
    try {
      at = (JSON.parse(last.text) as { at?: number }).at ?? 0;
    } catch {
      at = 0;
    }
    if (now - at < DEAD_LOG_RETENTION_MS) continue;
    // A log a live copy holds (a taker's, by its attempt) is that
    // copy's to keep; one with work unfinished (a request taken and not
    // answered, a request sent and not acked by a body still running)
    // is retired by nobody until the work is done.
    if (head.owner !== '' && (await liveCopyByAttempt(unit.service, head.owner)) !== undefined)
      continue;
    const state = stateOf((await logs.read(log, 0)).rows.map(entryOf));
    if (unfinishedWork(state)) continue;
    if (await logs.retire(log, { launch: head.launch, last: head.last })) retired.push(log);
  }
  if (retired.length > 0)
    kernelSay(
      `${unit.service}: ${String(retired.length)} dead logs retired: ${retired.join(', ')}\n`,
    );
  return retired;
}
