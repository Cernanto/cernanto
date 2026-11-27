// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { Command } from 'commander';

import { registerAuth } from './auth.js';
import { registerAgent } from './agent.js';
import { registerCancel } from './cancel.js';
import { registerCluster } from './cluster.js';
import { registerCompiled } from './compiled.js';
import { registerCompletion } from './completion.js';
import { registerConfig } from './config.js';
import { registerContext } from './context.js';
import { registerContract } from './contract.js';
import { registerCompile } from './deploy/compile.js';
import { registerBareFileForm, registerDeploy } from './deploy/deploy.js';
import { registerDev } from './dev.js';
import { registerInvoke } from './invoke.js';
import { registerLogin } from './login.js';
import { registerRegistry, registryClient } from './registry.js';
import { registerRegistryGet } from './registry-get.js';
import { registerRestart } from './restart.js';
import { registerSkill } from './skill.js';
import { registerSource } from './source.js';
import { registerCalls } from './calls.js';
import { registerTests } from './tests.js';
import { registerToken } from './token.js';
import { registerLs } from './ls.js';
import { registerTrace } from './trace.js';
import { registerTraces } from './traces.js';
import { registerUi } from './ui.js';
import { CLI_VERSION } from './version.js';

// The command tree: every verb lives in its own module and registers
// itself here, one line per module, in the order the help lists them.
// What belongs to the process (the context override, the plane that
// starts when needed and the exit codes) is main.ts's, so the verb-set
// and layout proofs compile the tree on its own.

/** What a newcomer's reflex from another tool maps onto here: the
 * unknown-verb line names the verb they meant. Every job has one name. */
const SYNONYMS: [RegExp, string][] = [
  [/^(top|list|ps)$/, 'cernanto ls lists every agent'],
  [/^invoke$/, 'cernanto call <agent> <function> calls one of its functions'],
  [/^logs?$/, "an agent's live stream is: cernanto trace <agent> -f"],
  [
    /^(doctor|health|status)$/,
    'cernanto dev says whether the plane is up; cernanto ls lists its agents',
  ],
  [/^(install|apply|up)$/, 'cernanto deploy <x> lands an agent, a file or a registry package'],
  [/^build$/, 'cernanto compile writes the package without deploying'],
  [/^(rm|remove|uninstall|undeploy)$/, 'cernanto delete <x> undeploys an agent'],
  [/^init$/, 'nothing needs scaffolding: write a spec file and deploy it with cernanto deploy'],
  [/^runs$/, 'cernanto calls lists the recent calls'],
  [/^skills$/, "cernanto skill installs the author's skill for your coding assistant"],
  [
    /^describe$/,
    'cernanto contract <agent> prints its functions, cernanto compiled <agent> its code, cernanto tests <agent> its tests and cernanto source <agent> its page',
  ],
  [/^code$/, 'cernanto compiled <agent> prints the code the compile wrote'],
  [/^(spec|page)$/, 'cernanto source <agent> prints the page an agent was compiled from'],
  [/^(deps|tree)$/, 'cernanto contract <agent> says what it uses and who uses it'],
  [
    /^(publish|search|info|yank|deprecate|star|unstar|report)$/,
    'the registry verbs live under it: cernanto registry publish <x>, search, yank, deprecate',
  ],
  [
    /^(get|fetch|pull|clone|download)$/,
    'cernanto registry get <name or folder/> brings a registry package into this folder as source',
  ],
  [
    /^(start|run|up)$/,
    "cernanto deploy <x> runs an agent, and cernanto call <module> <function> starts a module by itself; cernanto restart <x> runs a service's, a worker's or a job's program again",
  ],
  [
    /^(stop|pause|resume|down|kill)$/,
    'cernanto delete <x> stops and removes an agent, a module by itself as <module>-standalone; cernanto restart <x> runs a program again from the top',
  ],
  [/^(connect|account)$/, 'cernanto auth login <agent> [name] logs an account in'],
  [
    /^(open|web|browser|console|dashboard|gui)$/,
    "cernanto ui opens the plane's UI in your browser",
  ],
  [/^(watch|tail|follow)$/, 'cernanto trace <agent> -f follows an agent live'],
  [
    /^(events|history)$/,
    'cernanto calls lists the recent calls; cernanto contract <agent> says when it was deployed',
  ],
];

function unknownVerb(word: string): never {
  const hint = SYNONYMS.find(([pattern]) => pattern.test(word))?.[1];
  process.stderr.write(
    `error: unknown command '${word}'${hint === undefined ? '' : `; ${hint}`}\nsee: cernanto --help\n`,
  );
  process.exit(2);
}

/** The whole program, its verbs registered module by module. */
export function compileProgram(): Command {
  const program = new Command('cernanto')
    .description('plain-English specs compiled into verified agents, run on a plane')
    .usage('<command> [options]\n       cernanto <spec.cern.md | package.cern>      deploys it')
    .addHelpText(
      'after',
      // The first steps are ones a new machine can take: the plane, then
      // a precompiled example from the repository, which lands with
      // Node alone, and only then an agent of one's own, which a compile
      // needs a coding assistant for.
      [
        '',
        'Start here:',
        '  cernanto dev                                 start the local plane; the first start installs its runtime',
        "  cernanto ui                                  open the plane's UI in your browser",
        '  git clone https://github.com/cernanto/cernanto && cd cernanto/agents',
        '  cernanto deploy examples/basics/counter      land a precompiled example',
        '  cernanto call examples/basics/counter next   call it: 1, then 2',
        '  cernanto trace examples/basics/counter       read the call',
        '',
        'An agent of your own is one page of plain English, <id>.cern.md:',
        '  cernanto ops/reminder.cern.md                compile it, prove it live and run it',
        '',
      ].join('\n'),
    )
    .version(CLI_VERSION, '--version', "the cli's version");
  program.option('--context <name>', 'the plane context for this run (the current one otherwise)');

  // The help lists the verbs in this order: the agents' every day
  // first (deploy, call, trace, ls, contract, compiled, tests, source,
  // calls, delete, then the restart of a program), then their accounts
  // and settings (what is set for an agent, and what its traces stand
  // at), then the plane, then the rest.
  registerDeploy(program);
  registerInvoke(program);
  registerTrace(program);
  registerLs(program);
  registerContract(program);
  registerCompiled(program);
  registerTests(program);
  registerSource(program);
  registerCalls(program);
  registerAgent(program);
  registerRestart(program);
  registerSkill(program);
  registerAuth(program);
  registerConfig(program);
  registerTraces(program);
  registerDev(program);
  registerUi(program);
  registerLogin(program);
  registerContext(program);
  registerToken(program);
  registerCompile(program);
  // A get reads the registry with no sign-in, as a search does.
  registerRegistryGet(registerRegistry(program), async () => (await registryClient(false)).client);
  registerCancel(program);
  registerCluster(program);
  registerCompletion(program);
  registerBareFileForm(program, unknownVerb);
  return program;
}
