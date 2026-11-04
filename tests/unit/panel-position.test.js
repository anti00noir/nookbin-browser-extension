import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../src/lib/panel-position.js', import.meta.url),
  'utf8',
);

function loadGeometry() {
  const sandbox = {};
  const run = new Function('globalThis', source);
  run(sandbox);
  return sandbox.NookBinPanelPosition;
}

const geometry = loadGeometry();

test('exposes the panel geometry helpers', () => {
  assert.equal(typeof geometry.getPanelSize, 'function');
  assert.equal(typeof geometry.getDefaultPosition, 'function');
  assert.equal(typeof geometry.clampPosition, 'function');
  assert.equal(geometry.DEFAULT_WIDTH, 540);
  assert.equal(geometry.DEFAULT_HEIGHT, 600);
});

test('getPanelSize keeps the preferred size when the viewport is large', () => {
  assert.deepEqual(geometry.getPanelSize(1920, 1080), {
    width: 540,
    height: 600,
  });
});

test('getPanelSize shrinks to fit a small viewport', () => {
  assert.deepEqual(geometry.getPanelSize(400, 500), {
    width: 368,
    height: 468,
  });
});

test('getPanelSize never returns a non-positive size', () => {
  assert.deepEqual(geometry.getPanelSize(0, 0), {
    width: 1,
    height: 1,
  });
});

test('getDefaultPosition docks the panel to the right edge', () => {
  const size = geometry.getPanelSize(1920, 1080);
  const position = geometry.getDefaultPosition(1920, 1080, size);

  assert.equal(position.left, 1920 - 540 - 16);
  assert.equal(position.top, (1080 - 600) / 2);
});

test('getDefaultPosition keeps the panel on screen in a small viewport', () => {
  const size = geometry.getPanelSize(400, 500);
  const position = geometry.getDefaultPosition(400, 500, size);

  assert.equal(position.left, 16);
  assert.equal(position.top, 16);
});

test('clampPosition leaves an on-screen position unchanged', () => {
  const size = { width: 540, height: 600 };
  const position = { left: 100, top: 80 };

  assert.deepEqual(geometry.clampPosition(position, 1920, 1080, size), position);
});

test('clampPosition pulls an off-screen position back into view', () => {
  const size = { width: 540, height: 600 };

  assert.deepEqual(geometry.clampPosition({ left: -200, top: -50 }, 1920, 1080, size), {
    left: 8,
    top: 8,
  });

  assert.deepEqual(geometry.clampPosition({ left: 5000, top: 5000 }, 1920, 1080, size), {
    left: 1920 - 540 - 8,
    top: 1080 - 600 - 8,
  });
});

test('clampPosition handles a panel larger than the viewport', () => {
  const size = { width: 800, height: 900 };

  assert.deepEqual(geometry.clampPosition({ left: 100, top: 100 }, 400, 500, size), {
    left: 8,
    top: 8,
  });
});
