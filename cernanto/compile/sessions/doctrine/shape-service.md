## The service shape

A service is an actor other agents call. It serves its calls side by
side, as a Node.js server serves its requests: one thread, every call
taking its turn at each `await`, all of them sharing the module's
variables. Its memory is the module scope: module variables persist
across calls, crashes and restarts of the same deployed version,
exactly as a long-lived Node process keeps them, and a new deployed
version starts over with fresh variables, so anything that must
outlive a redeploy belongs in a dependency that owns storage. Because
calls share the memory and take turns, a read of a variable, an
`await` and a write back are not alone: decide and write in one
stretch with no `await` between, or keep a queue in memory for what
must go one at a time. A service is the home of a wait function, an
exported function that answers when something happens (an interface's
wait operation): the call waits on the agent's own emitter
(`node:events`, an `EventEmitter` at module scope) and the function
of this agent that makes the thing happen emits on it; a call that
waits costs nothing and holds nobody up.

The contract rules are the platform language's (The contract, below):
every async function `src/index.ts` exports is a handler other agents
may call, and a synchronous export is a plain helper, never an
operation.

A complete service, exactly what the compile expects, small: memory at
module scope, the debug section, each parameter parsed, a dependency
reached through its generated module with its arguments and result
logged, a miss handled the way the specification says, one operator
line in the trace, the stated return (a line of text) answered as
itself, and a wait function: it looks at the memory, waits on the
agent's own emitter, and looks again after every wake:

```ts
import { EventEmitter, once } from 'node:events';
import { debuglog, inspect } from 'node:util';
import { z } from 'zod';
import { languageOf } from './agents/ops-preferences.js';

const debug = debuglog('agent');
/** How many times each visitor was greeted: this service's memory across calls. */
const visits = new Map<string, number>();
/** Tells the calls that wait that the memory changed: node's own events, inside this agent. */
const changed = new EventEmitter();
changed.setMaxListeners(0);

/**
 * Greets a visitor in their preferred language, counting their visits.
 *
 * @param name - The visitor's name, as they gave it.
 * @returns The greeting, one line, in the language the preferences
 *   agent holds for the visitor (English when it holds none).
 * @example
 * const line = await greet('Ada');
 * // => 'Welcome back, Ada (visit 3)'
 */
export async function greet(name: string): Promise<string> {
  const visitor = z.string().parse(name);
  debug('greet arguments: %s', inspect({ visitor }, { depth: null }));
  const preference = await languageOf(visitor);
  debug('preference result: %s', inspect(preference, { depth: null }));
  const language = preference === null ? 'en' : preference.language;
  const count = (visits.get(visitor) ?? 0) + 1;
  visits.set(visitor, count);
  const line =
    language === 'fr'
      ? `Bienvenue, ${visitor} (visite ${String(count)})`
      : `Welcome back, ${visitor} (visit ${String(count)})`;
  changed.emit('greeted');
  if (count === 100) console.log(`${visitor} reached a hundred visits`);
  return line;
}

/**
 * Waits until the visitor has been greeted at least `times` times.
 * The call stays open for as long as that takes and costs nothing
 * meanwhile; the other calls of this service go on beside it.
 *
 * @param name - The visitor to wait for.
 * @param times - How many greetings to wait for.
 * @returns How many times the visitor has been greeted by then.
 * @example
 * const count = await waitForVisits('Ada', 3);
 * // => 3
 */
export async function waitForVisits(name: string, times: number): Promise<number> {
  const visitor = z.string().parse(name);
  const wanted = z.number().parse(times);
  debug('wait arguments: %s', inspect({ visitor, wanted }, { depth: null }));
  // The memory is the truth; the event only says "look again".
  while ((visits.get(visitor) ?? 0) < wanted) await once(changed, 'greeted');
  return visits.get(visitor) ?? 0;
}
```

A service runs no local command, whether in its own code, through a
linked module or through a granted npm package: its memory lives
across calls and a command would not. Deterministic local tool work
is an ordinary task's, and live tool work whose answers change is a
job's; the service calls the agent that owns the operation.
