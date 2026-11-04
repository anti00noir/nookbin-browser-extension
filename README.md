# NookBin

A small Manifest V3 Chrome extension proof of concept for keeping frequently used documents in a floating panel and sending them to a file upload control on the active page.

The current goal is to validate the basic workflow: **store a file once, then reuse it without opening the file picker again**.

## Current behavior

1. Click the NookBin toolbar icon, or press **Alt+Shift+N**, to open the floating panel.
2. The panel docks to the right side of the page. Drag its header to move it anywhere, use the dock button to snap it back to the right, or close it with the **×** button.
3. Drop one or more files into the drop guide, or click it (or the header **Add files** button) to browse.
4. Files are stored in the extension's IndexedDB.
5. Search, filter by PDF/Images, or sort the list by name or size.
6. Open a page with an upload form and click the send icon next to a stored file.

The content script finds a file input, attaches the file to it, and fires the events an upload widget normally listens for. If no file input is found, it falls back to simulating a drag-and-drop on an element that looks like an upload area.

Because the panel is rendered inside the page rather than as Chrome's native action popup, it stays on screen when the page enters fullscreen. Its last position is remembered between openings.

On pages where Chrome does not allow content scripts (for example `chrome://` pages, the Chrome Web Store, or the PDF viewer), NookBin opens a movable standalone popup window instead.

## Project structure

```text
mini-chrome-ext/
├── src/
│   ├── manifest.json            # Extension manifest and permissions
│   ├── background.js            # Toolbar/shortcut handling and panel fallback
│   ├── content.js               # Floating panel host and page-side file injection
│   ├── popup.js                 # Panel logic and storage/injection orchestration
│   ├── popup/
│   │   ├── popup.html           # Panel markup
│   │   └── popup.css            # Panel styles
│   ├── docs/
│   │   └── architecture.md      # Detailed architecture notes
│   ├── fonts/
│   │   ├── ibm-plex-mono-*.woff2 # Bundled panel typeface
│   │   └── OFL.txt              # Font license
│   └── lib/
│       ├── idb-file-storage.js  # Promise-based IndexedDB wrapper
│       └── panel-position.js    # Floating-panel geometry helpers
├── tests/
│   ├── unit/
│   │   ├── idb-file-storage.test.js
│   │   └── panel-position.test.js
│   └── e2e/
├── package.json
└── package-lock.json
```

There is no build step, bundler, or runtime dependency. The panel uses an ES module; the content script and geometry helper are classic scripts because manifest content scripts are not modules.

## Running the tests

Unit tests use Node's built-in test runner and `fake-indexeddb`:

```bash
npm install
npm test
```

Use `npm run test:watch` while working on the storage library or panel geometry. The current suite covers `src/lib/idb-file-storage.js` and `src/lib/panel-position.js`; end-to-end tests will be added separately.
