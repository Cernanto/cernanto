// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { RadioGroup } from 'radix-ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { isPlayground, PLANE_KINDS } from '../model/plane.js';
import type { PlaneKind } from '../model/plane.js';
import { usePlane } from '../state/plane.js';
import { cx, Field } from './ui.js';

// The plane's kind and name wherever a reader chooses them or meets
// them: the four kinds, what they decide, the field of the name, and
// the kind as a button that acts carries it.

const MARK =
  'rounded-sm bg-on-accent px-1 py-px text-[10px] leading-none font-semibold tracking-wider text-accent';

/** The plane's kind on a button that acts, where the plane is one to
 * handle with care. On a plane to play on a button carries nothing. */
export function PlaneMark(): ReactNode {
  const [plane] = usePlane();
  if (isPlayground(plane)) return null;
  return (
    <span
      className={MARK}
      title={`This plane is ${plane.kind}. Its kind is chosen at the top left, beside the logo.`}
    >
      {plane.kind}
    </span>
  );
}

/** The four kinds, one of them always chosen. A press keeps it at once,
 * a press on the chosen one among them: it makes the kind the plane
 * started with the reader's own. The keyboard stands on the chosen
 * kind, and the arrows move the choice. */
export function PlaneKinds(): ReactNode {
  const [plane, say] = usePlane();
  return (
    <RadioGroup.Root
      value={plane.kind}
      orientation="horizontal"
      aria-label="The plane's kind"
      className="flex flex-wrap gap-1.5"
      onValueChange={(next) => {
        const kind = PLANE_KINDS.find((option) => option === next);
        if (kind !== undefined) say({ kind });
      }}
    >
      {PLANE_KINDS.map((option: PlaneKind) => (
        <RadioGroup.Item
          key={option}
          value={option}
          onClick={() => {
            say({ kind: option });
          }}
          className={cx(
            'h-7 rounded-md border px-2 text-[11px] font-semibold tracking-wider',
            plane.kind === option
              ? 'border-ink bg-ink text-ground'
              : 'border-line-strong text-ink-secondary hover:bg-hover',
          )}
        >
          {option}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/** What the kinds decide, in two lines, the chosen kind's own line
 * drawn forward. The second shows a button as it carries the kind. */
export function WhatAKindDecides(): ReactNode {
  const [plane] = usePlane();
  const playground = isPlayground(plane);
  const line = (forward: boolean): string =>
    cx(
      'border-l-2 pl-2.5',
      forward ? 'border-ink text-ink-secondary' : 'border-line text-ink-muted',
    );
  return (
    <dl className="flex flex-col gap-2.5 text-xs leading-snug">
      <div className={line(playground)}>
        <dt className="text-[10px] font-semibold tracking-wider">LOCAL · TEST</dt>
        <dd className="mt-0.5">
          A plane to play on. Enter sends a call, and a delete takes one press.
        </dd>
      </div>
      <div className={line(!playground)}>
        <dt className="text-[10px] font-semibold tracking-wider">STAGING · PRODUCTION</dt>
        <dd className="mt-0.5">
          A plane to handle with care. A call takes its button, a delete asks for the agent's id,
          and every button that acts carries the kind:{' '}
          <span
            aria-hidden
            className="ml-0.5 inline-flex h-5 items-center gap-1 rounded-sm bg-accent px-1.5 align-middle text-[11px] font-semibold text-on-accent"
          >
            Call
            <span className={MARK}>{playground ? 'PRODUCTION' : plane.kind}</span>
          </span>
        </dd>
      </div>
    </dl>
  );
}

/** The reader's own name for the plane, kept as it is typed. An empty
 * field forgets the name, and the address stands in its place. */
export function PlaneNameField({ className }: { className?: string }): ReactNode {
  const [plane, say] = usePlane();
  const [typed, setTyped] = useState(plane.name);
  // What another part of the screen, or another tab, kept since is shown over what was typed here.
  const shown = typed.trim() === plane.name ? typed : plane.name;
  return (
    <Field
      value={shown}
      placeholder="Such as my-laptop"
      aria-label="Your name for this plane"
      maxLength={40}
      {...(className === undefined ? {} : { className })}
      onChange={(event) => {
        setTyped(event.target.value);
        say({ name: event.target.value });
      }}
    />
  );
}
