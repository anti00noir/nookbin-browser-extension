// Build script: copies the static site into dist/ for hosting and renders
// the tool roster (site/data/tools.js) into the page.
//
// dist/ is a plain static site: no runtime JavaScript required. Point any
// static file server (or host) at dist/.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tools } from './site/data/tools.js';

const rootDir = dirname(fileURLToPath(import.meta.url));
const siteDir = join(rootDir, 'site');
const distDir = join(rootDir, 'dist');

const watchMode = process.argv.includes('--watch');

const TOOLS_MARKER = '<!-- tool-cards -->';

function badgeHtml(tool) {
  if (tool.status === 'shipped') {
    const version = tool.version ? ` \u00b7 v${tool.version}` : '';
    return `<span class="badge is-shipped">Shipped${version}</span>`;
  }
  return `<span class="badge is-planned">Planned</span>`;
}

function toolCardHtml(tool) {
  const targets = tool.targets.join(' \u00b7 ');

  return [
    `      <article class="tool-card" id="${tool.id}">`,
    `        <div class="tool-head">`,
    `          <h3 class="tool-name">${tool.name}</h3>`,
    `          ${badgeHtml(tool)}`,
    `        </div>`,
    `        <p class="tool-tagline">${tool.tagline}</p>`,
    `        <p class="tool-description">${tool.description}</p>`,
    `        <p class="tool-targets">${targets}</p>`,
    `      </article>`,
  ].join('\n');
}

function renderToolCards(html) {
  return html.replace(TOOLS_MARKER, tools.map(toolCardHtml).join('\n'));
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(siteDir, distDir, { recursive: true });

  const indexPath = join(distDir, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  await writeFile(indexPath, renderToolCards(html));
}

if (watchMode) {
  await build();
  console.log('Watching for changes...');

  let timer = null;
  watch(siteDir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      build().catch((error) => console.error(error));
    }, 50);
  });
} else {
  await build();
  console.log('Site built to dist/');
}
