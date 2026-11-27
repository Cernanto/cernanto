// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/** What a key's event says of an input method at work. */
export interface KeyOfAField {
  nativeEvent: { isComposing?: boolean };
  keyCode?: number;
}

/**
 * Whether a key was pressed while an input method composes a text, as
 * Japanese, Chinese and Korean are typed. The Enter that takes its
 * suggestion, the arrows that walk its candidates and the Escape that
 * leaves it are the input method's own: no send, search or choice of
 * the page's. Most browsers say so on the event; Safari ends the
 * composition before it tells the key, and marks the key by its code
 * alone.
 */
export function composing(event: KeyOfAField): boolean {
  return event.nativeEvent.isComposing === true || event.keyCode === 229;
}
