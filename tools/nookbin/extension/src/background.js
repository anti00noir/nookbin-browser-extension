// Service worker: turns toolbar clicks and the keyboard shortcut into a
// message that toggles the floating NookBin panel inside the active page.

const PANEL_PAGE = 'popup/popup.html';
const FALLBACK_WINDOW_KEY = 'nookbinFallbackWindowId';
const CONTENT_SCRIPTS = ['content.js'];

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setTitle({ title: 'Toggle NookBin panel' });
});

chrome.action.onClicked.addListener((tab) => {
  void togglePanel(tab);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-panel') return;
  void togglePanelInActiveTab();
});

chrome.windows.onRemoved.addListener((windowId) => {
  void forgetFallbackWindow(windowId);
});

async function togglePanelInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await togglePanel(tab);
}

async function togglePanel(tab) {
  if (!tab || typeof tab.id !== 'number') return;

  if (await sendPanelMessage(tab.id)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: CONTENT_SCRIPTS,
    });
  } catch {
    // Chrome pages, the Web Store, the PDF viewer, and similar pages do not
    // allow content scripts. Fall back to a movable browser popup window.
    await openFallbackWindow();
    return;
  }

  if (await sendPanelMessage(tab.id)) return;
  await openFallbackWindow();
}

async function sendPanelMessage(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { action: 'togglePanel' },
      { frameId: 0 },
    );
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function openFallbackWindow() {
  const existingId = await getFallbackWindowId();
  if (existingId != null) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return;
    } catch {
      await chrome.storage.session.remove(FALLBACK_WINDOW_KEY);
    }
  }

  const window = await chrome.windows.create({
    url: chrome.runtime.getURL(`${PANEL_PAGE}?standalone=1`),
    type: 'popup',
    width: 580,
    height: 680,
  });

  if (window?.id != null) {
    await chrome.storage.session.set({ [FALLBACK_WINDOW_KEY]: window.id });
  }
}

async function getFallbackWindowId() {
  try {
    const stored = await chrome.storage.session.get(FALLBACK_WINDOW_KEY);
    return stored?.[FALLBACK_WINDOW_KEY] ?? null;
  } catch {
    return null;
  }
}

async function forgetFallbackWindow(windowId) {
  const existingId = await getFallbackWindowId();
  if (existingId === windowId) {
    await chrome.storage.session.remove(FALLBACK_WINDOW_KEY);
  }
}
