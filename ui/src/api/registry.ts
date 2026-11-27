// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import {
  packageIndexSchema,
  packagesSummarySchema,
  REGISTRY_INDEX_DEFAULT,
  REGISTRY_SUMMARY_PATH,
  registryIndexPath,
} from '@cernanto/package-format/browser';
import type { PackageIndex, PackagesSummary } from '@cernanto/package-format/browser';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

// The public registry's read side, asked by the browser itself, as the
// cli asks it: static files on the packages host, one that lists every
// package and one a package for its versions. Nothing of the plane goes
// with a read, and the plane is not asked: it installs a package by its
// name, through its own road to the registry.

/** The packages host this screen reads. */
export const REGISTRY_HOST: string = new URL(REGISTRY_INDEX_DEFAULT).host;

/** A read of the registry that did not answer what was asked. */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

async function read(path: string, what: string, signal: AbortSignal | undefined): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${REGISTRY_INDEX_DEFAULT}${path}`, {
      ...(signal === undefined ? {} : { signal }),
      credentials: 'omit',
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    // A browser says no more than that the read failed: no network, or
    // a host that lets no page read it.
    throw new RegistryError(
      `The registry at ${REGISTRY_HOST} could not be read from this browser.`,
    );
  }
  if (response.status === 404 || response.status === 403) {
    throw new RegistryError(`The registry holds no ${what}.`);
  }
  if (!response.ok) {
    throw new RegistryError(`The registry answered ${String(response.status)} for ${what}.`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new RegistryError(`The registry answered ${what} in a form this screen does not read.`);
  }
}

/** The registry's summary: every package with its newest version. */
export async function readRegistry(signal?: AbortSignal): Promise<PackagesSummary> {
  const parsed = packagesSummarySchema.safeParse(
    await read(REGISTRY_SUMMARY_PATH, 'list of packages', signal),
  );
  if (!parsed.success) {
    throw new RegistryError('The registry answered its list in a form this screen does not read.');
  }
  return parsed.data;
}

/** One package's own index: its versions, each with its kind and what it uses. */
export async function readRegistryPackage(
  name: string,
  signal?: AbortSignal,
): Promise<PackageIndex> {
  const parsed = packageIndexSchema.safeParse(
    await read(registryIndexPath(name), `package ${name}`, signal),
  );
  if (!parsed.success) {
    throw new RegistryError(`The registry answered ${name} in a form this screen does not read.`);
  }
  return parsed.data;
}

/** The registry's summary, read when a screen that lists it is opened
 * and kept for a minute, as long as the registry lets its own copy stand. */
export function useRegistry(enabled = true): UseQueryResult<PackagesSummary> {
  return useQuery({
    queryKey: ['registry'],
    queryFn: ({ signal }) => readRegistry(signal),
    enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** One package's own index, read when the package is looked at. */
export function useRegistryPackage(name: string | undefined): UseQueryResult<PackageIndex> {
  return useQuery({
    queryKey: ['registry-package', name ?? ''],
    queryFn: ({ signal }) => readRegistryPackage(name ?? '', signal),
    enabled: name !== undefined,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
