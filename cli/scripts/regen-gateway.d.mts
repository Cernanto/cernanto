// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

/** The gateway's OpenAPI document, the gateway client's contract. */
export declare const DOCUMENT: string;
/** Where the generated gateway client lives in the cli package. */
export declare const OUTPUT: string;
/** Generates the gateway client into `outDir` (emptied first), the
 * repository's header on every file; answers the directory. */
export declare function regenerateGateway(outDir?: string): Promise<string>;
