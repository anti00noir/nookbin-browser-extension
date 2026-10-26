# File Dropper

A small Manifest V3 Chrome extension proof of concept for keeping frequently used documents in the extension popup and sending them to a file upload control on the active page.

The current goal is to validate the basic workflow: **store a file once, then reuse it without opening the file picker again**.

## Current behavior

1. Open the extension popup.
2. Drop one or more files into the drop zone, or click it to browse.
3. Files are stored in the extension's IndexedDB.
4. Open a page with an upload form.
5. Click **Use** next to a stored file.

The content script finds a file input, attaches the file to it, and fires the events an upload widget normally listens for. If no file input is found, it falls back to simulating a drag-and-drop on an element that looks like an upload area.

## Project structure

```text
mini-chrome-ext/
├── manifest.json            # Extension manifest and permissions
├── popup.html               # Popup markup and styles
├── popup.js                 # Popup logic and storage/injection orchestration
├── content.js               # Page-side file injection
└── lib/
    └── idb-file-storage.js  # Promise-based IndexedDB wrapper
```

There is no build step, bundler, or runtime dependency. The popup uses an ES module; the content script is a classic script because manifest content scripts are not modules.

