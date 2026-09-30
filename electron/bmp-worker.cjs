const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const bmp = require('bmp-js');
const sharp = require('sharp');

// The package's BMP decoder is JavaScript, so isolate its CPU work in a worker.
// Validate the header before decoding: bmp-js allocates from the declared size.
(async () => {
  const source = await fs.readFile(workerData.path);
  if (source.length < 54 || source.toString('ascii', 0, 2) !== 'BM' || source.readUInt32LE(14) < 40) throw new Error('Unsupported BMP header');
  const width = source.readInt32LE(18), height = Math.abs(source.readInt32LE(22));
  if (width <= 0 || height <= 0 || width * height > 100000000) throw new Error('BMP exceeds the decoding limit');
  if (workerData.mode === 'metadata') {
    parentPort.postMessage({ width, height, format: 'bmp', pages: 1, space: 'srgb', hasAlpha: false }); return;
  }
  const decoded = bmp.decode(source);
  const rgb = Buffer.allocUnsafe(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgb[pixel * 3] = decoded.data[pixel * 4 + 3];
    rgb[pixel * 3 + 1] = decoded.data[pixel * 4 + 2];
    rgb[pixel * 3 + 2] = decoded.data[pixel * 4 + 1];
  }
  sharp.cache(false); sharp.concurrency(1);
  await sharp(rgb, { raw: { width, height, channels: 3 } }).resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(workerData.destination);
  parentPort.postMessage({ ok: true });
})().catch(error => parentPort.postMessage({ error: error.message }));
