import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { getFileStorage } from '../../tools/nookbin/extension/src/lib/idb-file-storage.js';

const TEST_DB_PREFIX = 'file-dropper-test';

let dbNames;
let openStores;

beforeEach(() => {
  dbNames = new Set();
  openStores = [];
});

afterEach(async () => {
  for (const store of openStores) {
    store.close();
  }

  openStores = [];

  for (const name of dbNames) {
    await deleteDatabase(name);
  }

  dbNames.clear();
});

function newDbName() {
  const name = `${TEST_DB_PREFIX}-${crypto.randomUUID()}`;
  dbNames.add(name);
  return name;
}

async function openStore(name = newDbName()) {
  const store = await getFileStorage({ name });
  openStores.push(store);
  return store;
}

function makeFile(name, contents, type = 'text/plain') {
  return new File([contents], name, {
    type,
    lastModified: 1_700_000_000_000,
  });
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);

    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

describe('getFileStorage', () => {
  it('rejects an empty database name', async () => {
    await assert.rejects(
      () => getFileStorage({ name: '' }),
      /non-empty database name/,
    );
  });

  it('starts with an empty file list', async () => {
    const store = await openStore();

    assert.deepEqual(await store.list(), []);
    assert.equal(await store.get('missing.txt'), undefined);
  });

  it('rejects when IndexedDB cannot be opened', async () => {
    const originalIndexedDB = globalThis.indexedDB;

    globalThis.indexedDB = {
      open() {
        throw new Error('indexedDB.open failed');
      },
    };

    try {
      await assert.rejects(
        () => getFileStorage({ name: newDbName() }),
        /indexedDB\.open failed/,
      );
    } finally {
      globalThis.indexedDB = originalIndexedDB;
    }
  });
});

describe('storing and reading files', () => {
  it('stores a file and reads its contents back', async () => {
    const store = await openStore();
    const file = makeFile('report.pdf', 'pdf bytes', 'application/pdf');

    await store.put(file.name, file);

    const stored = await store.get('report.pdf');

    assert.ok(stored instanceof Blob);
    assert.equal(stored.type, 'application/pdf');
    assert.equal(stored.size, file.size);
    assert.equal(await stored.text(), 'pdf bytes');
    assert.deepEqual(await store.list(), ['report.pdf']);
  });

  it('stores plain Blob values', async () => {
    const store = await openStore();
    const blob = new Blob(['blob bytes'], {
      type: 'application/octet-stream',
    });

    await store.put('blob.bin', blob);

    const stored = await store.get('blob.bin');
    assert.ok(stored instanceof Blob);
    assert.equal(stored.type, 'application/octet-stream');
    assert.equal(await stored.text(), 'blob bytes');
  });

  it('preserves File metadata', async () => {
    const store = await openStore();
    const file = makeFile('meta.txt', 'meta', 'text/plain');

    await store.put(file.name, file);

    const stored = await store.get('meta.txt');
    assert.ok(stored instanceof File);
    assert.equal(stored.name, 'meta.txt');
    assert.equal(stored.type, 'text/plain');
    assert.equal(stored.lastModified, file.lastModified);
  });

  it('stores multiple files and lists their names in sorted order', async () => {
    const store = await openStore();

    await store.put('zeta.txt', makeFile('zeta.txt', 'zeta'));
    await store.put('alpha.txt', makeFile('alpha.txt', 'alpha'));
    await store.put('middle.txt', makeFile('middle.txt', 'middle'));

    assert.deepEqual(await store.list(), ['alpha.txt', 'middle.txt', 'zeta.txt']);
  });

  it('stores empty files', async () => {
    const store = await openStore();
    const file = makeFile('empty.txt', '');

    await store.put(file.name, file);

    const stored = await store.get('empty.txt');
    assert.ok(stored instanceof Blob);
    assert.equal(stored.size, 0);
    assert.equal(await stored.text(), '');
  });

  it('supports unicode file names', async () => {
    const store = await openStore();

    await store.put('résumé.pdf', makeFile('résumé.pdf', 'pdf', 'application/pdf'));

    const stored = await store.get('résumé.pdf');
    assert.ok(stored instanceof Blob);
    assert.equal(await stored.text(), 'pdf');
    assert.deepEqual(await store.list(), ['résumé.pdf']);
  });

  it('handles simultaneous writes', async () => {
    const store = await openStore();
    const names = ['a.txt', 'b.txt', 'c.txt'];

    await Promise.all(
      names.map((name) => store.put(name, makeFile(name, name))),
    );

    assert.deepEqual(await store.list(), names);

    for (const name of names) {
      const stored = await store.get(name);
      assert.ok(stored instanceof Blob);
      assert.equal(await stored.text(), name);
    }
  });
});

describe('removing files', () => {
  it('removes a stored file without affecting the others', async () => {
    const store = await openStore();

    await store.put('keep.txt', makeFile('keep.txt', 'keep'));
    await store.put('remove.txt', makeFile('remove.txt', 'remove'));

    await store.remove('remove.txt');

    assert.equal(await store.get('remove.txt'), undefined);
    assert.deepEqual(await store.list(), ['keep.txt']);
  });

  it('does not fail when removing a file that does not exist', async () => {
    const store = await openStore();
    await store.put('keep.txt', makeFile('keep.txt', 'keep'));

    await store.remove('missing.txt');

    assert.deepEqual(await store.list(), ['keep.txt']);
  });

  it('clears every stored file', async () => {
    const store = await openStore();

    await store.put('one.txt', makeFile('one.txt', 'one'));
    await store.put('two.txt', makeFile('two.txt', 'two'));

    await store.clear();

    assert.deepEqual(await store.list(), []);
    assert.equal(await store.get('one.txt'), undefined);
    assert.equal(await store.get('two.txt'), undefined);
  });
});

describe('duplicate file names', () => {
  it('replaces the existing entry when the same name is stored again', async () => {
    const store = await openStore();

    await store.put(
      'notes.txt',
      makeFile('notes.txt', 'first version', 'text/plain'),
    );
    await store.put(
      'notes.txt',
      makeFile('notes.txt', 'second version', 'text/markdown'),
    );

    const stored = await store.get('notes.txt');

    assert.ok(stored instanceof Blob);
    assert.equal(await stored.text(), 'second version');
    assert.equal(stored.type, 'text/markdown');
    assert.deepEqual(await store.list(), ['notes.txt']);
  });
});

describe('persistence and isolation', () => {
  it('keeps files after the connection is closed and reopened', async () => {
    const name = newDbName();
    const first = await openStore(name);

    await first.put('persistent.txt', makeFile('persistent.txt', 'still here'));
    first.close();

    const reopened = await openStore(name);
    const stored = await reopened.get('persistent.txt');

    assert.ok(stored instanceof Blob);
    assert.equal(await stored.text(), 'still here');
    assert.deepEqual(await reopened.list(), ['persistent.txt']);
  });

  it('shares data between multiple connections to the same database', async () => {
    const name = newDbName();
    const first = await openStore(name);
    const second = await openStore(name);

    await first.put('shared.txt', makeFile('shared.txt', 'shared'));
    const stored = await second.get('shared.txt');

    assert.ok(stored instanceof Blob);
    assert.equal(await stored.text(), 'shared');

    await second.remove('shared.txt');
    assert.equal(await first.get('shared.txt'), undefined);
  });

  it('keeps different database names isolated', async () => {
    const first = await openStore(newDbName());
    const second = await openStore(newDbName());

    await first.put('same.txt', makeFile('same.txt', 'from first'));
    await second.put('same.txt', makeFile('same.txt', 'from second'));

    assert.equal(await (await first.get('same.txt')).text(), 'from first');
    assert.equal(await (await second.get('same.txt')).text(), 'from second');
    assert.deepEqual(await first.list(), ['same.txt']);
    assert.deepEqual(await second.list(), ['same.txt']);
  });

  it('rejects operations after the connection is closed', async () => {
    const store = await openStore();
    store.close();

    await assert.rejects(() => store.list());
  });
});

describe('input validation', () => {
  it('rejects empty and non-string file names', async () => {
    const store = await openStore();
    const file = makeFile('valid.txt', 'data');

    await assert.rejects(() => store.put('', file), /non-empty strings/);
    await assert.rejects(() => store.put(42, file), /non-empty strings/);
  });

  it('rejects values that are not Blob or File objects', async () => {
    const store = await openStore();

    await assert.rejects(
      () => store.put('notes.txt', 'plain text'),
      /Blob or File/,
    );
  });
});
