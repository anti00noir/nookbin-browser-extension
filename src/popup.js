import { getFileStorage } from './lib/idb-file-storage.js';

const STORE_NAME = 'my-files';

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
  txt: 'TXT',
  md: 'MD',
  json: 'JSON',
  zip: 'ZIP',
  rar: 'ZIP',
  '7z': 'ZIP',
};

const dropZone = document.getElementById('dropZone');
const filePicker = document.getElementById('filePicker');
const fileList = document.getElementById('fileList');
const statusEl = document.getElementById('status');
const addFilesButton = document.getElementById('addFilesButton');
const fileSummary = document.getElementById('fileSummary');
const toolbar = document.getElementById('toolbar');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const emptyState = document.getElementById('emptyState');
const emptyTitle = document.getElementById('emptyTitle');
const emptyHint = document.getElementById('emptyHint');

let store = null;
let entries = [];
let searchQuery = '';
let sortMode = 'name';
let statusTimer = null;

function setStatus(message, type = '') {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : 'status';

  if (message && type === 'success') {
    statusTimer = window.setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status';
      statusTimer = null;
    }, 3000);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    // stale filter so the new rows are visible.
    searchQuery = '';
    searchInput.value = '';
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
    }

    renderList();
  } catch (error) {
    setStatus(`Could not read stored files: ${error.message}`, 'error');
  }
}

function renderList() {
  const visible = getVisibleEntries();
  updateSummary(visible.length);
  toolbar.hidden = entries.length === 0;

  fileList.replaceChildren();
  emptyState.hidden = visible.length > 0;

  if (visible.length === 0) {
    if (entries.length === 0) {
      emptyTitle.textContent = 'No files stored yet';
      emptyHint.textContent = 'Drop a document below or click add.';
    } else {
      emptyTitle.textContent = 'No matching files';
      emptyHint.textContent = searchQuery.trim()
        ? `Nothing matches “${searchQuery.trim()}”.`
        : 'Try a different search.';
    }
    return;
  }

  for (const entry of visible) {
    fileList.appendChild(createFileRow(entry));
  }
}

function updateSummary(visibleCount) {
  if (entries.length === 0) {
    fileSummary.textContent = 'No files';
    return;
  }

  if (searchQuery.trim() && visibleCount !== entries.length) {
    fileSummary.textContent = `${visibleCount} of ${entries.length} files`;
    return;
  }

  const totalSize = entries.reduce((sum, { blob }) => sum + blob.size, 0);
  const countLabel = `${entries.length} file${entries.length === 1 ? '' : 's'}`;
  fileSummary.textContent = `${countLabel} · ${formatSize(totalSize)}`;
}

function getVisibleEntries() {
  const query = searchQuery.trim().toLocaleLowerCase();
  const visible = query
    ? entries.filter(({ name }) => name.toLocaleLowerCase().includes(query))
    : [...entries];

  visible.sort((a, b) => {
    if (sortMode === 'size') {
      const sizeDifference = b.blob.size - a.blob.size;
      if (sizeDifference !== 0) return sizeDifference;
    }

    return a.name.localeCompare(b.name);
  });

  return visible;
}

function createFileRow({ name, blob }) {
  const li = document.createElement('li');
  li.className = 'file-row';

  const badge = document.createElement('span');
  badge.className = 'file-badge';
  badge.textContent = getFileBadge(name, blob);
  badge.setAttribute('aria-hidden', 'true');

  const info = document.createElement('div');
  info.className = 'file-info';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-name';
  nameSpan.textContent = name;
  nameSpan.title = name;

  const meta = document.createElement('span');
  meta.className = 'file-meta';
  meta.textContent = formatSize(blob.size);

  info.append(nameSpan, meta);

  const useBtn = document.createElement('button');
  useBtn.type = 'button';
  useBtn.className = 'use-button';
  useBtn.textContent = 'Use';
  useBtn.title = `Send "${name}" to the current page`;
  useBtn.setAttribute('aria-label', `Send ${name} to the current page`);
  useBtn.addEventListener('click', () => {
    void useFile(name, useBtn);
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'icon-button delete-button';
  delBtn.textContent = '\u2715';
  delBtn.title = `Delete "${name}"`;
  delBtn.setAttribute('aria-label', `Delete ${name}`);
  delBtn.addEventListener('click', () => {
    void deleteFile(name, delBtn);
  });

  li.append(badge, info, useBtn, delBtn);
  return li;
}

function getFileBadge(name, blob) {
  const dot = name.lastIndexOf('.');

  if (dot > -1 && dot < name.length - 1) {
    const extension = name.slice(dot + 1).toLocaleLowerCase();
    if (EXTENSION_BADGES[extension]) return EXTENSION_BADGES[extension];
    if (extension.length <= 4) return extension.toLocaleUpperCase();
  }

  if (blob.type.startsWith('image/')) return 'IMG';
  if (blob.type === 'application/pdf') return 'PDF';
  if (blob.type.startsWith('text/')) return 'TXT';
  return 'FILE';
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

  const originalLabel = button?.textContent || 'Use';
  if (button) {
    button.disabled = true;
    button.textContent = 'Sending…';
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

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
      button.textContent = originalLabel;
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

addFilesButton.addEventListener('click', () => {
  filePicker.click();
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderList();
});

sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  renderList();
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

// Make the whole popup a drop target so a drop outside the footer still stores
// the file instead of navigating the popup.
window.addEventListener('dragover', (event) => {
  event.preventDefault();
});
window.addEventListener('drop', (event) => {
  event.preventDefault();

  if (dropZone.contains(event.target)) return;

  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) {
    setStatus('No files were dropped.', 'error');
    return;
  }

  void addFiles(files).catch((error) => setStatus(error.message, 'error'));
});

void init();
