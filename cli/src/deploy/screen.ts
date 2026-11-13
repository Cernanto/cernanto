// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { relative } from 'node:path';

import { CernantoError } from '@cernanto/package-format';

import { whenLoopbackDown } from '../gateway-client.js';
import type { PlaneCompileResponse } from '../gateway/types.gen.js';
import type { TraceRecord } from '../gateway/types.gen.js';
import { elapsed, timeOfDay } from '../output.js';
import { issueDiagnostic } from '../diagnostics.js';
import type { Diagnostic } from '../diagnostics.js';
import {
  BUILD_STEP_WIDTH,
  compileHeader,
  compileTable,
  doneLine,
  foldCompile,
  progressLine,
  recordMessage,
  showsInLog,
} from './compile-view.js';
import type { CompileState, CompileViewOptions, ProgressRecord } from './compile-view.js';
import { workspaceSpecOf } from './landing.js';
import { planeCompile } from './upload.js';
import type { CompileClient } from './upload.js';

// What `cernanto deploy` prints while the plane compiles: the log, one
// timestamped line per thing that happened as it happens (the steps the
// compile narrates into its document), the same on a terminal and on a
// pipe (the way a cloud deploy streams its events:
// append-only, greppable, no cursor control), a heartbeat when a long
// step is silent, the sessions' activity as the coder works, the
// conversations of the tests while they run (the tester's and the
// agent's, as `cernanto trace -f` shows them, each line named by its
// party), and at the end the summary table and the verdict line. The
// words and the layout live in the compile view and, for the
// conversations, in the trace view on the plane (the gateway renders each
// record of a live stream and hands the lines with it); this file only
// decides when and where to print.

/** Where the screen follows the sessions' activity: an agent's live
 * trace stream (the plane's), stopped by the returned function.
 * Absent, the log shows the compile's own steps only. */
export interface ActivitySource {
  callsStream(agentId: string, onRecord: (record: TraceRecord) => void): () => void;
}

/** Where the screen follows the conversations of the tests: an
 * agent's live trace stream (the plane's) from a moment, each record
 * with the lines the plane rendered it as, stopped by the returned
 * function. Absent, the log shows the compile's own steps and the
 * sessions' activity only. */
export interface ConversationSource {
  callsStream(
    agentId: string,
    options: { since?: string },
    onRecord: (record: TraceRecord, lines?: string[]) => void,
  ): () => void;
}

export interface CompileScreenOptions {
  write: (text: string) => void;
  /** The quiet form: what the compile read from each spec, a dot per
   * record while it works, one verdict line per agent, the verdict. Off,
   * the log: the header, one line per step as it came, the coder's words
   * and the head of every line of the tests' conversation, then the
   * table. */
  quiet?: boolean;
  utc?: boolean;
  compileId: string;
  verify?: boolean;
  startedAt: string;
  now?: () => number;
  /** How long a step may run in silence before a line says it is
   * still running (30s), then how often the line repeats. */
  heartbeatMs?: number;
  /** The sessions' activity while they write. */
  activity?: ActivitySource;
  /** The tests' conversations while they run on the plane. */
  conversations?: ConversationSource;
  /** Answers a parked credential ask in this terminal: the log holds
   * while the connect flow prompts, then resumes. Absent (a pipe,
   * quiet), the log names the command to run instead. */
  onAsk?: (account: string) => Promise<void>;
  /** The plane's pending credential asks, polled while the compile
   * runs: the poll surfaces every pending row (the agent under test's,
   * a linked module's) and answers it in this terminal. */
  pendingAsks?: () => Promise<PendingAsk[]>;
  /** The compile's call id: the harness sessions it runs are its
   * linked calls (`<id>~n`), which is how their activity is told from
   * every other session on the plane. A screen that goes up before the
   * compiler has taken the compile is told it later (`follow`). */
  callId?: string;
  /** The proofs shorten the patience for a run's records still on
   * their way at the verdict; every terminal keeps the default. */
  patienceMs?: number;
}

/** One pending credential row on the plane, as the ask watcher reads
 * it: who asked, for which account, and when, so rows opened before
 * this compile stay another run's business. */
export interface PendingAsk {
  id: string;
  kind: 'fields' | 'oauth' | 'display';
  /** The account's words: the agent, a space, the name. */
  account: string;
  /** The agent that owns the account. */
  agentId: string;
  name?: string;
  provider?: string;
  requestedAt?: string;
  /** The call that waits on the ask, the first when several do. */
  callId?: string;
}

/** Where the sessions' activity streams: the vendor agents, the
 * harness implementors linked into the compile (each session turn is
 * the vendor's own call, parented to the compile call by the
 * identity compile sends). */
const SESSION_AGENTS = [
  'cernanto/harness/claude-code',
  'cernanto/harness/codex',
  'cernanto/harness/fake',
] as const;

/** The time gutter every conversation line starts with: `HH:MM:SS`
 * and two spaces (the trace view's), replaced here by the log's own
 * time and the party column. */
const CHAT_GUTTER = 'HH:MM:SS  '.length;

/** One party of the tests as its stream is followed: the tester (its
 * runs since the deploy) or the copy under test (its calls from the
 * tester, and its own calls beneath them, a mocked dependency's
 * included). Records of other callers, and of runs older than this
 * deploy, stay out. */
class Conversation {
  readonly party: string;
  readonly known = new Set<string>();
  private readonly since: string;
  private readonly tester: string;
  private readonly testerCalls: Set<string> | undefined;
  private stop: (() => void) | undefined;
  constructor(party: string, since: string, tester: string, testerCalls: Set<string> | undefined) {
    this.party = party;
    this.since = since;
    this.tester = tester;
    this.testerCalls = testerCalls;
  }

  start(
    source: ConversationSource,
    onRecord: (record: TraceRecord, lines: string[] | undefined) => void,
  ): void {
    this.stop = source.callsStream(this.party, { since: this.since }, onRecord);
  }

  end(): void {
    this.stop?.();
    this.stop = undefined;
  }

  /** Whether a record of this stream belongs to the tests being run. */
  accepts(record: TraceRecord): boolean {
    const root = record.callId.split('~')[0] ?? record.callId;
    if (this.known.has(root)) return true;
    // A module under test runs linked inside the tester: its records
    // ride the tester's call ids; the agent's calls name the tester's
    // run as their parent.
    if (this.testerCalls?.has(root) === true) return true;
    const parent =
      'parentCallId' in record && typeof record.parentCallId === 'string'
        ? record.parentCallId.split('~')[0]
        : undefined;
    if (parent !== undefined && this.testerCalls?.has(parent) === true) {
      this.known.add(root);
      return true;
    }
    if (record.kind !== 'begin' || record.of !== 'handler') return false;
    const ours =
      this.testerCalls === undefined
        ? // The tester: its own runs since the deploy began.
          record.agentId === this.tester && Date.parse(record.at) >= Date.parse(this.since) - 2000
        : // The agent: the calls the tester makes to it.
          record.callerAgentId === this.tester;
    if (ours) this.known.add(root);
    return ours;
  }

  /** The record's lines as the chat reads them, rendered on the plane
   * with the stream's party as the view's own agent: the agent under
   * compile speaks bare (the log's agent column already names it: `→
   * Search`), the tester's lines carry the word `tester` (`tester  →
   * Fact Check`, `tester  ✔ ...`), and any other speaker (a linked
   * module) is named as the chat names it. */
  lines(record: TraceRecord, rendered: string[] | undefined): string[] {
    if (rendered === undefined) return [];
    if (record.agentId !== this.tester) return rendered;
    return rendered.map((line, index) =>
      index === 0 ? `${line.slice(0, CHAT_GUTTER)}tester  ${line.slice(CHAT_GUTTER)}` : line,
    );
  }
}

/** The tests of one agent as they are followed: the two conversations,
 * whether the narration's verdict came, whether the run's reply was
 * shown (the streams close once both have), and the moment they close
 * regardless: a process stores its records at its sink's tick, a
 * moment later, so a run's records can land
 * after the verdict and after the agent's own end; the streams stay
 * open for them up to a patience. */
interface FollowedTests {
  conversations: Conversation[];
  verdictSeen: boolean;
  replied: boolean;
  /** The tester's calls to the copy under test, begun and answered on
   * the tester's side; the copy's replies to them; and the copy's own
   * calls beneath them, begun and answered. Each side ships its records
   * from its own process at its own tick, and a call's reply can land
   * before its children's, so the story is whole only when every count
   * has its match. */
  calls: number;
  callsAnswered: number;
  copyReplies: number;
  copyCalls: number;
  copyCallsAnswered: number;
  closeBy?: number;
}

/** How long the tests' streams stay open after the verdict, or the
 * agent's end right behind it, for a run's records still on their way:
 * the sink's tick plus the store's moment. */
const REPLY_PATIENCE_MS = 5000;

/** The screen: folds the steps as they come and prints the log. */
/** Whether an agent id names a tester or a test form of a compile other
 * than this one (`<agent>-tester-<compile>-r<n>`, `<agent>-under-test-<compile>-r<n>`). */
function isAnotherCompilesRound(agentId: string, compileId: string): boolean {
  const round = /-(?:tester|under-test)-(compile-[0-9a-f]+)-r\d+$/.exec(agentId);
  return round !== null && round[1] !== compileId;
}

/** Whether an ask parked on the plane is one a compile waits on. An ask
 * raised since the compile began is, whoever raised it (a linked module
 * inside the agent under test asks as itself), unless a tester or a
 * test form of another compile did, whose ask is that compile's. An
 * older ask of an agent the compile works on, a row an earlier run left
 * pending, is the one the compile's own ask joins, and it joins it from
 * a test round: the row is the compile's once a round of it is under
 * way. Before that nothing of the compile waits on it, and no copy of
 * its agent stands to answer what the login's own steps ask of the
 * agent (a provider that checks the agent's url before it lets the
 * person go on). */
export function askOfCompile(
  row: PendingAsk,
  compile: {
    agents: readonly string[];
    compileId: string;
    startedAt: string;
    roundUnderWay: boolean;
  },
): boolean {
  const since = Date.parse(compile.startedAt) - 120_000;
  const fresh = row.requestedAt !== undefined && Date.parse(row.requestedAt) >= since;
  if (compile.agents.includes(row.agentId)) return fresh || compile.roundUnderWay;
  return fresh && !isAnotherCompilesRound(row.agentId, compile.compileId);
}

/** Whether a compile is held by an ask, so a watch that asks nobody
 * ends on it: the account of an agent the compile works on, whatever
 * the ask's age and whoever raised it first (a compile joins the ask a
 * run before it left), or an ask a call of this compile's own test
 * round waits on (a module linked into the agent under test asks for an
 * account of its own from there). An ask another agent raised a moment
 * ago is that agent's: several compiles of one hour stop on their own
 * accounts alone. The screen shows more than this holds a compile to. */
export function askHoldsCompile(
  row: PendingAsk,
  compile: { agents: readonly string[]; compileId: string },
): boolean {
  if (compile.agents.includes(row.agentId)) return true;
  // A round's call names its copy: the agent, the form, the compile, the round.
  const round = `_${compile.compileId.replaceAll('-', '_')}_r`;
  return row.callId !== undefined && row.callId.includes(round);
}

/** Whether a test round stands on the plane, by the steps a compile
 * has said: an agent's pair is deployed from its round's deploy until
 * the round's verdict, or the agent's end. */
function roundUnderWay(steps: readonly ProgressRecord[]): boolean {
  const open = new Set<string>();
  for (const step of steps) {
    const subject = step.subject;
    if (subject === undefined) continue;
    const ended = (step.step === 'verify' || step.step === 'agent') && step.state === 'end';
    if (ended) open.delete(subject);
    else if (step.step === 'deploy' || step.step === 'verify') open.add(subject);
  }
  return open.size > 0;
}

/** How a compile that answered ended, in the few words a login that
 * still holds the terminal is told. */
function outcomeWords(response: PlaneCompileResponse): string {
  const failed = response.agents
    .filter((agent) => agent.status === 'failed')
    .map((agent) => agent.agentId);
  if (failed.length > 0) return `${failed.join(', ')} failed`;
  if (response.status !== 'ok') return 'it failed';
  return response.agents.some((agent) => agent.verification === 'waiting')
    ? 'its tests stopped waiting for a login'
    : 'it passed';
}

/** What a login that still holds the terminal is told when its compile
 * ended: how it ended, and that the login is still the person's to
 * answer or to leave, the verdict following either way. */
function endedUnderLogin(outcome: string): string {
  return `the compile ended while this login waits: ${outcome}. The login above is still open: answer it to keep the account for the next run, or press Ctrl-C; the verdict follows either way.`;
}

/** The account an ask is for, in the words a person reads: the
 * account's name and its provider, or the ask's own words where it
 * names none. */
function accountWords(row: PendingAsk): string {
  return row.name === undefined
    ? row.account
    : `its account "${row.name}"${row.provider === undefined ? '' : ` (${row.provider})`}`;
}

/** A compile that met an account nobody is here to log in: what a
 * watch under `noAsk` ends with. It names the agent, the account and
 * the login, and says what became of the run on the plane: one that
 * had deployed nothing was stopped, one whose tests were running ends
 * by itself, the compile's own way, when its patience for the login is
 * over. */
export class AccountNeeded extends CernantoError {
  /** The exit a command ends with on it, apart from a failure's. */
  static readonly EXIT = 3;
  readonly exit: number = AccountNeeded.EXIT;
  /** The ask the compile waited on. */
  readonly ask: PendingAsk;
  /** Whether the compile was stopped on the plane. */
  readonly stopped: boolean;

  constructor(ask: PendingAsk, stopped: boolean) {
    super({
      kind: 'terminal',
      message: `${ask.agentId} needs ${accountWords(ask)}, and this run asks nobody (--no-ask): log it in with cernanto auth login ${ask.account}, then run this again${stopped ? '' : '; the test run that waits for it ends by itself on the plane'}`,
    });
    this.name = 'AccountNeeded';
    this.ask = ask;
    this.stopped = stopped;
  }
}

export class CompileScreen {
  private readonly options: CompileScreenOptions;
  private readonly records: ProgressRecord[] = [];
  private readonly seen = new Set<string>();
  private state: CompileState = { agents: [], retries: 0 };
  private headerPrinted = false;
  private printedLines = 0;
  private lastLineAt: number;
  private agentWidth = 'compile'.length;
  private finished = false;
  private stopSessions: (() => void) | undefined;
  private callId: string | undefined;
  /** The tests followed now, by the agent under test. */
  private readonly following = new Map<string, FollowedTests>();
  /** Who waits for the followed conversations to close. */
  private readonly settleWaiters: (() => void)[] = [];
  /** When each agent's deploy began: the run cannot begin before it,
   * so its streams read from there. */
  private readonly deployedAt = new Map<string, string>();
  /** Lines held while the inline connect owns the terminal. */
  private held: string[] | undefined;
  private readonly asksSeen = new Set<string>();
  /** Pending ask rows already surfaced, by row id. */
  private readonly askRowsSeen = new Set<string>();
  /** Accounts with a connect flow queued or running: the poll skips
   * them so one flow answers an account's rows, follow-ups included. */
  private readonly activeConnects = new Set<string>();
  private askPollBusy = false;
  /** The compile ended: nothing of it waits on an ask any more. */
  private asksOver = false;
  private connectChain: Promise<void> = Promise.resolve();
  /** The quiet form: whether a line of dots is open on the terminal,
   * and whether the plan has ended (the dots begin there). */
  private dotsOpen = false;
  /** The agents the open dots' line names: it closes when one of them
   * ends, with that agent's verdict. */
  private dotsAgents: string[] = [];
  /** What the compile read from the specs has been printed: the dots
   * begin after it, so the reads lines never break the dots' line. */
  private readsSeen = false;
  private planned = false;
  /** The quiet form: the last failing step of each agent, printed whole
   * with the agent's verdict when the agent fails. */
  private readonly lastFailure = new Map<string, ProgressRecord>();

  constructor(options: CompileScreenOptions) {
    this.options = options;
    this.callId = options.callId;
    this.lastLineAt = this.now();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private view(): CompileViewOptions {
    return {
      now: this.now(),
      ...(this.options.utc === undefined ? {} : { utc: this.options.utc }),
    };
  }

  /** The records seen so far, for a final reading. */
  get progress(): readonly ProgressRecord[] {
    return this.records;
  }

  get current(): CompileState {
    return this.state;
  }

  /** Prints the header once, and starts following the compile's
   * sessions: every tool a coder reaches for prints under the agent
   * and step running now (`+27s wrote src/index.ts`). */
  /** The compile's call id, once the compiler has taken the
   * compile: its sessions' activity is followed from here. */
  follow(callId: string): void {
    if (this.callId !== undefined) return;
    this.callId = callId;
    if (this.headerPrinted) this.followSessions();
  }

  private quiet(): boolean {
    return this.options.quiet === true;
  }

  start(): void {
    if (this.headerPrinted) return;
    this.headerPrinted = true;
    this.followSessions();
    if (this.quiet()) return;
    this.options.write(
      `${compileHeader({
        compileId: this.options.compileId,
        ...(this.options.verify === undefined ? {} : { verify: this.options.verify }),
        startedAt: this.options.startedAt,
        ...(this.options.utc === undefined ? {} : { utc: this.options.utc }),
      })}\n`,
    );
  }

  private line(text: string): void {
    if (this.held !== undefined) {
      this.held.push(text);
      return;
    }
    this.closeDots();
    this.options.write(`${text}\n`);
    this.printedLines += 1;
    this.lastLineAt = this.now();
  }

  /** The quiet form's sign of life: one dot per record the compile
   * produces once the plan has ended, on one line, so the terminal
   * moves while the model works and a log file reads as one line of
   * dots per stretch of work. A connect holding the terminal swallows
   * them. */
  private dot(): void {
    if (!this.quiet() || !this.planned || this.held !== undefined || this.finished) return;
    if (!this.readsSeen) return;
    // The dots are the agents' work: none once every agent that began
    // has ended, while the ship's own records go by.
    const agents = this.state.agents;
    const allEnded = agents.length > 0 && agents.every((row) => row.result !== undefined);
    if (allEnded) return;
    if (!this.dotsOpen) {
      // A fresh line names the agents compiling now, so the dots have
      // an owner: `compiling chain/middle ...`, several joined by
      // commas, past four the first three `and N more`.
      this.dotsAgents = agents
        .filter((row) => row.beganAt !== undefined && row.result === undefined)
        .map((row) => row.agentId);
      this.options.write(`compiling ${namesOf(this.dotsAgents)}`);
    }
    this.options.write('.');
    this.dotsOpen = true;
    this.lastLineAt = this.now();
  }

  /** Closes the dots' line; an agent's verdict closes it with its
   * words and time (`... verified live 48s`, the agent named when the
   * line held several), so the line reads as that agent's. */
  private closeDots(verdict?: { agentId: string; words: string; durationMs?: number }): void {
    if (!this.dotsOpen) return;
    if (verdict !== undefined && this.dotsAgents.includes(verdict.agentId)) {
      const who = this.dotsAgents.length > 1 ? `${verdict.agentId} ` : '';
      const time = verdict.durationMs === undefined ? '' : `  ${elapsed(verdict.durationMs)}`;
      this.options.write(` ${who}${verdict.words}${time}`);
    }
    this.options.write('\n');
    this.dotsOpen = false;
    this.dotsAgents = [];
  }

  /** Every inline connect settled: tests and the final table await it,
   * so the verdict prints after the last prompt. */
  get asksSettled(): Promise<void> {
    return this.connectChain;
  }

  /** The compile ended, so nothing waits on an ask from here: no poll
   * starts, the poll under way surfaces nothing when the plane answers
   * it, and a connect that has not begun never begins. The connect
   * that holds the terminal runs to its end, and is told at once how
   * the compile ended: the log waits behind its prompt, and a person
   * who reads the prompt alone would go on answering a run that is
   * over. */
  endAsks(ended?: string): void {
    const first = !this.asksOver;
    this.asksOver = true;
    if (!first || ended === undefined || this.held === undefined || this.finished) return;
    this.options.write(`\n${endedUnderLogin(ended)}\n`);
  }

  /** Whether an ask may still take the terminal. */
  private asking(): boolean {
    return !this.asksOver && !this.finished;
  }

  /** Runs the connect flow in this terminal: the log holds while the
   * operator types, then the held lines flush and streaming resumes. */
  private runConnect(account: string): void {
    const connect = this.options.onAsk;
    if (connect === undefined) return;
    this.activeConnects.add(account);
    this.connectChain = this.connectChain
      .then(async () => {
        if (!this.asking()) return;
        const held: string[] = [];
        this.held = held;
        try {
          await connect(account);
        } catch (error) {
          held.push(
            `login failed: ${error instanceof Error ? error.message : String(error)}; run: cernanto auth login ${account}`,
          );
        }
        // The verdict of an interrupted watch takes the held lines
        // with it; what is left is this connect's own to print.
        if (this.held === held) this.held = undefined;
        for (const text of held.splice(0)) this.line(text);
      })
      .catch(() => undefined)
      .then(() => {
        this.activeConnects.delete(account);
      });
  }

  /** One poll of the plane's pending asks. An ask whose trace record
   * never reaches a followed stream (a linked module inside the agent
   * under test records as itself, and the screen follows only the
   * tester and the subject) still surfaces here: the row prints on
   * the log and the connect flow answers it in this terminal, or a
   * pipe gets the command to run. Rows opened before this compile are
   * another run's business and stay out. */
  async pollAsks(): Promise<void> {
    const fetchRows = this.options.pendingAsks;
    if (fetchRows === undefined || !this.asking() || this.askPollBusy) return;
    this.askPollBusy = true;
    try {
      const rows = await fetchRows();
      // The compile ended while the plane was asked: its rows are no
      // longer this screen's to surface.
      if (!this.asking()) return;
      const compile = {
        agents: this.state.agents.map((agent) => agent.agentId),
        compileId: this.options.compileId,
        startedAt: this.options.startedAt,
        roundUnderWay: roundUnderWay(this.records),
      };
      for (const row of rows) {
        // The asks this compile waits on; another agent's old row and
        // another compile's round stay out of this screen, and a row an
        // earlier run left for one of its own agents waits for its round.
        if (!askOfCompile(row, compile)) continue;
        if (this.askRowsSeen.has(row.id) || this.activeConnects.has(row.account)) continue;
        this.askRowsSeen.add(row.id);
        const need =
          row.kind === 'fields'
            ? 'credentials'
            : row.kind === 'oauth'
              ? 'authorization'
              : 'a pairing';
        const running = this.state.agents.find((agent) => agent.running !== undefined);
        const who = running?.agentId ?? 'compile';
        const step = running?.running?.step ?? 'agent';
        const prefix = this.quiet()
          ? `${who.padEnd(this.agentWidth)}  `
          : `${timeOfDay(new Date(this.now()).toISOString(), this.options.utc)}  ${who.padEnd(this.agentWidth)}  ${step.padEnd(BUILD_STEP_WIDTH)}  `;
        const which = accountWords(row);
        this.line(`${prefix}${row.agentId} asked the operator ${need} for ${which}`);
        if (this.options.onAsk !== undefined) {
          this.runConnect(row.account);
        } else {
          this.line(
            `${' '.repeat(prefix.length)}log it in from another terminal: cernanto auth login ${row.account} (this run resumes by itself)`,
          );
        }
      }
    } catch {
      // The gateway hiccuped; the next poll tries again.
    } finally {
      this.askPollBusy = false;
    }
  }

  /** One step of the narration; a step read twice folds once. */
  record(record: ProgressRecord): void {
    const key = JSON.stringify([record.attemptId, record.seq]);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.records.push(record);
    this.start();
    if (record.step === 'plan' && record.state === 'end') {
      // The fleet fixes the agent column for the whole log.
      const ids = record.detail.split(':').slice(1).join(':').split(',');
      this.agentWidth = Math.max(this.agentWidth, ...ids.map((id) => id.trim().length));
    }
    this.agentWidth = Math.max(this.agentWidth, (record.subject ?? 'compile').length);
    this.state = foldCompile(this.records);
    if (this.quiet()) this.quietRecord(record);
    else if (showsInLog(record)) {
      this.line(progressLine(record, { ...this.view(), agentWidth: this.agentWidth }));
    }
    // A prepare holding on an mcp sign-in names the account in
    // `waitingFor` (the agent under compile and the server's host):
    // answered here like any parked ask (the log holds while the login
    // takes the terminal, and the same compile resumes by itself once the
    // account is logged in). Without a terminal the printed note
    // already names the command to run.
    if (record.state === 'note' && record.waitingFor !== undefined) {
      for (const target of record.waitingFor) {
        if (!this.asksSeen.has(`wait:${target}`)) {
          this.asksSeen.add(`wait:${target}`);
          if (this.options.onAsk !== undefined) this.runConnect(target);
        }
      }
    }
    this.followTests(record);
  }

  /** The quiet form of a record. What the compile read from a spec
   * prints as a line (`<agent>  reads a task`); the dots' line opens
   * after it (`compiling `); a failed agent's end closes it and
   * says the failure with the words of its last failing step beneath (a
   * passing agent ends on its card, after the compile); everything else
   * is a dot. */
  private quietRecord(record: ProgressRecord): void {
    const subject = record.subject;
    if (record.step === 'plan') {
      if (record.state === 'note' && subject !== undefined && /^reads /.test(record.detail)) {
        // The kind alone: where the compile read it (a label, the file
        // name, a quoted passage) is the log's.
        const detail = record.detail.replace(/^(reads an? [a-z]+)(?:[:,] .*)$/s, '$1');
        this.line(`${subject.padEnd(this.agentWidth)}  ${detail}`);
        this.readsSeen = true;
        return;
      }
      if (record.state === 'end') {
        // The plan has ended: the dots' line opens at the first dot
        // after what the compile read, named for the agents compiling.
        this.planned = true;
        this.lastLineAt = this.now();
      }
      return;
    }
    if (record.step === 'done') {
      this.closeDots();
      return;
    }
    if (subject === undefined) {
      this.dot();
      return;
    }
    // An agent's begin is bookkeeping, not work: no dot, so the line
    // that opens at its first step names every agent begun by then.
    if (record.step === 'agent' && record.state === 'begin') return;
    if (record.state === 'end' && record.ok === false && record.step !== 'agent') {
      this.lastFailure.set(subject, record);
    }
    if (record.step === 'agent' && record.state === 'end') {
      // An agent that passed closes its dots' line with its verdict and
      // ends on its card after the compile; a failure has no card, so
      // its verdict and its last failing step's words print here.
      if (record.result === 'failed' || record.ok === false) {
        this.line(`${subject.padEnd(this.agentWidth)}  failed: ${record.detail}`);
        const failure = this.lastFailure.get(subject);
        if (failure !== undefined && failure.detail !== record.detail) {
          this.line(`  ${recordMessage(failure).replace(/\n/g, '\n  ')}`);
        }
      }
      this.lastFailure.delete(subject);
      if (record.result !== 'failed' && record.ok !== false) {
        this.closeDots({
          agentId: subject,
          words: record.detail,
          ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
        });
      }
      return;
    }
    this.dot();
  }

  /** The tests' conversations: followed from the verify step, which
   * names the tester (the streams read from the deploy's moment, so
   * the run's first record is caught), until the narration's verdict
   * came and the run's reply record was shown: a process ships its
   * records at its sink's tick, so the reply may land after the
   * verdict, and after the agent's own end when the two land together;
   * the streams stay open for it up to the patience. A second deploy
   * after a fix follows again, fresh. */
  private followTests(record: ProgressRecord): void {
    const source = this.options.conversations;
    const subject = record.subject;
    if (source === undefined || subject === undefined || this.options.verify === false) return;
    if (record.step === 'deploy' && record.state === 'begin') {
      this.deployedAt.set(subject, record.at);
      this.unfollow(subject);
      return;
    }
    if (record.step === 'verify' && record.state === 'begin') {
      this.unfollow(subject);
      // The pair the round shipped: the tester's id, then the copy
      // under test's (the test form, a fresh copy per round); a
      // narration naming the tester alone leaves the agent under compile
      // to stand for its copy.
      const [tester = record.detail, copy = subject] = record.detail.split(' ');
      const since =
        this.deployedAt.get(subject) ?? new Date(Date.parse(record.at) - 2000).toISOString();
      const testerSide = new Conversation(tester, since, tester, undefined);
      const agentSide = new Conversation(copy, since, tester, testerSide.known);
      const followed: FollowedTests = {
        conversations: [testerSide, agentSide],
        verdictSeen: false,
        replied: false,
        calls: 0,
        callsAnswered: 0,
        copyReplies: 0,
        copyCalls: 0,
        copyCallsAnswered: 0,
      };
      this.following.set(subject, followed);
      for (const conversation of followed.conversations) {
        conversation.start(source, (item, rendered) => {
          if (!conversation.accepts(item)) return;
          this.chat(subject, conversation, item, rendered);
          if (item.agentId === tester) {
            if (item.kind === 'begin' && item.of === 'call' && item.target === copy) {
              followed.calls += 1;
            }
            if (item.kind === 'agent-call' && item.target === copy) followed.callsAnswered += 1;
            if (item.kind === 'handler' && item.error === undefined) followed.replied = true;
          } else if (item.agentId === copy) {
            if (item.kind === 'handler' && item.callerAgentId === tester) followed.copyReplies += 1;
            if (item.kind === 'begin' && item.of === 'call') followed.copyCalls += 1;
            if (item.kind === 'agent-call') followed.copyCallsAnswered += 1;
          }
          this.settle(subject, followed);
        });
      }
      return;
    }
    if ((record.step === 'verify' || record.step === 'agent') && record.state === 'end') {
      // The verdict, or the agent's end right behind it: the streams
      // stay open for the rest of the story, up to the patience.
      const followed = this.following.get(subject);
      if (followed === undefined) return;
      followed.verdictSeen = true;
      followed.closeBy ??= this.now() + this.patience();
      this.settle(subject, followed);
    }
  }

  /** The story is on the log once the verdict came, the run's reply
   * was shown, every call the tester made to the copy was answered on
   * both sides, and every call the copy made beneath them was answered
   * too; short of that the streams stay open, up to the patience. */
  private settle(subject: string, followed: FollowedTests): void {
    if (!followed.verdictSeen || !followed.replied) return;
    const whole =
      followed.callsAnswered >= followed.calls &&
      followed.copyReplies >= followed.calls &&
      followed.copyCallsAnswered >= followed.copyCalls;
    if (whole) this.unfollow(subject);
    else followed.closeBy ??= this.now() + this.patience();
  }

  private patience(): number {
    return this.options.patienceMs ?? REPLY_PATIENCE_MS;
  }

  /** The follows whose patience passed close, reply shown or not. */
  private sweepFollows(): void {
    const now = this.now();
    for (const [subject, followed] of [...this.following]) {
      if (followed.closeBy !== undefined && followed.closeBy <= now) this.unfollow(subject);
    }
  }

  /** Resolves once every followed conversation closed (its run's reply
   * shown) or its patience passed: the verdict waits for it, so a run's
   * last records, still on their way at the narration's end, print
   * before the table. */
  conversationsSettled(): Promise<void> {
    if (this.following.size === 0) return Promise.resolve();
    const now = this.now();
    for (const followed of this.following.values()) followed.closeBy ??= now + this.patience();
    const latest = Math.max(...[...this.following.values()].map((row) => row.closeBy ?? now));
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.max(0, latest - now));
      this.settleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private unfollow(subject: string): void {
    for (const conversation of this.following.get(subject)?.conversations ?? []) conversation.end();
    this.following.delete(subject);
    if (this.following.size > 0) return;
    for (const settle of this.settleWaiters.splice(0)) settle();
  }

  /** One record of a conversation, on the log's grid like every other
   * line: the log's time, the agent under compile, the step (`verify`:
   * the tests run on the plane), then the head of the line as the chat
   * reads it (the tester's lines marked `tester`, a linked module
   * named, the agent's own bare); the body under it (the arguments, the
   * answer) is the trace's, `cernanto trace <agent> -f`. */
  private chat(
    subject: string,
    conversation: Conversation,
    record: TraceRecord,
    rendered: string[] | undefined,
  ): void {
    const lines = conversation.lines(record, rendered);
    if (lines.length === 0) return;
    if (this.quiet()) {
      this.dot();
      return;
    }
    const prefix = `${timeOfDay(record.at, this.options.utc)}  ${subject.padEnd(this.agentWidth)}  ${'verify'.padEnd(BUILD_STEP_WIDTH)}  `;
    this.line(`${prefix}${(lines[0] ?? '').slice(CHAT_GUTTER)}`);
  }

  /** The sessions' activity: the harness module's records under this
   * compile's call, each printed under the agent and step that
   * runs now (one session runs at a time in a compile). */
  private followSessions(): void {
    const source = this.options.activity;
    const callId = this.callId;
    if (this.stopSessions !== undefined) return;
    if (source === undefined || callId === undefined) return;
    // A vendor agent's turn is its own call: its begin record
    // names the compile call as its parent, and from then on its log
    // lines are this compile's session narration.
    const vendorTurns = new Set<string>();
    const stops = SESSION_AGENTS.map((agent) =>
      source.callsStream(agent, (record) => {
        if (
          (record.kind === 'begin' || record.kind === 'handler') &&
          record.parentCallId === callId
        ) {
          vendorTurns.add(record.callId);
          return;
        }
        if (record.kind !== 'log' || record.level !== 'info') return;
        const root = record.callId.split('~')[0] ?? record.callId;
        if (root !== callId && !vendorTurns.has(record.callId)) return;
        if (this.quiet()) {
          this.dot();
          return;
        }
        const running = this.stateAt(record.at).agents.find((row) => row.running !== undefined);
        const who = running?.agentId ?? 'compile';
        const step = running?.running?.step ?? 'agent';
        this.line(
          `${timeOfDay(record.at, this.options.utc)}  ${who.padEnd(this.agentWidth)}  ${step.padEnd(BUILD_STEP_WIDTH)}  ${record.message}`,
        );
      }),
    );
    this.stopSessions = (): void => {
      for (const stop of stops) stop();
    };
  }

  /** The compile as its steps had said it at a moment. A session line
   * reaches the screen from the store at its sink's tick, often after
   * a later step's record, so it is labelled with the step running at
   * its own time. */
  private stateAt(at: string): CompileState {
    if (!this.records.some((one) => one.at > at)) return this.state;
    return foldCompile(this.records.filter((one) => one.at <= at));
  }

  /** The clock tick: a long step in silence says it is still running,
   * with how long it has run, so a person (or a CI log) sees that the
   * compile is alive. */
  tick(): void {
    this.sweepFollows();
    if (this.finished || this.held !== undefined) return;
    const heartbeatMs = this.options.heartbeatMs ?? 30_000;
    if (this.now() - this.lastLineAt < heartbeatMs) return;
    const running = this.state.agents.find((row) => row.running !== undefined);
    if (running?.running === undefined) return;
    if (this.quiet()) {
      this.dot();
      return;
    }
    const since = Date.parse(running.running.since);
    const took = Number.isFinite(since) ? elapsed(this.now() - since) : '';
    this.line(
      `${timeOfDay(new Date(this.now()).toISOString(), this.options.utc)}  ${running.agentId.padEnd(this.agentWidth)}  ${running.running.step.padEnd(BUILD_STEP_WIDTH)}  still running  ${took}`.trimEnd(),
    );
  }

  /** The end: the summary table and the verdict line, after the lines
   * a connect still holds (an interrupt ends the watch while a login
   * has the terminal). */
  finish(input: {
    traceHandle?: string;
    totalMs?: number;
    failure?: string;
    /** Every diagnostic's line, for the done line's count: the size
     * warning and the spec issues. */
    diagnostics?: string[];
  }): void {
    if (this.finished) return;
    this.finished = true;
    if (this.held !== undefined) {
      const flush = this.held.splice(0);
      this.held = undefined;
      for (const text of flush) this.line(text);
    }
    if (input.failure !== undefined) {
      this.state.done = {
        ok: false,
        detail: input.failure,
        at: new Date(this.now()).toISOString(),
      };
      for (const row of this.state.agents) {
        delete row.running;
        if (row.result === undefined) {
          row.result = 'failed';
          row.resultWords = input.failure;
        }
      }
    }
    this.stopSessions?.();
    this.stopSessions = undefined;
    for (const subject of [...this.following.keys()]) this.unfollow(subject);
    this.start();
    const view = this.view();
    if (this.quiet()) {
      this.closeDots();
      if (input.failure !== undefined) this.line(input.failure);
      // A compile that completed has said everything in its agents'
      // verdict lines; the done line is for a compile that did not.
      const done = this.state.done;
      if (done?.ok === true && done.detail === 'compile complete' && input.failure === undefined) {
        return;
      }
    } else {
      const table = compileTable(this.state, view);
      if (this.state.agents.length > 0) {
        this.options.write(`${this.printedLines > 0 ? '\n' : ''}${table.join('\n')}\n`);
      }
    }
    this.options.write(
      `${doneLine(this.state, {
        ...view,
        ...(input.traceHandle === undefined ? {} : { traceHandle: input.traceHandle }),
        ...(input.totalMs === undefined ? {} : { totalMs: input.totalMs }),
        diagnostics: input.diagnostics ?? [],
      })}\n`,
    );
  }
}

/** What the verbs pass through to the plane compile and the screen. */
export interface WatchedCompileOptions {
  /** The compile's own id; minted by the compile when absent. */
  compileId?: string;
  verify?: boolean;
  /** The whole road: the plane ships inside itself; off, a compile. */
  deploy?: boolean;
  /** No previous contract: the session writes one from the spec. */
  newContract?: boolean;
  recompile?: boolean;
  /** Dry run: stop after the change step of every target and print the
   * plans alone. */
  dryRun?: boolean;
  failFast?: boolean;
  /** A contract per agent id the compile uses as it is (the operator's
   * declaration file), whatever the tree or the plane holds. */
  contracts?: Record<string, string>;
  /** The coding model and effort for this compile's sessions. */
  model?: string;
  effort?: string;
  /** Called for every package the deploy wrote back beside its spec. */
  onPackageWritten?: (written: { agentId: string; path: string; digest: string }) => void;
  quiet?: boolean;
  utc?: boolean;
  /** No screen at all: the caller prints the response as json. */
  json?: boolean;
  write?: (text: string) => void;
  agentsRoot?: string;
  pollMs?: number;
  tickMs?: number;
  heartbeatMs?: number;
  /** Answers a parked credential ask in this terminal (the screen's
   * onAsk); absent, the log names the command to run instead. */
  onAsk?: (account: string) => Promise<void>;
  /** The plane's pending credential asks (the screen's watcher). */
  pendingAsks?: () => Promise<PendingAsk[]>;
  /** How often the pending asks are polled (2s). */
  askPollMs?: number;
  /** Nobody is here to log an account in: the first ask the compile
   * waits on ends the watch with `AccountNeeded`, at once, where the
   * compile would wait for the login. A compile that has deployed
   * nothing yet is stopped on the plane; one whose tests are running is
   * left to end by itself, the pair it deployed removed by the compile's
   * own patience, since a stop there would leave the pair behind. */
  noAsk?: boolean;
  /** Ctrl-C detaches (the default); false leaves the signal alone. */
  detachOnInterrupt?: boolean;
  /** How the detach leaves the process (process.exit by default). */
  exit?: (code: number) => void;
}

/** What Ctrl-C says: the compile is the plane's, not this terminal's.
 * Detaching leaves it running; the words say how to follow it and how
 * to stop it (`gh run watch` and Terraform's first interrupt). A compile
 * the compiler has not taken yet has no trace to follow: `stored`
 * is the id of its call as the plane stored it, which a cancellation
 * takes. */
export function detachHint(callId: string | undefined, stored?: string): string {
  if (callId !== undefined) {
    return `detached; the compile continues on the plane: cernanto trace ${callId} to follow it, cernanto cancel ${callId} to stop it\n`;
  }
  if (stored !== undefined) {
    return `detached; the compile waits for the compiler on the plane: cernanto cancel ${stored} to stop it\n`;
  }
  return 'detached; the compile continues on the plane\n';
}

/**
 * Runs one plane compile under the screen: the header goes up as the
 * plane accepts the compile, records print as they land, a clock tick
 * keeps the heartbeat, and the table and verdict line close with the
 * trace handle. Returns the plane's response; a compile the plane could
 * not finish still closes the screen before the error surfaces. Ctrl-C
 * detaches: the compile is the plane's and continues; the hint says how
 * to follow it and how to cancel it.
 */
export async function watchedCompile(
  client: CompileClient,
  targets: string[],
  options: WatchedCompileOptions = {},
): Promise<{
  response: PlaneCompileResponse;
  callId?: string;
  tests: Record<string, number>;
  /** The diagnostics the verb ends on: the size warning's line, then
   * the plan's spec issues as lines with their remedies. */
  diagnostics: Diagnostic[];
}> {
  const write = options.write ?? ((text: string): void => void process.stdout.write(text));
  // The author's page of an agent, by its path from the agents root,
  // for the spec issues' lines; an agent the workspace does not hold
  // is named by its id.
  const pathOf = (agentId: string): string | undefined => {
    if (options.agentsRoot === undefined) return undefined;
    const spec = workspaceSpecOf(options.agentsRoot, agentId);
    return spec === undefined ? undefined : relative(options.agentsRoot, spec);
  };
  const startedAt = new Date().toISOString();
  const started = Date.now();
  /** The compile's own call id, once the compiler has taken it. */
  let callId: string | undefined;
  /** The id of the compile's call as the plane stored it. */
  let stored: string | undefined;
  let compileId: string | undefined;
  let screen: CompileScreen | undefined;
  const timer =
    options.json === true ? undefined : setInterval(() => screen?.tick(), options.tickMs ?? 1000);
  timer?.unref();
  // The ask watcher: a credential ask raised by any agent during the
  // compile surfaces in this terminal even when no followed trace
  // stream carries its record (a linked module's ask rides the
  // module's own stream).
  const askTimer =
    options.json === true || options.pendingAsks === undefined || options.noAsk === true
      ? undefined
      : setInterval(() => void screen?.pollAsks(), options.askPollMs ?? 2000);
  askTimer?.unref();
  // Under `noAsk` nobody answers, on a screen or without one: the first
  // ask this compile waits on ends the watch. The steps read so far say
  // which agents the compile works on and whether a round's pair stands.
  const steps: ProgressRecord[] = [];
  let needed: AccountNeeded | undefined;
  let looking = false;
  const lookForAsk = async (): Promise<void> => {
    const id = compileId;
    const asks = options.pendingAsks;
    if (needed !== undefined || looking || id === undefined || asks === undefined) return;
    looking = true;
    try {
      const rows = await asks();
      const agents = [...targets, ...foldCompile(steps).agents.map((row) => row.agentId)];
      const ask = rows.find((row) => askHoldsCompile(row, { agents, compileId: id }));
      if (ask === undefined) return;
      // A compile that deployed nothing is stopped where it stands; one
      // whose round is under way keeps its own ending, which removes
      // the pair it deployed.
      let stopped = false;
      const call = callId ?? stored;
      if (!roundUnderWay(steps) && call !== undefined && client.cancel !== undefined) {
        stopped = await client.cancel(call).then(
          () => true,
          () => false,
        );
      }
      needed = new AccountNeeded(ask, stopped);
    } catch {
      // The gateway hiccuped; the next look asks again.
    } finally {
      looking = false;
    }
  };
  const noAskTimer =
    options.noAsk === true && options.pendingAsks !== undefined
      ? setInterval(() => void lookForAsk(), options.askPollMs ?? 2000)
      : undefined;
  noAskTimer?.unref();
  /** The verdict of a compile that ended, said once: when this watch
   * ends, or at an interrupt that comes while a login still holds the
   * terminal. */
  let verdict: (() => void) | undefined;
  const onInterrupt = (): void => {
    // A compile still running goes on without this terminal; one that
    // ended has its verdict to say.
    if (verdict === undefined) {
      write(`\n${detachHint(callId, stored)}`);
    } else {
      write('\n');
      verdict();
    }
    (options.exit ?? process.exit)(130);
  };
  if (options.detachOnInterrupt !== false) process.once('SIGINT', onInterrupt);
  try {
    const response = await planeCompile(client, targets, {
      ...(options.verify === undefined ? {} : { verify: options.verify }),
      ...(options.deploy === undefined ? {} : { deploy: options.deploy }),
      ...(options.newContract === undefined ? {} : { newContract: options.newContract }),
      ...(options.recompile === undefined ? {} : { recompile: options.recompile }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      ...(options.contracts === undefined ? {} : { contracts: options.contracts }),
      ...(options.failFast === undefined ? {} : { failFast: options.failFast }),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(options.onPackageWritten === undefined
        ? {}
        : { onPackageWritten: options.onPackageWritten }),
      onLine: (line) => {
        write(line);
      },
      ...(options.agentsRoot === undefined ? {} : { agentsRoot: options.agentsRoot }),
      ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
      ...(options.compileId === undefined ? {} : { compileId: options.compileId }),
      onSubmitted: (handles) => {
        stored = handles.callId;
        compileId = handles.compileId;
        // The compile is the plane's from here: a refused gateway request
        // now is the gateway rolling under its own ship, and the poll
        // asks it again.
        whenLoopbackDown(undefined);
        if (options.json === true) return;
        const utc = options.utc === true;
        screen = new CompileScreen({
          write,
          ...(options.quiet === undefined ? {} : { quiet: options.quiet }),
          ...(options.utc === undefined ? {} : { utc: options.utc }),
          compileId: handles.compileId,
          ...(options.verify === undefined ? {} : { verify: options.verify }),
          startedAt,
          ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
          // Under `noAsk` the screen answers no ask and surfaces none:
          // the watch ends on the first one, in its own words.
          ...(options.onAsk === undefined || options.noAsk === true
            ? {}
            : { onAsk: options.onAsk }),
          ...(options.pendingAsks === undefined || options.noAsk === true
            ? {}
            : { pendingAsks: options.pendingAsks }),
          // The sessions' activity rides the gateway's live streams, once
          // the compile's own call is known.
          activity: {
            callsStream: (agentId, onRecord) =>
              client.callsStream(agentId, { backlog: 0 }, onRecord),
          },
          // The tests' conversations ride them too, from the deploy's
          // moment, each record rendered on the plane as the live
          // stream shows it.
          conversations: {
            callsStream: (agentId, options, onRecord) =>
              client.callsStream(
                agentId,
                {
                  ...(options.since === undefined ? { backlog: 0 } : { since: options.since }),
                  view: 'live',
                  ...(utc ? { utc: true } : {}),
                },
                onRecord,
              ),
          },
        });
        screen.start();
      },
      onTaken: (taken) => {
        callId = taken;
        screen?.follow(taken);
      },
      onProgress: (step) => {
        steps.push(step);
        screen?.record(step);
      },
      halted: () => needed,
    });
    const diagnostics: Diagnostic[] = [
      ...response.issues.map((issue) => issueDiagnostic(issue, pathOf)),
    ];
    verdict = (): void => {
      screen?.finish({
        ...(callId === undefined ? {} : { traceHandle: callId }),
        totalMs: Date.now() - started,
        diagnostics: diagnostics.map((item) => item.line),
      });
    };
    // The compile ended: no ask surfaces from here. A connect still
    // prompting owns the terminal and is told so; the verdict waits.
    screen?.endAsks(outcomeWords(response));
    await screen?.asksSettled;
    // So does a run whose last records are still on their way.
    await screen?.conversationsSettled();
    verdict();
    // The tests each agent passed, for its card.
    const tests: Record<string, number> = {};
    for (const row of screen?.current.agents ?? []) {
      if (row.run?.ok === true && row.run.total !== undefined) tests[row.agentId] = row.run.total;
    }
    return {
      response,
      ...(callId === undefined ? {} : { callId }),
      tests,
      diagnostics,
    };
  } catch (error) {
    verdict = (): void => {
      screen?.finish({
        failure: error instanceof Error ? error.message : String(error),
        ...(compileId === undefined ? {} : { traceHandle: compileId }),
        totalMs: Date.now() - started,
      });
    };
    // A compile that failed ends as one that passed does: no ask
    // surfaces from here, and the verdict and the failure wait for the
    // connect that holds the terminal, which is told the compile failed.
    const why = (error instanceof Error ? error.message : String(error)).split('\n', 1)[0] ?? '';
    screen?.endAsks(`it failed: ${why.length > 160 ? `${why.slice(0, 157)}...` : why}`);
    await screen?.asksSettled;
    verdict();
    throw error;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    if (timer !== undefined) clearInterval(timer);
    if (askTimer !== undefined) clearInterval(askTimer);
    if (noAskTimer !== undefined) clearInterval(noAskTimer);
  }
}

/** The agents a dots' line names: up to four, past that the first
 * three and `and N more`; an empty set names nothing (`compiling `). */
function namesOf(agents: string[]): string {
  if (agents.length === 0) return '';
  if (agents.length <= 4) return `${agents.join(', ')} `;
  return `${agents.slice(0, 3).join(', ')} and ${String(agents.length - 3)} more `;
}
