// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { ChevronRight, X } from 'lucide-react';
import { Dialog, DropdownMenu, Tooltip } from 'radix-ui';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

import { idParts, initials, toneOf } from '../model/agent.js';
import type { Dot } from '../model/agent.js';
import { exactMoment, timeOfDay } from '../model/time.js';
import { useClock } from '../state/prefs.js';

/** Joins class names, leaving out what is not said. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter((name) => typeof name === 'string' && name !== '').join(' ');
}

/** A word shown while the pointer rests on something, or the keyboard is on it. */
export function Tip({
  label,
  side = 'bottom',
  children,
}: {
  label: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}): ReactNode {
  if (label === undefined || label === null || label === '') return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[70] max-w-80 rounded-md bg-ink px-2 py-1 text-xs leading-snug text-ground shadow-sheet"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const WORDS: Record<Dot, string> = {
  ready: 'Ready',
  busy: 'Ready, holds a call now',
  degraded: 'Degraded',
  starting: 'Starting',
  failed: 'Failed',
  parked: 'Parked',
  unknown: 'Unknown',
  none: '',
};

/**
 * An agent's round picture: two letters on a colour of its own, with
 * the dot of its state on its corner. A party that is no agent has no
 * dot.
 */
export function Avatar({
  agentId,
  size = 36,
  dot,
  status,
  ground = 'var(--surface)',
  faded = false,
}: {
  agentId: string;
  size?: number;
  dot?: Dot | undefined;
  /** The plane's own word for the state, said under the pointer. */
  status?: string | undefined;
  /** The ground the picture stands on, which rings the dot. */
  ground?: string;
  faded?: boolean;
}): ReactNode {
  const tone = toneOf(agentId);
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: size <= 24 ? Math.round(size * 0.4) : Math.max(11, Math.round(size * 0.38)),
    letterSpacing: size <= 24 ? '0' : undefined,
    background: `var(--ui-tone-${String(tone)})`,
    opacity: faded ? 0.55 : 1,
  };
  const shown = dot !== undefined && dot !== 'none';
  // A small picture carries a smaller dot, which leaves its letters whole.
  const dotStyle = {
    '--dot-ground': ground,
    ...(size < 30 ? { '--dot-size': '6px', '--dot-edge': '1.5px', '--dot-line': '1.5px' } : {}),
  } as CSSProperties;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center rounded-full font-semibold tracking-wide text-white select-none"
        style={style}
      >
        {initials(agentId)}
      </span>
      {shown && (
        <span
          className="dot"
          data-dot={dot}
          role="img"
          aria-label={status ?? WORDS[dot]}
          title={status ?? WORDS[dot]}
          style={dotStyle}
        />
      )}
    </span>
  );
}

/** An agent's id as the list writes it: its folder muted, its last
 * part in the ink, a little heavier. */
export function AgentName({
  agentId,
  bold = false,
  className,
}: {
  agentId: string;
  bold?: boolean;
  className?: string;
}): ReactNode {
  const { folder, name } = idParts(agentId);
  return (
    <span className={cx('min-w-0 truncate', className)} dir="rtl" title={agentId}>
      <bdi>
        <span className="text-ink-muted">{folder}</span>
        <span className={cx('text-ink', bold ? 'font-bold' : 'font-medium')}>{name}</span>
      </bdi>
    </span>
  );
}

/** A name in a conversation, in its hue's tone for a name. */
export function ToneName({
  agentId,
  children,
}: {
  agentId: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <span className="font-semibold" style={{ color: `var(--ui-name-${String(toneOf(agentId))})` }}>
      {children ?? agentId}
    </span>
  );
}

/** A moment in the reader's clock, with its exact moment and zone under the pointer. */
export function Moment({
  at,
  seconds = false,
  className,
  children,
}: {
  at: string | number | Date;
  seconds?: boolean;
  className?: string;
  children?: ReactNode;
}): ReactNode {
  const [clock] = useClock();
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={exactMoment(at, clock)}
      className={cx('figures whitespace-nowrap', className)}
    >
      {children ?? timeOfDay(at, clock, seconds)}
    </time>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `main` is the one main button of a screen; `plain` a button beside it; `quiet` one with no ground. */
  look?: 'main' | 'plain' | 'quiet' | 'danger';
  small?: boolean;
};

const LOOKS: Record<NonNullable<ButtonProps['look']>, string> = {
  main: 'bg-accent text-on-accent font-semibold hover:brightness-105 disabled:opacity-50',
  plain:
    'border border-line-strong bg-surface text-ink hover:bg-hover disabled:opacity-50 disabled:hover:bg-surface',
  quiet: 'text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-50',
  danger: 'border border-bad text-bad hover:bg-bad hover:text-white disabled:opacity-50',
};

/** A button with its word. */
export function Button({
  look = 'plain',
  small = false,
  className,
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition-colors duration-150',
        small ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
        LOOKS[look],
        className,
      )}
    />
  );
}

/** A small button that is a drawing alone, with its word under the pointer. */
export function IconButton({
  label,
  active = false,
  className,
  children,
  side,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  side?: 'top' | 'bottom' | 'left' | 'right';
}): ReactNode {
  return (
    <Tip label={label} {...(side === undefined ? {} : { side })}>
      <button
        type="button"
        aria-label={label}
        {...rest}
        className={cx(
          'relative inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
          active ? 'bg-chosen text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink',
          'disabled:opacity-40 disabled:hover:bg-transparent',
          className,
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

/** A filter with its count: chosen, it narrows the list, and chosen again it shows all. */
export function Chip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number | undefined;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs transition-colors duration-150',
        active
          ? 'border-ink bg-ink text-ground'
          : 'border-line-strong text-ink-secondary hover:bg-hover hover:text-ink',
      )}
    >
      {children}
      {count !== undefined && <span className="figures font-semibold">{count}</span>}
    </button>
  );
}

/** A count for what waits: a pill of the accent. */
export function Count({ value, label }: { value: number; label?: string }): ReactNode {
  if (value <= 0) return null;
  return (
    <span
      aria-label={label}
      title={label}
      className="figures inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] leading-none font-bold text-on-accent"
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}

/** A small word in a frame: a plane's kind, a draft, a type. */
export function Tag({
  children,
  filled = false,
  title,
}: {
  children: ReactNode;
  filled?: boolean;
  title?: string;
}): ReactNode {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-[18px] shrink-0 items-center rounded-sm px-1.5 text-[10px] leading-none font-semibold tracking-wider uppercase',
        filled ? 'bg-ink text-ground' : 'border border-line-strong text-ink-secondary',
      )}
    >
      {children}
    </span>
  );
}

/** A menu that opens under its button. It ends at the button's right
 * edge, which suits a button near the window's right edge; one whose
 * button stands in a narrow column starts at the button's left edge
 * and grows towards the room. Either way the window's edge holds it. */
export function Menu({
  trigger,
  children,
  align = 'end',
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}): ReactNode {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="sheet z-[60] min-w-52 p-1 text-[13px] text-ink"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One line of a menu. A small sign of what the line does stands before
 * its words as its icon; where the lines of a menu are each a thing of
 * its own kind, each of two lines, a larger picture of twenty stands
 * there in its place, in the colour of the words. */
export function MenuItem({
  onSelect,
  children,
  hint,
  danger = false,
  disabled = false,
  icon,
  picture,
}: {
  onSelect: () => void;
  children: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  picture?: ReactNode;
}): ReactNode {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-45 data-[highlighted]:bg-hover',
        danger ? 'text-bad' : 'text-ink',
      )}
    >
      {picture !== undefined && (
        <span aria-hidden="true" className="flex w-7 shrink-0 items-center justify-center">
          {picture}
        </span>
      )}
      {icon !== undefined && (
        <span className="flex size-4 items-center text-ink-muted">{icon}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{children}</span>
        {hint !== undefined && <span className="text-xs text-ink-muted">{hint}</span>}
      </span>
    </DropdownMenu.Item>
  );
}

/** A line of a menu that opens a menu of its own beside it: the ways one thing is done. */
export function MenuSub({
  word,
  hint,
  disabled = false,
  children,
}: {
  word: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        disabled={disabled}
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-ink outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-45 data-[highlighted]:bg-hover data-[state=open]:bg-hover"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span>{word}</span>
          {hint !== undefined && <span className="text-xs text-ink-muted">{hint}</span>}
        </span>
        <ChevronRight size={14} className="shrink-0 text-ink-muted" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={6}
          collisionPadding={8}
          className="sheet z-[60] w-80 max-w-[calc(100vw-2rem)] p-1 text-[13px] text-ink"
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/** A small heading inside a menu. */
export function MenuLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <DropdownMenu.Label className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
      {children}
    </DropdownMenu.Label>
  );
}

/** A hair line between the parts of a menu. */
export function MenuLine(): ReactNode {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}

/** A sheet over the screen, with its title and its way out. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 520,
  keyboard = 'field',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  width?: number;
  /** Where the keyboard lands when the sheet opens: in its first field,
   * for a sheet that asks something, or on the sheet itself, for one
   * that shows something a field of it would change. */
  keyboard?: 'field' | 'sheet';
}): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          className="sheet fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col text-ink-secondary outline-none"
          style={{ maxWidth: width }}
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onOpenAutoFocus={(event) => {
            // The keyboard lands in the sheet's first field, or on the
            // sheet itself, never on its way out.
            const sheet = event.currentTarget as HTMLElement;
            const field =
              keyboard === 'sheet'
                ? null
                : sheet.querySelector<HTMLElement>('input, textarea, select');
            event.preventDefault();
            (field ?? sheet).focus();
          }}
          tabIndex={-1}
        >
          <div className="flex items-start gap-3 border-b px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold text-ink">{title}</Dialog.Title>
              {description !== undefined && (
                <Dialog.Description className="mt-0.5 text-[13px] text-ink-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close" className="-mr-2">
                <X size={16} />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One line that says something went wrong, in the plane's words. */
export function ErrorLine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <p role="alert" className={cx('text-[13px] text-bad', className)}>
      {children}
    </p>
  );
}

/** A quiet line in the middle of an empty place. */
export function Quiet({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={cx('px-6 py-10 text-center text-[13px] text-ink-muted', className)}>
      {children}
    </div>
  );
}

/** A field of one line. */
export function Field({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <input
      {...rest}
      className={cx(
        'h-8 w-full min-w-0 rounded-md border border-line-strong bg-sunken px-2.5 text-[13px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none',
        className,
      )}
    />
  );
}
