// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The lists of an agent's Settings tab are drawn alike: a head of small
// words over lines of one height, each starting at the page's own edge
// and ending at it.

/** The words of a column's head. */
export const HEAD_WORDS =
  'text-[11px] font-semibold tracking-wider whitespace-nowrap text-ink-muted uppercase';

// THE SETTINGS are one grid, the agent's and its tests' in the same
// columns, so the two lists stand under each other: a name, its value,
// and what is done with it. Where the column is too narrow for the
// three, a setting takes two lines: its name beside its buttons, and
// its value under them at the column's whole width.

/** The grid the settings stand in: two columns on a narrow column, three from a wider one. */
export const SETTINGS_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 text-[13px] @lg:grid-cols-[fit-content(40%)_minmax(0,1fr)_auto]';

/** A line of the grid, in the grid's own columns. */
export const SETTING_LINE = 'col-span-full grid grid-cols-subgrid items-start border-b';

/** A line that is no setting: a group's word, what an empty group says, the way to add. */
export const SETTINGS_WHOLE = 'col-span-full';

/** A setting's name: the first column, on the first line, at the height of the line's buttons. */
export const SETTING_NAME = 'col-start-1 row-start-1 min-w-0 py-2.5';

/** A setting's value: under the name on a narrow column, beside it from a wider one. */
export const SETTING_VALUE =
  'col-start-1 col-end-3 row-start-2 min-w-0 pb-2.5 @lg:col-start-2 @lg:row-start-1 @lg:py-2.5';

/** The field a value is written in: the value's place and the buttons', together. */
export const SETTING_FIELD =
  'col-start-1 col-end-3 row-start-2 min-w-0 pb-1 @lg:col-start-2 @lg:col-end-4 @lg:row-start-1 @lg:py-1';

/** What is done with a setting: the last column, on the first line. */
export const SETTING_ACTS = 'col-start-2 row-start-1 flex py-1 @lg:col-start-3';

// THE ACCOUNTS are a table where the column is wide enough for an
// account to stand on one line. On a narrower column an account is
// three short lines, its name beside its button, then its provider and
// kind, then when it was logged in; the same table, drawn as lines.

/** The table of the accounts. */
export const TABLE = 'w-full border-separate border-spacing-0 text-[13px] @max-4xl:block';

/** The table's head, which a narrow column leaves out, and its body. */
export const TABLE_HEAD = '@max-4xl:hidden';
export const TABLE_BODY = '@max-4xl:block';

/** A column's head. */
export const HEAD = `h-8 border-b px-3 text-left first:pl-0 last:pr-0 ${HEAD_WORDS}`;

/** An account's line: on a narrow column a block that keeps room for its button at its end. */
export const ACCOUNT_LINE =
  '@max-4xl:relative @max-4xl:block @max-4xl:border-b @max-4xl:py-2 @max-4xl:pr-16';

/** A cell that holds words. */
export const CELL =
  'border-b px-3 py-2 align-top first:pl-0 last:pr-0 @max-4xl:border-b-0 @max-4xl:p-0';

/** A cell that holds a button: on a narrow column it stands at the end of the account's first line. */
export const ACTS =
  'border-b px-3 py-1 align-top whitespace-nowrap first:pl-0 last:pr-0 @max-4xl:absolute @max-4xl:top-1 @max-4xl:right-0 @max-4xl:border-b-0 @max-4xl:p-0';

/** What only a narrow column says, where a column's head said it. */
export const NARROW_ONLY = 'hidden @max-4xl:inline';
