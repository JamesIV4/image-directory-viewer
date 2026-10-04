const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, clipboard, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const crypto = require('node:crypto');
const { ImageService } = require('./images.cjs');
const { SharingService } = require('./sharing.cjs');
let sharing;

if (process.platform === 'win32') app.setAppUserModelId('com.jamesiv4.image-directory-viewer');
if (process.env.LUMEN_TEST_DATA) app.setPath('userData', process.env.LUMEN_TEST_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'lumen', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, worker, cacheWorker, service, root = '', items = new Map(), snapshot = null, scanning = false, generation = 0;
let recent = [], lastRoot = '';
let sharingEnabled = true;
let decoding = false, cacheMaintenance;
async function beforeImages() {
  decoding = true;
  // Stop idle housekeeping before serving any image, so cleanup cannot remove
  // a cached file between checking its existence and streaming it to Chromium.
  if (cacheWorker) { cacheMaintenance ??= cacheWorker.terminate(); await cacheMaintenance; }
}
const dev = process.argv.includes('--dev');
const send = event => { if (window && !window.isDestroyed()) window.webContents.send('library:event', { ...event, generation }); };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const saveRecent = async () => fs.writeFile(settingsFile(), JSON.stringify({ recent, lastRoot, sharingEnabled })).catch(() => {});

async function openRoot(folder, useCache = true) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Choose an absolute folder path.');
  folder = await fs.realpath(folder);
  if (!(await fs.stat(folder)).isDirectory()) throw new Error('Please drop or choose a folder.');
  if (worker) await worker.terminate();
  const refresh = root === folder;
  generation++; root = folder; scanning = true;
  if (!refresh) { items = new Map(); snapshot = null; }
  send({ type: 'start', root, refresh });
  lastRoot = root;
  recent = [root, ...recent.filter(p => p !== root)].slice(0, 8); await saveRecent();
  const cacheKey = crypto.createHash('sha256').update(root).digest('hex');
  const current = generation;
  worker = new Worker(path.join(__dirname, 'indexer.cjs'), { workerData: {
    root, useCache, cacheFile: path.join(app.getPath('userData'), 'indexes', `${cacheKey}.json`),
  } });
  worker.on('message', event => {
    if (current !== generation) return;
    if (event.type === 'cached' || event.type === 'complete') {
      snapshot = event.data; items = new Map(event.data.items.map(item => [item.id, item]));
    } else if (event.type === 'batch') for (const item of event.items) items.set(item.id, item);
    if (event.type === 'complete' || event.type === 'error') scanning = false;
    send(event);
  });
  worker.on('error', error => { if (current === generation) { scanning = false; send({ type: 'error', message: error.message }); } });
  return { root, recent };
}

function indexed(id) {
  if (typeof id !== 'string' || !items.has(id)) throw new Error('This image is no longer in the current library.');
  return items.get(id);
}

app.whenReady().then(async () => {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  try { const data = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); recent = (data.recent || []).filter(p => typeof p === 'string').slice(0, 8); lastRoot = typeof data.lastRoot === 'string' ? data.lastRoot : recent[0] || ''; sharingEnabled = data.sharingEnabled !== false; } catch {}
  const cacheDir = path.join(app.getPath('userData'), 'thumbnails');
  service = new ImageService(cacheDir);
  const libraryState = () => {
    let data = snapshot;
    if (root && (scanning || !data)) {
      const folders = new Map([['', { path: '', name: path.basename(root), count: 0, ownCount: 0 }]]);
      for (const item of items.values()) {
        const parts = item.folder ? item.folder.split('/') : [];
        for (let i = 0; i <= parts.length; i++) {
          const folder = parts.slice(0, i).join('/');
          if (!folders.has(folder)) folders.set(folder, { path: folder, name: parts[i - 1], count: 0, ownCount: 0 });
          const entry = folders.get(folder); entry.count++; if (i === parts.length) entry.ownCount++;
        }
      }
      data = { root, items: [...items.values()], folders: [...folders.values()], warnings: [], scannedAt: 0 };
    }
    return { root, recent, scanning, snapshot: data, generation };
  };
  sharing = new SharingService({ state: libraryState, indexed, service, beforeImages, staticDir: path.join(__dirname, '..', 'dist', 'remote'), tokenFile: path.join(app.getPath('userData'), 'pairing-key.txt'), port: process.env.LUMEN_TEST_DATA ? Number(process.env.LUMEN_TEST_SHARE_PORT || 47831) : 47831 });
  if (sharingEnabled) await sharing.start().catch(error => console.error('Could not start network sharing:', error.message));
  ipcMain.handle('sharing:state', () => sharing.status());
  ipcMain.handle('sharing:set', async (_event, active) => {
    const status = await (active === true ? sharing.start() : sharing.stop());
    sharingEnabled = active === true; await saveRecent();
    return status;
  });
  protocol.handle('lumen', async request => {
    try {
      const url = new URL(request.url), id = url.pathname.slice(1);
      const item = indexed(id);
      await beforeImages();
      const file = url.hostname === 'thumb' ? await service.thumbnail(item, request.signal)
        : url.hostname === 'image' ? await service.full(item) : null;
      if (!file) return new Response('Unknown resource', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    } catch { return new Response('Image unavailable or unsupported', { status: 404 }); }
  });
  ipcMain.handle('library:state', libraryState);
  // Serialize open/refresh requests so rapid folder switches cannot interleave workers.
  let opening = Promise.resolve();
  const enqueueOpen = (folder, cache) => {
    const result = opening.then(() => openRoot(folder, cache));
    opening = result.catch(() => {}); return result;
  };
  const chooseFolder = async folder => {
    if (!folder) {
      const result = await dialog.showOpenDialog(window, { title: 'Open an image folder', properties: ['openDirectory'] });
      if (result.canceled) return null; folder = result.filePaths[0];
    }
    return enqueueOpen(folder, true);
  };
  ipcMain.handle('library:open', (_event, folder) => chooseFolder(folder));
  const rescan = () => root ? enqueueOpen(root, true) : null;
  ipcMain.handle('library:rescan', rescan);
  const cancel = async () => {
    if (worker && scanning) {
      await worker.terminate(); worker = null;
      const stopped = libraryState().snapshot;
      scanning = false;
      snapshot = { ...stopped, warnings: ['Scan stopped. Refresh to finish indexing.'], scannedAt: Date.now(), version: 1 };
      send({ type: 'complete', data: snapshot });
    }
  };
  sharing.actions = { open: chooseFolder, rescan, cancel, reveal: id => shell.showItemInFolder(indexed(id).path) };
  ipcMain.handle('library:cancel', cancel);
  ipcMain.handle('image:metadata', async (_event, id) => { const item = indexed(id); await beforeImages(); return service.metadata(item); });
  ipcMain.handle('image:reveal', (_event, id) => shell.showItemInFolder(indexed(id).path));
  ipcMain.handle('image:copy', (_event, id) => clipboard.writeText(indexed(id).path));
  ipcMain.handle('window:fullscreen', () => { window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
  nativeTheme.themeSource = 'dark'; Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 760, minHeight: 540,
    title: 'Lumen', backgroundColor: '#101114', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('app-command', (_event, command) => {
    if (command === 'browser-backward' || command === 'browser-forward') {
      window.webContents.send('window:navigate', command === 'browser-backward' ? 'back' : 'forward');
    }
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.once('ready-to-show', () => {
    if (decoding) return;
    cacheWorker = new Worker(path.join(__dirname, 'cache-worker.cjs'), { workerData: { cacheDir, cutoff: Date.now() } });
    cacheWorker.on('error', () => {}); // Disposable cache maintenance must not interrupt browsing.
  });
  if (dev) await window.loadURL('http://127.0.0.1:5173');
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  const argument = process.argv.find(arg => arg.startsWith('--folder='));
  const startupFolder = argument ? argument.slice(9) : lastRoot;
  if (startupFolder) await enqueueOpen(startupFolder, true).catch(error => send({ type: 'error', message: `Unable to reopen folder: ${error.message}` }));
});
app.on('window-all-closed', () => { void sharing?.stop(); worker?.terminate(); cacheWorker?.terminate(); app.quit(); });
