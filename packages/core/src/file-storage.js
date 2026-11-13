// File storage interface for the suite's tools.
//
// A backend performs the actual persistence (IndexedDB today, other backends
// for future targets such as a native port). createFileStorage wraps a backend
// with the shared input validation so every target validates identically.

/**
 * Wrap a storage backend in the shared file storage interface.
 *
 * The backend must expose:
 * put(key, blob), get(key), list(), remove(key), clear(), close().
 *
 * @param {object} backend
 * @returns {{
 *   put: (key: string, blob: Blob) => Promise<void>,
 *   get: (key: string) => Promise<Blob | undefined>,
 *   list: () => Promise<string[]>,
 *   remove: (key: string) => Promise<void>,
 *   clear: () => Promise<void>,
 *   close: () => void,
 * }}
 */
export function createFileStorage(backend) {
  if (!backend || typeof backend !== 'object') {
    throw new TypeError('A storage backend is required.');
  }

  return {
    async put(key, blob) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('File names must be non-empty strings.');
      }
      if (!(blob instanceof Blob)) {
        throw new TypeError('Only Blob or File values can be stored.');
      }

      await backend.put(key, blob);
    },

    async get(key) {
      return backend.get(key);
    },

    async list() {
      return backend.list();
    },

    async remove(key) {
      await backend.remove(key);
    },

    async clear() {
      await backend.clear();
    },

    close() {
      backend.close();
    },
  };
}
