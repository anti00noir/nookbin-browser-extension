// Build script: copies the static site into dist/ for hosting.
//
// dist/ is a plain static site: no bundling, no runtime JavaScript required.
// Point any static file server (or host) at dist/.

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const siteDir = join(rootDir, 'site');
const distDir = join(rootDir, 'dist');

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(siteDir, distDir, { recursive: true });
}

await build();
console.log('Site built to dist/');
