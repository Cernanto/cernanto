// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Generated and vendored trees: everything here is machine
    // output, and leaving it unignored buries editors and root
    // sweeps in noise the per-package lints rightly never see.
    ignores: [
      '**/dist/**',
      // The cli's gateway client, generated from the gateway's OpenAPI
      // document by cli/scripts/regen-gateway.mjs: the engine's style, not ours.
      'cli/src/gateway/**',
      '**/node_modules/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'describe', 'it'] },
          ],
        },
      ],
    },
  },
);
