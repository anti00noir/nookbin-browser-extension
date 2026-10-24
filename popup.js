import { getFileStorage } from './lib/idb-file-storage.js';

const dropZone  = document.getElementById('dropZone');
const filePicker = document.getElementById('filePicker');
const fileList  = document.getElementById('fileList');
const statusEl  = document.getElementById('status');

let store;

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

async function init() {
  store = await getFileStorage({ name: 'my-files' });
  renderList();
}

async function addFiles(files) {
  for (const file of files) {
    await store.put(file.name, file);
  }
  setStatus(`Stored ${files.length} file(s)`, 'success');
  renderList();
}

async function renderList() {
  fileList.innerHTML = '';
  const keys = await store.list();
  for (const name of keys) {
    const blob = await store.get(name);
    const li = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = name;
    nameSpan.title = name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${(blob.size / 1024).toFixed(1)} KB`;

    const useBtn = document.createElement('button');
    useBtn.textContent = 'Use';
    useBtn.onclick = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        chrome.tabs.sendMessage(tab.id, { action: 'dropFile', fileName: name },
          (resp) => {
            if (chrome.runtime.lastError) {
              setStatus('Cannot inject on this page', 'error');
            } else {
              setStatus('Injected', 'success');
            }
          });
      });
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'delete';
    delBtn.textContent = '✕';
    delBtn.onclick = async () => {
      await store.remove(name);
      renderList();
    };

    li.append(nameSpan, meta, useBtn, delBtn);
    fileList.appendChild(li);
  }
}

// Drag-and-drop wiring
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  await addFiles(e.dataTransfer.files);
});
dropZone.addEventListener('click', () => filePicker.click());
filePicker.addEventListener('change', async () => {
  await addFiles(filePicker.files);
  filePicker.value = '';
});

init().catch(err => setStatus(err.message, 'error'));