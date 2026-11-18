// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The proofs' home folder: a proof of what the cli does in a person's
// home folder names a folder of its own for one, by the two variables a
// system tells a process its home in, and gives the process its own
// back when it ends.

const NAMES = ['HOME', 'USERPROFILE'] as const;

/** Runs with `home` as the process's home folder. */
export async function asHome<T>(home: string, run: () => T | Promise<T>): Promise<T> {
  const before = NAMES.map((name) => [name, process.env[name]] as const);
  for (const name of NAMES) process.env[name] = home;
  try {
    return await run();
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  }
}
