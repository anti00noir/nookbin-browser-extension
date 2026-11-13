# NookSuite

A suite of small browser tools, structured as an npm-workspaces monorepo. Each
tool lives under `tools/` with one folder per target (browser extension, native
port), and target-agnostic logic lives in `packages/core` so every tool — and
every port of a tool — can reuse it.

## Tools

**NookBin** (`tools/nookbin`) — a Manifest V3 Chrome extension for keeping
frequently used documents in a floating panel and sending them to a file upload
control on the active page. Store a file once, then reuse it without opening
the file picker again.

Current behavior:

1. Click the NookBin toolbar icon, or press **Alt+Shift+N**, to open the floating panel.
2. The panel docks to the right side of the page. Drag its header to move it anywhere, use the dock button to snap it back to the right, or close it with the **×** button.
3. Drop one or more files into the drop guide, or click it (or the header **Add files** button) to browse.
4. Files are stored in the extension's IndexedDB.
5. Search, filter by PDF/Images, or sort the list by name or size.
6. Open a page with an upload form and click the send icon next to a stored file.

The content script finds a file input, attaches the file to it, and fires the events an upload widget normally listens for. If no file input is found, it falls back to simulating a drag-and-drop on an element that looks like an upload area.

Because the panel is rendered inside the page rather than as Chrome's native action popup, it stays on screen when the page enters fullscreen. Its last position is remembered between openings.

On pages where Chrome does not allow content scripts (for example `chrome://` pages, the Chrome Web Store, or the PDF viewer), NookBin opens a movable standalone popup window instead.

See [`docs/architecture.md`](docs/architecture.md) for detailed architecture notes.

## Repository layout

```text
nooksuite/
├── package.json                      # Root: npm workspaces, shared scripts
├── docs/
│   └── architecture.md               # Suite-wide architecture notes
├── packages/
│   └── core/                         # @nooksuite/core (target-agnostic)
│       ├── src/
│       │   ├── index.js              # Public exports
│       │   ├── panel-position.js     # Floating-panel geometry helpers
│       │   ├── file-storage.js       # File storage interface + validation
│       │   └── backends/
│       │       └── idb-file-storage.js  # IndexedDB backend
│       └── tests/                    # node --test unit tests
└── tools/
    ├── nookbin/
    │   ├── extension/                # The Chrome MV3 extension
    │   │   ├── src/
    │   │   │   ├── manifest.json     # Extension manifest and permissions
    │   │   │   ├── background.js     # Toolbar/shortcut handling, fallback window
    │   │   │   ├── content.js        # Floating panel host, file injection
    │   │   │   ├── popup.js          # Panel logic and storage orchestration
    │   │   │   ├── popup/            # Panel markup and styles
    │   │   │   └── fonts/            # Bundled IBM Plex Mono (SIL OFL)
    │   │   ├── build.mjs             # esbuild: bundles into dist/
    │   │   └── dist/                 # Build output (Chrome loads this)
    │   └── desktop/                  # Reserved for a future native port
    ├── nookedit/                     # Future tool
    └── nooknotes/                    # Future tool
```

## Development

```bash
npm install        # once, from the repo root (workspaces handle the rest)
npm run build      # build every tool's bundles into its dist/
npm run dev        # watch mode; rebuilds on save
npm test           # run every workspace's unit tests
```

Chrome's **Load unpacked** must point at `tools/nookbin/extension/dist/`, not
the source folder. After changes, reload the extension from `chrome://extensions`.

There are no runtime dependencies; the extension ships only its own code and
bundled `@nooksuite/core` logic. `esbuild` is the only build tool, and unit
tests use Node's built-in test runner with `fake-indexeddb`.

Adding a new tool means adding `tools/<name>/extension/` with its own manifest
and build script — no changes are needed at the suite level.
