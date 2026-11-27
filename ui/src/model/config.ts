// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// An agent's config is what a person sets for it, each thing a name and
// a value, kept by the plane under the agent's id. The screen writes a
// value as the cli's `name=value` does and shows one as the cli prints
// it.

/** A value as it is typed on a command line: JSON when it parses as
 * JSON, the plain text otherwise, so a word needs no quotes. */
export function settingValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A value as it is shown: a text as it is, anything else as the JSON it is. */
export function shownValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** What refuses a setting's name, in words, or nothing. */
export function settingNameTrouble(name: string): string | undefined {
  return name.includes('/') ? 'A name carries no slash.' : undefined;
}

/**
 * The implementors an interface's default is chosen among: the ones the
 * plane runs, and the one that stands where the plane runs it no more,
 * so the field never shows another than the one that stands.
 *
 * @param implementors - The agents that implement the interface.
 * @param standing - The default that stands, empty where none does.
 */
export function defaultChoices(implementors: readonly string[], standing: string): string[] {
  return standing === '' || implementors.includes(standing)
    ? [...implementors]
    : [...implementors, standing];
}
