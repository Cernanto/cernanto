// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// A generation's facts, as the controller orders them and the copy's
// slot record carries them under `launch`: the block reads them off the
// record to know what to materialize and serve. A generation whose
// facts name no artifact boots from the release: the materialize
// derives the artifact and the composition and the block serves under
// them.

/** A generation's facts as the controller orders them. */
export interface GenerationFacts {
  agentId: string;
  /** The generation's identity, the plane-wide number the controller
   * gave it: a name alone, whatever port its copies listen on. */
  port: number;
  /** The agent's own generation ordinal. */
  gen: number;
  /** The package digest, `sha256:<hex>`; absent for the plane's first
   * processes, whose artifact the materialize derives from the
   * release's packages. */
  artifact?: string | undefined;
  /** Module agent id to package digest; absent with the artifact. */
  composition?: Record<string, string> | undefined;
  type: 'service' | 'task' | 'job' | 'worker';
  /** The handler calls held at once. */
  slots?: number | undefined;
  /** How many copies of the generation the plane runs; one where
   * absent. Each copy learns its own number from its record. */
  copies?: number | undefined;
  /** A worker's run number. */
  run?: number | undefined;
  /** The form the package is materialized in: `test`, the package
   * itself with its tests' mocks linked in place of the mocked edges
   * at every depth of the composition; `tester`, the package's tests
   * as a task with one function `run`. Absent, the package as itself. */
  form?: 'test' | 'tester' | undefined;
  /** The pair's other id. For a tester: the id its tests call, the
   * target's test form served apart, or, for a module target, the id
   * the tester links the module under (its test-form row, composed
   * into the tester). For a test form: the agent it stands for, the id
   * it calls its dependencies as. */
  testOf?: string | undefined;
  /** For either form: the canonical id of the agent the pair verifies,
   * which the process states on every call it makes. */
  target?: string | undefined;
  /** The life the generation runs under: its journal and its traces
   * are kept under it. A launch that names none is answered the
   * life the agent's name stands under at the copy's start. */
  life?: string | undefined;
  /** The lives of the modules the generation composes, each id to its
   * life. */
  lives?: Record<string, string> | undefined;
}

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const LIFE = /^[a-z0-9]{6,40}$/u;
const TYPES: readonly GenerationFacts['type'][] = ['service', 'task', 'job', 'worker'];
const FORMS: readonly NonNullable<GenerationFacts['form']>[] = ['test', 'tester'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Reads a generation's facts from their JSON (a slot record's launch);
 * refuses in words. A field the facts do not name is left where it is:
 * a record carries the plane's own beside. */
export function parseGenerationFacts(value: unknown): GenerationFacts {
  if (!isRecord(value)) throw new Error('the generation facts are not an object');
  const {
    agentId,
    port,
    gen,
    artifact,
    composition,
    type,
    slots,
    copies,
    run,
    form,
    testOf,
    target,
    life,
    lives,
  } = value;
  if (typeof agentId !== 'string' || agentId === '')
    throw new Error('the generation facts name no agent');
  if (!positive(port)) throw new Error('the generation facts carry no port');
  if (!positive(gen)) throw new Error('the generation facts carry no gen');
  if (artifact !== undefined && (typeof artifact !== 'string' || !DIGEST.test(artifact)))
    throw new Error('the generation facts carry an invalid artifact digest');
  if (composition !== undefined) {
    if (
      !isRecord(composition) ||
      Object.values(composition).some(
        (digest) => typeof digest !== 'string' || !DIGEST.test(digest),
      )
    )
      throw new Error('the generation facts carry an invalid composition');
  }
  if (!TYPES.includes(type as GenerationFacts['type']))
    throw new Error('the generation facts carry no agent type');
  if (slots !== undefined && !positive(slots))
    throw new Error('the generation facts carry invalid slots');
  if (copies !== undefined && !positive(copies))
    throw new Error('the generation facts carry invalid copies');
  if (run !== undefined && (typeof run !== 'number' || !Number.isSafeInteger(run) || run < 0))
    throw new Error('the generation facts carry an invalid run');
  if (form !== undefined && !FORMS.includes(form as NonNullable<GenerationFacts['form']>))
    throw new Error('the generation facts carry an unknown form');
  if (testOf !== undefined && (typeof testOf !== 'string' || testOf === ''))
    throw new Error('the generation facts carry an invalid testOf');
  if (testOf !== undefined && form === undefined)
    throw new Error('the generation facts name a testOf without a form');
  if (target !== undefined && (typeof target !== 'string' || target === ''))
    throw new Error('the generation facts carry an invalid target');
  if (target !== undefined && form === undefined)
    throw new Error('the generation facts name a target without a form');
  if (life !== undefined && (typeof life !== 'string' || !LIFE.test(life)))
    throw new Error('the generation facts carry an invalid life');
  if (
    lives !== undefined &&
    (!isRecord(lives) ||
      Object.values(lives).some((one) => typeof one !== 'string' || !LIFE.test(one)))
  )
    throw new Error('the generation facts carry invalid lives');
  return {
    agentId,
    port,
    gen,
    ...(artifact === undefined ? {} : { artifact }),
    ...(composition === undefined ? {} : { composition: composition as Record<string, string> }),
    type: type as GenerationFacts['type'],
    ...(slots === undefined ? {} : { slots }),
    ...(copies === undefined ? {} : { copies }),
    ...(run === undefined ? {} : { run }),
    ...(form === undefined ? {} : { form: form as NonNullable<GenerationFacts['form']> }),
    ...(testOf === undefined ? {} : { testOf }),
    ...(target === undefined ? {} : { target }),
    ...(life === undefined ? {} : { life }),
    ...(lives === undefined ? {} : { lives: lives as Record<string, string> }),
  };
}

/** What the materialize derives for a generation whose facts name no
 * artifact: the release package's digest and the release's modules it
 * composes. */
export interface DerivedFacts {
  artifact: string;
  composition: Record<string, string>;
}

/** The five facts a restore matches. */
export interface HostImageFacts {
  image: string;
  kernel: string;
  criu: string;
  arch: string;
  release: string;
}
