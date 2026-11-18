// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What the two lanes do the same way around one operation of a
// provider, an openapi operation or an mcp tool call: THE ATTEMPTS IN
// ONE RECORD, and THE WORD THE SAFE IS OWED AFTER IT. Each lane's
// ladder keeps what is its own: how an attempt is sent and what its
// refusal means, the rungs of its sign-in, the accounts it told and
// the labels its records carry.

import type { CernantoError } from '../language/errors.js';
import type { OutsideOutcome } from '../language/outside.js';
import type { LaneOptions } from './record.js';
import { mayLetGo, recordOf, sleepUnder } from './record.js';

/** How many times one operation is attempted inside its record. */
const MAX_ATTEMPTS = 5;

/** What an answered operation owes the safe: the word that the provider
 * took the account's credential. Whether it is owed is what this
 * process remembers, a fact of the live world, so the operation's
 * record reads it and keeps it; the word itself is told after the
 * record, where a replay answers it from the journal and tells nothing
 * again. A safe that refuses the word for good is told by the next
 * operation. */
export interface Acceptance {
  owed(): boolean;
  tell(): Promise<void>;
}

/** The safe's word that a provider took an account's credential, as a
 * lane's custody hands it in when the plane's safe offers it. */
interface AcceptingCustody {
  accepted?(args: { name: string }): Promise<unknown>;
}

/** The accounts one lane told the safe were accepted: an account is
 * told once in a process's life, by the first operation its provider
 * answered with its credential. Each lane keeps its own. */
export class AcceptedAccounts {
  private readonly told = new Set<string>();

  /** What an operation under the account's credential owes the safe;
   * nothing when the safe offers no such word. */
  of(custody: AcceptingCustody, name: string): Acceptance | undefined {
    if (custody.accepted === undefined) return undefined;
    return {
      owed: () => !this.told.has(name),
      tell: async () => {
        try {
          await custody.accepted?.({ name });
          this.told.add(name);
        } catch (error) {
          // The operation's answer stands whatever the safe answered. A
          // failure that is no answer of the safe's unwinds a journaled
          // attempt here, and the attempt that follows tells the word
          // anew.
          if (!mayLetGo(error)) throw error;
        }
      },
    };
  }

  /** A refused credential: the account is told again once its provider
   * takes one. */
  refused(name: string): void {
    this.told.delete(name);
  }
}

/** What the record of an operation keeps: its outcome, and whether the
 * safe is owed the word. */
type Recorded<T> = OutsideOutcome<T> & { accepted?: true };

/** What an operation's attempts take beyond the operation itself. */
export interface AttemptsHow {
  /** The word the safe is owed once the provider answers. */
  acceptance?: Acceptance | undefined;
  /** The wait the provider asked for before the next attempt, read off
   * a failure that says again; nothing leaves the lane's own wait. */
  waitAsked?: ((failure: unknown) => number | undefined) | undefined;
}

/**
 * One operation, attempted until its provider answers or the attempts
 * are spent, inside one record under the label given: a replay answers
 * the recorded outcome in place of the provider. `round` is asked at
 * every attempt for what it sends, before the attempt and outside its
 * watch: what it throws is no answer of the provider's, and leaves the
 * record as it is thrown. The attempt and the wait between attempts
 * run under the record's signal, so an ended attempt ends them with its
 * own reason, unrecorded. A failure that says again is attempted again
 * after the wait the provider asked for, else one that doubles from a
 * second; any other failure, and the last attempt's, is the operation's
 * recorded failure. The record also keeps whether the safe is owed the
 * word; the word is told after it.
 */
export async function recordedAttempts<T>(
  label: string,
  round: () => (signal: AbortSignal) => Promise<OutsideOutcome<T>>,
  options: LaneOptions | undefined,
  how: AttemptsHow = {},
): Promise<OutsideOutcome<T>> {
  const { acceptance, waitAsked } = how;
  const outcome = await recordOf(options)(label, async (signal): Promise<Recorded<T>> => {
    for (let tried = 1; ; tried += 1) {
      const attempt = round();
      let settled: OutsideOutcome<T>;
      try {
        settled = await attempt(signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const failure = error as Partial<CernantoError>;
        if (failure.kind !== 'retryable' || tried >= MAX_ATTEMPTS) {
          return {
            failed: { kind: 'terminal' as const, message: failure.message ?? String(error) },
          };
        }
        await sleepUnder(waitAsked?.(error) ?? 1000 * 2 ** (tried - 1), signal);
        continue;
      }
      return 'ok' in settled && acceptance?.owed() === true
        ? { ...settled, accepted: true }
        : settled;
    }
  });
  if ('ok' in outcome && outcome.accepted === true) await acceptance?.tell();
  return outcome;
}
