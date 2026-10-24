// Small promise-based IndexedDB wrapper for storing File/Blob objects.
// Files are keyed by name in a single object store.

const DB_VERSION = 1;
const STORE_NAME = 'files';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
  });
}

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    let request;

    try {
      request = indexedDB.open(name, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      // Close this connection if another context wants to upgrade the schema.
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () =>
      reject(request.error || new Error(`Could not open the "${name}" database.`));
    request.onblocked = () =>
      reject(new Error(`The "${name}" database is blocked by another open tab.`));
  });
}

/**
 * Open a file store backed by IndexedDB.
 *
 * @param {{ name?: string }} [options]
 * @returns {Promise<{
 *   put: (key: string, blob: Blob) => Promise<void>,
 *   get: (key: string) => Promise<Blob | undefined>,
 *   list: () => Promise<string[]>,
 *   remove: (key: string) => Promise<void>,
 *   clear: () => Promise<void>,
 *   close: () => void,
 * }>}
 */
export async function getFileStorage({ name = 'file-dropper' } = {}) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('A non-empty database name is required.');
  }

  const db = await openDatabase(name);

  async function run(mode, operation) {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const result = operation(store);

    await Promise.all([result, transactionToPromise(transaction)]);
    return result;
  }

  return {
    async put(key, blob) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('File names must be non-empty strings.');
      }
      if (!(blob instanceof Blob)) {
        throw new TypeError('Only Blob or File values can be stored.');
      }

      await run('readwrite', (store) => requestToPromise(store.put(blob, key)));
    },

    async get(key) {
      return run('readonly', (store) => requestToPromise(store.get(key)));
    },

    async list() {
      const keys = await run('readonly', (store) =>
        requestToPromise(store.getAllKeys()),
      );

      return keys.map(String).sort((a, b) => a.localeCompare(b));
    },

    async remove(key) {
      await run('readwrite', (store) => requestToPromise(store.delete(key)));
    },

    async clear() {
      await run('readwrite', (store) => requestToPromise(store.clear()));
    },

    close() {
      db.close();
    },
  };
}

export default getFileStorage;
