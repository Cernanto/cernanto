// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { TraceRecord } from '../gateway/types.gen.js';

// What a call was asked and what it answered, in a line each, as
// `cernanto calls` writes them. The plane's list of calls holds a
// call's facts alone; its input and its answer stand in its own records.

/** The longest a line is kept; the screen cuts it to the room it has. */
const KEPT = 240;

/**
 * A value in one line: a string bare, a number or a boolean as it is,
 * an object as `key: value` pairs, anything else as compact JSON.
 *
 * @example
 * oneLine({ ticker: 'ibm', days: 3 }); // => 'ticker: ibm, days: 3'
 */
export function oneLine(value: unknown): string {
  const compact = (one: unknown): string =>
    typeof one === 'string' ? one : one === undefined ? '' : JSON.stringify(one);
  const text =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
          .map(([key, one]) => `${key}: ${compact(one)}`)
          .join(', ')
      : compact(value);
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > KEPT ? `${flat.slice(0, KEPT - 1)}…` : flat;
}

/** What a call's records say of its input and its answer. */
export interface CallStory {
  /** What the call was asked, when its records say. */
  input?: unknown;
  /** What it answered, when it answered a value. */
  output?: unknown;
  /** Whether its records hold its end at all: a call whose records are
   * no longer kept, or that still runs, has none. */
  answered: boolean;
}

/**
 * Reads a call's input off the begin of its function, and its answer
 * off its last record of that function. A call's records are read a
 * page after the other, and its answer is its LAST record of the
 * function, on whichever page that stands: a page that ends on a run
 * that failed says nothing of the run after it. So a story is read on
 * from the story of the pages before, to the call's last page.
 *
 * @param earlier - The story the pages before this one told; none for a call's first page.
 */
export function storyOf(records: TraceRecord[], earlier?: CallStory): CallStory {
  const story: CallStory = earlier === undefined ? { answered: false } : { ...earlier };
  for (const record of records) {
    if (record.kind === 'begin' && record.of === 'handler' && 'input' in record) {
      story.input = record.input;
    }
    if (record.kind === 'handler') {
      story.answered = true;
      if ('output' in record) story.output = record.output;
      if (story.input === undefined && 'input' in record) story.input = record.input;
    }
  }
  return story;
}

/** What a call was asked and answered, with how many calls it made. */
export type CallStoryRead = CallStory & { made: number };

/** A page of a call's records, as far as its story reads one. */
export interface StoryPage {
  records: TraceRecord[];
  /** The calls the call made. */
  children: unknown[];
  /** Present when records remain after this page: where the next begins. */
  next?: number;
}

/**
 * A call's story read to the call's last page, as the cli's `calls`
 * reads it: the plane cuts a call's records into pages by their weight,
 * and what the call answered stands on the last. Only the story is kept
 * of each page, so a call of many pages weighs no more here than one of
 * a few records.
 *
 * @param page - Reads the page that begins after a count of records; the first where none is given.
 * @param enough - Says a story holds all that was wanted of it, so no further page is read; left out, the call is read to its last page.
 */
export async function readCallStory(
  page: (after: number | undefined) => Promise<StoryPage>,
  enough?: (story: CallStory) => boolean,
): Promise<CallStoryRead> {
  let story: CallStory | undefined;
  let after: number | undefined;
  for (;;) {
    const read = await page(after);
    story = storyOf(read.records, story);
    // A page that names no next one, or that holds nothing, is the last;
    // the calls a call made are told with every page, whole.
    if (read.next === undefined || read.records.length === 0 || enough?.(story) === true) {
      return { ...story, made: read.children.length };
    }
    after = read.next;
  }
}

/** Whether a story says what its call was asked: nothing more is read
 * of a call for that alone. */
export function tellsInput(story: CallStory): boolean {
  return story.input !== undefined;
}
