// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { plane, unwrap, wordsOf } from '../api/plane.js';
import { keys } from '../api/queries.js';
import * as gateway from '../gateway/sdk.gen.js';
import type { AgentAsk } from '../gateway/types.gen.js';
import { CopyButton } from '../screens/agent/trace/body.js';
import { Button, ErrorLine, Moment } from './ui.js';

/** Whether an address may be opened: http and https alone. */
function opens(address: string | undefined): address is string {
  return address !== undefined && /^https?:\/\//i.test(address);
}

const ADDRESS = /(https?:\/\/[^\s<>"')\]]+)/g;

/** The steps an agent wrote for a person, as text: an address in them
 * can be opened in a new tab and copied, and nothing else is active. */
function Steps({ text }: { text: string }): ReactNode {
  return (
    <div className="flex flex-col gap-1 text-[13px] whitespace-pre-wrap text-ink-secondary">
      {text.split('\n').map((line, index) => (
        <p key={index} className="min-h-[1em] break-words">
          {line.split(ADDRESS).map((part, at) =>
            at % 2 === 1 ? (
              <span key={at} className="inline-flex max-w-full items-baseline gap-0.5">
                <a
                  href={part}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all text-accent-text underline underline-offset-2"
                >
                  {part}
                </a>
                <CopyButton
                  text={part}
                  label="Copy the address"
                  className="size-5 self-center"
                  size={11}
                />
              </span>
            ) : (
              part
            ),
          )}
        </p>
      ))}
    </div>
  );
}

/**
 * What an agent waits for a person to give, ready to be answered where
 * it stands: fields to fill, a provider's sign-in to open, or a text to
 * read and act on. It is as wide as the place it is given, and a field
 * takes that whole width: an id a provider hands out runs to seventy
 * characters and more, and is checked by reading it whole.
 */
export function AskCard({ ask }: { ask: AgentAsk }): ReactNode {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const fields = ask.fields ?? [];
  const ready = fields.every((field) => (values[field.name] ?? '') !== '');

  const answer = (): void => {
    setBusy(true);
    setTrouble(undefined);
    void gateway
      .authLogin({ client: plane, path: { id: ask.id }, body: { fields: values } })
      .then((result) => {
        unwrap(result, 'the login');
        setValues({});
        void client.invalidateQueries({ queryKey: keys.auth });
      })
      .catch((error: unknown) => {
        setTrouble(wordsOf(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-accent/60 bg-message p-3">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
          {ask.kind === 'oauth'
            ? `${ask.provider} sign-in`
            : ask.kind === 'fields'
              ? `${ask.name} login`
              : ask.name}
        </span>
        <span className="shrink-0 text-xs text-ink-muted">
          since <Moment at={ask.requestedAt} />
        </span>
      </div>
      <div className="text-xs text-ink-muted">
        The account <span className="mono text-[11px]">{ask.name}</span> at {ask.provider}
        {ask.agentId !== ask.agent && <> · asked by a call of {ask.agentId}</>}
      </div>
      {ask.refused !== undefined && (
        <ErrorLine>The provider refused what was given before: {ask.refused}</ErrorLine>
      )}
      {ask.instructions !== undefined && <Steps text={ask.instructions} />}
      {ask.kind === 'display' && ask.message !== undefined && <Steps text={ask.message} />}
      {opens(ask.helpUrl) && (
        <a
          href={ask.helpUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 self-start text-[13px] text-accent-text underline underline-offset-2"
        >
          Where the steps start <ExternalLink size={12} />
        </a>
      )}
      {ask.kind === 'oauth' && (
        <>
          {ask.scopes !== undefined && ask.scopes.length > 0 && (
            // A list, each on a line of its own beside the words that open
            // it: no line is shared, so none is cut between two of them, and
            // a copy keeps them apart. One longer than the card breaks
            // inside its own line.
            <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-1.5 text-xs text-ink-muted">
              <span>It asks for:</span>
              <ul className="flex min-w-0 flex-col gap-1">
                {ask.scopes.map((scope) => (
                  <li key={scope}>
                    <code className="mono rounded-sm bg-sunken px-1 text-[11px] break-all text-ink-secondary">
                      {scope}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {opens(ask.authorizationUrl) ? (
            <a
              href={ask.authorizationUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 items-center gap-1.5 self-start rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent hover:brightness-105"
            >
              Open the {ask.provider} sign-in <ExternalLink size={13} />
            </a>
          ) : (
            <ErrorLine>The plane gave no sign-in address for this ask.</ErrorLine>
          )}
        </>
      )}
      {ask.kind === 'fields' && fields.length > 0 && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) answer();
          }}
        >
          {fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1 text-xs text-ink-secondary">
              {field.label}
              <input
                type={field.secret === true ? 'password' : 'text'}
                autoComplete="off"
                value={values[field.name] ?? ''}
                onChange={(event) => {
                  setValues({ ...values, [field.name]: event.target.value });
                }}
                className="h-8 rounded-md border border-line-strong bg-sunken px-2.5 text-[13px] text-ink focus:border-ink focus:outline-none"
              />
            </label>
          ))}
          <Button look="main" type="submit" disabled={!ready || busy} className="self-start">
            {busy ? 'Sending…' : 'Log in'}
          </Button>
        </form>
      )}
      {trouble !== undefined && <ErrorLine>{trouble}</ErrorLine>}
    </div>
  );
}
