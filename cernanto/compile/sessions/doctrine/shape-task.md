## The task shape

A task agent serves isolated calls: each export runs with only the
state it makes for itself, everything is gone when the call answers,
nothing crosses between calls, and many calls run in parallel. Module
scope holds constants (declared `as const`, so a tool list or a lookup
table is a readonly value nothing can write through, even when it is
passed whole), plain helper functions, and process-local clients (a
connection pool behind a `const`); it never holds business memory: a
counter, a registry, a conversation. Data that must outlive a call
lives in a dependency that owns storage, and an agent whose task is
memory over time is a service agent (a spec that says it is one).
Granted files are read inside the handler that needs them: a value
computed from them at module scope (a map of their texts, a list of
their names) is memory to the gate, whatever it is named. A task has
no events: each call is on its own and may run in another process, so
nothing one call does can wake another. A task that must wait for
something in another agent calls that agent's wait function and
awaits it, for as long as it takes.

The contract rules are the platform language's (The contract, below):
every async function `src/index.ts` exports is a handler other agents
may call, and a synchronous export is a plain helper, never an
operation.

A complete task agent, exactly what the compile expects, small:
nothing kept between calls, the debug section, each parameter parsed,
the caller recorded, another agent's wait function simply awaited, and
a timeout answered as a normal value:

```ts
import { debuglog, inspect } from 'node:util';
import { z } from 'zod';
import { waitForVisitor } from './agents/ops-lobby.js';
import { caller } from './os.js';

const debug = debuglog('agent');

/**
 * Waits for the next visitor the lobby sees and answers a welcome line
 * for them. The waiting is the lobby's own: its wait function is
 * called and awaited, for as long as it takes.
 *
 * @param name - The one visitor to wait for; any visitor when absent.
 * @param timeoutMs - The longest wait, in milliseconds; an hour when
 *   absent.
 * @returns The welcome line, or null when nobody came in time: a
 *   timeout is a normal answer, never an error.
 * @example
 * const line = await welcomeNext('Ada', 60_000);
 * // => 'Welcome, Ada' or null
 */
export async function welcomeNext(name?: string, timeoutMs?: number): Promise<string | null> {
  const who = z.string().optional().parse(name);
  const limit = z.number().optional().parse(timeoutMs) ?? 60 * 60 * 1000;
  debug('welcome arguments: %s', inspect({ who, limit, caller: caller() }, { depth: null }));
  const visitor = await waitForVisitor(who, limit);
  debug('visitor result: %s', inspect(visitor, { depth: null }));
  if (visitor === null) return null;
  return `Welcome, ${visitor.name}`;
}
```

A task may run a local command (`node:child_process`, awaited inside
the handler) for deterministic file-in, file-out work that makes the
call's own scratch again: such a command runs again on every replay and
leaves no record, so a command whose output decides which calls the
code makes next would change the journal's sequence on a replay and
end the attempt as a mismatch. A command whose answers change from one
run to the next, and live tool work that needs local output, belong in
a job.
