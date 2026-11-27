// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Braces, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { DropdownMenu, Switch } from 'radix-ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { PLANE_ADDRESS } from '../../../api/plane.js';
import { PlaneMark } from '../../../components/plane.js';
import { cx, Tip } from '../../../components/ui.js';
import { aKind, spoken } from '../../../model/agent.js';
import {
  draftsOf,
  emptyDraft,
  entryOf,
  formHolds,
  heldBecause,
  isUnset,
  labelOf,
  readArguments,
  typeWord,
} from '../../../model/contract.js';
import type { Draft, FunctionCard, PlainField, PlainType } from '../../../model/contract.js';
import { BY_ITSELF } from '../../../model/fleet.js';
import { composing } from '../../../model/keys.js';
import { isPlayground, planeLabel } from '../../../model/plane.js';
import { usePlane } from '../../../state/plane.js';
import { getPref, setPref } from '../../../state/prefs.js';
import { CopyButton } from './body.js';
import { FOOT_BUTTON, FOOT_FRAME, FOOT_SAID, FOOT_WORDS } from './foot.js';

/** A text field that grows with its lines. */
function GrowingText({
  value,
  onChange,
  placeholder,
  mono = false,
  label,
  onKeyDown,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  label: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
}): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const area = ref.current;
    if (area === null) return;
    area.style.height = 'auto';
    area.style.height = `${String(Math.min(area.scrollHeight + 2, 220))}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      autoFocus={autoFocus}
      spellCheck={!mono}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={onKeyDown}
      className={cx(
        'block w-full min-w-0 resize-none rounded-md border border-line-strong bg-sunken px-2.5 py-[5px] text-[14px] leading-[1.45] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none',
        mono && 'mono',
      )}
    />
  );
}

/** One value's field, by the kind the card says: a text, a number, a
 * switch, a choice, a list with add and remove, a group of fields, or
 * the value as JSON for a type the card cannot read. */
function ValueField({
  type,
  draft,
  onChange,
  label,
  hint,
  onKeyDown,
  autoFocus,
}: {
  type: PlainType;
  draft: Draft;
  onChange: (draft: Draft) => void;
  label: string;
  hint?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
}): ReactNode {
  const entry = entryOf(type);
  if (entry === 'nothing') return <span className="text-xs text-ink-muted">Takes nothing.</span>;
  if (entry === 'switch') {
    return (
      <span className="flex h-8 items-center gap-2 text-[13px] text-ink-secondary">
        <Switch.Root
          checked={draft === true}
          aria-label={label}
          onCheckedChange={(checked) => {
            onChange(checked);
          }}
          className="relative h-5 w-9 shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-ink"
        >
          <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface transition-transform data-[state=checked]:translate-x-[18px]" />
        </Switch.Root>
        {draft === true ? 'yes' : 'no'}
      </span>
    );
  }
  if (type.kind === 'oneOf') {
    if (type.options.length <= 3) {
      return (
        <span className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
          {type.options.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={draft === option}
              onClick={() => {
                onChange(option);
              }}
              className={cx(
                'h-8 rounded-md border px-2.5 text-[13px]',
                draft === option
                  ? 'border-ink bg-ink text-ground'
                  : 'border-line-strong text-ink-secondary hover:bg-hover',
              )}
            >
              {option}
            </button>
          ))}
        </span>
      );
    }
    return (
      <select
        aria-label={label}
        value={typeof draft === 'string' ? draft : ''}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-8 w-full rounded-md border border-line-strong bg-sunken px-2 text-[13px] text-ink focus:border-ink focus:outline-none"
      >
        <option value="" disabled>
          Choose…
        </option>
        {type.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (type.kind === 'list') {
    const items = Array.isArray(draft) ? draft : [];
    return (
      <div className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <ValueField
                type={type.of}
                draft={item}
                label={`${label}, item ${String(index + 1)}`}
                onChange={(next) => {
                  onChange(items.map((held, at) => (at === index ? next : held)));
                }}
              />
            </div>
            <button
              type="button"
              aria-label={`Remove item ${String(index + 1)} of ${label}`}
              onClick={() => {
                onChange(items.filter((_, at) => at !== index));
              }}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            onChange([...items, emptyDraft(type.of)]);
          }}
          className="flex h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-ink-secondary hover:bg-hover hover:text-ink"
        >
          <Plus size={13} /> add
        </button>
      </div>
    );
  }
  if (type.kind === 'fields') {
    const drafts = typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
    return (
      <div className="border-l-2 border-line pl-3">
        <FieldRows
          fields={type.fields}
          drafts={drafts}
          onChange={(next) => {
            onChange(next);
          }}
        />
      </div>
    );
  }
  const text = typeof draft === 'string' ? draft : '';
  if (entry === 'number') {
    return (
      <input
        inputMode="decimal"
        value={text}
        aria-label={label}
        placeholder={hint ?? 'a number'}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="figures h-8 w-full max-w-48 rounded-md border border-line-strong bg-sunken px-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
      />
    );
  }
  return (
    <GrowingText
      value={text}
      label={label}
      mono={entry === 'json'}
      placeholder={entry === 'json' ? `${typeWord(type)}, as JSON` : (hint ?? '')}
      onChange={onChange}
      {...(onKeyDown === undefined ? {} : { onKeyDown })}
      {...(autoFocus === undefined ? {} : { autoFocus })}
    />
  );
}

/** A group of fields, one a line: its label, its field, and its
 * parameter's own sentence. What is optional folds under "more" until
 * it is set. */
function FieldRows({
  fields,
  drafts,
  onChange,
}: {
  fields: PlainField[];
  drafts: { [name: string]: Draft };
  onChange: (drafts: { [name: string]: Draft }) => void;
}): ReactNode {
  const [more, setMore] = useState(false);
  const folded = fields.filter((field) => field.optional && isUnset(drafts[field.name]));
  const shown = fields.filter((field) => more || !folded.includes(field));
  return (
    <div className="flex flex-col gap-2">
      {shown.map((field) => (
        <div
          key={field.name}
          className="grid grid-cols-1 items-start gap-x-3 gap-y-1 sm:grid-cols-[minmax(84px,max-content)_minmax(0,1fr)]"
        >
          <label className="pt-1.5 text-[13px] text-ink-secondary">
            {labelOf(field.name)}
            {field.optional && <span className="ml-1 text-xs text-ink-muted">optional</span>}
          </label>
          <div className="min-w-0">
            <ValueField
              type={field.type}
              draft={drafts[field.name]}
              label={labelOf(field.name)}
              onChange={(next) => {
                onChange({ ...drafts, [field.name]: next });
              }}
            />
            {field.doc.length > 0 && (
              <p className="mt-0.5 text-xs text-ink-muted">{field.doc.join(' ')}</p>
            )}
          </div>
        </div>
      ))}
      {folded.length > 0 && (
        <button
          type="button"
          aria-expanded={more}
          onClick={() => {
            setMore(!more);
          }}
          className="flex h-6 items-center gap-1 self-start text-xs text-ink-muted hover:text-ink"
        >
          {more ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          more
          {!more && (
            <span>· {folded.map((field) => labelOf(field.name).toLowerCase()).join(' · ')}</span>
          )}
        </button>
      )}
    </div>
  );
}

/** A call loaded into the box: its function and what it was asked. */
export interface Loaded {
  handler: string;
  args: unknown;
  /** Changes at every loading, so the same call can be loaded twice. */
  stamp: number;
}

/** Where a module's function runs: by itself, or inside one of the
 * agents the module runs inside, and the one a call from the box runs
 * in. */
export interface Inside {
  /** The places a call of the module runs: by itself first, always,
   * then the agents the module runs inside. */
  agents: string[];
  /** Where a call from the box runs: by itself, or the agent it runs
   * in; none where the agent the box stood on left the plane, until
   * the reader chose another place. */
  chosen: string | undefined;
  /** The agent the box stood on, where it runs the module no more. */
  left: string | undefined;
  /** Whether the plane's agents were read: before that the box says
   * nothing of the agents it does not list yet. */
  read: boolean;
  onChoose: (agentId: string) => void;
  /** For an interface's box: the module the call goes through, the
   * implementor the plane binds to the interface. The places are that
   * module's. None for a module's own box. */
  through?: string;
}

/** A place a module's call runs, as the box's choice shows it. */
const placeWords = (place: string): string => (place === BY_ITSELF ? 'by itself' : place);

/**
 * The send box: the cli's `call` with a form. Closed, it is one line at
 * the conversation's foot; entered, a field per parameter. The button
 * carries the function's own name, so the outcome is known before the
 * press, and the plane's kind wherever a mistake could cost something.
 * A module's box names, before the function, the agent the call runs
 * inside, as the cli's `--in` does.
 */
export function SendBox({
  agentId,
  kind,
  contractSha,
  cards,
  onSend,
  inside,
  loaded,
  onLoaded,
  onTouched,
}: {
  agentId: string;
  /** The agent's kind, as the plane lists it now: what was typed while
   * the agent was another kind is sent nowhere before the reader chose. */
  kind: string;
  /** The contract the cards were read from, by the sha256 hex of its
   * text. What is typed is typed against it, stays with it until the
   * reader chose the function again, and is sent under it, so the plane
   * refuses what was typed against a contract the agent has no more. */
  contractSha: string | undefined;
  cards: FunctionCard[];
  onSend: (card: FunctionCard, args: unknown, contractSha: string | undefined) => void;
  inside?: Inside | undefined;
  loaded?: Loaded | undefined;
  /** Hears that a loading was taken, so that it is taken once. */
  onLoaded?: () => void;
  /** Hears that the reader touched the box, by a key or a press inside
   * it: what was asked of the box before that, and is not yet answered,
   * is theirs to overrule. */
  onTouched?: () => void;
}): ReactNode {
  const [plane] = usePlane();
  const playground = isPlayground(plane);
  // The function the box calls is this tab's own, held beside what was
  // typed for it, and it changes at the reader's choice alone. What the
  // browser remembers of the last one chosen starts the box, and each
  // choice is written there for the next box opened. A choice made in
  // another tab does not turn this one, and a function the contract no
  // longer has is not replaced by another under what was typed.
  const lastKey = `send.last.${agentId}`;
  const [picked, setPicked] = useState(() => {
    const kept = getPref<string | null>(lastKey, null);
    return cards.find((entry) => entry.name === kept)?.name ?? cards[0]?.name ?? '';
  });
  const pick = (name: string): void => {
    setPicked(name);
    setPref(lastKey, name);
  };
  const [entered, setEntered] = useState(false);
  const [drafts, setDrafts] = useState<{ [name: string]: Draft }>({});
  const [asJson, setAsJson] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  // A loading the box did not take, the agent no longer having the
  // function: said under the box, with what the call was asked, until
  // the reader closes the line or the box takes another loading.
  const [notLoaded, setNotLoaded] = useState<Pick<Loaded, 'handler' | 'args'> | undefined>(
    undefined,
  );
  const box = useRef<HTMLDivElement>(null);
  const history = useRef(new Map<string, unknown[]>());
  const [recalled, setRecalled] = useState(-1);

  // What stands in the box was typed against the agent's contract as it
  // was read then. The contract is read again as the reader works, and
  // may come back without the function, or as another text: what was
  // typed may be read under another name, or not at all, by a function
  // that answers as if all were well. So the box keeps the form as it
  // was laid out, where what was typed is read and copied, and sends
  // nothing until the reader chooses the function to call. That holds
  // however it was typed: the names in a JSON text are the parameters'
  // as much as the fields' are. The same holds when the agent itself
  // became another kind, a module deployed again as a task or a task as
  // a module: the call would go another way than the one it was typed
  // for (the rule is `heldBecause`).
  const nothingTyped = asJson ? jsonText.trim() === '' : Object.values(drafts).every(isUnset);
  const found = useMemo(() => cards.find((entry) => entry.name === picked), [cards, picked]);
  const laidOut = useRef(found);
  const laidKind = useRef(kind);
  const laidSha = useRef(contractSha);
  const held = heldBecause(
    { kind: laidKind.current, contractSha: laidSha.current },
    { kind, contractSha, found: found !== undefined },
    !nothingTyped,
  );
  const gone = held === 'gone';
  const redeployed = held === 'redeployed';
  const rekinded = held === 'rekinded';
  const wasKind = laidKind.current;
  // The box follows the agent as it is wherever nothing holds it back:
  // the function as it is read now, the agent's kind and its contract.
  if (held === undefined) {
    if (found !== undefined) laidOut.current = found;
    laidKind.current = kind;
    laidSha.current = contractSha;
  }
  const card = laidOut.current;
  /** The box sends nothing: what stands in it is not this function's to take as it is. */
  const withheld = held !== undefined;
  /** The box sends nothing: the agent the call was to run in left, and the reader chose no other. */
  const nowhere = inside !== undefined && inside.chosen === undefined;
  // Where nothing was typed for a function that is gone there is nothing
  // to send astray, and the first function the agent has takes its place.
  const first = cards[0]?.name;
  useEffect(() => {
    if (gone && nothingTyped && first !== undefined) setPicked(first);
  }, [gone, nothingTyped, first]);

  // A call loaded into the box fills it and sends nothing. A loading is
  // taken once: the box it filled is the reader's from there, and a
  // return to this conversation does not fill it again. A recorded call
  // is laid in the form where the form says the same call back, and as
  // its own JSON where it would not: sent again, it carries what the
  // first one carried. A call of a function the agent no longer has is
  // not laid under another function: the box stays as it was, and says
  // what it did not take.
  useEffect(() => {
    if (loaded === undefined) return;
    const target = cards.find((entry) => entry.name === loaded.handler);
    if (target !== undefined) {
      const faithful = loaded.args === undefined || formHolds(target, loaded.args);
      // The fields are filled for the function as it is laid out now,
      // against the agent as it is read now.
      laidOut.current = target;
      laidKind.current = kind;
      laidSha.current = contractSha;
      pick(target.name);
      setDrafts(faithful ? draftsOf(target, loaded.args) : {});
      setAsJson(!faithful);
      setJsonText(faithful ? '' : JSON.stringify(loaded.args, null, 2));
      setError(undefined);
      setEntered(true);
    }
    setNotLoaded(target === undefined ? { handler: loaded.handler, args: loaded.args } : undefined);
    onLoaded?.();
    // Only a new loading fills the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded?.stamp]);

  // An empty box that is left closes to its one line, which moves the
  // conversation above it. A press that left it is let finish first, so
  // what stood under the pointer at the press is still there at its
  // release, and the click lands on what the reader pressed.
  const pressed = useRef(false);
  const closeAtRelease = useRef(false);
  useEffect(() => {
    const down = (): void => {
      pressed.current = true;
    };
    const up = (): void => {
      pressed.current = false;
      if (!closeAtRelease.current) return;
      closeAtRelease.current = false;
      // After the click this release makes, which comes in the same turn.
      window.setTimeout(() => {
        if (box.current?.contains(document.activeElement) !== true) setEntered(false);
      }, 0);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);

  // The box entered, or turned to another function or to JSON, puts the
  // keyboard in its first field, unless it already stands in one of them.
  const chosen = card?.name;
  useEffect(() => {
    if (!entered) return;
    const fields = 'textarea, input, select, [role="radio"], [role="switch"]';
    const active = document.activeElement;
    if (active !== null && box.current?.contains(active) === true && active.matches(fields)) return;
    box.current?.querySelector<HTMLElement>(fields)?.focus();
  }, [entered, chosen, asJson]);

  if (card === undefined) return null;

  const [only] = card.fields;
  const oneLine =
    !asJson && card.fields.length === 1 && only !== undefined && entryOf(only.type) === 'text';
  // A function whose parameters were not read has no field, and may
  // take anything: it is entered like one that takes something.
  const takesNothing = card.fields.length === 0 && !card.unread;

  /** What is typed, as the JSON a send of it would carry; none where nothing is. */
  const typedJson = (): string | undefined => {
    if (asJson) return jsonText.trim() === '' ? undefined : jsonText;
    if (Object.values(drafts).every(isUnset)) return undefined;
    const read = readArguments(card, drafts);
    return JSON.stringify(read.ok ? read.value : drafts, null, 2);
  };

  const choose = (name: string): void => {
    // A choice made because the function typed for is gone, or because
    // the agent was deployed again under another contract or became
    // another kind, keeps what was typed, as its JSON under the function
    // chosen: the reader sees what would be sent, and to which function,
    // before sending it. The choice is the reader's word for the
    // function and the agent as they are now: the box is laid out from
    // them, and what stands in it is typed against that contract.
    const carried = withheld ? typedJson() : undefined;
    laidOut.current = cards.find((entry) => entry.name === name) ?? laidOut.current;
    laidKind.current = kind;
    laidSha.current = contractSha;
    pick(name);
    setDrafts({});
    setAsJson(carried !== undefined);
    setJsonText(carried ?? '');
    setError(undefined);
    setRecalled(-1);
    setEntered(true);
  };

  const send = (): void => {
    // What was typed for a function the agent no longer has, or against
    // a contract or a kind it has no more, or for an agent that runs the
    // module no more, is sent nowhere before the reader chose.
    if (withheld || nowhere) return;
    let args: unknown;
    if (asJson) {
      const text = jsonText.trim();
      if (text === '') {
        args = undefined;
      } else {
        try {
          args = JSON.parse(text) as unknown;
        } catch {
          setError('The arguments are not JSON.');
          return;
        }
      }
    } else {
      const read = readArguments(card, drafts);
      if (!read.ok) {
        setError(read.error);
        return;
      }
      args = read.value;
    }
    setError(undefined);
    const held = history.current.get(card.name) ?? [];
    history.current.set(card.name, [...held, args].slice(-20));
    setRecalled(-1);
    // Sent under the contract it was typed against.
    onSend(card, args, laidSha.current);
    setDrafts({});
    setJsonText('');
  };

  const toggleJson = (): void => {
    if (asJson) {
      let args: unknown;
      try {
        const text = jsonText.trim();
        args = text === '' ? undefined : (JSON.parse(text) as unknown);
      } catch {
        setError('The arguments are not JSON.');
        return;
      }
      // The form takes arguments it would send back as they are, and leaves the rest as JSON.
      if (args !== undefined && !formHolds(card, args)) {
        setError(
          'The form would not send these arguments as they are (it leaves out what is empty, and what the function does not name): they stay as JSON.',
        );
        return;
      }
      setDrafts(draftsOf(card, args));
      setAsJson(false);
      setError(undefined);
      return;
    }
    const read = readArguments(card, drafts);
    setJsonText(read.ok && read.value !== undefined ? JSON.stringify(read.value, null, 2) : '');
    setAsJson(true);
    setError(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // A key an input method takes while it composes a text sends nothing and closes nothing.
    if (composing(event)) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
      return;
    }
    if (event.key === 'Escape') {
      const empty = asJson ? jsonText.trim() === '' : Object.values(drafts).every(isUnset);
      if (empty) setEntered(false);
    }
  };

  // In a box of one text: Enter sends where a mistake costs nothing, and
  // the arrows recall what was sent to this function before.
  const onLineKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // The Enter that takes an input method's suggestion is no send, and
    // its arrows recall nothing: the text is not written yet.
    if (only === undefined || composing(event)) return;
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      playground
    ) {
      event.preventDefault();
      send();
      return;
    }
    const held = history.current.get(card.name) ?? [];
    const value = drafts[only.name];
    if (event.key === 'ArrowUp' && (isUnset(value) || recalled >= 0) && held.length > 0) {
      event.preventDefault();
      const at = recalled < 0 ? held.length - 1 : Math.max(0, recalled - 1);
      setRecalled(at);
      setDrafts(draftsOf(card, held[at]));
    } else if (event.key === 'ArrowDown' && recalled >= 0) {
      event.preventDefault();
      const at = recalled + 1;
      if (at >= held.length) {
        setRecalled(-1);
        setDrafts({});
      } else {
        setRecalled(at);
        setDrafts(draftsOf(card, held[at]));
      }
    }
  };

  // A module's call has a place to run: by itself, the first of the
  // choices, which the plane starts at the call when it is not started.
  // The one module with none is a compile's test form, which the
  // compile's own tests call: there is nothing to choose, and the send
  // is held.
  const insideSelect =
    inside === undefined || inside.agents.length === 0 ? null : (
      <label className="flex min-w-0 shrink items-center gap-1.5 text-[13px] text-ink-secondary">
        In
        <select
          value={inside.chosen ?? ''}
          onChange={(event) => {
            inside.onChoose(event.target.value);
          }}
          className="h-8 max-w-64 min-w-0 rounded-md border border-line-strong bg-sunken px-2 text-[13px] text-ink focus:border-ink focus:outline-none"
        >
          {inside.chosen === undefined && (
            <option value="" disabled>
              Choose where
            </option>
          )}
          {inside.agents.map((id) => (
            <option key={id} value={id}>
              {placeWords(id)}
            </option>
          ))}
        </select>
      </label>
    );

  const sendButton = (
    <div className="flex shrink-0 items-stretch">
      <button
        type="button"
        disabled={withheld || nowhere}
        onClick={() => {
          if (!entered && !takesNothing) {
            setEntered(true);
            return;
          }
          send();
        }}
        title={
          gone
            ? `${card.name} is no longer a function of ${agentId}`
            : redeployed
              ? `${agentId} was deployed again under another contract: choose the function to call`
              : rekinded
                ? `${agentId} is ${aKind(kind)} now: choose the function to call`
                : inside === undefined
                  ? `Calls ${card.name} of ${agentId}`
                  : inside.chosen !== undefined
                    ? `Calls ${card.name} of ${agentId}${inside.through === undefined ? '' : ` through ${inside.through}`} ${inside.chosen === BY_ITSELF ? 'by itself' : `in ${inside.chosen}`}`
                    : inside.agents.length === 0
                      ? `${inside.through ?? agentId} is a compile's test form: the compile's own tests call it`
                      : `Choose where ${card.name} of ${agentId} runs`
        }
        className={cx(FOOT_BUTTON, cards.length > 1 || withheld ? 'rounded-l-md' : 'rounded-md')}
      >
        {card.spoken}
        <PlaneMark />
      </button>
      {(cards.length > 1 || withheld) && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Choose a function"
              className="flex h-8 w-7 items-center justify-center rounded-r-md border-l border-on-accent/25 bg-accent text-on-accent hover:brightness-105"
            >
              <ChevronDown size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              side="top"
              sideOffset={6}
              collisionPadding={8}
              className="sheet z-[60] max-h-[60vh] w-80 overflow-y-auto p-1 text-[13px]"
            >
              {cards.map((entry) => (
                <DropdownMenu.Item
                  key={entry.name}
                  onSelect={() => {
                    choose(entry.name);
                  }}
                  className="flex cursor-pointer flex-col rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
                >
                  <span className={cx('text-ink', entry.name === card.name && 'font-semibold')}>
                    {entry.spoken}
                  </span>
                  {entry.summary !== '' && (
                    <span className="line-clamp-2 text-xs text-ink-muted">{entry.summary}</span>
                  )}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );

  const jsonButton = (
    <Tip label={asJson ? 'Back to the form' : 'The arguments as one JSON text'} side="top">
      <button
        type="button"
        aria-pressed={asJson}
        aria-label="The arguments as one JSON text"
        onClick={toggleJson}
        className={cx(
          'flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-ink',
          asJson ? 'bg-chosen text-ink' : 'text-ink-muted',
        )}
      >
        <Braces size={15} />
      </button>
    </Tip>
  );

  return (
    <div className="shrink-0 px-6 pt-1 pb-4">
      <div
        ref={box}
        onKeyDownCapture={onTouched}
        onPointerDownCapture={onTouched}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (box.current?.contains(event.relatedTarget) === true) return;
          const empty = asJson ? jsonText.trim() === '' : Object.values(drafts).every(isUnset);
          if (!empty || error !== undefined) return;
          if (pressed.current) closeAtRelease.current = true;
          else setEntered(false);
        }}
        className={cx(FOOT_FRAME, 'focus-within:border-ink-muted')}
      >
        {!entered ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEntered(true);
              }}
              className={cx(FOOT_WORDS, 'h-8 truncate')}
            >
              Call a function…
            </button>
            {insideSelect}
            {sendButton}
          </div>
        ) : oneLine ? (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <ValueField
                type={only.type}
                draft={drafts[only.name]}
                label={labelOf(only.name)}
                hint={only.doc.join(' ') || labelOf(only.name)}
                autoFocus
                onKeyDown={onLineKey}
                onChange={(next) => {
                  setRecalled(-1);
                  setDrafts({ [only.name]: next });
                }}
              />
            </div>
            {jsonButton}
            {insideSelect}
            {sendButton}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 px-1.5 pt-1">
            {card.summary !== '' && (
              <p className="text-[13px] text-ink-secondary">{card.summary}</p>
            )}
            {asJson ? (
              <GrowingText
                value={jsonText}
                label="The arguments as JSON"
                mono
                autoFocus
                placeholder={
                  card.unread
                    ? 'The arguments, as JSON'
                    : card.fields.length === 0
                      ? 'This function takes nothing.'
                      : card.fields.length === 1
                        ? `${labelOf(only?.name ?? '')}, as JSON`
                        : `{ ${card.fields.map((field) => `"${field.name}": …`).join(', ')} }`
                }
                onChange={setJsonText}
              />
            ) : takesNothing ? (
              <p className="text-xs text-ink-muted">This function takes nothing.</p>
            ) : card.unread ? (
              <p className="text-xs text-ink-muted">
                The contract does not say what this function takes. Write the arguments as JSON.
              </p>
            ) : (
              <FieldRows fields={card.fields} drafts={drafts} onChange={setDrafts} />
            )}
            <div className="flex items-center justify-end gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                {playground ? '' : `Sends to ${planeLabel(plane, PLANE_ADDRESS)} · `}
                {navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'} Enter sends
              </span>
              {jsonButton}
              {insideSelect}
              {sendButton}
            </div>
          </div>
        )}
        {withheld && (
          <p role="alert" className="px-1.5 pt-1.5 text-xs text-bad">
            {gone
              ? `${card.spoken} is no longer a function of this agent.`
              : redeployed
                ? `${agentId} was deployed again since you wrote this, under another contract.`
                : `${agentId} is ${aKind(kind)} now, and was ${aKind(wasKind)} when you wrote this.`}{' '}
            What you wrote is kept: choose the function to call.
          </p>
        )}
        {nowhere && inside.read && inside.left !== undefined && (
          <p role="alert" className="px-1.5 pt-1.5 text-xs text-bad">
            {inside.through ?? agentId} no longer runs inside {inside.left}. What you wrote is kept:
            choose where to call it.
          </p>
        )}
        {notLoaded !== undefined && (
          <div role="alert" className="flex items-start gap-1 px-1.5 pt-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <p className="text-bad">
                {spoken(notLoaded.handler)} is no longer a function of this agent. Nothing was
                loaded: the box calls {card.spoken}, as before.
              </p>
              {notLoaded.args !== undefined && (
                <p className="mt-0.5 text-ink-secondary">
                  What the call was asked:{' '}
                  <span className="mono line-clamp-3 break-all text-ink">
                    {JSON.stringify(notLoaded.args)}
                  </span>
                </p>
              )}
            </div>
            {notLoaded.args !== undefined && (
              <CopyButton
                text={() => JSON.stringify(notLoaded.args, null, 2)}
                label="Copy what the call was asked"
              />
            )}
            <button
              type="button"
              aria-label="Close this line"
              onClick={() => {
                setNotLoaded(undefined);
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {error !== undefined && (
          <p role="alert" className={cx(FOOT_SAID, 'text-bad')}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
