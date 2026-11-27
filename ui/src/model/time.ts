// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import type { Clock } from '../state/prefs.js';

// Every moment on the screen follows the reader's clock, local time or
// UTC, and shows its exact moment with its zone under the pointer.

const formats = new Map<string, Intl.DateTimeFormat>();

function format(clock: Clock, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${clock}|${JSON.stringify(options)}`;
  let made = formats.get(key);
  if (made === undefined) {
    made = new Intl.DateTimeFormat('en-GB', {
      ...options,
      hourCycle: 'h23',
      ...(clock === 'utc' ? { timeZone: 'UTC' } : {}),
    });
    formats.set(key, made);
  }
  return made;
}

function dateOf(at: string | number | Date): Date | undefined {
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The time of day, `12:04`, or `12:04:11` with its seconds. */
export function timeOfDay(at: string | number | Date, clock: Clock, seconds = false): string {
  const date = dateOf(at);
  if (date === undefined) return '';
  return format(clock, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  }).format(date);
}

/** The day a moment falls on in the reader's clock, `2026-11-22`. */
export function dayKey(at: string | number | Date, clock: Clock): string {
  const date = dateOf(at);
  if (date === undefined) return '';
  const parts = format(clock, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    date,
  );
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The exact moment with its zone, for the pointer: `2026-11-22
 * 12:04:11 UTC`, or the local time with the zone's own short name. */
export function exactMoment(at: string | number | Date, clock: Clock): string {
  const date = dateOf(at);
  if (date === undefined) return '';
  const time = format(clock, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
  return `${dayKey(date, clock)} ${time}`;
}

/** How many whole days lie between two days of the reader's clock. */
function daysApart(at: Date, now: Date, clock: Clock): number {
  const midnight = (date: Date): number => Date.parse(`${dayKey(date, clock)}T00:00:00Z`);
  return Math.round((midnight(now) - midnight(at)) / 86_400_000);
}

/** A day as a conversation heads it: Today, Yesterday, then the date. */
export function dayLabel(at: string | number | Date, clock: Clock, now: Date = new Date()): string {
  const date = dateOf(at);
  if (date === undefined) return '';
  const apart = daysApart(date, now, clock);
  if (apart === 0) return 'Today';
  if (apart === 1) return 'Yesterday';
  return format(clock, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}

/** A moment as a list's entry shows it: today the time, then
 * Yesterday, then the weekday inside the week, then the date. */
export function listMoment(
  at: string | number | Date,
  clock: Clock,
  now: Date = new Date(),
): string {
  const date = dateOf(at);
  if (date === undefined) return '';
  const apart = daysApart(date, now, clock);
  if (apart <= 0) return timeOfDay(date, clock);
  if (apart === 1) return 'Yesterday';
  if (apart < 7) return format(clock, { weekday: 'short' }).format(date);
  return format(clock, { day: 'numeric', month: 'short' }).format(date);
}

/** A moment as a fact states it, the day and the time whenever it is
 * read: `2026-11-18 22:14`. A list's entry may say a weekday alone,
 * since its place in the list says the rest; a fact stands by itself. */
export function factMoment(at: string | number | Date, clock: Clock): string {
  const date = dateOf(at);
  if (date === undefined) return '';
  return `${dayKey(date, clock)} ${timeOfDay(date, clock)}`;
}

/** A moment in a table: the date and the time, to the second. */
export function tableMoment(at: string | number | Date, clock: Clock): string {
  const date = dateOf(at);
  if (date === undefined) return '';
  return `${dayKey(date, clock)} ${timeOfDay(date, clock, true)}`;
}

/** How long ago a moment was, in a few letters: `12s`, `4m`, `3h`, `2d`. */
export function ago(at: string | number | Date, now: number = Date.now()): string {
  const date = dateOf(at);
  if (date === undefined) return '';
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)}h`;
  return `${String(Math.round(hours / 24))}d`;
}
