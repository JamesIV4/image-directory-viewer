const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.jpe', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff', '.svg', '.bmp', '.heic', '.heif']);
const fingerprint = (p, size, mtime) => crypto.createHash('sha256').update(`${p}\0${size}\0${mtime}`).digest('hex').slice(0, 32);
const portable = p => p.split(path.sep).join('/');

// Enumeration and stat calls never run on Electron's UI thread. No image decoding
// is needed to build the index; dimensions are read only when inspecting an image.
async function scan(root, emit = () => {}) {
  const items = [], folders = [], warnings = [];
  const queue = [''];
  let batch = [], lastEmit = Date.now();
  const flush = () => {
    if (batch.length) emit({ type: 'batch', items: batch });
    batch = []; lastEmit = Date.now();
  };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const relative = queue[cursor];
    const folder = { path: portable(relative), name: relative ? path.basename(relative) : path.basename(root), ownCount: 0, count: 0 };
    folders.push(folder);
    try {
      const dir = await fs.opendir(path.join(root, relative));
      let pending = [];
      const collect = async () => {
        const results = await Promise.all(pending); pending = [];
        for (const item of results) if (item) { items.push(item); batch.push(item); folder.ownCount++; }
        if (batch.length >= 256 || Date.now() - lastEmit > 150) flush();
      };
      for await (const entry of dir) {
        // Ignore links/junctions: avoid escaping the chosen root or recursive cycles.
        if (entry.isDirectory()) queue.push(path.join(relative, entry.name));
        else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const filePath = path.join(root, relative, entry.name);
          pending.push(fs.stat(filePath).then(stat => ({
            id: fingerprint(filePath, stat.size, stat.mtimeMs), name: entry.name,
            path: filePath, relativePath: portable(path.join(relative, entry.name)),
            folder: portable(relative), size: stat.size, modified: stat.mtimeMs,
            extension: path.extname(entry.name).slice(1).toLowerCase(),
          })).catch(() => { if (warnings.length < 50) warnings.push(`Could not read ${filePath}`); return null; }));
          if (pending.length >= 32) await collect();
        }
      }
      await collect();
    } catch (error) {
      if (warnings.length < 50) warnings.push(`${path.join(root, relative)}: ${error.code || error.message}`);
    }
    if (cursor % 16 === 0) emit({ type: 'progress', files: items.length, directories: cursor + 1 });
  }
  flush();
  const byPath = new Map(folders.map(f => [f.path, f]));
  for (let i = folders.length - 1; i >= 0; i--) {
    const f = folders[i]; f.count += f.ownCount;
  }
  // Parents always precede children in the breadth-first enumeration.
  for (let i = folders.length - 1; i > 0; i--) {
    const f = folders[i];
    const parent = byPath.get(f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '');
    if (parent) parent.count += f.count;
  }
  return { root, items, folders, warnings, scannedAt: Date.now(), version: 1 };
}

async function run() {
  const { root, cacheFile, useCache } = workerData;
  if (useCache) {
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      if (cached.version === 1 && cached.root === root && Array.isArray(cached.items)) parentPort.postMessage({ type: 'cached', data: cached });
    } catch { /* An absent or interrupted cache simply triggers a fresh scan. */ }
  }
  const data = await scan(root, message => parentPort.postMessage(message));
  parentPort.postMessage({ type: 'complete', data });
  try {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    const temporary = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data));
    await fs.rename(temporary, cacheFile);
  } catch { /* Browsing works on a read-only/full cache volume. */ }
}
if (parentPort) run().catch(error => parentPort.postMessage({ type: 'error', message: error.message }));
module.exports = { scan, fingerprint, EXTENSIONS };
