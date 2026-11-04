// Pure geometry helpers for the floating NookBin panel.
//
// This is a classic script because Chrome content scripts cannot use ES
// modules. It exposes its API on globalThis so content.js can use it, and it
// stays small and dependency-free so it can be unit tested under Node.

(function (global) {
  const DEFAULT_WIDTH = 540;
  const DEFAULT_HEIGHT = 600;
  const VIEWPORT_MARGIN = 16;
  const EDGE_MARGIN = 8;

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function getPanelSize(viewportWidth, viewportHeight) {
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

  function getDefaultPosition(viewportWidth, viewportHeight, size) {
    return {
      left: Math.max(VIEWPORT_MARGIN, viewportWidth - size.width - VIEWPORT_MARGIN),
      top: Math.max(VIEWPORT_MARGIN, (viewportHeight - size.height) / 2),
    };
  }

  function clampPosition(position, viewportWidth, viewportHeight, size) {
    const maxLeft = Math.max(EDGE_MARGIN, viewportWidth - size.width - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, viewportHeight - size.height - EDGE_MARGIN);

    return {
      left: clamp(position.left, EDGE_MARGIN, maxLeft),
      top: clamp(position.top, EDGE_MARGIN, maxTop),
    };
  }

  const api = {
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    VIEWPORT_MARGIN,
    EDGE_MARGIN,
    getPanelSize,
    getDefaultPosition,
    clampPosition,
  };

  global.NookBinPanelPosition = api;
})(globalThis);
