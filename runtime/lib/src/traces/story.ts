// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The story: what the traces keep, they keep by the story, one call in
// one request. A call's id is a name a caller's key or a call asked anew
// rides again, and several linked calls share one request, so a story's
// id is one string: the call's handle (`<service>:<generation>:<call>`)
// with the request's own part after one more colon, and a linked call's
// its host's story with the link's mark after it
// (`~<attempt>:<ordinal>`), as its call id is its host's with that mark.
// A service name, a generation and a call id never carry a colon, so the
// story's id is cut back to the call's id exactly. A call that rides no
// request (a process's boot call) is its own story. The language keeps
// the call's id as it is.

/** The story of a request: the handle of its call at the destination
 * the caller chose (`<service>:<generation>:<call>`, the shape of a
 * call's handle), the request's own part after it. */
export function storyOf(
  destination: { service: string; generation: string },
  request: string,
): string {
  const at = request.lastIndexOf(':');
  const callId = at === -1 ? request : request.slice(0, at);
  const own = at === -1 ? '' : request.slice(at + 1);
  return `${destination.service}:${destination.generation}:${callId}:${own}`;
}

/** The story of a linked call: its host's story and the link's mark. */
export function linkedStoryOf(
  hostStory: string,
  attempt: string | undefined,
  ordinal: number,
): string {
  return `${hostStory}~${attempt === undefined ? '' : `${attempt}:`}${String(ordinal)}`;
}

/** An id's head (before a link's mark) and its mark. */
function splitMark(id: string): [string, string] {
  const mark = id.indexOf('~');
  return mark === -1 ? [id, ''] : [id.slice(0, mark), id.slice(mark)];
}

/** The request a story belongs to: a request's story is its own, and a
 * linked call's is the story its id begins with, the head before the
 * first link's mark, the calls linked inside others included. */
export function requestOfStory(story: string): string {
  return splitMark(story)[0];
}

/** The call's id a story rides: the request's own part cut off the head
 * (the part before a link's mark), the mark kept. A story that names no
 * request is its call's id already. */
export function callOfStory(story: string): string {
  const [head, tail] = splitMark(story);
  const parts = head.split(':');
  return `${parts.length === 4 ? parts.slice(0, 3).join(':') : head}${tail}`;
}

/** The order of two runs: by the grant, then by the count under it. A
 * run that names no grant (a record made outside any call) stands
 * first. */
export function compareRuns(left: string, right: string): number {
  const [leftGrant = 0, leftCount = 0] = left.split('.').map(Number);
  const [rightGrant = 0, rightCount = 0] = right.split('.').map(Number);
  return leftGrant - rightGrant || leftCount - rightCount;
}

/** A run's id: the grant by which its process owns the log the request
 * lies in, and the run's count under it. */
export function runId(grant: number, count: number): string {
  return `${String(grant)}.${String(count)}`;
}
