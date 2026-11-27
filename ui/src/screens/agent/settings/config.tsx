// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../../../api/plane.js';
import { keys } from '../../../api/queries.js';
import { Button, cx, ErrorLine, Field, IconButton } from '../../../components/ui.js';
import * as gateway from '../../../gateway/sdk.gen.js';
import {
  defaultChoices,
  settingNameTrouble,
  settingValue,
  shownValue,
} from '../../../model/config.js';
import {
  HEAD_WORDS,
  SETTING_ACTS,
  SETTING_FIELD,
  SETTING_LINE,
  SETTING_NAME,
  SETTING_VALUE,
  SETTINGS_GRID,
  SETTINGS_WHOLE,
} from './cells.js';

// CONFIG: what a person sets for an agent, the cli's `cernanto config
// <agent>`. Each name stands with its value, shown as the cli prints
// it and read whole, however long. Written, a value is typed in a field
// as wide as the page gives, which begins with the value that stands.

/** What a place holds: each name with its value. */
export type Settings = Record<string, unknown>;

/** What a place holds, as the plane's listing answers it. */
export function useSettings(place: string, asked = true): UseQueryResult<Settings> {
  return useQuery({
    queryKey: keys.config(place),
    queryFn: async (): Promise<Settings> =>
      unwrap(await gateway.configList({ client: plane, query: { place } }), 'the config')
        .configuration,
    staleTime: 15_000,
    enabled: asked,
  });
}

/** No name of a place is shown elsewhere on the page. */
const NONE: readonly string[] = [];

/** An interface's default has a field of its own, above the rest. */
const DEFAULT_ALONE: readonly string[] = ['default'];

/** The words over the columns of a group that holds something, on a column wide enough for them. */
const HEADS_LINE = 'col-span-full hidden grid-cols-subgrid border-b @lg:grid';

/**
 * What one place holds, as lines of the grid they stand in: the place's
 * word, each name with its value and what is done with it, and the way
 * to add one.
 */
function PlaceSettings({
  place,
  title,
  apart = NONE,
}: {
  place: string;
  title: string;
  /** The names the page shows by a field of their own. */
  apart?: readonly string[];
}): ReactNode {
  const client = useQueryClient();
  const settings = useSettings(place);
  // The name being written, and the text its field began with.
  const [editing, setEditing] = useState<{ setting: string; from: string } | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const leave = (): void => {
    setEditing(undefined);
    setAdding(false);
    setName('');
    setValue('');
  };
  const write = (setting: string, next: unknown): void => {
    setBusy(true);
    setTrouble(undefined);
    void (async () => {
      unwrap(
        await gateway.configSet({
          client: plane,
          body: { key: `${place}/${setting}`, value: next },
        }),
        'the config',
      );
      // What stands is read again before the field leaves, so the line
      // shows the value written and never the one before it.
      await client.invalidateQueries({ queryKey: keys.config(place) });
      leave();
    })()
      .catch((error: unknown) => {
        setTrouble(wordsOf(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const held = settings.data ?? {};
  const list = Object.keys(held)
    .filter((setting) => !apart.includes(setting))
    .sort();
  return (
    <>
      <li className={cx(SETTINGS_WHOLE, 'mt-5 mb-1 text-xs text-ink-muted first:mt-0')}>{title}</li>
      {settings.isError && (
        <li className={SETTINGS_WHOLE}>
          <ErrorLine>{wordsOf(settings.error)}</ErrorLine>
        </li>
      )}
      {list.length === 0 && settings.data !== undefined && (
        <li className={cx(SETTINGS_WHOLE, 'text-ink-muted')}>Nothing is set.</li>
      )}
      {list.length > 0 && (
        <li aria-hidden="true" className={HEADS_LINE}>
          <span className={cx(HEAD_WORDS, 'flex h-8 items-center')}>Name</span>
          <span className={cx(HEAD_WORDS, 'flex h-8 items-center')}>Value</span>
          <span />
        </li>
      )}
      {list.map((setting) => (
        <li key={setting} className={SETTING_LINE}>
          <span className={cx(SETTING_NAME, 'mono break-all text-ink')}>{setting}</span>
          {editing?.setting === setting ? (
            <form
              className={cx(SETTING_FIELD, 'flex items-center gap-1.5')}
              onSubmit={(event) => {
                event.preventDefault();
                write(setting, settingValue(value));
              }}
            >
              <Field
                autoFocus
                value={value}
                aria-label={`The new value of ${setting}`}
                className="mono"
                onChange={(event) => {
                  setValue(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') leave();
                }}
              />
              <Button
                look="main"
                small
                type="submit"
                disabled={busy || value === '' || value === editing.from}
              >
                Set
              </Button>
              <IconButton label="Leave it as it is" onClick={leave}>
                <X size={14} />
              </IconButton>
            </form>
          ) : (
            <>
              <span className={cx(SETTING_VALUE, 'mono break-all whitespace-pre-wrap text-ink')}>
                {shownValue(held[setting])}
              </span>
              <span className={SETTING_ACTS}>
                <IconButton
                  label="Write a new value"
                  onClick={() => {
                    const from = shownValue(held[setting]);
                    setAdding(false);
                    setName('');
                    setTrouble(undefined);
                    setEditing({ setting, from });
                    setValue(from);
                  }}
                >
                  <Pencil size={14} />
                </IconButton>
                <IconButton
                  label={`Remove ${setting}`}
                  disabled={busy}
                  onClick={() => {
                    write(setting, null);
                  }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </span>
            </>
          )}
        </li>
      ))}
      <li className={cx(SETTINGS_WHOLE, 'pt-2')}>
        {adding ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const refused = settingNameTrouble(name);
              if (refused !== undefined) {
                setTrouble(refused);
                return;
              }
              write(name.trim(), settingValue(value));
            }}
          >
            <label className="flex w-52 max-w-full flex-col gap-1 text-xs text-ink-secondary">
              Name
              <Field
                autoFocus
                value={name}
                className="mono"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <label className="flex min-w-[min(16rem,100%)] flex-1 flex-col gap-1 text-xs text-ink-secondary">
              Value
              <Field
                value={value}
                className="mono"
                onChange={(event) => {
                  setValue(event.target.value);
                }}
              />
            </label>
            <Button look="main" type="submit" disabled={busy || name.trim() === '' || value === ''}>
              Add
            </Button>
            <Button look="quiet" onClick={leave}>
              Leave it
            </Button>
          </form>
        ) : (
          <IconButton
            label="Add config"
            side="right"
            className="border border-line-strong"
            onClick={() => {
              setEditing(undefined);
              setValue('');
              setTrouble(undefined);
              setAdding(true);
            }}
          >
            <Plus size={14} />
          </IconButton>
        )}
        {trouble !== undefined && <ErrorLine className="mt-1.5">{trouble}</ErrorLine>}
      </li>
    </>
  );
}

/**
 * An interface's default: which implementor serves a consumer that
 * names none, chosen among the agents that implement it.
 */
function DefaultImplementor({
  agentId,
  implementors,
}: {
  agentId: string;
  implementors: string[];
}): ReactNode {
  const client = useQueryClient();
  const settings = useSettings(agentId);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const standing = settings.data?.['default'];
  const value = typeof standing === 'string' ? standing : '';
  return (
    <div>
      <div className="mb-1 text-xs text-ink-muted">
        Which implementor serves a call that names none
      </div>
      <select
        aria-label="The default implementor"
        value={value}
        // Nothing is chosen over a default that was not read yet.
        disabled={settings.data === undefined}
        onChange={(event) => {
          setTrouble(undefined);
          const next = event.target.value === '' ? null : event.target.value;
          void gateway
            .configSet({ client: plane, body: { key: `${agentId}/default`, value: next } })
            .then((result) => {
              unwrap(result, 'the default');
              return client.invalidateQueries({ queryKey: keys.config(agentId) });
            })
            .catch((error: unknown) => {
              setTrouble(wordsOf(error));
            });
        }}
        className="h-8 w-full max-w-[28rem] rounded-md border border-line-strong bg-sunken px-2 text-[13px] text-ink"
      >
        <option value="">The one installed, when it is the only one</option>
        {defaultChoices(implementors, value).map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      {trouble !== undefined && <ErrorLine className="mt-1">{trouble}</ErrorLine>}
    </div>
  );
}

/**
 * The Config part of an agent's Settings: an interface's default, and
 * what the agent and its tests hold in one grid.
 */
export function ConfigPart({
  agentId,
  contract,
  implementors,
}: {
  agentId: string;
  /** Whether the agent is an interface: a contract alone, which has a default and no tests. */
  contract: boolean;
  implementors: string[];
}): ReactNode {
  return (
    // The grid's columns go by the width this part is given, whatever the window's.
    <div className="measured flex flex-col gap-5">
      {contract && <DefaultImplementor agentId={agentId} implementors={implementors} />}
      <ul className={SETTINGS_GRID}>
        <PlaceSettings
          place={agentId}
          title="For the agent"
          {...(contract ? { apart: DEFAULT_ALONE } : {})}
        />
        {!contract && <PlaceSettings place={`${agentId}/tests`} title="For its tests" />}
      </ul>
    </div>
  );
}
