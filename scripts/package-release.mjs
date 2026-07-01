#!/usr/bin/env node
/**
 * Package dist/chrome and dist/firefox into versioned zip files under release/.
 */

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from 'zip-a-folder';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const { version, name } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const releaseDir = resolve(root, 'release');
const targets = [
  { browser: 'chrome', source: resolve(root, 'dist/chrome') },
  { browser: 'firefox', source: resolve(root, 'dist/firefox') },
];

mkdirSync(releaseDir, { recursive: true });

for (const { browser, source } of targets) {
  if (!existsSync(source)) {
    console.error(`Missing build output: ${source}`);
    console.error(`Run npm run build:${browser} first.`);
    process.exit(1);
  }

  const zipName = `${name}-${version}-${browser}.zip`;
  const zipPath = resolve(releaseDir, zipName);
  await zip(source, zipPath);
  console.log(`Created ${zipPath}`);
}
