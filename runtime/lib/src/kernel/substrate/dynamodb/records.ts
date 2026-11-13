// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The records on DynamoDB: a record's family is its partition and its
// key the sort key, the compare-and-set a conditional put on the value
// that stands (or on the key's absence), the removal a conditional
// delete, the listing a range read inside the family. Nothing reads
// the table on a clock.
// A value above the spill rides the bucket under a key of the record's
// own and its revision (the item keeps the key), since DynamoDB caps an
// item at 400 KB and bills a write per kilobyte: a claim's arguments
// and a stored answer are such values; the object leaves with the write
// that moves the record on, and a write the store did not answer
// leaves its object (the store may still land the write after the
// answer was lost), garbage and nothing worse. Every write marks its
// item with a nonce of its own, and a write conditioned on what stood
// names that nonce beside the revision, so a key removed and made anew
// never takes a write conditioned on what stood before; a write the
// store refused reads its item once more before its object goes, since
// the SDK asks a write again when an answer was lost and the first ask
// may have landed, and an item carrying the write's nonce is the write
// landed.

import { freshUUID } from '../../entropy.js';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { RecordRead, Records } from '../../substrate.js';
import { conditionFailed, familyOf, recordPartition } from './table.js';
import type { PlaneTable } from './table.js';

interface RecordItem {
  pk: string;
  sk: string;
  /** The value, when it is within the spill. */
  value?: string;
  /** The key of the object that holds the value, above the spill. */
  ref?: string;
  revision: number;
  /** A mark of the write that made the item: what a write conditioned
   * on the item names beside the revision. */
  nonce?: string;
}

/** The object a spilled value rides under: the record's key, the
 * revision the value lands at and a nonce of this write's own, so two
 * writers racing at one revision never share an object and a refused
 * write's cleanup never removes the landed one's. */
function objectOf(key: string, revision: number): string {
  return `records/${key}/${String(revision)}/${freshUUID()}`;
}

/** The condition a write rests on: the key's absence, or the item that
 * stood when the value was read, by its revision and its nonce (an item
 * from before the nonce by its revision alone). */
function standingCondition(standing: RecordItem | undefined): string {
  if (standing === undefined) return 'attribute_not_exists(sk)';
  return standing.nonce === undefined
    ? 'revision = :revision AND attribute_not_exists(nonce)'
    : 'revision = :revision AND nonce = :nonce';
}

/** The values the standing condition names. */
function standingValues(standing: RecordItem): Record<string, unknown> {
  return {
    ':revision': standing.revision,
    ...(standing.nonce === undefined ? {} : { ':nonce': standing.nonce }),
  };
}

/** How long a refused write's object stays before the item is read
 * again and the object let go. */
const OBJECT_RELEASE_MS = 60_000;

export class DynamoRecords implements Records {
  private readonly table: PlaneTable;

  constructor(table: PlaneTable) {
    this.table = table;
  }

  private key(key: string): { pk: string; sk: string } {
    return { pk: recordPartition(key), sk: key };
  }

  private async item(key: string): Promise<RecordItem | undefined> {
    const found = await this.table.documents.send(
      new GetCommand({ TableName: this.table.table, Key: this.key(key), ConsistentRead: true }),
    );
    return found.Item as RecordItem | undefined;
  }

  /** The value of an item, following its object when spilled; nothing
   * when the object is gone, which is an item that moved on since it
   * was read. */
  private async textOf(item: RecordItem): Promise<string | undefined> {
    if (item.value !== undefined) return item.value;
    if (item.ref === undefined) return '';
    return this.table.getText(item.ref);
  }

  /** The value of an item as it stands: when the object its read
   * named is gone, the item is read again and followed once more. */
  private async standing(
    item: RecordItem,
  ): Promise<{ value: string; revision: number } | undefined> {
    const text = await this.textOf(item);
    if (text !== undefined) return { value: text, revision: item.revision };
    const again = await this.item(item.sk);
    if (again === undefined) return undefined;
    const second = await this.textOf(again);
    if (second === undefined)
      throw new Error(`the record ${item.sk} names an object that is gone from the bucket`);
    return { value: second, revision: again.revision };
  }

  async read(key: string): Promise<RecordRead> {
    const item = await this.item(key);
    if (item === undefined) return { value: null, revision: 0 };
    const current = await this.standing(item);
    return current ?? { value: null, revision: item.revision };
  }

  /** What stands under a key for a write's comparison: the item and its
   * value, or no value when none stands. */
  private async current(
    key: string,
  ): Promise<{ item: RecordItem | undefined; value: string | null; revision: number }> {
    const item = await this.item(key);
    if (item === undefined) return { item, value: null, revision: 0 };
    const standing = await this.standing(item);
    if (standing === undefined) return { item, value: null, revision: item.revision };
    return { item, value: standing.value, revision: standing.revision };
  }

  async write(
    key: string,
    value: string | null,
    expected: string | null,
  ): Promise<{ ok: boolean; current: RecordRead }> {
    const found = await this.current(key);
    if (found.value !== expected)
      return { ok: false, current: { value: found.value, revision: found.revision } };
    const standing = found.item;
    const revision = (standing?.revision ?? 0) + 1;
    if (value === null) {
      if (standing === undefined) return { ok: true, current: { value: null, revision: 0 } };
      try {
        await this.table.documents.send(
          new DeleteCommand({
            TableName: this.table.table,
            Key: this.key(key),
            ConditionExpression: standingCondition(standing),
            ExpressionAttributeValues: standingValues(standing),
          }),
        );
      } catch (error) {
        if (!conditionFailed(error)) throw error;
        // A refusal after the SDK asked again: the first ask may have
        // removed the item, and the key is absent either way.
        if ((await this.item(key)) === undefined)
          return { ok: true, current: { value: null, revision } };
        return { ok: false, current: await this.read(key) };
      }
      if (standing.ref !== undefined) this.table.deleteObjectLater(standing.ref);
      return { ok: true, current: { value: null, revision } };
    }
    const ref = await this.table.spillText(objectOf(key, revision), value);
    const nonce = freshUUID();
    try {
      await this.table.documents.send(
        new PutCommand({
          TableName: this.table.table,
          Item: {
            ...this.key(key),
            ...(ref === undefined ? { value } : { ref }),
            revision,
            nonce,
          },
          ConditionExpression: standingCondition(standing),
          ...(standing === undefined
            ? {}
            : { ExpressionAttributeValues: standingValues(standing) }),
        }),
      );
    } catch (error) {
      // An outcome the store did not say leaves the object: the write
      // may land after the answer was lost, naming it.
      if (!conditionFailed(error)) throw error;
      // A refusal after the SDK asked again: the first ask may have
      // landed, and the item then carries this write's nonce.
      if ((await this.item(key))?.nonce === nonce) {
        if (standing?.ref !== undefined) this.table.deleteObjectLater(standing.ref);
        return { ok: true, current: { value, revision } };
      }
      if (ref !== undefined) this.releaseUnnamedLater(key, ref);
      return { ok: false, current: await this.read(key) };
    }
    if (standing?.ref !== undefined) this.table.deleteObjectLater(standing.ref);
    return { ok: true, current: { value, revision } };
  }

  /** Lets go of an object a refused write put, a minute later and only
   * when the item does not name it by then: an ask the SDK made again
   * after a lost answer may have landed, and lands no later than that. */
  private releaseUnnamedLater(key: string, ref: string): void {
    const timer = setTimeout(() => {
      void this.item(key)
        .then((item) => {
          if (item?.ref !== ref) this.table.deleteObject(ref);
        })
        .catch(() => undefined);
    }, OBJECT_RELEASE_MS);
    timer.unref();
  }

  async list(
    prefix: string,
  ): Promise<{ entries: { key: string; value: string; revision: number }[] }> {
    const found: RecordItem[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.table.documents.send(
        new QueryCommand({
          TableName: this.table.table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': `d#${familyOf(prefix)}`, ':prefix': prefix },
          ConsistentRead: true,
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      for (const item of page.Items ?? []) found.push(item as RecordItem);
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
    const read = await Promise.all(
      found.map(async (item) => {
        const standing = await this.standing(item);
        return standing === undefined ? undefined : { key: item.sk, ...standing };
      }),
    );
    const entries = read.filter((entry) => entry !== undefined);
    entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { entries };
  }
}
