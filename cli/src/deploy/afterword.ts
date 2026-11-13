// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { cardOnPlane } from '../card.js';
import type { CardPlane } from '../card.js';
import { cardText } from '../card-view.js';
import type { PlaneCompileResponse, FleetAgentRowWire } from '../gateway/types.gen.js';
import { carriersByComposition } from '../fleet.js';
import { commandShell, shownPath } from '../output.js';

// What comes after the compile or the landing: the failures in full, the
// ship of the rows, the wait for the plane to serve them, and what to
// do next for every type of agent, so nobody opens another verb to
// learn the next command. An agent's card is the one `contract`
// prints, gathered by the card module off the plane.

/**
 * The afterword under a compile, for what the table has no room for: a
 * failed agent prints its whole reason (the table shows FAILED and the
 * first line of it). The spec issues are diagnostics and print in the
 * summary the verb ends on. An all-green compile has no afterword.
 */
export function formatReport(report: {
  status: string;
  issues: {
    code: string;
    severity?: string | undefined;
    agentId: string;
    message: string;
    line?: number | undefined;
    hint?: string | undefined;
  }[];
  agents: {
    agentId: string;
    status: string;
    detail?: string | undefined;
  }[];
}): string {
  const lines: string[] = [];
  for (const agent of report.agents) {
    if (agent.status !== 'failed') continue;
    lines.push(`${agent.agentId}: FAILED`);
    for (const line of (agent.detail ?? '').split('\n')) {
      if (line.trim() === '') continue;
      lines.push(`  ${line}`);
    }
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * The packages a compile wrote back beside their specs, as the terminal
 * says them: the log names each with its digest and ends with the
 * reminder; the quiet form names each without, and for one package
 * puts the reminder on its line (`wrote ops/.cern/greeter.cern; commit
 * it with its spec`).
 *
 * @param written - The packages written, each by path and digest.
 * @param log - The log form (the default); false, the quiet form.
 * @param reminder - The words for one package (`commit it with its spec`); none when empty.
 * @returns The lines, with their newlines; empty when nothing was written.
 * @example
 * writtenLines(written, false, 'commit it with its spec');
 */
export function writtenLines(
  written: { path: string; digest: string }[],
  log: boolean,
  reminder: string,
): string {
  if (written.length === 0) return '';
  const plural = reminder.replace('it with its spec', 'the packages with their specs');
  if (log) {
    return `${written.map((entry) => `wrote ${shownPath(entry.path)} (${entry.digest.slice(0, 19)}...)\n`).join('')}${plural === '' ? '' : `${plural}\n`}`;
  }
  if (written.length === 1) {
    return `wrote ${shownPath(written[0]?.path ?? '')}${reminder === '' ? '' : `; ${reminder}`}\n`;
  }
  return `${written.map((entry) => `wrote ${shownPath(entry.path)}\n`).join('')}${reminder === '' ? '' : `${plural}\n`}`;
}

/** What a freshly deployed worker is about to do, and the commands to
 * paste: the plane starts its program once its generation serves (a
 * run can last weeks, so the deploy returns at once); `trace -f`
 * follows it live, `trace <agent>` reads its latest run, `stop` and
 * `start` are the operator's hands on it. */
export function workerNextStep(row: { agentId: string }): string {
  return `follow ${row.agentId} live: cernanto trace ${row.agentId} -f`;
}

/** The plane surface shipping needs; the gateway client satisfies it,
 * tests fake it. The cards read it as every card reads a plane. */
export interface ShipPlane extends CardPlane {
  /** The fleet's rows as shipped, each with how many of its runs are
   * in flight. */
  rows(): Promise<(FleetAgentRowWire & { running?: number })[]>;
  /** The fleet's generations with their compositions. */
  generations?(): Promise<GenerationView[]>;
  /** One agent as the plane describes it: the contract its card renders. */
  describe?(agentId: string): Promise<{ contract?: string }>;
}

/** One generation row as the plane reports it: the agent it serves,
 * the package it runs, its phase, what it composes and its pinned
 * work. */
export interface GenerationView {
  agentId?: string;
  gen: number;
  status: string;
  package?: string;
  composition?: Record<string, string>;
  inFlight?: number;
}

/** What a deploy's ending is written with. */
export interface EndingOptions {
  write: (line: string) => void;
  /** False keeps the cards off: the json output path. */
  card?: boolean;
  /** The terminal's default form: a module's deployed line without its
   * digest, and no deployed line for an agent that ends on its card or
   * its next steps, which say it. Off, every deployed line with its
   * digest (the log). */
  quiet?: boolean;
  /** The tests each compiled agent passed, by id, for its card's head
   * (`verified live in 42s, 3 tests`). */
  tests?: Record<string, number>;
  /** The deploy follows its workers' runs live, in place of their
   * next-step blocks. */
  follow?: boolean;
}

/**
 * How one deployed agent ends, compiled or landed. A worker ends on its
 * next steps, since the plane starts its program and the run is
 * watched through its trace. A module ends on the line above it. Every
 * other agent ends on its card: the rendering `cernanto contract`
 * gives, read off the row as shipped and the fleet beside it (the
 * contract the row carries, else the one the plane describes; the
 * relations), its head the deploy's own: `deployed`, and the compile's
 * time and tests. An agent whose contract nobody can say has no card.
 */
async function writeEnding(
  plane: ShipPlane,
  row: FleetAgentRowWire,
  options: EndingOptions,
  fleet: FleetAgentRowWire[],
  took?: number,
): Promise<boolean> {
  if (row.type === 'module') return false;
  if (row.type === 'worker') {
    if (options.follow !== true) options.write(`${workerNextStep(row)}\n`);
    return options.follow !== true;
  }
  if (options.card === false) return false;
  const card = await cardOnPlane(plane, row.agentId, {
    known: { row },
    fleet,
    afterDeploy: true,
    shell: commandShell(),
  });
  if (card === undefined) return false;
  options.write(
    `\n${cardText({
      ...card,
      ...(took === undefined ? {} : { took }),
      ...(took === undefined || options.tests?.[row.agentId] === undefined
        ? {}
        : { tests: options.tests[row.agentId] }),
    })}\n`,
  );
  return true;
}

/**
 * The afterword of a deploy, one for everything it shipped. A compile
 * answers the agents it shipped inside the plane and waited for
 * (`shipped`); an agent that landed as it was is shipped as well, and
 * is read as the fleet holds it. What is left is to say where each
 * agent went, what a module recomposed, how each agent ends and the
 * warnings a deploy earns, the dependency and breaking-contract ones
 * rendered from the fleet view. Answers how many agents the deploy
 * shipped and how many more the compile reported without shipping them.
 */
export async function afterShip(
  plane: ShipPlane,
  response: Pick<PlaneCompileResponse, 'agents' | 'rows' | 'shipped'> & {
    /** The agents that landed as they were, by id. */
    landed?: string[];
  },
  options: EndingOptions,
): Promise<{ shipped: number; linkedOnly: number }> {
  const { write } = options;
  const compiled = response.rows;
  const shippedIds = new Set(compiled.map((row) => row.agentId));
  let linkedOnly = 0;
  for (const agent of response.agents) {
    if (agent.status !== 'compiled' && agent.status !== 'current') continue;
    if (shippedIds.has(agent.agentId)) continue;
    linkedOnly += 1;
    // A current dependency was deployed as is, and the log said so; a
    // compiled agent without a row of its own is a module composed into
    // its consumers.
    if (agent.status === 'compiled') {
      write(`prepared module ${agent.agentId}: rides inside its consumers\n`);
    }
  }
  const landed = [...new Set(response.landed ?? [])].filter((agentId) => !shippedIds.has(agentId));
  const shipped = compiled.length + landed.length;
  if (shipped === 0) return { shipped, linkedOnly };
  // The plane waited for the shipped agents' newer generations; when
  // its patience ran out first, say so and where to look.
  if (response.shipped !== undefined && !response.shipped.converged) {
    for (const note of response.shipped.notes) write(`${note}\n`);
    write('warning: the fleet has not converged yet; watch it with: cernanto ls\n');
  }
  const deployedRows: FleetAgentRowWire[] = await plane.rows().catch((): FleetAgentRowWire[] => []);
  // The agents this deploy shipped, the landed ones first, as they
  // happened: a landed agent is read as the fleet holds it.
  const rows: FleetAgentRowWire[] = [
    ...landed.flatMap((agentId) => deployedRows.filter((row) => row.agentId === agentId)),
    ...compiled,
  ];
  const images: Record<string, string> = Object.fromEntries(
    rows.map((row) => [row.agentId, row.artifact]),
  );
  // A module's carriers are read from the plane: every generation whose
  // composition carries it (a carrier two hops up, through a module in
  // between, composes it all the same), plus the rows that name it or
  // an interface it implements and have no generation yet.
  const composing =
    plane.generations === undefined
      ? new Map<string, string[]>()
      : carriersByComposition(await plane.generations().catch(() => []));
  const known = new Map<string, FleetAgentRowWire>();
  for (const row of deployedRows) known.set(row.agentId, row);
  for (const row of rows) known.set(row.agentId, row);
  const knownRows = [...known.values()];
  // The deploy's modules share one wait for their carriers.
  const recomposedBy = Date.now() + RECOMPOSITION_PATIENCE_MS;
  for (const row of rows) {
    if (row.type !== 'module') continue;
    const digest = images[row.agentId] ?? row.artifact;
    const carriers = carriersOf(
      knownRows.filter((candidate) => candidate.agentId !== row.agentId),
      row,
      composing,
    );
    // The plane already holds the row: a first deploy shows the row
    // with no generation composing it yet, a redeploy one on the old
    // bytes.
    const fresh = !composing.has(row.agentId);
    const composedWord = fresh ? 'composed' : 'recomposed';
    const recomposed = await awaitRecomposition(plane, row.agentId, digest, carriers, recomposedBy);
    const composition =
      carriers.length === 0
        ? 'composed into nothing yet'
        : recomposed
          ? `${composedWord} into ${carriers.join(', ')}`
          : `${fresh ? 'composing' : 'recomposing'} ${carriers.join(', ')}; watch it with: cernanto contract ${row.agentId}`;
    // The quiet form says it as top does: a module is linked into the
    // agents that use it.
    const linked =
      carriers.length === 0
        ? 'linked into nothing yet'
        : recomposed
          ? `linked into ${carriers.join(', ')}`
          : `linking into ${carriers.join(', ')}; watch it with: cernanto contract ${row.agentId}`;
    write(
      options.quiet === true
        ? `deployed ${row.agentId}, ${linked}\n`
        : `deployed ${row.agentId}: ${digest}   ${composition}\n`,
    );
  }
  for (const row of rows) {
    if (row.type === 'module') continue;
    const image = images[row.agentId];
    // A compiled agent's card says how long its compile took; a landed one
    // says when it was verified.
    const took = response.agents.find((agent) => agent.agentId === row.agentId)?.durationMs;
    if (options.quiet !== true || options.card === false) {
      write(`deployed ${row.agentId}${image === undefined ? '' : `: ${image}`}\n`);
      await writeEnding(plane, row, options, deployedRows, took);
      continue;
    }
    // The quiet form: the card or the next steps say the agent is
    // deployed, and an agent with neither ends on its deployed line,
    // without the digest; the line with the digest is the log's.
    const ended = await writeEnding(plane, row, options, deployedRows, took);
    if (!ended) write(`deployed ${row.agentId}\n`);
  }

  const fleet: { agentId: string; uses?: string[] }[] = await plane.rows().catch(() => []);
  for (const row of rows) {
    for (const use of row.uses) {
      // The platform's own agents come with the plane, so a use of one
      // counts as deployed.
      if (use.startsWith('platform/') || use.startsWith('cernanto/')) continue;
      if (!fleet.some((deployed) => deployed.agentId === use)) {
        write(`warning: ${row.agentId} uses ${use}, which is not deployed\n`);
      }
    }
  }
  // The differ proved this deploy broke the wire contract; the fleet
  // view names the dependents whose calls in flight may fail on their
  // next call into it. The deploy prints it as a warning.
  const breaking = response.agents
    .filter((agent) => agent.contractChange === 'breaking' && shippedIds.has(agent.agentId))
    .map((agent) => agent.agentId);
  for (const agentId of breaking) {
    const dependents = fleet
      .filter((row) => row.uses?.includes(agentId) ?? false)
      .map((row) => row.agentId);
    if (dependents.length === 0) continue;
    const inFlight = await liveDependents(plane, dependents);
    if (inFlight.total > 0) {
      write(
        `warning: ${String(inFlight.total)} calls in flight across ${inFlight.names.join(', ')} may fail on their next call to ${agentId}; let them drain first or expect clean contract-violation failures\n`,
      );
    }
  }
  return { shipped, linkedOnly };
}

/** The rows a module row will be composed into: every agent whose
 * newest generation composes it today (a carrier any number of hops
 * up), and every row with a generation whose uses reach it through
 * the module rows between them (walked over the rows' own uses) or
 * grant an interface it implements (the plane composes an implementor
 * into every consumer of its interface). */
function carriersOf(
  deployedRows: FleetAgentRowWire[],
  module: FleetAgentRowWire,
  composing: ReadonlyMap<string, string[]> = new Map(),
): string[] {
  const implemented = new Set((module.implements ?? []).map((entry) => entry.id));
  const byId = new Map(deployedRows.map((row) => [row.agentId, row]));
  // The module ids a row's uses reach, hop by hop through module rows.
  const reaches = (row: FleetAgentRowWire): Set<string> => {
    const seen = new Set<string>();
    const queue = [...row.uses];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      const next = byId.get(id);
      if (next?.type === 'module') queue.push(...next.uses);
    }
    return seen;
  };
  const named = deployedRows
    .filter((row) => {
      if (row.agentId === module.agentId || row.type === 'module' || row.type === 'interface') {
        return false;
      }
      const reached = reaches(row);
      return reached.has(module.agentId) || [...reached].some((used) => implemented.has(used));
    })
    .map((row) => row.agentId);
  return [
    ...new Set([
      ...named,
      ...(composing.get(module.agentId) ?? []).filter((id) => id !== module.agentId),
    ]),
  ].sort();
}

/** How long a deploy waits for its modules' carriers to compose them. */
const RECOMPOSITION_PATIENCE_MS = 120_000;

/** Waits until every named carrier's newest generation is active and
 * composes the module at the shipped digest. Bounded by the deadline:
 * a plane pacing many recompositions surfaces as a message. */
async function awaitRecomposition(
  plane: ShipPlane,
  moduleId: string,
  digest: string,
  carriers: string[],
  deadline: number,
): Promise<boolean> {
  if (carriers.length === 0 || plane.generations === undefined) return carriers.length === 0;
  for (;;) {
    const generations = await plane.generations().catch(() => []);
    const done = carriers.every((carrier) => {
      const newest = generations
        .filter((generation) => generation.agentId === carrier)
        .sort((a, b) => b.gen - a.gen)[0];
      return (
        newest !== undefined &&
        newest.status === 'active' &&
        newest.composition?.[moduleId] === digest
      );
    });
    if (done) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 1000));
  }
}

async function liveDependents(
  plane: ShipPlane,
  affected: string[],
): Promise<{ total: number; names: string[] }> {
  try {
    const rows = await plane.rows();
    const inFlight = (row: { running?: number }): number => row.running ?? 0;
    const exposed = rows.filter((row) => affected.includes(row.agentId) && inFlight(row) > 0);
    return {
      total: exposed.reduce((sum, row) => sum + inFlight(row), 0),
      names: exposed.map((row) => row.agentId),
    };
  } catch {
    // A plane that cannot answer live counts still deployed fine.
    return { total: 0, names: [] };
  }
}
