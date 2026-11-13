// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The traces on DynamoDB, in the plane's one table, every item
// under the life of the agent it is kept for:
//
//   `t#<life>#<call>`  one partition per call's id: each story's records
//                      (`<story>#r#<run>#<place>`, in the order of the
//                      story's runs and their places), its links to the
//                      stories it made (`<story>#p#<child>`) and a mark
//                      that the story is kept here (`<story>#s`);
//   `f#<life>`         the life's facts, newest first by the moment their
//                      story began (`<began>#<story>#<fact>#<attempt>#<run>`);
//   `n#<life>`         the totals, one item per copy that writes under
//                      the life (`<writer>`), never expiring;
//   `x#<life>`         the call partitions the life holds (`<call>`), the
//                      removal's list, and the removal's own mark
//                      (`#removal`), the moment it found the totals gone.
//
// Every row but a total carries the TTL `expires`. A text above the
// spill rides the bucket under `traces/<life>/<call>/...` and the item
// keeps its key. The save of the totals is the one conditioned write
// and the check of the life: a copy's item is made once, in a
// transaction that checks the name's record names the life, and a save
// is taken only above the number the item holds; the rest are plain
// batches, sent in order, a chunk when the one before it landed.

import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { lifeKey } from '../../substrate.js';
import type {
  FactRow,
  LifePart,
  PointerRow,
  SaveAnswer,
  SaveStep,
  TraceRow,
  Traces,
} from '../../substrate.js';
import { conditionFailed, recordPartition, ttlOf } from './table.js';
import type { PlaneTable } from './table.js';

/** How many puts or deletes one batch carries. */
const BATCH = 25;
/** How many times the unprocessed part of a batch is asked again. */
const BATCH_ROUNDS = 5;
/** How long the removal waits, once the writers' items are gone, before
 * it removes the calls: longer than the longest a part takes once its
 * save was taken. */
export const SECOND_SWEEP_MS = 30_000;
/** How long one removal ask works before it answers that more remains. */
const REMOVAL_BUDGET_MS = 20_000;
/** The sort key of the removal's mark in a life's list: no call's id
 * begins with `#`, so it is never a call's. */
export const REMOVAL_MARK = '#removal';

/** The width a grant, a count and a place are spelled in a sort key. */
const WIDTH = 12;

function padded(value: number): string {
  return String(Math.max(0, value)).padStart(WIDTH, '0');
}

/** A run's id as a sort key orders it: the grant and the count, each
 * at a fixed width. */
function runKey(run: string): string {
  const [grant = '0', count = '0'] = run.split('.');
  return `${padded(Number(grant))}.${padded(Number(count))}`;
}

export function callPartition(life: string, call: string): string {
  return `t#${life}#${call}`;
}

export function factsPartition(life: string): string {
  return `f#${life}`;
}

export function totalsPartition(life: string): string {
  return `n#${life}`;
}

export function callsIndexPartition(life: string): string {
  return `x#${life}`;
}

/** The sort key of a record in its call's partition. */
function recordSortKey(row: Pick<TraceRow, 'story' | 'run' | 'place'>): string {
  return `${row.story}#r#${runKey(row.run)}#${padded(row.place)}`;
}

/** The sort key of a fact in its life's partition. */
function factSortKey(row: Pick<FactRow, 'began' | 'story' | 'fact' | 'attempt' | 'run'>): string {
  return `${row.began}#${row.story}#${row.fact}#${row.attempt}#${row.run}`;
}

/** The call's id a story's links are kept with: the parent's. */
function callOfParent(pointer: PointerRow): string {
  const mark = pointer.parent.indexOf('~');
  const head = mark === -1 ? pointer.parent : pointer.parent.slice(0, mark);
  const tail = mark === -1 ? '' : pointer.parent.slice(mark);
  const parts = head.split(':');
  return `${parts.length === 4 ? parts.slice(0, 3).join(':') : head}${tail}`;
}

/** Whether a writer's totals item already counts a save: its save number,
 * the grant and the count, at or above the save's. */
export function takenBy(
  item: { saveGrant?: unknown; saveCount?: unknown },
  save: Pick<SaveStep, 'grant' | 'count'>,
): boolean {
  const grant = Number(item.saveGrant);
  const count = Number(item.saveCount);
  if (!Number.isFinite(grant) || !Number.isFinite(count)) return false;
  return grant > save.grant || (grant === save.grant && count >= save.count);
}

/** The items with one for each key, the last given for it, in the order
 * the kept ones were given. */
function lastOfEachKey(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const kept: Record<string, unknown>[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined) continue;
    const key = `${String(item['pk'])}\u0000${String(item['sk'])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept.reverse();
}

/** Whether a transaction was cancelled by its first condition alone. */
function firstConditionFailed(error: unknown): boolean {
  const reasons = (error as { CancellationReasons?: { Code?: string }[] } | undefined)
    ?.CancellationReasons;
  return reasons?.[0]?.Code === 'ConditionalCheckFailed';
}

export class DynamoTraces implements Traces {
  private readonly table: PlaneTable;
  /** The call partitions this process named in a life's list already. */
  private readonly indexed = new Set<string>();

  constructor(table: PlaneTable) {
    this.table = table;
  }

  async write(part: LifePart): Promise<SaveAnswer> {
    let saved: SaveAnswer;
    try {
      saved = await this.save(part.service, part.life, part.save);
    } catch {
      return 'unknown';
    }
    if (saved !== 'taken') return saved;
    try {
      await this.lay(part);
      return 'taken';
    } catch {
      return 'unknown';
    }
  }

  /** The save of the totals: added once when its number is above the
   * item's, the item made under the life's check when it is not there. */
  private async save(service: string, life: string, save: SaveStep): Promise<SaveAnswer> {
    const key = { pk: totalsPartition(life), sk: save.writer };
    for (let round = 1; round <= 3; round += 1) {
      try {
        await this.table.documents.send(
          new UpdateCommand({
            TableName: this.table.table,
            Key: key,
            UpdateExpression:
              'ADD callsIn :in, callsOut :out, tokensIn :tin, tokensOut :tout, costUsd :cost, unpriced :unpriced SET lastAt = :at, saveGrant = :grant, saveCount = :count',
            ConditionExpression:
              'attribute_exists(pk) AND (saveGrant < :grant OR (saveGrant = :grant AND saveCount < :count))',
            ExpressionAttributeValues: {
              ':in': save.callsIn,
              ':out': save.callsOut,
              ':tin': save.tokensIn,
              ':tout': save.tokensOut,
              ':cost': save.costUsd,
              ':unpriced': save.unpriced,
              ':at': save.at,
              ':grant': save.grant,
              ':count': save.count,
            },
          }),
        );
        return 'taken';
      } catch (error) {
        if (!conditionFailed(error)) throw error;
      }
      const standing = await this.table.documents.send(
        new GetCommand({ TableName: this.table.table, Key: key, ConsistentRead: true }),
      );
      const item = standing.Item as { saveGrant?: unknown; saveCount?: unknown } | undefined;
      if (item !== undefined) {
        // The item holds this number or a higher one: taken before. A
        // lower one is a save that made the item after this add found it
        // absent: the add is asked again over it.
        if (takenBy(item, save)) return 'taken';
        continue;
      }
      try {
        await this.table.documents.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                ConditionCheck: {
                  TableName: this.table.table,
                  Key: { pk: recordPartition(lifeKey(service)), sk: lifeKey(service) },
                  ConditionExpression: 'attribute_exists(sk) AND contains(#value, :life)',
                  ExpressionAttributeNames: { '#value': 'value' },
                  ExpressionAttributeValues: { ':life': `"life":"${life}"` },
                },
              },
              {
                Put: {
                  TableName: this.table.table,
                  Item: {
                    ...key,
                    service,
                    callsIn: save.callsIn,
                    callsOut: save.callsOut,
                    tokensIn: save.tokensIn,
                    tokensOut: save.tokensOut,
                    costUsd: save.costUsd,
                    unpriced: save.unpriced,
                    since: save.at,
                    lastAt: save.at,
                    saveGrant: save.grant,
                    saveCount: save.count,
                  },
                  ConditionExpression: 'attribute_not_exists(pk)',
                },
              },
            ],
          }),
        );
        return 'taken';
      } catch (error) {
        if (firstConditionFailed(error)) return 'ended';
        if (!conditionFailed(error)) throw error;
        // Another process of the copy made the item meanwhile: the
        // update is asked again.
      }
    }
    return 'unknown';
  }

  /** The part's rows, in order, a chunk when the one before it landed. */
  private async lay(part: LifePart): Promise<void> {
    const expires = ttlOf(part.expires);
    const items: Record<string, unknown>[] = [];
    const calls = new Set<string>();
    for (const row of part.records) {
      calls.add(row.call);
      items.push(await this.recordItem(part.life, row, expires));
    }
    for (const row of part.facts) {
      items.push({
        pk: factsPartition(part.life),
        sk: factSortKey(row),
        story: row.story,
        call: row.call,
        fact: row.fact,
        agent: row.agent,
        began: row.began,
        text: row.text,
        expires,
      });
      if (row.fact === 'began') {
        calls.add(row.call);
        items.push({
          pk: callPartition(part.life, row.call),
          sk: `${row.story}#s`,
          story: row.story,
          began: row.began,
          agent: row.agent,
          expires,
        });
      }
    }
    for (const row of part.pointers) {
      const call = callOfParent(row);
      calls.add(call);
      items.push({
        pk: callPartition(part.life, call),
        sk: `${row.parent}#p#${row.child}`,
        parent: row.parent,
        child: row.child,
        agent: row.agent,
        attempt: row.attempt,
        seq: row.seq,
        turn: row.turn,
        expires,
      });
    }
    // The life's list names each call partition before the partition is
    // written, so the removal finds every one.
    const listed = [...calls].filter((call) => !this.indexed.has(`${part.life}#${call}`));
    await this.putAll(listed.map((call) => ({ pk: callsIndexPartition(part.life), sk: call })));
    for (const call of listed) this.indexed.add(`${part.life}#${call}`);
    await this.putAll(items);
  }

  private async recordItem(
    life: string,
    row: TraceRow,
    expires: number,
  ): Promise<Record<string, unknown>> {
    const sk = recordSortKey(row);
    const ref = await this.table.spillText(`traces/${life}/${row.call}/${sk}`, row.text);
    return {
      pk: callPartition(life, row.call),
      sk,
      story: row.story,
      attempt: row.attempt,
      seq: row.seq,
      kind: row.kind,
      run: row.run,
      place: row.place,
      at: row.at,
      ...(ref === undefined ? { text: row.text } : { ref }),
      expires,
    };
  }

  /** Puts items in batches, in order, each batch once the one before it
   * landed whole. An item named twice is put once, the last given for
   * its key: DynamoDB refuses a batch that names one item twice, and a
   * part can name one more than once (the request's summary by each of
   * its runs' begin facts, a pointer a replay writes again). */
  private async putAll(given: Record<string, unknown>[]): Promise<void> {
    const items = lastOfEachKey(given);
    for (let start = 0; start < items.length; start += BATCH) {
      let requests = items.slice(start, start + BATCH).map((Item) => ({ PutRequest: { Item } }));
      for (let round = 1; requests.length > 0; round += 1) {
        if (round > BATCH_ROUNDS) throw new Error('a batch of the traces was not taken whole');
        const answered = await this.table.documents.send(
          new BatchWriteCommand({ RequestItems: { [this.table.table]: requests } }),
        );
        requests = (answered.UnprocessedItems?.[this.table.table] ?? []) as typeof requests;
      }
    }
  }

  /** Every item of a partition, page by page, its keys and a spilled
   * text's key, read strongly: the removal judges a partition empty by
   * it, and a stale read can leave out what was written. */
  private async *partition(pk: string): AsyncGenerator<{ pk: string; sk: string; ref?: string }[]> {
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.table,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ConsistentRead: true,
          ProjectionExpression: 'pk, sk, #ref',
          ExpressionAttributeNames: { '#ref': 'ref' },
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      yield (page.Items ?? []) as { pk: string; sk: string; ref?: string }[];
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
  }

  /** Deletes items by their keys, in batches; their spilled texts go
   * with them. */
  private async deleteAll(keys: { pk: string; sk: string; ref?: string }[]): Promise<void> {
    for (let start = 0; start < keys.length; start += BATCH) {
      const chunk = keys.slice(start, start + BATCH);
      let requests = chunk.map((key) => ({ DeleteRequest: { Key: { pk: key.pk, sk: key.sk } } }));
      for (let round = 1; requests.length > 0; round += 1) {
        if (round > BATCH_ROUNDS) throw new Error('a removal batch was not taken whole');
        const answered = await this.table.documents.send(
          new BatchWriteCommand({ RequestItems: { [this.table.table]: requests } }),
        );
        requests = (answered.UnprocessedItems?.[this.table.table] ?? []) as typeof requests;
      }
      for (const key of chunk) if (key.ref !== undefined) this.table.deleteObject(key.ref);
    }
  }

  /** Empties a partition, within the budget; answers whether it is
   * empty. The budget is looked at before each page past the first, so
   * an ask always takes a page and a partition its last page emptied is
   * answered empty. */
  private async emptyPartition(pk: string, deadline: number): Promise<boolean> {
    let first = true;
    for await (const page of this.partition(pk)) {
      if (!first && Date.now() > deadline) return false;
      first = false;
      await this.deleteAll(page);
    }
    return true;
  }

  /**
   * Removes the traces of a life whose name no longer names it: the
   * writers' items of totals first (a save that finds none is answered
   * that the life ended, so none is taken after them), and the moment
   * they were found gone is marked in the life's list. Once the longest
   * a part takes has passed since that mark, every part whose save was
   * taken has laid its rows down: each call partition the list names is
   * emptied and its entry leaves with it, so an ask the budget cuts goes
   * on from the first call still listed, then the facts, then the mark.
   * An ask before that moment answers that more remains.
   */
  async remove(life: string, deadline = Date.now() + REMOVAL_BUDGET_MS): Promise<boolean> {
    if (!(await this.emptyPartition(totalsPartition(life), deadline))) return false;
    if (Date.now() - (await this.removalBegan(life)) < SECOND_SWEEP_MS) return false;
    const emptied: { pk: string; sk: string }[] = [];
    for await (const page of this.partition(callsIndexPartition(life))) {
      for (const entry of page) {
        if (entry.sk === REMOVAL_MARK) continue;
        const whole = await this.emptyPartition(callPartition(life, entry.sk), deadline);
        if (whole) emptied.push({ pk: entry.pk, sk: entry.sk });
        if (!whole || emptied.length === BATCH || Date.now() > deadline)
          await this.deleteAll(emptied.splice(0));
        if (!whole || Date.now() > deadline) return false;
      }
    }
    await this.deleteAll(emptied.splice(0));
    if (!(await this.emptyPartition(factsPartition(life), deadline))) return false;
    await this.deleteAll([{ pk: callsIndexPartition(life), sk: REMOVAL_MARK }]);
    return true;
  }

  /** The moment the removal of a life first found its writers' items
   * gone, kept in the life's list, so the asks of any process read one
   * moment. */
  private async removalBegan(life: string): Promise<number> {
    const now = Date.now();
    const marked = await this.table.documents.send(
      new UpdateCommand({
        TableName: this.table.table,
        Key: { pk: callsIndexPartition(life), sk: REMOVAL_MARK },
        UpdateExpression: 'SET #at = if_not_exists(#at, :now)',
        ExpressionAttributeNames: { '#at': 'at' },
        ExpressionAttributeValues: { ':now': now },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const at = Number((marked.Attributes as { at?: unknown } | undefined)?.at);
    return Number.isFinite(at) ? at : now;
  }

  /** Removes one item, for a proof's reading. */
  async removeItem(pk: string, sk: string): Promise<void> {
    await this.table.documents.send(
      new DeleteCommand({ TableName: this.table.table, Key: { pk, sk } }),
    );
  }
}
