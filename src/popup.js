import { getFileStorage } from 'src/lib/idb-file-storage.js';

const STORE_NAME = 'my-files';

// Chrome extension messages are JSON-serialized and have a size limit. Base64
// makes the payload roughly a third larger, so keep this conservative.
const MAX_INJECT_BYTES = 32 * 1024 * 1024;

const dropZone = document.getElementById('dropZone');
const filePicker = document.getElementById('filePicker');
const fileList = document.getElementById('fileList');
const statusEl = document.getElementById('status');

let store = null;

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = type;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function init() {
  try {
    store = await getFileStorage({ name: STORE_NAME });
    await renderList();
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
    setStatus(`Stored ${stored} file${stored === 1 ? '' : 's'}.`, 'success');
  }
  if (errors.length > 0) {
    setStatus(`Could not store ${errors.length} file(s). ${errors[0]}`, 'error');
  }

  await renderList();
}

async function renderList() {
  if (!store) return;

  try {
    const names = await store.list();
    const entries = await Promise.all(
      names.map(async (name) => {
        try {
          return { name, blob: await store.get(name) };
        } catch {
          return { name, blob: null };
        }
      }),
    );

    fileList.replaceChildren();

    for (const { name, blob } of entries) {
      if (!blob) continue;

      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = name;
      nameSpan.title = name;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = formatSize(blob.size);

      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.textContent = 'Use';
      useBtn.title = `Send "${name}" to the current page`;
      useBtn.addEventListener('click', () => {
        void useFile(name, useBtn);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'delete';
      delBtn.textContent = '\u2715';
      delBtn.title = `Delete "${name}"`;
      delBtn.setAttribute('aria-label', `Delete ${name}`);
      delBtn.addEventListener('click', async () => {
        delBtn.disabled = true;

        try {
          await store.remove(name);
          setStatus(`Removed "${name}".`, 'success');
          await renderList();
        } catch (error) {
          setStatus(`Could not remove "${name}": ${error.message}`, 'error');
          delBtn.disabled = false;
        }
      });

      li.append(nameSpan, meta, useBtn, delBtn);
      fileList.appendChild(li);
    }
  } catch (error) {
    setStatus(`Could not read stored files: ${error.message}`, 'error');
  }
}

async function useFile(name, button) {
  if (!store) return;
  if (button) button.disabled = true;
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
    if (button) button.disabled = false;
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

// Dropping a file anywhere else in the popup would otherwise navigate the
// popup to the file.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();

  if (!dropZone.contains(event.target)) {
    setStatus('Drop files on the box above to store them.', 'error');
  }
});

void init();
