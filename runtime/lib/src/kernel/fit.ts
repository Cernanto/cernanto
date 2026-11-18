// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// What the plane itself decides: the implementor of every interface
// that follows from what the plane is, and from nobody's choice. The
// store's three follow the plane's place. One rule in one place: the
// bind asks it where an interface has several implementors linked, and
// the install asks it for the packages a machine leaves out.

import { processFacts } from './facts.js';
import { STORE_IMPLEMENTORS } from './seam.js';

/** The store a plane's place is: the cloud's at a `dynamodb:` url, the
 * files' anywhere else. */
export type StoreKind = 'files' | 'dynamodb';

/** The store a place names. */
export function storeKindOfPlace(place: string | undefined): StoreKind {
  return place?.startsWith('dynamodb:') === true ? 'dynamodb' : 'files';
}

/** The fit of a machine: each interface the plane decides, to the
 * implementor of it on that store, by the seam's table. */
export function planeFit(store: StoreKind): Readonly<Record<string, string>> {
  return STORE_IMPLEMENTORS[store];
}

/** Every implementor of an interface the plane decides, on any
 * machine. */
export function planeImplementors(): string[] {
  return [
    ...new Set([
      ...Object.values(STORE_IMPLEMENTORS.files),
      ...Object.values(STORE_IMPLEMENTORS.dynamodb),
    ]),
  ].sort();
}

/** The packages a machine leaves out: the implementors of the plane's
 * interfaces that are not the ones that fit it. Every other package
 * fits every machine. */
export function leftOutOn(store: StoreKind): string[] {
  const fits = new Set(Object.values(planeFit(store)));
  return planeImplementors().filter((id) => !fits.has(id));
}

/** The fit of this process: of the plane's place it was handed. A
 * function of what every process of a plane holds, a tester's suite
 * child among them, so it is handed to nobody. */
export function processFit(): Readonly<Record<string, string>> {
  const facts = processFacts();
  const store: StoreKind =
    facts.substrate === 'dynamodb-s3'
      ? 'dynamodb'
      : facts.substrate === 'files-sqlite'
        ? 'files'
        : storeKindOfPlace(facts.substrateUrl);
  return planeFit(store);
}

/** What the plane binds an interface it decides to in this process, of
 * the implementors linked into it. A machine holds the packages that
 * fit it, so the one implementor linked is the one that fits and is the
 * one bound; where several are linked (the tree's own plane, which
 * holds every package) the one that fits is; where none is, the one
 * that fits is named for the bind that follows to say what is missing.
 * A lone implementor that does not fit is `misinstalled`: the release
 * was laid for another place, and binding it would keep the plane's
 * records in a store the plane does not run on.
 * Nothing when the plane does not decide the interface: an operator's
 * default chooses there. */
export function planeBinding(
  interfaceId: string,
  linked: readonly string[] = [],
): { implementor: string; misinstalled?: string } | undefined {
  const fits = processFit()[interfaceId];
  if (fits === undefined) return undefined;
  const [only] = linked;
  if (linked.length === 1 && only !== undefined && only !== fits) {
    return { implementor: fits, misinstalled: only };
  }
  return { implementor: fits };
}
