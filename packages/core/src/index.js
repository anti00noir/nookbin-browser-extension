// @nooksuite/core — target-agnostic logic shared across the suite's tools.

export {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  VIEWPORT_MARGIN,
  EDGE_MARGIN,
  clamp,
  getPanelSize,
  getDefaultPosition,
  clampPosition,
} from './panel-position.js';

import { createFileStorage } from './file-storage.js';
import { openIdbFileStorage } from './backends/idb-file-storage.js';

export * from './panel-position.js';
export { createFileStorage };
export { openIdbFileStorage };

/**
 * Open a file store backed by IndexedDB, with the shared validation applied.
 *
 * @param {{ name?: string }} [options]
 */
export async function getFileStorage(options) {
  return createFileStorage(await openIdbFileStorage(options));
}
