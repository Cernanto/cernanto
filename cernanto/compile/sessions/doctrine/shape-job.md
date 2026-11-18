## The job shape

A job serves isolated calls that run live: each exported function
runs inside one durable call with no journal of its own, so its
commands, network calls, randomness and timers run for real and
concurrent awaits are fine. A retryable failure starts the body again from its
first line, a plain error ends the call, a process that dies mid-call
ends the call failed (never resumed), and a durable caller keeps the
job's committed answer on its own replay. So the body's outgoing calls and outside mutations can
repeat: carry an idempotency key where the world supports one (the
call's own business identity, or `callId()`), and name a scratch
folder of the call's own from `callId()` too, so a retry finds its
own. A job is the home of live, nondeterministic tool work: a
command-line tool, an AI session whose changing answers steer the
work; a file on the machine is read with node:fs, never through a
command, the machine's own facts (its processors, its memory, its
release, its network addresses, whether it is Windows) are node:os's,
and another process is asked whether it runs and is ended with
`process.kill`, so the same code runs on every system; a command is
for the acts Node leaves to the system's own tools, and where its form
differs between systems the code chooses by `platform()`. Business state lives inside the call or in a dependency that
owns storage. Module scope holds the process's own memory for the
life of the process: a client made once, a cache, the bookkeeping of
what this process is doing, an emitter the calls that land in this
process wake. That memory is this process's alone, another copy of
the job holds its own, and it is gone when the process ends, so a
fact that must outlive the process or be read by another copy goes to
a dependency that owns storage. Await every command and every mutating operation, and let
nothing outlive the call: a return or a cancellation ends the call and
the runtime stops every command it started, so the code needs no
signal of its own, and no child is handed on as a background process.
A long operation publishes its progress through a dependency while
the handler keeps running. A job subscribes to no other agent's events: a durable agent owns a
wait on a caller's behalf and calls the job.

The contract rules are the platform language's (The contract, below):
every async function `src/index.ts` exports is a handler other agents
may call, and a synchronous export is a plain helper, never an
operation.

A complete job, exactly what the compile expects, small: the debug
section, the parameter parsed, a command run live and awaited under a
time limit of its own, its output parsed with a failed parse treated
as a miss, and the stated return (a number) answered as itself:

```ts
import { execFile } from 'node:child_process';
import { debuglog, inspect } from 'node:util';
import { z } from 'zod';

const debug = debuglog('agent');

/**
 * Measures how much disk a folder takes, in kilobytes, with the
 * machine's own `du` command. The measurement is live: a retry
 * measures again.
 *
 * @param folder - The absolute path to measure, on the agent's machine.
 * @returns The folder's size in kilobytes.
 * @throws When the command fails (a folder that does not exist), in
 *   the command's own words.
 * @example
 * const kilobytes = await folderSize('/var/log');
 * // => 4096
 */
export async function folderSize(folder: string): Promise<number> {
  const path = z.string().parse(folder);
  debug('du arguments: %s', inspect({ path }, { depth: null }));
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('du', ['-sk', path], { encoding: 'utf8', timeout: 60_000 }, (error, out, err) => {
      if (error) reject(new Error(`du failed for ${path}: ${err.trim() || error.message}`));
      else resolve(out);
    });
  });
  debug('du result: %s', inspect({ stdout }, { depth: null }));
  const kilobytes = Number(stdout.split('\t')[0]);
  if (Number.isNaN(kilobytes)) throw new Error(`du answered no size for ${path}: ${stdout.trim()}`);
  return kilobytes;
}
```
