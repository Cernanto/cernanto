// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The logs on DynamoDB: the log is a partition under its life
// (`l#<life>/<log>`), the head the item at `sk` 0, a row an item at its
// position zero-padded; the append one transactional write of two items
// (the head's conditional update, the row's put on its key's absence),
// the read a query by range, the truncation the head's update and a
// batch of deletes, the retirement a transaction per batch of deletes
// with the head's condition in each. A head is made only while the
// name's record names the life, in one transaction with the record's
// check. A text above the spill rides the bucket under the row's own
// key and the item keeps the reference, so the text leaves with its row
// and with no other's. The head is deleted at its life's end alone,
// before its rows; an index partition names every log ever issued, by
// its life, for the listing by prefix and the removal.

import { setTimeout as sleep } from 'node:timers/promises';

import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { freshUUID } from '../../entropy.js';
import { LifeEnded, LogRefusal, isLogType, lifeKey } from '../../substrate.js';
import type { CapturedHead, LogHead, LogRow, LogType, Logs } from '../../substrate.js';
import {
  conditionFailed,
  positionKey,
  positionOf,
  recordPartition,
  transactionConflict,
} from './table.js';
import type { PlaneTable } from './table.js';

/** The object a spilled row's text rides under: this write's own,
 * named by the position and a nonce of the write, so two writers at
 * one position (a holder superseded and the owner) never write over
 * each other's text, and the object leaves with its row and with no
 * other's. */
function rowObjectKey(log: string, seq: number): string {
  return `logs/${log}/${positionKey(seq)}-${freshUUID()}`;
}

/** The partition of a log of a life. */
export function logPartition(log: string, life: string): string {
  return `l#${life}/${log}`;
}

/** The sort key of the head: position 0. */
export const LOG_HEAD_SK = positionKey(0);

/** The partition of the index of every log ever issued. */
export const LOGS_INDEX = 'l-index';

/** How many deletions one batch carries. */
const BATCH = 25;

/** How many deletions ride one transaction beside the head's condition. */
const TRANSACTION_DELETES = 99;

/** How many heads one batch get reads. */
const HEADS_PER_GET = 100;

/** How many times an append cancelled by another transaction, with the
 * head where it expects it, is asked again, and the least it waits
 * first (each waits up to 50 ms more, by a draw of its own, so two
 * writers that met part). */
const CONFLICT_ROUNDS = 5;
const CONFLICT_PAUSE_MS = 10;

interface HeadItem {
  owner?: string;
  launch?: number;
  issued?: number;
  last?: number;
  floor?: number;
}

interface RowItem {
  pk: string;
  sk: string;
  type: string;
  at: number;
  body?: string;
  ref?: string;
}

/** The attribute names an expression spells by placeholders (several
 * of the head's fields are DynamoDB's reserved words), the ones the
 * expression uses alone: an unused placeholder is refused. */
function namesOf(
  ...fields: ('owner' | 'launch' | 'issued' | 'last' | 'floor')[]
): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [`#${field}`, field]));
}

function headOf(item: HeadItem | undefined): LogHead | undefined {
  if (item === undefined) return undefined;
  return {
    owner: item.owner ?? '',
    launch: item.launch ?? 0,
    issued: item.issued ?? 0,
    last: item.last ?? 0,
    floor: item.floor ?? 0,
  };
}

export class DynamoLogs implements Logs {
  private readonly table: PlaneTable;
  private readonly life: string;

  /** The logs of one life. */
  constructor(table: PlaneTable, life: string) {
    this.table = table;
    this.life = life;
  }

  private pk(log: string): string {
    return logPartition(log, this.life);
  }

  private key(log: string): { pk: string; sk: string } {
    return { pk: this.pk(log), sk: LOG_HEAD_SK };
  }

  private async head(log: string): Promise<LogHead | undefined> {
    const found = await this.table.documents.send(
      new GetCommand({ TableName: this.table.table, Key: this.key(log), ConsistentRead: true }),
    );
    return headOf(found.Item as HeadItem | undefined);
  }

  async issue(log: string): Promise<number> {
    for (let round = 1; round <= 5; round += 1) {
      try {
        const updated = await this.table.documents.send(
          new UpdateCommand({
            TableName: this.table.table,
            Key: this.key(log),
            UpdateExpression: 'SET #issued = #issued + :one',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeNames: namesOf('issued'),
            ExpressionAttributeValues: { ':one': 1 },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return headOf(updated.Attributes as HeadItem | undefined)?.issued ?? 0;
      } catch (error) {
        if (!conditionFailed(error)) throw error;
      }
      // A new log: its head is made, issued its first grant, and the
      // index names it, in one write and only while the name's record
      // names this life, so an ended life gains no entry the removal
      // will not come back for.
      const service = log.slice(0, Math.max(0, log.indexOf('/')));
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
                  ExpressionAttributeValues: { ':life': `"life":"${this.life}"` },
                },
              },
              {
                Put: {
                  TableName: this.table.table,
                  Item: { ...this.key(log), owner: '', launch: 0, issued: 1, last: 0, floor: 0 },
                  ConditionExpression: 'attribute_not_exists(pk)',
                },
              },
              {
                Put: {
                  TableName: this.table.table,
                  Item: { pk: LOGS_INDEX, sk: `${this.life}/${log}`, at: Date.now() },
                },
              },
            ],
          }),
        );
        return 1;
      } catch (error) {
        const reasons = (error as { CancellationReasons?: { Code?: string }[] } | undefined)
          ?.CancellationReasons;
        if (reasons?.[0]?.Code === 'ConditionalCheckFailed')
          throw new LifeEnded(service, this.life);
        if (!conditionFailed(error)) throw error;
        // Made meanwhile by another issuer: the update is asked again.
      }
    }
    throw new Error(`the head of ${log} could not be made or moved`);
  }

  /** Removes every log of this life, one log at a time: its head first,
   * so no append and no grant lands behind the removal, then its rows,
   * page by page, then its entry in the index, so an ask the budget cuts
   * goes on from the first log still listed. Answers whether nothing is
   * left within the budget. */
  async removeAll(deadline: number): Promise<boolean> {
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': LOGS_INDEX, ':prefix': `${this.life}/` },
          ConsistentRead: true,
          ProjectionExpression: 'sk',
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      for (const item of page.Items ?? []) {
        const entry = (item as { sk: string }).sk;
        const log = entry.slice(this.life.length + 1);
        await this.table.documents.send(
          new DeleteCommand({ TableName: this.table.table, Key: this.key(log) }),
        );
        if (!(await this.emptyRows(log, deadline))) return false;
        await this.table.documents.send(
          new DeleteCommand({ TableName: this.table.table, Key: { pk: LOGS_INDEX, sk: entry } }),
        );
        if (Date.now() > deadline) return false;
      }
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return true;
  }

  /** Deletes a log's rows a page at a time within the budget; answers
   * whether none is left. */
  private async emptyRows(log: string, deadline: number): Promise<boolean> {
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.table,
          KeyConditionExpression: 'pk = :pk AND sk >= :from',
          ExpressionAttributeValues: { ':pk': this.pk(log), ':from': positionKey(1) },
          ConsistentRead: true,
          ProjectionExpression: 'pk, sk, #ref',
          ExpressionAttributeNames: { '#ref': 'ref' },
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      await this.deleteItems((page.Items ?? []) as RowItem[]);
      start = page.LastEvaluatedKey;
      if (start !== undefined && Date.now() > deadline) return false;
    } while (start !== undefined);
    return true;
  }

  async own(log: string, attempt: string, launch: number): Promise<LogHead> {
    try {
      const updated = await this.table.documents.send(
        new UpdateCommand({
          TableName: this.table.table,
          Key: this.key(log),
          UpdateExpression: 'SET #owner = :attempt, #launch = :launch',
          ConditionExpression:
            'attribute_exists(pk) AND ((#owner = :attempt AND #launch = :launch) OR (#launch < :launch AND #issued >= :launch))',
          ExpressionAttributeNames: namesOf('owner', 'launch', 'issued'),
          ExpressionAttributeValues: { ':attempt': attempt, ':launch': launch },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const head = headOf(updated.Attributes as HeadItem | undefined);
      if (head === undefined) throw new Error(`the head of ${log} answered nothing`);
      return head;
    } catch (error) {
      if (!conditionFailed(error)) throw error;
      const head = await this.head(log);
      throw new LogRefusal(
        'grant',
        head === undefined
          ? `the log ${log} issued no grant: nothing owns it`
          : `the grant ${String(launch)} cannot take the log ${log}: its owner holds ${String(head.launch)} and ${String(head.issued)} were issued`,
        head,
      );
    }
  }

  async append(
    log: string,
    attempt: string,
    seq: number,
    type: LogType,
    text: string,
  ): Promise<void> {
    const ref = await this.table.spillText(rowObjectKey(log, seq), text);
    const item: RowItem = {
      pk: this.pk(log),
      sk: positionKey(seq),
      type,
      at: Date.now(),
      ...(ref === undefined ? { body: text } : { ref }),
    };
    for (let round = 1; ; round += 1) {
      try {
        await this.table.documents.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: this.table.table,
                  Key: this.key(log),
                  UpdateExpression: 'SET #last = :seq',
                  ConditionExpression: '#owner = :attempt AND #last = :prev AND #floor < :seq',
                  ExpressionAttributeNames: namesOf('last', 'owner', 'floor'),
                  ExpressionAttributeValues: { ':seq': seq, ':prev': seq - 1, ':attempt': attempt },
                },
              },
              {
                Put: {
                  TableName: this.table.table,
                  Item: item,
                  ConditionExpression: 'attribute_not_exists(sk)',
                },
              },
            ],
          }),
        );
        return;
      } catch (error) {
        // A condition refused, or a transaction that met another on the
        // head (two writers at one position): the head says which.
        if (!conditionFailed(error) && !transactionConflict(error)) throw error;
        if (transactionConflict(error) && round < CONFLICT_ROUNDS) {
          // Cancelled by another with the head still where this write
          // expects it: neither landed, so the same write is asked again
          // after a pause of its own, its text's object kept for it.
          const standing = await this.head(log);
          if (standing?.owner === attempt && standing.last === seq - 1 && seq > standing.floor) {
            await sleep(CONFLICT_PAUSE_MS + (Number.parseInt(freshUUID().slice(0, 2), 16) % 50));
            continue;
          }
        }
        await this.refused(log, attempt, seq, ref, error);
      }
    }
  }

  /** What a refused append answers: the head says whether another
   * writer owns the log or moved it; a conflict with the head where the
   * write expects it is answered in the store's own words, its outcome
   * unknown. Always throws. */
  private async refused(
    log: string,
    attempt: string,
    seq: number,
    ref: string | undefined,
    error: unknown,
  ): Promise<never> {
    // The SDK's own retry of the transaction carries this very item, so
    // a first try that landed with its answer lost references this
    // write's object: it leaves only when the row at the position
    // references no such object.
    if (ref !== undefined) {
      const standing = await this.table.documents.send(
        new GetCommand({
          TableName: this.table.table,
          Key: { pk: this.pk(log), sk: positionKey(seq) },
          ConsistentRead: true,
        }),
      );
      if ((standing.Item as RowItem | undefined)?.ref !== ref) this.table.deleteObjectLater(ref);
    }
    const head = await this.head(log);
    if (head === undefined || head.owner !== attempt)
      throw new LogRefusal(
        'owner',
        `the log ${log} is owned by ${head?.owner ?? 'nobody'}, not by ${attempt}`,
        head,
      );
    if (head.last === seq - 1 && seq > head.floor && transactionConflict(error)) throw error;
    throw new LogRefusal(
      'moved',
      `the log ${log} stands at ${String(head.last)} (floor ${String(head.floor)}), not at ${String(seq - 1)}`,
      head,
    );
  }

  /** A spilled row's text, read back by the key the row names. */
  private async spilledText(item: RowItem): Promise<string> {
    const text = item.ref === undefined ? undefined : await this.table.getText(item.ref);
    if (text === undefined)
      throw new Error(`the text of the row ${item.pk}/${item.sk} is gone from the bucket`);
    return text;
  }

  /** Every row item at and above a position, in order. */
  private async itemsFrom(log: string, from: number, keysAlone = false): Promise<RowItem[]> {
    const items: RowItem[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.table,
          KeyConditionExpression: 'pk = :pk AND sk >= :from',
          ExpressionAttributeValues: {
            ':pk': this.pk(log),
            ':from': positionKey(Math.max(from, 1)),
          },
          ConsistentRead: true,
          ...(keysAlone
            ? { ProjectionExpression: 'pk, sk, #ref', ExpressionAttributeNames: { '#ref': 'ref' } }
            : {}),
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      for (const item of page.Items ?? []) items.push(item as RowItem);
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return items;
  }

  private async rowOf(item: RowItem): Promise<LogRow> {
    const text = item.body ?? (item.ref === undefined ? '{}' : await this.spilledText(item));
    if (!isLogType(item.type)) throw new Error(`the row ${item.sk} of ${item.pk} carries no type`);
    return { seq: positionOf(item.sk), type: item.type, text };
  }

  async read(log: string, from: number): Promise<{ head: LogHead | undefined; rows: LogRow[] }> {
    const head = await this.head(log);
    if (head === undefined) return { head: undefined, rows: [] };
    const items = await this.itemsFrom(log, Math.max(from, head.floor));
    const rows: LogRow[] = [];
    for (const item of items) rows.push(await this.rowOf(item));
    return { head, rows };
  }

  async truncate(log: string, attempt: string, below: number): Promise<void> {
    try {
      await this.table.documents.send(
        new UpdateCommand({
          TableName: this.table.table,
          Key: this.key(log),
          UpdateExpression: 'SET #floor = :below',
          ConditionExpression: '#owner = :attempt AND #floor < :below',
          ExpressionAttributeNames: namesOf('floor', 'owner'),
          ExpressionAttributeValues: { ':attempt': attempt, ':below': below },
        }),
      );
    } catch (error) {
      if (!conditionFailed(error)) throw error;
      const head = await this.head(log);
      if (head === undefined || head.owner !== attempt)
        throw new LogRefusal(
          'owner',
          `the log ${log} is owned by ${head?.owner ?? 'nobody'}, not by ${attempt}`,
          head,
        );
      // The floor stands at or past the position: nothing to move.
      return;
    }
    // The floor moved first, so a stale append below it is refused from
    // here on; the rows beneath it leave after, in batches, and a
    // truncation cut short leaves them below the floor, invisible,
    // garbage the next truncation takes.
    const keys = (await this.itemsFrom(log, 1, true)).filter((item) => positionOf(item.sk) < below);
    await this.deleteItems(keys);
  }

  /** Deletes row items in batches, their texts in the bucket a minute
   * later, so a reader that read a row before still finds its text. */
  private async deleteItems(items: readonly RowItem[]): Promise<void> {
    for (let at = 0; at < items.length; at += BATCH) {
      let requests = items
        .slice(at, at + BATCH)
        .map((item) => ({ DeleteRequest: { Key: { pk: item.pk, sk: item.sk } } }));
      while (requests.length > 0) {
        const written = await this.table.documents.send(
          new BatchWriteCommand({ RequestItems: { [this.table.table]: requests } }),
        );
        const left = written.UnprocessedItems?.[this.table.table] ?? [];
        requests = left as typeof requests;
      }
    }
    for (const item of items) if (item.ref !== undefined) this.table.deleteObjectLater(item.ref);
  }

  async retire(log: string, captured: CapturedHead): Promise<boolean> {
    const head = await this.head(log);
    if (head === undefined || head.launch !== captured.launch || head.last !== captured.last)
      return false;
    const items = (await this.itemsFrom(log, 1, true)).filter(
      (item) => positionOf(item.sk) <= captured.last,
    );
    // Each batch of deletes rides a transaction with the head's
    // condition: a replacement that acquired the log meanwhile has moved
    // its launch, an append its last, and nothing newly accepted is
    // erased. The head's floor moves to the captured last with the
    // first batch, so a read meanwhile finds nothing below it.
    const check = {
      Update: {
        TableName: this.table.table,
        Key: this.key(log),
        UpdateExpression: 'SET #floor = :last',
        ConditionExpression: '#launch = :launch AND #last = :last',
        ExpressionAttributeNames: namesOf('floor', 'launch', 'last'),
        ExpressionAttributeValues: { ':launch': captured.launch, ':last': captured.last },
      },
    };
    const batches: RowItem[][] = [];
    for (let at = 0; at < items.length; at += TRANSACTION_DELETES)
      batches.push(items.slice(at, at + TRANSACTION_DELETES));
    if (batches.length === 0) batches.push([]);
    for (const batch of batches) {
      try {
        await this.table.documents.send(
          new TransactWriteCommand({
            TransactItems: [
              check,
              ...batch.map((item) => ({
                Delete: { TableName: this.table.table, Key: { pk: item.pk, sk: item.sk } },
              })),
            ],
          }),
        );
      } catch (error) {
        if (!conditionFailed(error)) throw error;
        return false;
      }
      for (const item of batch) if (item.ref !== undefined) this.table.deleteObjectLater(item.ref);
    }
    return true;
  }

  async list(prefix: string): Promise<{ log: string; head: LogHead }[]> {
    const names: string[] = [];
    const ofLife = `${this.life}/`;
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': LOGS_INDEX, ':prefix': `${ofLife}${prefix}` },
          ProjectionExpression: 'sk',
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      for (const item of page.Items ?? [])
        names.push((item as { sk: string }).sk.slice(ofLife.length));
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
    const found: { log: string; head: LogHead }[] = [];
    for (let at = 0; at < names.length; at += HEADS_PER_GET) {
      const batch = names.slice(at, at + HEADS_PER_GET);
      let keys = batch.map((log) => this.key(log));
      while (keys.length > 0) {
        const read = await this.table.documents.send(
          new BatchGetCommand({
            RequestItems: { [this.table.table]: { Keys: keys, ConsistentRead: true } },
          }),
        );
        for (const item of read.Responses?.[this.table.table] ?? []) {
          const head = headOf(item as HeadItem);
          const pk = (item as { pk: string }).pk;
          if (head !== undefined)
            found.push({ log: pk.slice(logPartition('', this.life).length), head });
        }
        keys = (read.UnprocessedKeys?.[this.table.table]?.Keys ?? []) as typeof keys;
      }
    }
    return found;
  }

  async count(log: string, from: number): Promise<number> {
    const head = await this.head(log);
    if (head === undefined) return 0;
    let count = 0;
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.table,
          KeyConditionExpression: 'pk = :pk AND sk >= :from',
          ExpressionAttributeValues: {
            ':pk': this.pk(log),
            ':from': positionKey(Math.max(from, head.floor, 1)),
          },
          Select: 'COUNT',
          ConsistentRead: true,
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      count += page.Count ?? 0;
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return count;
  }
}
