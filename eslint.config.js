// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import reactHooks from 'eslint-plugin-react-hooks';
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
      // The web UI's gateway client, made the same way before every
      // build of the UI by ui/scripts/gateway-client.mjs.
      'ui/src/gateway/**',
      '**/node_modules/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
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
  {
    // The web UI: React's own two rules of hooks beside the workspace's.
    files: ['ui/src/**/*.ts', 'ui/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
