// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The machine's basics a child of the plane starts with, made by one
// rule on every system from the environment of the process that
// starts it. One list names what is handed on; a name the environment
// does not have is not handed on, so a system's own names ride where
// that system set them and nowhere else.

import { homedir, tmpdir, userInfo } from 'node:os';

/** The names of the variables a child process stands on, beside what
 * its parent gives it on purpose: the ones every system's child needs,
 * and the ones a Windows program needs, which no other system sets. */
export const CHILD_ENVIRONMENT_NAMES: readonly string[] = [
  'PATH',
  'HOME',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'LANG',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'SystemRoot',
  'windir',
  'SystemDrive',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'USERNAME',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
];

/** The operator's own places and names. */
export interface Operator {
  /** The home folder, where the vendor tools keep their logins. */
  home: string;
  /** The account's name. */
  user: string;
  /** The folder for temporary files. */
  tmpdir: string;
  /** The search path for programs, with the system's own when none is set. */
  path: string;
}

/** The search path for programs when the environment names none, by
 * what the environment itself says of the system: where it names the
 * system's own folder (`SystemRoot`), that folder and its tools;
 * elsewhere the usual three. */
export function defaultPath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = env['SystemRoot'] ?? env['SYSTEMROOT'];
  return systemRoot === undefined || systemRoot === ''
    ? '/usr/local/bin:/usr/bin:/bin'
    : `${systemRoot}\\System32;${systemRoot}`;
}

/** The operator's places and names: the environment's word first, the
 * system's own after it (Node reads the home and the temp folder the
 * way each system names them, and the account from the system). */
export function operatorOf(env: NodeJS.ProcessEnv, path: string = defaultPath(env)): Operator {
  let account: string | undefined;
  try {
    account = userInfo().username;
  } catch {
    account = undefined;
  }
  return {
    home: env['HOME'] ?? env['USERPROFILE'] ?? homedir(),
    user: env['USER'] ?? env['LOGNAME'] ?? env['USERNAME'] ?? account ?? 'cernanto',
    tmpdir: env['TMPDIR'] ?? env['TEMP'] ?? env['TMP'] ?? tmpdir(),
    path: env['PATH'] ?? path,
  };
}

/** The names the operator's places and names are read under. */
const OPERATOR_NAMES: readonly string[] = [
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'USERNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PATH',
];

/** The first of the names the environment sets to something. */
function firstSet(env: NodeJS.ProcessEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/** What an environment sets under the names of a list, each under the
 * list's own spelling: the one way a child's environment is chosen
 * from its parent's, whoever starts the child. Every name is asked of
 * the environment itself, which on a system that reads a name whatever
 * its case answers it so; an empty word is no word; and nothing the
 * list does not name is handed on. */
export function setUnder(env: NodeJS.ProcessEnv, names: readonly string[]): Record<string, string> {
  const set: Record<string, string> = {};
  for (const name of names) {
    const value = firstSet(env, [name]);
    if (value !== undefined) set[name] = value;
  }
  return set;
}

/** The basics by the one rule: every name of the list as set; the
 * home, the user, the temp folder and the search path the environment
 * names, and the system's own answer where it names none; a proxy from
 * either spelling, under the upper-case name a vendor's tool reads;
 * and the certificate file under both its names when either is set. An
 * empty word is no word. A child started with these holds the
 * machine's basics whatever the starting process's own environment
 * left unsaid. */
export function childEnvironmentOf(
  env: NodeJS.ProcessEnv,
  names: readonly string[] = CHILD_ENVIRONMENT_NAMES,
  path: string = defaultPath(env),
): Record<string, string> {
  const basics = setUnder(env, names);
  const own = operatorOf(setUnder(env, OPERATOR_NAMES), path);
  basics['HOME'] = own.home;
  basics['USER'] = own.user;
  basics['LOGNAME'] = own.user;
  basics['TMPDIR'] = own.tmpdir;
  basics['PATH'] = own.path;
  for (const [upper, lower] of [
    ['HTTP_PROXY', 'http_proxy'],
    ['HTTPS_PROXY', 'https_proxy'],
    ['NO_PROXY', 'no_proxy'],
  ] as const) {
    const proxy = firstSet(env, [upper, lower]);
    if (proxy !== undefined) basics[upper] = proxy;
  }
  const certificates = firstSet(env, ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']);
  if (certificates !== undefined) {
    basics['NODE_EXTRA_CA_CERTS'] = certificates;
    basics['SSL_CERT_FILE'] = certificates;
  }
  return basics;
}

/** The machine's basics a child of the plane starts with, made from
 * this process's environment. */
export function childEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return childEnvironmentOf(env);
}
