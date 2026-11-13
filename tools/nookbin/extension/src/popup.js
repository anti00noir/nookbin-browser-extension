import { getFileStorage } from './lib/idb-file-storage.js';

const STORE_NAME = 'my-files';
const IDLE_STATUS = 'Local only';

// Chrome extension messages are JSON-serialized and have a size limit. Base64
// makes the payload roughly a third larger, so keep this conservative.
const MAX_INJECT_BYTES = 32 * 1024 * 1024;

const EXTENSION_BADGES = {
  pdf: 'PDF',
  doc: 'DOC',
  docx: 'DOC',
  xls: 'XLS',
  xlsx: 'XLS',
  csv: 'CSV',
  ppt: 'PPT',
  pptx: 'PPT',
  png: 'IMG',
  jpg: 'IMG',
  jpeg: 'IMG',
  gif: 'IMG',
  webp: 'IMG',
  svg: 'IMG',
  avif: 'IMG',
  bmp: 'IMG',
  txt: 'TXT',
  md: 'MD',
  json: 'JSON',
  zip: 'ZIP',
  rar: 'ZIP',
  '7z': 'ZIP',
};

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
  'heic',
]);

const ICON_PATHS = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path><path d="M14 3v5h5"></path>',
  send: '<path d="M12 16V4"></path><path d="m8 8 4-4 4 4"></path><path d="M5 15v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"></path>',
  trash: '<path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="m6 7 1 13h10l1-13"></path><path d="M10 11v5M14 11v5"></path>',
};

const dropZone = document.getElementById('dropZone');
const filePicker = document.getElementById('filePicker');
const fileList = document.getElementById('fileList');
const statusEl = document.getElementById('status');
const localStatus = document.getElementById('localStatus');
const addFilesButton = document.getElementById('addFilesButton');
const libraryControls = document.getElementById('libraryControls');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const fileCount = document.getElementById('fileCount');
const storageSummary = document.getElementById('storageSummary');
const emptyState = document.getElementById('emptyState');
const emptyTitle = document.getElementById('emptyTitle');
const emptyHint = document.getElementById('emptyHint');
const filterButtons = [...document.querySelectorAll('.filter')];
const dockPanelButton = document.getElementById('dockPanelButton');
const closePanelButton = document.getElementById('closePanelButton');

const isEmbedded = window.parent !== window
  || new URLSearchParams(window.location.search).has('embedded');
const isStandalone = !isEmbedded
  && new URLSearchParams(window.location.search).has('standalone');

document.documentElement.classList.toggle('is-embedded', isEmbedded);

let store = null;
let entries = [];
let searchQuery = '';
let filterMode = 'all';
let sortMode = 'name';
let statusTimer = null;

function setStatus(message, type = '') {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  statusEl.textContent = message || IDLE_STATUS;
  statusEl.title = message || '';
  localStatus.dataset.state = type || 'idle';

  if (message && type === 'success') {
    statusTimer = window.setTimeout(() => {
      statusEl.textContent = IDLE_STATUS;
      statusEl.title = '';
      localStatus.dataset.state = 'idle';
      statusTimer = null;
    }, 3000);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > -1 && dot < name.length - 1
    ? name.slice(dot + 1).toLocaleLowerCase()
    : '';
}

function isPdfFile(name, blob) {
  return blob.type === 'application/pdf' || getExtension(name) === 'pdf';
}

function isImageFile(name, blob) {
  return blob.type.startsWith('image/') || IMAGE_EXTENSIONS.has(getExtension(name));
}

async function init() {
  try {
    store = await getFileStorage({ name: STORE_NAME });
    await refreshList();
  } catch (error) {
    setStatus(`Could not open file storage: ${error.message}`, 'error');
  }
}

async function addFiles(fileListLike) {
  if (!store) {
    throw new Error('File storage is not ready yet. Please try again.');
  }

  const files = Array.from(fileListLike || []);
  if (files.length === 0) return;

  let stored = 0;
  const errors = [];

  for (const file of files) {
    try {
      await store.put(file.name, file);
      stored += 1;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }

  if (stored > 0) {
    // Adding files is an explicit "show me what I just added" action. Clear a
    // stale filter so the new rows are guaranteed to be visible.
    searchQuery = '';
    searchInput.value = '';
    setFilter('all');
    setStatus(`Stored ${stored} file${stored === 1 ? '' : 's'}.`, 'success');
  }
  if (errors.length > 0) {
    setStatus(`Could not store ${errors.length} file(s). ${errors[0]}`, 'error');
  }

  await refreshList();
}

async function refreshList() {
  if (!store) return;

  try {
    const names = await store.list();
    const loaded = await Promise.all(
      names.map(async (name) => {
        try {
          return { name, blob: await store.get(name) };
        } catch {
          return { name, blob: null };
        }
      }),
    );

    entries = loaded.filter(({ blob }) => blob instanceof Blob);

    if (entries.length === 0) {
      searchQuery = '';
      searchInput.value = '';
      setFilter('all');
    }

    renderList();
  } catch (error) {
    setStatus(`Could not read stored files: ${error.message}`, 'error');
  }
}

function renderList() {
  const visible = getVisibleEntries();

  updateCounts();
  libraryControls.hidden = entries.length === 0;

  fileList.replaceChildren();
  emptyState.hidden = visible.length > 0;

  if (visible.length === 0) {
    if (entries.length === 0) {
      emptyTitle.textContent = 'No files yet';
      emptyHint.textContent = 'Drop a file below or use Add files.';
    } else {
      emptyTitle.textContent = 'No matching files';
      if (searchQuery.trim() && filterMode !== 'all') {
        emptyHint.textContent = 'Try another search or filter.';
      } else if (searchQuery.trim()) {
        emptyHint.textContent = 'Try a different search.';
      } else {
        emptyHint.textContent = 'Try a different filter.';
      }
    }
    return;
  }

  for (const entry of visible) {
    fileList.appendChild(createFileRow(entry));
  }
}

function updateCounts() {
  const totalSize = entries.reduce((sum, { blob }) => sum + blob.size, 0);
  const count = entries.length;

  fileCount.textContent = String(count).padStart(2, '0');
  fileCount.setAttribute(
    'aria-label',
    `${count} stored file${count === 1 ? '' : 's'}`,
  );
  storageSummary.textContent = `${formatSize(totalSize)} stored`;
}

function getVisibleEntries() {
  const query = searchQuery.trim().toLocaleLowerCase();
  const visible = entries.filter(({ name, blob }) => {
    if (query && !name.toLocaleLowerCase().includes(query)) return false;
    if (filterMode === 'pdf') return isPdfFile(name, blob);
    if (filterMode === 'images') return isImageFile(name, blob);
    return true;
  });

  visible.sort((a, b) => {
    if (sortMode === 'size') {
      const sizeDifference = b.blob.size - a.blob.size;
      if (sizeDifference !== 0) return sizeDifference;
    }

    return a.name.localeCompare(b.name);
  });

  return visible;
}

function createIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}

function createFileRow({ name, blob }) {
  const li = document.createElement('li');
  li.className = 'file-row';

  const format = document.createElement('span');
  format.className = 'file-format';
  format.append(createIcon('file'));

  const formatLabel = document.createElement('span');
  formatLabel.className = 'format-label';
  formatLabel.textContent = getFileBadge(name, blob);
  format.appendChild(formatLabel);

  const details = document.createElement('div');
  details.className = 'file-details';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-name';
  nameSpan.textContent = name;
  nameSpan.title = name;

  const meta = document.createElement('span');
  meta.className = 'file-meta';
  meta.textContent = formatSize(blob.size);

  details.append(nameSpan, meta);

  const actions = document.createElement('div');
  actions.className = 'file-actions';

  const useBtn = document.createElement('button');
  useBtn.type = 'button';
  useBtn.className = 'file-action send-action';
  useBtn.title = `Send "${name}" to the current page`;
  useBtn.setAttribute('aria-label', `Send ${name} to the current page`);
  useBtn.appendChild(createIcon('send'));
  useBtn.addEventListener('click', () => {
    void useFile(name, useBtn);
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'file-action delete';
  delBtn.title = `Delete "${name}"`;
  delBtn.setAttribute('aria-label', `Delete ${name}`);
  delBtn.appendChild(createIcon('trash'));
  delBtn.addEventListener('click', () => {
    void deleteFile(name, delBtn);
  });

  actions.append(useBtn, delBtn);
  li.append(format, details, actions);
  return li;
}

function getFileBadge(name, blob) {
  const extension = getExtension(name);
  if (extension) {
    if (EXTENSION_BADGES[extension]) return EXTENSION_BADGES[extension];
    if (extension.length <= 4) return extension.toLocaleUpperCase();
  }

  if (blob.type.startsWith('image/')) return 'IMG';
  if (blob.type === 'application/pdf') return 'PDF';
  if (blob.type.startsWith('text/')) return 'TXT';
  return 'FILE';
}

function setFilter(nextFilter) {
  filterMode = nextFilter;

  for (const button of filterButtons) {
    const active = button.dataset.filter === nextFilter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

async function deleteFile(name, button) {
  if (!store) return;

  button.disabled = true;

  try {
    await store.remove(name);
    setStatus(`Removed "${name}".`, 'success');
    await refreshList();
  } catch (error) {
    setStatus(`Could not remove "${name}": ${error.message}`, 'error');
    button.disabled = false;
  }
}

async function useFile(name, button) {
  if (!store) return;

  if (button) {
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
  }
  setStatus('Sending file to the page...');

  try {
    const blob = await store.get(name);
    if (!blob) throw new Error('That file is no longer in storage.');

    if (blob.size > MAX_INJECT_BYTES) {
      throw new Error(
        `This proof of concept can only send files up to ${formatSize(MAX_INJECT_BYTES)}.`,
      );
    }

    const tab = await getTargetTab();
    if (!tab || typeof tab.id !== 'number') {
      throw new Error('No active tab was found.');
    }

    const data = await fileToBase64(blob);
    const response = await sendToTab(tab.id, {
      action: 'dropFile',
      fileName: name,
      fileType: blob.type,
      data,
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || 'The page did not accept the file.');
    }

    setStatus(`Sent to the page (${response.target}).`, 'success');
  } catch (error) {
    setStatus(friendlyError(error), 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
    }
  }
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch (error) {
    const reason = error?.message || String(error);

    if (!/Receiving end does not exist|Could not establish connection/i.test(reason)) {
      throw error;
    }

    // Tabs that were already open when the extension was installed or reloaded
    // do not have the content script yet. Inject it and retry once.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['content.js'],
    });

    return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  }
}

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');

      if (comma === -1) {
        reject(new Error('Could not encode the file.'));
        return;
      }

      resolve(result.slice(comma + 1));
    };

    reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
  });
}

function friendlyError(error) {
  const message = error?.message || String(error);
  const blocked = /cannot access|extension gallery cannot be scripted|chrome:\/\//i;

  if (blocked.test(message)) {
    return 'Chrome does not allow extensions to run on this page. Try a normal website.';
  }

  return message;
}

async function getTargetTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || typeof activeTab.id !== 'number') return activeTab;

  // The in-page panel is embedded in the page tab, so the active tab is the
  // right target. The standalone fallback window, however, is itself the
  // active tab; in that case, use the last focused normal browser window.
  if (!isStandalone) return activeTab;

  try {
    const normalWindow = await chrome.windows.getLastFocused({
      windowTypes: ['normal'],
    });
    if (normalWindow?.id != null && normalWindow.type === 'normal') {
      const [tab] = await chrome.tabs.query({
        active: true,
        windowId: normalWindow.id,
      });
      if (tab) return tab;
    }
  } catch {
    // Fall back to the tab that hosts the standalone popup.
  }

  return activeTab;
}

function postToPanelHost(message) {
  if (!isEmbedded) return;
  window.parent.postMessage(message, '*');
}

function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.matches('input, textarea, select') || target.isContentEditable);
}

function focusSearch() {
  if (libraryControls.hidden) return false;
  searchInput.focus();
  searchInput.select();
  return true;
}

addFilesButton.addEventListener('click', () => {
  filePicker.click();
});

dockPanelButton.addEventListener('click', () => {
  postToPanelHost({ type: 'nookbin:panel-dock' });
});

closePanelButton.addEventListener('click', () => {
  postToPanelHost({ type: 'nookbin:panel-close' });
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderList();
});

sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  renderList();
});

for (const button of filterButtons) {
  button.addEventListener('click', () => {
    setFilter(button.dataset.filter);
    renderList();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isEmbedded) {
    postToPanelHost({ type: 'nookbin:panel-close' });
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
    if (focusSearch()) event.preventDefault();
    return;
  }

  if (event.key === '/' && !isTypingTarget(event.target)) {
    if (focusSearch()) event.preventDefault();
  }
});

// Drag-and-drop wiring
let dragDepth = 0;

dropZone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation();
  dragDepth = 0;
  dropZone.classList.remove('dragover');

  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) {
    setStatus('No files were dropped.', 'error');
    return;
  }

  void addFiles(files).catch((error) => setStatus(error.message, 'error'));
});

// Clicking the hidden input bubbles back up to the drop zone, so ignore that
// event to avoid re-entering this handler.
dropZone.addEventListener('click', (event) => {
  if (event.target === filePicker) return;
  filePicker.click();
});

dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    filePicker.click();
  }
});

filePicker.addEventListener('change', () => {
  const files = Array.from(filePicker.files || []);
  filePicker.value = '';

  if (files.length === 0) return;

  void addFiles(files).catch((error) => setStatus(error.message, 'error'));
});

// Make the whole popup a drop target so a drop outside the guidance card still
// stores the file instead of navigating the popup.
window.addEventListener('dragover', (event) => {
  event.preventDefault();
});
window.addEventListener('drop', (event) => {
  event.preventDefault();

  dragDepth = 0;
  dropZone.classList.remove('dragover');

  if (dropZone.contains(event.target)) return;

  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;

  void addFiles(files).catch((error) => setStatus(error.message, 'error'));
});

void init();
