## The module shape

A module is code that links in-process into the agents that use it and
runs as them, so it owns no durable identity of its own. Module-scope
variables live in the consumer's process and persist exactly as the
consumer's own memory does; keep them to caches and fixed lookups,
because two consumers each hold their own copy and nothing is shared
between them. It never waits for or subscribes to events (a module has
no call of its own to park). Its calls to
dependency agents, its mcp and openapi operations and its judgments
are the consuming agent's, and so is a granted npm package's reach or
a bare `fetch`, which may run again: a module holds reads of the world
at most, never a write that must happen once (that is a task's).

The contract rules are the platform language's (The contract, below),
with one difference of the module's own: a function the specification
calls plain or synchronous (a helper that makes a value, such as an
error a consumer throws) is exported beside the async ones, and a
consumer calls it without awaiting.

A complete module, exactly what the compile expects, small: the debug
section, the parameter parsed, a bare `fetch` (a read of the world,
run again on a replay, its response type inferred), a transient status
tagged retryable, a miss in the specification's words, and the stated
return (a number) answered as itself:

```ts
import { debuglog, inspect } from 'node:util';
import { z } from 'zod';

const debug = debuglog('agent');

/**
 * Counts the words of the plain-text page at a url.
 *
 * @param url - The page's public url.
 * @returns The number of whitespace-separated words on the page, zero
 *   for an empty page.
 * @throws When the url answers anything but a page (a 404), in those
 *   words; a 503 is retried by the platform.
 * @example
 * const words = await wordCount('https://example.com/notes.txt');
 * // => 412
 */
export async function wordCount(url: string): Promise<number> {
  const page = z.string().parse(url);
  debug('fetch arguments: %s', inspect({ page }, { depth: null }));
  const response = await fetch(page, { signal: AbortSignal.timeout(20_000) });
  if (response.status === 503) {
    throw Object.assign(new Error(`the page is down (503): ${page}`), { kind: 'retryable' });
  }
  if (!response.ok) throw new Error(`no page at ${page} (${String(response.status)})`);
  const text = await response.text();
  debug('fetch result: %s', inspect({ bytes: text.length }, { depth: null }));
  return text.split(/\s+/).filter((word) => word !== '').length;
}
```

A module runs as the agent that links it and keeps that agent's kind
and lifetime. A local command (`node:child_process`) or a file
operation it runs is the consumer's: a task or a job that links it may
run one, awaited whole inside the function that started it, while a
service or a worker that links it refuses the command at run time. A
module variable never routes a later call back to a child a returned
function started.
