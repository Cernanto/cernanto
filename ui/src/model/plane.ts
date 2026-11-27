// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What a reader says of the plane a screen stands on: its kind, which
// decides how carefully the screen acts, and a name of their own for
// it. A plane always has a kind: until the reader chooses one, it
// follows from the address the browser reached the plane at.

/** The kinds a plane is one of. */
export const PLANE_KINDS = ['LOCAL', 'TEST', 'STAGING', 'PRODUCTION'] as const;
export type PlaneKind = (typeof PLANE_KINDS)[number];

/** What the browser keeps once the reader said something of a plane. */
export interface PlaneSaid {
  kind?: PlaneKind;
  name?: string;
}

/** A plane as every screen reads it. */
export interface Plane {
  /** The reader's choice, or the kind its address starts it with. */
  kind: PlaneKind;
  /** The reader's own name for it, empty when they gave none. */
  name: string;
  /** Whether the kind is the reader's own choice. */
  chosen: boolean;
}

/** Whether an address is this machine's own: the loopback, by its
 * name or by its number, with or without a port. */
export function ownMachine(address: string): boolean {
  const lowered = address.trim().toLowerCase();
  const host = lowered.startsWith('[')
    ? lowered.slice(0, lowered.indexOf(']') + 1)
    : (lowered.split(':')[0] ?? '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

/** The kind a plane has before the reader chose one: a plane on this
 * machine is one to play on, and a plane anywhere else is handled
 * with care until the reader says what it is. */
export function startingKind(address: string): PlaneKind {
  return ownMachine(address) ? 'LOCAL' : 'PRODUCTION';
}

/** The plane at an address, from what the browser keeps of it. What it
 * keeps is read as it is found: a kind that is none of the four, or a
 * name that is no text, counts as not said. */
export function planeOf(said: unknown, address: string): Plane {
  const held = typeof said === 'object' && said !== null ? (said as Record<string, unknown>) : {};
  const kind = PLANE_KINDS.find((option) => option === held['kind']);
  const name = typeof held['name'] === 'string' ? held['name'].trim() : '';
  return { kind: kind ?? startingKind(address), name, chosen: kind !== undefined };
}

/** Whether a mistake costs nothing here: a plane to play on, where the
 * screen acts at once and no button carries the kind. */
export function isPlayground(plane: Plane): boolean {
  return plane.kind === 'LOCAL' || plane.kind === 'TEST';
}

/** What the reader calls the plane: their name for it, or its address. */
export function planeLabel(plane: Plane, address: string): string {
  return plane.name === '' ? address : plane.name;
}

/** Where an act lands, as a dialog that confirms says it: the name
 * with the address beside it, or the address alone. */
export function planeWhere(plane: Plane, address: string): string {
  return plane.name === '' ? address : `${plane.name} (${address})`;
}
