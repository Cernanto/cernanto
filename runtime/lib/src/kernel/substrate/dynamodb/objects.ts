// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The plane's objects in its bucket, an object under `objects/<name>`,
// the name's segments the key's, verbatim; a put is whole or nothing
// by the store's own rule, so a reader never meets a part.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import type { Objects } from '../../substrate.js';
import { noSuchKey } from './table.js';
import type { PlaneTable } from './table.js';

async function getBytes(table: PlaneTable, key: string): Promise<Uint8Array | undefined> {
  try {
    const found = await table.s3.send(new GetObjectCommand({ Bucket: table.bucket, Key: key }));
    if (found.Body === undefined) return undefined;
    return await found.Body.transformToByteArray();
  } catch (error) {
    if (noSuchKey(error)) return undefined;
    throw error;
  }
}

export class S3Objects implements Objects {
  private readonly table: PlaneTable;

  constructor(table: PlaneTable) {
    this.table = table;
  }

  private keyOf(name: string): string {
    const segments = name.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
      throw new Error(`the object name ${name} is refused`);
    return `objects/${name}`;
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    await this.table.s3.send(
      new PutObjectCommand({
        Bucket: this.table.bucket,
        Key: this.keyOf(name),
        Body: Buffer.from(bytes),
      }),
    );
  }

  get(name: string): Promise<Uint8Array | undefined> {
    return getBytes(this.table, this.keyOf(name));
  }

  async has(name: string): Promise<boolean> {
    try {
      await this.table.s3.send(
        new HeadObjectCommand({ Bucket: this.table.bucket, Key: this.keyOf(name) }),
      );
      return true;
    } catch (error) {
      if (noSuchKey(error)) return false;
      throw error;
    }
  }

  async delete(name: string): Promise<void> {
    await this.table.s3.send(
      new DeleteObjectCommand({ Bucket: this.table.bucket, Key: this.keyOf(name) }),
    );
  }
}
