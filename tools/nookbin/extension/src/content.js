// Content script: receives an encoded file from the popup and hands it to the
// page's upload control. It also owns the floating NookBin panel, which is
// rendered inside the page so it can stay visible in fullscreen and be moved
// freely.
//
// Content scripts cannot read the extension's IndexedDB directly, so the popup
// sends the file data in the message.

// Loaded for its side effect: registers the panel geometry helpers on
// globalThis. Bundled ahead of the IIFE below by build.mjs.
import './lib/panel-position.js';

(() => {
  const LOADED_FLAG = '__fileDropperContentScriptLoaded';

  // Avoid registering duplicate listeners if the popup has to re-inject this
  // script after the extension was reloaded.
  if (globalThis[LOADED_FLAG]) return;
  globalThis[LOADED_FLAG] = true;

  const PANEL_TAG = 'nookbin-panel';
  const PANEL_HOST_ID = 'nookbin-panel-host';
  const PANEL_PAGE = 'popup/popup.html?embedded=1';
  const PANEL_POSITION_KEY = 'nookbinPanelPosition';

  let panel = null;
  let panelOpening = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;

    if (message.action === 'dropFile') {
      injectFile(message)
        .then((target) => sendResponse({ ok: true, target }))
        .catch((error) =>
          sendResponse({ ok: false, error: error?.message || String(error) }),
        );

      // Keep the message channel open until the async work above finishes.
      return true;
    }

    if (message.action === 'togglePanel') {
      togglePanel()
        .then((open) => sendResponse({ ok: true, open }))
        .catch((error) =>
          sendResponse({ ok: false, error: error?.message || String(error) }),
        );
      return true;
    }

    if (message.action === 'closePanel') {
      closePanel();
      sendResponse({ ok: true });
    }
  });

  async function injectFile({ fileName, fileType, data }) {
    if (typeof fileName !== 'string' || fileName.length === 0) {
      throw new Error('The message did not include a file name.');
    }
    if (typeof data !== 'string' || data.length === 0) {
      throw new Error('The message did not include any file data.');
    }

    const bytes = decodeBase64(data);
    const file = new File([bytes], fileName, {
      type: fileType || 'application/octet-stream',
      lastModified: Date.now()
    });

    // Sites can override both strategies below. See SITE_ADAPTERS.
    const adapter = adapterForHost();

    // Best case: the page has a real file input. Assigning its `files`
    // property and firing `change` is what most upload widgets listen for.
    // The input must actually accept the file: feeding a document to an
    // image-only input makes pages like Outlook reject it with a file
    // format error.
    const fileInput = adapter?.findFileInput
      ? adapter.findFileInput({ file, fileType, fileName })
      : findAcceptingFileInput(fileType, fileName);

    if (fileInput) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;

      fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return 'file input';
    }

    // Fallback: simulate a drag-and-drop onto something that looks like an
    // upload area. This is page-specific and may need adjusting per site.
    const dropTarget =
      adapter?.findDropTarget?.() ||
      document.querySelector('[class*="upload"], [id*="upload"]') ||
      document.body;

    await dispatchSyntheticDrop(dropTarget, file, fileName);

    if (dropTarget === document.body) return 'document body';
    return adapter ? 'site drop target' : 'upload area';
  }

  // ---------------------------------------------------------------------------
  // File injection helpers
  // ---------------------------------------------------------------------------

  // Per-site overrides for the injection strategies above. Keyed by hostname;
  // entries also match subdomains. Only add an adapter when a site's generic
  // behavior cannot be fixed by the shared logic, and keep each adapter to the
  // smallest override that works.
  const SITE_ADAPTERS = {
    // Outlook web app attaches non-image files through its "browse this
    // computer" inputs (data-testid="local-computer-filein"), one per ribbon
    // command. The insert-picture input is image-only and gets skipped by the
    // shared accept filter, leaving the neutral inputs behind it. Synthetic
    // drops are not an option here: OWA found them on the compose body and
    // ignored them because they are not trusted events.
    'outlook.office.com': createOutlookAdapter,
    'outlook.office365.com': createOutlookAdapter,
    'outlook.live.com': createOutlookAdapter,
  };

  function adapterForHost() {
    const host = window.location.hostname.toLowerCase();
    for (const [domain, create] of Object.entries(SITE_ADAPTERS)) {
      if (host === domain || host.endsWith(`.${domain}`)) return create();
    }
    return null;
  }

  function createOutlookAdapter() {
    return {
      findFileInput({ fileType, fileName }) {
        const inputs = [...document.querySelectorAll('input[type="file"]')];
        const accepting = inputs.filter((input) =>
          canInputAccept(input, fileType, fileName),
        );
        if (accepting.length === 0) return null;

        // Prefer an input tied to the attach flow; fall back to the first
        // neutral input when OWA's DOM does not expose the connection.
        return (
          accepting.find(
            (input) =>
              input.closest('[aria-label*="attach" i], [data-testid*="attach" i]') !==
              null,
          ) || accepting[0]
        );
      },
      findDropTarget() {
        // Fallback only: OWA ignores synthetic drops, but keep the compose
        // body targeting in case a future version listens again.
        return findComposeTextbox(document);
      },
    };
  }

  function findComposeTextbox(rootDocument) {
    const direct =
      rootDocument.querySelector('[contenteditable="true"][role="textbox"]') ||
      rootDocument.querySelector('[role="textbox"]');
    if (direct) return direct;

    // Some compose surfaces are hosted in a same-origin iframe; the content
    // script only sees the top document, so search those frames too.
    for (const frame of rootDocument.querySelectorAll('iframe')) {
      try {
        const inner = frame.contentDocument;
        const nested =
          inner?.querySelector('[contenteditable="true"][role="textbox"]') ||
          inner?.querySelector('[role="textbox"]');
        if (nested) return nested;
      } catch {
        // Cross-origin frames cannot be inspected.
      }
    }
    return null;
  }

  // Pick the first file input that can accept this file. Inputs without an
  // `accept` attribute accept anything; inputs with one are checked against
  // the file's MIME type and extension.
  function findAcceptingFileInput(fileType, fileName) {
    for (const input of document.querySelectorAll('input[type="file"]')) {
      if (canInputAccept(input, fileType, fileName)) return input;
    }
    return null;
  }

  function canInputAccept(input, fileType, fileName) {
    const accept = input.getAttribute('accept');
    if (!accept || !accept.trim()) return true;

    const mimeType = (fileType || '').split(';')[0].trim().toLowerCase();
    const mimeBase = mimeType.split('/')[0];
    const extension = getFileExtension(fileName);

    return accept.split(',').some((token) => {
      const pattern = token.trim().toLowerCase();
      if (!pattern) return false;
      if (pattern.startsWith('.')) return pattern === extension;
      if (pattern.endsWith('/*')) return mimeBase !== '' && pattern === `${mimeBase}/*`;
      return pattern === mimeType;
    });
  }

  function getFileExtension(fileName) {
    const index = fileName.lastIndexOf('.');
    if (index <= 0) return '';
    return fileName.slice(index).toLowerCase();
  }

  // Handlers backed by React (Outlook web app among them) commit drag state
  // between events. Firing the whole sequence in one tick means the drop can
  // arrive before that state exists, so the drop is ignored. Spread the
  // events out like a real drag.
  const DRAG_STEP_DELAY_MS = 60;

  async function dispatchSyntheticDrop(target, file, fileName) {
    const transfer = new DataTransfer();
    transfer.items.add(file);

    // Some handlers (Outlook among them) re-inspect the transfer beyond the
    // file itself; a plain-text fallback carrying the file name makes the
    // event look more like a real OS drag.
    try {
      transfer.setData('text/plain', fileName);
    } catch {
      // The file item is what matters; text data is best-effort.
    }

    try {
      transfer.effectAllowed = 'copy';
    } catch {
      // Read-only on some platforms; the file item is what matters.
    }

    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: transfer,
        }),
      );
      if (type !== 'drop') {
        await new Promise((resolve) => setTimeout(resolve, DRAG_STEP_DELAY_MS));
      }
    }
  }

  function decodeBase64(base64) {
    let binary;

    try {
      binary = atob(base64);
    } catch {
      throw new Error('The file data could not be decoded.');
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // ---------------------------------------------------------------------------
  // Floating panel
  // ---------------------------------------------------------------------------

  async function togglePanel() {
    if (panelOpening) return true;
    if (panel) {
      closePanel();
      return false;
    }

    panelOpening = openPanel();
    try {
      await panelOpening;
    } finally {
      panelOpening = null;
    }

    return Boolean(panel);
  }

  async function openPanel() {
    if (panel) return panel;

    const geometry = globalThis.NookBinPanelPosition;
    if (!geometry) {
      throw new Error('The panel geometry helpers were not loaded.');
    }

    const size = geometry.getPanelSize(window.innerWidth, window.innerHeight);
    let position = geometry.getDefaultPosition(
      window.innerWidth,
      window.innerHeight,
      size,
    );

    try {
      const stored = await chrome.storage.local.get(PANEL_POSITION_KEY);
      const saved = stored?.[PANEL_POSITION_KEY];
      if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
        position = geometry.clampPosition(
          saved,
          window.innerWidth,
          window.innerHeight,
          size,
        );
      }
    } catch {
      // Storage is optional. Fall back to the default right-side position.
    }

    const host = document.createElement(PANEL_TAG);
    host.id = PANEL_HOST_ID;
    host.setAttribute('popover', 'manual');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-label', 'NookBin file panel');
    applyHostStyles(host, size, position);
    host.style.setProperty('display', 'none', 'important');

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .panel-frame {
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-radius: 12px;
        background: #191919;
        box-shadow:
          0 24px 70px rgba(0, 0, 0, .55),
          0 0 0 1px rgba(255, 255, 255, .08);
        animation: nookbin-panel-in .16s ease-out;
      }

      .panel-frame iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #191919;
      }

      .drag-strip {
        position: absolute;
        top: 16px;
        left: 16px;
        right: 220px;
        height: 48px;
        z-index: 2;
        border-radius: 4px;
        cursor: grab;
        touch-action: none;
      }

      .drag-strip:active {
        cursor: grabbing;
      }

      @media (max-width: 480px) {
        .drag-strip {
          right: 124px;
        }
      }

      @keyframes nookbin-panel-in {
        from {
          opacity: 0;
          transform: translateY(6px) scale(.985);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .panel-frame {
          animation: none;
        }
      }
    `;

    const frame = document.createElement('div');
    frame.className = 'panel-frame';

    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL(PANEL_PAGE);
    iframe.title = 'NookBin file panel';
    iframe.setAttribute('allowtransparency', 'true');
    frame.appendChild(iframe);

    const dragStrip = document.createElement('div');
    dragStrip.className = 'drag-strip';
    dragStrip.title = 'Drag to move the panel';
    dragStrip.addEventListener('pointerdown', startPanelDrag);
    dragStrip.addEventListener('pointermove', movePanelDrag);
    dragStrip.addEventListener('pointerup', endPanelDrag);
    dragStrip.addEventListener('pointercancel', endPanelDrag);
    dragStrip.addEventListener('lostpointercapture', endPanelDrag);

    // The strip sits over the panel's header. Do not let a file dropped there
    // fall through to the page and navigate away.
    for (const type of ['dragenter', 'dragover', 'drop']) {
      dragStrip.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    shadow.append(style, frame, dragStrip);

    panel = { host, iframe, dragStrip, size, position, dragStart: null };

    document.documentElement.appendChild(host);
    ensurePanelVisible();

    window.addEventListener('resize', handleViewportResize);
    window.addEventListener('message', handlePanelMessage);
    document.addEventListener('fullscreenchange', handleFullscreenChange, true);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange, true);

    iframe.addEventListener('load', () => {
      try {
        iframe.contentWindow?.focus();
      } catch {
        // Focusing an extension frame is best-effort.
      }
    });

    return panel;
  }

  function closePanel() {
    if (!panel) return;

    savePanelPosition();

    const current = panel;
    panel = null;

    window.removeEventListener('resize', handleViewportResize);
    window.removeEventListener('message', handlePanelMessage);
    document.removeEventListener('fullscreenchange', handleFullscreenChange, true);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange, true);

    hidePanelElement(current.host);
    current.host.remove();
  }

  function applyHostStyles(host, size, position) {
    const set = (name, value) => host.style.setProperty(name, value, 'important');

    set('position', 'fixed');
    set('inset', 'auto');
    set('left', `${position.left}px`);
    set('top', `${position.top}px`);
    set('width', `${size.width}px`);
    set('height', `${size.height}px`);
    set('margin', '0');
    set('padding', '0');
    set('border', '0');
    set('background', 'transparent');
    set('overflow', 'visible');
    set('z-index', '2147483647');
    set('color-scheme', 'dark');
    set('box-sizing', 'border-box');
    set('transform', 'none');
    set('visibility', 'visible');
    set('pointer-events', 'auto');
  }

  function ensurePanelVisible({ force = false } = {}) {
    if (!panel) return;

    const { host } = panel;
    host.style.removeProperty('display');

    if (typeof host.showPopover === 'function') {
      try {
        if (force && host.matches(':popover-open')) {
          host.hidePopover();
        }
        if (!host.matches(':popover-open')) host.showPopover();
        return;
      } catch {
        // Fall through to the fixed-position fallback.
      }
    }

    host.style.setProperty('display', 'block', 'important');
  }

  function hidePanelElement(host) {
    try {
      if (typeof host.hidePopover === 'function' && host.matches(':popover-open')) {
        host.hidePopover();
      }
    } catch {
      // The element may already be hidden.
    }

    host.style.setProperty('display', 'none', 'important');
  }

  function handleFullscreenChange() {
    if (!panel) return;

    // Entering fullscreen hides popovers that are not part of the fullscreen
    // element. Re-show ours so it stays on top of the fullscreen content.
    const enteringFullscreen = Boolean(document.fullscreenElement);
    window.setTimeout(() => {
      if (!panel) return;
      ensurePanelVisible({ force: enteringFullscreen });
      clampPanelToViewport();
    }, 0);
  }

  function handleViewportResize() {
    clampPanelToViewport();
  }

  function clampPanelToViewport() {
    if (!panel) return;

    const geometry = globalThis.NookBinPanelPosition;
    if (!geometry) return;

    const size = geometry.getPanelSize(window.innerWidth, window.innerHeight);
    panel.size = size;
    panel.position = geometry.clampPosition(
      panel.position,
      window.innerWidth,
      window.innerHeight,
      size,
    );

    applyHostStyles(panel.host, size, panel.position);
  }

  function positionPanel(left, top) {
    if (!panel) return;

    panel.position = { left, top };
    panel.host.style.setProperty('left', `${left}px`, 'important');
    panel.host.style.setProperty('top', `${top}px`, 'important');
  }

  function handlePanelMessage(event) {
    if (!panel || event.source !== panel.iframe.contentWindow) return;
    if (event.origin !== new URL(chrome.runtime.getURL('')).origin) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'nookbin:panel-close') {
      closePanel();
    } else if (data.type === 'nookbin:panel-dock') {
      dockPanelRight();
    }
  }

  function startPanelDrag(event) {
    if (!panel || !event.isPrimary || event.button !== 0) return;

    panel.dragStart = {
      left: panel.position.left,
      top: panel.position.top,
      screenX: event.screenX,
      screenY: event.screenY,
    };

    try {
      panel.dragStrip.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }

    event.preventDefault();
  }

  function movePanelDrag(event) {
    if (!panel?.dragStart) return;

    const geometry = globalThis.NookBinPanelPosition;
    if (!geometry) return;

    const next = geometry.clampPosition(
      {
        left: panel.dragStart.left + (event.screenX - panel.dragStart.screenX),
        top: panel.dragStart.top + (event.screenY - panel.dragStart.screenY),
      },
      window.innerWidth,
      window.innerHeight,
      panel.size,
    );
    positionPanel(next.left, next.top);
  }

  function endPanelDrag(event) {
    if (!panel?.dragStart) return;

    panel.dragStart = null;

    try {
      panel.dragStrip.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released.
    }

    savePanelPosition();
  }

  function dockPanelRight() {
    if (!panel) return;

    const geometry = globalThis.NookBinPanelPosition;
    if (!geometry) return;

    const position = geometry.getDefaultPosition(
      window.innerWidth,
      window.innerHeight,
      panel.size,
    );
    positionPanel(position.left, position.top);
    savePanelPosition();
  }

  function savePanelPosition() {
    if (!panel) return;

    try {
      void chrome.storage.local
        .set({ [PANEL_POSITION_KEY]: panel.position })
        .catch(() => {});
    } catch {
      // Storage is optional.
    }
  }
})();
