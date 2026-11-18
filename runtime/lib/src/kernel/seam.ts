// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// THE SEAM: everything the runtime knows of the platform, on one page.
// The platform's agents are compiled from their own pages and move by
// their own deploys; the runtime is written by hand and moves with a
// release. So what the runtime depends on of an agent is said here
// once, with its types: the agents it reaches by name, each function it
// calls with what it sends and what it reads of the answer, the
// implementors a machine fits, the records of other owners it reads,
// and the words of its own the platform speaks to it.
//
// No other file of the runtime names a platform agent (the style check
// refuses one), the runtime's code is held to these types by its own
// type-check, and a census compiles them against the contracts of the
// packages in the tree. The runtime sends every call by name and knows
// no order of parameters: a function's one parameter rides as itself,
// several as one record keyed by the contract's names.

// --- The agents -------------------------------------------------------

/** The controller: told of a need, of a copy ready and of a copy gone. */
export const CONTROLLER_AGENT = 'cernanto/controller';
/** The host job: the one agent of a release that keeps a root
 * launcher's privileges, asked for a copy's start and its image, rung
 * by the block and told the host's stop. */
export const HOST_AGENT = 'cernanto/host';
/** The configuration: asked which implementor an interface defaults to. */
export const CONFIG_AGENT = 'cernanto/config';
/** The warehouse: asked for a package the release does not carry. */
export const PACKAGES_AGENT = 'cernanto/packages';
/** The safe: the custody agent a lane module asks for its credentials. */
export const CUSTODY_AGENT = 'cernanto/auth';

/** The port the host job's generation boots on: the one entry of the
 * release's bring-up set the block itself reads. */
export const HOST_PORT = 19995;

// --- The functions ----------------------------------------------------

/** One function of a platform agent as the runtime calls it. `Sends`
 * is what the runtime sends: the function's one parameter as itself,
 * or several as one record keyed by the contract's parameter names.
 * `Reads` is what the runtime reads of the answer. Neither is a value:
 * the entry carries the two types for the type-check and the census. */
export interface SeamFunction<Sends, Reads> {
  readonly agentId: string;
  readonly handler: string;
  /** The contract marks the function's values secret, so the call
   * keeps its arguments and its answer out of the traces. */
  readonly secret?: true;
  /** The entry's two types; never set. */
  readonly types?: { readonly sends: Sends; readonly reads: Reads };
}

/** What an entry sends. */
export type SendsOf<Entry> = Entry extends { readonly types?: { readonly sends: infer Sends } }
  ? Sends
  : never;
/** What the runtime reads of an entry's answer. */
export type ReadsOf<Entry> = Entry extends { readonly types?: { readonly reads: infer Reads } }
  ? Reads
  : never;

function plain<Sends, Reads>(agentId: string, handler: string): SeamFunction<Sends, Reads> {
  return { agentId, handler };
}

function secret<Sends, Reads>(agentId: string, handler: string): SeamFunction<Sends, Reads> {
  return { agentId, handler, secret: true };
}

/** A copy as the controller and the host job are told of it. */
export interface CopyNamed {
  agentId: string;
  port: number;
  copy: number;
  host: string;
}

/** A copy's image as the host job names it, in its answer to a dump and
 * on the copy's record: the archive's name and the position each of
 * the copy's logs stood at when it was taken. */
export interface ImageNamed {
  image: string;
  journals: { subject: string; position: number }[];
}

/** One credential field the operator fills, as the safe is asked it. */
export interface SafeField {
  name: string;
  label: string;
  secret?: boolean;
}

/** The functions of the platform the runtime calls, by agent. */
export const SEAM = {
  controller: {
    /** An agent no copy of which takes a call. */
    need: plain<string, unknown>(CONTROLLER_AGENT, 'need'),
    /** A copy serves. */
    copyReady: plain<CopyNamed, unknown>(CONTROLLER_AGENT, 'copyReady'),
    /** A copy left, and why. */
    copyExited: plain<CopyNamed & { why?: string }, unknown>(CONTROLLER_AGENT, 'copyExited'),
  },
  host: {
    /** A copy that serves asks its host's host job to look at its record. */
    start: plain<{ port: number; copy: number }, unknown>(HOST_AGENT, 'start'),
    /** A copy asks for its own image once its journal passed its bound. */
    dump: plain<{ port: number; copy: number }, ImageNamed>(HOST_AGENT, 'dump'),
    /** The block rings the host job's one run for the life of the host. */
    serve: plain<Record<string, never>, { ended: string }>(HOST_AGENT, 'serve'),
    /** The host's stop, with the grace its copies are given; answers
     * whether a serve took it, which a host job whose serve does not
     * run did not. */
    stopAll: plain<number | undefined, { asked: boolean }>(HOST_AGENT, 'stopAll'),
  },
  config: {
    /** The implementor an interface defaults to, when one is set. */
    defaultOf: secret<string, { value: unknown }>(CONFIG_AGENT, 'defaultOf'),
  },
  packages: {
    /** How many slices and bytes a package has, when the plane holds it. */
    packageManifest: plain<string, { manifest: { slices: number; bytes: number } | null }>(
      PACKAGES_AGENT,
      'packageManifest',
    ),
    /** One slice of a package, as base64. */
    packageSlice: plain<{ digest: string; index: number }, { data: string | null }>(
      PACKAGES_AGENT,
      'packageSlice',
    ),
    /** One entry of a package, as text. */
    packageEntry: plain<{ digest: string; name: string }, { text: string | null }>(
      PACKAGES_AGENT,
      'packageEntry',
    ),
  },
  safe: {
    login: secret<
      {
        provider: string;
        instructions: string;
        fields: SafeField[];
        helpUrl: string;
        settings?: { name?: string; scopes?: string[]; refused?: string };
      },
      { fields: Record<string, string>; scopes: string[] }
    >(CUSTODY_AGENT, 'login'),
    pin: plain<{ provider: string; name?: string }, { state: string; redirectUrl: string }>(
      CUSTODY_AGENT,
      'pin',
    ),
    authorize: secret<
      {
        provider: string;
        authUrl: string;
        scopes?: string[];
        name?: string;
        settings?: { state?: string; codeVerifier?: string };
      },
      { code: string; codeVerifier?: string }
    >(CUSTODY_AGENT, 'authorize'),
    read: secret<{ name: string }, { value: string | null }>(CUSTODY_AGENT, 'read'),
    store: secret<
      { provider: string; kind: string; value: string; name?: string },
      { ok: boolean }
    >(CUSTODY_AGENT, 'store'),
    saveState: secret<{ name: string; state: unknown; grantedScopes?: string[] }, { ok: boolean }>(
      CUSTODY_AGENT,
      'saveState',
    ),
    state: secret<{ name: string; requiredScopes?: string[] }, { state: unknown; stale: boolean }>(
      CUSTODY_AGENT,
      'state',
    ),
    accepted: plain<{ name: string }, { ok: boolean }>(CUSTODY_AGENT, 'accepted'),
  },
} as const;

// --- The fit ----------------------------------------------------------

/** The store's implementors on each kind of place: the interfaces the
 * plane's place decides, each with the implementor of that place. */
export const STORE_IMPLEMENTORS: Readonly<
  Record<'files' | 'dynamodb', Readonly<Record<string, string>>>
> = {
  files: {
    'cernanto/documents': 'cernanto/documents/sqlite',
    'cernanto/objects': 'cernanto/objects/files',
    'cernanto/trace/reader': 'cernanto/trace/reader/sqlite',
  },
  dynamodb: {
    'cernanto/documents': 'cernanto/documents/dynamodb',
    'cernanto/objects': 'cernanto/objects/s3',
    'cernanto/trace/reader': 'cernanto/trace/reader/dynamodb',
  },
};

// --- The records of other owners ---------------------------------------

/** The fleet, the controller's record: the rows the materialize reads
 * a deployed dependency's facts off. */
export const FLEET_RECORD = 'controller/fleet';

/** One row of the fleet, as the materialize reads it: what the fleet
 * says of a deployed agent. An interface's row carries its contract as
 * text (the contract is its whole artifact); any row may name the
 * package it came from. */
export interface FleetRow {
  agentId: string;
  artifact?: string | undefined;
  type?: 'service' | 'task' | 'job' | 'module' | 'worker' | 'interface' | undefined;
  handlers?: string[] | undefined;
  /** The contract text the row carries: an interface's whole artifact. */
  contract?: string | undefined;
  /** The earlier contracts this one is compatible with, as the compile
   * judged them and the landing wrote them on the row. */
  contractCompatibleWith?: string[] | undefined;
}

/** The fleet's record as the materialize reads it. */
export interface FleetDocument {
  agents?: FleetRow[];
}

/** The orders, the controller's records: one per generation under its
 * port. */
export const ORDERS_PREFIX = 'generations/';

/** A generation's order as the kernel reads it: the agent it launches
 * and the life it launches it under, and whether it was retired. */
export interface OrderRecord {
  launch?: { agentId?: unknown; life?: unknown };
  retiredAt?: unknown;
}

/** The trace agent's retention setting, as the configuration's record
 * of it holds it: the value's JSON text. */
export const TRACE_RETENTION_RECORD = 'config/setting/cernanto/trace/retention-minutes';

/** A copy's record, `copies/<generation>/<copy>`, in the fields the
 * platform's agents write on it and the kernel reads: the controller's
 * (the host it placed the copy on and the epoch of that tenure, the
 * launch, the words `draining` and `park`, the host found gone) and the
 * host job's (the stop word, the image). The runtime writes the rest of
 * the record itself, the launcher the process it started and the copy's
 * own kernel its entry; `kernel/copy-record.ts` reads the whole. */
export interface CopyRecord {
  /** The host the copy is placed on. */
  host?: string;
  /** The epoch of the holder's tenure: one for a fresh record, one
   * more at every move. */
  epoch?: number;
  /** What the record launches: the agent, and the life it runs under. */
  launch?: { agentId?: string; life?: string };
  /** The word that the copy drains: a newer generation serves, or its
   * host leaves. */
  draining?: true;
  /** The word that the copy parks. */
  park?: true;
  /** The moment the plane found the copy's host gone. */
  hostGoneAt?: number;
  /** The stop word: the attempt it stops, when it names one, and the
   * moment it was said. */
  stop?: { attempt?: string; at?: number };
  /** The copy's image, when the host job took one. */
  image?: ImageNamed;
}

// --- The kernel's own words --------------------------------------------

/** The runtime's own function on every task and job: the agent's newest
 * generation takes over the calls a retired generation still held when
 * its copies died. No exported function can carry the name. The
 * controller asks it. */
export const HAND_ON_HANDLER = '#handOn';

/** What a hand-on asks: the generation whose logs are taken over, by
 * its port, every copy's, or with `owner` (`copy-<n>`) the one dead
 * copy's of the taker's own generation. Nothing when the arguments name
 * no generation. Read here once, for the copy that takes the hand-on
 * and for whoever chooses that copy, which is never one it hands on. */
export function handOnAsked(args: unknown): { generation: string; copy?: number } | undefined {
  const asked = args as { generation?: unknown; owner?: unknown } | null | undefined;
  const named = asked?.generation;
  const generation =
    typeof named === 'string' ? named : typeof named === 'number' ? String(named) : undefined;
  if (generation === undefined) return undefined;
  const owner = asked?.owner;
  const copy =
    typeof owner === 'string' && owner.startsWith('copy-')
      ? Number(owner.slice('copy-'.length))
      : typeof owner === 'number'
        ? owner
        : undefined;
  return copy === undefined ? { generation } : { generation, copy };
}

/** The runtime's own function on every agent that answers the life an
 * agent's name stands under, made when none stands:
 * `{agentId, ending?}` answered `{life}`, the kernel acting since it
 * owns the record, the files and the keys. The controller asks it of
 * the host job at an agent's admission, the host job of itself at a
 * plane's birth. */
export const LIFE_HANDLER = '#life';

/** The runtime's own function on every agent that ends a life: the
 * name's record stops naming it and everything kept under it is
 * removed, `{agentId, life}` answered `{done}` (false asks again
 * later). The controller asks it. */
export const END_LIFE_HANDLER = '#endLife';

/** The roads of a copy's call server the platform comes by, beside the
 * two the copies speak to each other on: the three words the host job
 * says to a copy, the stream a follower of its traces reads, and the
 * workload a listing asks. */
export const COPY_ROADS = {
  stop: '/stop',
  park: '/park',
  drain: '/drain',
  stream: '/stream',
  workload: '/workload',
} as const;

/** The block's words about the machine it runs on, which the
 * platform's pages say to the runtime as commands, `<node> <the block>
 * <word> ...`: each answers one JSON document on its standard output
 * and exits 0, or fails with its words on its standard error, the last
 * line the reason. The host job says the measure and the end; a
 * coder's harness says the toolbox. A pid never comes alone: the
 * start and the boot's identity a record has of it come with it, and
 * the block checks all three against a read of its own before it
 * looks under the pid or signals anything. */
export const BLOCK_WORDS = {
  /** What a read says of recorded processes: handed a `MeasureAsk` on
   * the standard input, answers a `MeasureAnswer`. */
  measure: '--measure',
  /** The last resort for a recorded process and the cleaning after one
   * that died: `--end [--at-once | --left-only] <pid> <start> <boot> [<word>]`, the
   * word the one its launch laid into the environment of every command
   * it ran, whole; answers an `EndAnswer`. */
  end: '--end',
  /** Before the pid of an end: the process is killed with no term
   * first, for a stop that has no grace. */
  atOnce: '--at-once',
  /** Before the pid of an end: the process the record names is left
   * as it is, whoever holds it, and what its launch left is ended
   * alone. The cleaning before a copy is started again, where the
   * record may name a process another host started. */
  leftOnly: '--left-only',
  /** A coder's toolbox, made and kept current: `--toolbox <folder>
   * <program> ...`; answers a `ToolboxAnswer`. */
  toolbox: '--toolbox',
} as const;

/** What the block's read says of a recorded process: `same`, a process
 * is at the pid and it is the record's by its start and its boot;
 * `another`, a process is at the pid and it is not the record's;
 * `gone`, no process is at the pid; `unknown`, a process is there and
 * the read cannot tell whether it is the record's, or the record names
 * no start or no boot yet. */
export type ProcessAnswer = 'same' | 'another' | 'gone' | 'unknown';

/** What a measure is handed: the processes asked about, each as a
 * record names it. */
export type MeasureAsk = { pid: number; started?: string; boot?: string }[];

/** What a measure answers: this boot's identity, and one entry for
 * each process asked about, in the order asked. */
export interface MeasureAnswer {
  boot: string;
  processes: {
    pid: number;
    answer: ProcessAnswer;
    /** The start the read tells of the process at the pid; absent when
     * it tells none. */
    started?: string;
    /** For a process that is the same: the pids of its tree, the
     * process first. */
    tree?: number[];
    /** The first process of a pid namespace of its own in the tree,
     * when there is one. */
    init?: number;
  }[];
}

/** What an end answers: what the read said of the process, the pids
 * that were signalled, and the ones that are left: those that would
 * not go, and those no read vouches for while the system says a
 * process is there, the process itself among them when the answer is
 * `unknown`. An end is whole when nothing is left, and the block's
 * word fails otherwise. */
export interface EndAnswer {
  answer: ProcessAnswer;
  ended: number[];
  left: number[];
}

/** What a toolbox answers: the `PATH` value a vendor's shell is
 * handed, the programs of the list the toolbox holds, and the
 * toolbox's own shell where it is a root of its own and holds one. */
export interface ToolboxAnswer {
  path: string;
  programs: string[];
  shell?: string;
}
