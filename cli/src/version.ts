// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { createRequire } from 'node:module';

// The cli's version, what `--version` prints.

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };

export const CLI_VERSION: string = pkg.version ?? '0.0.0';
