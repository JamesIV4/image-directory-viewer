const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { ImageService, pruneCache } = require('../electron/images.cjs');

test('image service loads the native decoder only when decoding is requested', async t => {
  const { Worker } = require('node:worker_threads');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-lazy-decoder-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'image.png');
  await sharp({ create: { width: 10, height: 20, channels: 3, background: '#123456' } }).png().toFile(source);
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { ImageService } = require(workerData.module);
      const loaded = () => Object.keys(require.cache).some(file => /[\\\\/]sharp[\\\\/]/.test(file));
      (async () => {
        const service = new ImageService(workerData.root);
        const before = loaded();
        await service.full({ path: workerData.source, extension: 'png' });
        const direct = loaded();
        const metadata = await service.metadata({ id: 'lazy', path: workerData.source, extension: 'png' });
        parentPort.postMessage({ before, direct, after: loaded(), metadata });
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { module: require.resolve('../electron/images.cjs'), root, source } });
    worker.once('message', resolve); worker.once('error', reject);
  });
  assert.equal(result.before, false);
  assert.equal(result.direct, false);
  assert.equal(result.after, true);
  assert.equal(result.metadata.width, 10);
  assert.equal(result.metadata.height, 20);
});

test('cache housekeeping preserves temporary and newly generated files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-prune-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'ab');
  await fs.mkdir(folder);
  const old = path.join(folder, 'old.webp'), fresh = path.join(folder, 'fresh.webp'), temporary = path.join(folder, 'active.tmp');
  await Promise.all([old, fresh, temporary].map(file => fs.writeFile(file, 'cache')));
  const cutoff = Date.now();
  await fs.utimes(old, new Date(cutoff - 10000), new Date(cutoff - 10000));
  await fs.utimes(fresh, new Date(cutoff + 10000), new Date(cutoff + 10000));
  await pruneCache(root, 0, cutoff);
  await assert.rejects(fs.stat(old), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(folder)).sort(), ['active.tmp', 'fresh.webp']);
});

test('thumbnail cache deduplicates work, respects aspect/orientation, and converts TIFF originals', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'oriented.jpg');
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#79589d' } }).withMetadata({ orientation: 6 }).jpeg().toFile(source);
  const service = new ImageService(path.join(root, 'cache'), 2);
  const item = { id: 'abcd1234', path: source, extension: 'jpg' };
  const thumbnails = await Promise.all(Array.from({ length: 12 }, () => service.thumbnail(item)));
  assert.equal(new Set(thumbnails).size, 1);
  const m = await sharp(thumbnails[0]).metadata();
  assert.equal(m.height, 640); assert.equal(m.width, 427);
  const details = await service.metadata(item);
  assert.equal(details.width, 800); assert.equal(details.height, 1200);
  assert.equal(await service.full(item), source);
  const modified = (await fs.stat(thumbnails[0])).mtimeMs;
  await service.thumbnail(item);
  assert.equal((await fs.stat(thumbnails[0])).mtimeMs, modified);
  const tiff = path.join(root, 'test.tif');
  await sharp(source).tiff().toFile(tiff);
  const full = await service.full({ id: 'efgh5678', path: tiff, extension: 'tif' });
  assert.equal((await sharp(full).metadata()).format, 'png');
  await pruneCache(path.join(root, 'cache'), 0);
  await assert.rejects(fs.stat(thumbnails[0]));
});

test('failed decoding does not poison the queue or leave temporary files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-errors-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bad = path.join(root, 'broken.png'), good = path.join(root, 'good.png');
  await fs.writeFile(bad, 'broken');
  await sharp({ create: { width: 20, height: 20, channels: 4, background: '#123456' } }).png().toFile(good);
  const service = new ImageService(path.join(root, 'cache'), 1);
  const outcomes = await Promise.allSettled([
    service.thumbnail({ id: 'aa000', path: bad }), service.thumbnail({ id: 'bb111', path: good }),
  ]);
  assert.equal(outcomes[0].status, 'rejected'); assert.equal(outcomes[1].status, 'fulfilled');
  assert.deepEqual(await fs.readdir(path.join(root, 'cache', 'aa')), []);
  assert.equal(service.running, 0);
});

test('BMP package runs off-thread with accurate colors and metadata', async t => {
  const bmp = require('bmp-js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumen-bmp-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'red.bmp');
  // bmp-js uses ABGR input, not RGBA.
  await fs.writeFile(source, bmp.encode({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) }).data);
  const service = new ImageService(path.join(root, 'cache'));
  const item = { id: 'bmp000', path: source, extension: 'bmp' };
  const output = await service.thumbnail(item);
  const rgb = await sharp(output).raw().toBuffer();
  assert.ok(rgb[0] > 240); assert.ok(rgb[1] < 15); assert.ok(rgb[2] < 15);
  const metadata = await service.metadata(item);
  assert.equal(metadata.width, 1); assert.equal(metadata.height, 1);
});
