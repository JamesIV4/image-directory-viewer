const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Bonjour } = require('bonjour-service');

const PAGE_ORIGIN = 'https://jamesiv4.github.io';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp' };
class SharingService {
  constructor({ state, indexed, service, beforeImages, staticDir, tokenFile, actions, port = 47831 }) {
    Object.assign(this, { state, indexed, service, beforeImages, staticDir, tokenFile, actions, port });
  }
  status() {
    const port = this.server?.address()?.port;
    const addresses = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${port}`);
    return { active: !!port, token: port ? this.token : '', addresses: port ? [...new Set(addresses)] : [], port };
  }
  async start(port = this.port, host = '0.0.0.0') {
    if (this.server) return this.status();
    if (!this.token && this.tokenFile) {
      try { this.token = (await fs.readFile(this.tokenFile, 'utf8')).trim(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!/^[A-Z0-9]{5}$/.test(this.token || '')) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      this.token = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    }
    if (this.tokenFile) await fs.writeFile(this.tokenFile, this.token, { mode: 0o600 });
    const server = http.createServer((req, res) => this.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end('Resource unavailable');
    }));
    server.requestTimeout = 30000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    this.server = server;
    // Browsers can resolve a known .local host, but cannot browse DNS-SD themselves.
    if (host === '0.0.0.0') {
      try {
        this.discovery = new Bonjour({}, error => console.error('Lumen discovery:', error.message));
        this.discovery.publish({ name: 'Lumen', host: 'lumen.local', type: 'http', port: this.status().port, disableIPv6: true });
      } catch (error) {
        this.discovery?.destroy(); this.discovery = null;
        console.error('Could not advertise Lumen:', error.message);
      }
    }
    return this.status();
  }
  async stop() {
    const server = this.server; this.server = null;
    if (this.discovery) {
      const discovery = this.discovery; this.discovery = null;
      await new Promise(resolve => discovery.unpublishAll(resolve));
      discovery.destroy();
    }
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    return this.status();
  }
  async handle(req, res) {
    // Accept our advertised hostname as well as direct IP connections.
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!require('node:net').isIP(host) && host !== 'localhost' && host !== 'lumen.local') { res.writeHead(403); return res.end(); }
    const origin = req.headers.origin;
    const allowed = !origin || origin === PAGE_ORIGIN || origin === `http://${req.headers.host}`;
    if (!allowed) { res.writeHead(403); return res.end(); }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Private-Network': 'true' }); return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && !(req.method === 'POST' && url.pathname === '/api/action')) { res.writeHead(405); return res.end(); }
    if (!url.pathname.startsWith('/api/')) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].includes(name) && !/^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(name)) { res.writeHead(404); return res.end(); }
      const file = path.join(this.staticDir, name);
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      return res.end(await fs.readFile(file));
    }
    // Sharing explicitly permits automatic pairing for devices on this LAN.
    if (url.pathname === '/api/discover') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ service: 'lumen', version: 1, token: this.token }));
    }
    const mediaKey = /^\/api\/(thumb|image)\/[a-f0-9]+$/.test(url.pathname) ? url.searchParams.get('key') : null;
    const supplied = Buffer.from((req.headers.authorization || (mediaKey ? `Bearer ${mediaKey}` : '')).replace(/^Bearer ([a-z0-9]{5})$/i, (_match, key) => `Bearer ${key.toUpperCase()}`));
    const expected = Buffer.from(`Bearer ${this.token}`);
    if (!this.token || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) { res.writeHead(401); return res.end('Pairing key required'); }
    if (url.pathname === '/api/state') {
      const state = this.state();
      const revision = JSON.stringify([state.generation, state.scanning, state.snapshot?.scannedAt, state.snapshot?.items.length]);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(url.searchParams.get('revision') === revision ? null : state));
    }
    if (url.pathname === '/api/folders') {
      const requested = url.searchParams.get('path') || '';
      res.setHeader('Content-Type', 'application/json');
      try {
        if (!requested) {
          const roots = process.platform === 'win32'
            ? (await Promise.all(Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i) + ':\\').map(async drive => { try { await fs.access(drive); return drive; } catch { return null; } }))).filter(Boolean)
            : ['/'];
          const folders = [...new Set([os.homedir(), ...roots, ...(this.state().recent || [])])].map(folder => ({ name: folder, path: folder }));
          return res.end(JSON.stringify({ path: '', parent: null, folders }));
        }
        if (!path.isAbsolute(requested)) throw new Error('Absolute folder path required');
        const folder = await fs.realpath(requested);
        const entries = await fs.readdir(folder, { withFileTypes: true });
        const directories = await Promise.all(entries.map(async entry => {
          if (entry.isDirectory()) return entry;
          if (entry.isSymbolicLink()) { try { if ((await fs.stat(path.join(folder, entry.name))).isDirectory()) return entry; } catch { /* Skip broken links. */ } }
          return null;
        }));
        const folders = directories.filter(Boolean).map(entry => ({ name: entry.name, path: path.join(folder, entry.name) })).sort((a, b) => a.name.localeCompare(b.name));
        const parent = path.dirname(folder);
        return res.end(JSON.stringify({ path: folder, parent: parent === folder ? null : parent, folders }));
      } catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'Cannot browse this folder. Check its path and the PC user permissions.' })); }
    }
    if (url.pathname === '/api/action') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) { res.writeHead(413); return res.end(); } }
      try {
        const { action, argument } = JSON.parse(body);
        if (!['open', 'rescan', 'cancel', 'reveal'].includes(action) || !this.actions?.[action]) { res.writeHead(400); return res.end(); }
        // Remote selection never invokes a native dialog on the unattended host.
        if (action === 'open') {
          if (typeof argument !== 'string' || !path.isAbsolute(argument)) { res.writeHead(400); return res.end(); }
          await fs.readdir(argument); // Validate readability before switching libraries.
        }
        const result = await this.actions[action](argument);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(result ?? null));
      } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: error.message })); }
    }
    if (url.pathname === '/api/library') {
      const state = this.state();
      const q = (url.searchParams.get('q') || '').toLowerCase(), folder = url.searchParams.get('folder') || '';
      const all = (state.snapshot?.items || []).filter(i => (!folder || i.folder === folder || i.folder.startsWith(folder + '/')) && i.relativePath.toLowerCase().includes(q)).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const items = all.slice(offset, offset + 100).map(({ path: _path, ...item }) => item);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ name: path.basename(state.root), generation: state.generation, scanning: state.scanning, total: all.length, items, folders: state.snapshot?.folders || [] }));
    }
    const match = /^\/api\/(thumb|image|metadata)\/([a-f0-9]+)$/.exec(url.pathname);
    if (!match) { res.writeHead(404); return res.end(); }
    const item = this.indexed(match[2]);
    const state = this.state(), actual = await fs.realpath(item.path), root = await fs.realpath(state.root);
    const relative = path.relative(root, actual);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) { res.writeHead(403); return res.end(); }
    await this.beforeImages();
    const safeItem = { ...item, path: actual };
    if (match[1] === 'metadata') {
      const metadata = await this.service.metadata(safeItem);
      if (state.generation !== this.state().generation) { res.writeHead(409); return res.end(); }
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(metadata));
    }
    const file = match[1] === 'thumb' ? await this.service.thumbnail(safeItem) : await this.service.full(safeItem);
    if (state.generation !== this.state().generation) { res.writeHead(409); return res.end('Library changed'); }
    res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    await pipeline(createReadStream(file), res);
  }
}
module.exports = { SharingService };
