import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import webExtension from 'vite-plugin-web-extension';
import { resolve } from 'node:path';
import { readFileSync, cpSync } from 'node:fs';

const browser = process.env.TARGET_BROWSER ?? 'chrome';
const manifestFile =
  browser === 'firefox' ? 'src/manifest.firefox.json' : 'src/manifest.chrome.json';
const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };

export default defineConfig({
  publicDir: 'public',
  plugins: [
    {
      name: 'copy-locales',
      closeBundle() {
        cpSync('src/_locales', `dist/${browser}/_locales`, { recursive: true });
      },
    },
    vue(),
    webExtension({
      manifest: () => {
        const raw = readFileSync(manifestFile, 'utf-8').replace(
          '__APP_VERSION__',
          pkg.version,
        );
        return JSON.parse(raw) as chrome.runtime.ManifestV3;
      },
      additionalInputs: ['src/offscreen/offscreen.html', 'src/warroom/index.html'],
      disableAutoLaunch: true,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: `dist/${browser}`,
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV !== 'production',
  },
});
