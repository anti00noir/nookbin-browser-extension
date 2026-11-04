## Architecture

### Components

| File | Responsibility |
| --- | --- |
| `manifest.json` | Declares the service worker, content scripts, permissions, keyboard shortcut, web-accessible panel files, and host access. |
| `background.js` | Handles toolbar clicks and the **Alt+Shift+N** shortcut, toggles the in-page panel, injects the content script into older tabs, and opens a standalone fallback window on restricted pages. |
| `content.js` | Owns the floating panel host, handles dragging/docking/closing, keeps the panel above fullscreen content, and delivers files to the page. |
| `popup/popup.html` | Panel UI: header, library heading, search and filters, stored-file list, empty state, drop guide, and storage footer. |
| `popup/popup.css` | Responsive panel layout and charcoal theme styles. |
| `popup.js` | Handles drag/drop and file selection, reads and writes storage, filters and sorts the file list, sends the selected file to the active tab, and talks to the panel host. |
| `lib/idb-file-storage.js` | Opens the extension database and exposes `put`, `get`, `list`, `remove`, and `clear`. |
| `lib/panel-position.js` | Pure geometry helpers for sizing the panel, docking it to the right, and keeping it inside the viewport. |
| `fonts/` | Bundled IBM Plex Mono Web Fonts (SIL Open Font License). |

### Floating panel

NookBin no longer uses Chrome's native action popup. Clicking the toolbar icon (or pressing the shortcut) sends a `togglePanel` message to the content script in the active tab. The content script creates a `<nookbin-panel>` element, attaches a shadow root, and loads `popup/popup.html` in an iframe.

The host is a manual HTML popover, so it is rendered in the browser's top layer. This keeps it above ordinary page content and lets it be re-shown above fullscreen content. When the page enters fullscreen, the Fullscreen API hides popovers that are not part of the fullscreen element; `content.js` listens for `fullscreenchange`, hides and re-shows the popover, and the panel stays visible on top.

The panel defaults to the right side of the viewport and is clamped so it cannot be dragged completely off-screen. Its last position is stored in `chrome.storage.local` under `nookbinPanelPosition`. The panel header has:

- A drag strip that moves the panel freely.
- A dock button that snaps it back to the right side.
- A close button that removes it from the page.

The panel's iframe is web-accessible so it can be loaded from a content script. It remains an extension page, so it has full access to `chrome.tabs`, `chrome.scripting`, and the extension's IndexedDB.

### Storage model

Stored documents live in the extension's own IndexedDB:

- Database: `my-files`
- Database version: `1`
- Object store: `files`
- Key: file name
- Value: the stored `File` / `Blob`

Because the key is the file name, adding a file with an existing name replaces the previous entry.

This is extension-origin storage. Content scripts run in the page's origin and therefore cannot read it directly; the panel is responsible for reading files and passing them to the page.

### File transfer

Chrome extension messages do not carry a `File` or `Blob` directly, so the panel converts the selected file to a base64 string:

```js
{
  action: 'dropFile',
  fileName: string,
  fileType: string,
  data: string // base64-encoded file bytes
}
```

The panel sends this to frame `0` of the active tab:

```js
chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
```

The content script responds with:

```js
{ ok: true, target: 'file input' | 'upload area' | 'document body' }
```

or:

```js
{ ok: false, error: string }
```

If no content script is listening, the panel injects `lib/panel-position.js` and `content.js` with `chrome.scripting.executeScript()` and retries once. This covers tabs that were already open when the extension was installed or reloaded.

The transfer is currently capped at **32 MB** because the base64 payload is sent through extension messaging.

When the panel is running in the standalone fallback window, the active tab is the extension page itself. In that case, the panel targets the active tab of the last focused normal browser window instead.

### Page-side injection

`content.js` follows two paths:

1. **File input found**
   - Rebuilds the `File`.
   - Assigns it through a `DataTransfer` to `input.files`.
   - Dispatches `input` and `change` events.

2. **No file input found**
   - Looks for an element whose class or ID contains `upload`.
   - Falls back to `document.body`.
   - Dispatches `dragenter`, `dragover`, and `drop` events with the file in the `DataTransfer`.

The content script includes a load guard so injecting it again does not register duplicate message listeners.

### Restricted pages

Chrome does not allow content scripts on pages such as `chrome://` URLs, the Chrome Web Store, and the PDF viewer. When injection fails, the background service worker opens `popup/popup.html?standalone=1` in a small `popup` window. That window is movable by the operating system and can be focused again from the toolbar icon. It uses the same stored files and UI, but hides the in-page drag/dock/close controls.

### Permissions

| Permission | Why it is needed |
| --- | --- |
| `scripting` | Re-inject the content script into tabs that do not have it and detect restricted pages. |
| `storage` | Remember the floating panel position and the fallback window ID. |
| `unlimitedStorage` | Allow IndexedDB to hold document-sized files. |
| `<all_urls>` | Run the content script and inject into the active page. |

The extension requires Chrome 114 or newer because the floating panel relies on the HTML popover API.

### Loading the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `src/` folder.
4. After changing the code, reload the extension from the extensions page.
5. Already-open tabs can usually recover automatically through the injection fallback, but refreshing the page is the cleanest option.

### Current limitations

This is a proof of concept, so the following are intentionally simple:

- Only the **first file input in the top frame** is targeted.
- Iframes, shadow DOM, and custom canvas-based upload widgets are not specifically handled.
- The upload-area fallback is a heuristic and may not work on every site.
- Synthetic events may be ignored by pages that require trusted user input.
- Files are keyed by name, so duplicate names overwrite.
- Files over 32 MB cannot currently be injected.
- Chrome blocks extensions on pages such as `chrome://`, the Chrome Web Store, and the PDF viewer. Those pages use the standalone fallback window instead.
- The in-page panel closes when the page navigates; reopen it from the toolbar or shortcut.
- Uninstalling the extension deletes its IndexedDB contents.
- `file://` pages require **Allow access to file URLs** in the extension details page.

The core storage, messaging, and injection flow is working; the areas above are the main candidates for future work.
