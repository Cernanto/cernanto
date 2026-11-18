// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { fail } from './output.js';
import { ServerClient } from './server-client.js';

// `cernanto config`: the plane's configuration, server-side and live
// for every node (the client's own settings are its contexts, kept by
// `context`). A setting stands under the agent that reads it, which
// reads it by its name alone, and an interface's one setting is its
// `default`, the implementor a consumer gets when it names none. The
// verb takes the agent first, then a name, and a write always carries
// an `=`:
//
//   cernanto config                          the whole configuration
//   cernanto config <agent>                  that agent's settings
//   cernanto config <agent> <name>           one value
//   cernanto config <agent> <name>=<value>   set it; name=null removes it
//
// On the wire a key is one path, `<agent id>/<name>`, and the verb
// joins its two words into it: a thin verb over the gateway's three
// config operations onto cernanto/config, which owns every rule. The
// whole configuration is secret: the three operations and the config
// agent's asks carry the mark, so no record on the plane keeps a key, a
// value or the listing, and a write echoes its key alone.

/** The slice of the plane client this verb needs: the gateway's three
 * config operations, as the operator. */
export interface ConfigClient {
  configGet(key: string): Promise<{ value?: unknown }>;
  configSet(key: string, value: unknown): Promise<{ present: boolean }>;
  configList(place?: string): Promise<{ configuration?: unknown }>;
}

/** The verb's form, as a refusal shows it. */
const FORM =
  'cernanto config [<agent> [<name> | <name>=<value>]]: no words show the whole configuration, an agent its settings, a name one value, and name=value sets it (name=null removes it)';

/** A value arrives as part of a word on a command line: JSON when it
 * parses as JSON (numbers, booleans, null, quoted strings, objects),
 * the plain string otherwise, so `model=o3` needs no quoting,
 * `retention-minutes=60` stores a number and nothing after the `=` is
 * the empty string. */
export function parseConfigValue(word: string): unknown {
  try {
    return JSON.parse(word) as unknown;
  } catch {
    return word;
  }
}

/** What the words after `config` ask for. */
export type ConfigAsk =
  | { ask: 'all' }
  | { ask: 'place'; place: string }
  | { ask: 'read'; key: string }
  | { ask: 'write'; key: string; value: unknown };

/** A setting's name under an agent, refused when it is empty or
 * carries a slash: the verb joins its two words into the key and the
 * plane splits a key at its last slash, so a name with a slash would
 * name a setting of another agent. */
function nameUnder(agent: string, name: string): string {
  if (name === '') throw new Error(`a setting's name is not empty. ${FORM}`);
  const slash = name.lastIndexOf('/');
  if (slash !== -1) {
    throw new Error(
      `a setting's name carries no slash: "${name}" under ${agent} is the setting "${name.slice(slash + 1)}" of the agent ${agent}/${name.slice(0, slash)}; name that agent first`,
    );
  }
  return name;
}

/** Reads the words after `config`: none, an agent, an agent and a
 * name, or an agent and `name=value`, the word split at its first `=`
 * with everything after it the value. */
export function readConfigWords(words: readonly string[]): ConfigAsk {
  const [agent, setting, ...more] = words;
  if (agent === undefined) return { ask: 'all' };
  if (more.length > 0) {
    throw new Error(
      `config takes an agent and at most one more word, and name=value is one word with no space around the "=". ${FORM}`,
    );
  }
  if (agent.includes('=')) throw new Error(`the agent comes first. ${FORM}`);
  if (setting === undefined) return { ask: 'place', place: agent };
  const equals = setting.indexOf('=');
  if (equals === -1) return { ask: 'read', key: `${agent}/${nameUnder(agent, setting)}` };
  const name = nameUnder(agent, setting.slice(0, equals));
  return {
    ask: 'write',
    key: `${agent}/${name}`,
    value: parseConfigValue(setting.slice(equals + 1)),
  };
}

export async function configGet(client: ConfigClient, key: string): Promise<string> {
  const answer = await client.configGet(key);
  const value = answer.value ?? null;
  if (value === null) return `${key} is not set\n`;
  return `${JSON.stringify(value)}\n`;
}

/** A write echoes the key alone, never the value: the configuration is
 * secret, and the operator typed the value a moment ago. */
export async function configSet(
  client: ConfigClient,
  key: string,
  value: unknown,
): Promise<string> {
  const { present } = await client.configSet(key, value);
  return present ? `${key} set\n` : `${key} removed\n`;
}

/** Reads the configuration as a mapping: one agent's settings, or
 * every agent's (empty when nothing stands). */
export async function configuration(
  client: ConfigClient,
  place?: string,
): Promise<Record<string, unknown>> {
  const answer = await client.configList(place);
  const mapping = answer.configuration;
  if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) return {};
  return mapping as Record<string, unknown>;
}

export async function configList(client: ConfigClient, place?: string): Promise<string> {
  const mapping = await configuration(client, place);
  if (Object.keys(mapping).length === 0) {
    return place === undefined
      ? 'the configuration is empty\n'
      : `${place} has no settings and no default\n`;
  }
  return `${JSON.stringify(mapping, null, 2)}\n`;
}

/** The verb whole: what the words ask for, asked of the plane. */
export async function config(client: ConfigClient, words: readonly string[]): Promise<string> {
  const asked = readConfigWords(words);
  if (asked.ask === 'all') return configList(client);
  if (asked.ask === 'place') return configList(client, asked.place);
  if (asked.ask === 'read') return configGet(client, asked.key);
  return configSet(client, asked.key, asked.value);
}

export function registerConfig(program: Command): void {
  program
    .command('config')
    .argument('[agent]', "an agent's id: that agent's settings; none: the whole configuration")
    .argument(
      '[setting]',
      "a setting's name reads it; name=value writes it, plane-wide, no restart needed: json when the value parses as json, the plain word otherwise, and name=null removes it",
    )
    .allowExcessArguments(true)
    .description(
      "the plane's configuration, a setting under the agent that reads it: show it all, one agent's, one value, or set one with name=value",
    )
    .action(async (_agent: unknown, _setting: unknown, _options: unknown, command: Command) => {
      try {
        process.stdout.write(await config(new ServerClient(), command.args));
      } catch (error) {
        fail(error);
      }
    });
}
