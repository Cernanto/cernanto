// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { WaitingFile } from '../model/files.js';
import { dropBytes, sweepBytes } from './files.js';
import {
  getPref,
  getPrefs,
  prefKept,
  prefStored,
  setPref,
  usePrefKept,
  usePrefs,
} from './prefs.js';

// A draft is an edit that was not deployed. It is kept in this
// browser's storage, not in its memory alone, so the reader goes to
// other agents, reloads the window or closes it, and the draft is there
// at the return. A draft is this browser's: another browser, another
// machine and another reader do not see it, and clearing the browser's
// data loses it. Nothing of a draft is on the plane, and a draft
// compiles nothing: a compile starts when the reader presses Deploy.
//
// Each draft is kept under a key of its own. A window that saves one
// draft writes that draft and no other, so two windows that edit two
// agents never write over each other, and what one window holds of a
// draft the browser did not take is not replaced by another window's
// save of another draft.

/** One draft: an agent's source as the reader left it. */
export interface Draft {
  /** The agent's id; free while the agent was never deployed. */
  id: string;
  text: string;
  /** The package the draft was opened on; none for a new agent. */
  base?: string;
  /** The deployed text it was opened on: one step back, and what "changed" is held against. */
  baseText?: string;
  /** The files chosen in this browser for the source, which wait for
   * the next deploy: what is known of each, its bytes kept apart. A
   * draft may hold files and the very text the agent runs: a file
   * chosen in the place of one the agent carries changes no line. */
  files?: WaitingFile[];
  updatedAt: string;
}

/** The word every draft's key begins with; its agent's id follows. */
const FAMILY = 'draft.';
/** The one record every window rewrote, before a draft had its own key. */
const AS_ONE_RECORD = 'drafts';

/** Whether a draft stands under an id. */
export function draftHeld(drafts: Record<string, Draft>, agentId: string): boolean {
  return Object.hasOwn(drafts, agentId);
}

/** The draft kept under an id as it stands now, or none. */
export function currentDraft(agentId: string): Draft | undefined {
  return getPref<Draft | undefined>(FAMILY + agentId, undefined);
}

/** The drafts as they stand now, by agent id, outside a component. */
export function currentDrafts(): Record<string, Draft> {
  return getPrefs<Draft>(FAMILY);
}

/** Keeps a draft as it stands now, over what was kept under its id. */
export function saveDraft(draft: Draft): void {
  setPref(FAMILY + draft.id, draft);
}

/** Forgets the draft under an id. The bytes of the files that waited
 * with it are left: a draft given another id leaves its old one so. */
export function dropDraft(agentId: string): void {
  setPref(FAMILY + agentId, undefined);
}

/** Forgets a draft for good, the files that waited with it among it. */
export function discardDraft(agentId: string): void {
  const draft = currentDraft(agentId);
  dropDraft(agentId);
  const keys = (draft?.files ?? []).map((file) => file.key);
  if (keys.length > 0) void dropBytes(keys);
}

/** A draft with the files that wait for it, and no word of files where none does. */
export function withFiles(draft: Draft, files: readonly WaitingFile[]): Draft {
  const rest: Draft = { ...draft };
  delete rest.files;
  return files.length === 0 ? rest : { ...rest, files: [...files] };
}

// A DRAFT IS PLACED UNDER AN ID BY ONE WINDOW AT A TIME. Placing one, a
// new draft or a draft given another id, is a look at the id's key and
// a write to it, and for a move the removal of the old key after. A
// browser's storage has no transaction between its windows, and a
// window reads its own write back before another window's has reached
// it, so two windows that place two drafts under one id at the same
// instant would each find it free, each write it, and the draft of one
// would be gone, its old key removed with it. So a window first takes
// the browser's own lock on the id, which the browser gives to one
// window of the two, and holds it a while after it wrote: long past
// the time a write takes to show in the other windows, which from then
// on find the id held when they look. A window that is not given the
// lock places nothing.
//
// Where the browser offers a page no lock between its windows, one not
// served securely, the look and the write are made as they are, and
// NOTHING IS REMOVED: a draft given another id there stays under its
// old one as well. Two windows that give two drafts one id at the same
// instant then leave the last under that id, and each draft where it
// was. The reader discards the one under the old id from its own
// screen, where they see what they discard.

/** How long a window goes on holding an id's lock after it placed a
 * draft under it. */
const CLAIM_HELD_MS = 2000;

/** The ids this window holds the lock of. */
const claims = new Set<string>();

/** The lock of an id's key, among the browser's own. */
function lockOf(agentId: string): string {
  return `cernanto.${FAMILY}${agentId}`;
}

/**
 * Does one thing to an id's key while no other window of the browser
 * places a draft under that id. Answers what the thing answered, and
 * `undefined`, the thing not done, where another window holds the id.
 * The thing is told whether this window holds the id alone: it does
 * not where the browser offers the page no lock, and what it does then
 * is done beside whatever another window does at that instant.
 */
function claimed<T>(agentId: string, act: (alone: boolean) => T): Promise<T | undefined> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  // This window holds the id's own lock already.
  if (claims.has(agentId)) return Promise.resolve(act(true));
  if (locks === undefined) return Promise.resolve(act(false));
  return new Promise((resolve, reject) => {
    let answered = false;
    locks
      .request(lockOf(agentId), { ifAvailable: true }, async (lock) => {
        answered = true;
        if (lock === null) {
          resolve(undefined);
          return;
        }
        claims.add(agentId);
        try {
          resolve(act(true));
          await new Promise((held) => {
            window.setTimeout(held, CLAIM_HELD_MS);
          });
        } finally {
          claims.delete(agentId);
        }
      })
      .catch((error: unknown) => {
        // The browser refused the asking itself, before it gave or
        // withheld the lock: the thing is done as where it offers none.
        // A failure of the thing itself is the caller's to hear.
        if (answered) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        try {
          resolve(act(false));
        } catch (failure) {
          reject(failure instanceof Error ? failure : new Error(String(failure)));
        }
      });
  });
}

/** How a draft's move to another id came out: it was moved; it stands
 * under the new id and under the old one too, the browser offering the
 * page no lock; the id is taken, by a draft that stands under it or by
 * a window placing one there at that moment; the browser did not keep
 * the draft under the new id; or there was no draft to move. */
export type Moved = 'moved' | 'copied' | 'taken' | 'unkept' | 'gone';

/** The drafts this window left under their old id when it gave them
 * another: the new id, and the old one beside it. */
const leftUnder = new Map<string, string>();

/** The id a draft stands under as well, where this window gave it the
 * id it has without removing it from the one it had; none otherwise. */
export function alsoUnder(agentId: string): string | undefined {
  return leftUnder.get(agentId);
}

/** Keeps a new draft where no draft stands under its id. */
function place(draft: Draft): boolean {
  if (currentDraft(draft.id) !== undefined) return false;
  saveDraft(draft);
  return true;
}

/**
 * Moves a draft to an id no draft stands under, its old key removed
 * only once the browser holds it under the new one, and only by a
 * window that holds the new id alone: without the id's lock another
 * window may place a draft there at this instant, its look showing
 * nothing of this one's write, and whichever write came first would be
 * gone with the key it was moved from.
 */
function move(from: string, to: string, alone: boolean): Moved {
  const draft = currentDraft(from);
  if (draft === undefined) return 'gone';
  if (from === to || currentDraft(to) !== undefined) return 'taken';
  // Under the new id first: a window closed between the two leaves both, never neither.
  saveDraft({ ...draft, id: to });
  if (!prefKept(FAMILY + to) && prefStored(FAMILY + from)) {
    dropDraft(to);
    return 'unkept';
  }
  if (!alone) {
    leftUnder.set(to, from);
    return 'copied';
  }
  dropDraft(from);
  leftUnder.delete(to);
  return 'moved';
}

/** Keeps a new draft; answers false, and keeps nothing, where a draft
 * stands under its id or another window places one there at that
 * moment: a new one never takes the place of another. */
export async function createDraft(draft: Draft): Promise<boolean> {
  return (await claimed(draft.id, () => place(draft))) ?? false;
}

/**
 * Gives a draft another id, and says how that came out. Nothing is
 * moved where there is none to move, where the id is taken, and where
 * the browser did not keep the draft under the new id while it holds
 * it under the old one: a draft leaves the key the browser holds it
 * under only once the browser holds it under another, so a rename
 * never leaves it kept nowhere. And it leaves that key only where the
 * browser gave this window the new id's lock: where it offers none,
 * the draft stands under both ids after.
 */
export async function renameDraft(from: string, to: string): Promise<Moved> {
  return (await claimed(to, (alone) => move(from, to, alone))) ?? 'taken';
}

/**
 * A draft after a deploy of it shipped. The draft that was sent is the
 * deployed source now, and leaves: undefined. What was typed after the
 * press is the next draft: it stays, on the ground of what shipped, so
 * it is held against the reader's own deploy and not against the one
 * before it.
 *
 * A file that went up with the deploy waits no more: it is in the
 * package the agent runs. One chosen after the press still waits, and
 * keeps the draft with it.
 *
 * @param shippedDigest - The package the deploy shipped, where the plane named it.
 * @param sent - The keys of the files that went up with the deploy.
 */
export function afterShip(
  draft: Draft,
  shippedText: string,
  shippedDigest: string | undefined,
  sent: readonly string[] = [],
): Draft | undefined {
  const waited = draft.files ?? [];
  const left = waited.filter((file) => !sent.includes(file.key));
  if (draft.text === shippedText && left.length === 0) return undefined;
  const rest = left.length === waited.length ? draft : withFiles(draft, left);
  if (shippedDigest === undefined) return rest;
  return { ...rest, base: shippedDigest, baseText: shippedText };
}

/** Settles an agent's draft after a deploy of it shipped. */
export function settleDraft(
  agentId: string,
  shippedText: string,
  shippedDigest: string | undefined,
  sent: readonly string[] = [],
): void {
  // What went up is the package's now, whatever became of the draft.
  if (sent.length > 0) void dropBytes(sent);
  const draft = currentDraft(agentId);
  if (draft === undefined) return;
  const next = afterShip(draft, shippedText, shippedDigest, sent);
  if (next === undefined) dropDraft(agentId);
  else if (next !== draft) saveDraft(next);
}

/** This browser's drafts, by agent id, and the functions that keep and drop one. */
export function useDrafts(): {
  drafts: Record<string, Draft>;
  save: (draft: Draft) => void;
  create: (draft: Draft) => Promise<boolean>;
  drop: (agentId: string) => void;
  /** Forgets a draft for good, with the files that waited with it. */
  discard: (agentId: string) => void;
  rename: (from: string, to: string) => Promise<Moved>;
} {
  const drafts = usePrefs<Draft>(FAMILY);
  return {
    drafts,
    save: saveDraft,
    create: createDraft,
    drop: dropDraft,
    discard: discardDraft,
    rename: renameDraft,
  };
}

/**
 * Whether the browser kept a draft as it was last written. Where it did
 * not, its storage full or closed to this page, the draft lasts as long
 * as the window, and the reader is told while the text can still be
 * copied.
 */
export function useDraftKept(agentId: string): boolean {
  return usePrefKept(FAMILY + agentId);
}

/** An id no agent and no draft holds, for a new agent: `new-agent-1`, then 2. */
export function freeId(taken: (agentId: string) => boolean): string {
  for (let n = 1; ; n += 1) {
    const id = `new-agent-${String(n)}`;
    if (!taken(id)) return id;
  }
}

/**
 * Carries the drafts kept as one record under a key a draft, the newer
 * of the two where both stand, and forgets the record once the browser
 * took every one of them.
 */
export function carryOver(): void {
  const old = getPref<unknown>(AS_ONE_RECORD, undefined);
  if (typeof old !== 'object' || old === null) return;
  let kept = true;
  for (const entry of Object.values(old as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const draft = entry as Partial<Draft>;
    if (typeof draft.id !== 'string' || typeof draft.text !== 'string') continue;
    const held = currentDraft(draft.id);
    const newer = held === undefined || held.updatedAt < (draft.updatedAt ?? '');
    // One the window holds and the browser did not take is written again.
    if (newer) saveDraft({ updatedAt: '', ...draft, id: draft.id, text: draft.text });
    else if (!prefKept(FAMILY + draft.id)) saveDraft(held);
    kept &&= prefKept(FAMILY + draft.id);
  }
  if (kept) setPref(AS_ONE_RECORD, undefined);
}

if (typeof window !== 'undefined') {
  carryOver();
  // The files no draft names any more are let go of.
  void sweepBytes(
    new Set(
      Object.values(currentDrafts()).flatMap((draft) =>
        (draft.files ?? []).map((file) => file.key),
      ),
    ),
  );
}
