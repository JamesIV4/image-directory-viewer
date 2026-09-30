const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, clipboard, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const crypto = require('node:crypto');
const { ImageService, pruneCache } = require('./images.cjs');

if (process.env.LUMEN_TEST_DATA) app.setPath('userData', process.env.LUMEN_TEST_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'lumen', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, worker, service, root = '', items = new Map(), snapshot = null, scanning = false, generation = 0;
let recent = [];
const dev = process.argv.includes('--dev');
const send = event => { if (window && !window.isDestroyed()) window.webContents.send('library:event', { ...event, generation }); };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const saveRecent = async () => fs.writeFile(settingsFile(), JSON.stringify({ recent })).catch(() => {});

async function openRoot(folder, useCache = true) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Choose an absolute folder path.');
  folder = await fs.realpath(folder);
  if (!(await fs.stat(folder)).isDirectory()) throw new Error('Please drop or choose a folder.');
  if (worker) await worker.terminate();
  const refresh = root === folder;
  generation++; root = folder; scanning = true;
  if (!refresh) { items = new Map(); snapshot = null; }
  send({ type: 'start', root, refresh });
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
  try { const data = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); recent = (data.recent || []).filter(p => typeof p === 'string').slice(0, 8); } catch {}
  const cacheDir = path.join(app.getPath('userData'), 'thumbnails');
  await pruneCache(cacheDir);
  service = new ImageService(cacheDir);
  protocol.handle('lumen', async request => {
    try {
      const url = new URL(request.url), id = url.pathname.slice(1);
      const item = indexed(id);
      const file = url.hostname === 'thumb' ? await service.thumbnail(item, request.signal)
        : url.hostname === 'image' ? await service.full(item) : null;
      if (!file) return new Response('Unknown resource', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    } catch { return new Response('Image unavailable or unsupported', { status: 404 }); }
  });
  ipcMain.handle('library:state', () => ({ root, recent, scanning, snapshot: snapshot || (root ? { root, items: [...items.values()], folders: [], warnings: [], scannedAt: 0 } : null), generation }));
  // Serialize open/refresh requests so rapid folder switches cannot interleave workers.
  let opening = Promise.resolve();
  const enqueueOpen = (folder, cache) => {
    const result = opening.then(() => openRoot(folder, cache));
    opening = result.catch(() => {}); return result;
  };
  ipcMain.handle('library:open', async (_event, folder) => {
    if (!folder) {
      const result = await dialog.showOpenDialog(window, { title: 'Open an image folder', properties: ['openDirectory'] });
      if (result.canceled) return null; folder = result.filePaths[0];
    }
    return enqueueOpen(folder, true);
  });
  ipcMain.handle('library:rescan', () => root ? enqueueOpen(root, true) : null);
  ipcMain.handle('library:cancel', async () => {
    if (worker && scanning) {
      await worker.terminate(); worker = null; scanning = false;
      send({ type: 'complete', data: { root, items: [...items.values()], folders: snapshot?.folders || [], warnings: ['Scan stopped. Refresh to finish indexing.'], scannedAt: Date.now(), version: 1 } });
    }
  });
  ipcMain.handle('image:metadata', (_event, id) => service.metadata(indexed(id)));
  ipcMain.handle('image:reveal', (_event, id) => shell.showItemInFolder(indexed(id).path));
  ipcMain.handle('image:copy', (_event, id) => clipboard.writeText(indexed(id).path));
  ipcMain.handle('window:fullscreen', () => { window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
  nativeTheme.themeSource = 'dark'; Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 760, minHeight: 540,
    title: 'Lumen', backgroundColor: '#101114', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  if (dev) await window.loadURL('http://127.0.0.1:5173');
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  const argument = process.argv.find(arg => arg.startsWith('--folder='));
  if (argument) await enqueueOpen(argument.slice(9), true).catch(error => send({ type: 'error', message: error.message }));
});
app.on('window-all-closed', () => { worker?.terminate(); app.quit(); });
