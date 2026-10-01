const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

let decoder;
function sharp(...args) {
  if (!decoder) {
    decoder = require('sharp');
    decoder.cache({ memory: 64, files: 0, items: 64 });
    decoder.concurrency(1);
  }
  return decoder(...args);
}
const inputOptions = { limitInputPixels: 268402689, failOn: 'error' };
const bmpWork = data => new Promise((resolve, reject) => {
  const worker = new Worker(path.join(__dirname, 'bmp-worker.cjs'), { workerData: data });
  let answered = false;
  worker.once('message', message => { answered = true; if (message.error) reject(new Error(message.error)); else resolve(message); });
  worker.once('error', reject);
  worker.once('exit', code => { if (!answered) reject(new Error(`BMP decoder exited (${code})`)); });
});

class ImageService {
  constructor(cacheDir, parallel = 4) {
    this.cacheDir = cacheDir; this.parallel = parallel;
    this.running = 0; this.queue = []; this.inflight = new Map();
  }
  schedule(key, work) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const result = new Promise((resolve, reject) => { this.queue.push({ work, resolve, reject }); this.drain(); });
    this.inflight.set(key, result);
    result.finally(() => this.inflight.delete(key)).catch(() => {});
    return result;
  }
  drain() {
    while (this.running < this.parallel && this.queue.length) {
      const task = this.queue.shift(); this.running++;
      Promise.resolve().then(task.work).then(task.resolve, task.reject).finally(() => { this.running--; this.drain(); });
    }
  }
  async thumbnail(item, signal) {
    return this.cached(item, 'thumb', 'webp', async destination => {
      if (signal?.aborted) throw new Error('Request canceled');
      if (item.extension === 'bmp') { await bmpWork({ path: item.path, destination, mode: 'thumbnail' }); return; }
      await sharp(item.path, inputOptions).autoOrient().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(destination);
    });
  }
  async full(item) {
    // Chromium displays these directly, retaining GIF/WebP animation and original detail.
    if (!['tif', 'tiff', 'svg', 'heic', 'heif'].includes(item.extension)) return item.path;
    return this.cached(item, 'full', 'png', destination => sharp(item.path, inputOptions).autoOrient().png().toFile(destination));
  }
  cached(item, kind, extension, generate) {
    const key = `${item.id}-${kind}`;
    return this.schedule(key, async () => {
      const dir = path.join(this.cacheDir, item.id.slice(0, 2));
      const destination = path.join(dir, `${key}.${extension}`);
      try { await fs.access(destination); return destination; } catch { /* cache miss */ }
      await fs.mkdir(dir, { recursive: true });
      const temporary = `${destination}.${Date.now()}.tmp`;
      try { await generate(temporary); await fs.rename(temporary, destination); }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
      return destination;
    });
  }
  metadata(item) {
    return this.schedule(`${item.id}-metadata`, async () => {
      if (item.extension === 'bmp') return bmpWork({ path: item.path, mode: 'metadata' });
      const m = await sharp(item.path, inputOptions).metadata();
      const rotated = m.orientation >= 5;
      return { width: rotated ? m.height : m.width, height: rotated ? m.width : m.height,
        format: m.format, pages: m.pages || 1, space: m.space, hasAlpha: m.hasAlpha };
    });
  }
}

// Only completed entries predating this cleanup are eligible. Decoders can run
// concurrently; ignore their temporary files and tolerate disappearing entries.
async function pruneCache(cacheDir, limit = 2 * 1024 ** 3, cutoff = Date.now()) {
  const entries = [];
  try {
    for (const dir of await fs.readdir(cacheDir, { withFileTypes: true })) if (dir.isDirectory()) {
      const folder = path.join(cacheDir, dir.name);
      for (const file of await fs.readdir(folder)) {
        if (file.endsWith('.tmp')) continue;
        const filePath = path.join(folder, file);
        const stat = await fs.stat(filePath).catch(() => null);
        if (stat?.isFile() && stat.mtimeMs < cutoff) entries.push({ path: filePath, size: stat.size, modified: stat.mtimeMs });
      }
    }
    let total = entries.reduce((n, e) => n + e.size, 0);
    entries.sort((a, b) => a.modified - b.modified);
    for (const entry of entries) {
      if (total <= limit) break;
      try { await fs.unlink(entry.path); total -= entry.size; } catch { /* Skip files in use, then keep pruning. */ }
    }
  } catch { /* Cache housekeeping must never prevent startup. */ }
}
module.exports = { ImageService, pruneCache };
