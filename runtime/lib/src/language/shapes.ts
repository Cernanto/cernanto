// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A call crosses the wire, and sits in the journal, as JSON, which has
// no date and no bytes: a Date leaves as its ISO text, a Uint8Array as
// base64 text (kernel/json.ts spells it so wherever the runtime writes
// JSON). The contract says where they are, and both sides of a call
// hold the same contract, so the materialize reads the shape of each
// function's argument and answer from the declaration file and the glue
// revives the text on the side that receives it: the served handler's
// argument before it runs, the stub's answer before it returns, on a
// fresh call and on a replay from the journal alike.

/** Where the dates and the bytes lie inside a value: a Date or a
 * Uint8Array itself, the fields of an object that carry one (the
 * places of a tuple, by their numbers), every item of a list, every
 * value of a record. A shape names only what carries one. */
export type WireShape =
  | 'date'
  | 'bytes'
  | { fields: Record<string, WireShape> }
  | { items: WireShape }
  | { values: WireShape };

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof Date)
  );
}

/** The value with the wire's text at every place the shape names
 * turned back, in place: ISO text into a Date, base64 text into bytes
 * (a Buffer, which is a Uint8Array). A Date or bytes already, or text
 * that is no date, stays as it is, and so does a value the shape does
 * not describe. */
export function reviveWire<T>(value: T, shape: WireShape | undefined): T {
  // A place with no shape is left as it came, whether it says so as
  // nothing or, through a JSON text of shapes, as `null`.
  if (shape === undefined || (shape as unknown) === null) return value;
  if (shape === 'date') {
    if (typeof value !== 'string') return value;
    const date = new Date(value);
    return (Number.isNaN(date.getTime()) ? value : date) as T;
  }
  if (shape === 'bytes') {
    return (typeof value === 'string' ? Buffer.from(value, 'base64') : value) as T;
  }
  if ('items' in shape) {
    if (!Array.isArray(value)) return value;
    const items: unknown[] = value;
    for (let index = 0; index < items.length; index += 1) {
      items[index] = reviveWire(items[index], shape.items);
    }
    return value;
  }
  if ('fields' in shape && Array.isArray(value)) {
    // A tuple: its places are fields named by their numbers.
    const places: unknown[] = value;
    for (const [key, sub] of Object.entries(shape.fields)) {
      const place = Number(key);
      if (Number.isInteger(place) && place >= 0 && place < places.length) {
        places[place] = reviveWire(places[place], sub);
      }
    }
    return value;
  }
  if (!isRecord(value)) return value;
  const record: Record<string, unknown> = value;
  if ('fields' in shape) {
    for (const [key, sub] of Object.entries(shape.fields)) {
      if (key in record) record[key] = reviveWire(record[key], sub);
    }
    return value;
  }
  for (const key of Object.keys(record)) record[key] = reviveWire(record[key], shape.values);
  return value;
}

/** A served function whose argument carries dates or bytes: the
 * call's json is revived by the contract's shape before the function
 * runs. */
export function wiredHandler<T extends (...args: never[]) => unknown>(fn: T, shape: WireShape): T {
  const run = fn as unknown as (input: unknown) => unknown;
  const wrapped = (input: unknown): unknown => run(reviveWire(input, shape));
  return wrapped as unknown as T;
}
