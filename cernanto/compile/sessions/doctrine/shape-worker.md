## The worker shape

A worker is a program the plane runs: one exported function that the
plane starts when the worker is deployed, and that decides in its own
code when to wake, what to do, and when it is done. Nothing else is
exported (helpers stay unexported), and nothing calls it: a worker
uses services and modules, never the other way round. Name the
function for what it does (`run`, `main`, `watchInbox`); the compile
takes the one export as the program. A worker takes no input: the
plane starts it with an empty object, so the function receives
`input: unknown` and ignores it (`void input`). When the program
finishes it returns; when it is meant to run on, it never does. Write
no definition or registration of your own and import nothing from the
runtime: the compile wraps the one export as the program.

Time is the program's business. The specification says when the work
happens ("every hour", "every weekday at 09:00 and 17:00 Paris
time", "whenever the feed has a new title"); the code keeps that time
itself, durably, in standard TypeScript: a `setTimeout` wait to the
next moment (a plain `await new Promise(...)` sleep rides the durable
timer and costs nothing while parked), another agent's wait function
awaited for outside signals, a long call simply awaited. Loops are
fine; `for (;;)` with a sleep inside is the normal shape of a worker,
and `Intl` computes calendar times from `Date.now()`.

The program may be restarted from the top: after a crash, after the
plane restarts it, or when it ends with an error and an operator
starts it again. Write it so that restarting is harmless: keep what
must outlive a restart in module variables (the last item seen, the
last time a report went out; they persist across crashes and restarts
of the same deployed version), and make the work of one wake
idempotent when the outside world would notice a repeat. A new
deployed version starts over with fresh variables: anything that must
outlive a redeploy belongs in a dependency that owns storage.

A worker that runs once and finishes:

```ts
export async function run(input: unknown): Promise<void> {
  void input;
  const hour = new Date().getUTCHours();
  console.log(hour < 12 ? 'good morning' : 'good evening');
}
```

A worker that wakes every hour, exactly what the compile expects,
small: the debug section, the TSDoc every export carries, the sleep
that rides the durable timer, a dependency reached through its
generated module, one operator line in the trace when something
deserves an eye, and the result handed on by a call:

```ts
import { debuglog, inspect } from 'node:util';
import { post } from './agents/ops-board.js';
import { tally } from './agents/ops-tally.js';

const debug = debuglog('agent');
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tallies the day's visitors once an hour, for as long as the worker
 * runs: each wake asks the tally agent, posts the count on the board,
 * and sleeps to the next hour. A restart resumes the loop from the top;
 * a tally repeated after a crash is harmless.
 *
 * @param input - Unused: the plane starts a worker with an empty
 *   object.
 * @returns Never resolves while the worker runs; rejects when the
 *   tally agent fails terminally, and the plane records the failure.
 * @example
 * // started by the plane at deploy; a deploy runs it again
 */
export async function run(input: unknown): Promise<void> {
  void input;
  for (;;) {
    const outcome = await tally();
    debug('tally result: %s', inspect(outcome, { depth: null }));
    if (outcome.visitors === 0) console.log('an hour with no visitors');
    await post(outcome.visitors);
    await sleep(60 * 60 * 1000);
  }
}
```

A worker that works at 09:00 and 17:00 on weekdays, in a time zone;
the next moment is computed from `Date.now()` with `Intl`, so a clock
change never shifts it:

```ts
import { sendReport } from './agents/ops-reports.js';

const ZONE = 'Europe/Paris';
const HOURS = [9, 17];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function localParts(ms: number): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hourCycle: 'h23',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(ms));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  return { weekday, hour: Number(part('hour')), minute: Number(part('minute')) };
}

function msUntilNextSlot(fromMs: number): number {
  let t = fromMs - (fromMs % 60_000) + 60_000;
  for (;;) {
    const p = localParts(t);
    if (p.weekday >= 1 && p.weekday <= 5 && HOURS.includes(p.hour) && p.minute === 0) {
      return t - fromMs;
    }
    t += 60_000;
  }
}

export async function run(input: unknown): Promise<void> {
  void input;
  for (;;) {
    await sleep(msUntilNextSlot(Date.now()));
    await sendReport();
  }
}
```

A worker that follows a service by its wait function and hands on what
it finds:

```ts
import { keepTitle } from './agents/ops-archive.js';
import { nextTitle } from './agents/ops-feed.js';

export async function followNews(input: unknown): Promise<void> {
  void input;
  for (;;) {
    const title = await nextTitle();
    await keepTitle(title);
  }
}
```

A worker runs no local command, whether in its own code, through a
linked module or through a granted npm package: its memory lives
across wakes and a command would not. It calls an ordinary task for
deterministic local tool work and a job for live tool work, the agent
that owns the whole operation.
