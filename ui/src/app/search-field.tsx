// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useAgents, useLs } from '../api/queries.js';
import { TypeWord } from '../components/agent-type.js';
import { Avatar, AgentName, cx } from '../components/ui.js';
import { dotOf, isPlatform, spoken } from '../model/agent.js';
import { composing } from '../model/keys.js';
import { useClock } from '../state/prefs.js';
import { useLook } from '../state/theme.js';

interface Entry {
  key: string;
  group: 'Agents' | 'Functions' | 'Actions';
  /** What the typed text is held against. */
  text: string;
  render: () => ReactNode;
  run: () => void;
}

/** How many entries of a group the field offers. */
const PER_GROUP = 8;

/** Whether a key was pressed where a reader types. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * The field in the bar across the top, typed in where it stands: a press
 * of it or `cmd-K` puts the keyboard in it, and what the text matches
 * hangs right under it, over a screen that stays as it is. It goes to an
 * agent or one of its functions, and does the few things that otherwise
 * sit in a menu, offered as their names are typed. On a window too
 * narrow for the bar to hold it, it lies across the bar while it is used.
 */
export function SearchField({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const navigate = useNavigate();
  const ls = useLs();
  const agents = useAgents();
  const [clock, setClock] = useClock();
  const [look, turnLook] = useLook();
  const [text, setText] = useState('');
  const [at, setAt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const mac = useMemo(() => /Mac|iPhone|iPad/.test(navigator.userAgent), []);
  // Where the agent list stands, the slash is that list's own key.
  const besideTheList = useRouterState({
    select: (state) => state.location.pathname.startsWith('/agents'),
  });

  useEffect(() => {
    setText('');
    setAt(0);
    if (open) field.current?.focus();
    else if (document.activeElement === field.current) field.current?.blur();
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const byCommand = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const bySlash =
        event.key === '/' &&
        !besideTheList &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !typing(event.target);
      if (!byCommand && !bySlash) return;
      event.preventDefault();
      onOpenChange(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [besideTheList, onOpenChange]);

  const entries = useMemo<Entry[]>(() => {
    const close = (): void => {
      onOpenChange(false);
    };
    const rows = ls.data?.agents ?? [];
    const out: Entry[] = [];
    const ordered = [...rows].sort(
      (a, b) =>
        Number(isPlatform(a.agentId)) - Number(isPlatform(b.agentId)) ||
        a.agentId.localeCompare(b.agentId),
    );
    for (const row of ordered) {
      out.push({
        key: `agent:${row.agentId}`,
        group: 'Agents',
        text: row.agentId,
        render: () => (
          <>
            <Avatar
              agentId={row.agentId}
              size={22}
              dot={dotOf(row)}
              status={row.status}
              ground="var(--ui-message)"
            />
            <AgentName agentId={row.agentId} className="flex-1 text-left" />
            <TypeWord type={row.type} className="text-xs text-ink-muted" />
          </>
        ),
        run: () => {
          close();
          void navigate({ to: '/agents/$', params: { _splat: row.agentId } });
        },
      });
    }
    for (const row of agents.data?.agents ?? []) {
      if (row.form !== undefined || row.type === 'module' || row.type === 'worker') continue;
      for (const handler of row.handlers) {
        out.push({
          key: `function:${row.agentId}:${handler}`,
          group: 'Functions',
          text: `${row.agentId} ${handler} ${spoken(handler)}`,
          render: () => (
            <>
              <Avatar agentId={row.agentId} size={22} ground="var(--ui-message)" />
              <span className="min-w-0 flex-1 truncate text-left text-ink">
                {spoken(handler)}
                <span className="ml-2 text-ink-muted">{row.agentId}</span>
              </span>
            </>
          ),
          run: () => {
            close();
            void navigate({
              to: '/agents/$',
              params: { _splat: row.agentId },
              hash: `send:${handler}`,
            });
          },
        });
      }
    }
    const action = (name: string, run: () => void): void => {
      out.push({
        key: `action:${name}`,
        group: 'Actions',
        text: name,
        render: () => <span className="flex-1 text-left text-ink">{name}</span>,
        run: () => {
          close();
          run();
        },
      });
    };
    action(look === 'dark' ? 'Light look' : 'Dark look', turnLook);
    action(clock === 'utc' ? 'Clock: local time' : 'Clock: UTC', () => {
      setClock(clock === 'utc' ? 'local' : 'utc');
    });
    action('Overview', () => void navigate({ to: '/overview' }));
    action(
      'Overview: agents not ready',
      () => void navigate({ to: '/overview', search: { view: 'not-ready' } }),
    );
    action(
      'Overview: agents by AI cost',
      () => void navigate({ to: '/overview', search: { view: 'most-cost' } }),
    );
    action('Settings', () => void navigate({ to: '/settings' }));
    return out;
  }, [ls.data, agents.data, look, clock, navigate, onOpenChange, setClock, turnLook]);

  const shown = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (entry: Entry): boolean => {
      const held = entry.text.toLowerCase();
      return words.every((word) => held.includes(word));
    };
    const groups: Entry['group'][] = ['Agents', 'Functions', 'Actions'];
    const out: Entry[] = [];
    for (const group of groups) {
      // With nothing typed, the field offers the reader's agents and the actions.
      if (words.length === 0 && group === 'Functions') continue;
      out.push(
        ...entries.filter((entry) => entry.group === group && matches(entry)).slice(0, PER_GROUP),
      );
    }
    return out;
  }, [entries, text]);

  const chosen = Math.min(at, Math.max(0, shown.length - 1));
  useEffect(() => {
    listRef.current?.querySelector('[data-chosen="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [chosen]);

  return (
    <div
      className={cx(
        'min-w-0 md:relative md:block md:w-full md:shrink md:transition-[max-width] md:duration-150',
        open
          ? 'absolute inset-x-2 top-2 z-50 md:inset-auto md:top-auto md:max-w-[560px]'
          : 'hidden md:max-w-[460px]',
      )}
    >
      <label
        className={cx(
          'flex h-8 cursor-text items-center gap-2 rounded-md border bg-surface px-2.5 text-[13px]',
          open ? 'border-ink' : 'border-line-strong hover:border-ink-muted',
        )}
      >
        <Search size={14} className="shrink-0 text-ink-muted" />
        <input
          ref={field}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && shown[chosen] !== undefined ? `${listId}-${String(chosen)}` : undefined
          }
          aria-label="Go to an agent or a function"
          placeholder="Go to an agent or a function"
          value={text}
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-muted focus:outline-none"
          onFocus={() => {
            if (!open) onOpenChange(true);
          }}
          onBlur={() => {
            onOpenChange(false);
          }}
          onChange={(event) => {
            setText(event.target.value);
            setAt(0);
          }}
          onKeyDown={(event) => {
            // A key an input method takes while it composes is no choice of this field's.
            if (composing(event)) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setAt(Math.min(chosen + 1, shown.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setAt(Math.max(chosen - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              shown[chosen]?.run();
            } else if (event.key === 'Escape') {
              // The key closes this field alone, and nothing behind it.
              event.preventDefault();
              event.stopPropagation();
              onOpenChange(false);
            }
          }}
        />
        {!open && (
          <kbd className="rounded-sm border border-line-strong px-1 text-[11px] text-ink-muted">
            {mac ? '⌘K' : 'Ctrl K'}
          </kbd>
        )}
      </label>
      {open && (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="What the text matches"
          // A press on the list leaves the keyboard in the field, so the field stays open for it.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          className="sheet absolute top-full left-0 z-50 mt-1 max-h-[70vh] w-full overflow-y-auto p-1"
        >
          {shown.length === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-ink-muted">Nothing matches.</div>
          )}
          {shown.map((entry, index) => (
            <div key={entry.key} role="presentation">
              {(index === 0 || shown[index - 1]?.group !== entry.group) && (
                <div
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
                >
                  {entry.group}
                </div>
              )}
              <button
                type="button"
                role="option"
                id={`${listId}-${String(index)}`}
                aria-selected={index === chosen}
                tabIndex={-1}
                data-chosen={index === chosen}
                onMouseMove={() => {
                  setAt(index);
                }}
                onClick={entry.run}
                className={cx(
                  'flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-[13px]',
                  index === chosen && 'bg-hover',
                )}
              >
                {entry.render()}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
