// Pure geometry helpers for the floating NookBin panel.
//
// Dependency-free and target-agnostic: plain functions that can be imported
// by the bundled content script and unit tested under Node.

export const DEFAULT_WIDTH = 540;
export const DEFAULT_HEIGHT = 600;
export const VIEWPORT_MARGIN = 16;
export const EDGE_MARGIN = 8;

export function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function getPanelSize(viewportWidth, viewportHeight) {
  return {
    width: Math.max(
      1,
      Math.min(DEFAULT_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2),
    ),
    height: Math.max(
      1,
      Math.min(DEFAULT_HEIGHT, viewportHeight - VIEWPORT_MARGIN * 2),
    ),
  };
}

export function getDefaultPosition(viewportWidth, viewportHeight, size) {
  return {
    left: Math.max(VIEWPORT_MARGIN, viewportWidth - size.width - VIEWPORT_MARGIN),
    top: Math.max(VIEWPORT_MARGIN, (viewportHeight - size.height) / 2),
  };
}

export function clampPosition(position, viewportWidth, viewportHeight, size) {
  const maxLeft = Math.max(EDGE_MARGIN, viewportWidth - size.width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, viewportHeight - size.height - EDGE_MARGIN);

  return {
    left: clamp(position.left, EDGE_MARGIN, maxLeft),
    top: clamp(position.top, EDGE_MARGIN, maxTop),
  };
}
