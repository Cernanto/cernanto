// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The cloud substrate's one table and one bucket, as every facet
// reaches them: a DynamoDB table with a partition key `pk` and a sort
// key `sk`, both strings, the TTL on `expires`, on-demand billing, every
// kind of item an attribute set on it (the plane's schema is its key
// schema alone); an S3 bucket for the objects. The
// partition is the family: a journal's stream (`j#<stream>`), a record's
// family (`d#<family>`, the key's text up to its first `/`), so a listing is a range read inside one partition and
// never a scan. The identity is the SDK's default chain: the instance
// role through the metadata service on a server, the operator's own
// login in a laptop's proof. A body above the spill goes to the bucket
// by its digest and the item keeps the reference, since DynamoDB bills a
// write per kilobyte and caps an item at 400 KB.

import { createHash } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** The longest text an item carries itself: above it the text rides the
 * bucket and the item keeps its digest. */
const SPILL_BYTES = 64 * 1024;

/** How far past a logical expiry the store's own deletion is set: the
 * reads filter by the moment, the TTL sweeps what nobody reads. */
const TTL_GRACE_SECONDS = 3600;

/** How long a replaced item's object stays for the readers that read
 * the item before it moved on. */
const OBJECT_GRACE_MS = 60_000;

/** What the opener is handed: the region, the table and the bucket. */
export interface DynamoSubstrateOptions {
  region: string;
  table: string;
  bucket: string;
}

/** The clients and the names every facet shares. */
export class PlaneTable {
  readonly table: string;
  readonly bucket: string;
  readonly region: string;
  readonly client: DynamoDBClient;
  readonly documents: DynamoDBDocumentClient;
  readonly s3: S3Client;

  constructor(options: Pick<DynamoSubstrateOptions, 'region' | 'table' | 'bucket'>) {
    this.table = options.table;
    this.bucket = options.bucket;
    this.region = options.region;
    this.client = new DynamoDBClient({ region: options.region });
    this.documents = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.s3 = new S3Client({ region: options.region });
  }

  /** Lets the clients go. */
  close(): void {
    this.documents.destroy();
    this.client.destroy();
    this.s3.destroy();
  }

  /** Puts a text above the spill into the bucket under its digest and
   * answers the digest; a text within it answers nothing. */
  async spill(text: string): Promise<string | undefined> {
    if (Buffer.byteLength(text) <= SPILL_BYTES) return undefined;
    const digest = `sha256:${createHash('sha256').update(text).digest('hex')}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: payloadKey(digest),
        Body: Buffer.from(text),
        ContentType: 'application/json',
      }),
    );
    return digest;
  }

  /** Reads a spilled text back by its digest. */
  async unspill(digest: string): Promise<string> {
    const found = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: payloadKey(digest) }),
    );
    if (found.Body === undefined) throw new Error(`the payload ${digest} is gone from the bucket`);
    return Buffer.from(await found.Body.transformToByteArray()).toString('utf8');
  }

  /** Puts a text above the spill as an object under the key given and
   * answers the key; a text within the spill answers nothing. A record's
   * or a message's text rides this way, under a key of its own, so it
   * leaves with its item. */
  async spillText(objectKey: string, text: string): Promise<string | undefined> {
    if (Buffer.byteLength(text) <= SPILL_BYTES) return undefined;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: Buffer.from(text),
        ContentType: 'text/plain; charset=utf-8',
      }),
    );
    return objectKey;
  }

  /** Reads a text object back; nothing when it is gone. */
  async getText(objectKey: string): Promise<string | undefined> {
    try {
      const found = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      if (found.Body === undefined) return undefined;
      return Buffer.from(await found.Body.transformToByteArray()).toString('utf8');
    } catch (error) {
      if (noSuchKey(error)) return undefined;
      throw error;
    }
  }

  /** Removes a text object; the item it rode with is gone or moved on,
   * and a failure here leaves an object nobody reads. */
  deleteObject(objectKey: string): void {
    void this.s3
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }))
      .catch(() => undefined);
  }

  /** Removes a text object a minute from now: the item moved on, and a
   * reader that read it before the move still finds the object it
   * named. A process that ends first leaves the object, garbage and
   * nothing worse. */
  deleteObjectLater(objectKey: string): void {
    setTimeout(() => {
      this.deleteObject(objectKey);
    }, OBJECT_GRACE_MS).unref();
  }
}

/** The object a spilled journal record's text rides under: its digest
 * among the payloads. */
function payloadKey(digest: string): string {
  return `payloads/${digest}`;
}

/** Whether an error is DynamoDB's refusal of a condition. */
export function conditionFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { name?: unknown }).name === 'ConditionalCheckFailedException' ||
      (error as { name?: unknown }).name === 'TransactionCanceledException')
  );
}

/** Whether an error is DynamoDB's word for a transaction that met
 * another on one of its items: nothing of what it asked is known, and
 * the items say what stands. DynamoDB says it two ways: a single write's
 * own exception, or a transaction cancelled with a conflict among its
 * reasons and no condition refused. */
export function transactionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, CancellationReasons: reasons } = error as {
    name?: unknown;
    CancellationReasons?: { Code?: string }[];
  };
  if (name === 'TransactionConflictException') return true;
  if (name !== 'TransactionCanceledException' || reasons === undefined) return false;
  const codes = reasons.map((reason) => reason.Code);
  return codes.includes('TransactionConflict') && !codes.includes('ConditionalCheckFailed');
}

/** Whether an error is S3's word for an object that is not there. */
export function noSuchKey(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, $metadata } = error as { name?: unknown; $metadata?: { httpStatusCode?: number } };
  return name === 'NoSuchKey' || name === 'NotFound' || $metadata?.httpStatusCode === 404;
}

/** The sort key of a journal record at a position: fixed width, so the
 * range read orders them. */
export function positionKey(position: number): string {
  return `r${String(position).padStart(12, '0')}`;
}

/** The position a journal record's sort key names. */
export function positionOf(sortKey: string): number {
  return Number(sortKey.slice(1));
}

/** The family of a record's key: its text up to the first slash. */
export function familyOf(key: string): string {
  const first = key.indexOf('/');
  return first === -1 ? key : key.slice(0, first);
}

/** The partition of a record. */
export function recordPartition(key: string): string {
  return `d#${familyOf(key)}`;
}

/** The moment as the TTL attribute spells it: seconds, past the grace. */
export function ttlOf(expiresAtMs: number): number {
  return Math.floor(expiresAtMs / 1000) + TTL_GRACE_SECONDS;
}
