## The interface shape

An interface is a contract with no body: a shared surface many agents
will implement, and consumers will bind by name at run time. This
compile produces declarations and nothing else: nothing ever runs an
interface, so there is no implementation to write, no zod schema, no
imports of any runtime, no state and no events. The moment a file
here carries runtime code (a function body, a const with a value, a
class, an enum), the compile refuses it by statement.

Write `src/index.ts` with exactly two kinds of declarations:

1. The record and result types of the surface, as plain interfaces (or
   type aliases), every property documented: a record only for an
   input that is one thing the specification names (a mail, a filter,
   a document) or for several optional settings that travel together,
   a result type when a function answers several things at once. A
   function's parameters are named and typed in its own declaration,
   never gathered into a type of their own. These are the types every
   implementor must declare identically and every consumer imports, so
   their names and spellings are permanent the moment a family exists:
   choose them as carefully as the prose asks.
2. The functions of the surface as ambient declarations, one per
   function, each with its full signature and complete TSDoc:
   `export declare function send(to: string, subject: string, body: string): Promise<void>;`
   (exports are the API: an implementor exports a function of exactly
   this shape). A wait operation is declared like any other function
   (`export declare function waitForMailReceived(filter?: MailFilter):
   Promise<Mail | null>;`), its filter whatever the specification asks
   for. The TSDoc here is the load-bearing text of
   the whole family: every implementor's compile is anchored to these
   declarations verbatim (names, parameters, types AND the docs), and
   every consumer's generated module carries them word for word. State
   the semantics the prose demands on the declaration it governs:
   what each function answers, which outcomes are normal answers and
   which are errors, what an absent field means, how each filter
   argument matches, precisely enough that two independent
   implementations reading only these docs behave the same.

A complete declaration, small, with the docs that anchor every
implementor and every consumer:

```ts
/** A message as the mail system delivers it. */
export interface Mail {
  /** The sender's address, as the mail carries it. */
  from: string;
  /** The subject line, verbatim, empty when the mail has none. */
  subject: string;
  /** The plain-text body; an html-only mail is converted to text. */
  body: string;
  /** When the mail arrived at the mailbox. */
  receivedAt: Date;
}

/** What a wait for mail may filter on; every field is optional. */
export interface MailFilter {
  /** Only mail from this exact address. */
  from?: string;
  /** Only mail whose subject contains this text, case-insensitively. */
  subjectContains?: string;
  /** How long to wait at most, in milliseconds; five minutes when absent. */
  timeoutMs?: number;
}

/**
 * Parks until the next mail matching every given filter arrives, and
 * answers it; mail that arrived before the call is not considered.
 *
 * @param filter - The filters; none means the next mail of any kind.
 * @returns The mail that matched, or null when the wait timed out
 *   with no match: a timeout is a normal answer, never an error.
 * @throws When the mailbox cannot be read at all (no account is
 *   connected), in those words.
 * @example
 * const mail = await waitForMailReceived({ subjectContains: 'invoice', timeoutMs: 60_000 });
 * // => { from: 'billing@example.com', subject: 'Invoice 42', body: '...', receivedAt: ... } or null
 */
export declare function waitForMailReceived(filter?: MailFilter): Promise<Mail | null>;
```

Splitting types across files is allowed (`export type ... from
'./types.js'`); the compile flattens the emitted contract into one
self-contained text either way. Keep the surface small: an interface
is the highest-leverage contract in a workspace (every implementor
and consumer recompiles when it changes), so declare exactly what the
specification describes and nothing speculative.

Say each thing once. A function's parameters are declared and
documented in its own declaration, each with `@param`; a record
several functions take is declared once and shared; a rule is stated
on the one declaration it governs and is not repeated on each function
that uses it; a function's own documentation adds only what is its
own, what it answers, which outcomes are normal answers and which are
errors, and one example. A coder reads the whole contract in a minute.
