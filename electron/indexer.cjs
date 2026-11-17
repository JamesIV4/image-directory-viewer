const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.jpe', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff', '.svg', '.bmp', '.heic', '.heif']);
const fingerprint = (p, size, mtime) => crypto.hash('sha256', `${p}\0${size}\0${mtime}`).slice(0, 32);
const portable = p => p.split(path.sep).join('/');
const isImage = name => EXTENSIONS.has(path.extname(name).toLowerCase());
const parentFolder = folder => folder.slice(0, Math.max(0, folder.lastIndexOf('/')));
const DIRECTORY_CONCURRENCY = 4;
const STAT_BATCH_SIZE = 16;

function imageItem(filePath, stat, folder, name, extension) {
  return {
    id: fingerprint(filePath, stat.size, stat.mtimeMs), name, path: filePath,
    relativePath: folder ? `${folder}/${name}` : name, folder, size: stat.size, modified: stat.mtimeMs, extension,
  };
}

// Enumeration and stat calls never run on Electron's UI thread. No image decoding
// is needed to build the index; dimensions are read only when inspecting an image.
async function scan(root, emit, branch = '') {
  const items = [], folders = [], warnings = [];
  const queue = [branch];
  let cursor = 0, active = 0, completed = 0;
  let batch = [], lastBatch = 0, lastProgress = Date.now();
  const flush = () => {
    if (!batch.length) return;
    emit({ type: 'batch', items: batch });
    batch = []; lastBatch = Date.now();
  };
  function progress() {
    emit({ type: 'progress', files: items.length, directories: completed });
    lastProgress = Date.now();
  }
  const finished = Promise.withResolvers();
  function schedule() {
    while (active < DIRECTORY_CONCURRENCY && cursor < queue.length) {
      active++;
      void scanDirectory(queue[cursor++]).then(() => {
        active--;
        completed++;
        if (emit && (completed === 1 || Date.now() - lastProgress >= 150)) progress();
        schedule();
      }).catch(finished.reject);
    }
    if (!active) finished.resolve();
  }
  async function scanDirectory(relative) {
    const directory = path.join(root, relative);
    const folder = { path: portable(relative), name: relative ? path.basename(relative) : path.basename(root), ownCount: 0, count: 0 };
    folders.push(folder);
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      // Queue subfolders before waiting for this folder's metadata, and skip links and junctions.
      for (const entry of entries) if (entry.isDirectory()) queue.push(path.join(relative, entry.name));
      schedule();
      let pending = [];
      const collect = async () => {
        for (const item of await Promise.all(pending)) if (item) {
          items.push(item); folder.ownCount++;
          if (emit) batch.push(item);
        }
        pending = [];
        if (emit && (batch.length >= 512 || Date.now() - lastBatch >= 150)) flush();
      };
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!EXTENSIONS.has(extension)) continue;
        const filePath = path.join(directory, entry.name);
        pending.push(fs.lstat(filePath).then(stat => stat.isFile()
          ? imageItem(filePath, stat, folder.path, entry.name, extension.slice(1)) : null,
        () => { if (warnings.length < 50) warnings.push(`Could not read ${filePath}`); return null; }));
        if (pending.length >= STAT_BATCH_SIZE) await collect();
      }
      if (pending.length) await collect();
    } catch (error) {
      if (warnings.length < 50) warnings.push(`${directory}: ${error.code || error.message}`);
    }
  }
  schedule();
  await finished.promise;
  if (emit) { flush(); progress(); }
  const byPath = new Map(folders.map(f => [f.path, f]));
  // Parents are queued before their children, even when another branch finishes first.
  for (let i = folders.length - 1; i >= 0; i--) {
    const f = folders[i];
    f.count += f.ownCount;
    const parent = i > 0 ? byPath.get(parentFolder(f.path)) : null;
    if (parent) parent.count += f.count;
  }
  return { root, items, folders, warnings, scannedAt: Date.now(), version: 1 };
}

// Register before enumeration so files created during the initial scan are reconciled too.
function watchLibrary(root, emit) {
  let files, folders, watcher, warnings, timer, busy = false, firstEvent = 0, watchError;
  const queued = new Map();
  const schedule = () => {
    if (!files || busy || !queued.size) return;
    clearTimeout(timer);
    // Coalesce repeated writes while bounding the delay during sustained imports.
    timer = setTimeout(flush, Math.min(400, Math.max(0, firstEvent + 2000 - Date.now())));
  };
  const reportError = error => {
    watchError = `Folder watching stopped (${error.code || error.message}). Refresh the library to try again.`;
    watcher?.close();
    if (warnings) emit({ type: 'update', items: [], removed: [], folders: [], removedFolders: [], warnings: [...warnings, watchError] });
  };
  try {
    watcher = watch(root, { recursive: true }, (event, filename) => {
      const relative = filename ? path.normalize(filename) : '';
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return;
      if (event === 'change' && relative && !isImage(relative)) return;
      if (!queued.size) firstEvent = Date.now();
      queued.set(relative === '.' ? '' : relative, queued.get(relative) === 'rename' ? 'rename' : event);
      schedule();
    });
    watcher.on('error', reportError);
  } catch (error) { reportError(error); }

  async function flush() {
    busy = true;
    const targets = [...queued].sort(([a], [b]) => a.length - b.length);
    queued.clear();
    const updated = [], removed = [], touched = new Set(), removedFolders = [];
    const covered = new Set(), resolvedParents = new Map();
    const setFile = (file, item) => {
      const old = files.get(file);
      if (old?.id === item?.id) return;
      if (old) removed.push({ id: old.id, path: file });
      if (item) { files.set(file, item); updated.push(item); }
      else files.delete(file);
      const change = Number(!!item) - Number(!!old);
      if (!change) return;
      let key = (item || old).folder;
      const own = folders.get(key);
      if (own) own.ownCount += change;
      while (true) {
        const folder = folders.get(key);
        if (folder) { folder.count += change; touched.add(key); }
        if (!key) break;
        key = parentFolder(key);
      }
    };
    const reconcileBranch = async (relative, exists) => {
      const key = portable(relative);
      const within = folder => !key || folder === key || folder.startsWith(`${key}/`);
      const known = folders.has(key);
      const next = exists ? await scan(root, undefined, relative) : { items: [], folders: [] };
      for (const folder of next.folders) if (!folders.has(folder.path)) {
        folders.set(folder.path, { ...folder, count: 0, ownCount: 0 });
        touched.add(folder.path);
      }
      for (const item of next.items) setFile(item.path, item);
      // An unreadable branch is not evidence that its indexed files were deleted.
      if (!next.warnings?.length) {
        if (known) {
          const nextFiles = new Set(next.items.map(item => item.path));
          const nextFolders = new Set(next.folders.map(folder => folder.path));
          for (const [file, item] of files) if (within(item.folder) && !nextFiles.has(file)) setFile(file, null);
          for (const folder of folders.keys()) if (within(folder) && !nextFolders.has(folder)) {
            folders.delete(folder);
            removedFolders.push(folder);
          }
        }
        covered.add(relative);
      }
    };
    const isCovered = relative => {
      if (covered.has('')) return true;
      for (let target = relative; target !== '.'; target = path.dirname(target)) {
        if (covered.has(target)) return true;
      }
      return false;
    };
    const inspect = async relative => {
      const file = path.join(root, relative);
      const parent = path.dirname(file);
      try {
        if (!resolvedParents.has(parent)) resolvedParents.set(parent, fs.realpath(parent));
        // Match the initial scan's policy of ignoring links and junctions.
        const resolved = await resolvedParents.get(parent);
        const stat = resolved === parent ? await fs.lstat(file) : null;
        return { file, stat };
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { file, stat: null };
      }
    };
    const reconcileTarget = async (relative, event, result) => {
      const { file, stat } = result;
      const key = portable(relative);
      if (stat?.isDirectory()) {
        if (!folders.has(key) || event === 'rename') await reconcileBranch(relative, true);
        return;
      }
      if (folders.has(key)) await reconcileBranch(relative, false);
      const item = stat?.isFile() && isImage(file) ? imageItem(file, stat, parentFolder(key), path.basename(file), path.extname(file).slice(1).toLowerCase()) : null;
      if (item && !folders.has(item.folder)) {
        // A child event can arrive before its new directory's event.
        let branch = item.folder;
        while (branch && !folders.has(parentFolder(branch))) branch = parentFolder(branch);
        await reconcileBranch(path.normalize(branch), true);
      } else setFile(file, item);
    };
    try {
      if (targets[0][0] === '') await reconcileBranch('', true);
      for (let offset = 0; offset < targets.length && !covered.has(''); offset += STAT_BATCH_SIZE) {
        const batch = targets.slice(offset, offset + STAT_BATCH_SIZE).filter(([relative]) => relative && !isCovered(relative));
        const results = await Promise.all(batch.map(([relative]) => inspect(relative)));
        // Apply parent events first, skipping children already handled by a branch scan.
        for (let i = 0; i < batch.length; i++) {
          const [relative, event] = batch[i];
          if (results[i] && !isCovered(relative)) await reconcileTarget(relative, event, results[i]);
        }
      }
      const changedFolders = [...touched].map(key => folders.get(key)).filter(Boolean);
      if (updated.length || removed.length || changedFolders.length || removedFolders.length) {
        emit({ type: 'update', items: updated, removed, folders: changedFolders, removedFolders });
      }
    } catch (error) { reportError(error); }
    finally { busy = false; schedule(); }
  }

  return data => {
    files = new Map(data.items.map(item => [item.path, item]));
    folders = new Map(data.folders.map(folder => [folder.path, { ...folder }]));
    warnings = data.warnings;
    if (watchError) warnings.push(watchError);
    schedule();
  };
}

async function run() {
  const { root, cacheFile, useCache } = workerData;
  if (useCache) {
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      if (cached.version === 1 && cached.root === root && Array.isArray(cached.items)) parentPort.postMessage({ type: 'cached', data: cached });
    } catch { /* An absent or interrupted cache simply triggers a fresh scan. */ }
  }
  const emit = message => parentPort.postMessage(message);
  const startWatching = watchLibrary(root, emit);
  const data = await scan(root, emit);
  startWatching(data);
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
