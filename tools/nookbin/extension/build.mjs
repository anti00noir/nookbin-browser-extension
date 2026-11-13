// Build script: bundles the extension into dist/ for Chrome to load.
//
// dist/ contains flat, self-contained files:
// - bundled JS entries (background, content, popup) with sourcemaps
// - verbatim copies of the static assets (manifest, popup pages, fonts)
//
// Chrome's "Load unpacked" must point at dist/, not src/.

import esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(rootDir, 'src');
const distDir = join(rootDir, 'dist');

const watch = process.argv.includes('--watch');

const STATIC_ASSETS = [
  'manifest.json',
  'popup/popup.html',
  'popup/popup.css',
  'fonts',
];

async function copyStaticAssets() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  for (const asset of STATIC_ASSETS) {
    await cp(join(srcDir, asset), join(distDir, asset), { recursive: true });
  }
}

// Re-copy the static assets on every build so watch mode keeps them in sync.
const copyAssetsPlugin = {
  name: 'copy-static-assets',
  setup(build) {
    build.onStart(() => copyStaticAssets());
  },
};

const options = {
  entryPoints: [
    join(srcDir, 'background.js'),
    join(srcDir, 'content.js'),
    join(srcDir, 'popup.js'),
  ],
  outdir: distDir,
  bundle: true,
  format: 'iife',
  sourcemap: true,
  target: ['chrome114'],
  plugins: [copyAssetsPlugin],
  logLevel: 'info',
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(options);
}
