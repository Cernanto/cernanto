// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The figures of the listing, written as `cernanto ls` writes them, so
// the screen and the terminal say one number one way.

/**
 * A size as the listing writes it: whole bytes and kibibytes, one
 * decimal from mebibytes on until the number has two digits.
 *
 * @example
 * bytesWord(884); // '884B'
 * bytesWord(2202009); // '2.1Mi'
 */
export function bytesWord(bytes: number): string {
  const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits =
    unit < 2 || value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${digits}${units[unit] ?? ''}`;
}

/** A size given in mebibytes, as the listing writes it. */
export function mebibytesWord(mebibytes: number): string {
  return bytesWord(Math.round(mebibytes * 1024 * 1024));
}

/**
 * A count as the listing writes it: whole through 9999, and from ten
 * thousand on its first three digits with the letter of its thousands.
 *
 * @example
 * countWord(9999); // '9999'
 * countWord(12740); // '12.7K'
 */
export function countWord(count: number): string {
  if (!Number.isFinite(count) || count < 10000) return String(count);
  const whole = Math.round(count);
  let power = 2;
  while (whole >= 10 ** (power + 3)) power += 1;
  const unit = 10 ** power;
  const rest = whole % unit;
  let digits = (whole - rest) / unit + (rest * 2 >= unit ? 1 : 0);
  if (digits === 1000) {
    digits = 100;
    power += 1;
  }
  const letters = ['K', 'M', 'B', 'T'];
  const group = Math.min(Math.floor((power + 2) / 3), letters.length);
  const lead = power + 3 - group * 3;
  const text = String(digits);
  const value =
    lead >= 3 ? `${text}${'0'.repeat(lead - 3)}` : `${text.slice(0, lead)}.${text.slice(lead)}`;
  return `${value}${letters[group - 1] ?? ''}`;
}

/**
 * A cost as the listing writes it: four decimals below a dollar and
 * two from a dollar on.
 *
 * @example
 * costWord(0.0042); // '$0.0042'
 * costWord(48.888); // '$48.89'
 */
export function costWord(usd: number): string {
  if (usd > 0 && usd < 0.0001) return '<$0.0001';
  const fine = usd.toFixed(4);
  return Number(fine) < 1 ? `$${fine}` : `$${usd.toFixed(2)}`;
}

/** Processor use as the listing writes it, in thousandths of a core. */
export function cpuWord(millicores: number): string {
  return `${String(Math.round(millicores))}m`;
}

/**
 * The calls an agent holds now, as its copies answered for themselves:
 * their sum, the sum with a plus when a copy did not answer, a
 * question mark when none of the copies asked did.
 */
export function activeWord(
  row: { copiesAsked?: number; copiesAnswered?: number },
  sum: number | undefined,
): string {
  if (sum === undefined) return '-';
  const asked = row.copiesAsked ?? 0;
  const answered = row.copiesAnswered ?? asked;
  if (asked > 0 && answered === 0) return '?';
  return answered < asked ? `${String(sum)}+` : String(sum);
}

/**
 * A span of time as a conversation writes it: milliseconds under a
 * second, seconds with one decimal under a minute, then minutes and
 * seconds, hours and minutes, days and hours.
 *
 * @example
 * humanMs(380); // '380ms'
 * humanMs(302000); // '5m02s'
 */
export function humanMs(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m${pad(seconds % 60)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1440) return `${String(Math.floor(minutes / 60))}h${pad(minutes % 60)}m`;
  const hours = Math.round(minutes / 60);
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${String(days)}d` : `${String(days)}d${pad(hours % 24)}h`;
}

/** A running clock, `0:03` or `12:07` or `1:02:07`. */
export function runningClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (value: number): string => String(value).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds % 60)}`
    : `${String(minutes)}:${pad(seconds % 60)}`;
}
