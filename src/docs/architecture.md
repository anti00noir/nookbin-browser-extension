## Architecture

### Components

| File | Responsibility |
| --- | --- |
| `manifest.json` | Declares the popup, the content script, permissions, and host access. |
| `popup.html` | Popup UI: drop zone, stored-file list, and status line. |
| `popup.js` | Handles drag/drop and file selection, reads and writes storage, renders the file list, and sends the selected file to the active tab. |
| `content.js` | Receives the file payload, rebuilds a `File`, and delivers it to the page. |
| `lib/idb-file-storage.js` | Opens the extension database and exposes `put`, `get`, `list`, `remove`, and `clear`. |

### Storage model

Stored documents live in the extension's own IndexedDB:

- Database: `my-files`
- Database version: `1`
- Object store: `files`
- Key: file name
- Value: the stored `File` / `Blob`

Because the key is the file name, adding a file with an existing name replaces the previous entry.

This is extension-origin storage. Content scripts run in the page's origin and therefore cannot read it directly; the popup is responsible for reading files and passing them to the page.

### File transfer

Chrome extension messages do not carry a `File` or `Blob` directly, so the popup converts the selected file to a base64 string:

```js
{
  action: 'dropFile',
  fileName: string,
  fileType: string,
  data: string // base64-encoded file bytes
}
```

The popup sends this to frame `0` of the active tab:

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

If no content script is listening, the popup injects `content.js` with `chrome.scripting.executeScript()` and retries once. This covers tabs that were already open when the extension was installed or reloaded.

The transfer is currently capped at **32 MB** because the base64 payload is sent through extension messaging.

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

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `scripting` | Re-inject the content script into tabs that do not have it. |
| `unlimitedStorage` | Allow IndexedDB to hold document-sized files. |
| `<all_urls>` | Run the content script and inject into the active page. |

There is intentionally no background service worker yet. The popup and content script handle the whole flow directly.

## Loading the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. After changing the code, reload the extension from the extensions page.
5. Already-open tabs can usually recover automatically through the injection fallback, but refreshing the page is the cleanest option.

## Current limitations

This is a proof of concept, so the following are intentionally simple:

- Only the **first file input in the top frame** is targeted.
- Iframes, shadow DOM, and custom canvas-based upload widgets are not specifically handled.
- The upload-area fallback is a heuristic and may not work on every site.
- Synthetic events may be ignored by pages that require trusted user input.
- Files are keyed by name, so duplicate names overwrite.
- Files over 32 MB cannot currently be injected.
- Chrome blocks extensions on pages such as `chrome://`, the Chrome Web Store, and the PDF viewer.
- Uninstalling the extension deletes its IndexedDB contents.
- `file://` pages require **Allow access to file URLs** in the extension details page.

The core storage, messaging, and injection flow is working; the areas above are the main candidates for future work.
