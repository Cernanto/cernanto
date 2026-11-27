// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REGISTRY_INDEX_DEFAULT } from '@cernanto/package-format/browser';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/** The dev plane's gateway, which the dev server passes the API on to. */
const PLANE = 'http://127.0.0.1:7434';

/** The content policy of the built document: scripts from the
 * gateway's own origin and none written inline; styles from it and
 * the ones the editor and the long lists write as they run; the font
 * and the drawings from inside the UI's own files; requests to the
 * gateway, to npm's registry for the search of its packages, and to
 * the Cernanto registry's packages host for the search of its agents. */
const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  `connect-src 'self' https://registry.npmjs.org ${REGISTRY_INDEX_DEFAULT}`,
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Writes the content policy first in the built document's head. The
 * dev server's document carries none, since its hot reload is written
 * inline. */
function contentPolicy(): Plugin {
  return {
    name: 'cernanto-content-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: POLICY },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

/** Writes the logo's mark into the document as the browser tab's icon,
 * inside the document itself: the gateway serves no picture. */
function tabIcon(): Plugin {
  return {
    name: 'cernanto-tab-icon',
    transformIndexHtml: {
      order: 'pre',
      handler: () => {
        const mark = readFileSync(new URL('./src/assets/mark.svg', import.meta.url));
        return [
          {
            tag: 'link',
            attrs: {
              rel: 'icon',
              type: 'image/svg+xml',
              href: `data:image/svg+xml;base64,${mark.toString('base64')}`,
            },
            injectTo: 'head',
          },
        ];
      },
    },
  };
}

/** The script that holds the notices and nothing else: one comment. */
const NOTICES = 'js/third-party-notices.js';
/** Where the two drawings came from whose files do not say it. */
const CREDITS: Record<string, string> = {
  mcp: [
    'The Model Context Protocol mark: official project artwork from the MCP documentation.',
    'https://github.com/modelcontextprotocol/modelcontextprotocol/blob/8a18b4b3292b9f9b3aee73f6325f9f62f19a89f9/docs/logo/dark.svg',
  ].join('\n'),
  openapi: [
    'The OpenAPI Initiative mark, monochrome, from Simple Icons (CC0).',
    'https://openapis.org/style-guide/',
    'https://github.com/simple-icons/simple-icons/blob/develop/icons/openapiinitiative.svg',
  ].join('\n'),
};
const HERE = fileURLToPath(new URL('.', import.meta.url));
const RULE = '='.repeat(72);

/** A package's folder, from the path of one of its modules: what stands
 * after the last `node_modules` on the way, a scope's folder with it. */
function packageFolder(id: string): string | undefined {
  const path = id.replace(/^\0+/, '').replace(/[?#].*$/, '');
  const marker = '/node_modules/';
  const at = path.lastIndexOf(marker);
  if (at < 0) return undefined;
  const [first = '', second = ''] = path.slice(at + marker.length).split('/');
  const name = first.startsWith('@') ? `${first}/${second}` : first;
  return name === '' ? undefined : path.slice(0, at + marker.length) + name;
}

/** Where a package's sources are kept, as its manifest names it. */
function homeOf(pkg: { name: string; repository?: unknown; homepage?: unknown }): string {
  const named =
    typeof pkg.repository === 'string'
      ? pkg.repository
      : typeof (pkg.repository as { url?: unknown } | undefined)?.url === 'string'
        ? (pkg.repository as { url: string }).url
        : undefined;
  if (named !== undefined) {
    return named
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/^github:/, 'https://github.com/')
      .replace(/^([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1')
      .replace(/\.git$/, '');
  }
  return typeof pkg.homepage === 'string'
    ? pkg.homepage
    : `https://www.npmjs.com/package/${pkg.name}`;
}

/** One package's notice: its name and version, the license its manifest
 * names, where it is kept, and each license file it ships, as it lies. */
function noticeOf(folder: string): { key: string; text: string; bare: boolean } | undefined {
  const manifest = join(folder, 'package.json');
  if (!existsSync(manifest)) return undefined;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
    name: string;
    version: string;
    license?: unknown;
    author?: unknown;
    repository?: unknown;
    homepage?: unknown;
  };
  const author =
    typeof pkg.author === 'string'
      ? pkg.author
      : typeof (pkg.author as { name?: unknown } | undefined)?.name === 'string'
        ? (pkg.author as { name: string }).name
        : '';
  const by = author.replace(/\s*[<(].*$/, '').trim();
  const texts = readdirSync(folder)
    .filter((entry) => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(entry))
    .filter((entry) => statSync(join(folder, entry)).isFile())
    .sort()
    .map((entry) => readFileSync(join(folder, entry), 'utf8').replace(/\r\n?/g, '\n').trim());
  const license = typeof pkg.license === 'string' ? pkg.license : 'as its files say';
  return {
    key: `${pkg.name.toLowerCase()} ${pkg.version}`,
    bare: texts.length === 0,
    text: [
      `${pkg.name} ${pkg.version}`,
      `License: ${license}`,
      homeOf(pkg),
      '',
      ...(texts.length === 0
        ? [
            `The package ships no license file${by === '' ? '' : `; its manifest names its author, ${by}`}.`,
          ]
        : texts),
    ].join('\n'),
  };
}

/** THE NOTICES of what the built files carry of other parties: every
 * package a script holds a module of, the stylesheet's own framework,
 * the font and the drawings, each with the license it came under. They
 * ride as a script, a comment and nothing else, since the gateway
 * serves a document, scripts and stylesheets and no fourth kind of
 * file; the document never loads it. The same sources give the same
 * file. */
function thirdPartyNotices(): Plugin {
  return {
    name: 'cernanto-third-party-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      const folders = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of output.moduleIds) {
          const folder = packageFolder(id);
          if (folder !== undefined) folders.add(folder);
        }
      }
      // The stylesheet is made by the framework from the framework's own.
      folders.add(realpathSync(join(HERE, 'node_modules', 'tailwindcss')));
      const notices = [...folders]
        .map((folder) => noticeOf(folder))
        .filter((notice) => notice !== undefined)
        .sort((a, b) => a.key.localeCompare(b.key, 'en'));
      const bare = notices.filter((notice) => notice.bare).map((notice) => notice.key);
      if (bare.length > 0) this.warn(`no license file in: ${bare.join(', ')}`);

      const fonts = join(HERE, 'src', 'assets', 'fonts');
      const font = readFileSync(join(fonts, 'jetbrains-mono-license.txt'), 'utf8')
        .replace(/\r\n?/g, '\n')
        .trim();
      const marks = join(HERE, 'src', 'assets', 'marks');
      const drawings = readdirSync(marks)
        .filter((entry) => entry.endsWith('.svg'))
        .sort()
        .flatMap((entry) => {
          const name = entry.replace(/\.svg$/, '');
          // A drawing says where it came from in its own file, or here.
          const credit =
            /<!--([\s\S]*?)-->/.exec(readFileSync(join(marks, entry), 'utf8'))?.[1] ??
            CREDITS[name];
          if (credit === undefined) return [];
          const lines = credit.replace(/\r\n?/g, '\n').split('\n');
          const indent = Math.min(
            ...lines
              .slice(1)
              .filter((line) => line.trim() !== '')
              .map((line) => line.length - line.trimStart().length),
          );
          const text = lines
            .map((line, at) => (at === 0 ? line.trim() : line.slice(indent)).trimEnd())
            .join('\n')
            .trim();
          return [`${name}\n\n${text}`];
        });

      const body = [
        [
          'THE CERNANTO WEB UI: NOTICES OF WHAT ITS FILES CARRY OF OTHER PARTIES',
          '',
          'The scripts and the stylesheet beside this file hold, built in, the',
          'software, the font and the drawings listed here. Each stays under its',
          'own license, given below as it came.',
        ].join('\n'),
        ...notices.map((notice) => notice.text),
        `JetBrains Mono, the font, two weights of it, inside the stylesheet\n\n${font}`,
        ...drawings.map((drawing) => `The drawing ${drawing}`),
      ].join(`\n\n${RULE}\n\n`);
      this.emitFile({
        type: 'asset',
        fileName: NOTICES,
        // One comment: a text that would close it is kept from closing it.
        source: `/*\n${body.replace(/\*\//g, '* /')}\n*/\n`,
      });
    },
  };
}

// The gateway serves three kinds of file: the document at `/`, the
// scripts under `/ui/js/` and the stylesheets under `/ui/css/`. So the
// build lays its scripts and its stylesheet in those two folders, each
// a file of the folder itself, and carries the font and the drawings
// inside them. The notices of what those files carry of other parties
// ride as one more script.
export default defineConfig({
  base: '/ui/',
  plugins: [react(), tailwindcss(), tabIcon(), contentPolicy(), thirdPartyNotices()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        entryFileNames: 'js/[name]-[hash].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: 'css/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5183,
    strictPort: true,
    proxy: {
      '/v1': PLANE,
      '/healthz': PLANE,
      '/oauth': PLANE,
    },
  },
});
