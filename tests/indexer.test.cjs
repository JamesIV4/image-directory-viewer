const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { scan } = require('../electron/indexer.cjs');

test('recursive index streams images, keeps Unicode paths, counts folders, and skips link cycles', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '日本語', 'deep'), { recursive: true });
  await fs.mkdir(path.join(root, 'empty'));
  await Promise.all([
    fs.writeFile(path.join(root, 'root.PNG'), 'x'),
    fs.writeFile(path.join(root, '日本語', 'a space #%.jpg'), 'yy'),
    fs.writeFile(path.join(root, '日本語', 'deep', 'sample.tiff'), 'zzz'),
    fs.writeFile(path.join(root, 'ignored.txt'), 'not an image'),
  ]);
  await fs.symlink(root, path.join(root, 'cycle'), 'junction');
  const batches = [];
  const result = await scan(root, event => { if (event.type === 'batch') batches.push(...event.items); });
  assert.equal(result.items.length, 3); assert.equal(batches.length, 3);
  assert.equal(result.folders.length, 4);
  assert.equal(result.folders.find(f => f.path === '').count, 3);
  assert.equal(result.folders.find(f => f.path === '').ownCount, 1);
  assert.equal(result.folders.find(f => f.path === '日本語').count, 2);
  assert.equal(result.folders.find(f => f.path === 'empty').count, 0);
  assert.ok(result.items.some(i => i.relativePath === '日本語/a space #%.jpg'));
  assert.deepEqual(result.warnings, []);
  const old = result.items.find(i => i.name === 'root.PNG');
  await fs.writeFile(old.path, 'new content');
  const refreshed = await scan(root);
  assert.notEqual(refreshed.items.find(i => i.name === 'root.PNG').id, old.id);
  await fs.unlink(old.path);
  assert.equal((await scan(root)).items.length, 2);
});

test('scan reports inaccessible roots without crashing', async () => {
  const result = await scan(path.join(os.tmpdir(), 'nonexistent-lumen-root-12345'));
  assert.equal(result.items.length, 0); assert.equal(result.warnings.length, 1);
});
