// Content script: receives an encoded file from the popup and hands it to the
// page's upload control. Content scripts cannot read the extension's IndexedDB
// directly, so the popup sends the file data in the message.

(() => {
  const LOADED_FLAG = '__fileDropperContentScriptLoaded';

  // Avoid registering duplicate listeners if the popup has to re-inject this
  // script after the extension was reloaded.
  if (globalThis[LOADED_FLAG]) return;
  globalThis[LOADED_FLAG] = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.action !== 'dropFile') return;

    injectFile(message)
      .then((target) => sendResponse({ ok: true, target }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );

    // Keep the message channel open until the async work above finishes.
    return true;
  });

  async function injectFile({ fileName, fileType, data }) {
    if (typeof fileName !== 'string' || fileName.length === 0) {
      throw new Error('The message did not include a file name.');
    }
    if (typeof data !== 'string' || data.length === 0) {
      throw new Error('The message did not include any file data.');
    }

    const bytes = decodeBase64(data);
    const file = new File([bytes], fileName, {
      type: fileType || 'application/octet-stream',
      lastModified: Date.now()
    });

    // Best case: the page has a real file input. Assigning its `files`
    // property and firing `change` is what most upload widgets listen for.
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;

      fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return 'file input';
    }

    // Fallback: simulate a drag-and-drop onto something that looks like an
    // upload area. This is page-specific and may need adjusting per site.
    const dropTarget =
      document.querySelector('[class*="upload"], [id*="upload"]') || document.body;
    const transfer = new DataTransfer();
    transfer.items.add(file);

    for (const type of ['dragenter', 'dragover', 'drop']) {
      dropTarget.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: transfer,
        }),
      );
    }

    return dropTarget === document.body ? 'document body' : 'upload area';
  }

  function decodeBase64(base64) {
    let binary;

    try {
      binary = atob(base64);
    } catch {
      throw new Error('The file data could not be decoded.');
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
})();
