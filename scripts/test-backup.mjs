import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';

await mkdir('.cache/backup-tests', { recursive: true });
for (const name of ['types', 'storage', 'backup']) {
  const source = (await readFile(`src/${name}.ts`, 'utf8')).replace(/from '\.\/(types|storage)'/g, "from './$1.mjs'");
  await writeFile(`.cache/backup-tests/${name}.mjs`, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { initialState, saveState } = await import('../.cache/backup-tests/storage.mjs');
const { parseBackup } = await import('../.cache/backup-tests/backup.mjs');
const original = initialState();
original.garments.push({ ...original.garments[0], id: 'custom-photo', name: '写真の服', pattern: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=' });
original.selected.top = 'custom-photo';
original.body = { width: 1.2, height: .95 };
original.outfits.push({ id: 'saved', name: '保存コーデ', garmentIds: { ...original.selected }, body: { ...original.body }, createdAt: 100 });
const serialize = state => JSON.stringify({ version: 1, ...state });
assert.deepEqual(parseBackup(serialize(original)), original, 'Images, outfits, body and selections round-trip');
const empty = { ...original, garments: [], outfits: [], selected: {} };
assert.deepEqual(parseBackup(serialize(empty)), empty, 'Empty wardrobe remains empty');
const legacy = structuredClone(original);
delete legacy.categoryVersion;
legacy.materialVersion = 1;
legacy.garments = legacy.garments.filter(g => g.template !== 'cargo');
legacy.garments.filter(g => g.template === 'jacket').forEach(g => { g.category = 'outer'; });
legacy.selected = { outer: 'sample-4' };
legacy.outfits[0].garmentIds = { outer: 'sample-5' };
const migrated = parseBackup(serialize(legacy));
assert.equal(migrated.selected.top, 'sample-4');
assert.equal(migrated.outfits[0].garmentIds.top, 'sample-5');
assert.equal(migrated.materialVersion, 2);
assert.equal(migrated.categoryVersion, 1);
const bad = [
  x => { x.version = 99; },
  x => { x.garments.push(x.garments[0]); },
  x => { x.outfits.push(x.outfits[0]); },
  x => { x.selected.top = 'missing'; },
  x => { x.outfits[0].garmentIds.top = 'sample-6'; },
  x => { x.body.width = 100; },
  x => { x.garments[0].template = '__proto__'; },
  x => { x.garments[0].color = 'url(https://example.com)'; },
  x => { x.garments[0].image = 'https://example.com/photo.png'; },
  x => { x.garments[0].pattern = 'unknown'; },
  x => { x.garments[0].createdAt = null; },
  x => { x.materialVersion = 99; },
];
for (const edit of bad) {
  const value = JSON.parse(serialize(original)); edit(value);
  assert.throws(() => parseBackup(JSON.stringify(value)));
}
assert.throws(() => parseBackup('{'));
assert.throws(() => parseBackup('null'));
assert.throws(() => parseBackup(' '.repeat(50 * 1024 * 1024 + 1)), /50 MB/);
const injected = JSON.parse(serialize(original));
injected.unexpected = 'discard';
assert.equal(parseBackup(JSON.stringify(injected)).unexpected, undefined);

// Model the IndexedDB contract: put success alone is NOT transaction success.
let persisted = structuredClone(original);
let abortWrite = false;
globalThis.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        close() {},
        transaction() {
          let pending;
          const tx = {
            objectStore: () => ({ put(value) { pending = structuredClone(value); } }),
          };
          setTimeout(() => {
            if (abortWrite) {
              tx.error = new DOMException('full', 'QuotaExceededError'); tx.onabort();
            } else { persisted = pending; tx.oncomplete(); }
          }, 0);
          return tx;
        },
      };
      request.onsuccess();
    });
    return request;
  },
};
abortWrite = true;
await assert.rejects(saveState(migrated), { name: 'QuotaExceededError' });
assert.deepEqual(persisted, original, 'Aborted import preserves saved data');
abortWrite = false;
await saveState(migrated);
assert.deepEqual(persisted, migrated, 'Successful transaction replaces saved data');
console.log('PASS: backup round-trip, legacy migration, invalid files, size limit, atomic save/abort');
