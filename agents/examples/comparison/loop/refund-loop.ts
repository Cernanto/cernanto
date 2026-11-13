// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The refund policy as a prompt-driven agent loop: the policy is the
// system prompt, the shop and the chat are tools, the model decides.
// This is the baseline of examples/comparison: what the same policy
// costs to write by hand on a vendor SDK, with the state, the retries
// and the idempotency the compiled desk gets from the language.
//
// Run from agents/: ANTHROPIC_API_KEY=... node --experimental-strip-types
// examples/comparison/loop/refund-loop.ts A-1012 "The notebooks are unused, in the box; refund please"

import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MODEL = process.env.REFUND_LOOP_MODEL ?? 'claude-sonnet-5';
const STATE_DIR = join(import.meta.dirname, '.state');
const MAX_TURNS = 12;
const MAX_ATTEMPTS = 4;

// ---- the world: the sandbox through the cli, the way any storefront script would reach it

function invoke(agent: string, fn: string, args: Record<string, unknown>): unknown {
  const out = execFileSync('cernanto', ['call', agent, fn, '--args', JSON.stringify(args), '-q'], {
    encoding: 'utf8',
  });
  const last = out.trim().split('\n').pop() ?? 'null';
  return JSON.parse(last);
}

// ---- the tools, their schemas by hand

const tools: Anthropic.Tool[] = [
  {
    name: 'get_order',
    description: 'The order by its id: customer, items, delivery date, status, total, payment.',
    input_schema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
  },
  {
    name: 'refund_order',
    description:
      'Refunds an order for an amount, at most what it paid. The same order is refunded once however many times this is called.',
    input_schema: {
      type: 'object',
      properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
      required: ['orderId', 'amount'],
    },
  },
  {
    name: 'post_to_support',
    description: 'Posts the case to the support channel for a person.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'decide',
    description: 'The final answer: the decision and the reply to send the customer.',
    input_schema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['refunded', 'refused', 'escalated'] },
        reply: { type: 'string' },
        refundId: { type: 'string' },
        amount: { type: 'number' },
      },
      required: ['decision', 'reply'],
    },
  },
];

function runTool(name: string, input: Record<string, unknown>, state: State): unknown {
  switch (name) {
    case 'get_order':
      return invoke('examples/sandbox/orders', 'getOrder', { orderId: input.orderId });
    case 'refund_order': {
      // Idempotency by hand: the key is the order id, kept in our own
      // state file so a crash between the refund and the reply never
      // refunds twice.
      const key = String(input.orderId);
      if (state.refunds[key] !== undefined) return state.refunds[key];
      const refund = invoke('examples/sandbox/orders', 'refundOrder', {
        orderId: key,
        amount: input.amount,
      });
      state.refunds[key] = refund;
      saveState(state);
      return refund;
    }
    case 'post_to_support':
      return invoke('examples/sandbox/chat', 'send', { chat: '#support', text: input.text });
    default:
      throw new Error(`no tool ${name}`);
  }
}

// ---- the state: by hand, on disk, so a rerun after a crash resumes

interface State {
  caseId: string;
  messages: Anthropic.MessageParam[];
  refunds: Record<string, unknown>;
  decision?: unknown;
}

function stateFile(caseId: string): string {
  return join(STATE_DIR, `${caseId}.json`);
}

function loadState(caseId: string, first: string): State {
  const file = stateFile(caseId);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as State;
  return { caseId, messages: [{ role: 'user', content: first }], refunds: {} };
}

function saveState(state: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFile(state.caseId), JSON.stringify(state, null, 2));
}

// ---- the loop, with retries by hand

const system = `${readFileSync(join(import.meta.dirname, '..', 'policy.md'), 'utf8')}

You are the refund desk. Today is ${new Date().toISOString().slice(0, 10)}.
Read the customer's message, fetch the order with get_order, apply the
policy exactly, act with refund_order or post_to_support when the
policy says so, then call decide with the decision and the reply,
drafted on this template:

Dear {customer name},

Thank you for writing to us about order {order id}.

{the decision in one or two sentences}

Kind regards,
Acme Ledgers support`;

async function withRetries<T>(work: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      attempt += 1;
      const status = (error as { status?: number }).status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

async function main(): Promise<void> {
  const [orderId, ...rest] = process.argv.slice(2);
  const message = rest.join(' ');
  if (orderId === undefined || message === '') {
    console.error("usage: refund-loop.ts <orderId> <the customer's message>");
    process.exit(2);
  }
  const client = new Anthropic();
  const caseId = `${orderId}-${Buffer.from(message).toString('base64url').slice(0, 16)}`;
  const state = loadState(caseId, `Order ${orderId}. The customer writes: ${message}`);
  if (state.decision !== undefined) {
    console.log(JSON.stringify(state.decision));
    return;
  }
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await withRetries(() =>
      client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system,
        tools,
        messages: state.messages,
      }),
    );
    state.messages.push({ role: 'assistant', content: response.content });
    saveState(state);
    const uses = response.content.filter((block) => block.type === 'tool_use');
    if (uses.length === 0) break;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      if (use.type !== 'tool_use') continue;
      const input = use.input as Record<string, unknown>;
      if (use.name === 'decide') {
        state.decision = input;
        saveState(state);
        console.log(JSON.stringify(input));
        return;
      }
      let content: string;
      try {
        content = JSON.stringify(runTool(use.name, input, state));
      } catch (error) {
        content = `error: ${error instanceof Error ? error.message : String(error)}`;
      }
      results.push({ type: 'tool_result', tool_use_id: use.id, content });
    }
    state.messages.push({ role: 'user', content: results });
    saveState(state);
  }
  throw new Error(`no decision after ${String(MAX_TURNS)} turns`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
